import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Project } from "../../types";
import { clipSpectralRegions, findSpectralRepairEffect, planSpectralRegionsAction } from "./spectral-edit";
import { getSpectralRepairRegions, type SpectralRegion } from "./spectral-regions";

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
