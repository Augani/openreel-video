import "../../test/install-local-storage-mock";
import { ActionExecutor, type Clip, type Project } from "@openreel/core";
import { executeTool } from "@openreel/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { registerPreviewCanvas } from "../../components/editor/scopes/preview-canvas-registry";
import { LiveEditorHost } from "./live-host";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  anchor: { x: 0.5, y: 0.5 },
};
const clip = (id: string, trackId: string, startTime: number, duration: number, inPoint: number): Clip => ({
  id, trackId, mediaId: "source", startTime, duration, inPoint, outPoint: inPoint + duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [], transform,
});

function fixture(): Project {
  const project = createEmptyProject("Agent pro tools");
  const track = (id: string, name: string, clips: Clip[]) => ({
    id, name, type: "video" as const, locked: false, hidden: false, solo: false, muted: false,
    transitions: [], clips,
  });
  return {
    ...project,
    settings: { ...project.settings, frameRate: 30 },
    mediaLibrary: {
      items: [{
        id: "source", name: "Source.mp4", type: "video" as const, fileHandle: null, blob: null,
        thumbnailUrl: null, waveformData: new Float32Array(10),
        metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
      }],
    },
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        track("broll", "B-roll", []),
        track("main", "Main", [clip("a", "main", 0, 5, 5), clip("b", "main", 5, 5, 5)]),
      ],
    },
  } as Project;
}

const history = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
const layout = (trackId: string) =>
  [...(useProjectStore.getState().project.timeline.tracks.find((t) => t.id === trackId)?.clips ?? [])]
    .sort((x, y) => x.startTime - y.startTime)
    .map((c) => [c.id, +c.startTime.toFixed(4), +c.duration.toFixed(4)]);

beforeEach(() => {
  const executor = new ActionExecutor();
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({
    project: fixture(), hasOpenProject: true, actionExecutor: executor,
    actionHistory: executor.getHistory(), clipUndoStack: [], clipRedoStack: [],
    templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused", playheadPosition: 0, loopStart: 0, loopEnd: 0 });
  useUIStore.setState({ selectedItems: [], scopesVisible: false, scopesKind: "waveform", exportState: { ...useUIStore.getState().exportState, isExporting: false } });
});

afterEach(() => {
  registerPreviewCanvas(null);
  vi.restoreAllMocks();
});

describe("LiveEditorHost premiere-parity tools", () => {
  it("rolls through the store as exactly one history entry and undoes cleanly", async () => {
    const host = new LiveEditorHost();
    const before = history();
    const result = await executeTool("roll_trim", { clipId: "a", deltaFrame: 30 }, host);
    expect(result.ok).toBe(true);
    expect(history()).toBe(before + 1);
    expect(layout("main")).toEqual([["a", 0, 6], ["b", 6, 4]]);
    await useProjectStore.getState().undo();
    expect(layout("main")).toEqual([["a", 0, 5], ["b", 5, 5]]);
  });

  it("inserts on the Main track (V1), never the B-roll lane above it", async () => {
    const host = new LiveEditorHost();
    const before = history();
    const result = await executeTool("insert_media", { mediaId: "source", at: 5, sourceIn: 0, sourceOut: 2 }, host);
    expect(result.ok).toBe(true);
    expect(history()).toBe(before + 1);
    expect(layout("broll")).toEqual([]);
    expect(layout("main").map(([, s, d]) => [s, d])).toEqual([[0, 5], [5, 2], [7, 5]]);
  });

  it("extracts a range as one undo step and restores it on undo", async () => {
    const host = new LiveEditorHost();
    const before = history();
    expect((await executeTool("extract_range", { start: 2, end: 7 }, host)).ok).toBe(true);
    expect(history()).toBe(before + 1);
    expect(layout("main").map(([, s, d]) => [s, d])).toEqual([[0, 2], [2, 3]]);
    await useProjectStore.getState().undo();
    expect(layout("main")).toEqual([["a", 0, 5], ["b", 5, 5]]);
  });

  it("reports planning errors without touching history", async () => {
    const host = new LiveEditorHost();
    const before = history();
    const result = await executeTool("slide_trim", { clipId: "a", delta: 1 }, host);
    expect(result.ok).toBe(false);
    expect(history()).toBe(before);
  });

  it("opens and closes the Scopes panel through the UI store", async () => {
    const host = new LiveEditorHost();
    const open = await executeTool("open_scopes", { kind: "vectorscope" }, host);
    expect(open.ok).toBe(true);
    expect(useUIStore.getState()).toMatchObject({ scopesVisible: true, scopesKind: "vectorscope" });
    await executeTool("close_scopes", {}, host);
    expect(useUIStore.getState().scopesVisible).toBe(false);
  });

  it("reads scope statistics from the registered program canvas, seeking when asked", async () => {
    const host = new LiveEditorHost();
    const notReady = await executeTool("get_scope_stats", {}, host);
    expect(notReady.error?.code).toBe("NOT_READY");

    registerPreviewCanvas({ width: 64, height: 36 } as HTMLCanvasElement);
    const pixels = new Uint8ClampedArray(256 * 144 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([240, 240, 240, 255], i);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          clearRect: () => undefined,
          drawImage: () => undefined,
          getImageData: () => ({ data: pixels, width: 256, height: 144 }),
        }) as never,
    );
    const seek = vi.spyOn(useTimelineStore.getState(), "seekTo");
    const result = await executeTool("get_scope_stats", { time: 2 }, host);
    expect(result.ok).toBe(true);
    expect(seek).toHaveBeenCalledWith(2);
    const { stats } = result.data as { stats: { luma: { average: number; whiteClipPct: number } } };
    expect(stats.luma.average).toBeCloseTo(94, 0);
    expect(stats.luma.whiteClipPct).toBe(0);
  });

  it("does not return the pre-seek frame, and restores the playhead afterwards", async () => {
    const host = new LiveEditorHost();
    registerPreviewCanvas({ width: 64, height: 36 } as HTMLCanvasElement);
    const fill = (value: number) => {
      const data = new Uint8ClampedArray(256 * 144 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
      return data;
    };
    let current = fill(20);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          clearRect: () => undefined,
          drawImage: () => undefined,
          getImageData: () => ({ data: current, width: 256, height: 144 }),
        }) as never,
    );
    useTimelineStore.setState({ playheadPosition: 1 });
    const original = useTimelineStore.getState().seekTo;
    const targets: number[] = [];
    useTimelineStore.setState({
      seekTo: (position: number) => {
        targets.push(position);
        // The new frame only shows up after an async decode.
        if (position === 3) setTimeout(() => { current = fill(200); }, 200);
        original(position);
      },
    });
    try {
      const result = await executeTool("get_scope_stats", { time: 3 }, host);
      expect(result.ok).toBe(true);
      const { stats } = result.data as { stats: { luma: { average: number } } };
      expect(stats.luma.average).toBeGreaterThan(70); // 200/255 (the new frame), not 20/255
      expect(targets).toEqual([3, 1]);
      expect(useTimelineStore.getState().playheadPosition).toBe(1);
    } finally {
      useTimelineStore.setState({ seekTo: original });
    }
  });

  it("refuses scene application for an unknown analysis", async () => {
    const host = new LiveEditorHost();
    await expect(
      host.sceneDetection.apply({ analysisId: "missing", splitClip: true, addMarkers: false }),
    ).rejects.toThrow(/Unknown analysisId/);
    const result = await executeTool("apply_scene_cuts", { analysisId: "missing" }, host);
    expect(result.ok).toBe(false);
  });
});
