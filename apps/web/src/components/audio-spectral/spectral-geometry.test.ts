import { describe, expect, it } from "vitest";
import {
  bandFromPixels,
  brushRadiiFromPixels,
  movePoints,
  moveRect,
  pixelsToPoints,
  pointToPixel,
  polygonArea,
  resizeRect,
  thinPath,
  colourTable,
  formatHz,
  freqToY,
  frequencyRange,
  panTime,
  pixelsToRect,
  rectToPixels,
  timeToX,
  xToTime,
  yToFreq,
  zoomTime,
  type SpectralViewport,
} from "./spectral-geometry";

const view: SpectralViewport = { startTime: 2, endTime: 6, minHz: 30, maxHz: 24000, width: 400, height: 200 };

describe("spectral viewport geometry", () => {
  it("maps time linearly and frequency logarithmically, and round-trips", () => {
    expect(timeToX(view, 2)).toBe(0);
    expect(timeToX(view, 6)).toBe(400);
    expect(xToTime(view, 100)).toBeCloseTo(3, 9);
    expect(freqToY(view, 24000)).toBeCloseTo(0, 6);
    expect(freqToY(view, 30)).toBeCloseTo(200, 6);
    for (const hz of [60, 440, 1000, 8000]) expect(yToFreq(view, freqToY(view, hz))).toBeCloseTo(hz, 6);
    // Equal octaves are equal heights.
    expect(freqToY(view, 200) - freqToY(view, 400)).toBeCloseTo(freqToY(view, 2000) - freqToY(view, 4000), 6);
  });

  it("turns a dragged box into a clamped time-frequency rectangle, in either drag direction", () => {
    const a = { x: 100, y: freqToY(view, 2000) };
    const b = { x: 300, y: freqToY(view, 500) };
    const forward = pixelsToRect(view, a, b, 5, 24000);
    const backward = pixelsToRect(view, b, a, 5, 24000);
    expect(forward).toEqual(backward);
    expect(forward.startTime).toBeCloseTo(3, 6);
    expect(forward.endTime).toBeCloseTo(5, 6);
    expect(forward.lowHz).toBeCloseTo(500, 4);
    expect(forward.highHz).toBeCloseTo(2000, 4);
    const clamped = pixelsToRect(view, { x: 0, y: 0 }, { x: 400, y: 200 }, 4.5, 20000);
    expect(clamped.endTime).toBe(4.5);
    expect(clamped.highHz).toBe(20000);
  });

  it("a frequency-band marquee spans the whole source whatever the zoom", () => {
    const band = bandFromPixels(view, freqToY(view, 1000), freqToY(view, 3000), 12, 24000);
    expect(band.startTime).toBe(0);
    expect(band.endTime).toBe(12);
    expect(band.lowHz).toBeCloseTo(1000, 4);
    expect(band.highHz).toBeCloseTo(3000, 4);
  });

  it("projects a region back to pixels", () => {
    const px = rectToPixels(view, { startTime: 3, endTime: 5, lowHz: 500, highHz: 2000 });
    expect(px.x).toBeCloseTo(100, 6);
    expect(px.width).toBeCloseTo(200, 6);
    expect(px.y).toBeCloseTo(freqToY(view, 2000), 6);
    expect(px.height).toBeCloseTo(freqToY(view, 500) - freqToY(view, 2000), 6);
  });

  it("zooms around an anchor and pans without leaving the source", () => {
    const zoomed = zoomTime(0, 10, 10, 0.5, 5);
    expect(zoomed.endTime - zoomed.startTime).toBeCloseTo(5, 9);
    expect(zoomed.startTime).toBeCloseTo(2.5, 9);
    const edge = zoomTime(0, 10, 10, 0.1, 0.2);
    expect(edge.startTime).toBeCloseTo(0.18, 9); // the anchor keeps its relative position
    expect(zoomTime(2, 4, 10, 100, 3)).toEqual({ startTime: 0, endTime: 10 });
    expect(panTime(2, 4, 10, 100)).toEqual({ startTime: 8, endTime: 10 });
    expect(panTime(2, 4, 10, -100)).toEqual({ startTime: 0, endTime: 2 });
  });

  it("keeps frequency presets inside Nyquist and formats labels", () => {
    expect(frequencyRange("high", 8000)).toEqual({ minHz: 1000, maxHz: 8000 });
    expect(frequencyRange("full", 24000).maxHz).toBe(24000);
    expect(formatHz(440)).toBe("440 Hz");
    expect(formatHz(2500)).toBe("2.5 kHz");
  });

  it("builds monotone colour tables", () => {
    for (const id of ["heat", "viridis", "mono"] as const) {
      const table = colourTable(id);
      expect(table).toHaveLength(768);
      const luma = (i: number) => table[i * 3] + table[i * 3 + 1] + table[i * 3 + 2];
      expect(luma(255)).toBeGreaterThan(luma(0));
    }
  });
});

