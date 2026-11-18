import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { Keyframe } from "../types/timeline";
import { AnimationEngine } from "../video/animation-engine";
import { planInvalidation } from "../render-cache/invalidation-planner";
import { planSmartRender } from "../export/smart-render";
import {
  BUILT_IN_GRAPHIC_TEMPLATES,
  GRAPHIC_LIMITS,
  alignLayers,
  applyParameters,
  distributeLayers,
  editGraphicTemplate,
  exposeProperty,
  expandGraphicInstance,
  getBuiltInGraphicTemplate,
  graphicInstanceToTemplate,
  graphicMemberClipIds,
  insertGraphicTemplate,
  moveGraphic,
  parseGraphicTemplatePackage,
  pinToFrameEdge,
  protectedDurations,
  reconcileGraphicInstances,
  removeGraphic,
  reorderLayer,
  resizeGraphic,
  resolveLayerBoxes,
  serializeGraphicTemplate,
  setLayerPin,
  setGraphicParameter,
  ungroupGraphic,
  validateGraphicTemplate,
  type GraphicInstance,
  type GraphicTemplate,
} from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const mediaClip = (id: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "m1", trackId: "v1", startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const videoTrack = (clips: Clip[]): Track => ({
  id: "v1", type: "video", name: "V1", mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const MEDIA = [{
  id: "m1", name: "a.mp4", type: "video", blob: new Blob(["x"]), fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration: 30, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
}] as unknown as Project["mediaLibrary"]["items"];

function project(width = 1920, height = 1080): Project {
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width, height, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: MEDIA },
    timeline: { tracks: [videoTrack([mediaClip("c1", 0, 20)])], subtitles: [], markers: [], duration: 20 },
  } as Project;
}

const lowerThird = (): GraphicTemplate => {
  const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar");
  if (!template) throw new Error("missing built-in");
  return template;
};

function inserted(template = lowerThird(), values: Record<string, unknown> = {}, base = project()) {
  const result = insertGraphicTemplate(base, template, { startTime: 2, values });
  if (!result.ok) throw new Error(result.message);
  const instance = result.project.graphicInstances?.find((item) => item.id === result.instanceId) as GraphicInstance;
  return { project: result.project, instance };
}

const engine = new AnimationEngine();
const valueAt = (keyframes: readonly Keyframe[], property: string, time: number): number | undefined => {
  const track = engine.getKeyframesForProperty(keyframes as Keyframe[], property);
  if (track.length === 0) return undefined;
  const value = engine.getValueAtTime(track, time).value;
  return typeof value === "number" ? value : undefined;
};

describe("built-in templates", () => {
  it("ships at least 8 templates, every one valid, across the four categories", () => {
    expect(BUILT_IN_GRAPHIC_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    const categories = new Set(BUILT_IN_GRAPHIC_TEMPLATES.map((template) => template.category));
    for (const category of ["lower-third", "title", "callout", "end-card"] as const) expect(categories.has(category)).toBe(true);
    const ids = new Set<string>();
    for (const template of BUILT_IN_GRAPHIC_TEMPLATES) {
      const checked = validateGraphicTemplate(template);
      expect(checked.ok, `${template.id}: ${checked.ok ? "" : checked.errors.join("; ")}`).toBe(true);
      expect(ids.has(template.id)).toBe(false);
      ids.add(template.id);
      expect(template.parameters.length).toBeGreaterThan(0);
    }
  });

  it("every built-in expands to ordinary clips at several frame sizes", () => {
    for (const template of BUILT_IN_GRAPHIC_TEMPLATES) {
      for (const [w, h] of [[1920, 1080], [1280, 720], [1080, 1920], [1080, 1080]]) {
        const { instance } = inserted(template, {}, project(w, h));
        const out = expandGraphicInstance(instance, { width: w, height: h });
        const count = out.textClips.length + out.shapeClips.length + out.svgClips.length;
        expect(count).toBeGreaterThan(0);
        for (const clip of [...out.textClips, ...out.shapeClips, ...out.svgClips]) {
          expect(clip.duration).toBe(instance.duration);
          expect(clip.startTime).toBe(2);
          expect(Number.isFinite(clip.transform.position.x)).toBe(true);
          expect(Number.isFinite(clip.transform.scale.x)).toBe(true);
        }
      }
    }
  });
});

describe("insertion and parameters", () => {
  it("places member clips on a new graphics track with deterministic ids and a hidden member set", () => {
    const { project: next, instance } = inserted();
    expect(next.timeline.tracks[0].id).toBe(instance.trackId);
    expect(next.timeline.tracks[0].clips).toHaveLength(0);
    const members = [...(next.textClips ?? []), ...(next.shapeClips ?? [])];
    expect(members.every((clip) => clip.id.startsWith(`${instance.id}__`))).toBe(true);
    expect(graphicMemberClipIds(next).size).toBe(members.length);
    expect(next.timeline.duration).toBeDefined();
  });

  it("reuses a free graphics track for a second graphic that does not overlap", () => {
    const first = inserted();
    const second = insertGraphicTemplate(first.project, lowerThird(), { startTime: 10 });
    expect(second.ok && second.project.timeline.tracks.length).toBe(first.project.timeline.tracks.length);
  });

  it("changing an exposed text and color control rewrites only the targeted layers", () => {
    const { project: base, instance } = inserted();
    const edited = setGraphicParameter(base, instance.id, "name", "Sam Rivera");
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const colored = setGraphicParameter(edited.project, instance.id, "accent", "#00ff88");
    expect(colored.ok).toBe(true);
    if (!colored.ok) return;
    const nameClip = colored.project.textClips?.find((clip) => clip.id.endsWith("__name"));
    expect(nameClip?.text).toBe("Sam Rivera");
    const accent = colored.project.shapeClips?.find((clip) => clip.id.endsWith("__accent"));
    expect(accent?.style.fill.color).toBe("#00ff88");
    const titleBefore = base.textClips?.find((clip) => clip.id.endsWith("__title"));
    const titleAfter = colored.project.textClips?.find((clip) => clip.id.endsWith("__title"));
    expect(titleAfter).toEqual(titleBefore);
    // The input project was not mutated.
    expect(base.textClips?.find((clip) => clip.id.endsWith("__name"))?.text).toBe("ALEX MORGAN");
  });

  it("rejects unknown controls and values of the wrong type", () => {
    const { project: base, instance } = inserted();
    expect(setGraphicParameter(base, instance.id, "nope", "x").ok).toBe(false);
    expect(setGraphicParameter(base, instance.id, "accent", "not a color").ok).toBe(false);
    expect(setGraphicParameter(base, instance.id, "showTitle", "yes").ok).toBe(false);
    expect(setGraphicParameter(base, instance.id, "nameSize", 5000).ok).toBe(true);
    const clamped = setGraphicParameter(base, instance.id, "nameSize", 5000);
    if (clamped.ok) expect(clamped.project.graphicInstances?.[0].values.nameSize).toBe(80);
  });

  it("the checkbox control toggles a layer's member clip", () => {
    const { project: base, instance } = inserted();
    const off = setGraphicParameter(base, instance.id, "showTitle", false);
    expect(off.ok && off.project.textClips?.some((clip) => clip.id.endsWith("__title"))).toBe(false);
    if (!off.ok) return;
    const on = setGraphicParameter(off.project, instance.id, "showTitle", true);
    expect(on.ok && on.project.textClips?.some((clip) => clip.id.endsWith("__title"))).toBe(true);
  });
});

describe("intro / outro protection", () => {
  it("intro keyframes stay at the clip start and outro keyframes stay at the clip end when stretched", () => {
    const { project: base, instance } = inserted();
    const short = expandGraphicInstance({ ...instance, duration: 4 }, base.settings);
    const long = expandGraphicInstance({ ...instance, duration: 11 }, base.settings);
    for (const layerId of ["plate", "name", "title"]) {
      const a = short.textClips.find((c) => c.id.endsWith(`__${layerId}`)) ?? short.shapeClips.find((c) => c.id.endsWith(`__${layerId}`));
      const b = long.textClips.find((c) => c.id.endsWith(`__${layerId}`)) ?? long.shapeClips.find((c) => c.id.endsWith(`__${layerId}`));
      expect(a && b).toBeTruthy();
      if (!a || !b) continue;
      for (const property of ["opacity", "scale.x", "position.x"]) {
        // Evaluate relative to the start (intro) and to the end (outro).
        for (const dt of [0.1, 0.25, 0.4, 0.55]) {
          const early = valueAt(a.keyframes, property, dt);
          const late = valueAt(a.keyframes, property, 4 - dt);
          if (early === undefined || late === undefined) continue;
          expect(valueAt(b.keyframes, property, dt)).toBeCloseTo(early, 6);
          expect(valueAt(b.keyframes, property, 11 - dt)).toBeCloseTo(late, 6);
        }
      }
    }
  });

  it("resize keeps the intro/outro spans and never shrinks below intro+outro+hold", () => {
    const { project: base, instance } = inserted();
    const { intro, outro, minDuration } = protectedDurations(instance.template);
    expect(intro).toBeGreaterThan(0.5);
    expect(outro).toBeGreaterThan(0.2);
    const stretched = resizeGraphic(base, instance.id, { duration: 12 });
    expect(stretched.ok && stretched.project.graphicInstances?.[0].duration).toBe(12);
    const crushed = resizeGraphic(base, instance.id, { duration: 0.2 });
    expect(crushed.ok && crushed.project.graphicInstances?.[0].duration).toBe(minDuration);
    if (crushed.ok) {
      for (const clip of crushed.project.shapeClips ?? []) expect(clip.duration).toBe(minDuration);
    }
  });

  it("trimming the left edge keeps the right edge fixed", () => {
    const { project: base, instance } = inserted();
    const trimmed = resizeGraphic(base, instance.id, { startTime: 3, duration: 99 });
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    const next = trimmed.project.graphicInstances?.[0] as GraphicInstance;
    expect(next.startTime).toBe(3);
    expect(next.startTime + next.duration).toBeCloseTo(instance.startTime + instance.duration, 9);
  });
});

describe("responsive pinning and layout", () => {
  it("pinned layers keep their distance from the frame edge at any aspect ratio", () => {
    const layers = lowerThird().layers;
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
      const boxes = resolveLayerBoxes(layers, { width: w, height: h });
      const plate = boxes.get("plate");
      const frameH = (h / w) * 1920;
      expect(plate).toBeDefined();
      if (!plate) continue;
      expect(plate.cx - plate.w / 2).toBeCloseTo(110, 6);
      expect(frameH - (plate.cy + plate.h / 2)).toBeCloseTo(110, 6);
      // Children pinned to the plate follow it.
      const name = boxes.get("name");
      expect(name && name.cx - name.w / 2).toBeCloseTo(110 + 44, 6);
    }
  });

  it("align / distribute / reorder / pin-to-edge edit the template without touching other layers", () => {
    const template = getBuiltInGraphicTemplate("builtin-end-subscribe") as GraphicTemplate;
    const aligned = alignLayers(template, ["slotA", "slotB"], "top", "selection");
    const a = aligned.layers.find((l) => l.id === "slotA");
    const b = aligned.layers.find((l) => l.id === "slotB");
    expect(a?.y).toBe(b?.y);
    const framed = alignLayers(template, ["heading"], "center", "frame");
    expect(framed.layers.find((l) => l.id === "heading")?.x).toBe(960);
    const three = distributeLayers(
      { ...template, layers: template.layers.map((l) => (l.id === "slotA" ? { ...l, x: 100 } : l.id === "slotB" ? { ...l, x: 1000 } : l.id === "buttonText" ? { ...l, x: 400 } : l)) },
      ["slotA", "slotB", "buttonText"], "horizontal",
    );
    const xs = ["slotA", "buttonText", "slotB"].map((id) => three.layers.find((l) => l.id === id) as { x: number; width: number });
    const gap1 = xs[1].x - xs[1].width / 2 - (xs[0].x + xs[0].width / 2);
    const gap2 = xs[2].x - xs[2].width / 2 - (xs[1].x + xs[1].width / 2);
    expect(gap1).toBeCloseTo(gap2, 6);
    const reordered = reorderLayer(template, "heading", 0);
    expect(reordered.layers[0].id).toBe("heading");
    expect(reordered.layers.length).toBe(template.layers.length);
    const pinned = pinToFrameEdge(template, "heading", "vertical", "start");
    expect(pinned.layers.find((l) => l.id === "heading")?.pin?.vertical?.to).toBe("frame");
  });

  it("refuses a pin that would form a cycle", () => {
    const template = lowerThird();
    // "name" is pinned to "plate": pinning "plate" back to "name" would loop.
    expect(setLayerPin(template, "plate", "horizontal", { edge: "start", to: "name", offset: 0 })).toBe(template);
    expect(setLayerPin(template, "plate", "horizontal", { edge: "start", to: "plate", offset: 0 })).toBe(template);
    const ok = setLayerPin(template, "title", "vertical", { edge: "start", to: "name", offset: 4 });
    expect(ok.layers.find((l) => l.id === "title")?.pin?.vertical?.to).toBe("name");
  });
});

describe("edit commands", () => {
  it("editGraphicTemplate (Edit tab) regenerates members and keeps values", () => {
    const { project: base, instance } = inserted(lowerThird(), { name: "Kept" });
    const edited = editGraphicTemplate(base, instance.id, (t) => alignLayers(t, ["plate"], "center", "frame"));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.project.textClips?.find((c) => c.id.endsWith("__name"))?.text).toBe("Kept");
    const plateBefore = base.shapeClips?.find((c) => c.id.endsWith("__plate"));
    const plateAfter = edited.project.shapeClips?.find((c) => c.id.endsWith("__plate"));
    expect(plateAfter?.transform.position.x).not.toBe(plateBefore?.transform.position.x);
  });

  it("move, remove and ungroup", () => {
    const { project: base, instance } = inserted();
    const moved = moveGraphic(base, instance.id, { startTime: 7 });
    expect(moved.ok && moved.project.shapeClips?.every((c) => c.startTime === 7)).toBe(true);
    const removed = removeGraphic(base, instance.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.project.graphicInstances).toBeUndefined();
      expect(removed.project.textClips?.length ?? 0).toBe(0);
    }
    const loose = ungroupGraphic(base, instance.id);
    expect(loose.ok).toBe(true);
    if (loose.ok) {
      expect(loose.project.graphicInstances).toBeUndefined();
      expect(loose.project.textClips?.length).toBeGreaterThan(0);
      expect(loose.project.textClips?.every((c) => c.metadata?.graphicInstanceId === undefined)).toBe(true);
    }
  });

  it("exposeProperty adds a control that drives the layer", () => {
    const { project: base, instance } = inserted();
    const exposed = editGraphicTemplate(base, instance.id, (t) => exposeProperty(t, "plate", "opacity", { label: "Plate opacity", group: "Style" }));
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    const next = exposed.project.graphicInstances?.[0] as GraphicInstance;
    const control = next.template.parameters.find((p) => p.label === "Plate opacity");
    expect(control?.type).toBe("slider");
    const set = setGraphicParameter(exposed.project, instance.id, control?.id ?? "", 0.5);
    expect(set.ok && set.project.shapeClips?.find((c) => c.id.endsWith("__plate"))?.transform.opacity).toBe(0.5);
  });
});

