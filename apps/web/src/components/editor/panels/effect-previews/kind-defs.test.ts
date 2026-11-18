import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TEXT_STYLE, PARTICLE_PRESETS } from "@openreel/core";
import {
  emphasisPreviewDef,
  fingerprint,
  isKindDef,
  motionPreviewDef,
  type MotionPreviewTarget,
  particlePreviewDef,
  shaderPreviewDef,
  textPreviewDef,
} from "./kind-defs";
import { EffectPreviewEngine, loopProgress, previewDefKey, type EffectRenderer, type PreviewWindow, type WindowLoader } from "./preview-engine";

const preset = {
  id: "slide-in-left",
  name: "Slide In Left",
  category: "entrance" as const,
  duration: 0.6,
  tracks: [],
};

const target: MotionPreviewTarget = {
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  clipDuration: 5,
  kind: "regular",
  canvas: { width: 1920, height: 1080 },
};

describe("inspector card definitions", () => {
  it("keys a motion card by the clip it would be applied to", () => {
    const other = { ...target, canvas: { width: 1080, height: 1920 } };
    expect(previewDefKey(motionPreviewDef(preset, 0.6, target))).not.toBe(previewDefKey(motionPreviewDef(preset, 0.6, other)));
  });

  it("keys a motion card by preset and duration, and loops over the preset plus a hold", () => {
    const a = motionPreviewDef(preset, 0.6, target);
    const b = motionPreviewDef(preset, 1, target);
    expect(previewDefKey(a)).not.toBe(previewDefKey(b));
    expect(a.loop?.seconds).toBeCloseTo(1.1);
    expect(a.loop?.posterProgress).toBeGreaterThan(0);
    expect(a.loop?.posterProgress).toBeLessThan(1);
    expect(isKindDef(a)).toBe(true);
  });

  it("re-keys text cards when the user's text, style, preset or phase change", () => {
    const base = { text: "Golden Hour", style: DEFAULT_TEXT_STYLE };
    const key = (def: ReturnType<typeof textPreviewDef>) => previewDefKey(def);
    const reference = key(textPreviewDef(base, "fade", "entry", 0.5, 0.5));
    expect(key(textPreviewDef({ ...base, text: "Other" }, "fade", "entry", 0.5, 0.5))).not.toBe(reference);
    expect(key(textPreviewDef({ ...base, style: { ...base.style, color: "#f00" } }, "fade", "entry", 0.5, 0.5))).not.toBe(reference);
    expect(key(textPreviewDef(base, "fade", "exit", 0.5, 0.5))).not.toBe(reference);
    expect(key(textPreviewDef(base, "scale", "entry", 0.5, 0.5))).not.toBe(reference);
    expect(key(textPreviewDef(base, "fade", "entry", 0.5, 0.5))).toBe(reference);
  });

  it("builds one particle card per preset from the engine's own presets", () => {
    const keys = new Set(PARTICLE_PRESETS.map((p) => previewDefKey(particlePreviewDef(p))));
    expect(keys.size).toBe(PARTICLE_PRESETS.length);
  });

  it("keys emphasis cards by their speed and intensity and shader cards by sample and text", () => {
    const animation = { type: "pulse" as const, speed: 1, intensity: 1, loop: true };
    expect(previewDefKey(emphasisPreviewDef(animation, null))).not.toBe(
      previewDefKey(emphasisPreviewDef({ ...animation, speed: 2 }, null)),
    );
    const shader = { id: "dither" } as Parameters<typeof shaderPreviewDef>[0];
    expect(previewDefKey(shaderPreviewDef(shader, "text", "A"))).not.toBe(previewDefKey(shaderPreviewDef(shader, "text", "B")));
    expect(previewDefKey(shaderPreviewDef(shader, "effect", "A"))).toBe(previewDefKey(shaderPreviewDef(shader, "effect", "B")));
  });

  it("fingerprints values stably", () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("looping cards in the engine", () => {
  const frame = () => ({ width: 8, height: 4, close: vi.fn() }) as unknown as ImageBitmap;
  function setup(fail = false) {
    const poster = frame();
    const window: PreviewWindow = {
      key: "w",
      origin: "footage",
      fps: 12,
      times: [0, 1, 2],
      count: 3,
      width: 8,
      height: 4,
      posterIndex: 1,
      animated: true,
      frame: (index) => Promise.resolve(index === 1 ? poster : frame()),
      partner: () => Promise.resolve(null),
      dispose: () => undefined,
    };
    const loader: WindowLoader = { load: async () => window };
    const calls: Array<{ progress: number; sourceTime: number; frame: ImageBitmap }> = [];
    const renderer: EffectRenderer = {
      render: async (_slot, _def, input) => {
        calls.push({ progress: input.progress, sourceTime: input.sourceTime, frame: input.frame });
        if (fail) throw new Error("boom");
        return frame();
      },
      dispose: () => undefined,
    };
    const engine = new EffectPreviewEngine({ loader, renderer, beforeStart: async () => undefined });
    return { engine, calls, poster };
  }
  const def = motionPreviewDef(preset, 0.5, target);

  it("renders the poster at the card's own moment, on the footage's poster frame", async () => {
    const { engine, calls, poster } = setup();
    await engine.renderPoster(def);
    expect(calls).toHaveLength(1);
    expect(calls[0].progress).toBeCloseTo(def.loop!.posterProgress);
    expect(calls[0].frame).toBe(poster);
    expect(engine.peekPoster(def)).not.toBeNull();
  });

  it("walks the loop with progress 0..1 on the same footage frame, independent of the window length", async () => {
    const { engine, calls, poster } = setup();
    await engine.render(def, 0, "hover");
    await engine.render(def, def.loop!.frames - 1, "hover");
    expect(calls.map((c) => c.progress)).toEqual([0, 1]);
    expect(calls.every((c) => c.frame === poster)).toBe(true);
    expect(calls[1].sourceTime).toBeCloseTo(def.loop!.seconds);
  });

  it("reports a thrown render as a failed poster, not as a cancellation", async () => {
    const { engine } = setup(true);
    expect(await engine.renderPoster(def)).toBeNull();
    expect(engine.posterFailed(def)).toBe(true);
  });

  it("clears a failure once the same card renders successfully", async () => {
    let fail = true;
    const poster = frame();
    const window: PreviewWindow = {
      key: "w", origin: "footage", fps: 12, times: [0], count: 1, width: 8, height: 4, posterIndex: 0, animated: false,
      frame: () => Promise.resolve(poster),
      partner: () => Promise.resolve(null),
      dispose: () => undefined,
    };
    const renderer: EffectRenderer = {
      render: async () => {
        if (fail) throw new Error("transient");
        return frame();
      },
      dispose: () => undefined,
    };
    const engine = new EffectPreviewEngine({ loader: { load: async () => window }, renderer, beforeStart: async () => undefined });
    await engine.renderPoster(def);
    expect(engine.posterFailed(def)).toBe(true);
    fail = false;
    expect(await engine.renderPoster(def)).not.toBeNull();
    expect(engine.posterFailed(def)).toBe(false);
  });

  it("maps loop frames to progress", () => {
    expect(loopProgress(0, 16)).toBe(0);
    expect(loopProgress(15, 16)).toBe(1);
    expect(loopProgress(0, 1)).toBe(0);
  });
});
