import { describe, expect, it } from "vitest";
import type {
  MotionComposition,
  MotionLayer,
  MotionShaderEffect,
  MotionShapeLayer,
} from "@openreel/core";
import {
  addMotionTextAnimator,
  createDefaultMotionShaderFill,
  createMotionTextAnimator,
} from "@openreel/core";
import type { MotionTextAnimator, MotionTextLayer } from "@openreel/core";
import { createMotionLayerOfType } from "../motion-layer-factory";
import {
  compositionHasMotionShaderLayers,
  layerUsesRendererPreview,
  shouldUseRendererBackedStagePreview,
} from "../stage-preview-mode";

const composition: MotionComposition = {
  id: "scene",
  name: "scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
};

const shaderEffect: MotionShaderEffect = {
  id: "effect-shader",
  type: "shader",
  name: "Dither",
  enabled: true,
  shaderId: "dither",
  params: { levels: 4, scale: 1 },
};

function plainTextLayer(): MotionLayer {
  return createMotionLayerOfType(composition, "text", { id: "text-1" });
}

function shaderTextLayer(): MotionLayer {
  return { ...plainTextLayer(), id: "text-shader", effects: [shaderEffect] };
}

function shaderAnimatorTextLayer(): MotionLayer {
  const animator: MotionTextAnimator = {
    ...createMotionTextAnimator("text-reveal-up"),
    shader: { shaderId: "glyph-dissolve", params: { edgeWidth: 0.2 } },
  };
  return addMotionTextAnimator(
    plainTextLayer() as MotionTextLayer,
    animator,
  );
}

function scene3dLayer(): MotionLayer {
  return createMotionLayerOfType(composition, "scene3d", { id: "scene3d-1" });
}

function shaderFillShapeLayer(): MotionLayer {
  const shape = createMotionLayerOfType(composition, "shape", {
    id: "shape-shader-fill",
  }) as MotionShapeLayer;
  return {
    ...shape,
    style: { ...shape.style, fill: createDefaultMotionShaderFill("liquid-metal") },
  };
}

describe("layerUsesRendererPreview", () => {
  it("returns true for a layer with an enabled shader effect", () => {
    expect(layerUsesRendererPreview(shaderTextLayer())).toBe(true);
  });

  it("returns true for a shape layer with a shader fill", () => {
    expect(layerUsesRendererPreview(shaderFillShapeLayer())).toBe(true);
  });

  it("returns true for a text layer with a shader animator", () => {
    expect(layerUsesRendererPreview(shaderAnimatorTextLayer())).toBe(true);
  });

  it("returns true for a scene3d layer (unchanged)", () => {
    expect(layerUsesRendererPreview(scene3dLayer())).toBe(true);
  });

  it("returns false for a plain text layer with no shader effect", () => {
    expect(layerUsesRendererPreview(plainTextLayer())).toBe(false);
  });

  it("ignores a disabled shader effect", () => {
    const layer: MotionLayer = {
      ...plainTextLayer(),
      effects: [{ ...shaderEffect, enabled: false }],
    };
    expect(layerUsesRendererPreview(layer)).toBe(false);
  });
});

describe("compositionHasMotionShaderLayers", () => {
  it("forces the renderer-backed preview even in draft mode for shader layers", () => {
    const scene: MotionComposition = {
      ...composition,
      layers: [shaderTextLayer()],
    };
    expect(compositionHasMotionShaderLayers(scene)).toBe(true);
    expect(
      shouldUseRendererBackedStagePreview(scene, [scene], {
        mode: "draft",
        resolution: "quarter",
      }),
    ).toBe(true);
  });

  it("forces the renderer-backed preview for a text shader animator layer", () => {
    const scene: MotionComposition = {
      ...composition,
      layers: [shaderAnimatorTextLayer()],
    };
    expect(compositionHasMotionShaderLayers(scene)).toBe(true);
    expect(
      shouldUseRendererBackedStagePreview(scene, [scene], {
        mode: "draft",
        resolution: "quarter",
      }),
    ).toBe(true);
  });

  it("leaves a plain composition on the editable DOM path in draft mode", () => {
    const scene: MotionComposition = {
      ...composition,
      layers: [plainTextLayer()],
    };
    expect(compositionHasMotionShaderLayers(scene)).toBe(false);
    expect(
      shouldUseRendererBackedStagePreview(scene, [scene], {
        mode: "draft",
        resolution: "quarter",
      }),
    ).toBe(false);
  });
});
