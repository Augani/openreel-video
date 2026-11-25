import { describe, expect, it } from "vitest";
import type { ComplianceResult } from "@openreel/core";
import { describeVerdict, isSilentCompliance } from "./export-loudness-report";

const make = (measured: number, pass: boolean): ComplianceResult =>
  ({
    specLabel: "EBU R128",
    pass,
    checks: [{ id: "loudness", label: "Integrated loudness", measured, requirement: "-23 LUFS", pass }],
  }) as unknown as ComplianceResult;

describe("export loudness verdict", () => {
  it("reports n/a (silence) for a silent export instead of not compliant", () => {
    const silent = make(Number.NEGATIVE_INFINITY, false);
    expect(isSilentCompliance(silent)).toBe(true);
    expect(describeVerdict(silent)).toBe("n/a (silence)");
  });
  it("keeps compliant / not compliant for audible programs", () => {
    expect(describeVerdict(make(-23, true))).toBe("compliant");
    expect(describeVerdict(make(-10, false))).toBe("not compliant");
  });
});
