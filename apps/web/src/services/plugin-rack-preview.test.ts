import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planAddRackPlugin, planKeyframeRackParameter, rackStemTrackId, type AudioBus, type AudioPluginRack, type Project, type RackStemResult, type Track } from "@openreel/core";

const resolve = vi.fn<[Project, { preview?: boolean }], Promise<Map<string, RackStemResult>>>();
vi.mock("@openreel/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openreel/core")>()),
  getAudioEngine: () => ({ isInitialized: () => true, initialize: async () => undefined, resolvePluginRackStems: resolve }),
}));

import { getPluginRackPreview, usePluginRackPreviewState } from "./plugin-rack-preview";

const DELAY = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple" };
const rack = (effectId = "fx1"): AudioPluginRack => planAddRackPlugin({ id: "x" }, DELAY, { actionId: "a", effectId })!.params.rack as AudioPluginRack;
const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as Track;
const project = (tracks: Track[], buses: AudioBus[] = [], id = "p"): Project =>
  ({ id, settings: { sampleRate: 8000, channels: 2 }, timeline: { duration: 3, markers: [], subtitles: [], tracks, ...(buses.length ? { audioBuses: buses } : {}) }, mediaLibrary: { items: [] } }) as unknown as Project;
const buffer = { numberOfChannels: 2, length: 10, sampleRate: 8000 } as unknown as AudioBuffer;
const stem = (kind: "track" | "bus", id: string, extra: Partial<RackStemResult> = {}): RackStemResult => ({ kind, id, buffer, seconds: 5, bypassed: new Map(), allBypassed: false, ...extra });
const settle = async () => {
  await vi.advanceTimersByTimeAsync(300);
};

describe("track / bus plugin rack preview", () => {
  let invalidations = 0;
  const onInvalidate = () => {
    invalidations += 1;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    resolve.mockReset();
    getPluginRackPreview().reset();
    invalidations = 0;
    window.addEventListener("openreel:preview-invalidate", onInvalidate);
  });
  afterEach(() => {
    window.removeEventListener("openreel:preview-invalidate", onInvalidate);
    vi.useRealTimers();
  });

  it("does nothing for a project without plugin racks", async () => {
    getPluginRackPreview().update(project([track("t1")]));
    await settle();
    expect(resolve).not.toHaveBeenCalled();
    expect(usePluginRackPreviewState.getState().status).toBe("idle");
  });

  it("renders a track stem in the background, then plays it: schedule on the track, clips replaced, preview re-scheduled", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("t1", { pluginRack: rack() })]);
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1")]]));
    preview.update(p);
    expect(preview.stemmedTrackIds(p).size, "dry until ready").toBe(0);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][1]).toEqual({ preview: true });
    expect(usePluginRackPreviewState.getState()).toMatchObject({ status: "ready", stemmed: ["t1"] });
    expect(preview.stemmedTrackIds(p)).toEqual(new Set(["t1"]));
    const schedules = preview.schedulesAt(p, 1);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ clipId: "rack-stem:t1", trackId: "t1", startTime: 0, endTime: 5, mediaOffset: 0, speed: 1, effects: [] });
    expect(preview.schedulesAt(p, 5.5), "nothing past the stem").toEqual([]);
    expect(invalidations).toBeGreaterThan(0);
  });

  it("a plugin edit drops the stale stem immediately and renders the new one; the same project does not render twice", async () => {
    const preview = getPluginRackPreview();
    const r = rack();
    const p1 = project([track("t1", { pluginRack: r })]);
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1")]]));
    preview.update(p1);
    await settle();
    expect(preview.stemmedTrackIds(p1).size).toBe(1);
    preview.update({ ...p1 });
    await settle();
    expect(resolve, "an unchanged project is not rendered again").toHaveBeenCalledTimes(1);

    const keyed = planKeyframeRackParameter({ id: "t1", pluginRack: r }, "fx1", "0", 1, 50, { actionId: "k", keyframeId: "kf" })!.params.rack as AudioPluginRack;
    const p2 = project([track("t1", { pluginRack: keyed })]);
    preview.update(p2);
    expect(preview.stemmedTrackIds(p2).size, "the old stem never plays after an edit").toBe(0);
    expect(preview.schedulesAt(p2, 1)).toEqual([]);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(preview.stemmedTrackIds(p2).size).toBe(1);
  });

  it("a bus stem plays on a synthetic track and parks its feeders on a muted sink in the graph's timeline", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("feeder", { output: "b1" })], [{ id: "b1", name: "Music", muted: false, solo: false, pluginRack: rack("fxb") }]);
    resolve.mockResolvedValue(new Map([["b1", stem("bus", "b1")]]));
    preview.update(p);
    expect(preview.timelineFor(p.timeline)).toBe(p.timeline);
    await settle();
    const graph = preview.timelineFor(p.timeline);
    expect(graph.tracks.find((t) => t.id === "feeder")?.output).toBe("__rackstem-sink");
    expect(graph.tracks.some((t) => t.id === rackStemTrackId("b1") && t.output === "b1")).toBe(true);
    expect(graph.audioBuses?.find((b) => b.id === "b1")?.pluginRack).toBeUndefined();
    expect(preview.timelineFor(p.timeline), "identity-stable between syncs").toBe(graph);
    expect(preview.schedulesAt(p, 0)[0]).toMatchObject({ clipId: "rack-stem:b1", trackId: rackStemTrackId("b1") });
    expect(preview.stemmedTrackIds(p).size, "buses do not replace track clips").toBe(0);
  });

  it("plugins that cannot run are bypassed and reported; the track keeps playing its clips", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("t1", { pluginRack: rack() })]);
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1", { buffer: null, allBypassed: true, bypassed: new Map([["fx1", "not installed"]]) })]]));
    preview.update(p);
    await settle();
    expect(preview.stemmedTrackIds(p).size).toBe(0);
    expect(preview.schedulesAt(p, 0)).toEqual([]);
    expect(usePluginRackPreviewState.getState().bypassed).toEqual({ t1: { fx1: "not installed" } });
  });

  it("a failing plugin render is reported and leaves the track dry", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("t1", { pluginRack: rack() })]);
    resolve.mockRejectedValue(new Error("A hosted audio plugin could not run: helper crashed"));
    preview.update(p);
    await settle();
    expect(usePluginRackPreviewState.getState()).toMatchObject({ status: "failed", error: expect.stringContaining("helper crashed") });
    expect(preview.stemmedTrackIds(p).size).toBe(0);
  });

  it("hear dry (preview only) changes the rendered chain without touching the project", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("t1", { pluginRack: rack() })]);
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1")]]));
    preview.update(p);
    await settle();
    resolve.mockClear();
    // the engine skips a rack whose plugins are all "hear dry": no result for the track
    resolve.mockResolvedValue(new Map());
    preview.setPreviewBypass("fx1", true);
    await settle();
    expect(preview.stemmedTrackIds(p).size, "every plugin bypassed: nothing to render").toBe(0);
    expect(p.timeline.tracks[0].pluginRack?.plugins[0].metadata).toBeUndefined();
    expect(resolve.mock.calls[0][0].timeline.tracks[0].pluginRack?.plugins[0].metadata?.previewBypass, "the flag reaches the render").toBe(true);
    resolve.mockClear();
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1")]]));
    preview.setPreviewBypass("fx1", false);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(preview.stemmedTrackIds(p).size).toBe(1);
  });
});

