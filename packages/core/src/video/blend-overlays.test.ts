import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCanvas, type FakeContext } from "./__fixtures__/fake-canvas";
import { blendPixelBuffers, drawImageWithBlend, drawOverlayLayerWithBlend } from "./blend-reference";
import type { BlendMode } from "./types";
import type { Transform } from "../types/timeline";

const NEW_MODES: BlendMode[] = [
  "linear-burn",
  "darker-color",
  "lighter-color",
  "linear-light",
  "vivid-light",
  "pin-light",
  "hard-mix",
  "subtract",
  "divide",
  "dissolve",
];

const W = 24;
const H = 16;

/** A deterministic, varied backdrop / layer so every mode exercises different branches. */
function painted(seed: number, alpha = 255): FakeCanvas {
  const canvas = new FakeCanvas(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      canvas.data[i] = (x * 10 + seed * 37) & 255;
      canvas.data[i + 1] = (y * 16 + seed * 91) & 255;
      canvas.data[i + 2] = ((x + y) * 7 + seed * 53) & 255;
      canvas.data[i + 3] = x < 4 ? Math.round(alpha / 2) : alpha;
    }
  }
  return canvas;
}

const reference = (backdrop: FakeCanvas, layer: FakeCanvas, mode: BlendMode, alpha: number): Uint8ClampedArray => {
  const expected = new Uint8ClampedArray(backdrop.data);
  blendPixelBuffers(expected, layer.data, W, H, mode, alpha);
  return expected;
};