describe("reconcile after generic timeline edits", () => {
  it("adopts a uniform shift of the member clips (sync lock) as the instance's new span", () => {
    const { project: base, instance } = inserted();
    const shift = <T extends { startTime: number }>(list: T[] | undefined) => list?.map((c) => ({ ...c, startTime: c.startTime + 3 }));
    const shifted: Project = { ...base, textClips: shift(base.textClips), shapeClips: shift(base.shapeClips), svgClips: shift(base.svgClips) };
    const next = reconcileGraphicInstances(shifted);
    expect(next.graphicInstances?.[0].startTime).toBe(instance.startTime + 3);
  });

  it("never deletes an instance whose members are missing, and is a no-op when in sync", () => {
    const { project: base } = inserted();
    expect(reconcileGraphicInstances(base)).toBe(base);
    const stripped: Project = { ...base, textClips: [], shapeClips: [], svgClips: [] };
    expect(reconcileGraphicInstances(stripped).graphicInstances).toHaveLength(1);
    const plain: Project = project();
    expect(reconcileGraphicInstances(plain)).toBe(plain);
  });

  it("regenerates when members disagree among themselves", () => {
    const { project: base, instance } = inserted();
    const broken: Project = { ...base, shapeClips: base.shapeClips?.map((c, i) => (i === 0 ? { ...c, duration: c.duration - 1 } : c)) };
    const next = reconcileGraphicInstances(broken);
    expect(next.shapeClips?.every((c) => c.duration === instance.duration)).toBe(true);
  });
});

