import { describe, expect, it, vi } from "vitest";
import { PARTICLE_PRESETS, createEffectFromPreset } from "./particle-presets";
import {
  drawParticleEffects,
  drawProjectParticles,
  isParticleEffect,
  projectParticleEffects,
  sampleParticleEffect,
} from "./particle-sampling";
import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
const effect = () =>
  createEffectFromPreset("confetti-celebration", "saved-seed", "clip", 2, 5)!;
function project(): Project {
  return {
    id: "project",
    name: "Particles",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 24,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 7,
      tracks: [
        {
          id: "track",
          name: "Video",
          type: "video",
          hidden: false,
          locked: false,
          muted: false,
          solo: false,
          transitions: [],
          clips: [
            { id: "clip", trackId: "track", startTime: 2, duration: 5 } as Clip,
          ],
        },
      ],
      markers: [],
      subtitles: [],
    },
    particleEffects: [{ ...effect(), clipStartTime: 2 }],
  };
}
describe("absolute particle frames", () => {
  it("reproduces the same frame after arbitrary seeks, export order and JSON reopening", () => {
    const e = effect(),
      expected = sampleParticleEffect(e, 4.25, 640, 360);
    expect(expected.length).toBeGreaterThan(30);
    sampleParticleEffect(e, 6.5, 640, 360);
    sampleParticleEffect(e, 2.2, 640, 360);
    expect(
      sampleParticleEffect(JSON.parse(JSON.stringify(e)), 4.25, 640, 360),
    ).toEqual(expected);
    expect(e).toEqual(effect());
  });
  it("samples all retained presets without mutating their nested configuration", () => {
    for (const preset of PARTICLE_PRESETS) {
      const e = createEffectFromPreset(preset.id, "seed", "clip", 0, 5)!;
      expect(isParticleEffect(e)).toBe(true);
      expect(sampleParticleEffect(e, 1, 640, 360).length).toBeGreaterThan(0);
      e.config.colors.push("#010203");
      e.config.size.min = 0;
      expect(preset.config.colors).not.toContain("#010203");
      expect(preset.config.size.min).toBeGreaterThan(0);
    }
  });
  it("does not paint outside the saved timing or retain disabled particles", () => {
    const e = effect();
    expect(sampleParticleEffect(e, 1.99, 640, 360)).toEqual([]);
    expect(sampleParticleEffect(e, 7, 640, 360)).toEqual([]);
    expect(sampleParticleEffect({ ...e, enabled: false }, 4, 640, 360)).toEqual(
      [],
    );
    expect(sampleParticleEffect(e, NaN, 640, 360)).toEqual([]);
  });
  it("preserves valid zero count, speed, opacity, size and emission rate", () => {
    const e = effect();
    e.config = {
      ...e.config,
      particleCount: 0,
      speed: 0,
      emissionRate: 0,
      size: { min: 0, max: 0 },
      opacity: { start: 0, end: 0 },
    };
    expect(isParticleEffect(e)).toBe(true);
    expect(sampleParticleEffect(e, 4, 640, 360)).toEqual([]);
  });
  it("follows a moved owner, clamps to its trim and ignores hidden/deleted owners", () => {
    const p = project();
    p.timeline.tracks[0].clips[0] = {
      ...p.timeline.tracks[0].clips[0],
      startTime: 10,
      duration: 2,
    };
    expect(projectParticleEffects(p)[0]).toMatchObject({
      startTime: 10,
      duration: 2,
    });
    p.timeline.tracks[0] = { ...p.timeline.tracks[0], hidden: true };
    expect(projectParticleEffects(p)).toEqual([]);
    p.timeline.tracks[0] = {
      ...p.timeline.tracks[0],
      hidden: false,
      clips: [],
    };
    expect(projectParticleEffects(p)).toEqual([]);
  });
  it("isolates the frame from another project's particle collection", () => {
    const p = project(),
      before = sampleParticleEffect(p.particleEffects![0], 4, 640, 360);
    const other = project();
    other.particleEffects![0].config.gravity = -400;
    drawProjectParticles(context(), other, 4, 320, 180);
    expect(sampleParticleEffect(p.particleEffects![0], 4, 640, 360)).toEqual(
      before,
    );
    expect(projectParticleEffects({ ...p, particleEffects: [] })).toEqual([]);
  });
  it.each([
    ["normal", "source-over"],
    ["add", "lighter"],
    ["multiply", "multiply"],
    ["screen", "screen"],
  ] as const)(
    "uses %s blending and project coordinates for preview/export resolutions",
    (blend, operation) => {
      const p = project();
      p.particleEffects![0].config.blendMode = blend;
      const ctx = context();
      expect(drawProjectParticles(ctx, p, 4, 320, 180)).toBeGreaterThan(0);
      expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
      expect(ctx.globalCompositeOperation).toBe(operation);
      expect(ctx.arc).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalledOnce();
    },
  );
  it.each(["textClips", "shapeClips", "svgClips", "stickerClips"] as const)(
    "retains particle ownership for %s overlays",
    (field) => {
      const p = project();
      p.timeline.tracks[0] = { ...p.timeline.tracks[0], clips: [] };
      (p as unknown as Record<string, unknown>)[field] = [
        { id: "clip", trackId: "track", startTime: 2, duration: 5 },
      ];
      expect(projectParticleEffects(p)).toHaveLength(1);
      expect(drawProjectParticles(context(), p, 4, 640, 360)).toBeGreaterThan(
        0,
      );
    },
  );
  it("has no canvas or simulation work for projects without particles", () => {
    const ctx = context();
    expect(
      drawProjectParticles(
        ctx,
        { ...project(), particleEffects: [] },
        4,
        640,
        360,
      ),
    ).toBe(0);
    expect(ctx.save).not.toHaveBeenCalled();
  });
  it("rejects malformed simulation parameters before sampling", () => {
    const e = effect();
    e.config.lifetime.min = 0;
    expect(isParticleEffect(e)).toBe(false);
    expect(sampleParticleEffect(e, 4, 640, 360)).toEqual([]);
  });
});
describe("drawParticleEffects", () => {
  it("draws the same particles drawProjectParticles does, in an explicit simulation space", () => {
    const e = createEffectFromPreset("explode-burst", "preview", "preview", 0, 2)!;
    const ctx = context();
    const drawn = drawParticleEffects(ctx, [e], 0.8, 192, 108, 640, 360);
    expect(drawn).toBeGreaterThan(0);
    expect(ctx.scale).toHaveBeenCalledWith(0.3, 0.3);
    expect(ctx.arc).toHaveBeenCalledTimes(drawn);
    expect(sampleParticleEffect(e, 0.8, 640, 360).filter((p) => p.opacity > 0 && p.size > 0)).toHaveLength(drawn);
  });
  it("draws nothing outside the effect's own time", () => {
    const e = createEffectFromPreset("explode-burst", "preview", "preview", 0, 2)!;
    expect(drawParticleEffects(context(), [e], 5, 192, 108, 640, 360)).toBe(0);
  });
});
function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    globalCompositeOperation: "source-over",
  } as unknown as CanvasRenderingContext2D;
}