beforeEach(() => {
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal("self", { onmessage: null, postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("overlay blend: pixel parity with the CPU reference", () => {
  for (const mode of NEW_MODES) {
    it(`${mode}: an overlay with blend opacity equals the reference at that alpha`, () => {
      const backdrop = painted(1);
      const layer = painted(2, 230);
      const ctx = backdrop.getContext();
      drawOverlayLayerWithBlend(ctx as unknown as OffscreenCanvasRenderingContext2D, layer as unknown as CanvasImageSource, { blendMode: mode, blendOpacity: 60 }, W, H);
      expect(Array.from(backdrop.data)).toEqual(Array.from(reference(painted(1), layer, mode, 0.6)));
    });
  }

  it("normal mode is a plain draw (no per-pixel blend)", () => {
    const backdrop = painted(1);
    const ctx = backdrop.getContext();
    drawOverlayLayerWithBlend(ctx as unknown as OffscreenCanvasRenderingContext2D, painted(2) as unknown as CanvasImageSource, { blendMode: "normal", blendOpacity: 100 }, W, H);
    expect(ctx.log).toEqual(["drawImage"]);
  });
});

describe("CPU blend honours the active clip region", () => {
  it("writes only inside a clip rectangle and leaves the rest of the frame untouched", () => {
    const backdrop = painted(3);
    const before = new Uint8ClampedArray(backdrop.data);
    const layer = painted(4);
    const ctx = backdrop.getContext();
    ctx.save();
    ctx.beginPath();
    ctx.rect(6, 4, 10, 8);
    ctx.clip();
    drawImageWithBlend(ctx as unknown as OffscreenCanvasRenderingContext2D, layer as unknown as CanvasImageSource, "linear-burn", W, H);
    ctx.restore();
    const blended = reference(painted(3), layer, "linear-burn", 1);
    let inside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const isInside = x >= 6 && x < 16 && y >= 4 && y < 12;
        const expected = isInside ? blended : before;
        for (let k = 0; k < 4; k++) expect(backdrop.data[i + k], `pixel ${x},${y} channel ${k}`).toBe(expected[i + k]);
        if (isInside) inside++;
      }
    }
    expect(inside).toBe(80);
  });

  it("never uses putImageData on the destination (it ignores clipping)", () => {
    const backdrop = painted(3);
    const ctx = backdrop.getContext();
    drawImageWithBlend(ctx as unknown as OffscreenCanvasRenderingContext2D, painted(4) as unknown as CanvasImageSource, "hard-mix", W, H);
    expect(ctx.log).not.toContain("putImageData");
  });
});

describe("VideoEngine applies blend modes in the render path", () => {
  const transform = (): Transform =>
    ({
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      fitMode: "contain",
    }) as unknown as Transform;

  async function engineOf() {
    const { VideoEngine } = await import("./video-engine");
    return new VideoEngine() as unknown as {
      drawClipFrameToContext(
        ctx: OffscreenCanvasRenderingContext2D,
        frame: ImageBitmap,
        transform: Transform,
        opacity: number,
        width: number,
        height: number,
        masks: readonly never[],
        time: number,
        blend?: { blendMode?: BlendMode; blendOpacity?: number },
      ): Promise<void>;
      renderShapeClipToCanvasCtx(ctx: OffscreenCanvasRenderingContext2D, clip: unknown, time: number, w: number, h: number): Promise<void>;
      renderSVGClipToCanvasCtx(ctx: OffscreenCanvasRenderingContext2D, clip: unknown, time: number, w: number, h: number): Promise<void>;
      renderStickerClipToCanvasCtx(ctx: OffscreenCanvasRenderingContext2D, clip: unknown, time: number, w: number, h: number): Promise<void>;
      renderTextClipToCanvasCtx(ctx: OffscreenCanvasRenderingContext2D, clip: unknown, time: number, w: number, h: number, pw: number, ph: number): Promise<void>;
    };
  }

  for (const mode of ["linear-burn", "vivid-light", "dissolve", "divide"] as BlendMode[]) {
    it(`a video clip's own blendMode (${mode}) is applied by the main draw path, at blend opacity`, async () => {
      const engine = await engineOf();
      const backdrop = painted(5);
      const frame = painted(6, 255);
      await engine.drawClipFrameToContext(
        backdrop.getContext() as unknown as OffscreenCanvasRenderingContext2D,
        frame as unknown as ImageBitmap,
        transform(),
        1,
        W,
        H,
        [],
        0,
        { blendMode: mode, blendOpacity: 50 },
      );
      expect(Array.from(backdrop.data)).toEqual(Array.from(reference(painted(5), frame, mode, 0.5)));
    });
  }

  it("a clip without a blend mode still draws normally (source-over)", async () => {
    const engine = await engineOf();
    const backdrop = painted(5);
    const frame = painted(6, 255);
    await engine.drawClipFrameToContext(backdrop.getContext() as unknown as OffscreenCanvasRenderingContext2D, frame as unknown as ImageBitmap, transform(), 1, W, H, [], 0, {});
    for (let i = 0; i < backdrop.data.length; i += 4) {
      if (frame.data[i + 3] === 255) expect(Array.from(backdrop.data.slice(i, i + 4))).toEqual(Array.from(frame.data.slice(i, i + 4)));
    }
  });

  const overlayCases = [
    { kind: "shape", method: "renderShapeClipToCanvasCtx" },
    { kind: "svg", method: "renderSVGClipToCanvasCtx" },
    { kind: "sticker", method: "renderStickerClipToCanvasCtx" },
  ] as const;

  for (const { kind, method } of overlayCases) {
    for (const mode of ["linear-burn", "pin-light", "dissolve"] as BlendMode[]) {
      it(`${kind} overlay with ${mode} matches the CPU reference in the export path`, async () => {
        const { graphicsEngine } = await import("../graphics/graphics-engine");
        const layer = painted(7, 240);
        vi.spyOn(graphicsEngine, "renderGraphic").mockResolvedValue({ canvas: layer } as never);
        const engine = await engineOf();
        const backdrop = painted(8);
        await engine[method](backdrop.getContext() as unknown as OffscreenCanvasRenderingContext2D, { id: "g", startTime: 0, blendMode: mode, blendOpacity: 70, keyframes: [], effects: [] }, 0, W, H);
        expect(Array.from(backdrop.data)).toEqual(Array.from(reference(painted(8), layer, mode, 0.7)));
      });
    }
  }

  it("text overlay with a new blend mode matches the CPU reference in the export path", async () => {
    const { titleEngine } = await import("../text/title-engine");
    const layer = painted(9, 220);
    vi.spyOn(titleEngine, "renderText").mockReturnValue({ canvas: layer, width: W, height: H, textMetrics: { width: 0, height: 0, lines: [] } } as never);
    const engine = await engineOf();
    const backdrop = painted(10);
    const clip = { id: "t", startTime: 0, blendMode: "linear-light", blendOpacity: 80, keyframes: [], effects: [], style: {}, transform: {} };
    await engine.renderTextClipToCanvasCtx(backdrop.getContext() as unknown as OffscreenCanvasRenderingContext2D, clip, 0, W, H, W, H);
    expect(Array.from(backdrop.data)).toEqual(Array.from(reference(painted(10), layer, "linear-light", 0.8)));
  });
});

export type { FakeContext };
