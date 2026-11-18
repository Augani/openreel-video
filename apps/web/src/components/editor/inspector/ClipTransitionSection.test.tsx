import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine, type Clip, type Keyframe } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { ClipTransitionSection } from "./ClipTransitionSection";

const state = () => useProjectStore.getState();
let trackId: string;
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Clip animation controls");
  trackId = state().project.timeline.tracks.find((track) => track.type === "video")!.id;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function choose(side: "entry" | "exit", preset: string) {
  const name = `Set ${side} animation to ${preset}`;
  fireEvent.click(screen.queryByRole("button", { name }) ?? screen.getByRole("radio", { name }));
}
function addMedia(duration = 4) {
  const project = state().project;
  const clip: Clip = { id: "media", mediaId: "source", trackId, startTime: 10, duration, inPoint: 0, outPoint: duration,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
    keyframes: [], effects: [], audioEffects: [], volume: 1 };
  state().loadProject({ ...project, mediaLibrary: { items: [{ id: "source", name: "Source.mp4", type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
    metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 } }] },
    timeline: { ...project.timeline, duration: 20, tracks: project.timeline.tracks.map((track) => track.id === trackId ? { ...track, clips: [clip] } : track) } });
  state().actionHistory.clear();
  return clip;
}

describe("retained clip animation controls", () => {
  it.each(["text", "shape", "svg", "sticker"] as const)("persists %s keyframes and restores unrelated keys with one Undo/Redo", async (kind) => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const clip = kind === "text" ? state().createTextClip(trackId, 0, "Title", 4) :
      kind === "shape" ? state().createShapeClip(trackId, 0, "rectangle", 4) :
      kind === "svg" ? state().importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>', trackId, 0, 4) :
      state().createStickerClip({ id: "sticker", trackId, startTime: 0, duration: 4, type: "sticker", imageUrl: "data:image/png;base64,AA==", keyframes: [],
        transform: { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } } });
    expect(clip).not.toBeNull();
    const manual: Keyframe = { id: "manual", property: "rotation", time: 2, value: 12, easing: "linear" };
    state().updateOverlayClipTiming(clip!.id, { keyframes: [manual] });
    const field = kind === "text" ? "textClips" : kind === "shape" ? "shapeClips" : kind === "svg" ? "svgClips" : "stickerClips";
    const before = structuredClone(state().project[field]?.find((item) => item.id === clip!.id));
    state().actionHistory.clear();
    render(<ClipTransitionSection clipId={clip!.id} />);
    choose("entry", "Fade");
    fireEvent.click(screen.getByRole("button", { name: "Apply Entry/Exit Animations" }));
    const saved = structuredClone(state().project[field]?.find((item) => item.id === clip!.id));
    expect(saved?.keyframes).toContainEqual(manual);
    expect(saved!.keyframes.length).toBeGreaterThan(1);
    await act(async () => { expect((await state().undo()).success).toBe(true); });
    expect(state().project[field]?.find((item) => item.id === clip!.id)).toEqual(before);
    expect(state().canUndo()).toBe(false);
    await act(async () => { expect((await state().redo()).success).toBe(true); });
    expect(state().project[field]?.find((item) => item.id === clip!.id)).toEqual(saved);
  });

  it("bounds duration fields on a short media clip and clears generated keys with exact Undo", async () => {
    const clip = addMedia(0.08);
    const manual: Keyframe = { id: "manual", property: "rotation", time: 0.04, value: 12, easing: "linear" };
    state().updateClipKeyframes(clip.id, [manual]);
    state().actionHistory.clear();
    render(<ClipTransitionSection clipId={clip.id} />);
    choose("entry", "Blur");
    choose("exit", "Fade");
    const duration = screen.getByRole("spinbutton", { name: "Entry animation duration" });
    fireEvent.change(duration, { target: { value: "5" } });
    fireEvent.blur(duration);
    expect(duration).toHaveValue(0.04);
    fireEvent.click(screen.getByRole("button", { name: "Apply Entry/Exit Animations" }));
    const applied = structuredClone(state().getClip(clip.id)!.keyframes);
    expect(applied).toContainEqual(manual);
    expect(applied.some((key) => key.property === "effect.blur")).toBe(true);
    expect(applied.every((key) => key.time >= 0 && key.time <= 0.08)).toBe(true);
    choose("entry", "None");
    choose("exit", "None");
    fireEvent.click(screen.getByRole("button", { name: "Apply Entry/Exit Animations" }));
    expect(state().getClip(clip.id)?.keyframes).toEqual([manual]);
    await act(async () => { expect((await state().undo()).success).toBe(true); });
    expect(state().getClip(clip.id)?.keyframes).toEqual(applied);
    expect(screen.getByRole("radio", { name: "Set entry animation to Blur" })).toBeChecked();
    await act(async () => { await state().undo(); });
    expect(state().getClip(clip.id)?.keyframes).toEqual([manual]);
    expect(state().canUndo()).toBe(false);
  });

  it("does not write an animation into a locked track", () => {
    const clip = addMedia();
    const project = state().project;
    state().loadProject({ ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((track) => track.id === trackId ? { ...track, locked: true } : track) } });
    state().actionHistory.clear();
    render(<ClipTransitionSection clipId={clip.id} />);
    choose("entry", "Fade");
    fireEvent.click(screen.getByRole("button", { name: "Apply Entry/Exit Animations" }));
    expect(state().getClip(clip.id)?.keyframes).toEqual([]);
    expect(state().canUndo()).toBe(false);
  });
});
