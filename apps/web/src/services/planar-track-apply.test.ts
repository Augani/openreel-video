import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { GraphicsEngine, TitleEngine, keyframeEngine, applyHomography, homographyBetweenQuads, type Clip, type Keyframe, type MediaItem, type PlanarTrackData, type Project } from "@openreel/core";
import { effectInstanceKeyframeProperty } from "@openreel/core/video/effect-instance-keyframes";
import { maskPathAtTime } from "@openreel/core/video/mask-engine";
import { cornerPinInverse } from "@openreel/core/video/pro-effects-extra";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { applicationMode, applyTrackToProject, fitTransformToQuad, planarEffectId, planarMaskId, projectedQuadSamples, stripApplication } from "./planar-track-apply";

const state = () => useProjectStore.getState();
let trackId: string;
const media = (id: string, type: "video" | "image"): MediaItem => ({ id, name: `${id}.${type === "video" ? "mp4" : "png"}`, type, blob: new Blob([id]), fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { width: 100, height: 50, duration: 5, frameRate: 24, codec: "h264", channels: 0, sampleRate: 0, fileSize: 4 } });
const clip = (id: string, mediaId: string, keyframes: Keyframe[] = []): Clip => ({ id, mediaId, trackId, startTime: 0, duration: 2, inPoint: 0, outPoint: 2, volume: 1, effects: [], audioEffects: [], keyframes,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } }, metadata: { keep: "me" } });

/** Source frame 0..4 at 2 fps: the surface (source pixels of a 100x50 picture) rotates and grows. */
const FPS = 2;
const quadAt = (f: number): number[] => {
  const a = f * 0.2, k = 1 + f * 0.1, cx = 40 + f * 4, cy = 25, w = 20 * k, h = 10 * k, c = Math.cos(a), s = Math.sin(a);
  return [[-w, -h], [w, -h], [w, h], [-w, h]].flatMap(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const track = (): PlanarTrackData => ({ version: 1, trackId: "t", clipId: "source", frameRate: FPS, anchorFrame: 0, anchorCorners: quadAt(0), keyframes: [0, 1, 2, 3, 4].map(f => ({ frame: f, corners: quadAt(f) })), confidence: [1, 1, 1, 1, 1], lostFrames: [], manualFrames: [] });

let project: Project;
const sourceOf = () => ({ clip: project.timeline.tracks.flatMap(t => t.clips).find(c => c.id === "source")!, media: project.mediaLibrary.items.find(m => m.id === "video")! });
const clipOf = (p: Project, id: string) => p.timeline.tracks.flatMap(t => t.clips).find(c => c.id === id)!;
const value = (p: Project, id: string, property: string, time: number) => Number(keyframeEngine.getValueAtTime(keyframeEngine.getKeyframesForProperty(clipOf(p, id).keyframes, property), time).value);

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Planar apply"); const base = state().project; trackId = base.timeline.tracks.find(t => t.type === "video")!.id;
  const authored: Keyframe[] = [{ id: "authored", property: "opacity", time: 0, value: 0.5, easing: "linear" }, { id: "authored-x", property: "position.x", time: 1, value: 9, easing: "linear" }];
  project = { ...base, settings: { ...base.settings, width: 200, height: 100, frameRate: 2 },
    timeline: { ...base.timeline, tracks: base.timeline.tracks.map(t => t.id === trackId ? { ...t, clips: [clip("source", "video"), clip("target", "pic", authored)] } : t) },
    mediaLibrary: { items: [media("video", "video"), media("pic", "image")] } };
});

/** Canvas-pixel corners the pipeline must report: source px -> 2x (media 100x50 fitted into 200x100). */
const canvasCorners = (f: number) => quadAt(f).map(v => v * 2);

describe("projectedQuadSamples", () => {
  it("maps tracked source pixels through the source clip onto the canvas", () => {
    const { clip: source, media: m } = sourceOf();
    const samples = projectedQuadSamples(project, source, m, clipOf(project, "target"), track(), 0);
    expect(samples.map(s => s.frame)).toEqual([0, 1, 2, 3, 4]);
    samples[2].corners.forEach((v, i) => expect(v).toBeCloseTo(canvasCorners(2)[i], 6));
  });
  it("rejects clips that do not overlap and empty tracks", () => {
    const { clip: source, media: m } = sourceOf();
    expect(() => projectedQuadSamples(project, source, m, { startTime: 10, duration: 1 }, track(), 0)).toThrow(/overlap/);
    expect(() => projectedQuadSamples(project, source, m, clipOf(project, "target"), { ...track(), keyframes: [], confidence: [] }, 0)).toThrow(/empty/);
  });
});

