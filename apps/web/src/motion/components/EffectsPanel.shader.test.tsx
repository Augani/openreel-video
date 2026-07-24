import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DEFAULT_MOTION_TRANSFORM,
  MOTION_EFFECT_PRESETS,
  createMotionEffect,
  getMotionEffectKeyframeProperty,
  type MotionComposition,
  type MotionShaderEffect,
  type MotionTextLayer,
} from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { EffectsPanel, MOTION_EFFECT_VARIANTS } from "./EffectsPanel";

const LAYER_ID = "layer-text";
const COMP_ID = "comp-shader";

function textLayer(): MotionTextLayer {
  return {
    id: LAYER_ID,
    type: "text",
    name: "Headline",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "Hello",
    style: {
      fontFamily: "Inter",
      fontSize: 64,
      color: "#ffffff",
    },
  };
}

function composition(): MotionComposition {
  return {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [textLayer()],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function twoLayerComposition(): MotionComposition {
  const first = textLayer();
  return {
    ...composition(),
    layers: [
      first,
      {
        ...first,
        id: "layer-text-2",
        name: "Subhead",
        text: "World",
      },
    ],
  };
}

function storedComposition(): MotionComposition {
  const project = useProjectStore.getState().project;
  const found = (project.motionCompositions ?? []).find(
    (entry) => entry.id === COMP_ID,
  );
  if (!found) throw new Error("composition not stored");
  return found;
}

function storedShaderEffect(): MotionShaderEffect | undefined {
  const layer = storedComposition().layers[0];
  const effect = (layer.effects ?? []).find((entry) => entry.type === "shader");
  return effect as MotionShaderEffect | undefined;
}

describe("EffectsPanel shader effects", () => {
  beforeEach(() => {
    const project = {
      ...createEmptyProject("Shader effects test"),
      motionCompositions: [composition()],
    };
    useProjectStore.setState({ hasOpenProject: true, project });
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID],
      playhead: 0,
      autoKeyframe: false,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("adds a Dither shader effect to the selected layer via the store", async () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Preview and apply Dither" }),
    );

    await waitFor(() => {
      const effect = storedShaderEffect();
      expect(effect).toBeDefined();
      expect(effect?.shaderId).toBe("dither");
    });

    const effect = storedShaderEffect();
    expect(effect?.params).toEqual({ levels: 4, scale: 1 });
  });

  it("renders the levels param control and writes params.levels on change", async () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Preview and apply Dither" }),
    );
    await waitFor(() => expect(storedShaderEffect()).toBeDefined());

    cleanup();
    render(<EffectsPanel composition={storedComposition()} />);

    const levelsLabel = screen
      .getAllByText("Levels")
      .map((node) => node.closest(".astryx-field") as HTMLElement | null)
      .find(
        (field): field is HTMLElement =>
          field !== null && within(field).queryByRole("spinbutton") !== null,
      );
    expect(levelsLabel).toBeDefined();

    const levelsControl = within(levelsLabel!).getByRole("spinbutton");
    expect(levelsControl).toHaveAttribute("max", "16");
    expect(levelsControl).toHaveAttribute("min", "2");

    fireEvent.change(levelsControl, { target: { value: "8" } });

    await waitFor(() => {
      expect(storedShaderEffect()?.params.levels).toBe(8);
    });
  });

  it("groups shader effects by collection and adds a Paper effect", async () => {
    render(<EffectsPanel composition={composition()} />);

    expect(screen.getAllByText(/Built-in/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paper/).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Preview and apply Halftone Dots",
      }),
    );

    await waitFor(() => {
      const effect = storedShaderEffect();
      expect(effect).toBeDefined();
      expect(effect?.shaderId).toBe("paper-halftone-dots");
    });
  });

  it("renders a visual preview for every standard effect before selection", () => {
    render(<EffectsPanel composition={composition()} />);

    const standardEffectCount = MOTION_EFFECT_PRESETS.filter(
      (preset) =>
        preset.type !== "slider-control" &&
        preset.type !== "checkbox-control" &&
        preset.type !== "angle-control",
    ).length;

    const previews = screen.getAllByTestId("motion-effect-preview");
    expect(previews).toHaveLength(
      standardEffectCount + MOTION_EFFECT_VARIANTS.length,
    );
    expect(
      previews.some((preview) => preview.dataset.effectType === "displace"),
    ).toBe(true);
  });

  it("adds curated visual presets with their authored parameters", async () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Neon Glow" }));

    await waitFor(() => {
      const effect = storedComposition().layers[0]?.effects?.[0];
      expect(effect).toMatchObject({
        type: "glow",
        name: "Neon Glow",
        color: "#ec4899",
        intensity: 0.9,
        radius: 64,
      });
    });
  });

  it("offers production-ready stylized variants with useful defaults", async () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Pixel Art" }));

    await waitFor(() => {
      expect(storedComposition().layers[0]?.effects?.[0]).toMatchObject({
        type: "mosaic",
        name: "Pixel Art",
        blockSize: 18,
      });
    });
  });

  it("adds previewed effects to every selected motion layer", async () => {
    const multiComposition = twoLayerComposition();
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        motionCompositions: [multiComposition],
      },
    }));
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID, "layer-text-2"],
    });
    render(<EffectsPanel composition={multiComposition} />);

    expect(
      screen.getByText("New effects will be added to all 2 selected layers."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Neon Glow" }));

    await waitFor(() => {
      const layers = storedComposition().layers;
      expect(layers.map((layer) => layer.effects?.[0]?.type)).toEqual([
        "glow",
        "glow",
      ]);
      expect(layers[0]?.effects?.[0]?.id).not.toBe(
        layers[1]?.effects?.[0]?.id,
      );
    });
  });

  it("replaces effect stacks across the selected motion layers", async () => {
    const baseComposition = twoLayerComposition();
    const sourceGlow = createMotionEffect("glow", "source-glow");
    if (sourceGlow.type !== "glow") throw new Error("Expected glow effect");
    const multiComposition: MotionComposition = {
      ...baseComposition,
      layers: [
        {
          ...baseComposition.layers[0],
          effects: [
            {
              ...sourceGlow,
              color: "#22d3ee",
              intensity: 0.82,
            },
          ],
        },
        {
          ...baseComposition.layers[1],
          effects: [createMotionEffect("blur", "old-blur")],
        },
      ],
    };
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        motionCompositions: [multiComposition],
      },
    }));
    useMotionStore.setState({
      selectedLayerId: LAYER_ID,
      selectedLayerIds: [LAYER_ID, "layer-text-2"],
    });
    render(<EffectsPanel composition={multiComposition} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste replace" }));

    await waitFor(() => {
      const layers = storedComposition().layers;
      expect(layers.map((layer) => layer.effects?.[0]?.type)).toEqual([
        "glow",
        "glow",
      ]);
      expect(layers[1]?.effects?.[0]).toMatchObject({
        color: "#22d3ee",
        intensity: 0.82,
      });
      expect(layers[0]?.effects?.[0]?.id).not.toBe(
        layers[1]?.effects?.[0]?.id,
      );
    });
  });

  it("filters visual effect previews by search and production category", () => {
    render(<EffectsPanel composition={composition()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search standard effects" }), {
      target: { value: "chromatic" },
    });
    expect(screen.getByRole("button", { name: "Add Chromatic Aberration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add CRT Split" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Gaussian Blur" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("motion-effect-preview")).toHaveLength(2);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search standard effects" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Color" }));

    expect(screen.getByRole("button", { name: "Add Threshold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Vignette" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Turbulent Displace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Color" })).toHaveAttribute("aria-pressed", "true");
  });

  it("copies and pastes an animated effect stack with new identities", async () => {
    const source = composition();
    const sourceLayer = source.layers[0] as MotionTextLayer;
    const animated = {
      ...sourceLayer,
      effects: [createMotionEffect("blur", "source-blur")],
      keyframes: [{
        id: "source-blur-key",
        time: 1,
        property: getMotionEffectKeyframeProperty("source-blur", "radius"),
        value: 18,
        easing: "linear" as const,
      }],
    };
    const animatedComposition = { ...source, layers: [animated] };
    useProjectStore.setState((state) => ({
      project: { ...state.project, motionCompositions: [animatedComposition] },
    }));

    render(<EffectsPanel composition={animatedComposition} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear stack" }));
    await waitFor(() => expect(storedComposition().layers[0]?.effects).toEqual([]));

    cleanup();
    render(<EffectsPanel composition={storedComposition()} />);
    fireEvent.click(screen.getByRole("button", { name: "Paste append" }));

    await waitFor(() => {
      const pasted = storedComposition().layers[0] as MotionTextLayer;
      expect(pasted.effects).toHaveLength(1);
      expect(pasted.effects?.[0]?.id).not.toBe("source-blur");
      expect(pasted.keyframes).toHaveLength(1);
      expect(pasted.keyframes[0]?.property).toBe(
        `effect.${pasted.effects?.[0]?.id}.radius`,
      );
    });
  });
});
