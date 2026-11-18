import { beforeEach, describe, expect, it } from "vitest";
import {
  ActionExecutor,
  GraphicsEngine,
  TitleEngine,
  getGraphicInstance,
  getLinkedComposition,
  linkedInstanceOfBakedClip,
  renderAndReplace,
  type GraphicTemplate,
  type Project,
} from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { commitSequenceEdit } from "./sequence-commands";
import {
  editLinkedCompositionCommand,
  replaceSelectionWithLinkedComposition,
  restoreUnrenderedCommand,
  selectedLinkedInstance,
  setParamKeyframeCommand,
} from "./linked-comp-commands";
import { editGraphicTemplateCommand } from "./graphic-commands";
import { startLinkedCompHost } from "./linked-comp-host";
import { bakeSettings } from "./linked-comp-render";
import {
  compositionIdFromHash,
  compositionWindowHash,
  parseLinkedCompMessage,
  type LinkedCompMessage,
} from "./linked-comp-protocol";
import { getLinkedCompTransport, type LinkedCompTransport } from "./linked-comp-bridge";

const state = () => useProjectStore.getState();
const history = () => state().actionExecutor.getHistory();
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

const textClip = (id: string, startTime: number) => ({
  id, trackId: "g1", text: "Hello", startTime, duration: 4,
  style: { fontFamily: "Inter", fontSize: 60, fontWeight: 400, fontStyle: "normal", color: "#ff0000", textAlign: "center", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0 },
  transform, keyframes: [],
});

const media = {
  id: "render1", name: "r.mp4", type: "video", blob: new Blob(["x"]), fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
};

