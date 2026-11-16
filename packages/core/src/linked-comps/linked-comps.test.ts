import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { Keyframe } from "../types/timeline";
import { AnimationEngine } from "../video/animation-engine";
import {
  GRAPHIC_TEMPLATE_SCHEMA_VERSION,
  expandGraphicInstance,
  getGraphicInstance,
  graphicMemberClipIds,
  moveGraphic,
  removeGraphic,
  setGraphicParameters,
  type GraphicLayer,
  type GraphicTemplate,
} from "../graphic-templates";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import { projectUnsupported } from "../interchange/report";
import {
  bakeSourceProject,
  clearParamKeyframes,
  createLinkedComposition,
  deleteLinkedComposition,
  duplicateLinkedInstance,
  detachLinkedComposition,
  editLinkedComposition,
  getLinkedComposition,
  insertLinkedComposition,
  isBakeStale,
  linkedInstancesOf,
  linkedInterchangeNotes,
  removeParamKeyframe,
  renderAndReplace,
  replaceWithLinkedComposition,
  restoreUnrendered,
  sampleParamKeyframes,
  setParamKeyframe,
  type LinkedEditResult,
} from "./index";
import { LINKED_BAKE_CLIP_KEY } from "./types";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const videoClip = (id: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "m1", trackId: "v1", startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[] = []): Track => ({
  id, type, name: id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const media = (id: string) => ({
  id, name: `${id}.mov`, type: "video", blob: new Blob(["x"]), fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
});
const base = {
  id: "p", name: "P", createdAt: 1, modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [media("m1"), media("render1")] },
  timeline: { tracks: [track("v1", "video", [videoClip("c1", 0, 20)])], subtitles: [], markers: [], duration: 20 },
} as unknown as Project;

const layer = (patch: Partial<GraphicLayer> & Pick<GraphicLayer, "id" | "kind">): GraphicLayer => ({
  name: patch.id, visible: true, x: 960, y: 540, width: 400, height: 100, rotation: 0, opacity: 1, ...patch,
});

function template(): GraphicTemplate {
  return {
    schemaVersion: GRAPHIC_TEMPLATE_SCHEMA_VERSION,
    id: "t-comp",
    name: "Title card",
    category: "custom",
    description: "",
    tags: [],
    duration: 4,
    layers: [
      layer({
        id: "bar", kind: "shape", y: 700, width: 600, height: 20,
        shape: { shapeType: "rectangle", style: { fill: { type: "solid", color: "#14b8a6", opacity: 1 } } },
      }),
      layer({
        id: "title", kind: "text", x: 800, y: 540,
        text: { text: "Hello", style: { fontFamily: "Inter", fontSize: 80, fontWeight: 700, color: "#ffffff", textAlign: "center" } },
      }),
    ],
    parameters: [
      { id: "headline", label: "Headline", type: "text", defaultValue: "Hello", targets: [{ layerId: "title", property: "text" }] },
      { id: "barOpacity", label: "Bar opacity", type: "slider", defaultValue: 1, min: 0, max: 1, step: 0.01, targets: [{ layerId: "bar", property: "opacity" }] },
      { id: "titleX", label: "Title X", type: "number", defaultValue: 800, min: 0, max: 1920, targets: [{ layerId: "title", property: "x" }] },
      { id: "spin", label: "Spin", type: "number", defaultValue: 0, min: -360, max: 360, targets: [{ layerId: "title", property: "rotation" }] },
      { id: "size", label: "Size", type: "number", defaultValue: 80, min: 10, max: 300, targets: [{ layerId: "title", property: "fontSize" }] },
    ],
  };
}

const ok = (result: LinkedEditResult): { project: Project; instanceId?: string; compositionId?: string; warnings?: readonly string[] } => {
  if (!result.ok) throw new Error(result.message);
  return result;
};

function placed(startTime = 2) {
  const result = ok(createLinkedComposition(base, template(), { startTime }));
  return { project: result.project, instanceId: result.instanceId as string, compositionId: result.compositionId as string };
}

const engine = new AnimationEngine();
const valueAt = (keyframes: readonly Keyframe[], property: string, time: number): number | undefined => {
  const keys = engine.getKeyframesForProperty(keyframes as Keyframe[], property);
  if (keys.length === 0) return undefined;
  const value = engine.getValueAtTime(keys, time).value;
  return typeof value === "number" ? value : undefined;
};

const overlays = (project: Project) => [...(project.textClips ?? []), ...(project.shapeClips ?? []), ...(project.svgClips ?? [])];

describe("linked compositions: creating and placing", () => {
  it("creates a composition and one live instance whose layers are ordinary clips", () => {
    const { project, instanceId, compositionId } = placed();
    const composition = getLinkedComposition(project, compositionId);
    expect(composition?.revision).toBe(1);
    const instance = getGraphicInstance(project, instanceId);
    expect(instance?.linkedCompositionId).toBe(compositionId);
    expect(overlays(project).map((clip) => clip.id).sort()).toEqual([`${instanceId}__bar`, `${instanceId}__title`].sort());
    expect(graphicMemberClipIds(project).size).toBe(2);
  });

  it("places a second instance of the same composition", () => {
    const first = placed();
    const second = ok(insertLinkedComposition(first.project, first.compositionId, { startTime: 10 }));
    expect(linkedInstancesOf(second.project, first.compositionId)).toHaveLength(2);
    expect(overlays(second.project)).toHaveLength(4);
  });

  it("rejects an unknown composition and an invalid template", () => {
    expect(insertLinkedComposition(base, "nope", { startTime: 0 }).ok).toBe(false);
    expect(createLinkedComposition(base, { ...template(), schemaVersion: 99 }, { startTime: 0 }).ok).toBe(false);
  });
});

describe("Replace with Linked Composition", () => {
  const textClip = { id: "t1", trackId: "g1", text: "Lower", startTime: 3, duration: 4, style: { fontFamily: "Inter", fontSize: 60, fontWeight: 400, fontStyle: "normal", color: "#ff0000", textAlign: "center", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0 }, transform, keyframes: [] };
  const withText = {
    ...base,
    timeline: { ...base.timeline, tracks: [track("g1", "graphics"), ...base.timeline.tracks] },
    textClips: [textClip],
  } as unknown as Project;

  it("moves the selected clips into a new composition and one live instance spanning them", () => {
    const result = ok(replaceWithLinkedComposition(withText, ["t1"], { name: "Lower third" }));
    const instance = getGraphicInstance(result.project, result.instanceId as string);
    expect(instance?.linkedCompositionId).toBe(result.compositionId);
    expect(instance?.startTime).toBe(3);
    expect(instance?.duration).toBeCloseTo(4);
    expect(getLinkedComposition(result.project, result.compositionId as string)?.name).toBe("Lower third");
    // The loose clip is gone; only the instance's member remains.
    expect(result.project.textClips?.map((clip) => clip.id)).toEqual([`${instance?.id}__text-1`]);
  });

  it("links an existing, unlinked graphic in place and refuses a second link", () => {
    const grouped = ok(replaceWithLinkedComposition(withText, ["t1"]));
    const detached = ok(detachLinkedComposition(grouped.project, grouped.instanceId as string));
    expect(getGraphicInstance(detached.project, grouped.instanceId as string)?.linkedCompositionId).toBeUndefined();
    const member = `${grouped.instanceId}__text-1`;
    const relinked = ok(replaceWithLinkedComposition(detached.project, [member]));
    expect(relinked.instanceId).toBe(grouped.instanceId);
    const again = replaceWithLinkedComposition(relinked.project, [member]);
    expect(again.ok).toBe(false);
  });

  it("explains why a video clip cannot be replaced and keeps the project untouched", () => {
    const result = replaceWithLinkedComposition(base, ["c1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Nest/);
  });

  it("warns when part of a mixed selection is left behind", () => {
    const result = ok(replaceWithLinkedComposition(withText, ["t1", "c1"]));
    expect(result.warnings?.[0]).toMatch(/left on the timeline/);
  });
});

describe("live composition edits", () => {
  const retitle = (text: string) => (t: GraphicTemplate): GraphicTemplate => ({
    ...t,
    layers: t.layers.map((l) => (l.id === "title" && l.text ? { ...l, text: { ...l.text, text } } : l)),
    parameters: t.parameters.map((p) => (p.id === "headline" ? { ...p, defaultValue: text } : p)),
  });
  const colorBar = (color: string) => (t: GraphicTemplate): GraphicTemplate => ({
    ...t,
    layers: t.layers.map((l) => (l.id === "bar" && l.shape ? { ...l, shape: { ...l.shape, style: { ...l.shape.style, fill: { type: "solid" as const, color, opacity: 1 } } } } : l)),
  });

  it("an edit updates every linked instance in the same step, with the layers re-expanded", () => {
    const first = placed();
    const both = ok(insertLinkedComposition(first.project, first.compositionId, { startTime: 10 }));
    const edited = ok(editLinkedComposition(both.project, first.compositionId, colorBar("#ff0000")));
    for (const clip of edited.project.shapeClips ?? []) expect(clip.style.fill.color).toBe("#ff0000");
    expect(edited.project.shapeClips).toHaveLength(2);
    expect(getLinkedComposition(edited.project, first.compositionId)?.revision).toBe(2);
    // Instances keep their own start and values.
    expect(linkedInstancesOf(edited.project, first.compositionId).map((i) => i.startTime).sort((a, b) => a - b)).toEqual([2, 10]);
  });

  it("keeps per-instance parameter values across a master edit", () => {
    const { project, instanceId, compositionId } = placed();
    const customised = setParamViaValues(project, instanceId, { headline: "Custom" });
    const edited = ok(editLinkedComposition(customised, compositionId, colorBar("#00ff00")));
    expect(edited.project.textClips?.[0].text).toBe("Custom");
  });

  it("removing a parameter in the master drops its keyframes and value on every instance", () => {
    const { project, instanceId, compositionId } = placed();
    const keyed = ok(setParamKeyframe(project, instanceId, "barOpacity", { time: 1, value: 0.5 }));
    const edited = ok(editLinkedComposition(keyed.project, compositionId, (t) => ({ ...t, parameters: t.parameters.filter((p) => p.id !== "barOpacity") })));
    const instance = getGraphicInstance(edited.project, instanceId);
    expect(instance?.paramKeyframes).toBeUndefined();
    expect(instance?.values.barOpacity).toBeUndefined();
  });

  it("rejects an invalid edit without changing anything", () => {
    const { project, compositionId } = placed();
    const result = editLinkedComposition(project, compositionId, (t) => ({ ...t, schemaVersion: 99 }));
    expect(result.ok).toBe(false);
    expect(getLinkedComposition(project, compositionId)?.revision).toBe(1);
  });

  it("an edit that changes nothing neither bumps the revision nor rewrites instances", () => {
    const { project, compositionId } = placed();
    const result = ok(editLinkedComposition(project, compositionId, (t) => t));
    expect(result.project).toBe(project);
  });

  it("re-titling through the master reaches the clips", () => {
    const { project, compositionId } = placed();
    const edited = ok(editLinkedComposition(project, compositionId, retitle("Brand new")));
    expect(edited.project.textClips?.[0].text).toBe("Brand new");
  });

  it("a composition in use cannot be deleted; an unused one can", () => {
    const { project, instanceId, compositionId } = placed();
    expect(deleteLinkedComposition(project, compositionId).ok).toBe(false);
    const removed = ok(removeGraphic(project, instanceId) as LinkedEditResult);
    expect(ok(deleteLinkedComposition(removed.project, compositionId)).project.linkedCompositions).toBeUndefined();
  });
});

function setParamViaValues(project: Project, instanceId: string, values: Record<string, unknown>): Project {
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) throw new Error("missing");
  const result = setGraphicParameters(project, instanceId, values);
  if (!result.ok) throw new Error(result.message);
  return result.project;
}

describe("keyframable master properties", () => {
  it("only opacity / rotation / position number controls can be keyframed", () => {
    const { project, instanceId } = placed();
    expect(setParamKeyframe(project, instanceId, "headline", { time: 0, value: 1 }).ok).toBe(false);
    expect(setParamKeyframe(project, instanceId, "size", { time: 0, value: 100 }).ok).toBe(false);
    expect(setParamKeyframe(project, instanceId, "ghost", { time: 0, value: 1 }).ok).toBe(false);
    expect(setParamKeyframe(project, instanceId, "barOpacity", { time: Number.NaN, value: 1 }).ok).toBe(false);
  });

  it("the keyframes reach the member clips and interpolate numerically (opacity)", () => {
    const { project, instanceId } = placed();
    let next = ok(setParamKeyframe(project, instanceId, "barOpacity", { time: 0, value: 0 })).project;
    next = ok(setParamKeyframe(next, instanceId, "barOpacity", { time: 2, value: 1 })).project;
    const bar = next.shapeClips?.[0];
    expect(bar).toBeDefined();
    const keys = bar?.keyframes ?? [];
    expect(valueAt(keys, "opacity", 0)).toBeCloseTo(0, 6);
    expect(valueAt(keys, "opacity", 1)).toBeCloseTo(0.5, 2);
    expect(valueAt(keys, "opacity", 2)).toBeCloseTo(1, 6);
    expect(valueAt(keys, "opacity", 3.5)).toBeCloseTo(1, 6);
  });

  it("sampleParamKeyframes agrees with the interpolated clip opacity at every time", () => {
    const { project, instanceId } = placed();
    let next = ok(setParamKeyframe(project, instanceId, "barOpacity", { time: 0.5, value: 0.1, easing: "easeInOutCubic" })).project;
    next = ok(setParamKeyframe(next, instanceId, "barOpacity", { time: 3, value: 0.9 })).project;
    const keys = getGraphicInstance(next, instanceId)?.paramKeyframes?.barOpacity;
    for (const t of [0, 0.5, 1, 1.7, 2.9, 3, 3.8]) {
      const fromClip = valueAt(next.shapeClips?.[0].keyframes ?? [], "opacity", t) as number;
      expect(sampleParamKeyframes(keys, t, 1)).toBeCloseTo(fromClip, 10);
    }
    expect(sampleParamKeyframes(undefined, 2, 0.4)).toBe(0.4);
  });

  it("rotation keys pass through in degrees and x keys move the layer by their distance in frame fractions", () => {
    const { project, instanceId } = placed();
    let next = ok(setParamKeyframe(project, instanceId, "spin", { time: 0, value: 0 })).project;
    next = ok(setParamKeyframe(next, instanceId, "spin", { time: 4, value: 90 })).project;
    next = ok(setParamKeyframe(next, instanceId, "titleX", { time: 0, value: 800 })).project;
    next = ok(setParamKeyframe(next, instanceId, "titleX", { time: 4, value: 1200 })).project;
    const title = next.textClips?.[0];
    const keys = title?.keyframes ?? [];
    expect(valueAt(keys, "rotation", 2)).toBeCloseTo(45, 2);
    // Design x 800 -> 800/1920 of the frame; 1200 -> 1200/1920; halfway is 1000/1920.
    expect(valueAt(keys, "position.x", 0)).toBeCloseTo(800 / 1920, 5);
    expect(valueAt(keys, "position.x", 2)).toBeCloseTo(1000 / 1920, 4);
    expect(valueAt(keys, "position.x", 4)).toBeCloseTo(1200 / 1920, 5);
  });

  it("scales with the frame: a 1280x720 project still moves by the same fraction", () => {
    const { project, instanceId } = placed();
    const small = { ...project, settings: { ...project.settings, width: 1280, height: 720 } } as Project;
    const keyed = ok(setParamKeyframe(small, instanceId, "titleX", { time: 0, value: 960 })).project;
    expect(valueAt(keyed.textClips?.[0].keyframes ?? [], "position.x", 0)).toBeCloseTo(0.5, 5);
  });

  it("replaces a keyframe at the same time, clamps to the range, removes and clears", () => {
    const { project, instanceId } = placed();
    let next = ok(setParamKeyframe(project, instanceId, "barOpacity", { time: 1, value: 0.2 })).project;
    next = ok(setParamKeyframe(next, instanceId, "barOpacity", { time: 1, value: 9 })).project;
    let keys = getGraphicInstance(next, instanceId)?.paramKeyframes?.barOpacity ?? [];
    expect(keys).toHaveLength(1);
    expect(keys[0].value).toBe(1);
    next = ok(setParamKeyframe(next, instanceId, "barOpacity", { time: 3, value: 0 })).project;
    keys = getGraphicInstance(next, instanceId)?.paramKeyframes?.barOpacity ?? [];
    expect(keys.map((k) => k.time)).toEqual([1, 3]);
    next = ok(removeParamKeyframe(next, instanceId, "barOpacity", keys[0].id)).project;
    expect(getGraphicInstance(next, instanceId)?.paramKeyframes?.barOpacity).toHaveLength(1);
    next = ok(clearParamKeyframes(next, instanceId, "barOpacity")).project;
    expect(getGraphicInstance(next, instanceId)?.paramKeyframes).toBeUndefined();
    expect(removeParamKeyframe(next, instanceId, "barOpacity", "nope").ok).toBe(false);
  });
});

describe("preview and export agree", () => {
  // Preview and export render the same expanded clips (they only ever see ordinary clips),
  // so the live-edited project and the project a fresh export would load from disk must
  // produce numerically identical clips and sampled values.
  it("a live-edited, keyframed instance equals a fresh expansion of the saved document at every sampled time", () => {
    const { project, instanceId, compositionId } = placed();
    let live = ok(setParamKeyframe(project, instanceId, "barOpacity", { time: 0, value: 0 })).project;
    live = ok(setParamKeyframe(live, instanceId, "barOpacity", { time: 3, value: 1 })).project;
    live = ok(setParamKeyframe(live, instanceId, "titleX", { time: 0, value: 700 })).project;
    live = ok(setParamKeyframe(live, instanceId, "titleX", { time: 3, value: 1100 })).project;
    live = ok(editLinkedComposition(live, compositionId, (t) => ({
      ...t,
      layers: t.layers.map((l) => (l.id === "title" && l.text ? { ...l, text: { ...l.text, text: "Edited live" } } : l)),
    }))).project;

    // "Export": the saved/loaded document, expanded from scratch.
    const loaded = JSON.parse(JSON.stringify(editSnapshot(live))) as Project;
    const instance = getGraphicInstance(loaded, instanceId);
    if (!instance) throw new Error("instance lost");
    const fresh = expandGraphicInstance(instance, loaded.settings);

    expect(fresh.textClips).toEqual(live.textClips);
    expect(fresh.shapeClips).toEqual(live.shapeClips);
    for (const t of [0, 0.25, 1, 1.5, 2.75, 3, 3.9]) {
      const a = valueAt(live.shapeClips?.[0].keyframes ?? [], "opacity", t);
      const b = valueAt(fresh.shapeClips[0].keyframes, "opacity", t);
      expect(a).toBeDefined();
      expect(a as number).toBeCloseTo(b as number, 12);
      const x1 = valueAt(live.textClips?.[0].keyframes ?? [], "position.x", t) as number;
      const x2 = valueAt(fresh.textClips[0].keyframes, "position.x", t) as number;
      expect(x1).toBeCloseTo(x2, 12);
      // And both equal the animator's intent: linear 700 -> 1100 design px over 3 s.
      const expected = (700 + (Math.min(t, 3) / 3) * 400) / 1920;
      expect(x1).toBeCloseTo(expected, 4);
    }
  });

  it("the instance template always equals the master after any number of edits", () => {
    const { project, compositionId } = placed();
    let next = project;
    for (const text of ["A", "B", "C"]) {
      next = ok(editLinkedComposition(next, compositionId, (t) => ({
        ...t,
        layers: t.layers.map((l) => (l.id === "title" && l.text ? { ...l, text: { ...l.text, text } } : l)),
      }))).project;
    }
    const composition = getLinkedComposition(next, compositionId);
    for (const instance of linkedInstancesOf(next, compositionId)) expect(instance.template).toEqual(composition?.template);
  });
});

describe("Render and Replace / Restore Unrendered", () => {
  it("bakeSourceProject isolates the instance and gives its exact range", () => {
    const { project, instanceId } = placed(2);
    const source = bakeSourceProject(project, instanceId);
    if (!source.ok) throw new Error(source.message);
    expect(source.range).toEqual({ startTime: 2, endTime: 6 });
    expect(source.project.timeline.tracks).toHaveLength(1);
    expect(overlays(source.project)).toHaveLength(2);
    expect(source.project.timeline.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });

  it("swaps the live layers for one media clip, and Restore brings them back identically", () => {
    const { project, instanceId } = placed(2);
    const before = overlays(project);
    const baked = ok(renderAndReplace(project, instanceId, "render1")).project;
    expect(overlays(baked)).toHaveLength(0);
    const instance = getGraphicInstance(baked, instanceId);
    const bakedClip = baked.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === instance?.bake?.clipId);
    expect(bakedClip?.mediaId).toBe("render1");
    expect(bakedClip?.startTime).toBe(2);
    expect(bakedClip?.duration).toBeCloseTo(4);
    expect(bakedClip?.metadata?.[LINKED_BAKE_CLIP_KEY]).toBe(instanceId);
    expect(graphicMemberClipIds(baked).size).toBe(0);

    const restored = ok(restoreUnrendered(baked, instanceId)).project;
    expect(restored.timeline.tracks.flatMap((t) => t.clips).some((c) => c.id === instance?.bake?.clipId)).toBe(false);
    expect(getGraphicInstance(restored, instanceId)?.bake).toBeUndefined();
    expect(overlays(restored)).toEqual(before);
    // The video track the render was created on is gone again.
    expect(restored.timeline.tracks.map((t) => t.id).sort()).toEqual(project.timeline.tracks.map((t) => t.id).sort());
  });

  it("Restore uses the rendered clip's current position and a master edit is picked up", () => {
    const { project, instanceId, compositionId } = placed(2);
    const baked = ok(renderAndReplace(project, instanceId, "render1")).project;
    const clipId = getGraphicInstance(baked, instanceId)?.bake?.clipId;
    const moved = {
      ...baked,
      timeline: { ...baked.timeline, tracks: baked.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, startTime: 8, duration: 2 } : c)) })) },
    } as Project;
    const edited = ok(editLinkedComposition(moved, compositionId, (t) => ({ ...t, name: "Renamed template" }))).project;
    expect(isBakeStale(edited, getGraphicInstance(edited, instanceId) as never)).toBe(true);
    const restored = ok(restoreUnrendered(edited, instanceId)).project;
    const instance = getGraphicInstance(restored, instanceId);
    expect(instance?.startTime).toBe(8);
    expect(instance?.duration).toBeCloseTo(2);
    expect(restored.textClips?.[0].startTime).toBe(8);
  });

  it("refuses to render twice, to restore what is live, to render a plain graphic, or with unknown media", () => {
    const { project, instanceId } = placed();
    expect(renderAndReplace(project, instanceId, "missing").ok).toBe(false);
    expect(restoreUnrendered(project, instanceId).ok).toBe(false);
    const baked = ok(renderAndReplace(project, instanceId, "render1")).project;
    expect(renderAndReplace(baked, instanceId, "render1").ok).toBe(false);
    expect(setParamKeyframe(baked, instanceId, "barOpacity", { time: 0, value: 1 }).ok).toBe(false);
    expect(detachLinkedComposition(baked, instanceId).ok).toBe(false);
  });

  it("a baked clip survives an edit snapshot round trip", () => {
    const { project, instanceId } = placed();
    const baked = ok(renderAndReplace(project, instanceId, "render1")).project;
    const loaded = JSON.parse(JSON.stringify(editSnapshot(baked))) as Project;
    expect(getGraphicInstance(loaded, instanceId)?.bake?.mediaId).toBe("render1");
    expect(loaded.linkedCompositions).toHaveLength(1);
  });
});

