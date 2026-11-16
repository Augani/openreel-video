import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { GraphicsEngine, TitleEngine, keyframeEngine, type Clip, type TrackingData } from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { applyMotionTracking, getMotionTrackingTarget, persistMotionTrackingAnalysis, readMotionTrackingAnalysis, readMotionTrackingApplication, removeMotionTracking } from "./motion-tracking-edit";
import { motionTrackingSourceSignature } from "./motion-tracking-source";

const state = () => useProjectStore.getState();
let trackId: string;
const options = { offset: { x: 0, y: 0 }, applyScale: true, applyRotation: true, smoothing: 0, mode: "follow" as const };
const data: TrackingData = { trackId: "measured", clipId: "source", frameRate: 2, region: { x: 40, y: 20, width: 20, height: 20 }, confidence: [1, 1, 1], lostFrames: [],
  keyframes: [{ frame: 0, position: { x: 50, y: 30 }, scale: 1, rotation: 0 }, { frame: 1, position: { x: 55, y: 32 }, scale: 1.1, rotation: 5 }, { frame: 2, position: { x: 60, y: 34 }, scale: 1.2, rotation: 10 }] };
const clip = (): Clip => ({ id: "source", mediaId: "video", trackId, startTime: 1, duration: 1.5, inPoint: 2, outPoint: 3.5, volume: .7, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: .8, anchor: { x: .5, y: .5 }, rotate3d: { x: 12, y: 0, z: 0 } }, metadata: { custom: "keep" } });
async function analyze() { const project = state().project; await persistMotionTrackingAnalysis(project.id, { version: 1, signature: motionTrackingSourceSignature(project, state().getClip("source")!, project.mediaLibrary.items[0]), data }); }
function value(id: string, property: string, time: number) { return keyframeEngine.getValueAtTime(keyframeEngine.getKeyframesForProperty(getMotionTrackingTarget(state().getFullProject(), id)!.clip.keyframes, property), time).value; }
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Measured motion"); const project = state().project; trackId = project.timeline.tracks.find(track => track.type === "video")!.id;
  state().loadProject({ ...project, settings: { ...project.settings, width: 200, height: 100, frameRate: 2 }, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, clips: [clip()] } : track) }, mediaLibrary: { items: [{ id: "video", name: "real.mp4", type: "video", blob: new Blob(["real"]), fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { width: 100, height: 50, duration: 5, frameRate: 24, codec: "h264", channels: 0, sampleRate: 0, fileSize: 4 } }] } });
  useUIStore.setState({ effectApplicationClipId: null, exportState: { isExporting: false, progress: 0, phase: "" } });
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused" }); state().actionHistory.clear();
});

