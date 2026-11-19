import { describe, expect, it, vi, type Mock } from "vitest";
import {
  AudioOutputRouter,
  normalizeOutputId,
  reconcileOutputDevice,
  type AudioOutputEvent,
} from "./audio-output-device";

const device = (deviceId: string, label: string, kind: MediaDeviceKind = "audiooutput") =>
  ({ deviceId, label, kind, groupId: "g" }) as MediaDeviceInfo;

const SPEAKERS = device("speakers-id", "MacBook Speakers");
const HEADSET = device("headset-id", "USB Headset");
const DEFAULT = device("default", "Default - MacBook Speakers");
const MIC = device("mic-id", "Mic", "audioinput");

function fakeMediaDevices(initial: MediaDeviceInfo[]) {
  let list = initial;
  const handlers = new Set<() => void>();
  return {
    enumerateDevices: vi.fn(async () => list),
    addEventListener: vi.fn((_type: string, handler: () => void) => { handlers.add(handler); }),
    removeEventListener: vi.fn((_type: string, handler: () => void) => { handlers.delete(handler); }),
    set(next: MediaDeviceInfo[]) { list = next; },
    fire() { for (const handler of [...handlers]) handler(); },
    handlers,
  };
}

function fakeContext(options: { sink?: boolean; rejectIds?: string[] } = {}) {
  const sinkCalls: string[] = [];
  const destination = { id: "destination" };
  const context: Record<string, unknown> = {
    destination,
    createMediaStreamDestination: vi.fn(() => ({ stream: { id: "stream" } })),
  };
  if (options.sink !== false) {
    context.setSinkId = vi.fn(async (id: string) => {
      if (options.rejectIds?.includes(id)) throw new DOMException("not found", "NotFoundError");
      sinkCalls.push(id);
    });
  }
  return { context: context as unknown as AudioContext, sinkCalls, destination };
}

