import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeProjectWithClip } from "./test-fixtures";
import { getAnimatedVideoEffects } from "@openreel/core/video/animated-video-effects";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import type { Clip } from "@openreel/core/types/timeline";

const histories = new WeakMap<HeadlessHost, ActionHistory>();
function newHost(): HeadlessHost {
  const history = new ActionHistory();
  const host = new HeadlessHost(makeProjectWithClip(), { history });
  histories.set(host, history);
  return host;
}
async function undo(host: HeadlessHost): Promise<void> {
  const result = await new ActionExecutor(histories.get(host)).undo(host.getProject());
  expect(result.success).toBe(true);
}

function clipOf(host: HeadlessHost): Clip {
  const clip = host.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === "c1");
  if (!clip) throw new Error("clip c1 missing");
  return clip;
}

async function hostWithTwoBlurs(): Promise<{ host: HeadlessHost; first: string; second: string }> {
  const host = newHost();
  expect((await executeTool("add_video_effect", { clipId: "c1", effectType: "blur", params: { radius: 0 } }, host)).ok).toBe(true);
  const first = clipOf(host).effects[0]!.id;
  const dup = await executeTool("duplicate_video_effect", { clipId: "c1", effectId: first }, host);
  expect(dup.ok).toBe(true);
  const second = (dup.data as { effectId: string }).effectId;
  return { host, first, second };
}

describe("effect instance keyframe tools", () => {
  it("lists animatable params of an instance", async () => {
    const { host, first } = await hostWithTwoBlurs();
    const res = await executeTool("list_effect_params", { clipId: "c1", effectId: first }, host);
    expect(res.ok).toBe(true);
    const params = (res.data as { params: Array<{ key: string }> }).params;
    expect(params.map((p) => p.key)).toContain("radius");
  });

  it("animates two copies of the same effect independently", async () => {
    const { host, first, second } = await hostWithTwoBlurs();
    for (const [effectId, a, b] of [[first, 0, 20], [second, 50, 100]] as const) {
      expect((await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId, param: "radius", time: 0, value: a }, host)).ok).toBe(true);
      expect((await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId, param: "radius", time: 2, value: b }, host)).ok).toBe(true);
    }
    const sampled = getAnimatedVideoEffects(clipOf(host), 1);
    expect(sampled.find((e) => e.id === first)?.params.radius).toBe(10);
    expect(sampled.find((e) => e.id === second)?.params.radius).toBe(75);
  });

  it("updates an existing keyframe instead of duplicating it, and undoes", async () => {
    const { host, first } = await hostWithTwoBlurs();
    await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius", time: 1, value: 3 }, host);
    await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius", time: 1, value: 9 }, host);
    const keys = clipOf(host).keyframes.filter((k) => k.property === `fx:${first}:radius`);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.value).toBe(9);
    await undo(host);
    expect(clipOf(host).keyframes.find((k) => k.property === `fx:${first}:radius`)?.value).toBe(3);
  });

  it("rejects unknown effects, non-animatable params and bad numbers", async () => {
    const { host, first } = await hostWithTwoBlurs();
    const missing = await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: "nope", param: "radius", time: 0, value: 1 }, host);
    expect(missing.error?.code).toBe("INVALID_PARAMS");
    const badParam = await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: first, param: "color", time: 0, value: 1 }, host);
    expect(badParam.error?.code).toBe("INVALID_PARAMS");
    const badTime = await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius", time: -1, value: 1 }, host);
    expect(badTime.error?.code).toBe("INVALID_PARAMS");
  });

  it("removes one keyframe, or all of a parameter when time is omitted", async () => {
    const { host, first } = await hostWithTwoBlurs();
    for (const time of [0, 1, 2]) {
      await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius", time, value: time }, host);
    }
    const one = await executeTool("remove_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius", time: 1 }, host);
    expect(one.ok).toBe(true);
    expect(clipOf(host).keyframes).toHaveLength(2);
    const all = await executeTool("remove_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius" }, host);
    expect(all.ok).toBe(true);
    expect(clipOf(host).keyframes).toHaveLength(0);
    const none = await executeTool("remove_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius" }, host);
    expect(none.ok).toBe(false);
  });

  it("duplicating an animated effect copies its keyframes onto the new instance", async () => {
    const host = newHost();
    await executeTool("add_video_effect", { clipId: "c1", effectType: "blur", params: { radius: 1 } }, host);
    const first = clipOf(host).effects[0]!.id;
    await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId: first, param: "radius", time: 0, value: 4 }, host);
    const dup = await executeTool("duplicate_video_effect", { clipId: "c1", effectId: first }, host);
    const second = (dup.data as { effectId: string }).effectId;
    expect(clipOf(host).effects.map((e) => e.id)).toEqual([first, second]);
    expect(clipOf(host).keyframes.filter((k) => k.property === `fx:${second}:radius`)).toHaveLength(1);
    await undo(host);
    expect(clipOf(host).effects).toHaveLength(1);
    expect(clipOf(host).keyframes).toHaveLength(1);
  });
});

