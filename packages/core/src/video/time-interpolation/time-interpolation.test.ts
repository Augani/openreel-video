import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import { ProjectSerializer } from "../../storage/project-serializer";
import type { IStorageEngine } from "../../storage/types";
import type { Project } from "../../types/project";
import type { Action } from "../../types/actions";
import { blendRGBA, type RGBAFrame } from "./frame-blend";
import { ByteLruCache } from "./interpolation-cache";
import { computeFlowPair, synthesizeFrame } from "./optical-flow-cpu";
import { pan, psnr, renderScene } from "./synthetic-scenes";
import { TimeInterpolator } from "./time-interpolator";
import { effectiveTimeInterpolation, flowParamsFor, planSourceSamples } from "./types";

const W = 96;
const H = 64;

describe("planSourceSamples", () => {
  it("snaps to the frame when the source time is on a frame", () => {
    expect(planSourceSamples(1, 25).needsInterpolation).toBe(false);
    expect(planSourceSamples(1.0002, 25).needsInterpolation).toBe(false);
  });
  it("brackets a between-frames time with the two source frames and the position", () => {
    const plan = planSourceSamples(10.3 / 25, 25);
    expect(plan.needsInterpolation).toBe(true);
    expect(plan.frameBefore).toBe(10);
    expect(plan.frameAfter).toBe(11);
    expect(plan.t).toBeCloseTo(0.3, 6);
    expect(plan.timeBefore).toBeCloseTo(10 / 25, 9);
    expect(plan.timeAfter).toBeCloseTo(11 / 25, 9);
  });
  it("25% speed of a 25 fps clip at 25 fps lands on t = 0, .25, .5, .75", () => {
    const ts = [0, 1, 2, 3, 4].map((frame) => planSourceSamples((frame * 0.25) / 25, 25));
    expect(ts.map((p) => (p.needsInterpolation ? Number(p.t.toFixed(2)) : 0))).toEqual([0, 0.25, 0.5, 0.75, 0]);
    expect(ts.map((p) => p.frameBefore)).toEqual([0, 0, 0, 0, 1]);
  });
});

describe("effectiveTimeInterpolation", () => {
  it("defaults to frame sampling, honours an explicit setting and maps legacy Smooth Slow Motion to optical flow", () => {
    expect(effectiveTimeInterpolation({})).toBe("frameSampling");
    expect(effectiveTimeInterpolation({ timeInterpolation: "frameBlending" })).toBe("frameBlending");
    expect(effectiveTimeInterpolation({ smoothSlowMo: true, speed: 0.5 })).toBe("opticalFlow");
    expect(effectiveTimeInterpolation({ smoothSlowMo: true, speed: 1 })).toBe("frameSampling");
    expect(effectiveTimeInterpolation({ smoothSlowMo: true, speed: 0.5, timeInterpolation: "frameSampling" })).toBe("frameSampling");
  });
});

describe("frame blending", () => {
  const a: RGBAFrame = { width: 2, height: 1, data: new Uint8ClampedArray([0, 100, 200, 255, 255, 0, 40, 255]) };
  const b: RGBAFrame = { width: 2, height: 1, data: new Uint8ClampedArray([100, 200, 0, 255, 0, 255, 80, 255]) };
  it("uses exactly (1 - t) and t as the weights", () => {
    expect(Array.from(blendRGBA(a, b, 0.25))).toEqual([25, 125, 150, 255, 191, 64, 50, 255]);
    expect(Array.from(blendRGBA(a, b, 0.5))).toEqual([50, 150, 100, 255, 128, 128, 60, 255]);
    expect(Array.from(blendRGBA(a, b, 0))).toEqual(Array.from(a.data));
    expect(Array.from(blendRGBA(a, b, 1))).toEqual(Array.from(b.data));
  });
  it("rejects frames of different sizes", () => {
    expect(() => blendRGBA(a, { width: 1, height: 1, data: new Uint8ClampedArray(4) }, 0.5)).toThrow();
  });
});

