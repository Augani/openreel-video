import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { ensureSequences, nestClips, syncActiveSequence } from "../timeline/sequences";
import { calculateProjectDuration } from "../timeline/project-duration";
import { multicamTag } from "../multicam/source";
import {
  applyTimelineImport,
  exportTimeline,
  importTimeline,
  makeFrameRate,
  parseOtio,
  parseXmeml,
  projectToSequence,
  serializeOtio,
  serializeXmeml,
  validateOtio,
  validateXmeml,
  type InterchangeFormat,
  type Sequence,
  type SeqClip,
  type SeqMedia,
} from "./index";

/**
 * Round trips: export -> import -> structural equality, for nested sequences (XMEML, OTIO)
 * and multicam cuts (XMEML multiclip), retimes included. "Structural" means everything but ids and
 * the interchange-generated track names.
 */

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m1", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[] = []): Track => ({
  id, type, name: id === "v1" ? "Main" : id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const mediaItem = (id: string, name: string) => ({
  id, name, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  sourceFile: { name, size: 1, lastModified: 1, folder: "/media" },
  metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1, hasAudio: true },
});
const bin = (...items: ReturnType<typeof mediaItem>[]) => ({ items: items as unknown as Project["mediaLibrary"]["items"] });

function baseProject(): Project {
  return {
    id: "p", name: "Show", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: bin(mediaItem("m1", "scene.mp4"), mediaItem("m2", "camB.mp4")),
    timeline: {
      tracks: [
        track("v1", "video", [
          clip("a", "v1", 0, 3),
          clip("b", "v1", 3, 3, { inPoint: 3, outPoint: 6 }),
          clip("c", "v1", 6, 2, { speed: 2, outPoint: 4 }),
        ]),
        track("a1", "audio", [clip("aud", "a1", 0, 3, { inPoint: 1, outPoint: 4, volume: 0.5 })]),
      ],
      subtitles: [], duration: 8, markers: [],
    },
  };
}

/** Parent project whose first two video clips and the audio clip are nested as "Intro". */
function withNest(): { project: Project; nestId: string } {
  const nested = nestClips(ensureSequences(baseProject()), ["a", "b", "aud"], "Intro");
  if (!nested.ok) throw new Error(nested.message);
  return { project: nested.project, nestId: nested.sequenceId as string };
}

const mapClips = (project: Project, fn: (c: Clip) => Clip): Project => ({
  ...project,
  timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map(fn) })) },
});

/**
 * With OTIO_DUMP_DIR set, the OTIO files these tests export are written there, for
 * packages/core/scripts/validate-otio.py (the reference opentimelineio library).
 */
const otioDump: Record<string, string> = {};
const dumpOtio = (name: string, text: string): void => {
  otioDump[name] = text;
};
afterAll(() => {
  const dir = process.env.OTIO_DUMP_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(otioDump)) writeFileSync(join(dir, `${name}.otio`), text);
});

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A sequence reduced to what must survive a round trip. */
function norm(seq: Sequence): unknown {
  const mediaName = (key: string): string => seq.media.find((m) => m.key === key)?.name ?? `?${key}`;
  const clipOf = (c: SeqClip): unknown => ({
    name: c.name,
    start: c.startFrame,
    end: c.endFrame,
    in: r4(c.inSec),
    out: r4(c.outSec),
    speed: r4(c.speed),
    reversed: c.reversed,
    opacity: r4(c.opacity),
    volume: r4(c.volume),
    withAudio: c.withAudio,
    media: c.nested ? null : mediaName(c.mediaKey),
    nested: c.nested ? norm(c.nested) : null,
    multicam: c.multicam
      ? (() => {
          const mc = seq.multicam?.find((m) => m.id === c.multicam?.sourceId);
          return { source: mc?.name, angle: mc?.angles.find((a) => a.id === c.multicam?.angleId)?.name };
        })()
      : null,
  });
  return {
    name: seq.name,
    rate: [seq.rate.timebase, seq.rate.ntsc, seq.rate.dropFrame],
    size: [seq.width, seq.height],
    media: seq.media.map((m) => m.name).sort(),
    multicam: (seq.multicam ?? []).map((mc) => ({
      name: mc.name,
      angles: mc.angles.map((a) => ({ name: a.name, media: a.media.name, offset: r4(a.offsetSec) })),
    })),
    tracks: seq.tracks.map((t) => ({ kind: t.kind, disabled: t.disabled, locked: t.locked, clips: t.clips.map(clipOf) })),
  };
}

