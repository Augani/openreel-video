import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransitionEngine } from "./transition-engine";
import type { Clip } from "../types/timeline";

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    mediaId: "media-1",
    trackId: "track-1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchorPoint: { x: 0, y: 0 },
    },
    volume: 1,
    ...overrides,
  } as Clip;
}

describe("TransitionEngine", () => {
  let engine: TransitionEngine;

  beforeEach(() => {
    engine = new TransitionEngine({ width: 1920, height: 1080 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("validateTransition", () => {
    it("accepts adjacent clips on the same track", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5, duration: 5 });
      const result = engine.validateTransition(a, b, 1);
      expect(result.valid).toBe(true);
    });

    it("rejects non-adjacent clips", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 6, duration: 5 });
      const result = engine.validateTransition(a, b, 1);
      expect(result.valid).toBe(false);
    });

    it("rejects clips on different tracks", () => {
      const a = makeClip({ id: "a", trackId: "t1", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", trackId: "t2", startTime: 5, duration: 5 });
      const result = engine.validateTransition(a, b, 1);
      expect(result.valid).toBe(false);
    });

    it("warns when duration exceeds available range", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 1 });
      const b = makeClip({ id: "b", startTime: 1, duration: 1 });
      const result = engine.validateTransition(a, b, 10);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.maxDuration).toBe(2);
    });

    it("rejects zero or negative durations", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5, duration: 5 });
      expect(engine.validateTransition(a, b, 0).valid).toBe(false);
      expect(engine.validateTransition(a, b, -1).valid).toBe(false);
    });
  });

  describe("isTimeInTransition / calculateTransitionProgress", () => {
    const a = makeClip({ id: "a", startTime: 0, duration: 5 });
    const transition = {
      id: "t",
      clipAId: "a",
      clipBId: "b",
      type: "crossfade" as const,
      duration: 1,
      params: {},
    };

    it("centers the transition on the cut point", () => {
      // Cut at t=5, duration=1, window should be [4.5, 5.5]
      expect(engine.isTimeInTransition(transition, a, 4.4)).toBe(false);
      expect(engine.isTimeInTransition(transition, a, 4.5)).toBe(true);
      expect(engine.isTimeInTransition(transition, a, 5.0)).toBe(true);
      expect(engine.isTimeInTransition(transition, a, 5.5)).toBe(true);
      expect(engine.isTimeInTransition(transition, a, 5.6)).toBe(false);
    });

    it("reports 0 progress at start and 1 at end", () => {
      expect(engine.calculateTransitionProgress(transition, a, 4.5)).toBe(0);
      expect(engine.calculateTransitionProgress(transition, a, 5.0)).toBeCloseTo(
        0.5,
        5,
      );
      expect(engine.calculateTransitionProgress(transition, a, 5.5)).toBe(1);
    });

    it("uses the clip start window for intro edge transitions", () => {
      const intro = {
        id: "intro",
        clipAId: "a",
        edge: "in" as const,
        type: "crossfade" as const,
        duration: 1,
        params: {},
      };

      expect(engine.isTimeInTransition(intro, a, -0.1)).toBe(false);
      expect(engine.isTimeInTransition(intro, a, 0)).toBe(true);
      expect(engine.isTimeInTransition(intro, a, 1)).toBe(true);
      expect(engine.isTimeInTransition(intro, a, 1.1)).toBe(false);
      expect(engine.calculateTransitionProgress(intro, a, 0.5)).toBeCloseTo(0.5);
    });

    it("uses the clip end window for outro edge transitions", () => {
      const outro = {
        id: "outro",
        clipAId: "a",
        edge: "out" as const,
        type: "crossfade" as const,
        duration: 1,
        params: {},
      };

      expect(engine.isTimeInTransition(outro, a, 3.9)).toBe(false);
      expect(engine.isTimeInTransition(outro, a, 4)).toBe(true);
      expect(engine.isTimeInTransition(outro, a, 5)).toBe(true);
      expect(engine.isTimeInTransition(outro, a, 5.1)).toBe(false);
      expect(engine.calculateTransitionProgress(outro, a, 4.5)).toBeCloseTo(0.5);
    });
  });

  describe("createTransition", () => {
    it("returns a transition with both clip IDs and default params", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5, duration: 5 });
      const t = engine.createTransition(a, b, "crossfade", 1);
      expect(t).not.toBeNull();
      expect(t!.clipAId).toBe("a");
      expect(t!.clipBId).toBe("b");
      expect(t!.type).toBe("crossfade");
      expect(t!.duration).toBe(1);
      expect(t!.params).toEqual({ curve: "ease" });
    });

    it("provides adjustable defaults for blur and radial motion transitions", () => {
      expect(engine.getDefaultParams("blur")).toEqual({ intensity: 1 });
      expect(engine.getDefaultParams("whipPan")).toEqual({
        direction: "left",
        blurIntensity: 1,
      });
      expect(engine.getDefaultParams("radialWipe")).toEqual({
        startAngle: -90,
        clockwise: true,
      });
      expect(engine.getDefaultParams("circleReveal")).toEqual({
        center: { x: 0.5, y: 0.5 },
      });
      expect(engine.getDefaultParams("diamondReveal")).toEqual({
        center: { x: 0.5, y: 0.5 },
      });
    });

    it("clamps to maxDuration when requested duration is too long", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 1 });
      const b = makeClip({ id: "b", startTime: 1, duration: 1 });
      const t = engine.createTransition(a, b, "crossfade", 10);
      expect(t!.duration).toBe(2);
    });

    it("creates a single-clip edge transition without a second clip id", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 1 });
      const t = engine.createClipEdgeTransition(a, "out", "crossfade", 10);
      expect(t).not.toBeNull();
      expect(t!.clipAId).toBe("a");
      expect(t!.clipBId).toBeUndefined();
      expect(t!.edge).toBe("out");
      expect(t!.duration).toBe(1);
    });
  });

  describe("renderTransitionToCanvas", () => {
    it("renders soft wipes as a feathered series of blended slices", async () => {
      const drawImage = vi.fn();
      const rect = vi.fn();
      const context = {
        clearRect: vi.fn(),
        drawImage,
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect,
        clip: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        globalAlpha: 1,
      };
      class MockOffscreenCanvas {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return context;
        }
      }
      vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
      const softWipeEngine = new TransitionEngine({ width: 320, height: 180 });
      const source = { width: 320, height: 180 } as CanvasImageSource;

      await softWipeEngine.renderTransitionToCanvas(
        source,
        source,
        {
          id: "soft-wipe",
          clipAId: "a",
          clipBId: "b",
          type: "wipe",
          duration: 1,
          params: { direction: "left", softness: 0.45 },
        },
        0.5,
      );

      expect(rect.mock.calls.length).toBeGreaterThan(10);
      expect(drawImage.mock.calls.length).toBeGreaterThan(10);
    });

    it("runs every expanded transition family through a distinct canvas path", async () => {
      const drawImage = vi.fn();
      const rect = vi.fn();
      const lineTo = vi.fn();
      const context = {
        clearRect: vi.fn(),
        drawImage,
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect,
        clip: vi.fn(),
        moveTo: vi.fn(),
        lineTo,
        closePath: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: "white",
        globalAlpha: 1,
        imageSmoothingEnabled: true,
      };
      class MockOffscreenCanvas {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return context;
        }
      }
      vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
      const expanded = new TransitionEngine({ width: 320, height: 180 });
      const source = { width: 320, height: 180 } as CanvasImageSource;

      for (const type of [
        "pixelate",
        "glitch",
        "blinds",
        "diamondReveal",
        "spin",
        "flip",
        "splitReveal",
        "flash",
        "filmBurn",
        "mosaic",
        "ripple",
        "pageTurn",
        "colorSplit",
      ] as const) {
        drawImage.mockClear();
        rect.mockClear();
        lineTo.mockClear();
        await expanded.renderTransitionToCanvas(
          source,
          source,
          {
            id: type,
            clipAId: "a",
            clipBId: "b",
            type,
            duration: 1,
            params: expanded.getDefaultParams(type),
          },
          0.5,
        );
        expect(drawImage.mock.calls.length, type).toBeGreaterThanOrEqual(
          type === "flip" ? 1 : 2,
        );
        if (type === "glitch") {
          expect(drawImage.mock.calls.length).toBeGreaterThan(10);
        }
        if (type === "blinds") {
          expect(rect.mock.calls.length).toBe(8);
        }
        if (type === "diamondReveal") {
          expect(lineTo.mock.calls.length).toBe(3);
        }
        if (type === "mosaic") {
          expect(rect.mock.calls.length).toBeGreaterThan(4);
        }
        if (type === "ripple") {
          expect(drawImage.mock.calls.length).toBeGreaterThan(32);
        }
      }
    });
  });

    it("advertises defaults for every expanded transition family", () => {
    expect(engine.getAvailableTransitionTypes()).toEqual(
      expect.arrayContaining([
        "pixelate",
        "glitch",
        "blinds",
        "diamondReveal",
        "spin",
        "flip",
        "splitReveal",
        "flash",
        "filmBurn",
        "mosaic",
        "ripple",
        "pageTurn",
        "colorSplit",
      ]),
    );
    expect(engine.getDefaultParams("pixelate")).toEqual({ maxPixelSize: 48 });
    expect(engine.getDefaultParams("glitch")).toEqual({
      intensity: 0.08,
      slices: 12,
    });
    expect(engine.getDefaultParams("blinds")).toEqual({
      count: 8,
      direction: "vertical",
    });
    expect(engine.getDefaultParams("spin")).toEqual({ rotations: 1 });
    expect(engine.getDefaultParams("flip")).toEqual({ axis: "horizontal" });
    expect(engine.getDefaultParams("splitReveal")).toEqual({
      orientation: "horizontal",
    });
    expect(engine.getDefaultParams("flash")).toEqual({ intensity: 1 });
    expect(engine.getDefaultParams("filmBurn")).toEqual({
      intensity: 1,
      warmth: 0.75,
    });
    expect(engine.getDefaultParams("mosaic")).toEqual({
      tiles: 8,
      randomness: 0.85,
    });
    expect(engine.getDefaultParams("ripple")).toEqual({
      amplitude: 0.04,
      waves: 3,
    });
    expect(engine.getDefaultParams("pageTurn")).toEqual({
      direction: "left",
      shadow: 0.55,
    });
    expect(engine.getDefaultParams("colorSplit")).toEqual({
      maxOffset: 18,
      angle: 0,
    });
  });

  it("renders Film Burn warmth from cool blue to warm orange", async () => {
    const fillStyles: string[] = [];
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      _fillStyle: "",
      set fillStyle(value: string) {
        this._fillStyle = value;
        fillStyles.push(value);
      },
      get fillStyle() {
        return this._fillStyle;
      },
    };
    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return context;
      }
    }
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    const filmBurnEngine = new TransitionEngine({ width: 320, height: 180 });
    const source = { width: 320, height: 180 } as CanvasImageSource;

    await filmBurnEngine.renderTransitionToCanvas(
      source,
      source,
      {
        id: "cool-burn",
        clipAId: "a",
        clipBId: "b",
        type: "filmBurn",
        duration: 1,
        params: { intensity: 1, warmth: 0 },
      },
      0.5,
    );
    expect(fillStyles).toContain("rgb(70, 180, 255)");

    fillStyles.length = 0;
    await filmBurnEngine.renderTransitionToCanvas(
      source,
      source,
      {
        id: "warm-burn",
        clipAId: "a",
        clipBId: "b",
        type: "filmBurn",
        duration: 1,
        params: { intensity: 1, warmth: 1 },
      },
      0.5,
    );
    expect(fillStyles).toContain("rgb(255, 75, 15)");
  });

  describe("areClipsAdjacent", () => {
    it("returns true for clips with negligible gap", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5.0005, duration: 5 });
      expect(engine.areClipsAdjacent(a, b)).toBe(true);
    });

    it("returns false for clips with a real gap", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5.1, duration: 5 });
      expect(engine.areClipsAdjacent(a, b)).toBe(false);
    });

    it("returns false for clips on different tracks", () => {
      const a = makeClip({ id: "a", trackId: "t1", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", trackId: "t2", startTime: 5, duration: 5 });
      expect(engine.areClipsAdjacent(a, b)).toBe(false);
    });
  });
});