describe("save as template and round trip", () => {
  it("graphicInstanceToTemplate keeps current values as defaults and re-expands to the same clips", () => {
    const { project: base, instance } = inserted(lowerThird(), { name: "Saved Name", accent: "#123456" });
    const saved = graphicInstanceToTemplate(instance, { name: "My Lower Third", id: "custom-1" });
    expect(saved.category).toBe("custom");
    expect(saved.parameters.find((p) => p.id === "name")?.defaultValue).toBe("Saved Name");
    const fresh = insertGraphicTemplate(project(), saved, { startTime: 2, duration: instance.duration });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const strip = (p: Project) => JSON.stringify({ t: p.textClips, s: p.shapeClips, v: p.svgClips }).replaceAll(/graphic_[0-9a-f-]+/g, "G").replaceAll(/track_[0-9a-f-]+/g, "T");
    expect(strip(fresh.project)).toBe(strip(base));
  });

  it("serialises to a versioned .openreel-template and parses back to an identical template", () => {
    const template = lowerThird();
    const text = serializeGraphicTemplate(template);
    const parsed = parseGraphicTemplatePackage(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.template).toEqual(template);
    expect(JSON.parse(text).schemaVersion).toBe(1);
  });

  it("applyParameters is pure", () => {
    const template = lowerThird();
    const before = JSON.stringify(template);
    applyParameters(template, { name: "x" });
    expect(JSON.stringify(template)).toBe(before);
  });
});

