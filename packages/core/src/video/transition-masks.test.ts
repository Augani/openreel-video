import { describe, expect, it } from "vitest";
import {
  MASK_TRANSITION_TYPES,
  encodeLumaBase64,
  decodeLumaBase64,
  rasterizeMaskTransition,
  readLumaMap,
  type MaskTransitionType,
} from "./transition-masks";
import { getDefaultTransitionParams, mapTransitionRange } from "./transition-engine";
import { scaleBorderToFrame, validateTransitionParams } from "./transition-defaults";
import { LUMA_MAX_ENCODED_LENGTH, LUMA_MAX_SIDE } from "./transition-luma-limits";
import { transitionParamsSchema } from "../editing/portable-project";
import { validateEditJSON } from "../editing/safe-json";
import { additiveWeights, mixLinearLight } from "./transition-extra-render";

const W = 64;
const H = 36;
const at = (plane: Uint8ClampedArray, x: number, y: number) => plane[y * W + x]! / 255;
const mean = (plane: Uint8ClampedArray) => plane.reduce((sum, v) => sum + v, 0) / plane.length / 255;
const raster = (type: MaskTransitionType, p: number, extra: Record<string, unknown> = {}) =>
  rasterizeMaskTransition(type, { ...getDefaultTransitionParams(type), ...extra }, W, H, p);

describe.each(MASK_TRANSITION_TYPES)("%s mask", (type) => {
  it("shows only the outgoing shot at 0 and only the incoming shot at 1", () => {
    expect(mean(raster(type, 0).incoming)).toBe(0);
    expect(mean(raster(type, 1).incoming)).toBe(1);
    const withBorder = { borderWidth: 6 };
    expect(mean(raster(type, 0, withBorder).border)).toBe(0);
    expect(mean(raster(type, 1, withBorder).border)).toBe(0);
  });

  it("reveals between a sliver and everything at 0.5, growing with progress", () => {
    const half = mean(raster(type, 0.5).incoming);
    expect(half).toBeGreaterThan(0.08);
    expect(half).toBeLessThan(0.92);
    expect(mean(raster(type, 0.25).incoming)).toBeLessThan(half);
    expect(mean(raster(type, 0.75).incoming)).toBeGreaterThan(half);
  });

  it("reverse flips which pixels the incoming shot takes first", () => {
    const forward = raster(type, 0.5);
    const reversed = raster(type, 0.5, { reverse: true });
    // The same shape coverage is covered from the other end: the two masks are close to complements.
    const overlap = forward.incoming.reduce((sum, v, i) => sum + (v > 127 && reversed.incoming[i]! > 127 ? 1 : 0), 0);
    expect(overlap / forward.incoming.length).toBeLessThan(0.45);
  });

  it("feather softens the front: partially covered pixels appear only with feather", () => {
    const partial = (plane: Uint8ClampedArray) => plane.filter((v) => v > 12 && v < 243).length / plane.length;
    // A hard edge is one pixel wide; the checker wipe has one edge per square, so give its squares room.
    expect(partial(raster(type, 0.5, { feather: 0, ...(type === "checkerWipe" ? { tiles: 4 } : {}) }).incoming)).toBeLessThan(0.1);
    expect(partial(raster(type, 0.5, { feather: 0.5 }).incoming)).toBeGreaterThan(0.2);
  });

  it("a border paints a strip at mid progress and none without one", () => {
    expect(mean(raster(type, 0.5, { borderWidth: 0 }).border)).toBe(0);
    expect(mean(raster(type, 0.5, { borderWidth: 6 }).border)).toBeGreaterThan(0.01);
  });
});

