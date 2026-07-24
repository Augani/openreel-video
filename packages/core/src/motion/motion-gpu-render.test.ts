import { describe, expect, it } from "vitest";
import {
  MotionHighQualityRenderer,
  compositionRequiresCanvas2dCompositing,
  parseMotionBackgroundColor,
} from "./motion-gpu-render";
import { MotionGpuCompositor } from "./motion-gpu-compositor";
import { DEFAULT_MOTION_TRANSFORM, type MotionComposition, type MotionLayer } from "./types";

const shapeLayer = (overrides: Partial<MotionLayer> = {}): MotionLayer =>
  ({
    id: "layer-1",
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: {
      fill: { type: "solid", color: "#ffffff", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
    ...overrides,
  }) as MotionLayer;

const composition = (layers: MotionLayer[]): MotionComposition => ({
  id: "comp-1",
  name: "Comp",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#000000",
  layers,
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("parseMotionBackgroundColor", () => {
  it("returns transparent for empty input", () => {
    expect(parseMotionBackgroundColor(undefined)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseMotionBackgroundColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("parses 6 and 8 digit hex colors", () => {
    expect(parseMotionBackgroundColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    const half = parseMotionBackgroundColor("#00000080");
    expect(half?.a).toBeCloseTo(128 / 255, 5);
  });

  it("parses shorthand hex and rgb/rgba", () => {
    expect(parseMotionBackgroundColor("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    const rgba = parseMotionBackgroundColor("rgba(255, 0, 0, 0.5)");
    expect(rgba?.r).toBe(1);
    expect(rgba?.g).toBe(0);
    expect(rgba?.a).toBe(0.5);
  });

  it("returns null for unsupported color formats", () => {
    expect(parseMotionBackgroundColor("hsl(200, 50%, 50%)")).toBeNull();
    expect(parseMotionBackgroundColor("not-a-color")).toBeNull();
  });
});

describe("compositionRequiresCanvas2dCompositing", () => {
  it("is false for plain shape/text/image stacks", () => {
    expect(
      compositionRequiresCanvas2dCompositing(composition([shapeLayer()])),
    ).toBe(false);
  });

  it("is true when a root adjustment layer is present", () => {
    const adjustment = shapeLayer({ id: "adj", type: "adjustment" });
    expect(
      compositionRequiresCanvas2dCompositing(composition([shapeLayer(), adjustment])),
    ).toBe(true);
  });

  it("is true when a root layer uses a track matte", () => {
    const matted = shapeLayer({
      id: "matted",
      trackMatte: { sourceLayerId: "layer-1", type: "alpha", enabled: true },
    });
    expect(
      compositionRequiresCanvas2dCompositing(composition([shapeLayer(), matted])),
    ).toBe(true);
  });
});

describe("MotionHighQualityRenderer GPU gating", () => {
  it("reports GPU unsupported in the node test environment", () => {
    expect(MotionGpuCompositor.isSupported()).toBe(false);
  });

  it("never selects the GPU path without WebGPU support", () => {
    const renderer = new MotionHighQualityRenderer();
    expect(renderer.canUseGpu(composition([shapeLayer()]), true)).toBe(false);
    expect(renderer.canUseGpu(composition([shapeLayer()]), false)).toBe(false);
  });
});
