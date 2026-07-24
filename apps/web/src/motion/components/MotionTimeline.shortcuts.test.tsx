import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  createDefaultMotionCamera,
  createMotionLight,
  type MotionComposition,
  type MotionShapeLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { MotionTimeline } from "./MotionTimeline";

const LAYER_ID = "shortcut-layer";

function layer(): MotionShapeLayer {
  return {
    id: LAYER_ID,
    type: "shape",
    name: "Shortcut Layer",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [
      {
        id: "kf-1",
        property: "transform.position.x",
        time: 1,
        value: 120,
        easing: "ease",
      },
      {
        id: "kf-2",
        property: "transform.position.x",
        time: 3,
        value: 720,
        easing: "ease",
      },
    ],
    shapeType: "rectangle",
    width: 120,
    height: 120,
    style: {
      fill: { type: "solid", color: "#8b5cf6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
}

function composition(): MotionComposition {
  return {
    id: "shortcut-comp",
    name: "Shortcut Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "transparent",
    layers: [layer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function compositionWithCameraAndLight(): MotionComposition {
  const base = composition();
  const camera = createDefaultMotionCamera(base);
  const light = createMotionLight("point", base);
  return {
    ...base,
    layers: [
      {
        ...base.layers[0],
        masks: [
          {
            id: "mask-1",
            name: "Path Mask",
            enabled: true,
            shape: "path",
            mode: "add",
            inverted: false,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            rotation: 0,
            pathPoints: [
              { x: -50, y: -50 },
              { x: 50, y: -50 },
              { x: 0, y: 50 },
            ],
            pathKeyframes: [
              {
                id: "mask-kf",
                property: "mask.mask-1.path",
                time: 1.5,
                value: "M -50 -50 L 50 -50 L 0 50 Z",
                easing: "ease",
              },
            ],
          },
        ],
      },
    ],
    camera: {
      ...camera,
      enabled: true,
      keyframes: [
        {
          id: "camera-kf",
          property: "camera.zoom",
          time: 2,
          value: 125,
          easing: "ease",
        },
      ],
    },
    lights: [
      {
        ...light,
        id: "light-1",
        keyframes: [
          {
            id: "light-kf",
            property: "light.intensity",
            time: 2.5,
            value: 1.5,
            easing: "ease",
          },
        ],
      },
    ],
  };
}

function compositionWithAudio(): MotionComposition {
  return {
    ...composition(),
    audioClips: [
      {
        id: "audio-1",
        name: "Voiceover",
        mediaId: "media-1",
        startTime: 0.5,
        duration: 2.5,
        trimStart: 0.25,
        gain: 0.8,
      },
    ],
  };
}

function storedComposition(): MotionComposition {
  const stored = (useProjectStore.getState().project.motionCompositions ?? []).find(
    (candidate) => candidate.id === "shortcut-comp",
  );
  if (!stored) throw new Error("shortcut composition missing");
  return stored;
}

describe("MotionTimeline professional navigation shortcuts", () => {
  beforeEach(() => {
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Timeline shortcuts"),
        motionCompositions: [composition()],
      },
    });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      selectedKeyframeIds: [],
      selectedAudioClipId: null,
      selectedProperty: "transform.position.x",
      playhead: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("uses K and J to seek between adjacent keyframes", () => {
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "k" });
    expect(useMotionStore.getState().playhead).toBe(1);

    act(() => useMotionStore.setState({ playhead: 2 }));
    fireEvent.keyDown(window, { key: "j" });
    expect(useMotionStore.getState().playhead).toBe(1);
  });

  it("adds and removes composition markers at the playhead with M", async () => {
    act(() => useMotionStore.setState({ playhead: 1.25 }));
    const view = render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "m" });
    await waitFor(() => {
      expect(storedComposition().markers).toMatchObject([
        { time: 1.25, label: "Marker 1" },
      ]);
    });

    view.rerender(<MotionTimeline composition={storedComposition()} />);
    expect(
      screen.getByRole("button", { name: "Remove marker at playhead (M)" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "m" });

    await waitFor(() => expect(storedComposition().markers).toHaveLength(0));
  });

  it("seeks, renames, recolors, and deletes existing markers", async () => {
    const marked = {
      ...composition(),
      markers: [
        { id: "marker-1", time: 2.25, label: "Beat drop", color: "#3b82f6" },
      ],
    };
    useProjectStore.setState((state) => ({
      project: { ...state.project, motionCompositions: [marked] },
    }));
    render(<MotionTimeline composition={marked} />);

    fireEvent.click(screen.getByRole("button", { name: "Manage composition markers" }));
    fireEvent.click(await screen.findByRole("button", { name: "Seek to Beat drop" }));
    expect(useMotionStore.getState().playhead).toBe(2.25);

    const labelInput = screen.getByRole("textbox", { name: "Marker label for Beat drop" });
    fireEvent.change(labelInput, { target: { value: "Final hit" } });
    fireEvent.blur(labelInput);
    await waitFor(() =>
      expect(storedComposition().markers[0]?.label).toBe("Final hit"),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Color value" }), {
      target: { value: "#f97316" },
    });
    await waitFor(() =>
      expect(storedComposition().markers[0]?.color).toBe("#f97316"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Beat drop" }));
    await waitFor(() => expect(storedComposition().markers).toHaveLength(0));
  });

  it("selects a layer from its timeline name and opens properties", () => {
    useMotionStore.setState({
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedProperty: null,
      rightTab: "effects",
    });
    render(<MotionTimeline composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Select Shortcut Layer" }));

    expect(useMotionStore.getState()).toMatchObject({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      rightTab: "properties",
    });
  });

  it("steps by one frame or ten frames with Page Down", () => {
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "PageDown" });
    expect(useMotionStore.getState().playhead).toBeCloseTo(1 / 30, 8);

    fireEvent.keyDown(window, { key: "PageDown", shiftKey: true });
    expect(useMotionStore.getState().playhead).toBeCloseTo(11 / 30, 8);
  });

  it("does not capture shortcuts while typing in an input", () => {
    render(<MotionTimeline composition={composition()} />);
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "k" });
    expect(useMotionStore.getState().playhead).toBe(0);

    input.remove();
  });

  it("supports single and additive keyframe selection", () => {
    render(<MotionTimeline composition={composition()} />);
    const keyframes = screen.getAllByRole("button", {
      name: "Position X keyframe",
    });

    fireEvent.click(keyframes[0]);
    expect(useMotionStore.getState().selectedKeyframeIds).toEqual(["kf-1"]);
    expect(keyframes[0]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(keyframes[1], { metaKey: true });
    expect(new Set(useMotionStore.getState().selectedKeyframeIds)).toEqual(
      new Set(["kf-1", "kf-2"]),
    );
  });

  it("shows audio as a first-class timeline lane with mute and delete actions", async () => {
    const comp = compositionWithAudio();
    useProjectStore.setState({
      project: {
        ...createEmptyProject("Timeline audio"),
        motionCompositions: [comp],
      },
    });
    render(<MotionTimeline composition={comp} />);

    expect(
      screen.getByRole("button", { name: "Move audio clip Voiceover in time" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select audio clip Voiceover" }),
    );
    expect(useMotionStore.getState().selectedLayerId).toBeNull();
    expect(useMotionStore.getState().selectedAudioClipId).toBe("audio-1");
    expect(useMotionStore.getState().rightTab).toBe("sync");

    fireEvent.click(screen.getByRole("button", { name: "Mute audio clip" }));
    await waitFor(() => {
      expect(storedComposition().audioClips?.[0]?.muted).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete audio clip" }));
    await waitFor(() => {
      expect(storedComposition().audioClips).toHaveLength(0);
    });
    expect(useMotionStore.getState().selectedAudioClipId).toBeNull();
  });

  it("splits selected audio from the timeline toolbar", async () => {
    const comp = compositionWithAudio();
    useProjectStore.setState({
      project: {
        ...createEmptyProject("Timeline audio split"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({ playhead: 1.5 });
    render(<MotionTimeline composition={comp} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select audio clip Voiceover" }),
    );
    expect(screen.getAllByTitle("Voiceover").length).toBeGreaterThan(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Split selection at playhead" }),
    );

    await waitFor(() => {
      const clips = storedComposition().audioClips ?? [];
      expect(clips).toHaveLength(2);
      expect(clips[0]).toMatchObject({
        id: "audio-1",
        startTime: 0.5,
        duration: 1,
      });
      expect(clips[1]).toMatchObject({
        startTime: 1.5,
        duration: 1.5,
        trimStart: 1.25,
      });
    });
  });

  it("copies and pastes a selected audio clip at the playhead", async () => {
    const comp = compositionWithAudio();
    useProjectStore.setState({
      project: {
        ...createEmptyProject("Timeline audio clipboard"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({ playhead: 1 });
    render(<MotionTimeline composition={comp} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select audio clip Voiceover" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy timeline selection (⌘C)" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Paste at playhead (⌘V)" }),
    );

    await waitFor(() => {
      const clips = storedComposition().audioClips ?? [];
      expect(clips).toHaveLength(2);
      expect(clips[1]).toMatchObject({
        name: "Voiceover",
        startTime: 1,
        duration: 2.5,
        trimStart: 0.25,
        gain: 0.8,
      });
      expect(clips[1]?.id).not.toBe("audio-1");
    });
  });

  it("bulk deletes selected layer, camera, and light keyframes", async () => {
    const comp = compositionWithCameraAndLight();
    useProjectStore.setState({
      project: {
        ...createEmptyProject("Timeline keyframe deletion"),
        motionCompositions: [comp],
      },
    });
    useMotionStore.setState({
      selectedKeyframeIds: ["kf-1", "mask-kf", "camera-kf", "light-kf"],
    });
    render(<MotionTimeline composition={comp} />);

    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => {
      const stored = storedComposition();
      expect(stored.layers[0].keyframes.map((keyframe) => keyframe.id)).toEqual([
        "kf-2",
      ]);
      expect(stored.camera?.keyframes).toHaveLength(0);
      expect(stored.lights?.[0]?.keyframes).toHaveLength(0);
      expect(stored.layers[0].masks?.[0]?.pathKeyframes).toHaveLength(0);
    });
    expect(useMotionStore.getState().selectedKeyframeIds).toEqual([]);
  });

  it("nudges the selected keyframe group by frames with Alt+Arrow", async () => {
    useMotionStore.setState({
      selectedKeyframeIds: ["kf-1", "kf-2"],
      playhead: 1,
    });
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });

    await waitFor(() => {
      const times = storedComposition().layers[0].keyframes.map(
        (keyframe) => keyframe.time,
      );
      expect(times[0]).toBeCloseTo(1 + 1 / 30, 6);
      expect(times[1]).toBeCloseTo(3 + 1 / 30, 6);
    });
    expect(useMotionStore.getState().playhead).toBeCloseTo(1 + 1 / 30, 6);
  });

  it("duplicates selected keyframes to the playhead with Command+D", async () => {
    useMotionStore.setState({
      selectedKeyframeIds: ["kf-1", "kf-2"],
      playhead: 2,
    });
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "d", metaKey: true });

    await waitFor(() => {
      const keyframes = storedComposition().layers[0].keyframes;
      expect(keyframes.map((keyframe) => keyframe.time)).toEqual([1, 2, 3, 4]);
      const selectedCopies = useMotionStore.getState().selectedKeyframeIds;
      expect(selectedCopies).toHaveLength(2);
      expect(selectedCopies.every((id) => id.startsWith("motion-kf-"))).toBe(true);
    });
  });

  it("duplicates selected layers with Command+D when no keyframes are selected", async () => {
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "d", metaKey: true });

    await waitFor(() => {
      const stored = storedComposition();
      expect(stored.layers).toHaveLength(2);
      expect(stored.layers[1]?.name).toBe("Shortcut Layer Copy");
      expect(useMotionStore.getState().selectedLayerIds).toEqual([
        stored.layers[1]?.id,
      ]);
    });
  });

  it("copies and pastes selected layers at the playhead with Command+C/V", async () => {
    useMotionStore.setState({ playhead: 2 });
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "c", metaKey: true });
    fireEvent.keyDown(window, { key: "v", metaKey: true });

    await waitFor(() => {
      const stored = storedComposition();
      expect(stored.layers).toHaveLength(2);
      expect(stored.layers[1]).toMatchObject({
        name: "Shortcut Layer Copy",
        startTime: 2,
        transform: {
          position: {
            x: DEFAULT_MOTION_TRANSFORM.position.x,
            y: DEFAULT_MOTION_TRANSFORM.position.y,
          },
        },
      });
      expect(useMotionStore.getState().selectedLayerIds).toEqual([
        stored.layers[1]?.id,
      ]);
    });
  });

  it("copies and pastes selected keyframes at the playhead with Command+C/V", async () => {
    useMotionStore.setState({
      selectedKeyframeIds: ["kf-1"],
      playhead: 2,
    });
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "c", metaKey: true });
    fireEvent.keyDown(window, { key: "v", metaKey: true });

    await waitFor(() => {
      expect(
        storedComposition().layers[0].keyframes.map((keyframe) => keyframe.time),
      ).toEqual([1, 2, 3]);
      expect(useMotionStore.getState().selectedKeyframeIds).toHaveLength(1);
      expect(useMotionStore.getState().selectedKeyframeIds[0]).toMatch(
        /^motion-kf-/,
      );
    });
  });

  it("deletes selected unlocked layers without requiring canvas focus", async () => {
    render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => {
      expect(storedComposition().layers).toHaveLength(0);
    });
    expect(useMotionStore.getState().selectedLayerIds).toEqual([]);
  });

  it("trims selected layers to the playhead with Alt+bracket", async () => {
    useMotionStore.setState({ playhead: 1.5 });
    const { rerender } = render(<MotionTimeline composition={composition()} />);

    fireEvent.keyDown(window, { key: "[", altKey: true });

    await waitFor(() => {
      const stored = storedComposition().layers[0];
      expect(stored.startTime).toBe(1.5);
      expect(stored.duration).toBe(2.5);
    });

    const trimmed = storedComposition();
    rerender(<MotionTimeline composition={trimmed} />);
    act(() => useMotionStore.setState({ playhead: 3 }));
    fireEvent.keyDown(window, { key: "]", altKey: true });

    await waitFor(() => {
      expect(storedComposition().layers[0].duration).toBe(1.5);
    });
  });

  it("moves layer edges to the playhead with brackets and toggles lock with L", async () => {
    const movableComposition = { ...composition(), duration: 6 };
    useProjectStore.setState({
      project: {
        ...createEmptyProject("Timeline layer alignment"),
        motionCompositions: [movableComposition],
      },
    });
    useMotionStore.setState({ playhead: 1 });
    const { rerender } = render(
      <MotionTimeline composition={movableComposition} />,
    );

    fireEvent.keyDown(window, { key: "[" });

    await waitFor(() => {
      expect(storedComposition().layers[0].startTime).toBe(1);
    });

    const moved = storedComposition();
    rerender(<MotionTimeline composition={moved} />);
    fireEvent.keyDown(window, { key: "l" });

    await waitFor(() => {
      expect(storedComposition().layers[0].locked).toBe(true);
    });
  });
});