describe("racks that play live", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resolve.mockReset();
    getPluginRackPreview().reset();
    getPluginRackPreview().setLiveTargets(new Set());
    getPluginRackPreview().setRenderDeferred(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a live target keeps rendering its stem for the export cache but the stem is not played", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("t1", { pluginRack: rack() }), track("t2", { pluginRack: rack("fx2") })]);
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1")], ["t2", stem("track", "t2")]]));
    preview.update(p);
    await settle();
    expect(preview.stemmedTrackIds(p)).toEqual(new Set(["t1", "t2"]));
    preview.setLiveTargets(new Set(["t1"]));
    expect(preview.stemmedTrackIds(p), "t1 is live: its clips play, through the insert").toEqual(new Set(["t2"]));
    expect(preview.schedulesAt(p, 1).map((s) => s.clipId)).toEqual(["rack-stem:t2"]);
    expect([...usePluginRackPreviewState.getState().stemmed].sort(), "the render itself is still reported ready").toEqual(["t1", "t2"]);
    preview.setLiveTargets(new Set());
    expect(preview.stemmedTrackIds(p)).toEqual(new Set(["t1", "t2"]));
  });

  it("a live master does not replace every track with its stem", async () => {
    const preview = getPluginRackPreview();
    const p = { ...project([track("t1")]), } as Project;
    (p.timeline as { masterPluginRack?: AudioPluginRack }).masterPluginRack = rack("fxm");
    resolve.mockResolvedValue(new Map([["__master__", stem("bus" as never, "__master__")]]));
    preview.update(p);
    await settle();
    expect(preview.stemmedTrackIds(p).size).toBe(1);
    preview.setLiveTargets(new Set(["__master__"]));
    expect(preview.stemmedTrackIds(p).size).toBe(0);
    expect(preview.schedulesAt(p, 1)).toEqual([]);
  });

  it("changing the live set re-schedules the preview, an unchanged set does not", async () => {
    const preview = getPluginRackPreview();
    let invalidations = 0;
    const onInvalidate = () => {
      invalidations += 1;
    };
    window.addEventListener("openreel:preview-invalidate", onInvalidate);
    preview.setLiveTargets(new Set(["t1"]));
    expect(invalidations).toBe(1);
    preview.setLiveTargets(new Set(["t1"]));
    expect(invalidations).toBe(1);
    window.removeEventListener("openreel:preview-invalidate", onInvalidate);
  });

  it("while playback runs with every rack live the background render waits, then catches up when it stops", async () => {
    const preview = getPluginRackPreview();
    const p = project([track("t1", { pluginRack: rack() })]);
    resolve.mockResolvedValue(new Map([["t1", stem("track", "t1")]]));
    preview.setRenderDeferred(true);
    preview.update(p);
    await settle();
    expect(resolve, "nothing renders while the transport runs").not.toHaveBeenCalled();
    preview.setRenderDeferred(false);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(usePluginRackPreviewState.getState().status).toBe("ready");
  });
});