describe("optical flow determinism", () => {
  it("gives bit-identical frames for identical inputs, and the flow does not depend on t", () => {
    const scene = pan(2.3, 1.1);
    const a = renderScene(scene, W, H, 0);
    const b = renderScene(scene, W, H, 1);
    const params = flowParamsFor("medium");
    const pair1 = computeFlowPair(a, b, params);
    const pair2 = computeFlowPair(a, b, params);
    expect(Array.from(pair1.ab)).toEqual(Array.from(pair2.ab));
    const one = synthesizeFrame(a, b, pair1, 0.3);
    const two = synthesizeFrame(a, b, pair2, 0.3);
    expect(Array.from(one)).toEqual(Array.from(two));
  });
  it("low, medium and high quality all beat blending on a pan", () => {
    const scene = pan(3.4, -1.7);
    const a = renderScene(scene, 128, 96, 0);
    const b = renderScene(scene, 128, 96, 1);
    const truth = renderScene(scene, 128, 96, 0.5);
    const blend = psnr(blendRGBA(a, b, 0.5), truth.data);
    for (const quality of ["low", "medium", "high"] as const) {
      const out = synthesizeFrame(a, b, computeFlowPair(a, b, flowParamsFor(quality)), 0.5);
      const db = psnr(out, truth.data);
      console.log(`[time-interpolation] quality ${quality}: ${db.toFixed(2)} dB vs blend ${blend.toFixed(2)} dB`);
      expect(db).toBeGreaterThan(blend + 4);
    }
  });
});

describe("TimeInterpolator cache", () => {
  const scene = pan(3.4, -1.7);
  const source = (frame: number): RGBAFrame => renderScene(scene, W, H, frame);
  const makeJob = (_interp: TimeInterpolator, t: number, mode: "frameBlending" | "opticalFlow", loads: number[]) => {
    const plan = planSourceSamples((10 + t) / 25, 25);
    return {
      mode,
      sourceKey: "media-1",
      plan,
      quality: "low" as const,
      loadFrame: async (time: number) => {
        loads.push(Math.round(time * 25));
        return source(Math.round(time * 25) - 10);
      },
    };
  };

  it("serves a repeated frame from the cache without decoding or computing again", async () => {
    const interp = new TimeInterpolator();
    interp.setBackend("cpu");
    const loads: number[] = [];
    const first = await interp.render(makeJob(interp, 0.5, "opticalFlow", loads));
    expect(first?.cacheHit).toBe(false);
    const decodedOnce = loads.length;
    const flowMisses = interp.stats.flowMisses;
    const second = await interp.render(makeJob(interp, 0.5, "opticalFlow", loads));
    expect(second?.cacheHit).toBe(true);
    expect(Array.from(second!.data)).toEqual(Array.from(first!.data));
    expect(loads.length).toBe(decodedOnce);
    expect(interp.stats.flowMisses).toBe(flowMisses);
    expect(interp.stats.frameHits).toBe(1);
  });

  it("estimates the flow of a frame pair once for all the intermediates between them", async () => {
    const interp = new TimeInterpolator();
    interp.setBackend("cpu");
    const loads: number[] = [];
    for (const t of [0.25, 0.5, 0.75]) await interp.render(makeJob(interp, t, "opticalFlow", loads));
    expect(interp.stats.flowMisses).toBe(1);
    expect(interp.stats.flowHits).toBe(2);
    // the two source frames were decoded once
    expect(loads.filter((f) => f === 10).length).toBe(1);
    expect(loads.filter((f) => f === 11).length).toBe(1);
  });

  it("keys by mode, so blending and flow never share a frame", async () => {
    const interp = new TimeInterpolator();
    interp.setBackend("cpu");
    const loads: number[] = [];
    const blend = await interp.render(makeJob(interp, 0.5, "frameBlending", loads));
    const flow = await interp.render(makeJob(interp, 0.5, "opticalFlow", loads));
    expect(blend?.path).toBe("blend");
    expect(flow?.path).toBe("cpu");
    expect(flow?.cacheHit).toBe(false);
    expect(Array.from(blend!.data)).not.toEqual(Array.from(flow!.data));
    expect(interp.isCached(makeJob(interp, 0.5, "frameBlending", loads), W, H)).toBe(true);
  });

  it("returns null (caller samples) when a source frame is missing", async () => {
    const interp = new TimeInterpolator();
    const job = { ...makeJob(interp, 0.5, "frameBlending", []), loadFrame: async () => null };
    expect(await interp.render(job)).toBeNull();
  });

  it("clear() drops everything", async () => {
    const interp = new TimeInterpolator();
    interp.setBackend("cpu");
    const loads: number[] = [];
    await interp.render(makeJob(interp, 0.5, "frameBlending", loads));
    interp.clear();
    expect(interp.isCached(makeJob(interp, 0.5, "frameBlending", loads), W, H)).toBe(false);
  });
});

