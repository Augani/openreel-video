import { describe, expect, it } from "vitest";
import {
  MASK_TRANSITION_TYPES,
  hashCell,
  isMaskTransition,
  randomCellOrder,
  rasterizeMaskTransition,
  resolveMaskParams,
  type MaskTransitionType,
} from "./transition-masks";
import { getDefaultTransitionParams } from "./transition-default-params";

const W = 160;
const H = 90;
const PROGRESS = [0, 0.25, 0.5, 0.75, 1] as const;
const NEW_MASKS = ["checkerboard", "checkerWipe", "inset", "wedgeWipe", "randomBlocks", "randomWipe"] as const;

const raster = (type: MaskTransitionType, params: Record<string, unknown>, p: number) =>
  rasterizeMaskTransition(type, { ...getDefaultTransitionParams(type), ...params }, W, H, p);
const fraction = (r: { incoming: Uint8ClampedArray }) => r.incoming.reduce((sum, v) => sum + v, 0) / (255 * r.incoming.length);
const at = (r: { incoming: Uint8ClampedArray; width: number }, x: number, y: number) => r.incoming[y * r.width + x]! / 255;

/** Every variant of every new mask transition: each direction, orientation and corner it offers. */
const VARIANTS: [MaskTransitionType, Record<string, unknown>][] = [
  ["checkerboard", {}],
  ["checkerboard", { tiles: 5 }],
  ...(["left", "right", "up", "down"] as const).map((direction): [MaskTransitionType, Record<string, unknown>] => ["checkerWipe", { direction }]),
  ...(["topLeft", "topRight", "bottomLeft", "bottomRight"] as const).map((corner): [MaskTransitionType, Record<string, unknown>] => ["inset", { corner }]),
  ["wedgeWipe", {}],
  ["wedgeWipe", { startAngle: 90, center: { x: 0.3, y: 0.6 } }],
  ["randomBlocks", { seed: 1 }],
  ["randomBlocks", { seed: 99, tiles: 20 }],
  ...(["left", "right", "up", "down"] as const).map((direction): [MaskTransitionType, Record<string, unknown>] => ["randomWipe", { direction }]),
];

