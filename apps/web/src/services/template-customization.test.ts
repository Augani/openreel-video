import { describe, expect, it } from "vitest";
import { TemplateEngine, type ExtendedPlaceholder } from "@openreel/core";
import {
  buildTemplateReplacements,
  displayTemplateField,
  orderedTemplateFields,
  readTemplateDraft,
  templateColorHex,
} from "./template-customization";
const engine = new TemplateEngine();
const field = (
  type: ExtendedPlaceholder["type"],
  defaultValue: unknown,
): ExtendedPlaceholder => ({
  id: "value",
  type,
  label: "Value",
  required: true,
  defaultValue,
  targets: [],
});
const build = (fields: ExtendedPlaceholder[], drafts = {}) =>
  buildTemplateReplacements(fields, drafts, (item, value) =>
    engine.validatePlaceholderValue(item, value),
  );
describe("typed template customization drafts", () => {
  it("displays structured defaults as editable JSON and independently copies untouched data", () => {
    const item = field("style", {
      shader: {
        shaderId: "paper-mesh-gradient",
        params: { color1: "#ee44aa" },
        progress: 0.37,
      },
    });
    expect(JSON.parse(String(displayTemplateField(item)))).toEqual(
      item.defaultValue,
    );
    const result = build([item]);
    expect(result.errors).toEqual({});
    expect(result.replacements.value.value).toEqual(item.defaultValue);
    expect(result.replacements.value.value).not.toBe(item.defaultValue);
  });
  it("parses structured changes without losing zeros or arrays", () => {
    expect(
      readTemplateDraft(
        field("transform", {}),
        '{"opacity":0,"position":{"x":0,"y":0.37},"keys":[0,1]}',
      ),
    ).toEqual({
      value: { opacity: 0, position: { x: 0, y: 0.37 }, keys: [0, 1] },
    });
  });
  it.each(["{", "null"])(
    "rejects an incomplete or non-object advanced draft: %s",
    (value) => {
      expect(build([field("style", {})], { value }).errors.value).toContain(
        "valid JSON",
      );
    },
  );
  it.each(["", "NaN"])(
    "does not turn invalid numeric draft %s into zero",
    (value) => {
      expect(build([field("number", 0.37)], { value }).errors.value).toContain(
        "finite number",
      );
    },
  );
  it("keeps exact fractional, negative, zero and false values", () => {
    expect(readTemplateDraft(field("number", 1), "0.37").value).toBe(0.37);
    expect(readTemplateDraft(field("number", 1), "-0.125").value).toBe(-0.125);
    expect(
      build([field("number", 1)], { value: "0" }).replacements.value.value,
    ).toBe(0);
    expect(
      build([field("boolean", true)], { value: false }).replacements.value
        .value,
    ).toBe(false);
  });
  it("preserves an intentional empty optional text value", () => {
    expect(
      build([{ ...field("text", "Default"), required: false }], { value: "" })
        .replacements.value.value,
    ).toBe("");
  });
  it("turns picker RGB/alpha values into the accepted hex contract including transparent zero", () => {
    expect(templateColorHex("rgba(10, 20, 30, 0.5)")).toBe("#0a141e80");
    expect(templateColorHex("#12345600")).toBe("#12345600");
    expect(templateColorHex("invalid")).toBeNull();
  });
  it("honors display order without mutating the template's target application order", () => {
    const a = {
        ...field("text", "A"),
        id: "a",
        uiHints: { inputType: "text" as const, order: 2 },
      },
      b = {
        ...field("text", "B"),
        id: "b",
        uiHints: { inputType: "text" as const, order: 1 },
      };
    const fields = [a, b];
    expect(orderedTemplateFields(fields).map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
    expect(fields.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