const reparse = (format: "xmeml" | "otio", text: string): Sequence => (format === "xmeml" ? parseXmeml(text) : parseOtio(text)).sequence;

function xmllintOk(text: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "nest-roundtrip-")), "t.xml");
  writeFileSync(file, text);
  const r = spawnSync("xmllint", ["--noout", file], { encoding: "utf8" });
  expect(r.error, "xmllint must be installed").toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
}

const find = (seq: Sequence, pick: (c: SeqClip) => boolean): SeqClip | undefined => seq.tracks.flatMap((t) => t.clips).find(pick);

describe.each(["xmeml", "otio"] as const)("%s nested sequence round trip", (format) => {
  const exportOf = (project: Project): string => exportTimeline(project, format).files[0].content;

  it("export -> import gives the same nest structure (nested clips, ranges, audio, retimed neighbours)", () => {
    const { project } = withNest();
    const expected = projectToSequence(project).sequence;
    const text = exportOf(project);
    if (format === "xmeml") {
      expect(validateXmeml(text)).toEqual([]);
      xmllintOk(text);
    } else {
      expect(validateOtio(text)).toEqual([]);
    }
    if (format === "otio") dumpOtio("nest-plain", text);
    const parsed = format === "xmeml" ? parseXmeml(text) : parseOtio(text);
    expect(parsed.report.warnings).toEqual([]);
    expect(norm(parsed.sequence)).toEqual(norm(expected));
    const nest = find(parsed.sequence, (c) => !!c.nested);
    expect(nest?.nested?.tracks.flatMap((t) => t.clips)).toHaveLength(3);
    expect(nest?.withAudio).toBe(true);
  });

  it.each([
    ["2x", { speed: 2, duration: 3, outPoint: 6 }],
    ["0.5x", { speed: 0.5, duration: 6, outPoint: 3 }],
    ["reverse", { reversed: true }],
    ["reverse 2x", { speed: 2, reversed: true, duration: 3, outPoint: 6 }],
  ] as const)("keeps a retimed nest (%s)", (label, change) => {
    const { project, nestId } = withNest();
    const retimed = mapClips(project, (c) => (c.mediaId === `compound:${nestId}` ? { ...c, ...change } : c));
    const expected = projectToSequence(retimed).sequence;
    const nest = find(expected, (c) => !!c.nested);
    expect(nest && (nest.speed !== 1 || nest.reversed)).toBe(true);
    if (format === "otio") dumpOtio(`nest-retime-${label.replace(/\W+/g, "-")}`, exportOf(retimed));
    const parsed = reparse(format, exportOf(retimed));
    expect(norm(parsed)).toEqual(norm(expected));
    const back = find(parsed, (c) => !!c.nested);
    expect(back?.speed).toBeCloseTo(nest!.speed, 4);
    expect(back?.reversed).toBe(nest!.reversed);
  });

  it("keeps retimed clips inside the nest", () => {
    const { project, nestId } = withNest();
    const inner = mapClips(project, (c) => c);
    // Retime a clip of the nested sequence itself.
    const sequences = (inner.sequences ?? []).map((s) =>
      s.id === nestId
        ? { ...s, timeline: { ...s.timeline, tracks: s.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === "b" ? { ...c, speed: 2, outPoint: 9 } : c)) })) } }
        : s,
    );
    const edited: Project = { ...inner, sequences };
    const expected = projectToSequence(edited).sequence;
    if (format === "otio") dumpOtio("nest-inner-retime", exportOf(edited));
    const parsed = reparse(format, exportOf(edited));
    expect(norm(parsed)).toEqual(norm(expected));
    const nested = find(parsed, (c) => !!c.nested)!.nested!;
    expect(nested.tracks.flatMap((t) => t.clips).some((c) => c.speed === 2)).toBe(true);
  });

  it("shares one definition between instances of the same nest", () => {
    const { project, nestId } = withNest();
    const parentTrack = project.timeline.tracks.find((t) => t.clips.some((c) => c.mediaId === `compound:${nestId}`))!;
    const first = parentTrack.clips.find((c) => c.mediaId === `compound:${nestId}`)!;
    const doubled: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((t) =>
          t.id === parentTrack.id ? { ...t, clips: [...t.clips, { ...first, id: "nest-2", startTime: 20, trackId: t.id }] } : t,
        ),
      },
    };
    const text = exportOf(doubled);
    if (format === "xmeml") {
      expect(validateXmeml(text)).toEqual([]);
      // one full <sequence> for the nest (plus the root), the other instances reference it by id
      expect(text.match(/<sequence id="sequence-2">\s*<name>/g)?.length).toBe(1);
      expect(text).toMatch(/<sequence id="sequence-2"\/>/);
    }
    const parsed = reparse(format, text);
    const nests = parsed.tracks.flatMap((t) => t.clips).filter((c) => c.nested);
    expect(nests).toHaveLength(2);
    expect(nests[0].nested).toBe(nests[1].nested);
    expect(norm(parsed)).toEqual(norm(projectToSequence(doubled).sequence));

    // Committed into a project: ONE nested sequence, two instances of it.
    const result = importTimeline(text, { mediaItems: project.mediaLibrary.items });
    expect(result.nests).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("commits as a real, editable nested sequence and exports again to the same structure", () => {
    const { project } = withNest();
    const text = exportOf(project);
    const result = importTimeline(text, { mediaItems: project.mediaLibrary.items });
    expect(result.nests).toHaveLength(1);
    expect(result.nests?.[0].name).toBe("Intro");
    const target: Project = { ...baseProject(), timeline: { tracks: [], subtitles: [], markers: [], duration: 0 } };
    const applied = applyTimelineImport(target, result, "replace");
    const nestSequence = applied.sequences?.find((s) => s.name === "Intro");
    expect(nestSequence).toBeDefined();
    const live = syncActiveSequence(applied);
    const liveNest = live.timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaId.startsWith("compound:"));
    expect(liveNest?.mediaId).toBe(`compound:${nestSequence?.id}`);
    expect(applied.nestedInstances?.map((i) => i.id)).toContain(liveNest?.id);
    expect(calculateProjectDuration(applied)).toBeCloseTo(8, 1);
    // Round trip through the project: same structure on the next export.
    const again = reparse(format, exportTimeline(applied, format).files[0].content);
    expect(norm(again)).toEqual(norm(projectToSequence(project).sequence));
  });
});

