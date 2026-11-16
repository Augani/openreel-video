import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { GraphicsEngine, TitleEngine, type Clip, type Transform } from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { canResetClipTransform, resetClipTransform } from "./reset-clip-transform";

const transform: Transform = { position: { x: 20, y: -8 }, scale: { x: 1.2, y: 0.8 }, rotation: 17, opacity: .6,
  anchor: { x: .3, y: .4 }, rotate3d: { x: 25, y: 18, z: 0 } };
const state = () => useProjectStore.getState();
let trackId: string;
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Reset transforms");
  const project = state().project;
  trackId = project.timeline.tracks.find(track => track.type === "video")!.id;
  const clip: Clip = { id: "media-clip", mediaId: "source", trackId, startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
    volume: .7, effects: [], audioEffects: [], keyframes: [], transform: structuredClone(transform) };
  state().loadProject({ ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, clips: [clip] } : track) } });
  state().actionHistory.clear();
  useUIStore.setState({ effectApplicationClipId: null, exportState: { isExporting: false, progress: 0, phase: "" } });
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "playing" });
});

describe("shared clip transform reset", () => {
  it("resets media's existing 2D controls in one Undo and preserves other transform/effect fields", async () => {
    const before = structuredClone(state().getClip("media-clip"));
    expect(await resetClipTransform("media-clip")).toBe(true);
    expect(state().getClip("media-clip")).toEqual({ ...before, transform: { ...transform,
      position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 } });
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    expect(canResetClipTransform(state(), "media-clip")).toBe(false);
    expect(await resetClipTransform("media-clip")).toBe(false);
    expect((await state().undo()).success).toBe(true);
    expect(state().getClip("media-clip")).toEqual(before);
    expect(state().canUndo()).toBe(false);
    expect((await state().redo()).success).toBe(true);
    expect(state().getClip("media-clip")?.transform.position).toEqual({ x: 0, y: 0 });
  });

  it.each(["text", "shape", "svg", "sticker"] as const)("uses normalized coordinates and real history for %s", async kind => {
    const overlay = kind === "text" ? state().createTextClip(trackId, 0, "Title", 5) :
      kind === "shape" ? state().createShapeClip(trackId, 0, "rectangle", 5) :
      kind === "svg" ? state().importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>', trackId, 0, 5) :
      state().createStickerClip({ id: "sticker", trackId, startTime: 0, duration: 5, type: "sticker", imageUrl: "data:image/png;base64,AA==", keyframes: [], transform: structuredClone(transform) });
    expect(overlay).not.toBeNull();
    if (kind === "text") state().updateTextTransform(overlay!.id, transform);
    else state().updateShapeTransform(overlay!.id, transform);
    const current = () => kind === "text" ? state().getTextClip(overlay!.id) : state().getShapeClip(overlay!.id) ?? state().getSVGClip(overlay!.id) ?? state().getStickerClip(overlay!.id);
    const before = structuredClone(current());
    state().actionHistory.clear();
    expect(await resetClipTransform(overlay!.id)).toBe(true);
    expect(current()?.transform).toEqual({ ...transform, position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 });
    expect((await state().undo()).success).toBe(true);
    expect(current()).toEqual(before);
    expect(state().canUndo()).toBe(false);
  });

  it.each(["track", "export"] as const)("blocks the reset for a current %s lock", async lock => {
    if (lock === "track") { const project = state().project; useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, locked: true } : track) } } }); }
    if (lock === "export") useUIStore.setState({ exportState: { isExporting: true, progress: 0, phase: "encoding" } });
    expect(await resetClipTransform("media-clip")).toBe(false);
    expect(state().getClip("media-clip")?.transform).toEqual(transform);
    expect(state().canUndo()).toBe(false);
    expect(useTimelineStore.getState().playbackState).toBe("playing");
  });
  it("ignores deleted or unknown clips", async () => {
    expect(canResetClipTransform(state(), "missing")).toBe(false);
    expect(await resetClipTransform("missing")).toBe(false);
    expect(state().canUndo()).toBe(false);
  });
});
