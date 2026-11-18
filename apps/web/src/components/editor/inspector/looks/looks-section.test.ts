import { describe, expect, it } from "vitest";
import { sameLut } from "./LooksAndLutsSection";

describe("sameLut", () => {
  const table = (fill: number) => ({ size: 2, data: Array.from({ length: 24 }, (_, i) => (i * fill) % 255) });
  it("recognises the table a LUT card applied, and rejects a different one", () => {
    expect(sameLut(table(10), { ...table(10), data: new Uint8Array(table(10).data) })).toBe(true);
    expect(sameLut(table(10), table(11))).toBe(false);
    expect(sameLut(table(10), { size: 3, data: table(10).data })).toBe(false);
    expect(sameLut(undefined, table(10))).toBe(false);
  });
});