function open(): void {
  const base = createEmptyProject("Linked");
  const project = {
    ...base,
    mediaLibrary: { ...base.mediaLibrary, items: [media] },
    timeline: {
      ...base.timeline,
      duration: 8,
      tracks: [
        { id: "g1", name: "Graphics 1", type: "graphics", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
        { id: "v1", name: "V1", type: "video", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
    },
    textClips: [textClip("t1", 1)],
  } as unknown as Project;
  const titleEngine = new TitleEngine();
  titleEngine.loadTextClips(project.textClips ?? []);
  useEngineStore.setState({ titleEngine, graphicsEngine: new GraphicsEngine() });
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project, actionExecutor: executor, actionHistory: executor.getHistory(), hasOpenProject: true,
    clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
}
const select = (...ids: string[]) => useUIStore.setState({ selectedItems: ids.map((id) => ({ type: "clip" as const, id })) });

beforeEach(() => {
  open();
  select();
  useUIStore.setState({ effectApplicationClipId: null, exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 0 });
});

async function link(): Promise<{ instanceId: string; compositionId: string }> {
  select("t1");
  const result = await replaceSelectionWithLinkedComposition("Lower third");
  if (!result.ok || !result.instanceId || !result.compositionId) throw new Error(`link failed: ${result.ok ? "no ids" : result.message}`);
  return { instanceId: result.instanceId, compositionId: result.compositionId };
}

describe("linked composition commands in the project store", () => {
  it("Replace with Linked Composition is one undo step and undo restores the loose clip", async () => {
    const before = history().getUndoStackSize();
    const { instanceId, compositionId } = await link();
    expect(history().getUndoStackSize() - before).toBe(1);
    expect(getLinkedComposition(state().getFullProject(), compositionId)?.name).toBe("Lower third");
    expect(state().project.textClips?.map((clip) => clip.id)).toEqual([`${instanceId}__text-1`]);
    await state().undo();
    expect(state().project.textClips?.map((clip) => clip.id)).toEqual(["t1"]);
    expect(state().project.linkedCompositions).toBeUndefined();
  });

  it("Replace refuses a selection of media clips with a toast-able message", async () => {
    select("nothing");
    const result = await replaceSelectionWithLinkedComposition();
    expect(result.ok).toBe(false);
  });

  it("editing Essential Graphics > Edit on a linked graphic edits the one master (every instance)", async () => {
    const { instanceId, compositionId } = await link();
    const rename = (template: GraphicTemplate): GraphicTemplate => ({ ...template, description: "from the timeline" });
    const result = await editGraphicTemplateCommand(instanceId, "Edit", rename);
    expect(result.ok).toBe(true);
    expect(getLinkedComposition(state().getFullProject(), compositionId)?.template.description).toBe("from the timeline");
    expect(getGraphicInstance(state().getFullProject(), instanceId)?.template.description).toBe("from the timeline");
  });

  it("a master edit is one undo step and changes the timeline clips immediately", async () => {
    const { compositionId } = await link();
    const steps = history().getUndoStackSize();
    const result = await editLinkedCompositionCommand(compositionId, "Retitle", (template) => ({
      ...template,
      layers: template.layers.map((layer) => (layer.text ? { ...layer, text: { ...layer.text, text: "Retitled" } } : layer)),
      parameters: template.parameters.map((p) => (p.type === "text" ? { ...p, defaultValue: "Retitled" } : p)),
    }));
    expect(result.ok).toBe(true);
    expect(history().getUndoStackSize() - steps).toBe(1);
    expect(state().project.textClips?.[0].text).toBe("Retitled");
    await state().undo();
    expect(state().project.textClips?.[0].text).toBe("Hello");
  });

  it("parameter keyframes are single undo steps", async () => {
    const { instanceId } = await link();
    const instance = getGraphicInstance(state().getFullProject(), instanceId);
    const template: GraphicTemplate = {
      ...(instance as NonNullable<typeof instance>).template,
      parameters: [
        ...(instance as NonNullable<typeof instance>).template.parameters,
        { id: "fade", label: "Fade", type: "slider", defaultValue: 1, min: 0, max: 1, targets: [{ layerId: "text-1", property: "opacity" }] },
      ],
    };
    const { compositionId } = { compositionId: instance?.linkedCompositionId as string };
    expect((await editLinkedCompositionCommand(compositionId, "Expose", () => template)).ok).toBe(true);
    const steps = history().getUndoStackSize();
    expect((await setParamKeyframeCommand(instanceId, "fade", { time: 0, value: 0 })).ok).toBe(true);
    expect((await setParamKeyframeCommand(instanceId, "fade", { time: 2, value: 1 })).ok).toBe(true);
    expect(history().getUndoStackSize() - steps).toBe(2);
    expect(getGraphicInstance(state().getFullProject(), instanceId)?.paramKeyframes?.fade).toHaveLength(2);
    await state().undo();
    expect(getGraphicInstance(state().getFullProject(), instanceId)?.paramKeyframes?.fade).toHaveLength(1);
  });

  it("Render and Replace then Restore Unrendered: each a single step, selection resolves the rendered clip", async () => {
    const { instanceId } = await link();
    const steps = history().getUndoStackSize();
    const result = await commitSequenceEdit("Render and replace", (project) => renderAndReplace(project, instanceId, "render1"));
    expect(result.ok).toBe(true);
    expect(history().getUndoStackSize() - steps).toBe(1);
    const baked = getGraphicInstance(state().getFullProject(), instanceId)?.bake;
    expect(baked).toBeDefined();
    const project = state().getFullProject();
    expect(linkedInstanceOfBakedClip(project, baked?.clipId as string)?.id).toBe(instanceId);
    expect(selectedLinkedInstance(project, [baked?.clipId as string])?.id).toBe(instanceId);
    expect(state().project.textClips ?? []).toHaveLength(0);

    const restored = await restoreUnrenderedCommand(instanceId);
    expect(restored.ok).toBe(true);
    expect(history().getUndoStackSize() - steps).toBe(2);
    expect(state().project.textClips).toHaveLength(1);
    await state().undo();
    expect(getGraphicInstance(state().getFullProject(), instanceId)?.bake).toBeDefined();
  });
});

describe("composition window host", () => {
  function pair() {
    const toHost: Array<(m: LinkedCompMessage) => void> = [];
    const toWindow: LinkedCompMessage[] = [];
    const transport: LinkedCompTransport = {
      open: async () => ({ ok: true }),
      post: (message) => { toWindow.push(message); },
      subscribe: (listener) => { toHost.push(listener); return () => undefined; },
    };
    const send = (message: LinkedCompMessage) => {
      for (const listener of toHost) listener(message);
    };
    return { transport, send, toWindow };
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("answers hello with the master, applies an edit as one undo step, and pushes the new state", async () => {
    const { compositionId } = await link();
    const { transport, send, toWindow } = pair();
    const stop = startLinkedCompHost(transport);
    send({ type: "hello", compositionId });
    await flush();
    const first = toWindow.find((m) => m.type === "state");
    expect(first?.type === "state" && first.revision).toBe(1);
    const master = getLinkedComposition(state().getFullProject(), compositionId) as NonNullable<ReturnType<typeof getLinkedComposition>>;

    const steps = history().getUndoStackSize();
    const edited: GraphicTemplate = { ...master.template, description: "edited in the window" };
    send({ type: "edit", compositionId, baseRevision: 1, label: "Edit description", template: edited });
    await flush();
    expect(history().getUndoStackSize() - steps).toBe(1);
    const latest = [...toWindow].reverse().find((m) => m.type === "state");
    expect(latest?.type === "state" && latest.revision).toBe(2);
    expect(latest?.type === "state" && latest.template.description).toBe("edited in the window");
    expect(latest?.type === "state" && latest.rejected).toBeUndefined();

    // Undo in the main window reaches the window too.
    await state().undo();
    await flush();
    const afterUndo = [...toWindow].reverse().find((m) => m.type === "state");
    expect(afterUndo?.type === "state" && afterUndo.revision).toBe(1);
    stop();
  });

  it("two edits sent back to back on the same revision: the first applies, the second is refused (no lost update)", async () => {
    const { compositionId } = await link();
    const { transport, send, toWindow } = pair();
    const stop = startLinkedCompHost(transport);
    const master = getLinkedComposition(state().getFullProject(), compositionId) as NonNullable<ReturnType<typeof getLinkedComposition>>;
    const steps = history().getUndoStackSize();
    send({ type: "edit", compositionId, baseRevision: 1, label: "one", template: { ...master.template, description: "one" } });
    send({ type: "edit", compositionId, baseRevision: 1, label: "two", template: { ...master.template, description: "two" } });
    await flush();
    await flush();
    expect(getLinkedComposition(state().getFullProject(), compositionId)?.template.description).toBe("one");
    expect(getLinkedComposition(state().getFullProject(), compositionId)?.revision).toBe(2);
    expect(history().getUndoStackSize() - steps).toBe(1);
    expect(toWindow.some((m) => m.type === "state" && m.rejected?.match(/changed in the editor/))).toBe(true);
    stop();
  });

  it("rejects an edit made on a stale revision and an invalid template, and reports a removed composition", async () => {
    const { compositionId } = await link();
    const { transport, send, toWindow } = pair();
    const stop = startLinkedCompHost(transport);
    const master = getLinkedComposition(state().getFullProject(), compositionId) as NonNullable<ReturnType<typeof getLinkedComposition>>;
    await editLinkedCompositionCommand(compositionId, "Main edit", (t) => ({ ...t, description: "main" }));
    send({ type: "edit", compositionId, baseRevision: 1, label: "late", template: { ...master.template, description: "late" } });
    await flush();
    const stale = toWindow.find((m) => m.type === "state" && m.rejected);
    expect(stale?.type === "state" && stale.rejected).toMatch(/changed in the editor/);
    expect(getLinkedComposition(state().getFullProject(), compositionId)?.template.description).toBe("main");

    send({ type: "edit", compositionId, baseRevision: 2, label: "bad", template: { ...master.template, schemaVersion: 99 } });
    await flush();
    expect(toWindow.some((m) => m.type === "state" && m.rejected?.startsWith("That change is not valid"))).toBe(true);

    send({ type: "hello", compositionId: "missing" });
    await flush();
    expect(toWindow.some((m) => m.type === "gone" && m.compositionId === "missing")).toBe(true);
    stop();
  });
});

describe("transport selection", () => {
  it("uses the desktop IPC bridge when the preload exposes it, and parses what arrives", () => {
    const posted: unknown[] = [];
    let deliver: (message: unknown) => void = () => undefined;
    (window as unknown as { openreel: unknown }).openreel = {
      platform: "desktop",
      linkedComp: {
        open: async () => ({ ok: true }),
        post: (message: unknown) => posted.push(message),
        onMessage: (cb: (message: unknown) => void) => { deliver = cb; return () => undefined; },
      },
    };
    try {
      const transport = getLinkedCompTransport();
      transport.post({ type: "hello", compositionId: "c1" });
      expect(posted).toEqual([{ type: "hello", compositionId: "c1" }]);
      const received: LinkedCompMessage[] = [];
      transport.subscribe((message) => received.push(message));
      deliver({ type: "bogus" });
      deliver({ type: "gone", compositionId: "c1" });
      expect(received).toEqual([{ type: "gone", compositionId: "c1" }]);
    } finally {
      delete (window as unknown as { openreel?: unknown }).openreel;
    }
  });
});

describe("protocol and render settings", () => {
  it("round-trips the window hash and rejects hostile messages", () => {
    expect(compositionIdFromHash(compositionWindowHash("lcomp_a b"))).toBe("lcomp_a b");
    expect(compositionIdFromHash("#/editor")).toBeNull();
    expect(parseLinkedCompMessage(null)).toBeNull();
    expect(parseLinkedCompMessage({ type: "edit", compositionId: "x", baseRevision: "1", label: "l", template: {} })).toBeNull();
    expect(parseLinkedCompMessage({ type: "state", compositionId: "x", revision: 1, name: "n", template: { nope: true } })).toBeNull();
    expect(parseLinkedCompMessage({ type: "hello", compositionId: "x" })).toEqual({ type: "hello", compositionId: "x" });
    expect(parseLinkedCompMessage({ type: "bogus", compositionId: "x" })).toBeNull();
  });

  it("browser renders opaque H.264 over exactly the composition range", () => {
    const baked = bakeSettings(1280, 720, 30, { startTime: 2, endTime: 6 });
    expect(baked.alpha).toBe(false);
    expect(baked.settings).toMatchObject({ format: "mp4", codec: "h264", width: 1280, height: 720, range: { startTime: 2, endTime: 6 }, smartRender: false });
  });
});

