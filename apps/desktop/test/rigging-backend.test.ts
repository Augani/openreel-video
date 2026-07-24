import { describe, it, expect } from "vitest";
import { parseBlenderVersion } from "../src/main/sidecar/rigging-backend";

describe("parseBlenderVersion", () => {
  it("parses a stable Blender version line", () => {
    expect(parseBlenderVersion("Blender 4.3.2\nbuild date: 2025-01-01")).toBe("4.3.2");
  });

  it("parses a two-part Blender version line", () => {
    expect(parseBlenderVersion("Blender 4.2 LTS")).toBe("4.2");
  });

  it("returns null when no Blender version is present", () => {
    expect(parseBlenderVersion("not blender")).toBeNull();
  });
});
