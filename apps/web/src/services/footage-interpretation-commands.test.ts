import "../test/install-local-storage-mock";
import { ActionExecutor, type Clip, type MediaItem, type Project } from "@openreel/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { applyFootageInterpretation } from "./project-panel-commands";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } };
const clip = (id: string, mediaId: string, startTime: number, duration: number): Clip => ({
  id, trackId: "v1", mediaId, startTime, duration, inPoint: 0, outPoint: duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [], transform,
});
const media = (id: string, frameRate: number, extra: Partial<MediaItem> = {}): MediaItem =>
  ({
    id, name: `${id}.mp4`, type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
    metadata: { duration: 10, width: 1920, height: 1080, frameRate, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    ...extra,
  }) as MediaItem;

function fixture(): Project {
  const base = createEmptyProject("Interpret");
  return {
    ...base,
    mediaLibrary: {
      items: [media("a", 30), media("b", 25, { interpretation: { frameRate: 24, fieldOrder: "upper" } })],
    },
    timeline: {
      ...base.timeline,
      duration: 20,
      tracks: [{ id: "v1", name: "v1", type: "video", locked: false, hidden: false, solo: false, muted: false, transitions: [], clips: [clip("c1", "a", 0, 10), clip("c2", "a", 10, 10)] }],
    },
  } as Project;
}
const history = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
const items = () => useProjectStore.getState().project.mediaLibrary.items;
const clips = () => useProjectStore.getState().project.timeline.tracks[0].clips;

beforeEach(() => {
  const executor = new ActionExecutor();
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({
    project: fixture(), hasOpenProject: true, actionExecutor: executor,
    actionHistory: executor.getHistory(), clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
});

describe("applyFootageInterpretation", () => {
  it("applies frame rate and colour in one undo step and retimes existing clips", async () => {
    expect((await applyFootageInterpretation(["a"], { frameRate: 24, color: "p3" })).success).toBe(true);
    expect(history()).toBe(1);
    expect(items()[0].interpretation).toEqual({ frameRate: 24 });
    expect(items()[0].colorInterpretation).toBe("p3");
    expect(clips().map((c) => [c.startTime, c.duration])).toEqual([[0, 12.5], [12.5, 12.5]]);
    await useProjectStore.getState().undo();
    expect(history()).toBe(0);
    expect(items()[0].interpretation).toBeUndefined();
    expect(clips().map((c) => [c.startTime, c.duration])).toEqual([[0, 10], [10, 10]]);
  });

  it("skips unchanged items: a no-op edit pushes no undo entry", async () => {
    await applyFootageInterpretation(["a"], { frameRate: 30 });
    await applyFootageInterpretation(["b"], { frameRate: 24 });
    await applyFootageInterpretation(["a", "b"], { color: null });
    expect(history()).toBe(0);
  });

  it("a colour-only edit leaves other items' interpretation overrides alone", async () => {
    await applyFootageInterpretation(["a", "b"], { color: "p3" });
    expect(history()).toBe(1);
    expect(items()[1].interpretation).toEqual({ frameRate: 24, fieldOrder: "upper" });
  });

  it("merges a frame-rate edit into each item's own overrides, normalised to its own native rate", async () => {
    await applyFootageInterpretation(["a", "b"], { frameRate: 25 });
    expect(items()[0].interpretation).toEqual({ frameRate: 25 });
    expect(items()[1].interpretation).toEqual({ fieldOrder: "upper" });
  });

  it("can leave existing clips alone", async () => {
    await applyFootageInterpretation(["a"], { frameRate: 24, retimeClips: false });
    expect(clips().map((c) => c.duration)).toEqual([10, 10]);
  });
});
