import { afterEach, describe, expect, it, vi } from "vitest";

const disposed: string[] = [];
let created = 0;
vi.mock("@openreel/core/motion/motion-shader-renderer", () => ({
  MotionShaderRenderer: class {
    readonly id = `renderer-${created++}`;
    render(): null {
      return null;
    }
    dispose(): void {
      disposed.push(this.id);
    }
  },
}));

import { PARTICLE_PRESETS, sampleParticleEffect, type EmphasisAnimation } from "@openreel/core";
import { applyEmphasisAnimation } from "../../preview/canvas-renderers";
import {
  createKindRenderState,
  disposeKindRenderers,
  EMPHASIS_STRIP_CELLS,
  particleCardEffect,
  particlePosterInstant,
  pickEmphasisFilmstripTimes,
  renderKindCard,
} from "./kind-renderers";
import { motionPreviewDef, shaderPreviewDef, type MotionPreviewTarget } from "./kind-defs";
import type { RenderInput } from "./preview-engine";

const frame = { width: 16, height: 9, close: vi.fn() } as unknown as ImageBitmap;
const input = { frame, partner: null, progress: 0.5, sourceTime: 0.5 } as unknown as RenderInput;

const target: MotionPreviewTarget = {
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  clipDuration: 5,
  kind: "regular",
  canvas: { width: 1920, height: 1080 },
};
const preset = { id: "p", name: "P", category: "entrance" as const, duration: 0.6, tracks: [] };

afterEach(() => {
  disposed.length = 0;
  vi.unstubAllGlobals();
});

describe("kind renderers", () => {
  it("frees every shader renderer on dispose and refuses to build new ones afterwards", async () => {
    vi.stubGlobal("createImageBitmap", async () => frame);
    const state = createKindRenderState();
    const def = shaderPreviewDef({ id: "dither", category: "effect" } as never, "effect", "");
    const run = (slot: number) =>
      renderKindCard(async () => ({}) as never, state, slot, def, input).catch((error: Error) => error);
    // The stand-in renderer returns null, so each render throws, but its slot renderer has been created.
    await run(0);
    await run(1);
    expect(state.shaders.size).toBe(2);
    disposeKindRenderers(state);
    expect(disposed).toHaveLength(2);
    expect(state.shaders.size).toBe(0);
    const late = await run(0);
    expect((late as Error).message).toBe("renderer disposed");
    expect(state.shaders.size).toBe(0);
  });

  it("does not load the effects and title engines for motion cards", async () => {
    vi.stubGlobal("createImageBitmap", async () => frame);
    const loadModules = vi.fn(async () => ({}) as never);
    await renderKindCard(loadModules, createKindRenderState(), 0, motionPreviewDef(preset, 0.6, target), input);
    expect(loadModules).not.toHaveBeenCalled();
  });
});

const SPACES = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 640, height: 360 },
];

/** Particles of the card's effect inside the frame at `time`, with their opacity and diameter on a 384 px card. */
function visibleOnCard(presetId: string, time: number, space: { width: number; height: number }) {
  const effect = particleCardEffect(presetId, 2, space, 384);
  return sampleParticleEffect(effect, time, space.width, space.height).filter(
    (p) =>
      p.opacity > 0.15 &&
      (p.size * 384) / space.width >= 2 &&
      p.position.x >= 0 &&
      p.position.x <= space.width &&
      p.position.y >= 0 &&
      p.position.y <= space.height,
  );
}

