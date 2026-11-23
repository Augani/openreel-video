import { describe, expect, it } from "vitest";
import { getDefaultTransitionParams } from "@openreel/core";
import { TRANSITION_CARDS } from "./transition-cards";

describe("transition cards", () => {
  const cards = TRANSITION_CARDS;

  it("do not claim a direction for transitions that are configured by orientation", () => {
    for (const card of cards) {
      const params = getDefaultTransitionParams(card.type) as Record<string, unknown>;
      if ("orientation" in params) expect(card.hasDirection, `${card.type} hasDirection`).toBe(false);
    }
  });

  it("band wipe and barn door are oriented, not directed", () => {
    for (const type of ["bandWipe", "barnDoor"] as const) {
      const card = cards.find((c) => c.type === type)!;
      expect(card.hasDirection).toBe(false);
      expect(getDefaultTransitionParams(type)).toHaveProperty("orientation");
    }
  });

  it("report direction only for the transitions that read params.direction, orientation or corner otherwise", () => {
    for (const type of ["crossZoom", "pagePeel", "checkerboard", "checkerWipe", "inset", "split", "wedgeWipe", "randomBlocks", "randomWipe", "flipOver", "cubeSpin"] as const) {
      const card = cards.find((c) => c.type === type);
      expect(card, `${type} has a card`).toBeDefined();
      const params = getDefaultTransitionParams(type) as Record<string, unknown>;
      expect(card!.hasDirection, `${type} hasDirection`).toBe("direction" in params);
      expect(card!.hasCustomParams, `${type} hasCustomParams`).toBe(true);
    }
    expect(getDefaultTransitionParams("split")).toHaveProperty("orientation");
    expect(getDefaultTransitionParams("inset")).toHaveProperty("corner");
    expect(getDefaultTransitionParams("pagePeel")).toHaveProperty("corner");
  });

  it("has a card for every transition type exactly once", async () => {
    const { TRANSITION_TYPES } = await import("@openreel/core/types/effects");
    expect(cards.map((c) => c.type).sort()).toEqual([...TRANSITION_TYPES].sort());
  });

  it("Morph Cut's card says what it does and what it needs, and its defaults match", () => {
    const card = cards.find((c) => c.type === "morphCut")!;
    expect(card.name).toBe("Morph Cut");
    expect(card.description).toMatch(/jump cut/i);
    expect(card.description).toMatch(/analys/i);
    expect(card.description).toMatch(/cross dissolve/i);
    expect(card.hasDirection).toBe(false);
    expect(card.hasCustomParams).toBe(true);
    expect(getDefaultTransitionParams("morphCut")).toEqual({ quality: "medium", curve: "linear" });
  });
});
