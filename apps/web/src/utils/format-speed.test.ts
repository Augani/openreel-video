import { describe, expect, it } from "vitest";
import { formatSpeed } from "./format-speed";

describe("formatSpeed", () => {
  it("rounds to at most three decimals and trims zeros", () => {
    expect(formatSpeed(0.6060606)).toBe("0.606");
    expect(formatSpeed(1)).toBe("1");
    expect(formatSpeed(1.5)).toBe("1.5");
    expect(formatSpeed(2.0004)).toBe("2");
    expect(formatSpeed(Number.NaN)).toBe("0");
  });
});
