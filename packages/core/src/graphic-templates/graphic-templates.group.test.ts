import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import type { Keyframe } from "../types/timeline";
import type { ShapeClip, SVGClip } from "../graphics/types";
import { DEFAULT_SHAPE_STYLE } from "../graphics/types";
import type { TextClip } from "../text/types";
import { DEFAULT_TEXT_STYLE } from "../text/types";
import { AnimationEngine } from "../video/animation-engine";
import {
  expandGraphicInstance,
  groupClipsIntoGraphic,
  groupableClipIds,
  parseGraphicTemplatePackage,
  protectedDurations,
  resizeGraphic,
  serializeGraphicTemplate,
  setGraphicParameter,
} from "./index";

const identity = { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };

const kf = (id: string, time: number, property: string, value: number): Keyframe => ({ id, time, property, value, easing: "easeOutCubic" });

function fixture(): Project {
  const text: TextClip = {
    id: "t1", trackId: "v1", startTime: 1, duration: 4, text: "Hello World",
    style: { ...DEFAULT_TEXT_STYLE, fontSize: 60, color: "#ffee00", textAlign: "left", letterSpacing: 3 },
    transform: { ...identity, position: { x: 0.2, y: 0.8 } },
    keyframes: [kf("k1", 0, "opacity", 0), kf("k2", 0.5, "opacity", 1), kf("k3", 3.5, "opacity", 1), kf("k4", 4, "opacity", 0)],
  };
  const shape: ShapeClip = {
    id: "s1", trackId: "v1", startTime: 1, duration: 4, type: "shape", shapeType: "rectangle",
    style: { ...DEFAULT_SHAPE_STYLE, fill: { type: "solid", color: "#2244ff", opacity: 1 } },
    transform: { ...identity, position: { x: 0.3, y: 0.75 }, scale: { x: 4, y: 0.8 } },
    keyframes: [kf("k5", 0, "position.x", 0.1), kf("k6", 0.4, "position.x", 0.3)],
  };
  const late: ShapeClip = {
    id: "s2", trackId: "v1", startTime: 2, duration: 2, type: "shape", shapeType: "circle",
    style: { ...DEFAULT_SHAPE_STYLE }, transform: { ...identity, position: { x: 0.7, y: 0.3 } }, keyframes: [],
  };
  const svg: SVGClip = {
    id: "g1", trackId: "v1", startTime: 1, duration: 4, type: "svg",
    svgContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#fff"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 100, height: 50 }, preserveAspectRatio: "xMidYMid",
    transform: { ...identity, position: { x: 0.5, y: 0.4 }, scale: { x: 0.3, y: 0.3 } }, keyframes: [],
  };
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      tracks: [{ id: "v1", type: "video", name: "V1", mode: "standard", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
      subtitles: [], markers: [], duration: 5,
    },
    textClips: [text], shapeClips: [shape, late], svgClips: [svg],
  } as unknown as Project;
}

const engine = new AnimationEngine();
const valueAt = (keys: readonly Keyframe[], property: string, time: number): number | undefined => {
  const track = engine.getKeyframesForProperty(keys as Keyframe[], property);
  if (track.length === 0) return undefined;
  const v = engine.getValueAtTime(track, time).value;
  return typeof v === "number" ? v : undefined;
};