describe("import validation rejects malicious or oversized content", () => {
  const pack = (template: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ format: "openreel-template", schemaVersion: 1, template, ...extra });
  const base = () => JSON.parse(JSON.stringify(lowerThird())) as Record<string, unknown>;

  it("rejects non-templates, bad JSON and newer versions with a clear message", () => {
    expect(parseGraphicTemplatePackage("nope").ok).toBe(false);
    expect(parseGraphicTemplatePackage("[]").ok).toBe(false);
    expect(parseGraphicTemplatePackage(JSON.stringify({ format: "other" })).ok).toBe(false);
    const newer = parseGraphicTemplatePackage(pack(base(), { schemaVersion: 99 }));
    expect(!newer.ok && newer.errors[0]).toMatch(/newer OpenReel/);
  });

  it("rejects prototype-pollution keys anywhere in the document", () => {
    const text = pack(base()).replace('"name":', '"__proto__":{"x":1},"name":');
    expect(parseGraphicTemplatePackage(text).ok).toBe(false);
  });

  it("rejects svg layers carrying scripts, event handlers or external references", () => {
    const withSvg = (svgContent: string) => {
      const t = base() as { layers: Array<Record<string, unknown>> };
      t.layers.push({ id: "evil", name: "Evil", kind: "svg", x: 1, y: 1, width: 10, height: 10, svg: { svgContent, viewBoxWidth: 10, viewBoxHeight: 10 } });
      return parseGraphicTemplatePackage(pack(t));
    };
    expect(withSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>').ok).toBe(true);
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/x)"/></svg>',
    ]) expect(withSvg(bad).ok, bad).toBe(false);
  });

  it("rejects oversized content: too many layers, huge strings, huge files, non-data images", () => {
    const many = base() as { layers: unknown[] };
    many.layers = Array.from({ length: GRAPHIC_LIMITS.maxLayers + 1 }, (_, i) => ({ id: `l${i}`, name: "x", kind: "shape", x: 0, y: 0, width: 1, height: 1, shape: { shapeType: "rectangle", style: {} } }));
    expect(parseGraphicTemplatePackage(pack(many)).ok).toBe(false);
    const long = base() as { description: string };
    long.description = "x".repeat(GRAPHIC_LIMITS.maxStringLength + 1);
    expect(parseGraphicTemplatePackage(pack(long)).ok).toBe(false);
    expect(parseGraphicTemplatePackage("x".repeat(GRAPHIC_LIMITS.maxFileBytes + 1)).ok).toBe(false);
    const img = base() as { layers: Array<Record<string, unknown>> };
    img.layers.push({ id: "img", name: "Img", kind: "image", x: 1, y: 1, width: 10, height: 10, image: { src: "https://evil.example/a.png", aspect: 1 } });
    expect(parseGraphicTemplatePackage(pack(img)).ok).toBe(false);
  });

  it("rejects controls that target missing layers or mismatched properties, and drops unknown keys", () => {
    const t = base() as { parameters: Array<Record<string, unknown>> };
    t.parameters.push({ id: "bad", label: "Bad", type: "color", defaultValue: "#fff", targets: [{ layerId: "ghost", property: "fill" }] });
    expect(parseGraphicTemplatePackage(pack(t)).ok).toBe(false);
    const u = base() as Record<string, unknown>;
    u.unexpected = { deep: true };
    const parsed = parseGraphicTemplatePackage(pack(u));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("unexpected" in parsed.template).toBe(false);
  });
});