describe("particle poster", () => {
  it("shows every preset with particles on the card at its poster instant, in a landscape and a portrait project", () => {
    expect(PARTICLE_PRESETS.length).toBeGreaterThan(10);
    for (const space of SPACES.slice(0, 2)) {
      for (const preset of PARTICLE_PRESETS) {
        const instant = particlePosterInstant(particleCardEffect(preset.id, 2, space, 384), 2, space);
        expect(visibleOnCard(preset.id, instant, space).length, `${preset.id} ${space.width}x${space.height}`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("starts ambient presets (dust, snow) in their steady state instead of on an empty frame", () => {
    for (const id of ["dust-ambient", "snow-fall", "dissolve-soft"]) {
      const effect = particleCardEffect(id, 2, SPACES[0], 384);
      expect(effect.startTime, `${id} is warmed up`).toBeLessThan(0);
      expect(visibleOnCard(id, 0, SPACES[0]).length, `${id} at t=0`).toBeGreaterThanOrEqual(10);
    }
  });

  it("starts every hover loop with particles already in flight, burst presets included", () => {
    for (const preset of PARTICLE_PRESETS) {
      const effect = particleCardEffect(preset.id, 2, SPACES[0], 384);
      expect(effect.startTime, `${preset.id} is warmed up`).toBeLessThan(0);
      expect(visibleOnCard(preset.id, 0, SPACES[0]).length, `${preset.id} first loop frame`).toBeGreaterThanOrEqual(10);
    }
  });

  it("enlarges dots for the card but keeps the preset's own counts, speeds and lifetimes", () => {
    const preset = PARTICLE_PRESETS.find((p) => p.id === "dust-ambient")!;
    const effect = particleCardEffect("dust-ambient", 2, SPACES[0], 384);
    expect(effect.config.size.max).toBeGreaterThan(preset.config.size.max);
    // Denser on the card (a sparse ambient preset would be a handful of specks), by a bounded factor, same emitter otherwise.
    expect(effect.config.particleCount).toBeGreaterThan(preset.config.particleCount);
    expect(effect.config.particleCount).toBeLessThanOrEqual(preset.config.particleCount * 5);
    expect(effect.config.emissionRate / preset.config.emissionRate).toBeCloseTo(effect.config.particleCount / preset.config.particleCount, 1);
    expect(effect.config.emissionShape).toBe(preset.config.emissionShape);
    expect(effect.config.emissionRadius).toBe(preset.config.emissionRadius);
    expect(effect.config.speed).toBe(preset.config.speed);
    expect(effect.config.lifetime).toEqual(preset.config.lifetime);
  });
});

describe("emphasis filmstrip", () => {
  const base = { speed: 1, intensity: 1, loop: true } as const;
  const strip = (type: EmphasisAnimation["type"]) => pickEmphasisFilmstripTimes({ ...base, type } as EmphasisAnimation);
  const states = (type: EmphasisAnimation["type"]) =>
    strip(type).map((time) => applyEmphasisAnimation({ ...base, type } as EmphasisAnimation, time));

  it("picks four distinct instants in time order, starting at the cycle's first frame", () => {
    for (const type of ["pulse", "heartbeat", "glow", "breathe", "flash"] as const) {
      const times = strip(type);
      expect(times).toHaveLength(EMPHASIS_STRIP_CELLS);
      expect(new Set(times).size).toBe(EMPHASIS_STRIP_CELLS);
      expect(times[0]).toBe(0);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it("shows each animation's extremes: pulse grows and shrinks, flash dims, heartbeat beats", () => {
    const pulse = states("pulse").map((s) => s.scale);
    expect(Math.max(...pulse)).toBeGreaterThan(1.05);
    expect(Math.min(...pulse)).toBeLessThan(0.95);
    expect(Math.min(...states("flash").map((s) => s.opacity))).toBeLessThan(0.65);
    expect(Math.max(...states("heartbeat").map((s) => s.scale))).toBeGreaterThan(1.1);
  });

  it("gives the five attention animations different filmstrips", () => {
    const keys = ["pulse", "heartbeat", "glow", "breathe", "flash"].map((type) =>
      states(type as EmphasisAnimation["type"])
        .map((s) => `${s.scale.toFixed(2)}/${s.opacity.toFixed(2)}`)
        .join(" "),
    );
    expect(new Set(keys).size).toBe(5);
  });
});
