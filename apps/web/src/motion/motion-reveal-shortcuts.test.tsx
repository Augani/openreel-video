import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import type { MotionComposition, MotionLayer } from "@openreel/core";
import { StageCanvas } from "./components/StageCanvas";
import { useMotionStore } from "./stores/motion-store";
import { useProjectStore } from "../stores/project-store";
import { createMotionLayerOfType } from "./motion-layer-factory";

function baseComposition(layers: MotionLayer[]): MotionComposition {
  return {
    id: "c1",
    name: "S",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "#000",
    layers,
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function rectLayer(id: string): MotionLayer {
  return createMotionLayerOfType(baseComposition([]), "shape", { id });
}

function withScaleKeyframes(layer: MotionLayer): MotionLayer {
  return {
    ...layer,
    keyframes: [
      { id: "k1", property: "transform.scale.x", time: 0, value: 1, easing: "linear" },
      { id: "k2", property: "transform.scale.x", time: 2, value: 2, easing: "linear" },
    ],
  } as MotionLayer;
}

function mountStage(composition: MotionComposition): HTMLElement {
  useProjectStore.setState({
    project: {
      ...useProjectStore.getState().project,
      motionCompositions: [composition],
    },
  } as never);
  useMotionStore.setState({
    activeCompositionId: composition.id,
    selectedLayerId: composition.layers[0]?.id ?? null,
    selectedLayerIds: composition.layers[0] ? [composition.layers[0].id] : [],
    revealedProperties: null,
    activeTool: "select",
  } as never);
  const { container } = render(<StageCanvas composition={composition} />);
  const surface = container.querySelector<HTMLElement>(
    '[aria-label="Motion stage keyboard surface"]',
  );
  if (!surface) throw new Error("keyboard surface not found");
  surface.focus();
  return surface;
}

describe("motion reveal shortcuts", () => {
  beforeEach(() => {
    useMotionStore.setState({ revealedProperties: null } as never);
  });

  it("reveals position properties on P and clears on second P", () => {
    const layer = rectLayer("layer-1");
    const surface = mountStage(baseComposition([layer]));

    fireEvent.keyDown(surface, { key: "p" });
    expect(useMotionStore.getState().revealedProperties).toEqual({
      layerId: "layer-1",
      properties: ["transform.position.x", "transform.position.y"],
    });

    fireEvent.keyDown(surface, { key: "p" });
    expect(useMotionStore.getState().revealedProperties).toBeNull();
  });

  it("reveals keyframed properties on U", () => {
    const layer = withScaleKeyframes(rectLayer("layer-1"));
    const surface = mountStage(baseComposition([layer]));

    fireEvent.keyDown(surface, { key: "u" });
    expect(useMotionStore.getState().revealedProperties).toEqual({
      layerId: "layer-1",
      properties: ["transform.scale.x"],
    });
  });

  it("does not reveal while an input is focused", () => {
    const layer = rectLayer("layer-1");
    const surface = mountStage(baseComposition([layer]));
    const input = document.createElement("input");
    surface.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "p" });
    expect(useMotionStore.getState().revealedProperties).toBeNull();

    fireEvent.keyDown(surface, { key: "p" });
    expect(useMotionStore.getState().revealedProperties).toEqual({
      layerId: "layer-1",
      properties: ["transform.position.x", "transform.position.y"],
    });

    surface.removeChild(input);
  });

  it("switches active tool to select on V", () => {
    const layer = rectLayer("layer-1");
    const surface = mountStage(baseComposition([layer]));
    act(() => {
      useMotionStore.setState({ activeTool: "pen" } as never);
    });

    act(() => {
      fireEvent.keyDown(surface, { key: "v" });
    });
    expect(useMotionStore.getState().activeTool).toBe("select");
  });

  it("switches active tool to shape on Q", () => {
    const layer = rectLayer("layer-1");
    const surface = mountStage(baseComposition([layer]));

    act(() => {
      fireEvent.keyDown(surface, { key: "q" });
    });
    expect(useMotionStore.getState().activeTool).toBe("rectangle");
  });
});
