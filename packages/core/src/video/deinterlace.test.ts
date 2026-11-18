import { describe, expect, it } from "vitest";
import { bobFieldIndex, deinterlaceImage, type RasterImage } from "./deinterlace";

/** A 4x6 frame of two fields shot at different instants: even rows 200, odd rows 40 (combed). */
function combed(): RasterImage {
  const width = 4;
  const height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = y % 2 === 0 ? 200 : 40;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
const rowValues = (img: RasterImage): number[] => Array.from({ length: img.height }, (_, y) => img.data[y * img.width * 4]);

describe("deinterlaceImage", () => {
  it("leaves progressive footage and mode none untouched", () => {
    const frame = combed();
    expect(deinterlaceImage(frame, "progressive", "blend")).toBe(frame);
    expect(deinterlaceImage(frame, "upper", "none")).toBe(frame);
  });

  it("blend removes the combing: adjacent rows no longer alternate", () => {
    const out = deinterlaceImage(combed(), "upper", "blend");
    expect(rowValues(out)).toEqual([120, 120, 120, 120, 120, 120]);
    expect(out.data[3]).toBe(255);
  });

  it("bob keeps the upper field when it is first and rebuilds the other rows from it", () => {
    const out = deinterlaceImage(combed(), "upper", "bob", 0);
    expect(rowValues(out)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("bob of a lower-first source keeps the odd rows", () => {
    const out = deinterlaceImage(combed(), "lower", "bob", 0);
    expect(rowValues(out)).toEqual([40, 40, 40, 40, 40, 40]);
  });

  it("the second bob field is the other parity", () => {
    expect(rowValues(deinterlaceImage(combed(), "upper", "bob", 1))).toEqual([40, 40, 40, 40, 40, 40]);
  });

  it("does not modify the source buffer", () => {
    const frame = combed();
    const before = Array.from(frame.data);
    deinterlaceImage(frame, "upper", "blend");
    expect(Array.from(frame.data)).toEqual(before);
  });
});

describe("bobFieldIndex (field order conform)", () => {
  it("keeps the first field when the sequence is progressive or the orders agree", () => {
    expect(bobFieldIndex("upper", undefined)).toBe(0);
    expect(bobFieldIndex("upper", "progressive")).toBe(0);
    expect(bobFieldIndex("upper", "upper")).toBe(0);
  });
  it("takes the other field when source and sequence orders differ", () => {
    expect(bobFieldIndex("upper", "lower")).toBe(1);
    expect(bobFieldIndex("lower", "upper")).toBe(1);
  });
});