describe("interchange flatten report", () => {
  const nameOf = (clip: Clip) => clip.id;
  it("reports a live composition once (not once per layer) as dropped, with the fix", () => {
    const { project } = placed();
    const items = projectUnsupported(project, nameOf).filter((item) => item.feature === "Linked composition");
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("dropped");
    expect(items[0].detail).toMatch(/Render and Replace/);
    expect(projectUnsupported(project, nameOf).some((item) => item.feature === "Text clip" || item.feature === "Shape clip")).toBe(false);
    expect(linkedInterchangeNotes(project)[0].state).toBe("live");
  });

  it("a rendered composition is flattened to its media clip with an approximation warning, stale if edited since", () => {
    const { project, instanceId, compositionId } = placed();
    const baked = ok(renderAndReplace(project, instanceId, "render1")).project;
    let items = projectUnsupported(baked, nameOf).filter((item) => item.feature === "Linked composition");
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("approximated");
    expect(items[0].detail).not.toMatch(/out of date/);
    const edited = ok(editLinkedComposition(baked, compositionId, (t) => ({ ...t, description: "changed" }))).project;
    items = projectUnsupported(edited, nameOf).filter((item) => item.feature === "Linked composition");
    expect(items[0].detail).toMatch(/out of date/);
    expect(linkedInterchangeNotes(edited)[0]).toMatchObject({ state: "rendered", stale: true });
  });

  it("projects without linked compositions are unchanged", () => {
    expect(projectUnsupported(base, nameOf).filter((item) => item.feature === "Linked composition")).toHaveLength(0);
  });
});

