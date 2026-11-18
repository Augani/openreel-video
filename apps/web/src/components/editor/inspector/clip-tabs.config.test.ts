import { describe, it, expect } from "vitest";
import { getInspectorTabForSection } from "./clip-tabs.config";

describe("clip-tabs.config", () => {

  it("routes the same retained feature to its actual presentation panel", () => {
    expect(getInspectorTabForSection("video", "keyframes")).toBe("transform");
    expect(getInspectorTabForSection("text", "keyframes")).toBe("animate");
    expect(getInspectorTabForSection("svg", "video-effects")).toBe("effects");
    expect(getInspectorTabForSection("text", "video-effects")).toBe("transform");
    expect(getInspectorTabForSection("svg", "svg-properties")).toBe("style");
    expect(getInspectorTabForSection("svg", "shape-properties")).toBeNull();
    expect(getInspectorTabForSection("sticker", "speed")).toBeNull();
    expect(getInspectorTabForSection(null, "transform")).toBeNull();
  });

});
