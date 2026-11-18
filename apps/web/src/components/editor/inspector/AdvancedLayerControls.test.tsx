import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, type Clip, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { AdjustmentLayerSection } from "./AdjustmentLayerSection";
import { NestedSequenceSection } from "./NestedSequenceSection";

const state = () => useProjectStore.getState();
const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const makeClip = (id: string, startTime: number): Clip => ({
  id,
  mediaId: id,
  trackId: "track",
  startTime,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  transform,
  effects: [],
  audioEffects: [],
  volume: 1,
  keyframes: [],
});
beforeEach(() => {
  const base = createEmptyProject("Advanced UI");
  const project: Project = {
    ...base,
    timeline: {
      ...base.timeline,
      duration: 4,
      tracks: [
        {
          id: "track",
          name: "Video",
          type: "video",
          clips: [makeClip("a", 0), makeClip("b", 2)],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project,
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
  });
  useUIStore.setState({
    selectedItems: [],
    lastSelectedItem: null,
    effectApplicationClipId: null,
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  useTimelineStore.setState({ playbackLockedReason: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function selectSources() {
  act(() =>
    useUIStore.getState().selectMultiple([
      { id: "a", type: "clip" },
      { id: "b", type: "clip" },
    ]),
  );
}
async function createCompound() {
  selectSources();
  fireEvent.click(screen.getByRole("button", { name: "Create Compound Clip" }));
  await waitFor(() => expect(state().project.nestedInstances).toHaveLength(1));
  await waitFor(() =>
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([
      state().project.nestedInstances![0].id,
    ]),
  );
  return state().project.nestedInstances![0];
}

describe("direct shadcn adjustment controls", () => {
  it("retains exact keyboard opacity, fractional input and individual effect removal", async () => {
    render(<AdjustmentLayerSection clipId="a" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add Adjustment Layer" }),
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Opacity" }), {
      key: "Home",
    });
    expect(state().project.adjustmentLayers?.[0].opacity).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "+ Contrast" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Contrast value" }),
    );
    const input = screen.getByRole("textbox", { name: "Contrast value" });
    fireEvent.change(input, { target: { value: "1.23" } });
    fireEvent.blur(input);
    expect(state().project.adjustmentLayers?.[0].effects[0].params.value).toBe(
      1.23,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Disable Contrast effect" }),
    );
    expect(state().project.adjustmentLayers?.[0].effects[0].enabled).toBe(
      false,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Contrast effect" }),
    );
    expect(state().project.adjustmentLayers?.[0].effects).toEqual([]);
    await act(async () => {
      await state().undo();
    });
    expect(state().project.adjustmentLayers?.[0].effects[0]).toMatchObject({
      enabled: false,
      params: { value: 1.23 },
    });
  });
  it("creates independent duplicates, supports Hide and deletes only the selected layer", async () => {
    render(<AdjustmentLayerSection clipId="a" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add Adjustment Layer" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Brightness" }));
    const originalId = state().project.adjustmentLayers![0].id;
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(state().project.adjustmentLayers).toHaveLength(2);
    expect(state().project.adjustmentLayers?.[0].effects[0].id).not.toBe(
      state().project.adjustmentLayers?.[1].effects[0].id,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Hide layer" })[1]);
    expect(state().project.adjustmentLayers?.[1].enabled).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(state().project.adjustmentLayers).toHaveLength(1);
    expect(state().project.adjustmentLayers?.[0].id).toBe(originalId);
    await act(async () => {
      await state().undo();
    });
    expect(state().project.adjustmentLayers).toHaveLength(2);
  });
  it("disables source mutations while the track is locked", () => {
    const project = state().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) => ({
            ...track,
            locked: true,
          })),
        },
      },
    });
    render(<AdjustmentLayerSection clipId="a" />);
    expect(
      screen.getByRole("button", { name: "Add Adjustment Layer" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Add Adjustment Layer" }),
    );
    expect(state().project.adjustmentLayers).toBeUndefined();
  });
});

function SelectedInspector() {
  const project = useProjectStore((state) => state.project);
  const selected = useUIStore((state) => state.selectedItems);
  const clipId = selected[0]?.id ?? "a";
  return project.timeline.tracks.some((track) =>
    track.clips.some((clip) => clip.id === clipId),
  ) ? (
    <NestedSequenceSection clipId={clipId} />
  ) : null;
}
describe("direct shadcn nested controls", () => {
  it("selects restored clips when flattening unmounts the deleted instance inspector", async () => {
    const view = render(<NestedSequenceSection clipId="a" />);
    await createCompound();
    view.unmount();
    render(<SelectedInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Flatten" }));
    await waitFor(() =>
      expect(state().project.nestedInstances).toHaveLength(0),
    );
    await waitFor(() =>
      expect(useUIStore.getState().getSelectedClipIds()).toHaveLength(2),
    );
    for (const id of useUIStore.getState().getSelectedClipIds())
      expect(
        state().project.timeline.tracks.some((track) =>
          track.clips.some((clip) => clip.id === id),
        ),
      ).toBe(true);
  });
  it("retains create, library rename, duplicate, protected delete and flatten", async () => {
    const view = render(<NestedSequenceSection clipId="a" />);
    const instance = await createCompound();
    view.rerender(<NestedSequenceSection clipId={instance.id} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Compound Clip 1" }),
    );
    expect(
      screen.getByRole("button", { name: "Cannot delete - has instances" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Rename Compound Clip 1" }),
    );
    const input = screen.getByRole("textbox", { name: "Compound clip name" });
    fireEvent.change(input, { target: { value: "  Opening  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(state().project.compoundClips?.[0].name).toBe("Opening"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Compound clip name" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Opening" }));
    await waitFor(() => expect(state().project.compoundClips).toHaveLength(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Delete Opening (Copy)" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Opening (Copy)" }),
    );
    await waitFor(() => expect(state().project.compoundClips).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Flatten" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Flatten" }));
    await waitFor(() =>
      expect(state().project.nestedInstances).toHaveLength(0),
    );
    await waitFor(() =>
      expect(useUIStore.getState().getSelectedClipIds()).toHaveLength(2),
    );
    expect(state().project.timeline.tracks[0].clips).toHaveLength(2);
  });
});