const fakeMaster = () => ({ connect: vi.fn(), disconnect: vi.fn() }) as unknown as AudioNode & { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

function setup(devices: MediaDeviceInfo[], contextOptions: Parameters<typeof fakeContext>[0] = {}) {
  const mediaDevices = fakeMediaDevices(devices);
  const ctx = fakeContext(contextOptions);
  const master = fakeMaster();
  const elements: Array<{ srcObject: unknown; setSinkId: Mock; play: Mock; pause: Mock }> = [];
  const router = new AudioOutputRouter({
    mediaDevices: mediaDevices as never,
    createAudioElement: () => {
      const element = { srcObject: null as unknown, setSinkId: vi.fn(async () => undefined), play: vi.fn(async () => undefined), pause: vi.fn() };
      elements.push(element);
      return element as never;
    },
  });
  const events: AudioOutputEvent[] = [];
  router.subscribe((event) => { if (event.type !== "devices") events.push(event); });
  router.attach(ctx.context, master);
  return { router, mediaDevices, ctx, master, events, elements };
}

describe("reconcileOutputDevice", () => {
  const base = { availableIds: ["a", "b"] };
  it("keeps, falls back and restores according to presence", () => {
    expect(reconcileOutputDevice({ ...base, preferredId: "a", activeId: "a" })).toBe("keep");
    expect(reconcileOutputDevice({ ...base, preferredId: "a", activeId: "" })).toBe("restore");
    expect(reconcileOutputDevice({ ...base, preferredId: "gone", activeId: "gone" })).toBe("fallback");
    expect(reconcileOutputDevice({ ...base, preferredId: "gone", activeId: "" })).toBe("keep");
    expect(reconcileOutputDevice({ ...base, preferredId: "", activeId: "a" })).toBe("fallback");
    expect(reconcileOutputDevice({ ...base, preferredId: "default", activeId: "" })).toBe("keep");
  });
  it("never treats an empty device list as an unplug", () => {
    expect(reconcileOutputDevice({ availableIds: [], preferredId: "a", activeId: "a" })).toBe("keep");
    expect(reconcileOutputDevice({ availableIds: [], preferredId: "a", activeId: "" })).toBe("restore");
    // ...but a real list that only holds the default means the device really is gone.
    expect(reconcileOutputDevice({ availableIds: [], listKnown: true, preferredId: "a", activeId: "a" })).toBe("fallback");
  });
  it("normalizes the default aliases", () => {
    expect(normalizeOutputId("default")).toBe("");
    expect(normalizeOutputId(undefined)).toBe("");
    expect(normalizeOutputId("x")).toBe("x");
  });
});

describe("AudioOutputRouter listing", () => {
  it("lists outputs only, folds the default alias, labels unnamed devices", async () => {
    const { router } = setup([DEFAULT, device("communications", "Communications"), SPEAKERS, device("x", ""), MIC]);
    const devices = await router.listDevices();
    expect(devices.map((d) => [d.deviceId, d.label, d.isDefault])).toEqual([
      ["", "System default", true],
      ["speakers-id", "MacBook Speakers", false],
      ["x", "Audio output 1", false],
    ]);
    expect(await router.needsAccessForLabels()).toBe(true);
  });
});

describe("AudioOutputRouter on AudioContext.setSinkId", () => {
  it("treats a withheld device list (empty ids) as unknown, not unplugged", async () => {
    const { router, ctx, events, mediaDevices } = setup([DEFAULT, HEADSET]);
    await router.setPreferredDevice("headset-id");
    events.length = 0;
    mediaDevices.set([device("", "", "audiooutput")]);
    await router.reconcile();
    expect(router.getActiveDeviceId()).toBe("headset-id");
    expect(events).toEqual([]);
    expect(ctx.sinkCalls).toEqual(["headset-id"]);
  });

  it("falls back when the unplug leaves only the system default", async () => {
    const { router, events, mediaDevices } = setup([DEFAULT, HEADSET]);
    await router.setPreferredDevice("headset-id");
    events.length = 0;
    mediaDevices.set([DEFAULT]);
    await router.reconcile();
    expect(router.getActiveDeviceId()).toBe("");
    expect(events).toEqual([{ type: "fallback", reason: "unplugged", requestedId: "headset-id", requestedLabel: "USB Headset" }]);
  });

  it("applies the chosen device and reports it", async () => {
    const { router, ctx, events } = setup([DEFAULT, SPEAKERS, HEADSET]);
    expect(router.getSupport()).toBe("context");
    await router.setPreferredDevice("headset-id");
    expect(ctx.sinkCalls).toEqual(["headset-id"]);
    expect(router.getActiveDeviceId()).toBe("headset-id");
    expect(events).toEqual([{ type: "applied", deviceId: "headset-id", label: "USB Headset" }]);
  });

  it("switches back to the system default when the user picks it", async () => {
    const { router, ctx } = setup([DEFAULT, SPEAKERS, HEADSET]);
    await router.setPreferredDevice("headset-id");
    await router.setPreferredDevice("default");
    expect(ctx.sinkCalls).toEqual(["headset-id", ""]);
    expect(router.getActiveDeviceId()).toBe("");
  });

  it("applies the remembered device as soon as the graph attaches", async () => {
    const mediaDevices = fakeMediaDevices([DEFAULT, HEADSET]);
    const router = new AudioOutputRouter({ mediaDevices: mediaDevices as never });
    await router.setPreferredDevice("headset-id"); // before any AudioContext exists: nothing to retarget yet
    const ctx = fakeContext();
    router.attach(ctx.context, fakeMaster());
    await router.reconcile();
    expect(ctx.sinkCalls).toEqual(["headset-id"]);
  });

  it("falls back to the default with a notice when the device is unplugged, and returns when it is back", async () => {
    const { router, ctx, events, mediaDevices } = setup([DEFAULT, SPEAKERS, HEADSET]);
    router.startWatching();
    await router.setPreferredDevice("headset-id");
    events.length = 0;

    mediaDevices.set([DEFAULT, SPEAKERS]);
    mediaDevices.fire();
    await router.reconcile();
    expect(router.getActiveDeviceId()).toBe("");
    expect(router.isFallbackActive()).toBe(true);
    expect(router.getPreferredDeviceId()).toBe("headset-id"); // the choice is remembered
    expect(events.filter((e) => e.type === "fallback")).toEqual([
      { type: "fallback", reason: "unplugged", requestedId: "headset-id", requestedLabel: "USB Headset" },
    ]);
    expect(ctx.sinkCalls.at(-1)).toBe("");

    // Further device churn while it is gone does not repeat the notice.
    events.length = 0;
    mediaDevices.fire();
    await router.reconcile();
    expect(events).toEqual([]);

    mediaDevices.set([DEFAULT, SPEAKERS, HEADSET]);
    mediaDevices.fire();
    await router.reconcile();
    expect(router.getActiveDeviceId()).toBe("headset-id");
    expect(router.isFallbackActive()).toBe(false);
    expect(events).toEqual([{ type: "restored", deviceId: "headset-id", label: "USB Headset" }]);
  });

  it("falls back with an error notice when the browser refuses the sink", async () => {
    const { router, ctx, events } = setup([DEFAULT, HEADSET], { rejectIds: ["headset-id"] });
    await router.setPreferredDevice("headset-id");
    expect(router.getActiveDeviceId()).toBe("");
    expect(ctx.sinkCalls).toEqual([""]);
    expect(events).toEqual([{ type: "fallback", reason: "error", requestedId: "headset-id", requestedLabel: "USB Headset" }]);
  });

  it("uses the remembered label for a saved device that is not connected", async () => {
    const mediaDevices = fakeMediaDevices([DEFAULT, SPEAKERS]);
    const router = new AudioOutputRouter({ mediaDevices: mediaDevices as never });
    const events: AudioOutputEvent[] = [];
    router.subscribe((event) => { if (event.type !== "devices") events.push(event); });
    router.rememberLabel("headset-id", "USB Headset");
    router.attach(fakeContext().context, fakeMaster());
    await router.setPreferredDevice("headset-id");
    expect(events).toEqual([{ type: "fallback", reason: "unplugged", requestedId: "headset-id", requestedLabel: "USB Headset" }]);
  });

  it("stops listening for device changes", () => {
    const { router, mediaDevices } = setup([DEFAULT]);
    router.startWatching();
    router.startWatching();
    expect(mediaDevices.handlers.size).toBe(1);
    router.stopWatching();
    expect(mediaDevices.handlers.size).toBe(0);
  });
});

describe("AudioOutputRouter media element fallback", () => {
  it("routes the master mix through an element's setSinkId when the context cannot", async () => {
    const { router, ctx, master, elements, events } = setup([DEFAULT, HEADSET], { sink: false });
    expect(router.getSupport()).toBe("element");
    await router.setPreferredDevice("headset-id");
    expect(elements).toHaveLength(1);
    expect(elements[0].setSinkId).toHaveBeenCalledWith("headset-id");
    expect(elements[0].play).toHaveBeenCalled();
    expect(master.disconnect).toHaveBeenCalledWith(ctx.destination);
    expect(master.connect).toHaveBeenCalled();
    expect(events).toEqual([{ type: "applied", deviceId: "headset-id", label: "USB Headset" }]);
  });

  it("restores the direct destination connection when going back to the default", async () => {
    const { router, ctx, master, elements } = setup([DEFAULT, HEADSET], { sink: false });
    await router.setPreferredDevice("headset-id");
    master.connect.mockClear();
    await router.setPreferredDevice("");
    expect(elements[0].pause).toHaveBeenCalled();
    expect(master.connect).toHaveBeenCalledWith(ctx.destination);
    expect(router.getActiveDeviceId()).toBe("");
  });

  it("reports no support when neither path exists", () => {
    const mediaDevices = fakeMediaDevices([DEFAULT]);
    const router = new AudioOutputRouter({ mediaDevices: mediaDevices as never });
    const ctx = { destination: {} } as unknown as AudioContext;
    router.attach(ctx, fakeMaster());
    expect(router.getSupport()).toBe("none");
  });
});