describe("shapes", () => {
  it("iris round opens from the centre outwards", () => {
    const r = raster("irisRound", 0.3);
    expect(at(r.incoming, W / 2, H / 2)).toBe(1);
    expect(at(r.incoming, 0, 0)).toBe(0);
    expect(at(r.incoming, W - 1, H - 1)).toBe(0);
  });

  it("iris box is a rectangle: the edge centres open before the corners", () => {
    const r = raster("irisBox", 0.5);
    expect(at(r.incoming, W / 2, 2)).toBe(0);
    expect(at(r.incoming, W / 2 + 10, H / 2)).toBe(1);
    expect(at(r.incoming, 1, 1)).toBe(0);
  });

  it("iris diamond has a diagonal edge", () => {
    const r = raster("irisDiamond", 0.5);
    expect(at(r.incoming, W / 2, H / 2)).toBe(1);
    // On the axis the diamond tip reaches the edge centre at T = 0.5; the diagonal at the same distance is outside.
    expect(at(r.incoming, W / 2 + 20, H / 2 - 9)).toBe(0);
  });

  it("iris cross opens along the axes first", () => {
    const r = raster("irisCross", 0.4);
    expect(at(r.incoming, W / 2, H / 2)).toBe(1);
    expect(at(r.incoming, W / 2 + 24, H / 2)).toBe(1);
    expect(at(r.incoming, 4, 4)).toBe(0);
  });

  it("an off-centre iris centres on the chosen point", () => {
    const r = raster("irisRound", 0.2, { center: { x: 0.9, y: 0.1 } });
    expect(at(r.incoming, Math.round(W * 0.9), Math.round(H * 0.1))).toBe(1);
    expect(at(r.incoming, 4, H - 4)).toBe(0);
  });

  it("band wipe slides alternate bands in from opposite sides", () => {
    const r = raster("bandWipe", 0.3, { bands: 4 });
    const rowOf = (band: number) => Math.floor(((band + 0.5) / 4) * H);
    expect(at(r.incoming, 2, rowOf(0))).toBe(1); // band 0 comes from the left
    expect(at(r.incoming, W - 3, rowOf(0))).toBe(0);
    expect(at(r.incoming, W - 3, rowOf(1))).toBe(1); // band 1 from the right
    expect(at(r.incoming, 2, rowOf(1))).toBe(0);
  });

  it("barn door opens from the centre line", () => {
    const r = raster("barnDoor", 0.3);
    expect(at(r.incoming, W / 2, 5)).toBe(1);
    expect(at(r.incoming, 1, 5)).toBe(0);
    const v = raster("barnDoor", 0.3, { orientation: "vertical" });
    expect(at(v.incoming, 5, H / 2)).toBe(1);
    expect(at(v.incoming, 5, 1)).toBe(0);
  });

  it("clock wipe sweeps clockwise from 12 o'clock", () => {
    const r = raster("clockWipe", 0.25);
    expect(at(r.incoming, W / 2 + 6, H / 4)).toBe(1); // upper right, first quarter
    expect(at(r.incoming, W / 2 + 6, (3 * H) / 4)).toBe(0); // lower right not yet
    expect(at(r.incoming, 6, H / 4)).toBe(0); // upper left last
    const ccw = raster("clockWipe", 0.25, { clockwise: false });
    expect(at(ccw.incoming, 6, H / 4)).toBe(1);
  });

  it("gradient wipe reveals dark luma first and follows a custom luma map", () => {
    const map = new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
    const params = { lumaData: encodeLumaBase64(map), lumaWidth: 4, lumaHeight: 4, feather: 0 };
    expect(readLumaMap(params)?.data).toEqual(map);
    const r = raster("gradientWipe", 0.5, params);
    expect(at(r.incoming, 2, 10)).toBe(1); // dark left half first
    expect(at(r.incoming, W - 3, 10)).toBe(0);
    const bright = raster("gradientWipe", 0.5, { ...params, reverse: true });
    expect(at(bright.incoming, W - 3, 10)).toBe(1);
    expect(at(bright.incoming, 2, 10)).toBe(0);
  });

  it("rejects a malformed luma map and falls back to the built-in gradient", () => {
    expect(readLumaMap({ lumaData: "AAAA", lumaWidth: 4, lumaHeight: 4 })).toBeNull();
    expect(decodeLumaBase64(encodeLumaBase64(new Uint8Array([1, 2, 3, 4, 5])))).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    const r = raster("gradientWipe", 0.5, { lumaData: "AAAA", lumaWidth: 4, lumaHeight: 4, feather: 0 });
    expect(at(r.incoming, 2, 10)).toBe(1);
    expect(at(r.incoming, W - 3, 10)).toBe(0);
  });

  it("the border strip sits just ahead of the incoming shot", () => {
    const r = raster("irisBox", 0.5, { borderWidth: 4, feather: 0 });
    // Walk right from the centre: incoming, then border, then neither.
    const y = H / 2;
    const row = Array.from({ length: W / 2 }, (_, i) => [at(r.incoming, W / 2 + i, y), at(r.border, W / 2 + i, y)]);
    const lastIncoming = row.reduce((last, [inc], i) => (inc! > 0.5 ? i : last), -1);
    const borderCells = row.filter(([inc, bor]) => inc! < 0.5 && bor! > 0.5).length;
    expect(lastIncoming).toBeGreaterThan(0);
    expect(borderCells).toBeGreaterThanOrEqual(2);
    expect(borderCells).toBeLessThanOrEqual(6);
    expect(row[lastIncoming + 1]![1]).toBeGreaterThan(0.5);
  });
});

describe("border with feather", () => {
  it.each(MASK_TRANSITION_TYPES)("%s: the feather fades into the outgoing shot and only a strip is the border colour", (type) => {
    const r = raster(type, 0.5, { feather: 0.4, borderWidth: 4 });
    let soft = 0;
    let softWithBorder = 0;
    for (let i = 0; i < r.incoming.length; i += 1) {
      if (r.incoming[i]! > 40 && r.incoming[i]! < 215) {
        soft += 1;
        if (r.border[i]! > 20) softWithBorder += 1;
      }
    }
    expect(soft).toBeGreaterThan(50);
    expect(softWithBorder / soft).toBeLessThan(0.03);
    expect(mean(r.border)).toBeGreaterThan(0.005);
  });
});

