import { describe, expect, it } from "vitest";
import {
  createProtectivePersonMask,
  createMotionAwareOcclusionMask,
  refinePersonMaskEdges,
  shapePersonMaskAlpha,
  stabilizePersonMask,
  type TemporalPersonMaskState,
} from "./temporal-person-mask";

const stateFor = (
  values: number[],
  width: number,
  height: number,
): TemporalPersonMaskState =>
  stabilizePersonMask(new Float32Array(values), width, height, null);

describe("stabilizePersonMask", () => {
  it("keeps the first mask unchanged", () => {
    const result = stateFor([0, 0.25, 0.75, 1], 2, 2);
    expect(Array.from(result.values)).toEqual([0, 0.25, 0.75, 1]);
  });

  it("damps small confidence changes on uncertain edges", () => {
    const previous = stateFor([0.5], 1, 1);
    const result = stabilizePersonMask(
      new Float32Array([0.53]),
      1,
      1,
      previous,
    );

    expect(result.values[0]).toBeGreaterThan(0.5);
    expect(result.values[0]).toBeLessThan(0.53);
  });

  it("acquires newly occupied foreground without blending it below cutoff", () => {
    const previous = stateFor([0], 1, 1);
    const result = stabilizePersonMask(
      new Float32Array([0.5]),
      1,
      1,
      previous,
    );

    expect(result.values[0]).toBe(0.5);
    expect(shapePersonMaskAlpha(result.values)[0]).toBeGreaterThanOrEqual(253);
  });

  it("follows foreground translation before blending", () => {
    const previous = stateFor(
      [
        0, 0, 1, 1, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0,
      ],
      8,
      2,
    );
    const result = stabilizePersonMask(
      new Float32Array([
        0, 0, 0, 1, 1, 0, 0, 0,
        0, 0, 0, 1, 1, 0, 0, 0,
      ]),
      8,
      2,
      previous,
    );

    expect(result.values[3]).toBe(1);
    expect(result.values[4]).toBe(1);
    expect(result.values[2]).toBe(0);
  });

  it("drops history on a discontinuous subject jump", () => {
    const previousValues = new Array(20).fill(0);
    previousValues[1] = 1;
    const currentValues = new Array(20).fill(0);
    currentValues[18] = 1;

    const previous = stateFor(previousValues, 20, 1);
    const result = stabilizePersonMask(
      new Float32Array(currentValues),
      20,
      1,
      previous,
    );

    expect(Array.from(result.values)).toEqual(currentValues);
  });

  it("clears a decisively vacated body pixel on the current inference", () => {
    const previous = stateFor([1], 1, 1);
    const cleared = stabilizePersonMask(
      new Float32Array([0.15]),
      1,
      1,
      previous,
    );
    expect(cleared.values[0]).toBeCloseTo(0.15);
    expect(shapePersonMaskAlpha(cleared.values)[0]).toBe(0);
  });

  it("does not retain a trailing limb where the current mask is background", () => {
    const previousValues = new Array(20).fill(0);
    const currentValues = new Array(20).fill(0);
    for (let x = 6; x <= 15; x++) {
      previousValues[x] = 1;
      currentValues[x] = 1;
    }
    previousValues[1] = 1;
    previousValues[2] = 1;
    currentValues[1] = 0.15;
    currentValues[2] = 1;
    currentValues[3] = 1;

    const previous = stateFor(previousValues, 20, 1);
    const moved = stabilizePersonMask(
      new Float32Array(currentValues),
      20,
      1,
      previous,
    );
    const alpha = shapePersonMaskAlpha(moved.values);

    expect(alpha[1]).toBe(0);
    expect(alpha[2]).toBe(255);
    expect(alpha[3]).toBe(255);
    expect(alpha[10]).toBe(255);
  });

  it("does not move or expand a moving silhouette", () => {
    const previous = stateFor(
      new Array(100).fill(0).map((_, index) => (index === 44 ? 1 : 0)),
      10,
      10,
    );
    const current = stateFor(
      new Array(100).fill(0).map((_, index) => (index === 45 ? 1 : 0)),
      10,
      10,
    );
    const protective = createProtectivePersonMask(current, previous);

    expect(protective[46]).toBe(0);
    expect(protective[45]).toBe(1);
    expect(protective[47]).toBe(0);
  });
});

