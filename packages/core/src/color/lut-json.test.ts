import { describe, expect, it } from "vitest";
import { parseCubeLut, parseCubeToLutData } from "./cube-lut";
import { lutFromJson, lutToJson, serializeCubeLut } from "./lut-json";
import { createLook, createLutEntry, gradingFromLook, LookError } from "./looks";
import { planColorGrading } from "../video/lumetri-pipeline";
import { isNeutralColorGrading } from "../video/color-grading-defaults";
import type { LUTData } from "../video/color-grading-engine";

const CUBE_3D = `TITLE "warm"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0.5 1
1 0.5 1
0 1 1
1 1 1
`;

const CUBE_1D = `LUT_1D_SIZE 3
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
0.25 0.25 0.25
1 1 1
`;

describe("serializeCubeLut", () => {
  it("round trips a 3D LUT through the parser", () => {
    const lut = parseCubeToLutData(CUBE_3D);
    const text = serializeCubeLut(lut, { title: "warm" });
    expect(text).toContain('TITLE "warm"');
    expect(text).toContain("LUT_3D_SIZE 2");
    const back = parseCubeLut(text);
    expect(back.kind).toBe("3d");
    expect(back.size).toBe(2);
    const orig = parseCubeLut(CUBE_3D);
    for (let i = 0; i < orig.data.length; i++) {
      expect(back.data[i]).toBeCloseTo(orig.data[i], 5);
    }
  });

  it("writes an exact 1D curve as LUT_1D_SIZE and round trips it", () => {
    const lut = parseCubeToLutData(CUBE_1D);
    const text = serializeCubeLut(lut);
    expect(text).toContain("LUT_1D_SIZE 3");
    const back = parseCubeLut(text);
    expect(back.kind).toBe("1d");
    expect(back.data[3]).toBeCloseTo(0.25, 5);
  });

  it("bakes the intensity toward identity", () => {
    const lut: LUTData = { ...parseCubeToLutData(CUBE_3D), intensity: 0.5 };
    const half = parseCubeLut(serializeCubeLut(lut));
    // table entry (r=1,g=0,b=0) is 1,0,0 in file; entry index 1 of identity is also 1,0,0
    // entry (0,0.5,1) at index 4 is identity (0,0,1) -> halfway (0,0.25,1)
    expect(half.data[4 * 3 + 1]).toBeCloseTo(0.25, 5);
    const raw = parseCubeLut(serializeCubeLut(lut, { bakeIntensity: false }));
    expect(raw.data[4 * 3 + 1]).toBeCloseTo(0.5, 5);
  });

  it("json conversion is lossless", () => {
    const lut = parseCubeToLutData(CUBE_1D);
    const back = lutFromJson(JSON.parse(JSON.stringify(lutToJson(lut))));
    expect(Array.from(back.curve1d?.data ?? [])).toEqual(
      Array.from(lut.curve1d?.data ?? []),
    );
    expect(back.size).toBe(lut.size);
    expect(back.data).toBeInstanceOf(Uint8Array);
  });
});

describe("looks and library entries", () => {
  const lut = lutToJson(parseCubeToLutData(CUBE_3D));

  it("saves a deep copy of a non-neutral grade and applies it back", () => {
    const grading = { temperature: 20, lut, pipelineVersion: 2 as const };
    const look = createLook("  Warm  ", grading, { id: "l1", now: 5 });
    expect(look).toMatchObject({ id: "l1", name: "Warm", createdAt: 5 });
    grading.temperature = 0;
    expect(look.grading.temperature).toBe(20);
    const applied = gradingFromLook(look);
    expect(applied).toEqual(look.grading);
    expect(applied).not.toBe(look.grading);
  });

  it("rejects blank names and neutral grades", () => {
    expect(() => createLook("", { temperature: 10 })).toThrow(LookError);
    expect(() => createLook("x", undefined)).toThrow(LookError);
    expect(() => createLook("x", { temperature: 0 })).toThrow(LookError);
  });

  it("counts an input LUT as a grade", () => {
    expect(createLook("log", { inputLut: lut }).grading.inputLut).toBeDefined();
  });

  it("creates library entries with kind and size", () => {
    const e = createLutEntry("Rec709", lut);
    expect(e.kind).toBe("3d");
    expect(e.size).toBe(2);
    expect(createLutEntry("c", lutToJson(parseCubeToLutData(CUBE_1D))).kind).toBe("1d");
  });
});

describe("input LUT in the grading plan", () => {
  const input = parseCubeToLutData(CUBE_3D);

  it("is planned separately from the creative LUT, in both pipelines", () => {
    for (const pipelineVersion of [1, 2] as const) {
      const plan = planColorGrading({ pipelineVersion, inputLut: input, lut: input });
      expect(plan.inputLut).toBe(input);
      expect(plan.cpu?.lut).toBe(input);
      expect(plan.cpu).not.toHaveProperty("inputLut");
    }
  });

  it("is null when absent or at zero intensity", () => {
    expect(planColorGrading({}).inputLut).toBeNull();
    expect(planColorGrading({ inputLut: { ...input, intensity: 0 } }).inputLut).toBeNull();
  });

  it("makes an otherwise neutral grade non-neutral", () => {
    expect(isNeutralColorGrading({})).toBe(true);
    expect(isNeutralColorGrading({ inputLut: input })).toBe(false);
  });
});
