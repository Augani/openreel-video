import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../types/timeline";
import type { Project } from "../types/project";
import { buildProject, clipOf, media } from "./__fixtures__/project";
import { layoutOf } from "./__fixtures__/layout";
import {
  detectInterchangeFormat,
  exportTimeline,
  importTimeline,
  parseOtio,
  projectToSequence,
  resolveFrameRate,
  secondsToFrames,
  serializeOtio,
  validateOtio,
} from "./index";

let counter = 0;
const makeId = (): string => `o${++counter}`;

const FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

interface ClipPlan {
  gap: number;
  length: number;
  inFrame: number;
  speed: 0.5 | 1 | 2;
  reversed: boolean;
  opacity: 1 | 0.5 | 0.25;
  volume: 1 | 0.5 | 0.8;
  media: 0 | 1;
  transitionIn: number; // 0 = none; otherwise dissolve frames into this clip (only when gap === 0)
}
interface TrackPlan {
  clips: ClipPlan[];
  hidden: boolean;
  locked: boolean;
  syncLock: boolean | undefined;
}

const clipPlan = fc.record({
  gap: fc.oneof(fc.constant(0), fc.constant(0), fc.integer({ min: 1, max: 30 })),
  length: fc.integer({ min: 2, max: 80 }),
  inFrame: fc.integer({ min: 0, max: 200 }),
  speed: fc.constantFrom(0.5, 1, 2) as fc.Arbitrary<0.5 | 1 | 2>,
  reversed: fc.boolean(),
  opacity: fc.constantFrom(1, 0.5, 0.25) as fc.Arbitrary<1 | 0.5 | 0.25>,
  volume: fc.constantFrom(1, 0.5, 0.8) as fc.Arbitrary<1 | 0.5 | 0.8>,
  media: fc.constantFrom(0, 1) as fc.Arbitrary<0 | 1>,
  transitionIn: fc.oneof(fc.constant(0), fc.constant(0), fc.integer({ min: 2, max: 30 })),
});
const trackPlan = fc.record({
  clips: fc.array(clipPlan, { minLength: 0, maxLength: 6 }),
  hidden: fc.boolean(),
  locked: fc.boolean(),
  syncLock: fc.constantFrom(undefined, true, false),
});
const markerPlan = fc.record({
  frame: fc.integer({ min: 0, max: 400 }),
  label: fc.string({ minLength: 0, maxLength: 12 }),
});
const timelinePlan = fc.record({
  fps: fc.constantFrom(...FPS),
  visual: fc.array(trackPlan, { minLength: 1, maxLength: 3 }),
  audio: fc.array(trackPlan, { minLength: 0, maxLength: 2 }),
  markers: fc.array(markerPlan, { maxLength: 4 }),
});

/** Turn a plan into a Project. Everything is authored in whole frames. */
type Plan = {
  fps: (typeof FPS)[number];
  visual: TrackPlan[];
  audio: TrackPlan[];
  markers: { frame: number; label: string }[];
};
function sample(plan: Plan): Project {
  const { fps } = plan;
  const f = resolveFrameRate(fps);
  const rate = f.num / f.den;
  let id = 0;
  const build = (tp: TrackPlan, trackId: string, type: Track["type"], audio: boolean): Track => {
    const clips: Clip[] = [];
    const transitions: Track["transitions"] = [];
    let cursor = 0;
    for (const c of tp.clips) {
      const start = cursor + c.gap;
      const clip = clipOf(
        {
          id: `c${++id}`,
          mediaId: audio ? "m-music" : c.media === 0 ? "m-interview" : "m-broll",
          start,
          length: c.length,
          inFrame: c.inFrame,
          speed: c.speed,
          reversed: c.reversed,
          opacity: audio ? 1 : c.opacity,
          volume: c.volume,
        },
        trackId,
        rate,
      );
      const prev = clips[clips.length - 1];
      if (!audio && prev && c.gap === 0 && c.transitionIn > 0) {
        transitions.push({ id: `tr${++id}`, clipAId: prev.id, clipBId: clip.id, type: "crossfade", duration: c.transitionIn / rate, params: {} });
      }
      clips.push(clip);
      cursor = start + c.length;
    }
    return {
      id: trackId,
      type,
      name: trackId,
      clips,
      transitions,
      locked: tp.locked,
      hidden: audio ? false : tp.hidden,
      muted: audio ? tp.hidden : false,
      solo: false,
      ...(tp.syncLock === undefined ? {} : { syncLock: tp.syncLock }),
    };
  };
  const base = buildProject(fps);
  return {
    ...base,
    mediaLibrary: base.mediaLibrary,
    timeline: {
      ...base.timeline,
      tracks: [
        ...plan.visual.map((t, i) => build(t, `V${i}`, "video", false)),
        ...plan.audio.map((t, i) => build(t, `A${i}`, "audio", true)),
      ],
      markers: plan.markers.map((m, i) => ({ id: `mk${i}`, time: m.frame / rate, label: m.label, color: "#3b82f6" })),
    },
  };
}