describe("new mask transitions", () => {
  it("are registered as mask transitions with complete defaults", () => {
    for (const type of NEW_MASKS) {
      expect(isMaskTransition(type)).toBe(true);
      expect(MASK_TRANSITION_TYPES).toContain(type);
      expect(getDefaultTransitionParams(type)).toMatchObject({ feather: 0, borderWidth: 0, reverse: false });
    }
  });

  for (const [type, params] of VARIANTS) {
    it(`${type} ${JSON.stringify(params)}: nothing at 0, everything at 1, never retreating in between`, () => {
      const frames = PROGRESS.map((p) => raster(type, params, p));
      expect(fraction(frames[0]!)).toBe(0);
      expect(fraction(frames[4]!)).toBe(1);
      for (let k = 1; k < frames.length; k += 1) {
        for (let i = 0; i < frames[k]!.incoming.length; i += 1) {
          if (frames[k]!.incoming[i]! < frames[k - 1]!.incoming[i]!) throw new Error(`pixel ${i} retreated between ${PROGRESS[k - 1]} and ${PROGRESS[k]}`);
        }
      }
      expect(fraction(frames[2]!)).toBeGreaterThan(0.15);
      expect(fraction(frames[2]!)).toBeLessThan(0.85);
    });

    it(`${type} ${JSON.stringify(params)}: reverse inverts the field, border adds a strip ahead of the front`, () => {
      const forward = raster(type, params, 0.5);
      const reverse = raster(type, { ...params, reverse: true }, 0.5);
      expect(fraction(reverse)).toBeGreaterThan(0.15);
      expect(reverse.incoming).not.toEqual(forward.incoming);
      const bordered = raster(type, { ...params, borderWidth: 8, borderColor: "#00c800" }, 0.5);
      expect(bordered.border.some((v) => v > 0)).toBe(true);
    });
  }

  it("checkerboard opens one colour of squares, then the other", () => {
    const quarter = raster("checkerboard", {}, 0.25);
    const half = raster("checkerboard", {}, 0.5);
    expect(fraction(quarter)).toBeGreaterThan(0.09);
    expect(fraction(quarter)).toBeLessThan(0.16);
    expect(fraction(half)).toBeGreaterThan(0.45);
    expect(fraction(half)).toBeLessThan(0.55);
    const cell = W / 8;
    // The middle of an even square is open at 0.25, the middle of a neighbouring odd square is not.
    expect(at(quarter, Math.floor(cell / 2), Math.floor(cell / 2))).toBe(1);
    expect(at(quarter, Math.floor(cell * 1.5), Math.floor(cell / 2))).toBe(0);
  });

  it("checker wipe sweeps alternate squares in opposite directions", () => {
    const half = raster("checkerWipe", { direction: "left" }, 0.5);
    expect(fraction(half)).toBeGreaterThan(0.47);
    expect(fraction(half)).toBeLessThan(0.53);
    const cell = W / 8;
    // Even square: opened from its left edge; odd square: from its right edge.
    expect(at(half, 3, 5)).toBe(1);
    expect(at(half, Math.floor(cell) - 3, 5)).toBe(0);
    expect(at(half, Math.floor(cell) + 3, 5)).toBe(0);
    expect(at(half, Math.floor(cell * 2) - 3, 5)).toBe(1);
    // A rightward wipe is the horizontal mirror image.
    const right = raster("checkerWipe", { direction: "right" }, 0.5);
    expect(at(right, 3, 5)).toBe(0);
    expect(at(right, Math.floor(cell) - 3, 5)).toBe(1);
    const down = raster("checkerWipe", { direction: "down" }, 0.5);
    const up = raster("checkerWipe", { direction: "up" }, 0.5);
    expect(down.incoming).not.toEqual(up.incoming);
  });

  it("inset grows a rectangle from the chosen corner", () => {
    const corners: [string, [number, number], [number, number]][] = [
      ["topLeft", [5, 5], [W - 5, H - 5]],
      ["topRight", [W - 5, 5], [5, H - 5]],
      ["bottomLeft", [5, H - 5], [W - 5, 5]],
      ["bottomRight", [W - 5, H - 5], [5, 5]],
    ];
    for (const [corner, open, shut] of corners) {
      const half = raster("inset", { corner }, 0.5);
      expect(at(half, open[0], open[1]), `${corner} open`).toBe(1);
      expect(at(half, shut[0], shut[1]), `${corner} shut`).toBe(0);
      expect(fraction(half), corner).toBeGreaterThan(0.23);
      expect(fraction(half), corner).toBeLessThan(0.27);
      // The open region keeps the frame's aspect: at 0.5 it spans half of the width and half of the height.
      expect(at(half, corner.endsWith("Left") ? W / 2 - 3 : W / 2 + 3, corner.startsWith("top") ? H / 2 - 3 : H / 2 + 3)).toBe(1);
    }
  });

  it("wedge wipe opens a fan from the start angle in both turning directions", () => {
    const quarter = raster("wedgeWipe", {}, 0.25);
    expect(at(quarter, W / 2, 6)).toBe(1); // straight up from the centre
    expect(at(quarter, W / 2, H - 6)).toBe(0); // straight down
    expect(at(quarter, W - 6, H / 2)).toBe(0);
    expect(at(quarter, 6, H / 2)).toBe(0);
    const half = raster("wedgeWipe", {}, 0.5);
    expect(at(half, W - 6, H / 2 - 4)).toBe(1);
    expect(at(half, 6, H / 2 - 4)).toBe(1); // symmetric about the vertical
    expect(at(half, W / 2 + 10, H - 6)).toBe(0);
    const left = raster("wedgeWipe", { startAngle: -90 }, 0.25);
    expect(at(left, 6, H / 2)).toBe(1);
    expect(at(left, W - 6, H / 2)).toBe(0);
  });

  describe("random blocks and random wipe are deterministic from their seed", () => {
    it("hashes with integer maths: the same cell gives the same number, other seeds differ", () => {
      expect(hashCell(1, 3, 4)).toBe(hashCell(1, 3, 4));
      expect(hashCell(1, 3, 4)).not.toBe(hashCell(2, 3, 4));
      expect(hashCell(1, 3, 4)).not.toBe(hashCell(1, 4, 3));
      // Pinned values: if these move, projects saved with a seed would transition differently.
      expect([hashCell(1, 0, 0), hashCell(1, 3, 4), hashCell(42, 7, 7)].map((v) => Math.round(v * 1e6))).toEqual(PINNED_HASHES);
    });

    it("orders the cells as a permutation, so exactly the share of cells equal to the progress is open", () => {
      const order = Array.from(randomCellOrder(1, 4, 3));
      expect(order).toHaveLength(12);
      expect([...order].sort((a, b) => a - b).map((v) => Math.round(v * 11))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(order.map((v) => Math.round(v * 11))).toEqual(PINNED_ORDER);
      expect(Array.from(randomCellOrder(1, 4, 3))).toEqual(order);
      expect(Array.from(randomCellOrder(2, 4, 3))).not.toEqual(order);
    });

    it("renders the same frame every time for a seed, and another one for another seed", () => {
      for (const type of ["randomBlocks", "randomWipe"] as const) {
        const a = raster(type, { seed: 7 }, 0.5);
        const b = raster(type, { seed: 7 }, 0.5);
        const c = raster(type, { seed: 8 }, 0.5);
        expect(Array.from(a.incoming)).toEqual(Array.from(b.incoming));
        expect(Array.from(a.incoming)).not.toEqual(Array.from(c.incoming));
        // The default seed is the stored one, not a fresh random number per call.
        expect(Array.from(raster(type, {}, 0.5).incoming)).toEqual(Array.from(raster(type, { seed: 1 }, 0.5).incoming));
      }
    });

    it("random blocks reveals whole blocks, about the progress share of them", () => {
      const half = raster("randomBlocks", { tiles: 10 }, 0.5);
      const cell = W / 10;
      for (let j = 0; j < 4; j += 1) {
        for (let i = 0; i < 10; i += 1) {
          const values = new Set<number>();
          for (let y = Math.ceil(j * cell) + 1; y < Math.floor((j + 1) * cell) - 1; y += 3) {
            for (let x = Math.ceil(i * cell) + 1; x < Math.floor((i + 1) * cell) - 1; x += 3) values.add(half.incoming[y * W + x]!);
          }
          expect(values.size, `block ${i},${j} is open or shut as a whole`).toBe(1);
        }
      }
      expect(fraction(half)).toBeGreaterThan(0.42);
      expect(fraction(half)).toBeLessThan(0.58);
    });

    it("random wipe still travels in its direction", () => {
      const early = raster("randomWipe", { direction: "left" }, 0.3);
      let leftOpen = 0;
      let rightOpen = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W / 4; x += 1) leftOpen += at(early, x, y);
        for (let x = (W * 3) / 4; x < W; x += 1) rightOpen += at(early, x, y);
      }
      expect(leftOpen).toBeGreaterThan(rightOpen * 2);
    });
  });

  it("reads and clamps the new parameters", () => {
    expect(resolveMaskParams({ tiles: 500, seed: -3, corner: "elsewhere", direction: "sideways" })).toMatchObject({ tiles: 64, seed: 0, corner: "topLeft", direction: "left" });
    expect(resolveMaskParams({ tiles: 1 }).tiles).toBe(2);
    expect(resolveMaskParams({ corner: "bottomRight", direction: "down", seed: 12.4 })).toMatchObject({ corner: "bottomRight", direction: "down", seed: 12 });
  });
});

const PINNED_HASHES = [126450, 122733, 738141];
const PINNED_ORDER = [4, 3, 5, 10, 9, 8, 7, 6, 1, 0, 2, 11];
