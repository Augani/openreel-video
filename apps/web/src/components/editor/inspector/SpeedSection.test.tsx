import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { SpeedSection } from "./SpeedSection";
import { selectOption } from "../../../test/select-option";

const state = () => useProjectStore.getState();
const clip = (id: string, trackId: string): Clip => ({
  id, trackId, mediaId: "source", startTime: 0, duration: 8, inPoint: 0, outPoint: 8,
  speed: 1, effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } },
});
const track = (id: string, type: Track["type"], clips: Clip[]): Track => ({
  id, type, clips, name: id, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
beforeEach(() => {
  state().createNewProject("Speed controls");
  const project = state().project;
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, duration: 8,
    tracks: [track("main", "video", [clip("video", "main")]), track("audio", "audio", [clip("audio", "audio")])],
  }, mediaLibrary: { items: [{ id: "source", name: "Source.mp4", type: "video", blob: null, fileHandle: null,
    thumbnailUrl: null, waveformData: null, metadata: { duration: 8, width: 640, height: 360, frameRate: 30,
      sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1 } }] } } });
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  state().actionHistory.clear();
  state().actionHistory.setAutoGroupWindow(0);
});
afterEach(cleanup);

describe("canonical speed controls", () => {
  it("updates linked audio with one Undo and refreshes the visible speed", async () => {
    render(<SpeedSection clip={state().getClip("video")!} />);
    fireEvent.click(screen.getByRole("button", { name: "Set speed to 2×" }));
    await waitFor(() => expect(state().getClip("audio")?.speed).toBe(2));
    expect(state().getClip("video")?.duration).toBe(4);
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.speed).toBe(1);
    expect(state().getClip("audio")?.speed).toBe(1);
    expect(screen.getByRole("textbox", { name: "Custom Speed" })).toHaveValue("1");
  });

  it("supports independent speed, smooth-motion quality and one Undo per setting", async () => {
    render(<SpeedSection clip={state().getClip("video")!} />);
    fireEvent.click(screen.getByRole("switch", { name: "Apply speed to audio" }));
    fireEvent.click(screen.getByRole("button", { name: "Set speed to 0.5×" }));
    await waitFor(() => expect(state().getClip("video")?.speed).toBe(.5));
    expect(state().getClip("audio")?.speed).toBe(1);
    fireEvent.click(screen.getByRole("switch", { name: "Smooth Slow Motion" }));
    await waitFor(() => expect(state().getClip("video")?.smoothSlowMo).toBe(true));
    await selectOption(screen.getByRole("combobox", { name: "Quality" }), "High (slower)");
    await waitFor(() => expect(state().getClip("video")?.interpolationQuality).toBe("high"));
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.interpolationQuality).toBeUndefined();
    expect(state().getClip("video")?.smoothSlowMo).toBe(true);
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.smoothSlowMo).toBeUndefined();
    expect(state().getClip("video")?.speed).toBe(.5);
  });

  it("serializes rapid presets and reverse clicks using the latest clip state", async () => {
    render(<SpeedSection clip={state().getClip("video")!} />);
    fireEvent.click(screen.getByRole("button", { name: "Set speed to 2×" }));
    fireEvent.click(screen.getByRole("button", { name: "Set speed to 0.5×" }));
    await waitFor(() => expect(state().getClip("audio")?.speed).toBe(.5));
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.speed).toBe(2);
    expect(state().getClip("audio")?.speed).toBe(2);
    const reverse = screen.getByRole("button", { name: "Reverse Clip" });
    fireEvent.click(reverse); fireEvent.click(reverse);
    await waitFor(() => expect(state().getClip("video")?.reversed).toBe(false));
    expect(state().getClip("audio")?.reversed).toBe(false);
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.reversed).toBe(true);
  });

  it("shows the custom speed with at most three decimals without changing the stored speed", () => {
    const project = state().project;
    const tracks = project.timeline.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.id === "video" ? { ...c, speed: 0.6060606 } : c) }));
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks } } });
    render(<SpeedSection clip={state().getClip("video")!} />);
    const field = screen.getByRole("textbox", { name: "Custom Speed" });
    expect(field).toHaveValue("0.606");
    fireEvent.focus(field);
    expect(field).toHaveValue("0.606");
    fireEvent.blur(field);
    expect(state().getClip("video")?.speed).toBe(0.6060606);
  });

  it("steps from the stored speed, not the rounded text, with the arrow keys", async () => {
    const project = state().project;
    const tracks = project.timeline.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.id === "video" ? { ...c, speed: 0.6060606 } : c) }));
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks } } });
    render(<SpeedSection clip={state().getClip("video")!} />);
    const field = screen.getByRole("textbox", { name: "Custom Speed" });
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: "ArrowUp" });
    await waitFor(() => expect(state().getClip("video")?.speed).toBeCloseTo(0.7060606, 6));
  });
});