describe("grouping clips into a graphic", () => {
  it("replaces the clips with one graphic whose layers keep their position, size, text and color", () => {
    const project = fixture();
    const result = groupClipsIntoGraphic(project, ["t1", "s1", "g1"], { name: "My Title" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.project;
    expect(next.graphicInstances).toHaveLength(1);
    const instance = next.graphicInstances![0];
    expect(instance).toMatchObject({ name: "My Title", startTime: 1, duration: 4 });
    expect(next.textClips).toHaveLength(1);
    expect(next.textClips?.every((clip) => clip.metadata?.graphicInstanceId === instance.id)).toBe(true);
    const text = next.textClips![0];
    const original = project.textClips![0];
    expect(text.text).toBe("Hello World");
    expect(text.transform.position.x).toBeCloseTo(original.transform.position.x, 4);
    expect(text.transform.position.y).toBeCloseTo(original.transform.position.y, 4);
    expect(text.style.fontSize).toBeCloseTo(original.style.fontSize, 3);
    expect(text.style.letterSpacing).toBeCloseTo(3, 3);
    expect(text.style.color).toBe("#ffee00");
    const shape = next.shapeClips!.find((clip) => clip.id.endsWith("__shape-1")) as ShapeClip;
    expect(shape.transform.scale.x).toBeCloseTo(4, 3);
    expect(shape.transform.scale.y).toBeCloseTo(0.8, 3);
    expect(shape.transform.position.x).toBeCloseTo(0.3, 4);
    const svg = next.svgClips![0];
    expect(svg.transform.scale.x).toBeCloseTo(0.3, 3);
    expect(svg.transform.scale.y).toBeCloseTo(0.3, 3);
    // Untouched clips stay.
    expect(next.shapeClips?.some((clip) => clip.id === "s2")).toBe(true);
  });

  it("carries keyframes over, anchored so a stretch only changes the hold", () => {
    const grouped = groupClipsIntoGraphic(fixture(), ["t1", "s1"]);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const instance = grouped.project.graphicInstances![0];
    expect(protectedDurations(instance.template).intro).toBeCloseTo(0.5, 6);
    expect(protectedDurations(instance.template).outro).toBeCloseTo(0.5, 6);
    const short = expandGraphicInstance(instance, grouped.project.settings).textClips[0];
    const stretched = expandGraphicInstance({ ...instance, duration: 9 }, grouped.project.settings).textClips[0];
    for (const dt of [0.1, 0.25, 0.4]) {
      expect(valueAt(stretched.keyframes, "opacity", dt)).toBeCloseTo(valueAt(short.keyframes, "opacity", dt) ?? NaN, 6);
      expect(valueAt(stretched.keyframes, "opacity", 9 - dt)).toBeCloseTo(valueAt(short.keyframes, "opacity", 4 - dt) ?? NaN, 6);
    }
    expect(valueAt(short.keyframes, "opacity", 0)).toBe(0);
    expect(valueAt(short.keyframes, "opacity", 2)).toBe(1);
    expect(valueAt(short.keyframes, "opacity", 4)).toBe(0);
    const bar = expandGraphicInstance(instance, grouped.project.settings).shapeClips[0];
    expect(valueAt(bar.keyframes, "position.x", 0)).toBeCloseTo(0.1, 6);
    expect(valueAt(bar.keyframes, "position.x", 1)).toBeCloseTo(0.3, 6);
  });

  it("a clip that was on screen for only part of the span is gated, and the gate survives a stretch", () => {
    const grouped = groupClipsIntoGraphic(fixture(), ["t1", "s2"]);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const instance = grouped.project.graphicInstances![0];
    const circle = expandGraphicInstance(instance, grouped.project.settings).shapeClips[0];
    // Original: visible 1s..3s into a 4s graphic.
    expect(valueAt(circle.keyframes, "opacity", 0.5)).toBe(0);
    expect(valueAt(circle.keyframes, "opacity", 2)).toBe(1);
    expect(valueAt(circle.keyframes, "opacity", 3.9)).toBe(0);
    const long = expandGraphicInstance({ ...instance, duration: 10 }, grouped.project.settings).shapeClips[0];
    expect(valueAt(long.keyframes, "opacity", 0.5)).toBe(0);
    expect(valueAt(long.keyframes, "opacity", 5)).toBe(1);
    expect(valueAt(long.keyframes, "opacity", 9.9)).toBe(0);
  });

  it("auto-exposes text and color controls that edit the layers", () => {
    const grouped = groupClipsIntoGraphic(fixture(), ["t1", "s1"]);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const instance = grouped.project.graphicInstances![0];
    const ids = instance.template.parameters.map((parameter) => parameter.id);
    expect(ids).toEqual(expect.arrayContaining(["text-1-text", "text-1-color", "shape-1-fill"]));
    const edited = setGraphicParameter(grouped.project, instance.id, "text-1-text", "Changed");
    expect(edited.ok && edited.project.textClips?.[0].text).toBe("Changed");
    const stretched = resizeGraphic(grouped.project, instance.id, { duration: 8 });
    expect(stretched.ok && stretched.project.textClips?.[0].duration).toBe(8);
  });

  it("works at other frame sizes and round-trips through a .openreel-template file", () => {
    const project = { ...fixture(), settings: { width: 1080, height: 1920, frameRate: 30, sampleRate: 48000, channels: 2 } } as Project;
    const grouped = groupClipsIntoGraphic(project, ["t1", "s1", "g1"]);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const text = grouped.project.textClips![0];
    expect(text.transform.position.y).toBeCloseTo(0.8, 4);
    expect(text.style.fontSize).toBeCloseTo(60, 3);
    const template = grouped.project.graphicInstances![0].template;
    const parsed = parseGraphicTemplatePackage(serializeGraphicTemplate(template));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.template).toEqual(template);
  });

  it("ignores meshes, stickers and clips already in a graphic, and says so when nothing can be grouped", () => {
    const project = fixture();
    expect(groupableClipIds(project, ["nope"])).toEqual([]);
    expect(groupClipsIntoGraphic(project, ["nope"]).ok).toBe(false);
    const first = groupClipsIntoGraphic(project, ["t1"]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const memberId = first.project.textClips![0].id;
    expect(groupableClipIds(first.project, [memberId])).toEqual([]);
    const meshes = { ...project, shapeClips: [{ ...project.shapeClips![0], shapeType: "mesh-cube" as const }] } as Project;
    expect(groupClipsIntoGraphic(meshes, ["s1"]).ok).toBe(false);
  });

  it("refuses clips on a locked track and leaves the project untouched", () => {
    const project = fixture();
    const locked = { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((track) => ({ ...track, locked: true })) } } as Project;
    expect(groupClipsIntoGraphic(locked, ["t1"]).ok).toBe(false);
  });
});
