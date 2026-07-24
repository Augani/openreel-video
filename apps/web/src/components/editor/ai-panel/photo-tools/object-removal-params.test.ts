import { describe, it, expect } from "vitest";
import { buildObjectRemovalParams, type ObjectRemovalDraft } from "./object-removal-params";

const base: ObjectRemovalDraft = {
  mode: "erase",
  tool: "box",
  bbox: null,
  points: [],
  prompt: "",
  expand: 0.25,
  expandSides: null,
};

describe("buildObjectRemovalParams", () => {
  it("erase with a box → bbox params", () => {
    const r = buildObjectRemovalParams({ ...base, mode: "erase", bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ mode: "erase", maskMode: "bbox", bbox: [0.1, 0.2, 0.3, 0.4] });
  });

  it("erase with box tool but no box drawn → error", () => {
    const r = buildObjectRemovalParams({ ...base, mode: "erase", bbox: null });
    expect(r.ok).toBe(false);
  });

  it("erase with points → points params", () => {
    const r = buildObjectRemovalParams({ ...base, mode: "erase", tool: "points", points: [{ x: 0.5, y: 0.5 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ mode: "erase", maskMode: "points", points: [{ x: 0.5, y: 0.5 }] });
  });

  it("points tool with no points → error", () => {
    const r = buildObjectRemovalParams({ ...base, mode: "erase", tool: "points", points: [] });
    expect(r.ok).toBe(false);
  });

  it("replace requires a prompt", () => {
    const withBox: ObjectRemovalDraft = { ...base, mode: "replace", bbox: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    expect(buildObjectRemovalParams(withBox).ok).toBe(false);
    const r = buildObjectRemovalParams({ ...withBox, prompt: "a red car" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toMatchObject({ mode: "replace", maskMode: "bbox", prompt: "a red car" });
  });

  it("outpaint uses expand and optional prompt; no mask", () => {
    const r = buildObjectRemovalParams({ ...base, mode: "outpaint", expand: 0.3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ mode: "outpaint", expand: 0.3 });
    const r2 = buildObjectRemovalParams({ ...base, mode: "outpaint", expand: 0.3, prompt: "  beach  " });
    if (r2.ok) expect(r2.params).toEqual({ mode: "outpaint", expand: 0.3, prompt: "beach" });
  });

  it("outpaint with zero expand → error", () => {
    expect(buildObjectRemovalParams({ ...base, mode: "outpaint", expand: 0 }).ok).toBe(false);
  });

  it("outpaint with per-side expand → expandLeft/Right/Top/Bottom", () => {
    const r = buildObjectRemovalParams({
      ...base,
      mode: "outpaint",
      expand: 0,
      expandSides: { left: 0.2, right: 0, top: 0.1, bottom: 0 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params).toEqual({ mode: "outpaint", expandLeft: 0.2, expandRight: 0, expandTop: 0.1, expandBottom: 0 });
    }
  });

  it("clamps bbox values into 0–1", () => {
    const r = buildObjectRemovalParams({ ...base, mode: "erase", bbox: { x: -0.1, y: 1.5, w: 0.3, h: 0.4 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.bbox).toEqual([0, 1, 0.3, 0.4]);
  });
});
