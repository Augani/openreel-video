import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_KEYFRAME_PROPERTIES,
  PRO_EFFECT_TYPES,
} from "@openreel/core/video/pro-effects";

function effects(host: HeadlessHost): ReadonlyArray<{ type: string; params: Record<string, unknown> }> {
  const clip = host
    .getProject()
    .timeline.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === "c1");
  return (clip?.effects ?? []) as ReadonlyArray<{ type: string; params: Record<string, unknown> }>;
}

describe("agent pro effects", () => {
  it("lists every pro effect and its params in the add_video_effect description", () => {
    const description = getTool("add_video_effect")?.description ?? "";
    for (const type of PRO_EFFECT_TYPES) expect(description).toContain(type);
    expect(PRO_EFFECT_TYPES).toHaveLength(61);
    expect(description).toContain("blurX 0..100");
  });

  it("accepts every pro effect keyframe property in add_keyframe", () => {
    const schema = getTool("add_keyframe")?.inputSchema as {
      properties: { property: { pattern: string } };
    };
    const pattern = new RegExp(schema.properties.property.pattern);
    for (const property of PRO_EFFECT_KEYFRAME_PROPERTIES) {
      expect(pattern.test(property.id)).toBe(true);
    }
    expect(pattern.test("fx:effect-1:vibrance")).toBe(true);
    expect(pattern.test("opacity")).toBe(true);
    expect(pattern.test("effect.nonsense")).toBe(false);
  });

  it.each(PRO_EFFECT_TYPES)("%s: omitted params seed the same defaults as the UI", async (type) => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool("add_video_effect", { clipId: "c1", effectType: type }, host);
    expect(res.ok).toBe(true);
    expect(effects(host)[0]?.params).toEqual({ ...PRO_EFFECT_DEFAULTS[type] });
  });

  it("explicit params win over defaults and are range-checked", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const ok = await executeTool(
      "add_video_effect",
      { clipId: "c1", effectType: "gaussian-blur", params: { blurX: 30, blurY: 0 } },
      host,
    );
    expect(ok.ok).toBe(true);
    expect(effects(host)[0]?.params).toEqual({ blurX: 30, blurY: 0 });
    const bad = await executeTool(
      "add_video_effect",
      { clipId: "c1", effectType: "vibrance", params: { vibrance: 500 } },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
    const unknown = await executeTool(
      "add_video_effect",
      { clipId: "c1", effectType: "crop", params: { nope: 1 } },
      host,
    );
    expect(unknown.ok).toBe(false);
    expect(effects(host)).toHaveLength(1);
  });

  it("legacy effects added without params get visible defaults, not a silent no-op", async () => {
    const host = new HeadlessHost(makeProjectWithClip());
    const res = await executeTool("add_video_effect", { clipId: "c1", effectType: "blur" }, host);
    expect(res.ok).toBe(true);
    expect(Number(effects(host)[0]?.params.radius)).toBeGreaterThan(0);
    const explicit = await executeTool(
      "add_video_effect",
      { clipId: "c1", effectType: "blur", params: { radius: 2 } },
      host,
    );
    expect(explicit.ok).toBe(true);
    expect(effects(host)[1]?.params).toEqual({ radius: 2 });
  });

  it("tells the agent which pro effect supersedes each legacy one", () => {
    const description = getTool("add_video_effect")?.description ?? "";
    expect(description).toContain("gaussian-blur over blur");
    expect(description).toContain("mosaic over shader pixelate");
  });
});
