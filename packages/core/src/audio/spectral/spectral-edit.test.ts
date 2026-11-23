import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Project } from "../../types";
import { clipSpectralRegions, findSpectralRepairEffect, planSpectralRegionsAction } from "./spectral-edit";
import { createSpectralRepairEffect, getSpectralRepairRegions, sanitizeSpectralRegions, spectralRegionsKey, type SpectralRegion } from "./spectral-regions";

const region = (id: string, over: Partial<SpectralRegion> = {}): SpectralRegion => ({
  id, mode: "attenuate", startTime: 1, endTime: 2, lowHz: 500, highHz: 900, gainDb: -12, enabled: true, ...over,
});

const makeProject = () =>
  ({
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 4, subtitles: [], markers: [],
      tracks: [{
        id: "t", name: "A", type: "audio", hidden: false, muted: false, solo: false, locked: false, transitions: [],
        clips: [{
          id: "clip", mediaId: "m", trackId: "t", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, volume: 1, effects: [], audioEffects: [], keyframes: [],
          transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
        }],
      }],
    },
  }) as unknown as Project;

describe("spectral region edits go through the undoable action system", () => {
  it("add, change, remove: each is one history step and undo / redo restore the exact region list", async () => {
    const project = makeProject();
    const executor = new ActionExecutor();
    const clip = () => project.timeline.tracks[0].clips[0];
    let n = 0;
    const commit = async (regions: SpectralRegion[]) => {
      const action = planSpectralRegionsAction(clip(), regions, { actionId: `a${++n}`, effectId: "fx" });
      expect(action).not.toBeNull();
      expect((await executor.execute(action!, project)).success).toBe(true);
    };
    expect(planSpectralRegionsAction(clip(), [], { actionId: "x", effectId: "fx" })).toBeNull();

    const one = [region("r1")];
    await commit(one);
    expect(clipSpectralRegions(clip())).toEqual(one);
    expect(findSpectralRepairEffect(clip())?.type).toBe("spectralRepair");

    const two = [...one, region("r2", { mode: "remove", startTime: 2, endTime: 2.5 })];
    await commit(two);
    expect(clipSpectralRegions(clip())).toHaveLength(2);
    expect(planSpectralRegionsAction(clip(), two, { actionId: "same", effectId: "fx" })).toBeNull();

    await commit([]);
    expect(clip().audioEffects).toHaveLength(0);

    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(clipSpectralRegions({ audioEffects: [{ id: "fx", type: "spectralRepair", enabled: true, params: { regions: two } }] }));
    expect(clipSpectralRegions(clip())).toHaveLength(2);
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(one);
    expect((await executor.undo(project)).success).toBe(true);
    expect(clip().audioEffects).toHaveLength(0);
    expect((await executor.redo(project)).success).toBe(true);
    expect((await executor.redo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toHaveLength(2);
    expect(getSpectralRepairRegions(clip().audioEffects)).toHaveLength(2);
  });
});

describe("version 2 regions: lasso, brush and heal", () => {
  const lasso = (id: string, over: Partial<SpectralRegion> = {}): SpectralRegion => ({
    id, mode: "heal", shape: "lasso", points: [{ t: 1, hz: 500 }, { t: 2, hz: 800 }, { t: 1.4, hz: 2000 }], startTime: 1, endTime: 2, lowHz: 500, highHz: 2000, gainDb: -120, enabled: true, ...over,
  });

  it("stores a version marker only when a region needs it, and every edit is one undo step", async () => {
    const project = makeProject();
    const executor = new ActionExecutor();
    const clip = () => project.timeline.tracks[0].clips[0];
    let n = 0;
    const commit = async (regions: SpectralRegion[]) => {
      const action = planSpectralRegionsAction(clip(), regions, { actionId: `v${++n}`, effectId: "fx" });
      expect(action).not.toBeNull();
      expect((await executor.execute(action!, project)).success).toBe(true);
    };
    await commit([region("old")]);
    expect(findSpectralRepairEffect(clip())?.params.version).toBeUndefined();
    const withLasso = [region("old"), lasso("l1")];
    await commit(withLasso);
    expect(findSpectralRepairEffect(clip())?.params.version).toBe(2);
    expect(clipSpectralRegions(clip())).toEqual(withLasso);
    const healed = sanitizeSpectralRegions([region("old"), lasso("l1", { mode: "remove" }), { ...lasso("b1"), shape: "brush" as const, points: [{ t: 1, hz: 800 }], brushSeconds: 0.05, brushOctaves: 0.2, startTime: 0.95, endTime: 1.05, lowHz: 700, highHz: 920 }]);
    await commit(healed);
    expect(clipSpectralRegions(clip()).map((r) => [r.id, r.mode, r.shape ?? "rect"])).toEqual([["old", "attenuate", "rect"], ["l1", "remove", "lasso"], ["b1", "heal", "brush"]]);
    // Changing one region's gain / mode / visibility is a single step; undo restores the exact previous list.
    await commit(healed.map((r) => (r.id === "l1" ? { ...r, mode: "heal" as const } : r)));
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(healed);
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(withLasso);
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual([region("old")]);
    expect(findSpectralRepairEffect(clip())?.params.version).toBeUndefined();
    expect((await executor.redo(project)).success).toBe(true);
    expect((await executor.redo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(healed);
    // Deleting the heal region is one step too.
    await commit(healed.filter((r) => r.id !== "b1"));
    expect(clipSpectralRegions(clip())).toHaveLength(2);
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(healed);
  });

  it("survives a save and reload (JSON) exactly", () => {
    const regions = [region("old"), lasso("l1", { feather: 3 })];
    const effect = createSpectralRepairEffect("fx", regions);
    const reloaded = JSON.parse(JSON.stringify(effect));
    expect(sanitizeSpectralRegions(reloaded.params.regions)).toEqual(sanitizeSpectralRegions(regions));
    expect(spectralRegionsKey(sanitizeSpectralRegions(reloaded.params.regions))).toBe(spectralRegionsKey(regions));
  });

  it("loads a project saved before v2 (rectangle regions, no shape, no version) unchanged, with the original cache key", () => {
    const legacy = [
      { id: "a", mode: "attenuate", startTime: 1, endTime: 2, lowHz: 500, highHz: 900, gainDb: -12, enabled: true },
      { id: "b", mode: "remove", startTime: 0, endTime: 4, lowHz: 50, highHz: 60, gainDb: -120, enabled: false },
    ];
    expect(sanitizeSpectralRegions(legacy)).toEqual(legacy);
    expect(getSpectralRepairRegions([{ type: "spectralRepair", enabled: true, params: { regions: legacy } }])).toEqual([legacy[0]]);
    // The format of the key of rectangle regions must not change: it names the cached repairs of existing projects.
    expect(spectralRegionsKey(sanitizeSpectralRegions(legacy))).toBe("a1.00000,2.00000,500.00,900.00,-12.000");
    expect(createSpectralRepairEffect("fx", legacy as SpectralRegion[]).params).toEqual({ regions: legacy });
  });

  it("drops malformed v2 regions and clamps the rest", () => {
    const out = sanitizeSpectralRegions([
      { id: "x", mode: "heal", shape: "lasso", points: [{ t: 1, hz: 100 }] },
      { id: "y", mode: "heal", shape: "lasso", points: [{ t: 1, hz: 100 }, { t: 2, hz: 100 }, { t: 2, hz: 400 }], feather: 99 },
      { id: "z", mode: "melt", shape: "brush", points: [{ t: 1, hz: 100 }] },
      { id: "w", mode: "heal", shape: "brush", points: [{ t: 1, hz: 100 }], brushSeconds: -1, brushOctaves: 100 },
    ]);
    expect(out.map((r) => r.id)).toEqual(["y", "w"]);
    expect(out[0].feather).toBe(8);
    expect(out[1].brushSeconds).toBeGreaterThan(0);
    expect(out[1].brushOctaves).toBeLessThanOrEqual(4);
  });

  it("wand, harmonic and channel edits write version 3, are one undo step each, and an older list returns to its old format", async () => {
    const project = makeProject();
    const executor = new ActionExecutor();
    const clip = () => project.timeline.tracks[0].clips[0];
    let n = 0;
    const commit = async (regions: SpectralRegion[]) => {
      const action = planSpectralRegionsAction(clip(), regions, { actionId: `w${++n}`, effectId: "fx" });
      expect(action).not.toBeNull();
      expect((await executor.execute(action!, project)).success).toBe(true);
    };
    const wand = sanitizeSpectralRegions([{ id: "w", mode: "remove", shape: "wand", wand: { version: 1, seed: { t: 1, hz: 500 }, toleranceDb: 6, localContrast: false, sampleRate: 48000, fftSize: 2048, hop: 512, m0: 80, k0: 20, frames: 3, bins: 3, runs: [0, 9] } }])[0];
    const harmonic = sanitizeSpectralRegions([{ id: "h", mode: "attenuate", gainDb: -20, shape: "harmonic", points: [{ t: 0.5, hz: 200 }, { t: 1.5, hz: 240 }], harmonic: { harmonics: 6, maxHz: 8000, bandCents: 40 }, channel: "right" }])[0];
    await commit([region("old")]);
    expect(findSpectralRepairEffect(clip())?.params.version).toBeUndefined();
    await commit([region("old"), wand]);
    expect(findSpectralRepairEffect(clip())?.params.version).toBe(3);
    await commit([region("old"), wand, harmonic]);
    // The channel of an existing region is one step too.
    await commit([region("old"), wand, { ...harmonic, channel: "left" }]);
    expect(clipSpectralRegions(clip())[2].channel).toBe("left");
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual([region("old"), wand, harmonic]);
    expect((await executor.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual([region("old"), wand]);
    expect((await executor.undo(project)).success).toBe(true);
    expect(findSpectralRepairEffect(clip())?.params.version).toBeUndefined();
    expect((await executor.redo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual([region("old"), wand]);
    // Save and reload: the stored cells and track come back exactly, with the same cache key.
    const reloaded = sanitizeSpectralRegions(JSON.parse(JSON.stringify([wand, harmonic])));
    expect(reloaded).toEqual([wand, harmonic]);
    expect(spectralRegionsKey(reloaded)).toBe(spectralRegionsKey([wand, harmonic]));
    // Dropping the new kinds goes back to the v2 / v1 format.
    await commit([region("old")]);
    expect(findSpectralRepairEffect(clip())?.params.version).toBeUndefined();
  });
});
