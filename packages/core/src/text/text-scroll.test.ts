import { afterEach, describe, expect, it, vi } from "vitest";
import { computeScrollAnchor, resolveScrollDirection, scrollProgress, type ScrollExtents } from "./text-scroll";
import { TitleEngine } from "./title-engine";

const extents: ScrollExtents = { canvasWidth: 1000, canvasHeight: 500, above: 50, below: 50, left: 100, right: 100 };
const rest = { x: 500, y: 250 };

describe("computeScrollAnchor", () => {
  it("rolls up from below the frame to above it", () => {
    const roll = { mode: "roll", startOffscreen: true, endOffscreen: true } as const;
    expect(computeScrollAnchor(roll, 0, rest, extents)).toEqual({ x: 500, y: 550 });
    expect(computeScrollAnchor(roll, 0.5, rest, extents).y).toBe(250);
    expect(computeScrollAnchor(roll, 1, rest, extents)).toEqual({ x: 500, y: -50 });
  });

  it("rolls down in the reverse direction", () => {
    const roll = { mode: "roll", direction: "down", startOffscreen: true, endOffscreen: true } as const;
    expect(computeScrollAnchor(roll, 0, rest, extents).y).toBe(-50);
    expect(computeScrollAnchor(roll, 1, rest, extents).y).toBe(550);
  });

  it("crawls left from beyond the right edge", () => {
    const crawl = { mode: "crawl", startOffscreen: true, endOffscreen: true } as const;
    expect(computeScrollAnchor(crawl, 0, rest, extents)).toEqual({ x: 1100, y: 250 });
    expect(computeScrollAnchor(crawl, 1, rest, extents)).toEqual({ x: -100, y: 250 });
  });

  it("crawls right when asked", () => {
    const crawl = { mode: "crawl", direction: "right", startOffscreen: true, endOffscreen: true } as const;
    expect(computeScrollAnchor(crawl, 0, rest, extents).x).toBe(-100);
    expect(computeScrollAnchor(crawl, 1, rest, extents).x).toBe(1100);
  });

  it("rests at the clip position on a side that is not off-screen", () => {
    const enterOnly = { mode: "roll", startOffscreen: true, endOffscreen: false } as const;
    expect(computeScrollAnchor(enterOnly, 1, rest, extents).y).toBe(250);
    const exitOnly = { mode: "roll", startOffscreen: false, endOffscreen: true } as const;
    expect(computeScrollAnchor(exitOnly, 0, rest, extents).y).toBe(250);
    const none = { mode: "crawl", startOffscreen: false, endOffscreen: false } as const;
    expect(computeScrollAnchor(none, 0.4, rest, extents)).toEqual(rest);
  });

  it("clamps progress and handles zero duration", () => {
    expect(scrollProgress(-1, 4)).toBe(0);
    expect(scrollProgress(9, 4)).toBe(1);
    expect(scrollProgress(1, 0)).toBe(1);
    expect(resolveScrollDirection({ mode: "roll", direction: "left", startOffscreen: true, endOffscreen: true })).toBe("up");
  });
});

describe("TitleEngine.renderText with scroll", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function setup() {
    const ctx = {
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 10 })),
      fillRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(),
    };
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(readonly width: number, readonly height: number) {}
      getContext() { return ctx; }
    });
    return { engine: new TitleEngine(), ctx };
  }

  it("moves the drawn text over time, identically for any caller", () => {
    const { engine, ctx } = setup();
    const base = engine.createTextClip({ trackId: "t", startTime: 0, duration: 4, text: "Credits" });
    const clip = { ...base, scroll: { mode: "roll", startOffscreen: true, endOffscreen: true } as const };
    const firstTranslateY = (time: number) => {
      ctx.translate.mockClear();
      engine.renderText(clip, 1000, 500, time);
      return ctx.translate.mock.calls[0][1] as number;
    };
    const start = firstTranslateY(0);
    const mid = firstTranslateY(2);
    const end = firstTranslateY(4);
    expect(start).toBeGreaterThan(500);
    expect(mid).toBeCloseTo(250, 0);
    expect(end).toBeLessThan(0);
    // Same call, same pixels: preview and export both go through renderText.
    expect(firstTranslateY(1)).toBe(firstTranslateY(1));
  });

  it("leaves clips without scroll untouched", () => {
    const { engine, ctx } = setup();
    const clip = engine.createTextClip({ trackId: "t", startTime: 0, duration: 4, text: "Hi" });
    engine.renderText(clip, 1000, 500, 0);
    expect(ctx.translate.mock.calls[0]).toEqual([500, 250]);
  });
});