describe("nested sequence at another frame rate (hand-built, both formats)", () => {
  const rate24 = makeFrameRate(24, false);
  const rate30 = makeFrameRate(30, false);
  const media = (key: string, name: string): SeqMedia => ({
    key, name, pathUrl: `file://localhost/media/${name}`, kind: "video", durationSec: 20, rate: rate30,
    width: 1920, height: 1080, hasVideo: true, hasAudio: true, sampleRate: 48000, channels: 2,
  });
  const seqClip = (id: string, mediaKey: string, startFrame: number, endFrame: number, extra: Partial<SeqClip> = {}): SeqClip => ({
    id, name: mediaKey, mediaKey, startFrame, endFrame, inSec: 0, outSec: (endFrame - startFrame) / 24, speed: 1, reversed: false,
    opacity: 1, volume: 1, withAudio: false, ...extra,
  });
  const inner: Sequence = {
    id: "inner", name: "Inner 24", rate: rate24, width: 1280, height: 720, durationFrames: 72,
    tracks: [{ kind: "video", name: "V1", clips: [seqClip("i1", "mA", 0, 48, { inSec: 0.5, outSec: 2.5 }), seqClip("i2", "mB", 48, 72, { inSec: 1, outSec: 2 })], transitions: [], disabled: false, locked: false }],
    markers: [{ frame: 24, name: "Beat" }],
    media: [media("mA", "A.mov"), media("mB", "B.mov")],
  };
  const parent: Sequence = {
    name: "Parent 30", rate: rate30, width: 1920, height: 1080, durationFrames: 210,
    tracks: [{
      kind: "video", name: "V1", transitions: [], disabled: false, locked: false,
      clips: [
        seqClip("n1", "", 30, 120, { name: "Inner 24", inSec: 0, outSec: 3, nested: inner }),
        seqClip("n2", "", 120, 210, { name: "Inner 24", inSec: 0, outSec: 3, nested: inner, speed: 1 }),
      ],
    }],
    markers: [],
    media: [],
  };

  it.each(["xmeml", "otio"] as const)("%s keeps the nested rate, size, markers and ranges", (format) => {
    const text = format === "xmeml" ? serializeXmeml(parent) : serializeOtio(parent);
    if (format === "otio") dumpOtio("nest-cross-rate", text);
    const back = reparse(format, text);
    expect(norm(back)).toEqual(norm(parent));
    const nested = find(back, (c) => !!c.nested)!.nested!;
    expect(nested.rate.timebase).toBe(24);
    expect(nested.width).toBe(1280);
    expect(nested.markers.map((m) => m.frame)).toEqual(format === "otio" ? [24] : [24]);
  });

  it("imports into a project at the parent's rate with the nested sequence at its own", () => {
    const result = importTimeline(serializeOtio(parent), { mediaItems: [] });
    expect(result.settings.frameRate).toBe(30);
    expect(result.nests?.[0].settings).toMatchObject({ width: 1280, height: 720, frameRate: 24 });
    expect(result.nests).toHaveLength(1);
  });
});

