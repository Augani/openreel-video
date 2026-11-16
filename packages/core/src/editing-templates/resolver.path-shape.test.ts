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
