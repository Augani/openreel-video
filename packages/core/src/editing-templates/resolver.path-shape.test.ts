import { describe, expect, it } from "vitest";
import { resolveEditingTemplate } from "./resolver";
import type { EditingTemplate, EditingTemplateResolutionContext } from "./types";

const transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

describe("resolveEditingTemplate path shapes", () => {
  it("carries pathData, points and closed through to the resolved overlay", () => {
    const template = {
      id: "t",
      name: "t",
      description: "",
      category: "test",
      tags: [],
      supportedTargets: ["video"],
      controls: [],
      recipe: {
        effects: [],
        audioEffects: [],
        overlays: [
          {
            type: "shape",
            trackType: "graphics",
            timing: "full",
            transform,
            keyframes: [],
            content: {
              shapeType: "path",
              width: 100,
              height: 100,
              pathData: "M 0 0 L 1 1 Z",
              points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
              closed: true,
            },
          },
        ],
      },
    } as unknown as EditingTemplate;
    const context = {
      clip: { id: "c", startTime: 0, duration: 4, name: "c" },
    } as unknown as EditingTemplateResolutionContext;

    const overlay = resolveEditingTemplate(template, context).overlays[0];
    expect(overlay.type).toBe("shape");
    if (overlay.type !== "shape") return;
    expect(overlay.content).toMatchObject({
      shapeType: "path",
      pathData: "M 0 0 L 1 1 Z",
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      closed: true,
    });
  });
});

describe("built-in overlay templates", () => {
  const context = { clip: { id: "c", startTime: 0, duration: 4, name: "Clip" }, assetUrls: {} };

  it("never leaves a placeholder token in resolved text", async () => {
    const { BUILT_IN_EDITING_TEMPLATES } = await import("./built-in-templates");
    for (const template of BUILT_IN_EDITING_TEMPLATES) {
      for (const overlay of resolveEditingTemplate(template, context).overlays) {
        if (overlay.type === "text") expect(overlay.content.text, template.id).not.toMatch(/[{}]/);
      }
    }
  });

  it("resolves the follow callout label from its control", async () => {
    const { getBuiltInEditingTemplate } = await import("./registry");
    const template = getBuiltInEditingTemplate("overlay-follow-callout")!;
    const [overlay] = resolveEditingTemplate(template, context, { label: "Subscribe" }).overlays;
    expect(overlay.type === "text" && overlay.content.text).toBe("Subscribe");
    const [defaulted] = resolveEditingTemplate(template, context).overlays;
    expect(defaulted.type === "text" && defaulted.content.text).toBe("Follow +");
  });
});