describe("foreign and defective nested sequences", () => {
  it("imports a hand-written OTIO Stack with no source_range and no OpenReel metadata", () => {
    const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", value, rate });
    const tr = (start: number, dur: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });
    const clipJson = {
      OTIO_SCHEMA: "Clip.2", name: "inner clip", source_range: tr(10, 48, 24), effects: [], markers: [], enabled: true, metadata: {},
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", target_url: "file:///media/x.mov", available_range: tr(0, 480, 24), metadata: {} } },
      active_media_reference_key: "DEFAULT_MEDIA",
    };
    const innerTrack = { OTIO_SCHEMA: "Track.1", name: "V1", kind: "Video", children: [clipJson], effects: [], markers: [], enabled: true, metadata: {} };
    const doc = {
      OTIO_SCHEMA: "Timeline.1", name: "Foreign", metadata: {}, global_start_time: null,
      tracks: {
        OTIO_SCHEMA: "Stack.1", name: "tracks", markers: [], effects: [], metadata: {},
        children: [{
          OTIO_SCHEMA: "Track.1", name: "V1", kind: "Video", effects: [], markers: [], enabled: true, metadata: {},
          children: [
            { OTIO_SCHEMA: "Stack.1", name: "Sub", source_range: null, children: [innerTrack], effects: [], markers: [], enabled: true, metadata: {} },
            // a bare Track as a child is nested too
            { OTIO_SCHEMA: "Track.1", name: "Bare", kind: "Video", children: [clipJson], source_range: tr(0, 24, 24), effects: [], markers: [], enabled: true, metadata: {} },
          ],
        }],
      },
    };
    const parsed = parseOtio(JSON.stringify(doc));
    expect(parsed.report.warnings.filter((w) => w.includes("not imported"))).toEqual([]);
    const [sub, bare] = parsed.sequence.tracks[0].clips;
    expect(sub.nested?.rate.timebase).toBe(24);
    expect(sub.nested?.tracks[0].clips[0].inSec).toBeCloseTo(10 / 24, 6);
    // No source_range: the nest plays the whole nested length (48 frames @24 = 2s).
    expect(sub.endFrame - sub.startFrame).toBe(Math.round((48 / 24) * parsed.sequence.rate.num / parsed.sequence.rate.den));
    expect(bare.nested?.tracks).toHaveLength(1);
    expect(bare.startFrame).toBe(sub.endFrame);
    const result = importTimeline(JSON.stringify(doc), { mediaItems: [] });
    expect(result.nests).toHaveLength(2);
    expect(result.tracks[0].clips.every((c) => c.mediaId.startsWith("compound:"))).toBe(true);
  });

  it("skips an XMEML nest that references a sequence missing from the file, and one that contains itself", () => {
    const { project } = withNest();
    const xml = exportTimeline(project, "xmeml").files[0].content;
    const dangling = xml.replace(/<sequence id="sequence-2">[\s\S]*?<\/sequence>\s*(?=<filter|<link)/, '<sequence id="sequence-99"/>');
    const parsed = parseXmeml(dangling);
    expect(parsed.report.warnings.some((w) => w.includes("not in the file"))).toBe(true);

    const looped = xml.replace(/(<sequence id="sequence-2">[\s\S]*?<track>)/, '$1<clipitem id="loop"><name>Loop</name><duration>10</duration><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><start>0</start><end>10</end><in>0</in><out>10</out><sequence id="sequence-2"/></clipitem>');
    const loopParsed = parseXmeml(looped);
    expect(loopParsed.report.warnings.some((w) => w.includes("contains itself"))).toBe(true);
  });

  it("writes and rereads a nest that sits on an audio track (no dangling sequence reference)", () => {
    const { project, nestId } = withNest();
    const audioOnly = mapClips(project, (c) => c);
    const moved: Project = {
      ...audioOnly,
      timeline: {
        ...audioOnly.timeline,
        tracks: audioOnly.timeline.tracks.map((t) => {
          if (t.type === "video") return { ...t, clips: t.clips.filter((c) => !c.mediaId.startsWith("compound:")) };
          const nest = audioOnly.timeline.tracks.flatMap((x) => x.clips).find((c) => c.mediaId === `compound:${nestId}`)!;
          return { ...t, clips: [...t.clips, { ...nest, trackId: t.id }] };
        }),
      },
    };
    const text = exportTimeline(moved, "xmeml").files[0].content;
    expect(validateXmeml(text)).toEqual([]);
    expect(text).not.toMatch(/<sequence id="sequence-1"\/>/);
    const parsed = parseXmeml(text);
    expect(parsed.report.warnings).toEqual([]);
    expect(norm(parsed.sequence)).toEqual(norm(projectToSequence(moved).sequence));
  });
});

