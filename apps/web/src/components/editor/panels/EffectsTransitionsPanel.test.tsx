import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffectsPanel, TransitionsPanel } from "./EffectsTransitionsPanel";
import { type Clip } from "@openreel/core";
import { useUIStore } from "../../../stores/ui-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { useProjectStore } from "../../../stores/project-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";

beforeEach(() => {
  useProjectStore.getState().createNewProject("Transition catalog QA");
  useEditorWorkspaceStore.getState().setTransitionDuration(0.5);
  useUIStore.getState().clearSelection();
});

describe("effect library categories", () => {
  it("updates keying availability when selection changes and opens the actual inspector section", () => {
    const project = useProjectStore.getState().project;
    const track = project.timeline.tracks.find(
      (candidate) => candidate.name === "Main",
    )!;
    const clip = {
      id: "keying-target",
      trackId: track.id,
      mediaId: "media",
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      volume: 1,
      effects: [],
      audioEffects: [],
      keyframes: [],
      transform: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        anchor: { x: 0.5, y: 0.5 },
        rotation: 0,
        opacity: 1,
      },
    };
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((candidate) =>
            candidate.id === track.id
              ? { ...candidate, clips: [clip] }
              : candidate,
          ),
        },
      },
    });
    render(<EffectsPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Keying" }),
    );
    expect(
      screen.getByRole("button", { name: "Configure chroma key" }),
    ).toBeDisabled();
    act(() =>
      useUIStore
        .getState()
        .select({ type: "clip", id: clip.id, trackId: track.id }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Configure chroma key" }),
    );
    expect(useInspectorNavigationStore.getState().request).toMatchObject({
      sectionId: "chroma-key",
      clipId: clip.id,
    });
  });
});
afterEach(cleanup);
describe("transition library", () => {
  it("keeps used markers in sync with real transition edits, Undo and Redo", async () => {
    const initial = useProjectStore.getState().project;
    const track = initial.timeline.tracks.find(item => item.type === "video")!;
    const clip = (id: string, startTime: number): Clip => ({
      id, trackId: track.id, startTime, mediaId: "media", duration: 4, inPoint: 0, outPoint: 4,
      volume: 1, effects: [], audioEffects: [], keyframes: [],
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 },
        anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    });
    useProjectStore.setState({ project: { ...initial, timeline: { ...initial.timeline,
      tracks: initial.timeline.tracks.map(item => item.id === track.id
        ? { ...item, clips: [clip("a", 0), clip("b", 4)] } : item),
    } } });
    useUIStore.getState().select({ type: "clip", id: "a", trackId: track.id });
    render(<TransitionsPanel />);
    const card = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}\\. Drag`) });
    expect(screen.queryByLabelText("Used in timeline")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search transitions" }));
    fireEvent.click(card("Wipe Right"));
    expect(card("Wipe Right")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Apply Wipe Right to the cut" })).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(card("Wipe Right"), { key: "Enter" }));
    const transition = useProjectStore.getState().project.timeline.tracks
      .flatMap(item => item.transitions).find(item => item.clipAId === "a")!;
    expect(transition).toMatchObject({ type: "wipe", duration: 0.5, params: { direction: "right" } });
    expect(within(card("Wipe Right")).getByLabelText("Used in timeline")).toBeInTheDocument();
    expect(within(card("Wipe left")).queryByLabelText("Used in timeline")).toBeNull();
    await act(async () => { await useProjectStore.getState().updateClipTransition(transition.id,
      { params: { direction: "diagonal", softness: 0 } }); });
    expect(within(card("Wipe Right")).queryByLabelText("Used in timeline")).toBeNull();
    expect(within(card("Diagonal wipe")).getByLabelText("Used in timeline")).toBeInTheDocument();
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(within(card("Wipe Right")).getByLabelText("Used in timeline")).toBeInTheDocument();
    await act(async () => { expect((await useProjectStore.getState().redo()).success).toBe(true); });
    expect(within(card("Diagonal wipe")).getByLabelText("Used in timeline")).toBeInTheDocument();
    await act(async () => { expect(await useProjectStore.getState().removeClipTransition(transition.id)).toBe(true); });
    expect(screen.queryByLabelText("Used in timeline")).toBeNull();
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(within(card("Diagonal wipe")).getByLabelText("Used in timeline")).toBeInTheDocument();
    await act(async () => { await useProjectStore.getState().updateClipTransition(transition.id,
      { type: "zoom", params: { scale: 2, center: { y: 0.15, x: 0.15 } } }); });
    expect(within(card("Zoom Top Left")).getByLabelText("Used in timeline")).toBeInTheDocument();
    expect(within(card("Zoom Bottom Right")).queryByLabelText("Used in timeline")).toBeNull();
    await act(async () => {
      await useProjectStore.getState().removeClipTransition(transition.id);
      await useProjectStore.getState().addClipTransition({ ...transition, type: "wipe", params: {} });
    });
    expect(within(card("Wipe left")).getByLabelText("Used in timeline")).toBeInTheDocument();
    expect(within(card("Diagonal wipe")).queryByLabelText("Used in timeline")).toBeNull();
  });

  it("counts only the unlocked visual cuts that bulk apply will attempt", async () => {
    const initial = useProjectStore.getState().project;
    const makeClip = (id: string, trackId: string, startTime: number): Clip => ({
      id, trackId, startTime, mediaId: "media", duration: 1, inPoint: 0, outPoint: 1,
      volume: 1, effects: [], audioEffects: [], keyframes: [],
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 },
        anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    });
    const main = initial.timeline.tracks.find(track => track.name === "Main")!;
    const broll = initial.timeline.tracks.find(track => track.name === "B-roll")!;
    const tracks = initial.timeline.tracks.map(track => ({
      ...track,
      clips: track.id === main.id
        ? [makeClip("main-2", track.id, 2), makeClip("main-0", track.id, 0), makeClip("main-1", track.id, 1)]
        : track.id === broll.id
          ? [makeClip("broll-0", track.id, 0), makeClip("broll-1", track.id, 3)]
          : track.type === "audio"
            ? [makeClip(`${track.id}-0`, track.id, 0), makeClip(`${track.id}-1`, track.id, 1)] : [],
    }));
    useProjectStore.setState({ project: { ...initial, timeline: { ...initial.timeline, tracks } } });
    render(<TransitionsPanel />);
    expect(screen.getByRole("button", { name: "Apply Cross dissolve to all 2 cuts" })).toBeInTheDocument();
    act(() => useProjectStore.setState(state => ({ project: {
      ...state.project, timeline: { ...state.project.timeline,
        tracks: state.project.timeline.tracks.map(track => track.id === main.id ? { ...track, locked: true } : track),
      },
    } })));
    expect(screen.getByRole("button", { name: "Apply Cross dissolve to all cuts" })).toBeInTheDocument();
    act(() => useProjectStore.setState(state => ({ project: {
      ...state.project, timeline: { ...state.project.timeline,
        tracks: state.project.timeline.tracks.map(track => track.id === main.id ? { ...track, locked: false }
          : track.id === broll.id ? { ...track, clips: [makeClip("broll-0", track.id, 0), makeClip("broll-1", track.id, 1)] } : track),
      },
    } })));
    const button = screen.getByRole("button", { name: "Apply Cross dissolve to all 3 cuts" });
    const bridge = getTransitionBridge();
    const ready = vi.spyOn(bridge, "isInitialized").mockReturnValue(true);
    const create = vi.spyOn(bridge, "createTransition").mockReturnValue({ success: false, error: "Test rejection" });
    try {
      await act(async () => fireEvent.click(button));
      expect(create.mock.calls.map(([a, b]) => [a.id, b.id])).toEqual([
        ["broll-0", "broll-1"], ["main-0", "main-1"], ["main-1", "main-2"],
      ]);
    } finally { create.mockRestore(); ready.mockRestore(); }
  });
  it("commits the displayed default duration as seconds for drag and apply actions", () => {
    render(<TransitionsPanel />);
    const input = screen.getByRole("textbox", {
      name: "Default transition duration",
    });
    expect(input).toHaveValue("00:00:00:15");
    fireEvent.change(input, { target: { value: "00:00:01:00" } });
    fireEvent.blur(input);
    expect(useEditorWorkspaceStore.getState().transitionDuration).toBe(1);
  });
});

describe("custom transition presets", () => {
  it("lists the new built-in transitions under their categories", () => {
    render(<TransitionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Wipe", pressed: false }));
    for (const name of ["Iris Box", "Iris Cross", "Band Wipe", "Barn Door", "Clock Wipe", "Gradient Wipe"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}\\. Drag`) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Dissolve", pressed: false }));
    expect(screen.getByRole("button", { name: /^Film Dissolve\. Drag/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Additive Dissolve\. Drag/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Slide", pressed: false }));
    expect(screen.getByRole("button", { name: /^Cube Spin Left\. Drag/ })).toBeInTheDocument();
  });

  it("shows saved presets under Presets, carries their duration in the drag payload, and sets the default", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        transitionPresets: [
          { id: "tp1", name: "Green box", type: "irisBox", duration: 1.25, params: { feather: 0.25, borderWidth: 10, borderColor: "#00ff00" }, createdAt: 1 },
        ],
      },
    });
    render(<TransitionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Presets", pressed: false }));
    const card = screen.getByRole("button", { name: /^Green box\. Drag/ });
    const data: Record<string, string> = {};
    fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "", setData: (type: string, value: string) => { data[type] = value; } } });
    expect(JSON.parse(data["application/x-openreel-transition"]!)).toMatchObject({
      transitionType: "irisBox",
      transitionDuration: 1.25,
      transitionParams: { feather: 0.25, borderColor: "#00ff00" },
    });
    expect(screen.getByText(/Default: Cross dissolve/)).toBeInTheDocument();
    fireEvent.click(card);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Set Green box as default transition" })));
    await vi.waitFor(() => expect(useProjectStore.getState().project.defaultTransition).toMatchObject({ type: "irisBox", duration: 1.25, label: "Green box", presetId: "tp1" }));
    await vi.waitFor(() => expect(screen.getByText(/Default: Green box/)).toBeInTheDocument());
  });
});

