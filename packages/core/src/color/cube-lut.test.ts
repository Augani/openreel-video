import { describe, expect, it } from "vitest";
import {
  CubeLutError,
  cubeLutToTable,
  parseCubeLut,
  parseCubeToLutData,
  sampleCubeLut,
} from "./cube-lut";

function identity3d(size: number, header = ""): string {
  const rows: string[] = [];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        rows.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
  return `${header}LUT_3D_SIZE ${size}\n${rows.join("\n")}\n`;
}

describe("parseCubeLut", () => {
  it("parses comments, TITLE, blank lines and CRLF", () => {
    const text =
      '# hello\r\n\r\nTITLE "My # LUT"\r\nLUT_3D_SIZE 2 # trailing\r\n' +
      "0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1\r\n";
    const lut = parseCubeLut(text);
    expect(lut.title).toBe("My # LUT");
    expect(lut.kind).toBe("3d");
    expect(lut.size).toBe(2);
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
  });

  it("identity 3D LUT is identity within 1e-4", () => {
    const lut = parseCubeLut(identity3d(5));
    for (const rgb of [
      [0.13, 0.5, 0.97],
      [0, 1, 0.33],
      [0.77, 0.2, 0.01],
    ] as const) {
      const out = sampleCubeLut(lut, rgb);
      out.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThan(1e-4));
    }
  });

  it("identity 1D LUT is identity within 1e-4 and resamples to an identity 3D table", () => {
    const lut = parseCubeLut("LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1\n");
    expect(lut.kind).toBe("1d");
    const out = sampleCubeLut(lut, [0.3, 0.6, 0.9]);
    [0.3, 0.6, 0.9].forEach((v, i) =>
      expect(Math.abs(out[i] - v)).toBeLessThan(1e-4),
    );
    const table = cubeLutToTable(lut, 5);
    expect(table.size).toBe(5);
    // red=1, green=0.5, blue=0 => index ((b*5+g)*5+r)
    const i = ((0 * 5 + 2) * 5 + 4) * 3;
    expect(table.floatData[i]).toBeCloseTo(1, 5);
    expect(table.floatData[i + 1]).toBeCloseTo(0.5, 5);
    expect(table.floatData[i + 2]).toBeCloseTo(0, 5);
  });

  it("1D LUT applies per channel (non-identity)", () => {
    const lut = parseCubeLut("LUT_1D_SIZE 2\n0 0.2 1\n1 0.8 0\n");
    const out = sampleCubeLut(lut, [0.5, 0.5, 0.25]);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.75, 6);
  });

  it("honors a non-default 1D domain", () => {
    const lut = parseCubeLut(
      "DOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 3 3 3\nLUT_1D_SIZE 2\n0 0 0\n1 1 1\n",
    );
    // input 1 is the middle of [-1,3]
    expect(sampleCubeLut(lut, [1, 1, 1])[0]).toBeCloseTo(0.5, 6);
    // clamped outside the domain
    expect(sampleCubeLut(lut, [9, -9, 3])).toEqual([1, 0, 1]);
  });

  it("honors a non-default 3D domain and bakes it into a normalised table", () => {
    const size = 3;
    const rows: string[] = [];
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++) rows.push(`${r / 2} ${g / 2} ${b / 2}`);
    const lut = parseCubeLut(
      `DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\nLUT_3D_SIZE 3\n${rows.join("\n")}\n`,
    );
    const out = sampleCubeLut(lut, [1, 0.5, 2]);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.25, 6);
    expect(out[2]).toBeCloseTo(1, 6);
    // The table is indexed by input normalised over the domain: r=0, g=0.5, b=1.
    const table = cubeLutToTable(lut);
    const idx = ((2 * 3 + 1) * 3 + 0) * 3;
    expect(table.floatData[idx]).toBeCloseTo(0, 6);
    expect(table.floatData[idx + 1]).toBeCloseTo(0.5, 6);
    expect(table.floatData[idx + 2]).toBeCloseTo(1, 6);
  });

  it("keeps float precision and out-of-range outputs", () => {
    const lut = parseCubeLut("LUT_1D_SIZE 2\n0.123456789 -0.25 0\n1.5 1 0\n");
    expect(lut.data).toBeInstanceOf(Float32Array);
    expect(lut.data[0]).toBeCloseTo(0.123456789, 6);
    expect(lut.data[1]).toBeCloseTo(-0.25, 6);
    expect(lut.data[3]).toBeCloseTo(1.5, 6);
  });

  it("parseCubeToLutData returns float and 8-bit tables of the same size", () => {
    const d = parseCubeToLutData(identity3d(2));
    expect(d.size).toBe(2);
    expect(d.floatData).toBeInstanceOf(Float32Array);
    expect(d.data.length).toBe(24);
    expect(d.data[3]).toBe(255);
    expect(d.intensity).toBe(1);
  });

  it("reports clear errors for malformed files", () => {
    const bad = (text: string, message: RegExp) =>
      expect(() => parseCubeLut(text)).toThrow(message);
    bad("", /size not specified/);
    bad("LUT_3D_SIZE 1\n", /out of range/);
    bad("LUT_3D_SIZE 257\n", /out of range/);
    bad("LUT_1D_SIZE 1\n", /out of range/);
    bad("LUT_3D_SIZE abc\n", /Invalid LUT_3D_SIZE/);
    bad("LUT_3D_SIZE 2.5\n", /Invalid LUT_3D_SIZE/);
    bad("LUT_1D_SIZE 2\n0 0 0\n", /expected 2 rows.*got 1/);
    bad("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n1 1 1\n", /Too many table rows/);
    bad("LUT_3D_SIZE 2\n" + "0 0 0\n".repeat(7), /expected 8 rows.*got 7/);
    bad("0 0 0\nLUT_1D_SIZE 2\n", /before LUT_1D_SIZE/);
    bad("LUT_1D_SIZE 2\n0 0 x\n1 1 1\n", /Invalid number "x".*line 2/);
    bad("LUT_1D_SIZE 2\n0 0\n1 1 1\n", /3 values per table row/);
    bad(
      "LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1\n",
      /DOMAIN_MAX must be greater/,
    );
    bad(
      "LUT_1D_SIZE 2\nDOMAIN_MIN 0 0\n0 0 0\n1 1 1\n",
      /DOMAIN_MIN needs exactly 3/,
    );
    bad("LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n", /both/);
    bad("LUT_1D_SIZE 2\nnan 0 0\n1 1 1\n", /Invalid number "nan"/);
    bad("LUT_1D_SIZE 2\n0 0 NaN\n1 1 1\n", /Invalid number/);
  });

  it("tolerates optional range keywords and unknown keywords with warnings", () => {
    const lut = parseCubeLut(
      "LUT_1D_SIZE 2\nLUT_1D_INPUT_RANGE 0 1\nFOO 1\n0 0 0\n1 1 1\n",
    );
    expect(lut.warnings).toHaveLength(2);
    expect(lut.data.length).toBe(6);
  });

  it("handles a BOM and an unquoted TITLE", () => {
    const lut = parseCubeLut("\uFEFFTITLE My Look # c\nLUT_1D_SIZE 2\n0 0 0\n1 1 1\n");
    expect(lut.title).toBe("My Look");
  });

  it("honors DOMAIN_MIN > 0 in the 8-bit fallback table", () => {
    const d = parseCubeToLutData(
      "LUT_1D_SIZE 2\nDOMAIN_MIN 0.5 0.5 0.5\nDOMAIN_MAX 1 1 1\n0 0 0\n1 1 1\n",
    );
    // Normalised index 0 maps to domain 0.5 -> output 0; index 1 -> 1.
    expect(d.data[0]).toBe(0);
    expect(d.data[d.data.length - 1]).toBe(255);
  });

  it("keeps a nonlinear 1D curve exact in curve1d", () => {
    const n = 17;
    const rows = Array.from({ length: n }, (_, i) => {
      const v = Math.pow(i / (n - 1), 2.2);
      return `${v} ${v} ${v}`;
    }).join("\n");
    const d = parseCubeToLutData(`LUT_1D_SIZE ${n}\n${rows}\n`);
    expect(d.curve1d?.size).toBe(n);
    expect(d.curve1d?.data).toBeInstanceOf(Float32Array);
    expect(d.curve1d?.data[8 * 3]).toBeCloseTo(Math.pow(0.5, 2.2), 5);
  });

  it("throws CubeLutError", () => {
    expect(() => parseCubeLut("")).toThrow(CubeLutError);
  });
});