describe("render cache and smart render", () => {
  it("a parameter change invalidates exactly the graphic's span and nothing else", () => {
    const { project: base, instance } = inserted();
    const changed = setGraphicParameter(base, instance.id, "name", "Different");
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const plan = planInvalidation(base, changed.project);
    expect(plan.all).toBe(false);
    expect(plan.ranges).toEqual([{ start: instance.startTime, end: instance.startTime + instance.duration }]);
  });

  it("a no-op parameter write invalidates nothing, and an unrelated edit leaves graphics frames alone", () => {
    const { project: base, instance } = inserted();
    const same = setGraphicParameter(base, instance.id, "name", "ALEX MORGAN");
    expect(same.ok).toBe(true);
    if (same.ok) expect(planInvalidation(base, same.project).ranges).toEqual([]);
  });

  it("stretching invalidates the union of the old and new spans only", () => {
    const { project: base, instance } = inserted();
    const stretched = resizeGraphic(base, instance.id, { duration: instance.duration + 4 });
    expect(stretched.ok).toBe(true);
    if (!stretched.ok) return;
    const plan = planInvalidation(base, stretched.project);
    expect(plan.all).toBe(false);
    expect(plan.ranges).toEqual([{ start: instance.startTime, end: instance.startTime + instance.duration + 4 }]);
  });

  it("smart render always re-encodes a graphic's span but may still copy the untouched rest", () => {
    const { project: base, instance } = inserted(lowerThird(), {}, project());
    const fps = 30;
    const source = {
      codec: "avc", width: 1920, height: 1080, frameRate: fps, firstPts: 0, endTime: 30,
      keyframeTimes: Array.from({ length: 31 }, (_, i) => i),
    };
    const plan = planSmartRender({
      project: base,
      settings: { format: "mp4", codec: "h264", width: 1920, height: 1080, frameRate: fps },
      sources: new Map([["m1", source]]) as never,
      exportStart: 0,
      totalFrames: 20 * fps,
    });
    const graphicStart = Math.round(instance.startTime * fps);
    const graphicEnd = Math.round((instance.startTime + instance.duration) * fps);
    for (const segment of plan.segments) {
      if (segment.kind !== "copy") continue;
      expect(segment.endFrame <= graphicStart || segment.startFrame >= graphicEnd).toBe(true);
    }
  });
});