describe("saved motion tracking and editor history", () => {
  it("stores actual samples and restores analysis with ordinary Undo/Redo", async () => {
    await analyze(); expect(readMotionTrackingAnalysis("source")?.data).toEqual(data);
    expect(state().actionHistory.getUndoStackSize()).toBe(1);
    await state().undo(); expect(readMotionTrackingAnalysis("source")).toBeNull();
    await state().redo(); expect(readMotionTrackingAnalysis("source")?.data).toEqual(data);
  });
  it("bakes renderer keyframes, preserves other channels and restores replaced animation on remove/Undo", async () => {
    const original = [{ id: "authored", property: "position.x", time: .5, value: 7, easing: "linear" as const }, { id: "opacity", property: "opacity", time: 0, value: .4, easing: "linear" as const }];
    const project = state().project; useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(source => ({ ...source, keyframes: original })) })) } } });
    await analyze(); state().actionHistory.clear(); const before = structuredClone(state().getClip("source"));
    await applyMotionTracking("source", "source", options);
    expect(Number(value("source", "position.x", 1)) - Number(value("source", "position.x", 0))).toBeCloseTo(20);
    expect(value("source", "scale.x", 1)).toBeCloseTo(1.2); expect(value("source", "rotation", 1)).toBe(10);
    expect(state().getClip("source")?.keyframes).toContainEqual(original[1]); expect(state().getClip("source")?.transform).toEqual(before?.transform);
    const applied = structuredClone(state().getClip("source")); expect(state().actionHistory.getUndoStackSize()).toBe(1);
    await state().undo(); expect(state().getClip("source")).toEqual(before); await state().redo(); expect(state().getClip("source")).toEqual(applied);
    await removeMotionTracking("source"); expect(state().getClip("source")?.keyframes).toEqual(expect.arrayContaining(original)); expect(readMotionTrackingApplication("source")).toBeNull();
    await state().undo(); expect(state().getClip("source")).toEqual(applied);
  });
  it.each(["text", "svg"] as const)("persists normalized %s attachment and restores it after reload", async kind => {
    const overlay = kind === "text" ? state().createTextClip(trackId, 1, "Tracked title", 1.5) : state().importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', trackId, 1, 1.5);
    expect(overlay).toBeTruthy(); await analyze(); state().actionHistory.clear();
    await applyMotionTracking("source", overlay!.id, { ...options, mode: "pin", offset: { x: 10, y: 0 } });
    expect(value(overlay!.id, "position.x", 0)).toBeCloseTo(.55); expect(value(overlay!.id, "position.y", 0)).toBeCloseTo(.6);
    expect(value(overlay!.id, "position.x", 1)).toBeCloseTo(.65);
    const saved = state().getFullProject(); state().loadProject(saved);
    expect(readMotionTrackingApplication(overlay!.id)?.sourceClipId).toBe("source"); expect(value(overlay!.id, "position.x", 1)).toBeCloseTo(.65);
    await removeMotionTracking(overlay!.id); expect(getMotionTrackingTarget(state().getFullProject(), overlay!.id)?.clip.keyframes).toEqual([]);
  });
  it("rejects stale analysis, locked targets and invalid options without adding history", async () => {
    await analyze(); state().actionHistory.clear();
    await expect(applyMotionTracking("source", "source", { ...options, offset: { x: NaN, y: 0 } })).rejects.toThrow("valid tracking");
    const project = state().project; useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, locked: true })) } } });
    await expect(applyMotionTracking("source", "source", options)).rejects.toThrow("Unlock");
    useProjectStore.setState({ project: { ...project, settings: { ...project.settings, frameRate: 24 } } });
    await expect(applyMotionTracking("source", "source", options)).rejects.toThrow("Analyze the current"); expect(state().canUndo()).toBe(false);
  });
  it.each(["anchor", "crop"] as const)("projects the source %s with the renderer's fit and pivot", async kind => {
    const project = state().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(source => ({ ...source, transform: { ...source.transform, ...(kind === "anchor" ? { anchor: { x: .25, y: .25 } } : { crop: { x: .2, y: .2, width: .6, height: .6 } }) } })) })) } } });
    const title = state().createTextClip(trackId, 1, "Pivot", 1.5)!; await analyze();
    await applyMotionTracking("source", title.id, { ...options, mode: "pin" });
    expect(value(title.id, "position.x", 0)).toBeCloseTo(kind === "anchor" ? .75 : .5);
    expect(value(title.id, "position.y", 0)).toBeCloseTo(kind === "anchor" ? .85 : 2 / 3);
  });

  it("retains animation outside the shared source/target interval", async () => {
    const outside = [{ id: "before", property: "position.x", time: 0, value: -30, easing: "linear" as const }, { id: "inside", property: "position.x", time: 1.5, value: 20, easing: "linear" as const }, { id: "after", property: "position.x", time: 4, value: 50, easing: "linear" as const }];
    const project = state().project; useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(track => track.id === trackId ? { ...track, clips: [...track.clips, { ...clip(), id: "target", startTime: 0, duration: 5, inPoint: 0, outPoint: 5, keyframes: outside }] } : track) } } });
    await analyze(); await applyMotionTracking("source", "target", options);
    const keys = state().getClip("target")!.keyframes;
    expect(keys).toContainEqual(outside[0]); expect(keys).toContainEqual(outside[2]); expect(keys).not.toContainEqual(outside[1]);
    await removeMotionTracking("target"); expect(state().getClip("target")!.keyframes).toEqual(expect.arrayContaining(outside)); expect(state().getClip("target")!.keyframes).toHaveLength(3);
  });

  it("updates tracking without compounding offsets or leaving disabled scale channels behind", async () => {
    await analyze(); await applyMotionTracking("source", "source", { ...options, offset: { x: 5, y: 0 } });
    const first = structuredClone(state().getClip("source")?.keyframes); await applyMotionTracking("source", "source", { ...options, offset: { x: 5, y: 0 } });
    expect(state().getClip("source")?.keyframes).toEqual(first);
    await applyMotionTracking("source", "source", { ...options, applyScale: false, applyRotation: false });
    expect(state().getClip("source")?.keyframes.every(key => key.property.startsWith("position."))).toBe(true);
  });
});
