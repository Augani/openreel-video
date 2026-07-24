import { describe, expect, it, vi } from "vitest";
import { createMotionEffect } from "./motion-effects";
import { MotionRenderer } from "./motion-renderer";
import { getMotionLayerVisualBounds } from "./motion-masks";
import type {
  MotionAdjustmentLayer,
  MotionComposition,
  MotionEffect,
  MotionTransform,
} from "./types";
import {
  createMotionAdjustmentLayer,
  isMotionAdjustmentLayer,
} from "./motion-adjustment-layers";

describe("motion adjustment layers", () => {
  it("creates a composition-sized adjustment layer centered on the artboard", () => {
    const layer = createMotionAdjustmentLayer({
      id: "adjustment-1",
      duration: 8,
      compositionWidth: 1920,
      compositionHeight: 1080,
    });

    expect(layer).toMatchObject({
      id: "adjustment-1",
      type: "adjustment",
      name: "Adjustment Layer",
      startTime: 0,
      duration: 8,
      visible: true,
      locked: false,
      width: 1920,
      height: 1080,
      transform: {
        position: { x: 960, y: 540 },
      },
      effects: [],
    });
    expect(isMotionAdjustmentLayer(layer)).toBe(true);
  });

  it("supports effect stacks and mask bounds like other visual layers", () => {
    const layer = {
      ...createMotionAdjustmentLayer({
        id: "adjustment-1",
        duration: 5,
        compositionWidth: 1280,
        compositionHeight: 720,
      }),
      effects: [createMotionEffect("color-adjust", "color-1")],
    };

    expect(layer.effects).toHaveLength(1);
    expect(getMotionLayerVisualBounds(layer)).toEqual({
      x: -640,
      y: -360,
      width: 1280,
      height: 720,
    });
  });

  it("runs pixel and CSS effects on adjustment layers in authored order", () => {
    const calls: string[] = [];
    const makeContext = (canvas: { width: number; height: number }) =>
      new Proxy(
        {
          canvas,
          getImageData: () => {
            calls.push("pixel:read");
            return {
              data: new Uint8ClampedArray([80, 120, 160, 255]),
              width: 1,
              height: 1,
              colorSpace: "srgb",
            } as ImageData;
          },
          putImageData: () => calls.push("pixel:write"),
          drawImage: () => calls.push("draw"),
          clearRect: () => calls.push("clear"),
        } as Record<string, unknown>,
        {
          get(target, property: string) {
            if (property in target) return target[property];
            return () => undefined;
          },
          set(target, property: string, value) {
            target[property] = value;
            if (property === "filter" && value !== "none") {
              calls.push(`filter:${String(value)}`);
            }
            return true;
          },
        },
      ) as unknown as OffscreenCanvasRenderingContext2D;

    const mainCanvas = { width: 1, height: 1 };
    const bufferCanvas = { width: 1, height: 1 };
    const filteredCanvas = { width: 1, height: 1 };
    const mainContext = makeContext(mainCanvas);
    const bufferContext = makeContext(bufferCanvas);
    const filteredContext = makeContext(filteredCanvas);
    const renderer = new MotionRenderer();
    const tempCanvases = [
      { canvas: bufferCanvas, ctx: bufferContext },
      { canvas: filteredCanvas, ctx: filteredContext },
    ];
    (renderer as unknown as { createTempCanvas: () => unknown }).createTempCanvas =
      vi.fn(() => tempCanvases.shift());

    const composition = {
      id: "comp",
      name: "Comp",
      width: 1,
      height: 1,
      frameRate: 30,
      duration: 2,
      backgroundColor: "transparent",
      layers: [],
      assets: [],
      variables: [],
      markers: [],
      createdAt: 1,
      modifiedAt: 1,
    } as MotionComposition;
    const layer = createMotionAdjustmentLayer({
      id: "adjustment",
      duration: 2,
      compositionWidth: 1,
      compositionHeight: 1,
    });
    const effects: MotionEffect[] = [
      createMotionEffect("posterize", "posterize"),
      createMotionEffect("invert", "invert"),
    ];

    (
      renderer as unknown as {
        applyAdjustmentLayer(
          ctx: OffscreenCanvasRenderingContext2D,
          composition: MotionComposition,
          layer: MotionAdjustmentLayer,
          transform: MotionTransform,
          effects: readonly MotionEffect[],
          localTime: number,
          opacity: number,
        ): void;
      }
    ).applyAdjustmentLayer(
      mainContext,
      composition,
      layer,
      layer.transform,
      effects,
      0.5,
      1,
    );

    expect(calls.indexOf("pixel:read")).toBeLessThan(
      calls.indexOf("filter:invert(1)"),
    );
    expect(calls).toContain("pixel:write");
  });
});
