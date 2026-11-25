import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WARP_SETTINGS, getWarpRegistry, type Clip, type Track, type WarpAnalysis } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { StabilizationSection } from "./StabilizationSection";
import { selectOption } from "../../../test/select-option";

const state = () => useProjectStore.getState();
const analysis: WarpAnalysis = { version: 4, fps: 30, startTime: 0, frameCount: 3, width: 96, height: 54, confidence: 1, motion: new Array(24).fill(0) };

const clip = (stabilization?: Clip["stabilization"]): Clip => ({
  id: "video", trackId: "main", mediaId: "source", startTime: 0, duration: 0.1, inPoint: 0, outPoint: 0.1,
  speed: 1, effects: [], audioEffects: [], keyframes: [], volume: 1, stabilization,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } },
});
const track = (clips: Clip[]): Track => ({ id: "main", type: "video", clips, name: "main", transitions: [], locked: false, hidden: false, muted: false, solo: false });

function load(stabilization?: Clip["stabilization"]): void {
  state().createNewProject("Stabilizer controls");
  const project = state().project;
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, duration: 0.1, tracks: [track([clip(stabilization)])] } } });
  state().actionHistory.clear();
  state().actionHistory.setAutoGroupWindow(0);
}

beforeEach(() => getWarpRegistry().setJob("video", { status: "idle" }));
afterEach(cleanup);

describe("Warp Stabilizer controls", () => {
  it("offers only the toggle until the clip is analysed", () => {
    load();
    render(<StabilizationSection clip={state().getClip("video")!} />);
    expect(screen.getByRole("switch", { name: "Enable Warp Stabilizer" })).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "Result" })).toBeNull();
  });

  it("switches Result, Method, Framing and Rolling Shutter as undoable edits and hides what does not apply", async () => {
    load({ enabled: true, strength: 50, cropMode: "auto", analyzed: false, warp: DEFAULT_WARP_SETTINGS, warpAnalysis: analysis });
    const { rerender } = render(<StabilizationSection clip={state().getClip("video")!} />);
    const refresh = () => rerender(<StabilizationSection clip={state().getClip("video")!} />);
    expect(screen.getByRole("slider", { name: /Smoothness/ })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /Crop Less/ })).toBeInTheDocument();

    await selectOption(screen.getByRole("combobox", { name: "Result" }), "No Motion");
    await waitFor(() => expect(state().getClip("video")?.stabilization?.warp?.result).toBe("noMotion"));
    refresh();
    expect(screen.queryByRole("slider", { name: /Smoothness/ })).toBeNull();

    await selectOption(screen.getByRole("combobox", { name: "Framing" }), "Stabilize, Synthesize Edges");
    await waitFor(() => expect(state().getClip("video")?.stabilization?.warp?.framing).toBe("synthesizeEdges"));
    refresh();
    expect(screen.queryByRole("slider", { name: /Crop Less/ })).toBeNull();

    await selectOption(screen.getByRole("combobox", { name: "Method" }), "Perspective");
    await selectOption(screen.getByRole("combobox", { name: "Rolling Shutter Ripple" }), "Enhanced Reduction");
    await waitFor(() => expect(state().getClip("video")?.stabilization?.warp).toMatchObject({ method: "perspective", rollingShutter: "enhanced" }));
    // the analysis stays, and each change undoes on its own
    expect(state().getClip("video")?.stabilization?.warpAnalysis).toEqual(analysis);
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.stabilization?.warp).toMatchObject({ method: "perspective", rollingShutter: "off" });
    await act(async () => { await state().undo(); });
    expect(state().getClip("video")?.stabilization?.warp).toMatchObject({ method: "positionScaleRotation", framing: "synthesizeEdges" });
  });

  it("shows the analysing badge with progress and a cancel button", () => {
    load();
    getWarpRegistry().setJob("video", { status: "analysing", progress: 0.42 });
    render(<StabilizationSection clip={state().getClip("video")!} />);
    const badge = screen.getByRole("status", { name: "Stabilizer status" });
    expect(badge).toHaveTextContent("Analysing in background");
    expect(badge).toHaveTextContent("42%");
    fireEvent.click(screen.getByRole("button", { name: "Cancel stabilizer analysis" }));
  });
});
