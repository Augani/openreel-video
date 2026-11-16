import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip, Keyframe } from "@openreel/core";
import { PrimaryVideoProperties } from "./PrimaryVideoProperties";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

const original: Clip = {
  id: "video", trackId: "main", mediaId: "media", startTime: 10, duration: 10,
  inPoint: 0, outPoint: 10, volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: -24 }, scale: { x: 1.08, y: 1.08 },
    anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
};
const current = () => useProjectStore.getState().getClip(original.id)!;
function Inspector() {
  const clip = useProjectStore(s => s.project.timeline.tracks.flatMap(t => t.clips).find(c => c.id === original.id)!);
  return <PrimaryVideoProperties clipId={clip.id} transform={clip.transform}
    onTransformChange={changes => { void useProjectStore.getState().updateClipTransform(clip.id, changes); }} />;
}
function seedKeys(keyframes: Keyframe[]) {
  const store = useProjectStore.getState();
  store.updateClipKeyframes(original.id, keyframes);
  store.actionHistory.clear();
}
function edit(label: string, value: string) {
  const input = screen.getByRole("spinbutton", { name: label });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
beforeEach(() => {
  const store = useProjectStore.getState();
  store.createNewProject("Video inspector QA");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
    duration: 20, tracks: [{ id: "main", name: "Main", type: "video", clips: [structuredClone(original)],
      transitions: [], locked: false, hidden: false, muted: false, solo: false }] } } });
  useTimelineStore.setState({ playheadPosition: 12, playbackState: "stopped" });
});
afterEach(cleanup);

describe("primary video inspector", () => {
  it("writes keyframes in clip-local time, removes the same pair and supports Undo/Redo", async () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole("button", { name: "Add scale.x / scale.y keyframe" }));
    expect(current().keyframes).toEqual([
      expect.objectContaining({ time: 2, property: "scale.x", value: 1.08 }),
      expect.objectContaining({ time: 2, property: "scale.y", value: 1.08 }),
    ]);
    const animated = structuredClone(current().keyframes);
    fireEvent.click(screen.getByRole("button", { name: "Remove scale.x / scale.y keyframe" }));
    expect(current().keyframes).toEqual([]);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().keyframes).toEqual(animated);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(current().keyframes).toEqual([]);
  });

  it("does not create keyframes outside the selected clip", () => {
    render(<Inspector />);
    act(() => useTimelineStore.getState().seekTo(9));
    expect(screen.getByRole("button", { name: "Add rotation keyframe" })).toBeDisabled();
    act(() => useTimelineStore.getState().seekTo(20.1));
    expect(screen.getByRole("button", { name: "Add rotation keyframe" })).toBeDisabled();
    expect(current().keyframes).toEqual([]);
  });

  it("displays the interpolated scale and edits its current keyframe without overwriting the base transform", async () => {
    seedKeys([0, 10].flatMap(time => ["scale.x", "scale.y"].map(property => ({
      id: `${property}:${time}`, time, property, value: time ? 2 : 1, easing: "linear" as const,
    }))));
    useTimelineStore.setState({ playheadPosition: 15 });
    render(<Inspector />);
    expect(screen.getByRole("spinbutton", { name: "Scale" })).toHaveValue(150);
    const before = structuredClone(current());
    edit("Scale", "160");
    await waitFor(() => expect(current().keyframes.filter(k => k.time === 5)).toHaveLength(2));
    expect(current().keyframes.filter(k => k.time === 5)).toEqual([
      expect.objectContaining({ property: "scale.x", value: 1.6 }),
      expect.objectContaining({ property: "scale.y", value: 1.6 }),
    ]);
    expect(current().transform).toEqual(before.transform);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(before);
    expect(screen.getByRole("spinbutton", { name: "Scale" })).toHaveValue(150);
  });

  it("edits animated color at the local playhead and preserves the static effect", async () => {
    await useProjectStore.getState().addVideoEffect("video", "saturation", { value: 1.1 });
    seedKeys([{ id: "b0", property: "effect.saturation", time: 0, value: 1, easing: "linear" },
      { id: "b10", property: "effect.saturation", time: 10, value: 1.4, easing: "linear" }]);
    useTimelineStore.setState({ playheadPosition: 15 });
    render(<Inspector />);
    expect(screen.getByRole("spinbutton", { name: "Saturation value" })).toHaveValue(120);
    const before = structuredClone(current());
    edit("Saturation value", "130");
    await waitFor(() => expect(current().keyframes.find(k => k.time === 5)?.value).toBe(1.3));
    expect(current().effects).toEqual(before.effects);
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current()).toEqual(before);
  });

  it("keyframes color on the effect instance (fx:<id>:value) and edits that keyframe", async () => {
    const effect = await useProjectStore.getState().addVideoEffect("video", "saturation", { value: 1.1 });
    const property = `fx:${effect!.id}:value`;
    useProjectStore.getState().actionHistory.clear();
    render(<Inspector />);
    fireEvent.click(screen.getByRole("button", { name: `Add ${property} keyframe` }));
    expect(current().keyframes).toEqual([expect.objectContaining({ property, time: 2, value: 1.1 })]);
    edit("Saturation value", "130");
    await waitFor(() => expect(current().keyframes.find(k => k.time === 2)?.value).toBe(1.3));
    expect(current().keyframes.every(k => k.property === property)).toBe(true);
    expect(current().effects[0]?.params.value).toBe(1.1);
  });

  it("reads fx-keyed animation of a color instance at the playhead", async () => {
    const effect = await useProjectStore.getState().addVideoEffect("video", "saturation", { value: 1.1 });
    const property = `fx:${effect!.id}:value`;
    seedKeys([{ id: "b0", property, time: 0, value: 1, easing: "linear" },
      { id: "b10", property, time: 10, value: 1.4, easing: "linear" }]);
    useTimelineStore.setState({ playheadPosition: 15 });
    render(<Inspector />);
    expect(screen.getByRole("spinbutton", { name: "Saturation value" })).toHaveValue(120);
    edit("Saturation value", "130");
    await waitFor(() => expect(current().keyframes.find(k => k.time === 5)?.value).toBe(1.3));
    expect(current().keyframes.map(k => k.property)).toEqual([property, property, property]);
  });

  it("creates the effect instance when keyframing a color the clip has no effect for, in one Undo", async () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole("button", { name: "Add effect.saturation keyframe" }));
    await waitFor(() => expect(current().effects).toHaveLength(1));
    const id = current().effects[0]!.id;
    await waitFor(() => expect(current().keyframes.map(k => k.property)).toEqual([`fx:${id}:value`]));
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(current().effects).toEqual([]);
    expect(current().keyframes).toEqual([]);
  });

  it("shows a bypassed correction as neutral and reenables a real edit with one Undo", async () => {
    const store = useProjectStore.getState();
    const effect = await store.addVideoEffect("video", "saturation", { value: 1.4 });
    await store.toggleVideoEffect("video", effect!.id, false);
    store.actionHistory.clear();
    render(<Inspector />);
    expect(screen.getByRole("spinbutton", { name: "Saturation value" })).toHaveValue(100);
    const before = structuredClone(current());
    edit("Saturation value", "120");
    await waitFor(() => expect(current().effects[0]).toMatchObject({ enabled: true, params: { value: 1.2 } }));
    await act(async () => { await store.undo(); });
    expect(current()).toEqual(before);
  });

  it("no longer duplicates Exposure and Contrast, which Basic Correction owns", () => {
    render(<Inspector />);
    expect(screen.queryByRole("spinbutton", { name: "Exposure value" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Contrast value" })).toBeNull();
  });
});
