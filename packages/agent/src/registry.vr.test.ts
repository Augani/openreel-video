import { describe, expect, it } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, mediaId: string, trackId: string) => ({ id, mediaId, trackId, startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [], keyframes: [], volume: 1, transform });

function project(): Project {
  const base = makeEmptyProject();
  return {
    ...base,
    settings: { ...base.settings, width: 1920, height: 1080 },
    mediaLibrary: { items: [
      { id: "sphere", name: "sphere.mp4", type: "video", blob: null, metadata: { duration: 20, width: 3840, height: 1920, frameRate: 30, sampleRate: 48000, vr: { projection: "equirectangular", layout: "over-under", horizontalFov: 360, verticalFov: 180, source: "metadata" } } },
      { id: "guess", name: "maybe.mp4", type: "video", blob: null, metadata: { duration: 20, width: 2000, height: 1000, frameRate: 30, sampleRate: 48000, vr: { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180, source: "aspect" } } },
      { id: "aud", name: "a.wav", type: "audio", blob: null, metadata: { duration: 20, width: 0, height: 0, frameRate: 0, sampleRate: 48000, channels: 2 } },
    ] },
    timeline: { ...base.timeline, tracks: [
      { id: "v1", type: "video", name: "Main", clips: [clip("c1", "sphere", "v1"), { ...clip("c3", "guess", "v1"), startTime: 4 }], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      { id: "a1", type: "audio", name: "A1", clips: [clip("c2", "aud", "a1")], transitions: [], locked: false, hidden: false, muted: false, solo: false },
    ] },
  } as unknown as Project;
}

const newHost = () => new HeadlessHost(project(), { history: new ActionHistory() });

describe("immersive video tools", () => {
  it("lists the lazy VR group and the VR effects are generic pro effects", () => {
    const names = toMcpTools().map((tool) => tool.name);
    for (const name of ["set_sequence_vr_properties", "set_clip_vr_properties", "get_vr_properties", "reframe_360_to_flat"]) expect(names).toContain(name);
    const add = toMcpTools().find((t) => t.name === "add_video_effect");
    for (const type of ["vr-rotate-sphere", "vr-projection", "vr-blur", "vr-plane-to-sphere", "vr-sharpen", "vr-glow", "vr-chromatic-aberrations", "vr-digital-glitch", "vr-de-noise"]) expect(add?.description).toContain(type);
  });

  it("sets the initial view direction of the sequence and keeps it when other fields change", async () => {
    const host = newHost();
    const set = await executeTool("set_sequence_vr_properties", { projection: "equirectangular", initialView: { yaw: 120, pitch: 10, roll: 0 } }, host);
    expect(set.ok).toBe(true);
    expect(host.getProject().settings.vr).toMatchObject({ initialView: { yaw: 120, pitch: 10, roll: 0 } });
    await executeTool("set_sequence_vr_properties", { layout: "over-under" }, host);
    expect(host.getProject().settings.vr).toMatchObject({ layout: "over-under", initialView: { yaw: 120, pitch: 10, roll: 0 } });
    // Straight ahead clears it; a pitch past the pole is refused.
    await executeTool("set_sequence_vr_properties", { initialView: { yaw: 0, pitch: 0, roll: 0 } }, host);
    expect(host.getProject().settings.vr?.initialView).toBeUndefined();
    expect((await executeTool("set_sequence_vr_properties", { initialView: { yaw: 0, pitch: 120, roll: 0 } }, host)).ok).toBe(false);
  });

  it("sets and clears the sequence VR properties (one undoable step)", async () => {
    const host = newHost();
    const set = await executeTool("set_sequence_vr_properties", { projection: "equirectangular", layout: "over-under" }, host);
    expect(set.ok).toBe(true);
    expect(host.getProject().settings.vr).toMatchObject({ projection: "equirectangular", layout: "over-under", horizontalFov: 360, verticalFov: 180 });
    const got = await executeTool("get_vr_properties", {}, host);
    expect(got.data).toMatchObject({ sequenceIsVr: true });
    // Fields not given keep their value.
    await executeTool("set_sequence_vr_properties", { horizontalFov: 180 }, host);
    expect(host.getProject().settings.vr).toMatchObject({ layout: "over-under", horizontalFov: 180 });
    expect((await executeTool("set_sequence_vr_properties", { clear: true }, host)).ok).toBe(true);
    expect(host.getProject().settings.vr).toBeUndefined();
    expect((await executeTool("set_sequence_vr_properties", { projection: "none" }, host)).ok).toBe(true);
  });

  it("rejects invalid VR properties", async () => {
    const host = newHost();
    expect((await executeTool("set_sequence_vr_properties", {}, host)).ok).toBe(false);
    expect((await executeTool("set_sequence_vr_properties", { projection: "cubemap" }, host)).ok).toBe(false);
    expect((await executeTool("set_sequence_vr_properties", { projection: "equirectangular", horizontalFov: 400 }, host)).ok).toBe(false);
    expect((await executeTool("set_clip_vr_properties", { clipId: "c2", projection: "equirectangular" }, host)).ok).toBe(false);
    expect((await executeTool("set_clip_vr_properties", { clipId: "nope", projection: "equirectangular" }, host)).ok).toBe(false);
  });

  it("sets a clip's source VR properties, and a 2:1 hint is not VR until set", async () => {
    const host = newHost();
    const before = await executeTool("get_vr_properties", { clipId: "c3" }, host);
    expect((before.data as { media: { effective: { projection: string } } }).media.effective.projection).toBe("none");
    const meta = await executeTool("get_vr_properties", { clipId: "c1" }, host);
    expect((meta.data as { media: { effective: { layout: string } } }).media.effective.layout).toBe("over-under");
    const set = await executeTool("set_clip_vr_properties", { clipId: "c3", projection: "equirectangular", layout: "mono" }, host);
    expect(set.ok).toBe(true);
    const item = host.getProject().mediaLibrary.items.find((m) => m.id === "guess")!;
    expect(item.vrProperties).toMatchObject({ projection: "equirectangular", layout: "mono" });
    const after = await executeTool("get_vr_properties", { clipId: "c3" }, host);
    expect((after.data as { media: { effective: { projection: string } } }).media.effective.projection).toBe("equirectangular");
    expect((await executeTool("set_clip_vr_properties", { clipId: "c3", clear: true }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.items.find((m) => m.id === "guess")!.vrProperties).toBeUndefined();
  });

  it("adds VR effects through add_video_effect, seeding the sequence's frame layout", async () => {
    const host = newHost();
    await executeTool("set_sequence_vr_properties", { projection: "equirectangular", layout: "side-by-side" }, host);
    const add = await executeTool("add_video_effect", { clipId: "c1", effectType: "vr-rotate-sphere", params: { pan: 30 } }, host);
    expect(add.ok).toBe(true);
    const fx = host.getProject().timeline.tracks[0].clips[0].effects[0];
    expect(fx.params).toMatchObject({ layout: "side-by-side", pan: 30, tilt: 0, roll: 0 });
    const bad = await executeTool("add_video_effect", { clipId: "c1", effectType: "vr-rotate-sphere", params: { pan: 999 } }, host);
    expect(bad.ok).toBe(false);
    const explicit = await executeTool("add_video_effect", { clipId: "c1", effectType: "vr-blur", params: { layout: "mono", radius: 4 } }, host);
    expect(explicit.ok).toBe(true);
    expect(host.getProject().timeline.tracks[0].clips[0].effects[1].params).toMatchObject({ layout: "mono", radius: 4 });
  });

  it("reframes 360 to flat: a VR Projection effect aimed at the view, the clip set to Cover", async () => {
    const host = newHost();
    const res = await executeTool("reframe_360_to_flat", { clipId: "c1", pan: 40, tilt: 10, fov: 80 }, host);
    expect(res.ok).toBe(true);
    const c = host.getProject().timeline.tracks[0].clips[0];
    expect(c.effects[0]).toMatchObject({ type: "vr-projection", params: { mode: "rectilinear", pan: 40, tilt: 10, fov: 80, layout: "over-under" } });
    expect(c.effects[0].params.aspect).toBeCloseTo(1920 / 1080, 3);
    expect(c.transform.fitMode).toBe("cover");
    expect((res.data as { effectId: string }).effectId).toBe(c.effects[0].id);
    expect((await executeTool("reframe_360_to_flat", { clipId: "c1", fov: 200 }, host)).ok).toBe(false);
    expect((await executeTool("reframe_360_to_flat", { clipId: "c2" }, host)).ok).toBe(false);
    // The effect keyframes through the generic keyframe tools, angles on the shorter arc.
  });
});
