import { afterEach, describe, expect, it, vi } from "vitest";
import { titleEngine } from "@openreel/core";
import type { ShapeClip } from "@openreel/core";
import { displayLayoutWidth } from "@openreel/core/video/sequence-par";
import {
  drawFrameWithTransform,
  renderShapeClipToCanvas,
  renderSubtitleToCanvas,
  renderTextClipToCanvas,
  setPreviewSequencePar,
} from "./canvas-renderers";

/**
 * A recording 2D context that tracks the current transform matrix (translate / scale / rotate / save / restore), so
 * the tests can read the geometry a draw call ends up with in stored canvas pixels. The Program monitor shows the
 * stored canvas stretched by the sequence PAR, so on-screen shape = stored shape x (PAR, 1).
 */
type Matrix = { a: number; d: number; e: number; f: number };
interface Ellipse {
  radiusX: number;
  radiusY: number;
  centerX: number;
}

function makeGeometryCtx() {
  let m: Matrix = { a: 1, d: 1, e: 0, f: 0 };
  const stack: Matrix[] = [];
  const ellipses: Ellipse[] = [];
  const images: Array<{ args: unknown[]; m: Matrix }> = [];
  const ctx = {
    save: () => stack.push({ ...m }),
    restore: () => {
      m = stack.pop() ?? m;
    },
    scale: (x: number, y: number) => {
      m = { a: m.a * x, d: m.d * y, e: m.e, f: m.f };
    },
    translate: (x: number, y: number) => {
      m = { a: m.a, d: m.d, e: m.e + m.a * x, f: m.f + m.d * y };
    },
    rotate: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    clip: () => undefined,
    rect: () => undefined,
    roundRect: () => undefined,
    setLineDash: () => undefined,
    ellipse: (cx: number, _cy: number, rx: number, ry: number) => {
      ellipses.push({ radiusX: rx * m.a, radiusY: ry * m.d, centerX: m.e + m.a * cx });
    },
    drawImage: (...args: unknown[]) => images.push({ args, m: { ...m } }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ellipses, images, matrix: () => m };
}

const PARS = [
  { name: "DV NTSC", par: 10 / 11 },
  { name: "HDV", par: 4 / 3 },
  { name: "anamorphic", par: 2 },
];

const circle = {
  id: "c",
  trackId: "t",
  startTime: 0,
  duration: 5,
  type: "shape",
  shapeType: "circle",
  style: { fill: { type: "solid", color: "#0f0", opacity: 1 }, stroke: { color: "#0f0", width: 0, opacity: 1 } },
  transform: { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
} as unknown as ShapeClip;

describe("Program monitor Canvas2D overlays at a non-square sequence PAR", () => {
  afterEach(() => {
    setPreviewSequencePar(1);
    vi.restoreAllMocks();
  });

  for (const { name, par } of PARS) {
    it(`a circle is stored squeezed by 1/PAR so it displays round (${name} ${par})`, () => {
      setPreviewSequencePar(par);
      const g = makeGeometryCtx();
      void renderShapeClipToCanvas(g.ctx, circle, 720, 480, 0);
      expect(g.ellipses).toHaveLength(1);
      const [e] = g.ellipses;
      // Stored pixels: x radius is the y radius divided by PAR ...
      // (the display layout width is rounded to whole pixels, hence 3 digits)
      expect(e.radiusX / e.radiusY).toBeCloseTo(1 / par, 2);
      // ... so the frame shown at the display aspect (x stretched by PAR) is a circle.
      expect((e.radiusX * par) / e.radiusY).toBeCloseTo(1, 2);
      // Positioned at the centre of the stored frame.
      expect(e.centerX).toBeCloseTo(360, 6);
    });
  }

  it("leaves a circle round in stored pixels at square PAR", () => {
    setPreviewSequencePar(1);
    const g = makeGeometryCtx();
    void renderShapeClipToCanvas(g.ctx, circle, 720, 480, 0);
    expect(g.ellipses[0].radiusX / g.ellipses[0].radiusY).toBeCloseTo(1, 6);
  });

  for (const { name, par } of PARS) {
    it(`titles are laid out at the display width and drawn squeezed into the stored canvas (${name} ${par})`, () => {
      setPreviewSequencePar(par);
      const layoutCanvas = { width: 0, height: 0 } as unknown as OffscreenCanvas;
      const renderText = vi.spyOn(titleEngine, "renderText").mockImplementation((_c, w, h) => ({
        canvas: layoutCanvas,
        width: w,
        height: h,
        textMetrics: { width: 0, height: 0, lines: [] },
      }));
      const g = makeGeometryCtx();
      const clip = {
        id: "t1",
        trackId: "t",
        startTime: 0,
        duration: 5,
        text: "Title",
        style: { fontFamily: "Arial", fontSize: 48 },
        transform: { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
        keyframes: [],
        effects: [],
      } as never;
      void renderTextClipToCanvas(g.ctx, clip, 720, 480, 0);
      const [, layoutW, layoutH] = renderText.mock.calls[0];
      expect(layoutW).toBe(displayLayoutWidth(720, par));
      expect(layoutH).toBe(480);
      // Dest rect is the whole stored canvas: display layout squeezed horizontally by 1/PAR.
      expect(g.images[0].args.slice(1)).toEqual([0, 0, 720, 480]);
    });

    it(`video frames are laid out in display space and squeezed back (${name} ${par})`, () => {
      setPreviewSequencePar(par);
      const g = makeGeometryCtx();
      const frame = { width: 720, height: 480 } as unknown as ImageBitmap;
      drawFrameWithTransform(g.ctx, frame, undefined, 720, 480);
      const [{ args, m }] = g.images;
      // Stretch to the canvas (fit "stretch" default) covers the whole stored width after the squeeze.
      const drawW = args[3] as number;
      const drawH = args[4] as number;
      // A square-pixel 720x480 source keeps its own 3:2 look once displayed (stored x PAR), and fits the display frame.
      const displayW = drawW * m.a * par;
      const displayH = drawH * m.d;
      expect(displayW / displayH).toBeCloseTo(720 / 480, 2);
      expect(displayW).toBeLessThanOrEqual(displayLayoutWidth(720, par) + 1e-6);
      expect(displayH).toBeLessThanOrEqual(480 + 1e-6);
      expect(m.a).toBeCloseTo(1 / par, 2);
    });

    it(`captions are drawn through the 1/PAR squeeze (${name} ${par})`, () => {
      setPreviewSequencePar(par);
      const g = makeGeometryCtx();
      const seen: number[] = [];
      const ctx = new Proxy(g.ctx, {
        get: (target, key) => {
          if (key === "fillText" || key === "strokeText") {
            return (..._args: unknown[]) => seen.push(g.matrix().a);
          }
          if (key === "measureText") return (t: string) => ({ width: t.length * 10 });
          if (key === "fillRect") return () => undefined;
          return (target as unknown as Record<string | symbol, unknown>)[key];
        },
      });
      renderSubtitleToCanvas(ctx, { id: "s", text: "hello", startTime: 0, endTime: 2 } as never, 720, 480);
      expect(seen.length).toBeGreaterThan(0);
      for (const scaleX of seen) expect(scaleX).toBeCloseTo(720 / displayLayoutWidth(720, par), 6);
    });
  }
});

const originalOffscreenCanvas = (globalThis as { OffscreenCanvas: unknown }).OffscreenCanvas;

describe("Program monitor video clip CSS filter at a non-square sequence PAR", () => {
  afterEach(() => {
    setPreviewSequencePar(1);
    (globalThis as { OffscreenCanvas: unknown }).OffscreenCanvas = originalOffscreenCanvas;
  });

  /** Stub OffscreenCanvas with recording contexts so the test can see where `ctx.filter` was set. */
  function stubLayers() {
    const layers: Array<{ width: number; height: number; g: ReturnType<typeof makeGeometryCtx>; filter?: string }> = [];
    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        const g = makeGeometryCtx();
        const layer: (typeof layers)[number] = { width: this.width, height: this.height, g };
        Object.defineProperty(g.ctx, "filter", { set: (v: string) => {
            layer.filter = v;
          }, get: () => layer.filter ?? "none" });
        layers.push(layer);
        return g.ctx;
      }
    }
    (globalThis as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
    return layers;
  }

  for (const { name, par } of PARS) {
    it(`blur runs in a display-space layer, then is squeezed (${name} ${par})`, () => {
      setPreviewSequencePar(par);
      const layers = stubLayers();
      const g = makeGeometryCtx();
      let outerFilter: string | undefined;
      Object.defineProperty(g.ctx, "filter", { set: (v: string) => {
        outerFilter = v;
      }, get: () => outerFilter ?? "none" });
      const frame = { width: 720, height: 480 } as unknown as ImageBitmap;
      drawFrameWithTransform(g.ctx, frame, undefined, 720, 480, "blur(8px)");
      // The filter radius must not be applied on stored pixels (it would be anisotropic once displayed).
      expect(outerFilter, "no blur on the stored-pixel context").toBeUndefined();
      expect(layers).toHaveLength(1);
      expect(layers[0].filter).toBe("blur(8px)");
      expect(layers[0].width).toBe(Math.round(displayLayoutWidth(720, par)));
      expect(layers[0].height).toBe(480);
      // The layer has no squeeze of its own; it is drawn onto the stored canvas at the stored size (the squeeze).
      expect(layers[0].g.matrix().a).toBe(1);
      expect(g.images).toHaveLength(1);
      expect(g.images[0].args.slice(1)).toEqual([0, 0, 720, 480]);
    });
  }

  it("square pixels keep the plain filter path (no layer)", () => {
    setPreviewSequencePar(1);
    const layers = stubLayers();
    const g = makeGeometryCtx();
    let outerFilter: string | undefined;
    Object.defineProperty(g.ctx, "filter", { set: (v: string) => {
        outerFilter = v;
      }, get: () => outerFilter ?? "none" });
    drawFrameWithTransform(g.ctx, { width: 720, height: 480 } as unknown as ImageBitmap, undefined, 720, 480, "blur(8px)");
    expect(layers).toHaveLength(0);
    expect(outerFilter).toBe("blur(8px)");
  });
});
