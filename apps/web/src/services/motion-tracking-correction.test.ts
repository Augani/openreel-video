import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { GraphicsEngine, TitleEngine, keyframeEngine, type Clip, type TrackingData } from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { getMotionTrackingBridge } from "../bridges/motion-tracking-bridge";
import { applyMotionTracking, getMotionTrackingTarget, persistMotionTrackingAnalysis, readMotionTrackingAnalysis } from "./motion-tracking-edit";
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


describe("tracked point correction and attached targets", () => {
  it("reads a w8-era analysis (no states, manual frames or stats) unchanged", async () => {
    await analyze();
    const saved = readMotionTrackingAnalysis("source")!.data;
    expect(saved).toEqual(data);
    expect(saved.states).toBeUndefined(); expect(saved.manualFrames).toBeUndefined(); expect(saved.stats).toBeUndefined();
  });

  it("a corrected point updates the path and the target that follows it in ONE undo step", async () => {
    await analyze(); await applyMotionTracking("source", "source", { ...options, mode: "pin" });
    state().actionHistory.clear();
    const before = structuredClone(state().getClip("source")), pinned = Number(value("source", "position.x", .5));
    await getMotionTrackingBridge().correctPoint("source", 1, { x: 90, y: 40 });
    const saved = readMotionTrackingAnalysis("source")!.data;
    expect(saved.keyframes.find(key => key.frame === 1)?.position).toEqual({ x: 90, y: 40 });
    expect(saved.manualFrames).toEqual([1]); expect(saved.confidence[1]).toBe(1);
    expect(Number(value("source", "position.x", .5))).not.toBeCloseTo(pinned);
    expect(state().actionHistory.getUndoStackSize()).toBe(1);
    await state().undo(); expect(state().getClip("source")).toEqual(before);
    await state().redo(); expect(readMotionTrackingAnalysis("source")!.data.manualFrames).toEqual([1]);
  });

  it("rejects a malformed analysis (untrusted shapes for the optional fields)", async () => {
    const project = state().project, signature = motionTrackingSourceSignature(project, state().getClip("source")!, project.mediaLibrary.items[0]);
    const bad = [{ ...data, manualFrames: { length: 1 } }, { ...data, states: ["tracked"] }, { ...data, states: ["x", "y", "z"] }, { ...data, confidence: [1, "a", 1] }, { ...data, lostFrames: ["1"] }] as unknown as TrackingData[];
    for (const entry of bad) await expect(persistMotionTrackingAnalysis(project.id, { version: 1, signature, data: entry })).rejects.toThrow();
    expect(readMotionTrackingAnalysis("source")).toBeNull();
  });

  it("refuses to correct a clip that has no track", async () => {
    await expect(getMotionTrackingBridge().correctPoint("source", 0, { x: 1, y: 1 })).rejects.toThrow("Track the clip");
  });
});