describe("lasso, brush and region editing geometry", () => {
  it("round-trips a drawn path through (time, Hz) points, clamped to the source", () => {
    const path = [{ x: 0, y: 0 }, { x: 200, y: 100 }, { x: 400, y: 200 }];
    const points = pixelsToPoints(view, path, 5, 24000);
    expect(points[0].t).toBeCloseTo(2, 9);
    expect(points[2].t).toBe(5); // clamped to the 5 s source
    for (const [i, p] of points.entries()) {
      const back = pointToPixel(view, p);
      if (p.t < 5) expect(back.x).toBeCloseTo(path[i].x, 6);
      expect(back.y).toBeCloseTo(path[i].y, 4);
    }
  });

  it("thins a path and measures a polygon's area", () => {
    const dense = Array.from({ length: 101 }, (_, i) => ({ x: i * 0.5, y: 0 }));
    const thin = thinPath(dense, 5);
    expect(thin.length).toBeLessThan(15);
    expect(thin[thin.length - 1]).toBe(dense[dense.length - 1]);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(0);
  });

  it("turns a brush radius in pixels into seconds and octaves", () => {
    const { brushSeconds, brushOctaves } = brushRadiiFromPixels(view, 10);
    expect(brushSeconds).toBeCloseTo(0.1, 9); // 4 s over 400 px
    expect(brushOctaves).toBeCloseTo((10 * Math.log2(800)) / 200, 9);
  });

  it("moves and resizes a rectangle without crossing edges or leaving the source", () => {
    const rect = { startTime: 1, endTime: 2, lowHz: 500, highHz: 1000 };
    expect(moveRect(rect, 0.5, 1, 10, 24000)).toEqual({ startTime: 1.5, endTime: 2.5, lowHz: 1000, highHz: 2000 });
    expect(moveRect(rect, -5, 0, 10, 24000).startTime).toBe(0);
    expect(moveRect(rect, 50, 0, 10, 24000).endTime).toBe(10);
    expect(moveRect(rect, 0, 10, 10, 24000).highHz).toBe(24000);
    expect(resizeRect(rect, "e", 3, 0, 10, 24000)).toMatchObject({ startTime: 1, endTime: 3 });
    expect(resizeRect(rect, "w", 5, 0, 10, 24000).startTime).toBeLessThan(2);
    expect(resizeRect(rect, "ne", 2.5, 2000, 10, 24000)).toEqual({ startTime: 1, endTime: 2.5, lowHz: 500, highHz: 2000 });
    expect(resizeRect(rect, "s", 0, 5000, 10, 24000).lowHz).toBeLessThan(1000);
  });

  it("moves lasso points together", () => {
    const moved = movePoints([{ t: 1, hz: 400 }, { t: 2, hz: 800 }], 0.5, 1, 10, 24000);
    expect(moved).toEqual([{ t: 1.5, hz: 800 }, { t: 2.5, hz: 1600 }]);
    expect(movePoints([{ t: 9.9, hz: 20000 }], 5, 2, 10, 24000)).toEqual([{ t: 10, hz: 24000 }]);
  });
});
