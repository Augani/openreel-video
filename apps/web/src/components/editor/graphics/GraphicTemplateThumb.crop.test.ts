import { describe, expect, it } from "vitest";
import { useGraphicTemplatesStore } from "../../../stores/graphic-templates-store";
import { templateCaption } from "./GraphicTemplateThumb";

describe("template thumbnail caption", () => {
  it("captions a template with its category and duration, not its internals", () => {
    const template = useGraphicTemplatesStore.getState().list()[0];
    const caption = templateCaption(template);
    expect(caption).toMatch(/ · \d+(\.\d)?s$/);
    expect(caption).not.toMatch(/controls|layers/);
  });
});