describe("effect preset tools", () => {
  async function animated(): Promise<{ host: HeadlessHost; effectId: string }> {
    const host = newHost();
    await executeTool("add_video_effect", { clipId: "c1", effectType: "blur", params: { radius: 1 } }, host);
    const effectId = clipOf(host).effects[0]!.id;
    const duration = clipOf(host).duration;
    await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId, param: "radius", time: 0, value: 0 }, host);
    await executeTool("set_effect_param_keyframe", { clipId: "c1", effectId, param: "radius", time: duration, value: 40 }, host);
    return { host, effectId };
  }

  it("saves a preset, applies it as an independent instance, and undoes", async () => {
    const { host, effectId } = await animated();
    const saved = await executeTool("save_effect_preset", { clipId: "c1", name: "Fade blur", timing: "relative" }, host);
    expect(saved.ok).toBe(true);
    const presetId = (saved.data as { presetId: string }).presetId;
    expect(host.getProject().effectPresets).toHaveLength(1);
    const listed = await executeTool("list_effect_presets", {}, host);
    expect((listed.data as { presets: unknown[] }).presets).toHaveLength(1);

    const applied = await executeTool("apply_effect_preset", { clipId: "c1", presetId }, host);
    expect(applied.ok).toBe(true);
    const newId = (applied.data as { effectIds: string[] }).effectIds[0]!;
    expect(newId).not.toBe(effectId);
    expect(clipOf(host).effects).toHaveLength(2);
    expect(clipOf(host).keyframes.filter((k) => k.property === `fx:${newId}:radius`)).toHaveLength(2);
    await undo(host);
    expect(clipOf(host).effects).toHaveLength(1);
  });

  it("replace mode swaps the stack", async () => {
    const { host } = await animated();
    const saved = await executeTool("save_effect_preset", { clipId: "c1", name: "P" }, host);
    const presetId = (saved.data as { presetId: string }).presetId;
    await executeTool("apply_effect_preset", { clipId: "c1", presetId, mode: "replace" }, host);
    expect(clipOf(host).effects).toHaveLength(1);
    expect(clipOf(host).keyframes).toHaveLength(2);
  });

  it("exports to JSON and imports into another project without overwriting", async () => {
    const { host } = await animated();
    await executeTool("save_effect_preset", { clipId: "c1", name: "Shared", timing: "absolute" }, host);
    const exported = await executeTool("export_effect_presets", {}, host);
    expect(exported.ok).toBe(true);
    const json = (exported.data as { json: string }).json;

    const other = newHost();
    const imported = await executeTool("import_effect_presets", { json }, other);
    expect(imported.ok).toBe(true);
    expect(other.getProject().effectPresets?.[0]?.name).toBe("Shared");
    const again = await executeTool("import_effect_presets", { json }, other);
    expect(again.ok).toBe(true);
    const ids = other.getProject().effectPresets!.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    const bad = await executeTool("import_effect_presets", { json: "{nope" }, other);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("deletes presets and validates inputs", async () => {
    const { host } = await animated();
    const saved = await executeTool("save_effect_preset", { clipId: "c1", name: "Gone" }, host);
    const presetId = (saved.data as { presetId: string }).presetId;
    expect((await executeTool("save_effect_preset", { clipId: "c1", name: " " }, host)).error?.code).toBe("INVALID_PARAMS");
    expect((await executeTool("apply_effect_preset", { clipId: "c1", presetId: "x" }, host)).error?.code).toBe("INVALID_PARAMS");
    expect((await executeTool("delete_effect_preset", { presetId }, host)).ok).toBe(true);
    expect(host.getProject().effectPresets).toHaveLength(0);
  });
});

describe("mask combine tool", () => {
  it("sets combine on a clip mask via set_clip_mask_path", async () => {
    const host = newHost();
    const points = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }];
    const a = await executeTool("set_clip_mask_path", { clipId: "c1", points }, host);
    const b = await executeTool("set_clip_mask_path", { clipId: "c1", points, combine: "subtract" }, host);
    expect(a.ok && b.ok).toBe(true);
    const masks = host.getProject().masks ?? [];
    expect(masks[0]?.combine).toBeUndefined();
    expect(masks[1]?.combine).toBe("subtract");
    const bad = await executeTool("set_clip_mask_path", { clipId: "c1", maskId: masks[1]!.id, combine: "xor" }, host);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
    const edit = await executeTool("set_clip_mask_path", { clipId: "c1", maskId: masks[0]!.id, combine: "difference" }, host);
    expect(edit.ok).toBe(true);
    expect(host.getProject().masks?.[0]?.combine).toBe("difference");
  });
});
