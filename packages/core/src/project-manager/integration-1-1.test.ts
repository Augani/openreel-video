import { describe, expect, it } from "vitest";
import type { Clip, Keyframe, Project, Track } from "../types";
import { applyKeyframeInterpolation } from "../animation/keyframe-interpolation";
import { laneFromKeyframes, createNativePluginEffect, nativePluginKeyframeProperty } from "../audio/native-plugin/native-plugin-effect";
import { keyframeEngine } from "../video/keyframe-engine";
import { evaluateKeyframesAt } from "../animation/evaluate-keyframes";
import { DEFAULT_PROJECT_MANAGER_OPTIONS, applyPlan, planProjectManager, type DiskInfo, type ItemResult } from "./index";

const plugin = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple", latencySamples: 0 };
const prop = nativePluginKeyframeProperty("fx1", "0");
const key = (id: string, time: number, value: number): Keyframe => ({ id, time, property: prop, value, easing: "linear" }) as Keyframe;
const base = [key("k1", 0, 0), key("k2", 1, 10), key("k3", 2.5, 4), key("k4", 4, 20)];

describe("one keyframe evaluator across features", () => {
  const modes = ["linear", "bezier", "auto-bezier", "continuous-bezier", "hold", "ease-in", "ease-out"] as const;
  for (const mode of modes) {
    it(`native-plugin lane matches the keyframe engine for ${mode}`, () => {
      const keys = applyKeyframeInterpolation(base, ["k1", "k2", "k3", "k4"], mode, "both");
      const lane = laneFromKeyframes(keys, { inPoint: 0, outPoint: 4, speed: 1, reversed: false });
      expect(lane.length).toBeGreaterThan(3);
      for (const [t, v] of lane) {
        const expected = evaluateKeyframesAt(keys, t).get(prop) ?? Number(keyframeEngine.getValueAtTime(keys as never, t).value);
        expect(v, `${mode} at ${t}`).toBeCloseTo(expected, 6);
      }
      // and between lane points the lane (read linearly, as the host does) stays close to the engine
      for (let t = 0.013; t < 4; t += 0.137) {
        const i = lane.findIndex(([lt]) => lt >= t);
        if (i <= 0) continue;
        const [t0, v0] = lane[i - 1];
        const [t1, v1] = lane[i];
        const read = t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
        const expected = Number(keyframeEngine.getValueAtTime(keys as never, t).value);
        expect(Math.abs(read - expected), `${mode} at ${t}`).toBeLessThan(mode === "hold" ? 10.001 : 0.35);
      }
    });
  }

  it("a hold segment stays flat until the next key instead of ramping early", () => {
    const keys = applyKeyframeInterpolation(base, ["k1", "k2", "k3", "k4"], "hold", "both");
    const lane = laneFromKeyframes(keys, { inPoint: 0, outPoint: 4, speed: 1, reversed: false });
    const read = (t: number): number => {
      const i = lane.findIndex(([lt]) => lt >= t);
      const [t0, v0] = lane[i - 1];
      const [t1, v1] = lane[i];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    };
    expect(read(0.995)).toBeCloseTo(0, 6);
    expect(read(2.49)).toBeCloseTo(10, 6);
  });
});

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const fx = createNativePluginEffect("fx1", plugin, { state: "QUJD", values: { "0": 25 } });
const pclip = (id: string, startTime: number, mediaId: string, inPoint: number): Clip =>
  ({ id, mediaId, trackId: "a1", startTime, duration: 4, inPoint, outPoint: inPoint + 4, effects: [], audioEffects: [fx], transform, volume: 1, keyframes: base }) as unknown as Clip;
const aTrack = { id: "a1", type: "audio", name: "a1", mode: "standard", clips: [pclip("c1", 0, "J", 20), pclip("c2", 4, "J", 50)], transitions: [], locked: false, hidden: false, muted: false, solo: false } as unknown as Track;

describe("Project Manager with media-browser metadata and native plugins", () => {
  const joined = {
    id: "J", name: "GH010001 joined", type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
    metadata: { duration: 120, width: 1920, height: 1080, frameRate: 24, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1000 },
    sourceFile: { name: "GH010001.mp4", size: 1000, lastModified: 1, path: "/cache/media-browser/joined/abc/GH010001.mp4" },
    keywords: ["night", "drive"], logComment: "good take", reel: "A007", scene: "12", xmpSource: "sidecar",
  };
  const project = {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 24, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [joined] } as unknown as Project["mediaLibrary"],
    timeline: { tracks: [aTrack], subtitles: [], duration: 8, markers: [] },
  } as unknown as Project;
  const disk: Record<string, DiskInfo> = { J: { exists: true, size: 1_000_000, width: 1920, height: 1080, fps: 24, duration: 120, hasVideo: true, hasAudio: true, videoCodec: "h264", audioChannels: 2, sampleRate: 48000 } };

  it("keeps the joined file's metadata, the plugin state and keyframes, and moves in/out with the trim", () => {
    const options = { ...DEFAULT_PROJECT_MANAGER_OPTIONS, sequenceIds: ["seq_main"], mode: "consolidate" as const, trim: true, handleFrames: 12, preset: "match-source" as const };
    const plan = planProjectManager(project, options, disk);
    const results: Record<string, ItemResult> = Object.fromEntries(
      plan.items.filter((i) => i.action !== "offline").map((i) => [i.mediaId, { outPath: `/out/${i.outRel}`, size: 5, duration: i.keptSeconds, codec: "h264" }]),
    );
    const out = applyPlan(project, plan, results, { projectId: "new", now: 5 });
    const item = out.mediaLibrary.items[0] as unknown as Record<string, unknown>;
    expect(item).toMatchObject({ keywords: ["night", "drive"], logComment: "good take", reel: "A007", scene: "12", xmpSource: "sidecar" });
    const clips = out.timeline.tracks[0].clips;
    for (const [i, c] of clips.entries()) {
      expect(c.audioEffects[0]).toEqual(fx);
      expect(c.keyframes).toEqual(base);
      expect(c.duration).toBe(4);
      expect(c.outPoint - c.inPoint).toBeCloseTo(4, 6);
      // the lane is keyed to source time through inPoint, so it follows the trim by the same shift
      const before = laneFromKeyframes(base, project.timeline.tracks[0].clips[i]);
      const after = laneFromKeyframes(base, c);
      expect(after.map(([t]) => t - c.inPoint)).toEqual(before.map(([t]) => t - project.timeline.tracks[0].clips[i].inPoint));
    }
  });
});
