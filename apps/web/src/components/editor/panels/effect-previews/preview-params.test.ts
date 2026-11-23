import { describe, expect, it } from "vitest";
import {
  DIP_POSTER_PROGRESS,
  FLARE_POSTER_PROGRESS,
  FLIP_POSTER_PROGRESS,
  SPIN_POSTER_PROGRESS,
  GRAIN_CARD_BOOST,
  pickSampleKeyColor,
  previewNote,
  previewParams,
  transitionPosterProgress,
} from "./preview-params";

describe("transitionPosterProgress", () => {
  it("rests the dips before the solid-colour hold so the poster shows footage", () => {
    expect(transitionPosterProgress({ kind: "transition", type: "dipToBlack" })).toBe(DIP_POSTER_PROGRESS);
    expect(transitionPosterProgress({ kind: "transition", type: "dipToWhite" })).toBe(DIP_POSTER_PROGRESS);
    expect(DIP_POSTER_PROGRESS).toBeLessThan(0.4);
  });
  it("rests flares before the solid flash, flips before edge-on, and eased dissolves where both shots show", () => {
    for (const type of ["flash", "filmBurn"]) {
      expect(transitionPosterProgress({ kind: "transition", type })).toBe(FLARE_POSTER_PROGRESS);
    }
    expect(FLARE_POSTER_PROGRESS).toBeLessThan(0.25);
    expect(transitionPosterProgress({ kind: "transition", type: "flip" })).toBe(FLIP_POSTER_PROGRESS);
    expect(transitionPosterProgress({ kind: "transition", type: "spin" })).not.toBe(0.5);
    // Flip Over is an empty frame edge-on at 0.5.
    expect(transitionPosterProgress({ kind: "transition", type: "flipOver" })).toBeLessThan(0.3);
    expect(transitionPosterProgress({ kind: "transition", type: "radialWipe" })).not.toBe(0.5);
    expect(transitionPosterProgress({ kind: "transition", type: "crossfade", params: { curve: "ease-in" } })).toBe(0.7);
    expect(transitionPosterProgress({ kind: "transition", type: "crossfade", params: { curve: "ease-out" } })).toBe(0.3);
  });
  it("rests flips and spins where the outgoing shot is still large and legible, not a small dark tile", () => {
    // TransitionEngine.renderFlip: the outgoing card is (1 - 2p) of the width/height wide before the half.
    expect(1 - 2 * FLIP_POSTER_PROGRESS).toBeGreaterThanOrEqual(0.55);
    // TransitionEngine.renderSpin: the outgoing shot has scale 1 - 0.75p and opacity 1 - p, turned by p of a rotation.
    expect(1 - 0.75 * SPIN_POSTER_PROGRESS).toBeGreaterThanOrEqual(0.9);
    expect(1 - SPIN_POSTER_PROGRESS).toBeGreaterThanOrEqual(0.85);
    // ...yet turned enough (at least 30 degrees) to read as a rotation rather than the plain footage.
    expect(SPIN_POSTER_PROGRESS * 360).toBeGreaterThanOrEqual(30);
  });
  it("keeps blends and wipes at the middle of the transition", () => {
    expect(transitionPosterProgress({ kind: "transition", type: "crossfade" })).toBe(0.5);
    expect(transitionPosterProgress({ kind: "transition", type: "wipe" })).toBe(0.5);
  });
});

const solid = (r: number, g: number, b: number, pixels = 100): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) data.set([r, g, b, 255], i * 4);
  return data;
};

const concat = (...parts: Uint8ClampedArray[]): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

describe("previewParams", () => {
  it("raises grain so it survives the card downscale, capped at 100", () => {
    expect(previewParams({ type: "grain" }, { amount: 25 }).amount).toBe(25 * GRAIN_CARD_BOOST);
    expect(previewParams({ type: "grain" }, { amount: 90 }).amount).toBe(100);
  });
  it("leaves every other effect on its true defaults", () => {
    const params = { amount: 25 };
    expect(previewParams({ type: "sharpen" }, params)).toBe(params);
  });
});

describe("previewNote", () => {
  it("labels the effects that cannot show a plain result", () => {
    expect(previewNote({ type: "chromaKey" })).toBe("Sample key");
    expect(previewNote({ type: "stabilize" })).toBe("Needs analysis");
    expect(previewNote({ type: "grayscale" })).toBeNull();
    expect(previewNote({ kind: "transition", type: "chromaKey" })).toBeNull();
    // Morph Cut needs the two clips it is applied to: its card previews as a dissolve and says so
    expect(previewNote({ kind: "transition", type: "morphCut" })).toBe("Needs analysis");
    expect(previewNote({ kind: "effect", type: "morphCut" })).toBeNull();
  });
});

describe("pickSampleKeyColor", () => {
  it("keys the default green when the footage has a green screen", () => {
    expect(pickSampleKeyColor(concat(solid(0, 255, 0, 20), solid(200, 60, 40, 80)))).toEqual({ r: 0, g: 1, b: 0 });
  });
  it("keys the dominant saturated hue of footage without a green screen", () => {
    const key = pickSampleKeyColor(concat(solid(220, 30, 30, 70), solid(30, 30, 220, 30)));
    expect(key.r).toBeGreaterThan(0.8);
    expect(key.g).toBeLessThan(0.2);
    expect(key.b).toBeLessThan(0.2);
  });
  it("falls back to the average colour for grey footage", () => {
    const key = pickSampleKeyColor(solid(128, 128, 128));
    expect(key.r).toBeCloseTo(0.502, 2);
    expect(key.g).toBeCloseTo(0.502, 2);
  });
});
