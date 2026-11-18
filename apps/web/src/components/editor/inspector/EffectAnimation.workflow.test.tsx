import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Clip, Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { VideoEffectsSection } from "./VideoEffectsSection";

const CLIP_ID = "anim-clip";

function makeProject(): Project {
  const empty = createEmptyProject("Effect animation");
  const clip: Clip = {
    id: CLIP_ID, mediaId: "media-1", trackId: "anim-track", startTime: 2, duration: 10, inPoint: 0, outPoint: 10,
    effects: [
      { id: "blur-a", type: "blur", enabled: true, params: { radius: 8, type: "gaussian" } },
      { id: "blur-b", type: "blur", enabled: true, params: { radius: 8, type: "gaussian" } },
    ],
    audioEffects: [], volume: 1, keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  };
  return {
    ...empty,
    timeline: {
      ...empty.timeline,
      duration: 12,
      tracks: [{ id: "anim-track", type: "video", name: "V1", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
    },
  } as unknown as Project;
}

const keyframes = () =>
  useProjectStore.getState().project.timeline.tracks[0]!.clips[0]!.keyframes;

describe("effect stopwatch and presets", () => {
  beforeEach(() => {
    useProjectStore.setState({ hasOpenProject: true, project: makeProject() });
    useProjectStore.getState().actionHistory.clear();
    useProjectStore.getState().actionHistory.setAutoGroupWindow(0);
    useTimelineStore.setState({ playheadPosition: 3, playbackLockedReason: null });
    useUIStore.setState((state) => ({ effectApplicationClipId: null, exportState: { ...state.exportState, isExporting: false } }));
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });

  it("animates one copy of an effect without touching the other, and undoes", async () => {
    render(<VideoEffectsSection clipId={CLIP_ID} />);
    const stopwatches = screen.getAllByRole("button", { name: "Animate Radius" });
    expect(stopwatches).toHaveLength(2);
    fireEvent.click(stopwatches[0]!);
    await waitFor(() => expect(keyframes()).toHaveLength(1));
    expect(keyframes()[0]).toMatchObject({ property: "fx:blur-a:radius", time: 1, value: 8 });
    expect(screen.getAllByRole("button", { name: "Animate Radius" })[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: "Animate Radius" })[1]).toHaveAttribute("aria-pressed", "false");

    await act(async () => { await useProjectStore.getState().undo(); });
    expect(keyframes()).toHaveLength(0);
  });

  it("adds, removes and navigates keyframes at the playhead; stopwatch off clears all", async () => {
    render(<VideoEffectsSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Animate Radius" })[0]!);
    await waitFor(() => expect(keyframes()).toHaveLength(1));

    act(() => useTimelineStore.setState({ playheadPosition: 6 }));
    fireEvent.click(screen.getByRole("button", { name: "Add Radius keyframe" }));
    await waitFor(() => expect(keyframes()).toHaveLength(2));
    expect(keyframes().map((k) => k.time).sort()).toEqual([1, 4]);

    act(() => useTimelineStore.setState({ playheadPosition: 5 }));
    fireEvent.click(screen.getByRole("button", { name: "Previous Radius keyframe" }));
    expect(useTimelineStore.getState().playheadPosition).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Next Radius keyframe" }));
    expect(useTimelineStore.getState().playheadPosition).toBe(6);

    fireEvent.click(screen.getByRole("button", { name: "Remove Radius keyframe" }));
    await waitFor(() => expect(keyframes()).toHaveLength(1));

    fireEvent.click(screen.getAllByRole("button", { name: "Animate Radius" })[0]!);
    await waitFor(() => expect(keyframes()).toHaveLength(0));
  });

  it("duplicating an animated effect copies its keyframes in one undo step", async () => {
    render(<VideoEffectsSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Animate Radius" })[0]!);
    await waitFor(() => expect(keyframes()).toHaveLength(1));
    useProjectStore.getState().actionHistory.clear();
    const dup = await useProjectStore.getState().duplicateVideoEffect(CLIP_ID, "blur-a");
    expect(dup).not.toBeNull();
    expect(keyframes().filter((k) => k.property === `fx:${dup!.id}:radius`)).toHaveLength(1);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(useProjectStore.getState().getVideoEffects(CLIP_ID)).toHaveLength(2);
    expect(keyframes()).toHaveLength(1);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("saves a preset, applies it to the stack, and survives a JSON round trip", async () => {
    render(<VideoEffectsSection clipId={CLIP_ID} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Animate Radius" })[0]!);
    await waitFor(() => expect(keyframes()).toHaveLength(1));

    fireEvent.click(screen.getByText(/Effect presets/));
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "Pulse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save effects as preset" }));
    await waitFor(() => expect(useProjectStore.getState().project.effectPresets).toHaveLength(1));
    const preset = useProjectStore.getState().project.effectPresets![0]!;
    expect(preset).toMatchObject({ name: "Pulse", timing: "relative" });
    expect(preset.keyframes).toHaveLength(1);
    expect(preset.effects).toHaveLength(2);

    const row = await screen.findByRole("listitem", { name: "Preset Pulse" });
    fireEvent.click(within(row).getByRole("button", { name: "Apply preset Pulse" }));
    await waitFor(() => expect(useProjectStore.getState().getVideoEffects(CLIP_ID)).toHaveLength(4));
    const ids = useProjectStore.getState().getVideoEffects(CLIP_ID).map((e) => e.id);
    expect(new Set(ids).size).toBe(4);
    expect(keyframes()).toHaveLength(2);

    const { exportEffectPresetsJson, importEffectPresetsJson } = await import("../../../services/effect-presets");
    const json = exportEffectPresetsJson();
    expect(json).not.toBeNull();
    const outcome = await importEffectPresetsJson(json!);
    expect(outcome.ok).toBe(true);
    expect(useProjectStore.getState().project.effectPresets).toHaveLength(2);
    expect((await importEffectPresetsJson("nope")).ok).toBe(false);
  });
});
