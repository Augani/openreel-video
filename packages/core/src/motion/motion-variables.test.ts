import { describe, expect, it } from "vitest";
import type { MotionComposition } from "./types";
import {
  createMotionVariable,
  removeMotionCompositionVariable,
  updateMotionCompositionVariable,
} from "./motion-variables";

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion variables", () => {
  it("creates typed variables with safe defaults and coercion", () => {
    expect(createMotionVariable("text", { id: "text-1" })).toMatchObject({
      id: "text-1",
      name: "Text",
      value: "",
    });
    expect(
      createMotionVariable("number", { id: "num-1", value: "42" }),
    ).toMatchObject({
      id: "num-1",
      type: "number",
      value: 42,
    });
    expect(
      createMotionVariable("boolean", { id: "bool-1", value: "true" }),
    ).toMatchObject({
      id: "bool-1",
      type: "boolean",
      value: true,
    });
  });

  it("updates and removes composition variables immutably", () => {
    const variable = createMotionVariable("text", {
      id: "var-1",
      name: "Headline",
      value: "Launch",
    });
    const composition = { ...makeComposition(), variables: [variable] };
    const updated = updateMotionCompositionVariable(
      composition,
      "var-1",
      (current) => ({ ...current, type: "color", value: "" }),
    );

    expect(composition.variables[0]).toBe(variable);
    expect(updated.variables[0]).toMatchObject({
      id: "var-1",
      name: "Headline",
      type: "color",
      value: "#14b8a6",
    });
    expect(removeMotionCompositionVariable(updated, "var-1").variables).toEqual([]);
  });
});
