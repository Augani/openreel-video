import { describe, expect, it } from "vitest";
import { POSTER_INDEX, previewDefKey, EffectPreviewEngine, type PreviewEffectDef, type PreviewWindow } from "./preview-engine";

const overlay = (width = 1920, height = 1080): PreviewEffectDef => ({
  id: `overlay:cinema-letterbox:${width}x${height}`,
  kind: "overlay",
  type: "overlay",
  params: { templateId: "cinema-letterbox", sequenceWidth: width, sequenceHeight: height },
});

describe("overlay card keys", () => {
  it("separates overlays from effects and from other sequence sizes", () => {
    expect(previewDefKey(overlay())).not.toBe(previewDefKey({ id: "cinema-letterbox", type: "x" }));
    expect(previewDefKey(overlay())).not.toBe(previewDefKey(overlay(1080, 1920)));
  });
});

const frameStub = (): ImageBitmap => ({ width: 8, height: 4, close: () => undefined }) as unknown as ImageBitmap;

function windowOf(count: number): PreviewWindow {
  return {
    key: "w",
    partner: () => Promise.resolve(null),
    origin: "footage",
    fps: 12,
    times: Array.from({ length: count }, (_, i) => i / 12),
    count,
    width: 8,
    height: 4,
    posterIndex: 3,
    animated: count > 1,
    frame: async () => frameStub(),
    dispose: () => undefined,
  };
}

describe("overlay progress", () => {
  it("rests mid-animation at the poster and sweeps the overlay timeline across the window on hover", async () => {
    const seen: number[] = [];
    const engine = new EffectPreviewEngine({
      loader: { load: async () => windowOf(24) },
      renderer: {
        render: async (_slot, _def, input) => {
          seen.push(input.progress);
          return frameStub();
        },
        dispose: () => undefined,
      },
      beforeStart: async () => undefined,
    });
    await engine.renderPoster(overlay());
    expect(seen.at(-1)).toBe(-1);
    await engine.render(overlay(), 0, "hover");
    await engine.render(overlay(), 23, "hover");
    expect(seen.at(-2)).toBe(0);
    expect(seen.at(-1)).toBe(1);
    // The poster slot is its own cache entry: a hover frame at the playhead index never shows the rest pose.
    expect(engine.peekPoster(overlay())).not.toBeNull();
    expect(POSTER_INDEX).toBe(-1);
    engine.dispose();
  });
});

describe("overlay card geometry", () => {
  it("fits the whole sequence frame inside the card instead of cropping it", async () => {
    const { fitSequenceInCard } = await import("./overlay-renderer");
    expect(fitSequenceInCard(480, { width: 1920, height: 1080 })).toEqual({ cardH: 270, fitW: 480, fitH: 270 });
    // Vertical: a tall 5:8 card (not 16:9) with the 9:16 frame filling its height: large footage, legible overlay.
    expect(fitSequenceInCard(480, { width: 1080, height: 1920 })).toEqual({ cardH: 768, fitW: 432, fitH: 768 });
    // Taller than the card allows: the card stops at 5:8 and the frame is pillarboxed inside it.
    const tall = fitSequenceInCard(480, { width: 540, height: 1920 });
    expect(tall.cardH).toBe(768);
    expect(tall.fitH).toBe(tall.cardH);
    expect(tall.fitW).toBeLessThan(432);
    // Square / 4:5 projects get a card of their own aspect.
    expect(fitSequenceInCard(480, { width: 1080, height: 1080 })).toEqual({ cardH: 480, fitW: 480, fitH: 480 });
    // Ultrawide: full width, letterboxed.
    const wide = fitSequenceInCard(480, { width: 2560, height: 800 });
    expect(wide.fitW).toBe(480);
    expect(wide.fitH).toBeLessThan(270);
  });
});

describe("overlay scratch engines", () => {
  it("never lets two renders use the shared engines at once", async () => {
    const { withScratchEngines } = await import("./overlay-renderer");
    let active = 0;
    let peak = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };
    await Promise.all([withScratchEngines(job), withScratchEngines(job), withScratchEngines(job)]);
    expect(peak).toBe(1);
    // A failing render does not wedge the lane.
    await expect(withScratchEngines(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(withScratchEngines(async () => 7)).resolves.toBe(7);
  });
});
