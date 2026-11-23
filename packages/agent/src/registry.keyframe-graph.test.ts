import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { evaluateKeyframesAt } from "@openreel/core/animation/evaluate-keyframes";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const history = new ActionHistory();
  const host = new HeadlessHost(makeProjectWithClip(), { history });
  return { host, history };
}
const keysOf = (host: HeadlessHost, clip = 0) => host.getProject().timeline.tracks[0].clips[clip].keyframes;

async function addPath(host: HeadlessHost) {
  for (const [time, x, y] of [[0, 0, 0], [1, 300, 200], [2, 600, 0]] as const) {
    expect((await executeTool("add_keyframe", { clipId: "c1", property: "position.x", time, value: x }, host)).ok).toBe(true);
    expect((await executeTool("add_keyframe", { clipId: "c1", property: "position.y", time, value: y }, host)).ok).toBe(true);
  }
}

describe("keyframe graph agent tools", () => {
  it("sets temporal interpolation by property + times as ONE undo step", async () => {
    const { host, history } = setup();
    await addPath(host);
    const before = history.getDisplayHistory().length;
    const result = await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", times: [1], temporal: "continuous-bezier" }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getDisplayHistory().length).toBe(before + 1);
    const mid = keysOf(host).find((k) => k.property === "position.x" && k.time === 1)!;
    expect(mid.interpolationIn).toBe("continuous-bezier");
    expect(mid.interpolationOut).toBe("continuous-bezier");
    const hold = await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", times: [0], temporal: "hold" }, host);
    expect(hold.ok).toBe(true);
    expect(keysOf(host).find((k) => k.property === "position.x" && k.time === 0)!.easing).toBe("hold");
  });

  it("spatial interpolation and handle drags change the sampled route, and sampling matches the core evaluator", async () => {
    const { host } = setup();
    await addPath(host);
    const linear = await executeTool("sample_keyframes", { clipId: "c1", times: [0.5] }, host);
    expect(linear.ok).toBe(true);
    const straight = (linear.data as { samples: { values: Record<string, number> }[] }).samples[0].values;
    expect(straight["position.x"]).toBeCloseTo(150, 6);
    expect(straight["position.y"]).toBeCloseTo(100, 6);

    expect((await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", spatial: "auto-bezier" }, host)).ok).toBe(true);
    const xMid = keysOf(host).find((k) => k.property === "position.x" && k.time === 1)!;
    const dragged = await executeTool("set_keyframe_handles", { clipId: "c1", keyframeId: xMid.id, spatial: { which: "out", x: 0, y: 150 } }, host);
    expect(dragged.ok, dragged.summary).toBe(true);
    const after = keysOf(host).find((k) => k.id === xMid.id)!;
    expect(after.spatialMode).toBe("continuous-bezier");
    expect(after.spatialOut).toEqual({ x: 0, y: 150 });

    const sampled = await executeTool("sample_keyframes", { clipId: "c1", times: [0.25, 0.5, 1, 1.5] }, host);
    const samples = (sampled.data as { samples: { time: number; values: Record<string, number> }[] }).samples;
    for (const sample of samples) {
      const reference = evaluateKeyframesAt(keysOf(host), sample.time);
      expect(sample.values["position.x"]).toBe(reference.get("position.x"));
      expect(sample.values["position.y"]).toBe(reference.get("position.y"));
    }
    expect(samples[1].values["position.y"]).not.toBeCloseTo(100, 1);
    expect(samples[2].values).toMatchObject({ "position.x": 300, "position.y": 200 });
  });

  it("dragging a temporal handle on an Auto Bezier key turns it Continuous", async () => {
    const { host } = setup();
    await addPath(host);
    await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", temporal: "auto-bezier" }, host);
    const mid = keysOf(host).find((k) => k.property === "position.x" && k.time === 1)!;
    const result = await executeTool("set_keyframe_handles", { clipId: "c1", keyframeId: mid.id, temporal: { in: { x: 0.5, y: 0.1 }, out: mid.bezierHandles!.out } }, host);
    expect(result.ok, result.summary).toBe(true);
    const next = keysOf(host).find((k) => k.id === mid.id)!;
    expect(next.interpolationIn).toBe("continuous-bezier");
    expect(next.interpolationOut).toBe("continuous-bezier");
    expect(next.bezierHandles!.in).toEqual({ x: 0.5, y: 0.1 });
  });

  it("refuses spatial interpolation without matching X and Y keys and rejects bad input", async () => {
    const { host } = setup();
    await executeTool("add_keyframe", { clipId: "c1", property: "position.x", time: 0, value: 0 }, host);
    await executeTool("add_keyframe", { clipId: "c1", property: "position.x", time: 1, value: 10 }, host);
    const bad = await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", spatial: "bezier" }, host);
    expect(bad.ok).toBe(false);
    expect((await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", temporal: "wobble" }, host)).ok).toBe(false);
    expect((await executeTool("set_keyframe_interpolation", { clipId: "nope", property: "position.x", temporal: "linear" }, host)).ok).toBe(false);
  });

  it("lists keyframes with handles and interpolation", async () => {
    const { host } = setup();
    await addPath(host);
    await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", spatial: "auto-bezier" }, host);
    const listed = await executeTool("list_clip_keyframes", { clipId: "c1", property: "position.x" }, host);
    const keys = (listed.data as { keyframes: { time: number; spatialMode?: string }[] }).keyframes;
    expect(keys.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(keys.every((k) => k.spatialMode === "auto-bezier")).toBe(true);
  });

  it("copies keyframes (handles and spatial path included) to another clip at a time", async () => {
    const project = makeProjectWithClip();
    const track = project.timeline.tracks[0];
    const second = { ...track.clips[0], id: "c2", keyframes: [], effects: [] };
    const history = new ActionHistory();
    const host = new HeadlessHost({ ...project, timeline: { ...project.timeline, tracks: [{ ...track, clips: [...track.clips, second] }, ...project.timeline.tracks.slice(1)] } }, { history });
    await addPath(host);
    await executeTool("set_keyframe_interpolation", { clipId: "c1", property: "position.x", spatial: "auto-bezier", temporal: "auto-bezier" }, host);
    const before = history.getDisplayHistory().length;
    const copied = await executeTool("copy_keyframes_to_clip", { fromClipId: "c1", toClipId: "c2", keyframeIds: keysOf(host).filter((k) => k.property.startsWith("position")).map((k) => k.id), time: 0.5 }, host);
    expect(copied.ok, copied.summary).toBe(true);
    expect(history.getDisplayHistory().length).toBe(before + 1);
    const target = keysOf(host, 1);
    expect(target).toHaveLength(6);
    expect(target.map((k) => k.time).sort()).toEqual([0.5, 0.5, 1.5, 1.5, 2.5, 2.5]);
    expect(target.filter((k) => k.property === "position.x").every((k) => k.spatialMode === "auto-bezier" && k.interpolationOut === "auto-bezier")).toBe(true);
    expect(new Set(target.map((k) => k.id)).size).toBe(6);
    const sampleA = await executeTool("sample_keyframes", { clipId: "c1", times: [1.2] }, host);
    const sampleB = await executeTool("sample_keyframes", { clipId: "c2", times: [1.7] }, host);
    expect((sampleB.data as { samples: { values: unknown }[] }).samples[0].values).toEqual((sampleA.data as { samples: { values: unknown }[] }).samples[0].values);
  });
});
