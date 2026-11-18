import { describe, expect, it } from "vitest";
import type { Clip, Effect, Project, Track } from "../types";
import { nestClips } from "../timeline/sequences";
import { PRO_EFFECT_DEFAULTS } from "../video/pro-effects";
import { clipTouchedReason } from "../export/smart-render";
import { planInvalidation } from "./invalidation-planner";

/**
 * Wave 7 compositions: the new effects (HSL secondary, breadth batch), pen masks and
 * nests must agree between the render cache and smart render's stream-copy decision.
 */

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m1", trackId: "v1", startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (clips: Clip[]): Track => ({
  id: "v1", type: "video", name: "v1", mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const effect = (type: string, params: Record<string, unknown>, enabled = true): Effect => ({ id: `fx-${type}`, type, params, enabled });
const pen = (clipId: string, feathering = 0) => ({
  id: `mask-${clipId}`, clipId, type: "drawn", feathering, inverted: false, expansion: 0, opacity: 1, keyframes: [],
  path: { closed: true, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }] },
});

const SHARED_MEDIA = [{
  id: "m1", name: "a.mp4", type: "video", blob: new Blob(["x"]), fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 30, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
}] as unknown as Project["mediaLibrary"]["items"];

function project(clips: Clip[], extra: Partial<Project> = {}): Project {
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: SHARED_MEDIA },
    timeline: { tracks: [track(clips)], subtitles: [], markers: [], duration: 20 },
    ...extra,
  } as Project;
}

const hslSecondary = () => effect("hsl-secondary", { ...PRO_EFFECT_DEFAULTS["hsl-secondary"], saturation: -50 });
const cameraBlur = () => effect("camera-blur", { ...PRO_EFFECT_DEFAULTS["camera-blur"], radius: 8 });

describe("smart render stream-copy decision for wave 7 content", () => {
  it("an enabled HSL secondary or breadth-batch effect forces a re-encode; a disabled one does not", () => {
    const base = project([clip("c", 0, 4)]);
    expect(clipTouchedReason(base, clip("c", 0, 4))).toBeNull();
    for (const fx of [hslSecondary(), cameraBlur(), effect("levels", { ...PRO_EFFECT_DEFAULTS["levels"] })]) {
      expect(clipTouchedReason(base, clip("c", 0, 4, { effects: [fx] }))).toBe("effects");
      expect(clipTouchedReason(base, clip("c", 0, 4, { effects: [{ ...fx, enabled: false }] }))).toBeNull();
    }
  });

  it("a drawn pen mask forces a re-encode of its clip only", () => {
    const masked = project([clip("a", 0, 4), clip("b", 4, 4)], { masks: [pen("a")] as unknown as Project["masks"] });
    expect(clipTouchedReason(masked, clip("a", 0, 4))).toBe("mask");
    expect(clipTouchedReason(masked, clip("b", 4, 4))).toBeNull();
  });

  it("a nest clip is never stream-copied, even when everything inside it is untouched", () => {
    const base = project([clip("a", 0, 4), clip("b", 4, 4)], { masks: [pen("a")] as unknown as Project["masks"] });
    const nested = nestClips(base, ["a", "b"], "Nest");
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    const nestClip = nested.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === nested.clipId);
    expect(nestClip).toBeDefined();
    expect(clipTouchedReason(nested.project, nestClip as Clip)).toBe("nested sequence");
  });
});

describe("render cache invalidation for wave 7 content", () => {
  const nestedProject = (masks: unknown[], effects: Effect[] = []): Project => {
    const base = project([clip("a", 2, 3, { effects }), clip("b", 5, 3), clip("outside", 10, 2)], { masks: masks as Project["masks"] });
    const nested = nestClips(base, ["a", "b"], "Nest");
    if (!nested.ok) throw new Error("nest failed");
    return nested.project;
  };
  const NEST_SPAN = [[2, 8]];
  /** The same parent after an edit made inside the nest (the derived nest projection changes). */
  const editInsideNest = (source: Project, edit: (nestClips: Clip[]) => Clip[]): Project => ({
    ...source,
    compoundClips: source.compoundClips?.map((compound) => ({
      ...compound,
      content: {
        ...compound.content,
        clips: edit(compound.content.clips),
        tracks: compound.content.tracks.map((t) => ({ ...t, clips: edit(t.clips) })),
      },
    })),
  });
  const ranges = (a: Project, b: Project) => {
    const result = planInvalidation(a, b);
    expect(result.all).toBe(false);
    return result.ranges.map((r) => [r.start, r.end]);
  };

  it("a secondary or new-effect parameter change invalidates exactly that clip's span", () => {
    const a = project([clip("a", 0, 4, { effects: [hslSecondary()] }), clip("b", 4, 4, { effects: [cameraBlur()] })]);
    const secondary = project([
      clip("a", 0, 4, { effects: [effect("hsl-secondary", { ...PRO_EFFECT_DEFAULTS["hsl-secondary"], saturation: 20 })] }),
      clip("b", 4, 4, { effects: [cameraBlur()] }),
    ]);
    expect(ranges(a, secondary)).toEqual([[0, 4]]);
    const blur = project([
      clip("a", 0, 4, { effects: [hslSecondary()] }),
      clip("b", 4, 4, { effects: [effect("camera-blur", { ...PRO_EFFECT_DEFAULTS["camera-blur"], radius: 20 })] }),
    ]);
    expect(ranges(a, blur)).toEqual([[4, 8]]);
    expect(planInvalidation(a, project([clip("a", 0, 4, { effects: [hslSecondary()] }), clip("b", 4, 4, { effects: [cameraBlur()] })])).ranges).toEqual([]);
  });

  it("a pen mask edit invalidates the masked clip", () => {
    const a = project([clip("a", 0, 4), clip("b", 4, 4)], { masks: [pen("a", 0)] as unknown as Project["masks"] });
    const b = project([clip("a", 0, 4), clip("b", 4, 4)], { masks: [pen("a", 12)] as unknown as Project["masks"] });
    expect(ranges(a, b)).toEqual([[0, 4]]);
  });

  it("editing a pen mask on a clip inside a nest invalidates the nest clip span in the parent", () => {
    const before = nestedProject([pen("a", 0)]);
    const after: Project = { ...before, masks: [pen("a", 12)] as unknown as Project["masks"] };
    expect(ranges(before, after)).toEqual(NEST_SPAN);
  });

  it("editing a secondary inside a nest invalidates the nest clip span in the parent", () => {
    const before = nestedProject([], [hslSecondary()]);
    const after = editInsideNest(before, (clips) =>
      clips.map((c) =>
        c.id === "a" ? { ...c, effects: [effect("hsl-secondary", { ...PRO_EFFECT_DEFAULTS["hsl-secondary"], saturation: 30 })] } : c,
      ),
    );
    expect(ranges(before, after)).toEqual(NEST_SPAN);
  });
});
