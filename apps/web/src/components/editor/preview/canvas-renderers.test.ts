import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawFrameWithTransform,
  getAnimatedTransform,
  renderShapeClipToCanvas,
  renderTextClipToCanvas,
} from "./canvas-renderers";
import { DEFAULT_TRANSFORM, type ClipTransform } from "./types";
import { titleEngine, type Keyframe, type SVGClip, type TextClip } from "@openreel/core";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAnimatedTransform", () => {
  const baseTransform: ClipTransform = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
    borderRadius: 0,
  };

  it("should return base transform when no keyframes", () => {
    const result = getAnimatedTransform(baseTransform, [], 0);
    expect(result).toEqual(baseTransform);
  });

  it("should return base transform when keyframes is undefined", () => {
    const result = getAnimatedTransform(baseTransform, undefined, 0);
    expect(result).toEqual(baseTransform);
  });

  it("should interpolate position keyframes", () => {
    const keyframes: Keyframe[] = [
      { id: "1", property: "position.x", time: 0, value: 0, easing: "linear" },
      { id: "2", property: "position.x", time: 1, value: 100, easing: "linear" },
    ];

    const result = getAnimatedTransform(baseTransform, keyframes, 0.5);
    expect(result.position.x).toBeCloseTo(50, 1);
  });

  it("should preserve transform position at time 0", () => {
    const customTransform: ClipTransform = {
      ...baseTransform,
      position: { x: 100, y: 50 },
    };

    const result = getAnimatedTransform(customTransform, [], 0);
    expect(result.position.x).toBe(100);
    expect(result.position.y).toBe(50);
  });

  it("should preserve transform position regardless of clipLocalTime when no keyframes", () => {
    const customTransform: ClipTransform = {
      ...baseTransform,
      position: { x: 200, y: 150 },
    };

    const times = [0, 0.5, 1, 2, 5, 10];
    for (const time of times) {
      const result = getAnimatedTransform(customTransform, [], time);
      expect(result.position.x).toBe(200);
      expect(result.position.y).toBe(150);
    }
  });
});

describe("drawFrameWithTransform crop fitting", () => {
  const createContext = () =>
    ({
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      clip: vi.fn(),
      globalAlpha: 1,
      filter: "none",
    }) as unknown as CanvasRenderingContext2D;

  const croppedTransform: ClipTransform = {
    ...DEFAULT_TRANSFORM,
    crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
  };

  it("honors cover using the cropped source aspect ratio", () => {
    const context = createContext();
    const frame = document.createElement("canvas");
    frame.width = 1920;
    frame.height = 1080;

    drawFrameWithTransform(
      context,
      frame,
      { ...croppedTransform, fitMode: "cover" },
      1080,
      1920,
    );

    const args = vi.mocked(context.drawImage).mock.calls[0];
    expect(args.slice(0, 5)).toEqual([frame, 480, 0, 960, 1080]);
    expect(args[5]).toBeCloseTo(-853.333, 3);
    expect(args[6]).toBe(-960);
    expect(args[7]).toBeCloseTo(1706.667, 3);
    expect(args[8]).toBe(1920);
  });

  it("honors stretch after cropping", () => {
    const context = createContext();
    const frame = document.createElement("canvas");
    frame.width = 1920;
    frame.height = 1080;

    drawFrameWithTransform(
      context,
      frame,
      { ...croppedTransform, fitMode: "stretch" },
      1080,
      1920,
    );

    expect(vi.mocked(context.drawImage)).toHaveBeenCalledWith(
      frame,
      480,
      0,
      960,
      1080,
      -540,
      -960,
      1080,
      1920,
    );
  });

  it("keeps lower layers visible around a scaled contained video frame", () => {
    const context = createContext();
    const videoFrame = document.createElement("canvas");
    videoFrame.width = 640;
    videoFrame.height = 480;

    drawFrameWithTransform(
      context,
      videoFrame,
      {
        ...DEFAULT_TRANSFORM,
        scale: { x: 0.6, y: 0.6 },
        fitMode: "contain",
      },
      1920,
      1080,
    );

    expect(vi.mocked(context.scale)).toHaveBeenCalledWith(0.6, 0.6);
    expect(vi.mocked(context.drawImage)).toHaveBeenCalledWith(
      videoFrame,
      -720,
      -540,
      1440,
      1080,
    );
  });
});

describe("text preview/export renderer parity", () => {
  it("routes Paper-shader text through the shared title renderer", () => {
    const renderedCanvas = document.createElement("canvas");
    const renderText = vi.spyOn(titleEngine, "renderText").mockReturnValue({
      canvas: renderedCanvas,
      width: 1920,
      height: 1080,
      textMetrics: { width: 100, height: 40, lines: [] },
    });
    const drawImage = vi.fn();
    const clip: TextClip = {
      id: "paper-text",
      trackId: "text-track",
      startTime: 2,
      duration: 5,
      text: "Paper title",
      style: {
        fontFamily: "Inter",
        fontSize: 72,
        fontWeight: 700,
        fontStyle: "normal",
        color: "#ffffff",
        textAlign: "center",
        verticalAlign: "middle",
        lineHeight: 1.2,
        letterSpacing: 0,
        shader: {
          shaderId: "paper-mesh-gradient",
          params: {
            color1: "#e0eaff",
            color2: "#241d9a",
          },
        },
      },
      transform: {
        position: { x: 0.5, y: 0.5 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      },
      keyframes: [],
    };

    renderTextClipToCanvas(
      { drawImage } as unknown as CanvasRenderingContext2D,
      clip,
      1920,
      1080,
      3.25,
    );

    expect(renderText).toHaveBeenCalledWith(clip, 1920, 1080, 1.25);
    expect(drawImage).toHaveBeenCalledWith(
      renderedCanvas,
      0,
      0,
      1920,
      1080,
    );
  });
});

describe("SVG graphic preview placement", () => {
  it("places an SVG clip at its exact sub-pixel position, as the export renderer does", () => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:stub";
    const translate = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate,
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const clip: SVGClip = {
      id: "subpixel-svg",
      trackId: "t",
      startTime: 0,
      duration: 4,
      type: "svg",
      svgContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      viewBox: { minX: 0, minY: 0, width: 10, height: 10 },
      transform: {
        position: { x: 0.5, y: 520 / 1080 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        opacity: 1,
      },
      keyframes: [],
    } as unknown as SVGClip;

    renderShapeClipToCanvas(ctx, clip, 1920, 1080, 1);

    expect(translate).toHaveBeenCalledTimes(1);
    const [x, y] = translate.mock.calls[0];
    expect(x).toBeCloseTo(960, 10);
    expect(y).toBeCloseTo(520, 10);
    renderShapeClipToCanvas(ctx, clip, 640, 360, 1);
    expect(translate.mock.calls[1][1]).toBeCloseTo(173.3333, 3);
  });
});