describe("refinePersonMaskEdges", () => {
  it("smooths toward same-color pixels without bleeding across a color edge", () => {
    const rgba = new Uint8ClampedArray([
      20, 20, 20, 255,
      20, 20, 20, 255,
      240, 240, 240, 255,
    ]);
    const refined = refinePersonMaskEdges(
      new Float32Array([1, 0.5, 0]),
      3,
      1,
      rgba,
      3,
      1,
    );

    expect(refined[1]).toBeGreaterThan(0.55);
    expect(refined[2]).toBeLessThan(0.15);
  });
});

describe("shapePersonMaskAlpha", () => {
  it("makes likely body pixels opaque with a narrow confidence feather", () => {
    const alpha = shapePersonMaskAlpha(
      new Float32Array([0, 0.28, 0.3, 0.4, 0.5, 0.52, 1]),
    );

    expect(Array.from(alpha)).toEqual([0, 0, 41, 191, 253, 255, 255]);
  });

  it("does not add coverage to neighboring background pixels", () => {
    const alpha = shapePersonMaskAlpha(new Float32Array([0, 0.5, 0]));

    expect(Array.from(alpha)).toEqual([0, 253, 0]);
  });
});

describe("createMotionAwareOcclusionMask", () => {
  const width = 7;
  const height = 3;
  const mask = new Uint8ClampedArray(width * height * 4);
  for (const x of [2, 3]) {
    const index = (width + x) * 4;
    mask[index] = 255;
    mask[index + 1] = 255;
    mask[index + 2] = 255;
    mask[index + 3] = 255;
  }

  const frameWithSubjectAt = (positions: number[]) => {
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index++) {
      frame[index * 4] = 240;
      frame[index * 4 + 1] = 240;
      frame[index * 4 + 2] = 240;
      frame[index * 4 + 3] = 255;
    }
    for (const x of positions) {
      const index = (width + x) * 4;
      frame[index] = 20;
      frame[index + 1] = 40;
      frame[index + 2] = 80;
    }
    return frame;
  };

  it("keeps an unchanged silhouette exactly the same size", () => {
    const frame = frameWithSubjectAt([2, 3]);
    const result = createMotionAwareOcclusionMask(
      mask,
      width,
      height,
      frame,
      new Uint8ClampedArray(frame),
      width,
      height,
    );

    expect(Array.from(result)).toEqual(Array.from(mask));
  });

  it("moves the silhouette without expanding it", () => {
    const result = createMotionAwareOcclusionMask(
      mask,
      width,
      height,
      frameWithSubjectAt([2, 3]),
      frameWithSubjectAt([4, 5]),
      width,
      height,
    );

    expect(result[(width + 2) * 4 + 3]).toBe(0);
    expect(result[(width + 3) * 4 + 3]).toBe(0);
    expect(result[(width + 4) * 4 + 3]).toBe(255);
    expect(result[(width + 5) * 4 + 3]).toBe(255);
    expect(
      Array.from(result).filter((_, index) => index % 4 === 3 && result[index] > 0),
    ).toHaveLength(2);
  });

  it("tracks separate body regions moving in opposite directions", () => {
    const localWidth = 32;
    const localHeight = 16;
    const localMask = new Uint8ClampedArray(localWidth * localHeight * 4);
    const reference = new Uint8ClampedArray(localWidth * localHeight * 4);
    const current = new Uint8ClampedArray(localWidth * localHeight * 4);
    for (let index = 0; index < localWidth * localHeight; index++) {
      reference[index * 4] = current[index * 4] = 240;
      reference[index * 4 + 1] = current[index * 4 + 1] = 240;
      reference[index * 4 + 2] = current[index * 4 + 2] = 240;
      reference[index * 4 + 3] = current[index * 4 + 3] = 255;
    }
    const paintRegion = (
      rgba: Uint8ClampedArray,
      startX: number,
      color: [number, number, number],
      paintMask: boolean,
    ) => {
      for (let y = 6; y < 10; y++) {
        for (let x = startX; x < startX + 4; x++) {
          const index = (y * localWidth + x) * 4;
          rgba[index] = color[0];
          rgba[index + 1] = color[1];
          rgba[index + 2] = color[2];
          if (paintMask) {
            localMask[index] = 255;
            localMask[index + 1] = 255;
            localMask[index + 2] = 255;
            localMask[index + 3] = 255;
          }
        }
      }
    };
    paintRegion(reference, 5, [180, 30, 40], true);
    paintRegion(reference, 20, [30, 60, 190], true);
    paintRegion(current, 8, [180, 30, 40], false);
    paintRegion(current, 17, [30, 60, 190], false);

    const result = createMotionAwareOcclusionMask(
      localMask,
      localWidth,
      localHeight,
      reference,
      current,
      localWidth,
      localHeight,
    );

    expect(result[(7 * localWidth + 8) * 4 + 3]).toBe(255);
    expect(result[(7 * localWidth + 17) * 4 + 3]).toBe(255);
    expect(result[(7 * localWidth + 5) * 4 + 3]).toBe(0);
    expect(result[(7 * localWidth + 23) * 4 + 3]).toBe(0);
  });

  it("tracks a fast limb independently of a stationary torso", () => {
    const localWidth = 192;
    const localHeight = 64;
    const localMask = new Uint8ClampedArray(localWidth * localHeight * 4);
    const reference = new Uint8ClampedArray(localWidth * localHeight * 4);
    const current = new Uint8ClampedArray(localWidth * localHeight * 4);
    for (let index = 0; index < localWidth * localHeight; index++) {
      reference[index * 4] = current[index * 4] = 235;
      reference[index * 4 + 1] = current[index * 4 + 1] = 235;
      reference[index * 4 + 2] = current[index * 4 + 2] = 235;
      reference[index * 4 + 3] = current[index * 4 + 3] = 255;
    }
    const paint = (
      rgba: Uint8ClampedArray,
      startX: number,
      endX: number,
      startY: number,
      endY: number,
      color: [number, number, number],
      includeInMask: boolean,
    ) => {
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const index = (y * localWidth + x) * 4;
          rgba[index] = color[0];
          rgba[index + 1] = color[1];
          rgba[index + 2] = color[2];
          if (includeInMask) {
            localMask[index] = 255;
            localMask[index + 1] = 255;
            localMask[index + 2] = 255;
            localMask[index + 3] = 255;
          }
        }
      }
    };
    // The large torso keeps global flow at zero while the arm moves fourteen
    // pixels, beyond the previous local search radius of eight.
    paint(reference, 80, 112, 16, 48, [30, 60, 180], true);
    paint(current, 80, 112, 16, 48, [30, 60, 180], false);
    paint(reference, 20, 28, 24, 32, [190, 40, 50], true);
    paint(current, 34, 42, 24, 32, [190, 40, 50], false);

    const result = createMotionAwareOcclusionMask(
      localMask,
      localWidth,
      localHeight,
      reference,
      current,
      localWidth,
      localHeight,
    );

    expect(result[(27 * localWidth + 37) * 4 + 3]).toBeGreaterThan(240);
    expect(result[(27 * localWidth + 23) * 4 + 3]).toBeLessThan(16);
    expect(result[(30 * localWidth + 95) * 4 + 3]).toBe(255);
  });
});
