import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import type { Project } from "../types/project";
import {
  DEFAULT_VR_PROPERTIES,
  describeVrProperties,
  effectiveVrProperties,
  guessVrFromAspect,
  isVrSequence,
  normalizeInitialView,
  normalizeVrProperties,
  validateVrProperties,
} from "./vr-properties";

function project(): Project {
  return {
    id: "p",
    name: "VR",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 3840, height: 1920, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        { id: "v", name: "sphere.mp4", type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 5, width: 3840, height: 1920, frameRate: 30, codec: "avc", sampleRate: 0, channels: 0, fileSize: 1 } },
        { id: "a", name: "a.wav", type: "audio", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { duration: 5, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 48000, channels: 2, fileSize: 1 } },
      ],
    },
    timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
  } as unknown as Project;
}

describe("VR properties", () => {
  it("validates and normalises", () => {
    expect(validateVrProperties({ projection: "equirectangular", layout: "over-under", horizontalFov: 360, verticalFov: 180 })).toBeNull();
    expect(validateVrProperties({ projection: "cubemap" })).toMatch(/projection/);
    expect(validateVrProperties({ layout: "stacked" })).toMatch(/layout/);
    expect(validateVrProperties({ horizontalFov: 0 })).toMatch(/horizontal/);
    expect(validateVrProperties({ verticalFov: 181 })).toMatch(/vertical/);
    expect(validateVrProperties("x")).toMatch(/object/);
    expect(normalizeVrProperties({ layout: "side-by-side" })).toEqual({ ...DEFAULT_VR_PROPERTIES, layout: "side-by-side" });
    expect(normalizeVrProperties({ projection: "none" }).projection).toBe("none");
    expect(normalizeVrProperties(undefined).projection).toBe("none");
    expect(describeVrProperties(DEFAULT_VR_PROPERTIES)).toContain("monoscopic");
  });

  it("only 2:1 pictures are guessed, and a guess is not treated as VR", () => {
    expect(guessVrFromAspect(3840, 1920)?.source).toBe("aspect");
    expect(guessVrFromAspect(1920, 1080)).toBeNull();
    const hint = { metadata: { vr: { ...DEFAULT_VR_PROPERTIES, source: "aspect" as const } } };
    expect(effectiveVrProperties(hint).projection).toBe("none");
    expect(effectiveVrProperties({ metadata: { vr: { ...DEFAULT_VR_PROPERTIES, source: "metadata" } } }).projection).toBe("equirectangular");
    // The user's override wins over the file.
    expect(effectiveVrProperties({ vrProperties: { ...DEFAULT_VR_PROPERTIES, layout: "over-under" }, metadata: { vr: { ...DEFAULT_VR_PROPERTIES, source: "metadata" } } }).layout).toBe("over-under");
    expect(isVrSequence({ vr: DEFAULT_VR_PROPERTIES })).toBe(true);
    expect(isVrSequence({})).toBe(false);
  });
});

describe("VR properties actions", () => {
  it("sets the sequence VR properties through project/updateSettings and undoes / redoes them", async () => {
    const p = project();
    const executor = new ActionExecutor(new ActionHistory());
    const set = await executor.execute({ type: "project/updateSettings", id: "1", timestamp: 1, params: { vr: { projection: "equirectangular", layout: "over-under", horizontalFov: 360, verticalFov: 180 } } }, p);
    expect(set.success).toBe(true);
    expect(p.settings.vr).toMatchObject({ layout: "over-under" });
    await executor.undo(p);
    expect(p.settings.vr).toBeUndefined();
    await executor.redo(p);
    expect(p.settings.vr?.layout).toBe("over-under");
    // "none" is a flat sequence with no key at all.
    await executor.execute({ type: "project/updateSettings", id: "2", timestamp: 2, params: { vr: { projection: "none", layout: "mono", horizontalFov: 360, verticalFov: 180 } } }, p);
    expect("vr" in p.settings).toBe(false);
  });

  it("rejects an invalid sequence VR property", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const bad = await executor.execute({ type: "project/updateSettings", id: "3", timestamp: 1, params: { vr: { projection: "equirectangular", layout: "nope" } as never } }, project());
    expect(bad.success).toBe(false);
  });

  it("sets a clip source's VR properties through media/organize with one undo step", async () => {
    const p = project();
    const executor = new ActionExecutor(new ActionHistory());
    const ok = await executor.execute({ type: "media/organize", id: "4", timestamp: 1, params: { label: "VR properties", itemPatches: { v: { vrProperties: { projection: "equirectangular", layout: "side-by-side", horizontalFov: 360, verticalFov: 180 } } } } }, p);
    expect(ok.success).toBe(true);
    expect(p.mediaLibrary.items[0].vrProperties?.layout).toBe("side-by-side");
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].vrProperties).toBeUndefined();
    await executor.redo(p);
    expect(p.mediaLibrary.items[0].vrProperties?.layout).toBe("side-by-side");
    const cleared = await executor.execute({ type: "media/organize", id: "5", timestamp: 2, params: { itemPatches: { v: { vrProperties: null } } } }, p);
    expect(cleared.success).toBe(true);
    expect(p.mediaLibrary.items[0].vrProperties).toBeUndefined();
    const audio = await executor.execute({ type: "media/organize", id: "6", timestamp: 3, params: { itemPatches: { a: { vrProperties: { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 } } } } }, p);
    expect(audio.success).toBe(false);
  });
  it("clears the sequence VR properties with vr: null and undoes it", async () => {
    const p = project();
    const executor = new ActionExecutor(new ActionHistory());
    const vr = { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 };
    expect((await executor.execute({ type: "project/updateSettings", id: "s1", timestamp: 1, params: { vr } }, p)).success).toBe(true);
    expect(p.settings.vr?.projection).toBe("equirectangular");
    const cleared = await executor.execute({ type: "project/updateSettings", id: "s2", timestamp: 2, params: { vr: null } }, p);
    expect(cleared.success).toBe(true);
    expect(p.settings.vr).toBeUndefined();
    await executor.undo(p);
    expect(p.settings.vr?.projection).toBe("equirectangular");
  });
});

describe("initial view direction", () => {
  it("wraps heading and roll, clamps pitch and drops a straight-ahead view", () => {
    expect(normalizeInitialView({ yaw: 190, pitch: 100, roll: -190 })).toEqual({ yaw: -170, pitch: 90, roll: 170 });
    expect(normalizeInitialView({ yaw: 0, pitch: 0, roll: 0 })).toBeUndefined();
    expect(normalizeInitialView(undefined)).toBeUndefined();
    expect(normalizeVrProperties({ initialView: { yaw: 45, pitch: 0, roll: 0 } }).initialView).toEqual({ yaw: 45, pitch: 0, roll: 0 });
    expect(normalizeVrProperties({ initialView: { yaw: 0, pitch: 0, roll: 0 } })).not.toHaveProperty("initialView");
  });
  it("validates", () => {
    expect(validateVrProperties({ initialView: { yaw: 10, pitch: 95, roll: 0 } })).toMatch(/pitch/);
    expect(validateVrProperties({ initialView: { yaw: "x" } })).toMatch(/yaw/);
    expect(validateVrProperties({ initialView: 3 })).toMatch(/object/);
    expect(validateVrProperties({ initialView: { yaw: 10, pitch: 5, roll: 0 } })).toBeNull();
    expect(describeVrProperties(normalizeVrProperties({ initialView: { yaw: 45, pitch: 0, roll: 0 } }))).toContain("heading 45");
  });
});
