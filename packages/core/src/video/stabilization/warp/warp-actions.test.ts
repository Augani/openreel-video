import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../../actions/action-executor";
import type { Action } from "../../../types/actions";
import type { Project } from "../../../types/project";
import { deserializeProject, serializeProject } from "../../../utils/serialization";
import { analyzeSequence } from "./analysis";
import { clipHasWarp, warpPlanFor } from "./apply";
import { renderScene } from "./synthetic-scene";
import { DEFAULT_WARP_SETTINGS, type WarpAnalysis, type WarpSettings } from "./types";

function projectWithClip(): Project {
  const clip = {
    id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 4, inPoint: 1, outPoint: 5,
    effects: [], audioEffects: [], keyframes: [], volume: 1,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
  };
  return {
    id: "p1", name: "T", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 4, subtitles: [], markers: [], tracks: [{ id: "t1", type: "video", name: "V1", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action => ({ type, id: `a-${type}-${Math.random()}`, timestamp: 0, params }) as Action;

async function analysis(): Promise<WarpAnalysis> {
  async function* frames() {
    for (let t = 0; t < 12; t++) yield renderScene(96, 64, () => ({ dx: Math.sin(t) * 2, dy: Math.cos(t * 1.3) * 1.5, rotation: 0, logScale: 0 }));
  }
  return analyzeSequence(frames(), { fps: 30, startTime: 1, width: 96, height: 64 });
}

describe("Warp Stabilizer settings through the action system", () => {
  it("sets settings and analysis undoably and survives save and reload", async () => {
    const executor = new ActionExecutor();
    const project = projectWithClip();
    const clipOf = () => project.timeline.tracks[0].clips[0];
    const warp: WarpSettings = { ...DEFAULT_WARP_SETTINGS, result: "noMotion", framing: "synthesizeEdges", rollingShutter: "enhanced", smoothness: 35, cropLessSmoothMore: 70, method: "perspective" };
    const warpAnalysis = await analysis();
    const base = { enabled: true, strength: 50, cropMode: "auto" as const, analyzed: false };

    expect((await executor.execute(act("clip/setStabilization", { clipId: "c1", stabilization: { ...base, warp: DEFAULT_WARP_SETTINGS, warpAnalysis } }), project)).success).toBe(true);
    // the history coalesces edits inside its burst window (slider drags); a second user edit comes later
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect((await executor.execute(act("clip/setStabilization", { clipId: "c1", stabilization: { ...base, warp, warpAnalysis } }), project)).success).toBe(true);
    expect(clipOf().stabilization?.warp).toEqual(warp);

    // saved and reloaded: the same settings and the same plan
    const reloaded = deserializeProject(serializeProject(project));
    const reloadedClip = reloaded.timeline.tracks[0].clips[0];
    expect(reloadedClip.stabilization?.warp).toEqual(warp);
    expect(clipHasWarp(reloadedClip as never)).toBe(true);
    const a = warpPlanFor(clipOf() as never);
    const b = warpPlanFor(reloadedClip as never);
    expect(b?.settings).toEqual(a?.settings);
    expect(Array.from(b!.target[0])).toEqual(Array.from(a!.target[0]));
    expect(b?.zoom).toBe(a?.zoom);

    // each edit is one undo step
    await executor.undo(project);
    expect(clipOf().stabilization?.warp).toEqual(DEFAULT_WARP_SETTINGS);
    await executor.undo(project);
    expect(clipOf().stabilization).toBeUndefined();
    await executor.redo(project);
    await executor.redo(project);
    expect(clipOf().stabilization?.warp).toEqual(warp);
  });

  it("rejects a malformed analysis", async () => {
    const executor = new ActionExecutor();
    const project = projectWithClip();
    const result = await executor.execute(act("clip/setStabilization", { clipId: "c1", stabilization: { enabled: true, strength: 50, cropMode: "auto", warpAnalysis: { version: 4, motion: [1, 2] } } }), project);
    expect(result.success).toBe(false);
  });

  it("derived plans change with the settings but never re-analyse", async () => {
    const warpAnalysis = await analysis();
    const clip = (warp: Partial<WarpSettings>) => ({ id: "c1", stabilization: { enabled: true, warp, warpAnalysis } });
    const smooth = warpPlanFor(clip({ result: "smoothMotion", framing: "stabilizeOnly" }));
    const none = warpPlanFor(clip({ result: "noMotion", framing: "stabilizeOnly" }));
    expect(smooth?.target[0]).not.toEqual(none?.target[0]);
    expect(smooth?.raw[0]).toEqual(none?.raw[0]);
    expect(warpPlanFor(clip({ result: "noMotion", framing: "stabilizeOnly" }))).toBe(none);
  });
});
