import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import type { TextClip } from "../text/types";
import { DEFAULT_TEXT_STYLE } from "../text/types";
import type { ShapeClip } from "../graphics/types";
import { DEFAULT_SHAPE_STYLE } from "../graphics/types";
import { ensureSequences } from "../timeline/sequences";
import { applySequenceSettings, getBuiltInGraphicTemplate, insertGraphicTemplate, scaleGraphicsToFrame } from "./index";

const transform = { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip: Clip = {
  id: "c1", mediaId: "m1", trackId: "v1", startTime: 0, duration: 20, inPoint: 0, outPoint: 20,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
};
const track: Track = {
  id: "v1", type: "video", name: "V1", mode: "standard", clips: [clip],
  transitions: [], locked: false, hidden: false, muted: false, solo: false,
};
const base = {
  id: "p", name: "P", createdAt: 1, modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: { tracks: [track], subtitles: [], markers: [], duration: 20 },
} as unknown as Project;

const textClip = (id: string, trackId: string): TextClip => ({
  id, trackId, startTime: 0, duration: 5, text: "Hello",
  style: { ...DEFAULT_TEXT_STYLE, fontSize: 120, strokeWidth: 6, letterSpacing: 3, shadowBlur: 12, shadowOffsetX: 6, shadowOffsetY: 9 },
  transform, keyframes: [],
});
const shapeClip = (id: string, trackId: string): ShapeClip => ({
  id, trackId, startTime: 0, duration: 5, type: "shape", shapeType: "rectangle",
  style: { ...DEFAULT_SHAPE_STYLE, stroke: { ...DEFAULT_SHAPE_STYLE.stroke, width: 8 }, cornerRadius: 20 },
  transform: { ...transform, scale: { x: 4, y: 2 } },
  keyframes: [{ id: "k", time: 0, property: "scale.x", value: 4, easing: "linear" }],
});

const withPlain = (): Project => ({ ...base, textClips: [textClip("t", "v1")], shapeClips: [shapeClip("s", "v1")] });

describe("scaleGraphicsToFrame", () => {
  it("scales plain text and shapes to keep proportion to the frame width", () => {
    const next = scaleGraphicsToFrame(withPlain(), { width: 1920, height: 1080 }, { width: 640, height: 360 });
    const text = next.textClips?.[0];
    expect(text?.style.fontSize).toBeCloseTo(40, 4);
    expect(text?.style.strokeWidth).toBeCloseTo(2, 4);
    expect(text?.style.letterSpacing).toBeCloseTo(1, 4);
    expect(text?.style.shadowBlur).toBeCloseTo(4, 4);
    // Same aspect: shape base size follows min(frame), so the transform scale is unchanged
    // and the pixel size shrinks by the frame ratio.
    const shape = next.shapeClips?.[0];
    expect(shape?.transform.scale.x).toBeCloseTo(4, 4);
    const px = (frame: number, scale: number) => scale * frame * 0.15;
    expect(px(360, shape?.transform.scale.x ?? 0)).toBeCloseTo(px(1080, 4) / 3, 3);
    // local lengths shrink with the shape base
    expect(shape?.style.stroke.width).toBeCloseTo(8 / 3, 4);
    expect(shape?.style.cornerRadius).toBeCloseTo(20 / 3, 4);
  });

  it("keeps pixel size proportional to width when the aspect changes (16:9 to 9:16)", () => {
    const from = { width: 1920, height: 1080 };
    const to = { width: 1080, height: 1920 };
    const next = scaleGraphicsToFrame(withPlain(), from, to);
    const shape = next.shapeClips?.[0];
    const k = to.width / from.width;
    const before = 4 * Math.min(from.width, from.height) * 0.15;
    const after = (shape?.transform.scale.x ?? 0) * Math.min(to.width, to.height) * 0.15;
    expect(after).toBeCloseTo(before * k, 3);
    expect(shape?.keyframes[0].value).toBeCloseTo(shape?.transform.scale.x ?? 0, 6);
  });

  it("is a no-op for an unchanged or invalid frame", () => {
    const project = withPlain();
    expect(scaleGraphicsToFrame(project, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(project);
    expect(scaleGraphicsToFrame(project, { width: 1920, height: 1080 }, { width: 0, height: 10 })).toBe(project);
  });

  it("re-expands a graphic template against the new frame and leaves its members consistent", () => {
    const template = getBuiltInGraphicTemplate("builtin-title-hero");
    if (!template) throw new Error("missing template");
    const inserted = insertGraphicTemplate(base, template, { startTime: 0 });
    if (!inserted.ok) throw new Error(inserted.message);
    const sizeOf = (project: Project): number => Math.max(...(project.textClips ?? []).map((item) => item.style.fontSize));
    const big = sizeOf(inserted.project);
    const next = applySequenceSettings(inserted.project, { width: 640, height: 360 });
    expect(next.settings).toMatchObject({ width: 640, height: 360, frameRate: 30 });
    expect(sizeOf(next)).toBeCloseTo(big / 3, 3);
    // Without scaling only the canvas changes.
    const raw = applySequenceSettings(inserted.project, { width: 640, height: 360 }, { scaleGraphics: false });
    expect(sizeOf(raw)).toBe(big);
    expect(next.graphicInstances).toHaveLength(1);
    // Instance members are regenerated, not duplicated.
    expect(next.textClips?.length).toBe(inserted.project.textClips?.length);
  });

  it("only touches the active sequence's clips", () => {
    const sequenced = ensureSequences({ ...withPlain(), textClips: [textClip("t", "v1"), textClip("other", "not-on-this-timeline")] });
    const next = scaleGraphicsToFrame(sequenced, sequenced.settings, { width: 960, height: 540 });
    expect(next.textClips?.find((item) => item.id === "t")?.style.fontSize).toBeCloseTo(60, 4);
    expect(next.textClips?.find((item) => item.id === "other")?.style.fontSize).toBe(120);
  });
});
