import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("./desktop-theme.css", import.meta.url)), "utf8");

describe("desktop-theme.css", () => {
  it("scopes overrides under .openreel-desktop", () => {
    expect(css).toContain(".openreel-desktop");
  });
  it("retints the accent to emerald and surfaces to charcoal", () => {
    expect(css).toMatch(/--accent:\s*oklch\([^)]*16[0-9]/);
    expect(css).toMatch(/--bg:\s*oklch\(0\.1[0-9]/);
  });
  it("defines the full surface ramp + border tokens it overrides", () => {
    for (const token of ["--bg", "--bg-1", "--bg-2", "--bg-3", "--border", "--accent", "--accent-strong"]) {
      expect(css).toContain(`${token}:`);
    }
  });
});
