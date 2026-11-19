import { describe, expect, it } from "vitest";
import { ECHO_CARD_STRIDE, POSTERIZE_CARD_HOLD, isTemporalCard, planTemporalCard } from "./temporal-preview";
import { previewNote } from "./preview-params";

const win = { count: 24, fps: 12, posterIndex: 0 };

describe("temporal effect cards", () => {
  it("recognises the two time effects only", () => {
    expect(isTemporalCard("echo")).toBe(true);
    expect(isTemporalCard("posterize-time")).toBe(true);
    expect(isTemporalCard("posterize")).toBe(false);
  });

  it("rests an Echo poster far enough into the window to have footage behind it", () => {
    const plan = planTemporalCard("echo", undefined, win, -1);
    expect(plan.frameIndex).toBe(2 * ECHO_CARD_STRIDE);
    expect(plan.trail.map((t) => t.index)).toEqual([2, 0]);
    expect(plan.trail.map((t) => t.weight)).toEqual([0.5, 0.25]);
    expect(plan.echo?.operator).toBe("add");
  });

  it("builds the trail up from the first hover frame, like the start of a clip", () => {
    expect(planTemporalCard("echo", undefined, win, 0).trail).toEqual([]);
    expect(planTemporalCard("echo", undefined, win, 2).trail.map((t) => t.index)).toEqual([0]);
    expect(planTemporalCard("echo", undefined, win, 9).trail.map((t) => t.index)).toEqual([7, 5]);
  });

  it("follows the card's own echo count, intensity and operator", () => {
    const plan = planTemporalCard("echo", { echoes: 3, decay: 0.8, operator: "screen" }, win, 12);
    expect(plan.trail.map((t) => t.index)).toEqual([10, 8, 6]);
    expect(plan.trail[1].weight).toBeCloseTo(0.64, 9);
    expect(plan.echo?.operator).toBe("screen");
    expect(planTemporalCard("echo", { operator: "composite-front", echoes: 3 }, win, 12).trail.map((t) => t.index)).toEqual([6, 8, 10]);
  });

  it("is deterministic for a frame and clamps inside a short window", () => {
    expect(planTemporalCard("echo", undefined, win, 9)).toEqual(planTemporalCard("echo", undefined, win, 9));
    const short = planTemporalCard("echo", undefined, { count: 3, fps: 12, posterIndex: 0 }, -1);
    expect(short.frameIndex).toBe(2);
    expect(short.trail.map((t) => t.index)).toEqual([0]);
    expect(planTemporalCard("echo", undefined, { count: 1, fps: 12, posterIndex: 0 }, -1).trail).toEqual([]);
  });

  it("holds Posterize Time frames for POSTERIZE_CARD_HOLD window frames", () => {
    const shown = Array.from({ length: 12 }, (_, i) => planTemporalCard("posterize-time", undefined, win, i).frameIndex);
    expect(shown).toEqual([0, 0, 0, 3, 3, 3, 6, 6, 6, 9, 9, 9]);
    expect(new Set(shown).size).toBe(12 / POSTERIZE_CARD_HOLD);
    expect(planTemporalCard("posterize-time", undefined, win, -1).frameIndex).toBe(0);
  });

  it("badges the Posterize Time card, whose poster looks like the source", () => {
    expect(previewNote({ type: "posterize-time" })).toBe("Hover to play");
    expect(previewNote({ type: "echo" })).toBeNull();
  });
});