describe("XMEML multiclip (multicam cuts)", () => {
  function multicamProject(): Project {
    const project = baseProject();
    const cut = (id: string, mediaId: string, angleId: string, start: number, inPoint: number, extra: Partial<Clip> = {}): Clip =>
      clip(id, "v1", start, 2, { mediaId, inPoint, outPoint: inPoint + 2, metadata: { multicam: { sourceId: "mc1", angleId } }, ...extra });
    return {
      ...project,
      multicamSources: [{
        id: "mc1", name: "Interview", syncMethod: "audio", audio: { mode: "follow" }, createdAt: 1,
        angles: [
          { id: "angA", name: "Cam A", mediaId: "m1", offset: 0, duration: 20, color: "#ef4444" },
          { id: "angB", name: "Cam B", mediaId: "m2", offset: 1.5, duration: 20, color: "#22c55e" },
        ],
      }],
      timeline: {
        ...project.timeline,
        tracks: [
          track("v1", "video", [
            cut("k1", "m1", "angA", 0, 4),
            cut("k2", "m2", "angB", 2, 2.5),
            cut("k3", "m1", "angA", 4, 1, { duration: 1, outPoint: 3, speed: 2 }),
            cut("k4", "m2", "angB", 5, 6, { reversed: true }),
          ]),
          track("a1", "audio"),
        ],
        duration: 7,
      },
    };
  }

  it("writes a multiclip per multicam cut with every angle and the active one, valid and well-formed", () => {
    const project = multicamProject();
    const out = exportTimeline(project, "xmeml");
    const text = out.files[0].content;
    expect(validateXmeml(text)).toEqual([]);
    xmllintOk(text);
    expect(text.match(/<multiclip id="mc1">/g)?.length).toBe(4);
    expect(text.match(/<angle id="angB">/g)?.length).toBe(4);
    expect(text).toContain("<offsetseconds>1.5</offsetseconds>");
    // The clipitem itself stays a plain clip of the active angle's file.
    expect(text).toMatch(/<clipitem id="clipitem-v1-2">[\s\S]*?<name>camB.mp4<\/name>/);
    // The angles are carried: no "flattened to its active angle" entry, a note instead.
    expect(out.report.items.some((i) => i.feature === "Multicam clip")).toBe(false);
    expect(out.report.notes.join(" ")).toContain("multiclip");
  });

  it("round-trips the multicam structure (angles, offsets, active angle, retimes)", () => {
    const project = multicamProject();
    const expected = projectToSequence(project).sequence;
    const parsed = parseXmeml(exportTimeline(project, "xmeml").files[0].content);
    expect(parsed.report.warnings).toEqual([]);
    expect(norm(parsed.sequence)).toEqual(norm(expected));
    const back = parsed.sequence;
    expect(back.multicam).toHaveLength(1);
    expect(back.multicam?.[0].angles.map((a) => [a.name, a.offsetSec])).toEqual([["Cam A", 0], ["Cam B", 1.5]]);
    const cuts = back.tracks[0].clips;
    expect(cuts.map((c) => back.multicam?.[0].angles.find((a) => a.id === c.multicam?.angleId)?.name)).toEqual(["Cam A", "Cam B", "Cam A", "Cam B"]);
    expect(cuts[2].speed).toBe(2);
    expect(cuts[3].reversed).toBe(true);
  });

  it("keeps a sub-frame sync offset exact", () => {
    const project = multicamProject();
    const odd: Project = {
      ...project,
      multicamSources: project.multicamSources?.map((s) => ({ ...s, angles: s.angles.map((a) => (a.id === "angB" ? { ...a, offset: 1.2345 } : a)) })),
    };
    const parsed = parseXmeml(exportTimeline(odd, "xmeml").files[0].content);
    expect(parsed.sequence.multicam?.[0].angles[1].offsetSec).toBeCloseTo(1.2345, 6);
  });

  it("imports as a real multicam source with tagged cuts, and exports again to the same structure", () => {
    const project = multicamProject();
    const text = exportTimeline(project, "xmeml").files[0].content;
    const result = importTimeline(text, { mediaItems: project.mediaLibrary.items });
    expect(result.unmatched).toEqual([]);
    expect(result.multicamSources).toHaveLength(1);
    const source = result.multicamSources![0];
    expect(source.name).toBe("Interview");
    expect(source.angles.map((a) => [a.name, a.mediaId, a.offset])).toEqual([["Cam A", "m1", 0], ["Cam B", "m2", 1.5]]);
    const clips = result.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips);
    expect(clips.map((c) => multicamTag(c)?.angleId)).toEqual([source.angles[0].id, source.angles[1].id, source.angles[0].id, source.angles[1].id]);
    expect(clips.every((c) => multicamTag(c)?.sourceId === source.id)).toBe(true);

    const target: Project = { ...baseProject(), timeline: { tracks: [], subtitles: [], markers: [], duration: 0 } };
    const applied = applyTimelineImport(target, result, "replace");
    expect(applied.multicamSources).toHaveLength(1);
    const again = parseXmeml(exportTimeline(applied, "xmeml").files[0].content).sequence;
    expect(norm(again)).toEqual(norm(projectToSequence(project).sequence));
  });

  it("imports a multiclip whose media is missing from the bin as placeholders for every angle", () => {
    const project = multicamProject();
    const text = exportTimeline(project, "xmeml").files[0].content;
    const result = importTimeline(text, { mediaItems: [] });
    expect(result.newMedia.map((m) => m.name).sort()).toEqual(["camB.mp4", "scene.mp4"]);
    expect(result.multicamSources?.[0].angles.map((a) => a.mediaId).sort()).toEqual(result.newMedia.map((m) => m.id).sort());
  });

  it("a multiclip with one usable angle falls back to ordinary clips with a warning", () => {
    const text = exportTimeline(multicamProject(), "xmeml").files[0].content;
    const broken = text.replace(/<angle id="angB">[\s\S]*?<\/angle>/g, "");
    const parsed = parseXmeml(broken);
    expect(parsed.report.warnings.some((w) => w.includes("no usable angles"))).toBe(true);
    expect(parsed.sequence.tracks[0].clips.every((c) => !c.multicam)).toBe(true);
  });

  it("carries multicam cuts that sit inside a nested sequence", () => {
    const project = multicamProject();
    const nested = nestClips(ensureSequences(project), ["k1", "k2"], "Cuts");
    if (!nested.ok) throw new Error(nested.message);
    for (const format of ["xmeml"] as const satisfies readonly InterchangeFormat[]) {
      const out = exportTimeline(nested.project, format);
      expect(validateXmeml(out.files[0].content)).toEqual([]);
      const parsed = parseXmeml(out.files[0].content);
      expect(norm(parsed.sequence)).toEqual(norm(projectToSequence(nested.project).sequence));
      const inner = find(parsed.sequence, (c) => !!c.nested)!.nested!;
      expect(inner.multicam).toHaveLength(1);
      const result = importTimeline(out.files[0].content, { mediaItems: project.mediaLibrary.items });
      expect(result.multicamSources).toHaveLength(1);
      expect(result.nests?.[0].tracks.flatMap((t) => t.clips).every((c) => multicamTag(c))).toBe(true);
    }
  });
});
