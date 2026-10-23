import { describe, expect, it } from "vitest";
import { lineDirection } from "./title-engine";

describe("lineDirection", () => {
  it("is rtl for lines that start with Arabic, even with Latin or digits inside", () => {
    expect(lineDirection("إذن المجموع أربعون دينار.")).toBe("rtl");
    expect(lineDirection("«مرحبا» TikTok 2026")).toBe("rtl");
    expect(lineDirection("12 دينار")).toBe("rtl");
  });
  it("is ltr for Latin lines and lines without letters", () => {
    expect(lineDirection("Hello عيون المخرج")).toBe("ltr");
    expect(lineDirection("00:12")).toBe("ltr");
    expect(lineDirection("")).toBe("ltr");
  });
});