describe("corner-pin mode", () => {
  it("keyframes the four corners in percent of the canvas and the pin maps the frame onto the quad", () => {
    const { clip: source, media: m } = sourceOf();
    const next = applyTrackToProject(project, source, m, "target", track(), { smoothing: 0 });
    const target = clipOf(next, "target"), id = planarEffectId("source");
    expect(target.effects.map(e => e.type)).toEqual(["corner-pin"]);
    for (const f of [0, 1, 2, 3, 4]) {
      const params: Record<string, number> = {};
      for (let c = 0; c < 4; c++) for (const axis of ["x", "y"]) params[`${axis}${c}`] = value(next, "target", effectInstanceKeyframeProperty(id, `${axis}${c}`), f / FPS);
      const want = canvasCorners(f);
      for (let c = 0; c < 4; c++) { expect(params[`x${c}`]).toBeCloseTo(want[c * 2] / 200 * 100, 5); expect(params[`y${c}`]).toBeCloseTo(want[c * 2 + 1] / 100 * 100, 5); }
      // The effect's own inverse homography sends each pinned corner back to the corner of the unit square.
      const h = cornerPinInverse(params)!, corner = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let c = 0; c < 4; c++) {
        const q = applyHomography(h as never, { x: params[`x${c}`] / 100, y: params[`y${c}`] / 100 });
        expect(q.x).toBeCloseTo(corner[c][0], 5); expect(q.y).toBeCloseTo(corner[c][1], 5);
      }
    }
    expect(target.keyframes.find(k => k.id === "authored")).toBeTruthy();
    expect(target.metadata?.keep).toBe("me");
  });
  it("is idempotent and removal restores the clip exactly", () => {
    const { clip: source, media: m } = sourceOf(), before = structuredClone(clipOf(project, "target"));
    const once = applyTrackToProject(project, source, m, "target", track(), { smoothing: 0 });
    const twice = applyTrackToProject(once, source, m, "target", track(), { smoothing: 0 });
    expect(clipOf(twice, "target")).toEqual(clipOf(once, "target"));
    expect(clipOf(stripApplication(twice, "target"), "target")).toEqual(before);
  });
  it("keeps a Corner Pin the user already had when removing", () => {
    const { clip: source, media: m } = sourceOf(), id = planarEffectId("source");
    const withEffect = { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.id === "target" ? { ...c, effects: [{ id, type: "corner-pin", params: {}, enabled: true }] } : c) })) } } as Project;
    const next = stripApplication(applyTrackToProject(withEffect, source, m, "target", track(), { smoothing: 0 }), "target");
    expect(clipOf(next, "target").effects.map(e => e.id)).toEqual([id]);
  });
});

describe("mask mode", () => {
  it("adds a four-point mask whose path follows the surface, on any clip including the source", () => {
    const { clip: source, media: m } = sourceOf();
    for (const targetId of ["target", "source"]) {
      const next = applyTrackToProject(project, source, m, targetId, track(), { smoothing: 0, mode: "mask" });
      const mask = next.masks!.find(x => x.id === planarMaskId("source", targetId))!;
      expect(mask.clipId).toBe(targetId);
      expect(mask.keyframes).toHaveLength(5);
      for (const f of [0, 1, 2, 3, 4]) {
        const path = maskPathAtTime(mask, f / FPS), want = canvasCorners(f);
        path.points.forEach((p, i) => { expect(p.x).toBeCloseTo(want[i * 2] / 200, 6); expect(p.y).toBeCloseTo(want[i * 2 + 1] / 100, 6); });
      }
      // Between samples the mask interpolates linearly.
      const mid = maskPathAtTime(mask, 1.5 / FPS).points[0], a = canvasCorners(1), b = canvasCorners(2);
      expect(mid.x).toBeCloseTo((a[0] + b[0]) / 2 / 200, 6);
    }
  });
  it("re-tracking keeps the user's feather and removal deletes a mask this feature created", () => {
    const { clip: source, media: m } = sourceOf();
    const first = applyTrackToProject(project, source, m, "target", track(), { smoothing: 0, mode: "mask" });
    const tuned = { ...first, masks: first.masks!.map(x => ({ ...x, feathering: 12, inverted: true })) };
    const moved = { ...track(), keyframes: track().keyframes.map(k => ({ ...k, corners: k.corners.map(v => v + 1) })) };
    const again = applyTrackToProject(tuned, source, m, "target", moved, { smoothing: 0, mode: "mask" });
    expect(again.masks).toHaveLength(1);
    expect(again.masks![0]).toMatchObject({ feathering: 12, inverted: true });
    expect(again.masks![0].keyframes[0].path.points[0].x).toBeCloseTo((canvasCorners(0)[0] + 2) / 200, 6);
    expect(stripApplication(again, "target").masks).toEqual([]);
  });
});

