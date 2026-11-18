import { describe, expect, it } from "vitest";
import { getBuiltInGraphicTemplate } from "./built-in-templates";
import { applyParameters, resolveParamValues } from "./expand";
import { updateLayer } from "./layer-ops";

const classic = getBuiltInGraphicTemplate("builtin-lt-classic-bar");
if (!classic) throw new Error("Classic Bar template is missing");

describe("updateLayer visibility", () => {
  it("moves a single-target visibility control with the layer so the hidden layer stays hidden", () => {
    const hidden = updateLayer(classic, "title", { visible: false });
    expect(hidden.parameters.find((p) => p.id === "showTitle")?.defaultValue).toBe(false);
    const layers = applyParameters(hidden, resolveParamValues(hidden, {}));
    expect(layers.find((l) => l.id === "title")?.visible).toBe(false);
    const shown = updateLayer(hidden, "title", { visible: true });
    expect(shown.parameters.find((p) => p.id === "showTitle")?.defaultValue).toBe(true);
  });

  it("leaves parameters alone for layers without a visibility control", () => {
    const hidden = updateLayer(classic, "plate", { visible: false });
    expect(hidden.parameters).toBe(classic.parameters);
  });
});