describe("start / end percentage", () => {
  it("maps eased progress into the chosen range", () => {
    expect(mapTransitionRange(0.5, {})).toBe(0.5);
    expect(mapTransitionRange(0, { startPct: 40, endPct: 80 })).toBeCloseTo(0.4);
    expect(mapTransitionRange(1, { startPct: 40, endPct: 80 })).toBeCloseTo(0.8);
    expect(mapTransitionRange(0.5, { startPct: 40, endPct: 80 })).toBeCloseTo(0.6);
    expect(mapTransitionRange(0.5, { startPct: 100, endPct: 0 })).toBeCloseTo(0.5);
  });
});

describe("dissolves and cube", () => {
  it("film dissolve mixes in linear light: the midpoint of black and white is brighter than 50% grey", () => {
    const black = new Uint8ClampedArray([0, 0, 0, 255]);
    const white = new Uint8ClampedArray([255, 255, 255, 255]);
    const out = new Uint8ClampedArray(4);
    mixLinearLight(black, white, out, 0.5);
    expect(out[0]).toBeGreaterThan(180);
    expect(out[0]).toBeLessThan(195);
    mixLinearLight(black, white, out, 0);
    expect(out[0]).toBe(0);
    mixLinearLight(black, white, out, 1);
    expect(out[0]).toBe(255);
    expect(out[3]).toBe(255);
  });

  it("additive dissolve weights both shots fully at the midpoint", () => {
    expect(additiveWeights(0)).toEqual({ outgoing: 1, incoming: 0 });
    expect(additiveWeights(0.5)).toEqual({ outgoing: 1, incoming: 1 });
    expect(additiveWeights(1)).toEqual({ outgoing: 0, incoming: 1 });
    expect(additiveWeights(0.25)).toEqual({ outgoing: 1, incoming: 0.5 });
  });
});

describe("frame-size independence and param validation", () => {
  it("scales the border width to the rendered frame so a half-size preview matches the full-size export", () => {
    expect(scaleBorderToFrame({ borderWidth: 10 }, 320, 640)).toEqual({ borderWidth: 5 });
    expect(scaleBorderToFrame({ borderWidth: 10 }, 640, 640)).toEqual({ borderWidth: 10 });
    expect(scaleBorderToFrame({ feather: 0.2 }, 320, 640)).toEqual({ feather: 0.2 });
    const params = { borderWidth: 0 };
    expect(scaleBorderToFrame(params, 320, 640)).toBe(params);
  });

  it("validates the shared parameters", () => {
    expect(validateTransitionParams(undefined)).toBeNull();
    expect(validateTransitionParams({ feather: 0.5, startPct: 10, endPct: 90, alignment: "end", reverse: true })).toBeNull();
    for (const bad of [[], "x", { feather: 1.5 }, { startPct: 101 }, { borderWidth: -1 }, { alignment: "x" }, { reverse: 1 }, { startPct: 80, endPct: 20 }, { curve: "bounce" }]) {
      expect(validateTransitionParams(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("accepts exactly the luma maps the portable edit format allows", () => {
    const full = encodeLumaBase64(new Uint8Array(LUMA_MAX_SIDE * LUMA_MAX_SIDE).fill(128));
    expect(full.length).toBe(LUMA_MAX_ENCODED_LENGTH);
    const params = { lumaData: full, lumaWidth: LUMA_MAX_SIDE, lumaHeight: LUMA_MAX_SIDE };
    expect(readLumaMap(params)?.data.length).toBe(LUMA_MAX_SIDE * LUMA_MAX_SIDE);
    expect(() => validateEditJSON(params, transitionParamsSchema)).not.toThrow();
    // Past the limits both refuse: the reader (side and encoded length) and the schema (encoded length).
    const over = encodeLumaBase64(new Uint8Array(LUMA_MAX_SIDE * LUMA_MAX_SIDE + 1));
    expect(readLumaMap({ lumaData: over, lumaWidth: LUMA_MAX_SIDE, lumaHeight: LUMA_MAX_SIDE })).toBeNull();
    expect(readLumaMap({ lumaData: over, lumaWidth: LUMA_MAX_SIDE + 1, lumaHeight: LUMA_MAX_SIDE })).toBeNull();
    expect(() => validateEditJSON({ lumaData: "A".repeat(LUMA_MAX_ENCODED_LENGTH + 1) }, transitionParamsSchema)).toThrow()
    expect(readLumaMap({ lumaData: "A".repeat(LUMA_MAX_ENCODED_LENGTH + 4), lumaWidth: LUMA_MAX_SIDE, lumaHeight: LUMA_MAX_SIDE })).toBeNull();
  });
});
