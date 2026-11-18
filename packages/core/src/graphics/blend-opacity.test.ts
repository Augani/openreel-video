import { describe, expect, it } from "vitest";
import { overlayBlendAlpha } from "./blend-opacity";
import { BUILT_IN_EDITING_TEMPLATES } from "../editing-templates/built-in-templates";
import { resolveEditingTemplate } from "../editing-templates/resolver";

describe("overlayBlendAlpha", () => {
  it("reads the project's 0-100 scale as a 0..1 alpha", () => {
    expect(overlayBlendAlpha({ blendOpacity: 22 })).toBeCloseTo(0.22);
    expect(overlayBlendAlpha({ blendMode: "normal", blendOpacity: 100 })).toBe(1);
    expect(overlayBlendAlpha({ blendOpacity: 250 })).toBe(1);
    expect(overlayBlendAlpha({ blendOpacity: -5 })).toBe(0);
  });

  it("is neutral when unset, and when the clip is drawn by the blend-mode (three.js) path that applies it itself", () => {
    expect(overlayBlendAlpha({})).toBe(1);
    expect(overlayBlendAlpha({ blendMode: "multiply", blendOpacity: 40 })).toBe(1);
  });
});

describe("template blendOpacity", () => {
  it("resolves the authored 0..1 control to the project's 0-100 scale, so the Frame Opacity control works", () => {
    const frame = BUILT_IN_EDITING_TEMPLATES.find((template) => template.id === "cinema-light-frame")!;
    const context = { clip: { id: "c", startTime: 0, duration: 4, name: "c" }, assetUrls: {} };
    const defaults = resolveEditingTemplate(frame, context);
    expect(defaults.overlays[0].blendOpacity).toBeCloseTo(22);
    const faint = resolveEditingTemplate(frame, context, { frameOpacity: 0.5 });
    expect(faint.overlays[0].blendOpacity).toBeCloseTo(50);
  });
});