describe("review regressions", () => {
  it("refuses a master edit built on an outdated revision and applies one built on the current revision", () => {
    const { project, compositionId } = placed();
    const rename = (name: string) => (t: GraphicTemplate): GraphicTemplate => ({ ...t, name });
    const applied = ok(editLinkedComposition(project, compositionId, rename("A"), { expectedRevision: 1 }));
    expect(getLinkedComposition(applied.project, compositionId)?.revision).toBe(2);
    const stale = editLinkedComposition(applied.project, compositionId, rename("B"), { expectedRevision: 1 });
    expect(stale.ok).toBe(false);
    expect(getLinkedComposition(applied.project, compositionId)?.template.name).toBe("A");
  });

  it("Render and Replace refuses a render of an older revision or a moved span, and accepts a matching one", () => {
    const { project, instanceId, compositionId } = placed(2);
    const rendered = { revision: 1, startTime: 2, duration: 4 };
    const edited = ok(editLinkedComposition(project, compositionId, (t) => ({ ...t, name: "Changed while rendering" }))).project;
    expect(renderAndReplace(edited, instanceId, "render1", rendered).ok).toBe(false);
    const moved = ok(moveGraphic(project, instanceId, { startTime: 5 })).project;
    expect(renderAndReplace(moved, instanceId, "render1", rendered).ok).toBe(false);
    const good = ok(renderAndReplace(project, instanceId, "render1", rendered)).project;
    expect(getGraphicInstance(good, instanceId)?.bake?.revision).toBe(1);
  });

  it("duplicating a linked instance keeps the link, the control values and the keyframes", () => {
    const { project, instanceId, compositionId } = placed(0);
    const keyed = ok(setParamKeyframe(project, instanceId, "barOpacity", { time: 1, value: 0.25 })).project;
    const custom = ok(setGraphicParameters(keyed, instanceId, { headline: "Custom" })).project;
    const copy = ok(duplicateLinkedInstance(custom, instanceId));
    const duplicate = getGraphicInstance(copy.project, copy.instanceId as string);
    expect(duplicate?.linkedCompositionId).toBe(compositionId);
    expect(duplicate?.startTime).toBe(4);
    expect(duplicate?.values.headline).toBe("Custom");
    expect(duplicate?.paramKeyframes?.barOpacity).toHaveLength(1);
    expect(linkedInstancesOf(copy.project, compositionId)).toHaveLength(2);
    // A later master edit reaches the duplicate too.
    const edited = ok(editLinkedComposition(copy.project, compositionId, (t) => ({ ...t, name: "Renamed" }))).project;
    expect(getGraphicInstance(edited, copy.instanceId as string)?.template.name).toBe("Renamed");
    expect(duplicateLinkedInstance(project, "missing").ok).toBe(false);
  });
});