describe("ByteLruCache", () => {
  it("evicts least-recently-used entries once over budget and reports evictions", () => {
    const evicted: string[] = [];
    const cache = new ByteLruCache<string>(10, (v) => evicted.push(v));
    cache.set("a", "A", 4);
    cache.set("b", "B", 4);
    cache.get("a");
    cache.set("c", "C", 4);
    expect(evicted).toEqual(["B"]);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.bytes).toBe(8);
  });
});

function project(): Project {
  const clip = {
    id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 5, inPoint: 0, outPoint: 2.5, effects: [], audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    volume: 1, keyframes: [], speed: 0.5,
  };
  return {
    id: "p1", name: "T", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 5, subtitles: [], markers: [], tracks: [{ id: "t1", type: "video", name: "V1", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}
const act = (type: string, params: Record<string, unknown>): Action => ({ type, id: `a-${type}-${Math.random()}`, timestamp: 0, params }) as Action;

describe("clip time interpolation actions", () => {
  it("sets, undoes and redoes the mode and the quality", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const clip = () => p.timeline.tracks[0].clips[0];
    expect((await executor.execute(act("clip/setTimeInterpolation", { clipId: "c1", timeInterpolation: "opticalFlow" }), p)).success).toBe(true);
    expect(clip().timeInterpolation).toBe("opticalFlow");
    expect((await executor.execute(act("clip/setInterpolationQuality", { clipId: "c1", interpolationQuality: "high" }), p)).success).toBe(true);
    expect(clip().interpolationQuality).toBe("high");
    await executor.undo(p);
    expect(clip().interpolationQuality).toBeUndefined();
    await executor.undo(p);
    expect(clip().timeInterpolation).toBeUndefined();
    await executor.redo(p);
    expect(clip().timeInterpolation).toBe("opticalFlow");
    await executor.redo(p);
    expect(clip().interpolationQuality).toBe("high");
  });

  it("rejects unknown modes and unknown clips", async () => {
    const executor = new ActionExecutor();
    const p = project();
    expect((await executor.execute(act("clip/setTimeInterpolation", { clipId: "c1", timeInterpolation: "magic" }), p)).success).toBe(false);
    expect((await executor.execute(act("clip/setTimeInterpolation", { clipId: "nope", timeInterpolation: "opticalFlow" }), p)).success).toBe(false);
    expect((await executor.execute(act("clip/setInterpolationQuality", { clipId: "c1", interpolationQuality: "ultra" }), p)).success).toBe(false);
  });
});

describe("saved projects", () => {
  it("keeps the mode and quality through save and reload", () => {
    const executorProject = project();
    const mutable = executorProject.timeline.tracks[0].clips[0] as unknown as Record<string, unknown>;
    mutable.timeInterpolation = "frameBlending";
    mutable.interpolationQuality = "low";
    const serializer = new ProjectSerializer({} as IStorageEngine);
    const back = serializer.importFromJson(serializer.exportToJson(executorProject));
    const clip = back.timeline.tracks[0].clips[0];
    expect(clip.timeInterpolation).toBe("frameBlending");
    expect(clip.interpolationQuality).toBe("low");
    expect(effectiveTimeInterpolation(clip)).toBe("frameBlending");
  });

  it("a project saved before the setting (Smooth Slow Motion on) still renders with optical flow", () => {
    const old = project();
    (old.timeline.tracks[0].clips[0] as unknown as Record<string, unknown>).smoothSlowMo = true;
    const serializer = new ProjectSerializer({} as IStorageEngine);
    const back = serializer.importFromJson(serializer.exportToJson(old));
    expect(effectiveTimeInterpolation(back.timeline.tracks[0].clips[0])).toBe("opticalFlow");
  });
});