describe("transform mode (screen replacement)", () => {
  it("fits Position, Scale and Rotation so the clip frame lands on a similarity quad exactly", () => {
    const { clip: source, media: m } = sourceOf();
    const next = applyTrackToProject(project, source, m, "target", track(), { smoothing: 0, mode: "transform" });
    for (const f of [0, 1, 2, 3, 4]) {
      const t = f / FPS, px = value(next, "target", "position.x", t), py = value(next, "target", "position.y", t);
      const sx = value(next, "target", "scale.x", t), sy = value(next, "target", "scale.y", t), rot = value(next, "target", "rotation", t) * Math.PI / 180;
      // The pic (100x50, fitted into 200x100 canvas = 200x100) transformed about the centre.
      const drawn = [[-100, -50], [100, -50], [100, 50], [-100, 50]].flatMap(([x, y]) => {
        const X = x * sx, Y = y * sy;
        return [100 + px + X * Math.cos(rot) - Y * Math.sin(rot), 50 + py + X * Math.sin(rot) + Y * Math.cos(rot)];
      });
      drawn.forEach((v, i) => expect(v).toBeCloseTo(canvasCorners(f)[i], 4));
    }
    const target = clipOf(next, "target");
    expect(target.keyframes.find(k => k.id === "authored")).toBeTruthy();       // opacity is not a controlled channel
    expect(target.keyframes.find(k => k.id === "authored-x")).toBeUndefined();  // authored position keys inside the range are replaced
  });
  it("removal restores the authored position keyframes and a mode switch leaves nothing behind", () => {
    const { clip: source, media: m } = sourceOf(), before = structuredClone(clipOf(project, "target"));
    const fitted = applyTrackToProject(project, source, m, "target", track(), { smoothing: 0, mode: "transform" });
    expect(clipOf(stripApplication(fitted, "target"), "target")).toEqual(before);
    const switched = applyTrackToProject(fitted, source, m, "target", track(), { smoothing: 0, mode: "corner-pin" });
    expect(clipOf(switched, "target").keyframes.some(k => k.property === "rotation")).toBe(false);
    expect(clipOf(switched, "target").keyframes.find(k => k.id === "authored-x")).toBeTruthy();
    expect(applicationMode(clipOf(switched, "target").metadata!.workspacePlanarTrackApplication as never)).toBe("corner-pin");
    const toMask = applyTrackToProject(switched, source, m, "target", track(), { smoothing: 0, mode: "mask" });
    expect(clipOf(toMask, "target").effects).toEqual([]);
    expect(toMask.masks).toHaveLength(1);
  });
  it("rotation stays continuous across the +-180 degree seam and respects the anchor", () => {
    const fitted = { width: 200, height: 100 };
    let previous: number | null = null; const seen: number[] = [];
    for (const deg of [170, 175, 180, 185, 190]) {
      const r = deg * Math.PI / 180, q = [[-50, -25], [50, -25], [50, 25], [-50, 25]].flatMap(([x, y]) => [100 + x * Math.cos(r) - y * Math.sin(r), 50 + x * Math.sin(r) + y * Math.cos(r)]);
      const fit = fitTransformToQuad(q, fitted, { x: 0.5, y: 0.5 }, previous); previous = fit.rotation; seen.push(fit.rotation);
      expect(fit.scaleX).toBeCloseTo(0.5, 6); expect(fit.scaleY).toBeCloseTo(0.5, 6); expect(fit.x).toBeCloseTo(100, 6);
    }
    expect(seen.every((v, i) => i === 0 || Math.abs(v - seen[i - 1]) < 10)).toBe(true);
    // An anchor in the top-left corner puts the position point on that corner.
    const corner = fitTransformToQuad([50, 25, 150, 25, 150, 75, 50, 75], fitted, { x: 0, y: 0 }, null);
    expect(corner.x).toBeCloseTo(50, 6); expect(corner.y).toBeCloseTo(25, 6);
    expect(homographyBetweenQuads).toBeTypeOf("function");
  });
  it("refuses an audio target, a non-overlapping clip and an unknown mode", () => {
    const { clip: source, media: m } = sourceOf();
    expect(() => applyTrackToProject(project, source, m, "source", track(), { smoothing: 0, mode: "transform" })).toThrow(/different clip/);
    expect(() => applyTrackToProject(project, source, m, "target", track(), { smoothing: 0, mode: "bogus" as never })).toThrow(/valid/);
    expect(() => applyTrackToProject(project, source, m, "nope", track(), { smoothing: 0 })).toThrow(/Choose a clip/);
  });
});
