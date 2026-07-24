import { describe, expect, it, vi } from "vitest";
import { MotionRenderer } from "./motion-renderer";
import { createMotionTextAnimator } from "./motion-text-animators";
import type { MotionTextLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

function createTextLayer(
  stroke?: MotionTextLayer["style"]["stroke"],
  withAnimator = false,
): MotionTextLayer {
  return {
    id: "layer-text",
    type: "text",
    name: "Text",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "AB",
    textAnimators: withAnimator ? [createMotionTextAnimator()] : undefined,
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      color: "#000000",
      stroke,
    },
  };
}

interface CallOrderCtx {
  order: string[];
  ctx: OffscreenCanvasRenderingContext2D;
}

function createOrderTrackingCtx(): CallOrderCtx {
  const order: string[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    fillText: vi.fn(() => order.push("fill")),
    strokeText: vi.fn(() => order.push("stroke")),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "miter" as CanvasLineJoin,
    textAlign: "center" as CanvasTextAlign,
    font: "",
    globalAlpha: 1,
  } as unknown as OffscreenCanvasRenderingContext2D;
  return { order, ctx };
}

type PrivateRenderer = {
  drawTextLine(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: MotionTextLayer,
    line: string,
    y: number,
    fillStyle: string,
  ): void;
  renderAnimatedText(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: MotionTextLayer,
    localTime: number,
  ): void;
};

describe("MotionRenderer text stroke — plain line path", () => {
  it("strokes before filling when stroke present without over", () => {
    const renderer = new MotionRenderer();
    const { order, ctx } = createOrderTrackingCtx();
    (renderer as unknown as PrivateRenderer).drawTextLine(
      ctx,
      createTextLayer({ color: "#ff0000", width: 4 }),
      "AB",
      0,
      "#000000",
    );
    expect(order).toEqual(["stroke", "fill"]);
    expect(ctx.lineWidth).toBe(8);
    expect(ctx.strokeStyle).toBe("#ff0000");
    expect(ctx.lineJoin).toBe("round");
  });

  it("strokes after filling when over is true", () => {
    const renderer = new MotionRenderer();
    const { order, ctx } = createOrderTrackingCtx();
    (renderer as unknown as PrivateRenderer).drawTextLine(
      ctx,
      createTextLayer({ color: "#ff0000", width: 4, over: true }),
      "AB",
      0,
      "#000000",
    );
    expect(order).toEqual(["fill", "stroke"]);
  });

  it("never strokes without a stroke style", () => {
    const renderer = new MotionRenderer();
    const { order, ctx } = createOrderTrackingCtx();
    (renderer as unknown as PrivateRenderer).drawTextLine(
      ctx,
      createTextLayer(undefined),
      "AB",
      0,
      "#000000",
    );
    expect(order).toEqual(["fill"]);
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it("does not stroke with non-finite or zero width", () => {
    const renderer = new MotionRenderer();
    const { order, ctx } = createOrderTrackingCtx();
    (renderer as unknown as PrivateRenderer).drawTextLine(
      ctx,
      createTextLayer({ color: "#ff0000", width: Number.NaN }),
      "AB",
      0,
      "#000000",
    );
    expect(order).toEqual(["fill"]);
  });
});

describe("MotionRenderer text stroke — per-glyph animated path", () => {
  it("strokes each glyph before filling", () => {
    const renderer = new MotionRenderer();
    const { order, ctx } = createOrderTrackingCtx();
    (renderer as unknown as PrivateRenderer).renderAnimatedText(
      ctx,
      createTextLayer({ color: "#00ff00", width: 3 }, true),
      0.5,
    );
    expect(order.length).toBeGreaterThan(0);
    expect(order[0]).toBe("stroke");
    expect(order).toContain("fill");
    order.forEach((entry, index) => {
      if (entry === "fill") {
        expect(order[index - 1]).toBe("stroke");
      }
    });
  });

  it("does not stroke glyphs without a stroke style", () => {
    const renderer = new MotionRenderer();
    const { order, ctx } = createOrderTrackingCtx();
    (renderer as unknown as PrivateRenderer).renderAnimatedText(
      ctx,
      createTextLayer(undefined, true),
      0.5,
    );
    expect(order).not.toContain("stroke");
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });
});
