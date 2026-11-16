import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeProjectWithClip } from "./test-fixtures";
import { getAnimatedVideoEffects } from "@openreel/core/video/animated-video-effects";
import type { Clip } from "@openreel/core/types/timeline";

function clipOf(host: HeadlessHost): Clip {
  const clip = host.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === "c1");
  if (!clip) throw new Error("clip c1 missing");
  return clip;
}

async function hostWithEffect(type: string, params?: Record<string, number>): Promise<{ host: HeadlessHost; effectId: string }> {
  const host = new HeadlessHost(makeProjectWithClip());
  const added = await executeTool("add_video_effect", { clipId: "c1", effectType: type, ...(params ? { params } : {}) }, host);
  expect(added.ok).toBe(true);
  return { host, effectId: clipOf(host).effects[0]!.id };
}

describe("add_keyframe / remove_keyframe / set_clip_keyframes use instance-keyed effect ids", () => {
  it("accepts fx:<effectId>:<param> and samples it", async () => {
    const { host, effectId } = await hostWithEffect("blur", { radius: 0 });
    const property = `fx:${effectId}:radius`;
    expect((await executeTool("add_keyframe", { clipId: "c1", property, time: 0, value: 0 }, host)).ok).toBe(true);
    expect((await executeTool("add_keyframe", { clipId: "c1", property, time: 2, value: 20 }, host)).ok).toBe(true);
    expect(clipOf(host).keyframes.map((k) => k.property)).toEqual([property, property]);
    expect(getAnimatedVideoEffects(clipOf(host), 1)[0]!.params.radius).toBe(10);
  });

  it("maps a legacy type-keyed id onto the effect instance", async () => {
    const { host, effectId } = await hostWithEffect("brightness", { value: 0 });
    expect((await executeTool("add_keyframe", { clipId: "c1", property: "effect.brightness", time: 0, value: -0.5 }, host)).ok).toBe(true);
    expect(clipOf(host).keyframes[0]!.property).toBe(`fx:${effectId}:value`);
  });

  it("maps a legacy pro-effect id onto the instance", async () => {
    const { host, effectId } = await hostWithEffect("vibrance");
    await executeTool("add_keyframe", { clipId: "c1", property: "effect.vibrance.vibrance", time: 0, value: 10 }, host);
    expect(clipOf(host).keyframes[0]!.property).toBe(`fx:${effectId}:vibrance`);
  });

  it("rejects an fx id whose effect is not on the clip", async () => {
    const { host } = await hostWithEffect("blur", { radius: 1 });
    const res = await executeTool("add_keyframe", { clipId: "c1", property: "fx:missing:radius", time: 0, value: 1 }, host);
    expect(res.ok).toBe(false);
    expect(clipOf(host).keyframes).toEqual([]);
  });

  it("rejects a legacy id when the clip has no effect of that type", async () => {
    const { host } = await hostWithEffect("blur", { radius: 1 });
    const res = await executeTool("add_keyframe", { clipId: "c1", property: "effect.brightness", time: 0, value: 1 }, host);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain("add the effect first");
    expect(clipOf(host).keyframes).toEqual([]);
  });

  it("rejects a legacy id as ambiguous when the clip has several instances, listing their ids", async () => {
    const { host } = await hostWithEffect("blur", { radius: 1 });
    await executeTool("add_video_effect", { clipId: "c1", effectType: "blur", params: { radius: 2 } }, host);
    const ids = clipOf(host).effects.map((effect) => effect.id);
    expect(ids).toHaveLength(2);
    for (const tool of ["add_keyframe", "remove_keyframe"]) {
      const res = await executeTool(tool, { clipId: "c1", property: "effect.blur", time: 0, value: 1 }, host);
      expect(res.ok).toBe(false);
      expect(JSON.stringify(res)).toContain("ambiguous");
      for (const id of ids) expect(JSON.stringify(res)).toContain(id);
    }
    const fx = await executeTool("add_keyframe", { clipId: "c1", property: `fx:${ids[1]}:radius`, time: 0, value: 1 }, host);
    expect(fx.ok).toBe(true);
    expect(clipOf(host).keyframes.map((k) => k.property)).toEqual([`fx:${ids[1]}:radius`]);
  });

  it("remove_keyframe resolves legacy ids to the instance", async () => {
    const { host, effectId } = await hostWithEffect("blur", { radius: 0 });
    await executeTool("add_keyframe", { clipId: "c1", property: `fx:${effectId}:radius`, time: 1, value: 5 }, host);
    const removed = await executeTool("remove_keyframe", { clipId: "c1", property: "effect.blur", time: 1 }, host);
    expect(removed.ok).toBe(true);
    expect(clipOf(host).keyframes).toEqual([]);
  });

  it("set_clip_keyframes rewrites legacy ids and validates fx ids", async () => {
    const { host, effectId } = await hostWithEffect("saturation", { value: 1 });
    const ok = await executeTool(
      "set_clip_keyframes",
      {
        clipId: "c1",
        keyframes: [
          { time: 0, property: "effect.saturation", value: 1 },
          { time: 2, property: `fx:${effectId}:value`, value: 2 },
          { time: 0, property: "opacity", value: 1 },
        ],
      },
      host,
    );
    expect(ok.ok).toBe(true);
    expect(clipOf(host).keyframes.map((k) => k.property)).toEqual([`fx:${effectId}:value`, `fx:${effectId}:value`, "opacity"]);
    const bad = await executeTool(
      "set_clip_keyframes",
      { clipId: "c1", keyframes: [{ time: 0, property: "fx:nope:value", value: 1 }] },
      host,
    );
    expect(bad.ok).toBe(false);
  });

  it("add_keyframe rejects a legacy id with no effect on a bare clip, remove_keyframe stays lenient for orphans", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool("add_keyframe", { clipId: "c1", property: "effect.blur", time: 0, value: 2 }, host);
    expect(res.ok).toBe(false);
    expect(clipOf(host).keyframes).toEqual([]);
    const removed = await executeTool("remove_keyframe", { clipId: "c1", property: "effect.blur", time: 0 }, host);
    expect(removed.ok).toBe(true);
  });
});
