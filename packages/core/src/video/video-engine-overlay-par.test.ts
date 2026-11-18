import { afterEach, describe, expect, it, vi } from "vitest";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM } from "../text/types";
import type { TextClip } from "../text/types";
import type { ShapeClip } from "../graphics/types";
import {
  displayLayoutWidth,
  normalizeSequencePar,
  squeezeOverlayToStored,
  withDisplaySpace,
} from "./sequence-par";

interface DrawCall {
  width: number;
  height: number;
}

class FakeOffscreenCanvas {
  readonly draws: DrawCall[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): { drawImage: (src: unknown, x: number, y: number, w: number, h: number) => void } {
    return {
      drawImage: (_src, _x, _y, w, h) => {
        this.draws.push({ width: w, height: h });
      },
    };
  }
}

const PARS = [
  { name: "DV NTSC", par: 0.9091 },
  { name: "HDV", par: 1.3333 },
  { name: "anamorphic", par: 2 },
];

describe("sequence PAR helpers", () => {
  it("normalizes missing and out-of-range PAR to square", () => {
    expect(normalizeSequencePar(undefined)).toBe(1);
    expect(normalizeSequencePar(0.1)).toBe(1);
    expect(normalizeSequencePar(9)).toBe(1);
    expect(normalizeSequencePar(Number.NaN)).toBe(1);
    expect(normalizeSequencePar(1.3333)).toBe(1.3333);
  });

  it("leaves square pixels untouched", () => {
    expect(displayLayoutWidth(720, 1)).toBe(720);
    const source = new FakeOffscreenCanvas(720, 480) as unknown as OffscreenCanvas;
    expect(squeezeOverlayToStored(source, 720, 480, 1)).toBe(source);
  });

  it("never returns the unsqueezed source for a non-square PAR when OffscreenCanvas is missing", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", undefined);
    const source = new FakeOffscreenCanvas(1440, 480) as unknown as OffscreenCanvas;
    expect(() => squeezeOverlayToStored(source, 720, 480, 2)).toThrow(/pixel aspect/i);
    vi.unstubAllGlobals();
  });

  it("falls back to a DOM canvas when OffscreenCanvas is missing", () => {
    const draws: unknown[][] = [];
    const dom = { width: 0, height: 0, getContext: () => ({ drawImage: (...a: unknown[]) => draws.push(a) }) };
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", { createElement: () => dom });
    const source = new FakeOffscreenCanvas(1440, 480) as unknown as OffscreenCanvas;
    const out = squeezeOverlayToStored(source, 720, 480, 2) as unknown as typeof dom;
    expect(out).toBe(dom);
    expect([out.width, out.height]).toEqual([720, 480]);
    expect(draws[0].slice(1)).toEqual([0, 0, 720, 480]);
    vi.unstubAllGlobals();
  });

  it("squeezes the context by stored/display width and restores it", () => {
    const ctx = { save: vi.fn(), restore: vi.fn(), scale: vi.fn() };
    let seen = 0;
    withDisplaySpace(ctx as unknown as CanvasRenderingContext2D, 720, 2, (w) => {
      seen = w;
    });
    expect(seen).toBe(1440);
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});

describe("VideoEngine overlays in a non-square-PAR sequence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function makeEngine(par: number) {
    vi.stubGlobal("self", {
      onmessage: null,
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    const { VideoEngine } = await import("./video-engine");
    const engine = new VideoEngine() as unknown as Record<string, unknown> & {
      sequencePixelAspect: number;
      renderShapeClipToCanvasCtx(ctx: unknown, clip: ShapeClip, time: number, w: number, h: number): Promise<void>;
      renderTextClipToCanvasCtx(
        ctx: unknown,
        clip: TextClip,
        time: number,
        w: number,
        h: number,
        pw: number,
        ph: number,
      ): Promise<void>;
      renderSubtitleToCanvasCtx(ctx: unknown, subtitle: unknown, w: number, h: number): void;
    };
    engine.sequencePixelAspect = par;
    return engine;
  }

  const shape = { id: "s", trackId: "t", startTime: 0, duration: 5, type: "shape", shapeType: "circle" } as unknown as ShapeClip;

  for (const { name, par } of PARS) {
    it(`lays a circle out in display space and squeezes it to stored pixels (${name} ${par})`, async () => {
      const engine = await makeEngine(par);
      const layout = new FakeOffscreenCanvas(0, 0);
      const renderGraphic = vi.spyOn(graphicsEngine, "renderGraphic").mockImplementation(async (_c, _t, w, h) => {
        layout.width = w;
        layout.height = h;
        return { canvas: layout as unknown as OffscreenCanvas, width: w, height: h };
      });
      const target = { drawImage: vi.fn() };

      await engine.renderShapeClipToCanvasCtx(target, shape, 0, 720, 480);

      // Authored in display space: layout aspect equals the display aspect of the stored frame.
      const [, , layoutW, layoutH] = renderGraphic.mock.calls[0];
      expect(layoutW / layoutH).toBeCloseTo((720 * par) / 480, 2);
      // The circle is round in the layout canvas (the engine sizes it from min(w, h)); once the layout is squeezed
      // into 720 stored pixels and shown at the sequence PAR it keeps that shape.
      const stretch = (720 / layoutW) * par;
      expect(stretch).toBeCloseTo(1, 2);
      // The squeezed canvas is stored-size and is what lands on the frame.
      const squeezed = target.drawImage.mock.calls[0][0] as FakeOffscreenCanvas;
      expect(squeezed.width).toBe(720);
      expect(squeezed.height).toBe(480);
    });

    it(`renders title text at the display width and squeezes it (${name} ${par})`, async () => {
      const engine = await makeEngine(par);
      const layout = new FakeOffscreenCanvas(0, 0);
      const renderText = vi.spyOn(titleEngine, "renderText").mockImplementation((_c, w, h) => {
        layout.width = w;
        layout.height = h;
        return {
          canvas: layout as unknown as OffscreenCanvas,
          width: w,
          height: h,
          textMetrics: { width: 0, height: 0, lines: [] },
        };
      });
      const clip: TextClip = {
        id: "t1",
        trackId: "t",
        startTime: 0,
        duration: 5,
        text: "Title",
        style: DEFAULT_TEXT_STYLE,
        transform: DEFAULT_TEXT_TRANSFORM,
        keyframes: [],
        effects: [],
      };
      const target = { drawImage: vi.fn() };

      await engine.renderTextClipToCanvasCtx(target, clip, 0, 720, 480, 720, 480);

      const [, w, h, , scale] = renderText.mock.calls[0];
      expect(w / h).toBeCloseTo((720 * par) / 480, 2);
      // Project-to-output scale is unchanged: both axes still describe the same fraction of the frame.
      expect(scale).toEqual({ x: 1, y: 1 });
      const squeezed = target.drawImage.mock.calls[0][0] as FakeOffscreenCanvas;
      expect([squeezed.width, squeezed.height]).toEqual([720, 480]);
    });

    it(`draws captions through a 1/PAR squeeze (${name} ${par})`, async () => {
      const engine = await makeEngine(par);
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        measureText: () => ({ width: 10 }),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        rect: vi.fn(),
      };
      engine.renderSubtitleToCanvasCtx(ctx, { id: "c", startTime: 0, endTime: 2, text: "hello" }, 720, 480);
      const layoutW = displayLayoutWidth(720, par);
      expect(ctx.scale).toHaveBeenCalledWith(720 / layoutW, 1);
    });
  }

  it("is a no-op at square pixels", async () => {
    const engine = await makeEngine(1);
    const layout = new FakeOffscreenCanvas(720, 480);
    const renderGraphic = vi.spyOn(graphicsEngine, "renderGraphic").mockResolvedValue({
      canvas: layout as unknown as OffscreenCanvas,
      width: 720,
      height: 480,
    });
    const target = { drawImage: vi.fn() };
    await engine.renderShapeClipToCanvasCtx(target, shape, 0, 720, 480);
    expect(renderGraphic.mock.calls[0].slice(2)).toEqual([720, 480]);
    expect(target.drawImage).toHaveBeenCalledWith(layout, 0, 0);
  });
});