describe("OTIO export / import", () => {
  it("writes a schema-valid OTIO document for the fixture project", () => {
    const text = exportTimeline(buildProject(25), "otio").files[0].content;
    expect(validateOtio(text)).toEqual([]);
    const doc = JSON.parse(text);
    expect(doc.OTIO_SCHEMA).toBe("Timeline.1");
    expect(doc.tracks.OTIO_SCHEMA).toBe("Stack.1");
    const kinds = doc.tracks.children.map((t: { kind: string }) => t.kind);
    expect(kinds).toEqual(["Video", "Video", "Audio", "Audio"]); // V1 Main, V2, "V1 audio" (linked), A1 music
    const main = doc.tracks.children[0];
    const schemas = main.children.map((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA.split(".")[0]);
    expect(schemas.filter((x: string) => x === "Clip")).toHaveLength(4);
    expect(schemas.includes("Transition")).toBe(true);
    const clipB = main.children.find((c: { name: string; effects?: unknown[] }) => c.name === "broll clip.mov" && (c.effects?.length ?? 0) > 0);
    expect(clipB.effects[0]).toMatchObject({ OTIO_SCHEMA: "LinearTimeWarp.1", time_scalar: 2 });
    expect(doc.tracks.markers.map((m: { name: string }) => m.name)).toEqual(["Intro", "Beat & Drop <b>"]);
    // rational time with rate
    expect(clipB.source_range.duration).toEqual({ OTIO_SCHEMA: "RationalTime.1", rate: 25, value: 40 });
    expect(clipB.media_references.DEFAULT_MEDIA.target_url).toContain("broll%20clip.mov");
  });

  it("NTSC rates are written as exact 24000/1001 style floats and read back as NTSC", () => {
    const text = exportTimeline(buildProject(23.976), "otio").files[0].content;
    const rates = new Set<number>();
    JSON.parse(text, (k, v) => {
      if (k === "rate") rates.add(v as number);
      return v;
    });
    expect([...rates]).toContain(24000 / 1001);
    const { sequence } = parseOtio(text);
    expect(sequence.rate).toMatchObject({ timebase: 24, ntsc: true });
  });

  it("round-trips the fixture project (layout, transitions, markers, linked A/V)", () => {
    for (const fps of FPS) {
      const project = buildProject(fps);
      const rate = resolveFrameRate(fps);
      const text = exportTimeline(project, "otio").files[0].content;
      const imported = importTimeline(text, { mediaItems: project.mediaLibrary.items, makeId });
      expect(imported.format).toBe("otio");
      expect(imported.unmatched).toEqual([]);
      expect(imported.matched.map((m) => m.name).sort()).toEqual(["broll clip.mov", "interview.mp4", "music.wav"]);
      const before = layoutOf(project.timeline.tracks, project.timeline.markers, project.mediaLibrary.items, rate);
      const after = layoutOf(imported.tracks, imported.markers, [...project.mediaLibrary.items, ...imported.newMedia], rate);
      expect(after).toEqual(before);
      expect(imported.tracks.map((t) => t.type)).toEqual(["video", "video", "audio"]); // no stray linked-audio tracks
    }
  });

  it("property: export -> import preserves random timelines (clips, gaps, transitions, markers, track flags)", () => {
    fc.assert(
      fc.property(timelinePlan, (plan) => {
        const project = sample(plan as Plan);
        const rate = resolveFrameRate(plan.fps);
        const { sequence } = projectToSequence(project);
        const text = serializeOtio(sequence);
        expect(validateOtio(text)).toEqual([]);

        // 1. neutral-sequence equality
        const parsed = parseOtio(text).sequence;
        const norm = (s: typeof sequence) => ({
          ...s,
          // source points are stored in whole frames of the media's own rate
          tracks: s.tracks.map((t) => ({
            ...t,
            transitions: [...t.transitions].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame),
            clips: t.clips.map((c) => {
              const m = s.media.find((x) => x.key === c.mediaKey)!;
              const q = (sec: number): number => secondsToFrames(sec, m.rate);
              return { ...c, inSec: q(c.inSec), outSec: q(c.outSec) };
            }),
          })),
          markers: [...s.markers].sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name)),
          // media length is stored in whole frames of its own rate
          media: [...s.media]
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((m) => ({ ...m, durationSec: secondsToFrames(m.durationSec, m.rate) })),
        });
        const na = JSON.parse(JSON.stringify(norm(sequence)));
        const nb = JSON.parse(JSON.stringify(norm(parsed)));
        const differing = Object.keys(na).filter((k) => JSON.stringify(na[k]) !== JSON.stringify(nb[k]));
        if (differing.length) throw new Error(differing.map((k) => `${k}: ${JSON.stringify(na[k])} !== ${JSON.stringify(nb[k])}`).join("\n"));

        // 2. project-level layout equality after relinking
        const imported = importTimeline(text, { mediaItems: project.mediaLibrary.items, makeId });
        const before = layoutOf(project.timeline.tracks, project.timeline.markers, project.mediaLibrary.items, rate);
        const after = layoutOf(imported.tracks, imported.markers, [...project.mediaLibrary.items, ...imported.newMedia], rate);
        for (const l of [before, after]) for (const t of l.tracks) t.transitions.sort((a, b) => a.aEnd - b.aEnd);
        before.markers.sort((a, b) => a.frame - b.frame || a.label.localeCompare(b.label));
        after.markers.sort((a, b) => a.frame - b.frame || a.label.localeCompare(b.label));
        expect(after).toEqual(before);
        // track flags
        expect(imported.tracks.map((t) => [t.locked, t.hidden, t.muted, t.syncLock])).toEqual(
          project.timeline.tracks.map((t) => [t.locked, t.hidden, t.muted, t.syncLock === false ? false : undefined]),
        );
      }),
      { numRuns: 120 },
    );
  });

  it("carries sync lock off and track targeting through OTIO and (targeting, locked, enabled) through xmeml", () => {
    const project = buildProject(25);
    const tracks = project.timeline.tracks.map((t) => (t.id === "t-over" ? { ...t, syncLock: false, locked: true } : t));
    const p: Project = { ...project, timeline: { ...project.timeline, tracks } };
    const targeted = ["t-main"];
    for (const format of ["otio", "xmeml"] as const) {
      const text = exportTimeline(p, format, { targetedTrackIds: targeted }).files[0].content;
      const imported = importTimeline(text, { mediaItems: p.mediaLibrary.items, makeId });
      const over = imported.tracks.find((t) => t.name === "V2")!;
      const main = imported.tracks.find((t) => t.name === "V1")!;
      expect(over.locked).toBe(true);
      expect(imported.targetedTrackIds).toEqual([main.id]);
      if (format === "otio") expect(over.syncLock).toBe(false);
    }
    // xmeml writes Premiere's own attribute
    const xml = exportTimeline(p, "xmeml", { targetedTrackIds: targeted }).files[0].content;
    expect(xml).toContain('<track MZ.TrackTargeted="1">');
    expect(xml).toContain("<locked>TRUE</locked>");
    // and the export report says what xmeml cannot hold
    const report = exportTimeline(p, "xmeml", { targetedTrackIds: targeted }).report;
    expect(report.items.filter((i) => i.feature === "Sync lock").map((i) => i.trackName)).toEqual(["V2"]);
    expect(report.items.some((i) => i.feature === "Track targeting")).toBe(false);
    const edl = exportTimeline(p, "edl", { targetedTrackIds: targeted }).report;
    expect(edl.items.some((i) => i.feature === "Track targeting")).toBe(true);
    expect(exportTimeline(p, "otio", { targetedTrackIds: targeted }).report.items.some((i) => i.feature === "Sync lock")).toBe(false);
  });

  it("detects OTIO and rejects other JSON", () => {
    const text = exportTimeline(buildProject(24), "otio").files[0].content;
    expect(detectInterchangeFormat(text)).toBe("otio");
    expect(detectInterchangeFormat('{"hello": 1}')).toBeNull();
    expect(() => parseOtio('{"hello":1}')).toThrow(/not an OpenTimelineIO/);
    expect(() => parseOtio("{nope")).toThrow(/not valid JSON/);
  });

  it("imports a hand-written OTIO from another tool (Clip.1 media_reference, gaps, custom transition, time warp, nested stack)", () => {
    const rt = (value: number, rate = 24) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
    const tr = (start: number, dur: number, rate = 24) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });
    const doc = {
      OTIO_SCHEMA: "Timeline.1",
      name: "From Resolve",
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "tracks",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            name: "Video 1",
            kind: "Video",
            children: [
              {
                OTIO_SCHEMA: "Clip.1",
                name: "shot A",
                source_range: tr(10, 48),
                media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "file:///Volumes/Media/Shot%20A.mov", available_range: tr(0, 240) },
                effects: [],
                markers: [],
                metadata: {},
              },
              { OTIO_SCHEMA: "Transition.1", name: "x", transition_type: "SMPTE_Dissolve", in_offset: rt(6), out_offset: rt(6), metadata: {} },
              {
                OTIO_SCHEMA: "Clip.1",
                name: "shot B",
                source_range: tr(0, 24),
                media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "file:///Volumes/Media/shot_b.mov", available_range: tr(0, 100) },
                effects: [{ OTIO_SCHEMA: "LinearTimeWarp.1", effect_name: "LinearTimeWarp", time_scalar: 2, metadata: {} }, { OTIO_SCHEMA: "Effect.1", effect_name: "Blur", metadata: {} }],
                markers: [],
                metadata: {},
              },
              { OTIO_SCHEMA: "Gap.1", name: "", source_range: tr(0, 12) },
              { OTIO_SCHEMA: "Stack.1", name: "Nested", children: [], source_range: tr(0, 10) },
              { OTIO_SCHEMA: "Transition.1", name: "x", transition_type: "Custom_Transition", in_offset: rt(2), out_offset: rt(2), metadata: {} },
            ],
          },
          {
            OTIO_SCHEMA: "Track.1",
            name: "Audio 1",
            kind: "Audio",
            children: [
              {
                OTIO_SCHEMA: "Clip.1",
                name: "music",
                source_range: tr(0, 72),
                media_reference: { OTIO_SCHEMA: "MissingReference.1", name: "music.wav" },
                effects: [],
                markers: [],
                metadata: {},
              },
            ],
          },
        ],
        markers: [{ OTIO_SCHEMA: "Marker.2", name: "Hit", color: "RED", marked_range: tr(30, 0) }],
      },
    };
    const text = JSON.stringify(doc);
    const bin = [media("m1", "shot_a.mov", "video", 10, 24, true)];
    const imported = importTimeline(text, { mediaItems: bin, makeId });
    expect(imported.settings.frameRate).toBe(24);
    // "Shot A.mov" relinks to the bin's shot_a.mov? No: names differ by a space vs underscore, so it is unmatched.
    expect(imported.unmatched.map((u) => u.name).sort()).toEqual(["Shot A.mov", "music.wav", "shot_b.mov"]);
    const v = imported.tracks[0];
    expect(v.clips.map((c) => [c.startTime * 24, c.duration * 24, c.inPoint * 24])).toEqual([
      [0, 48, 10],
      [48, 24, 0],
    ]);
    expect(v.clips[1].speed).toBe(2);
    expect(v.transitions).toHaveLength(1);
    expect(v.transitions[0].duration * 24).toBe(12);
    expect(imported.markers.map((m) => [m.label, m.time * 24])).toEqual([["Hit", 30]]);
    expect(imported.warnings.some((w) => w.includes('effect "Blur"'))).toBe(true);
    expect(imported.warnings.some((w) => w.includes("Nested"))).toBe(true);
    expect(imported.tracks[1].type).toBe("audio");
  });

  it("relinks by media name against the bin", () => {
    const rt = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: 24, value });
    const r = { OTIO_SCHEMA: "TimeRange.1", start_time: rt(0), duration: rt(24) };
    const text = JSON.stringify({
      OTIO_SCHEMA: "Timeline.1",
      name: "t",
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            kind: "Video",
            children: [{ OTIO_SCHEMA: "Clip.2", name: "c", source_range: r, active_media_reference_key: "DEFAULT_MEDIA", media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: "/other/place/Interview.MP4", available_range: r } } }],
          },
        ],
      },
    });
    const bin = [media("m-interview", "interview.mp4", "video", 600, 24, true)];
    const imported = importTimeline(text, { mediaItems: bin, makeId });
    expect(imported.unmatched).toEqual([]);
    expect(imported.matched).toEqual([{ name: "Interview.MP4", mediaId: "m-interview" }]);
  });

  it("validateOtio flags structural problems", () => {
    const good = JSON.parse(exportTimeline(buildProject(25), "otio").files[0].content);
    const clone = () => JSON.parse(JSON.stringify(good));
    expect(validateOtio("nope")[0]).toMatch(/not valid JSON/);
    expect(validateOtio("{}")).toEqual(["root is not a Timeline"]);
    const a = clone();
    a.tracks.children[0].kind = "Subtitle";
    expect(validateOtio(JSON.stringify(a))).toEqual([expect.stringContaining("kind")]);
    const b = clone();
    delete b.tracks.children[0].children[0].source_range.duration;
    expect(validateOtio(JSON.stringify(b)).length).toBeGreaterThan(0);
    const c = clone();
    c.tracks.children[0].children.unshift({ OTIO_SCHEMA: "Transition.1", in_offset: c.tracks.children[0].children[0].source_range.duration, out_offset: c.tracks.children[0].children[0].source_range.duration, transition_type: "SMPTE_Dissolve" });
    expect(validateOtio(JSON.stringify(c)).some((p) => p.includes("between two"))).toBe(true);
  });
});
