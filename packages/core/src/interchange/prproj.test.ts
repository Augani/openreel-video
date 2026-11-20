import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { editSnapshot } from "../actions/handlers/edit-snapshot";
import type { MediaItem, Project } from "../types/project";
import { buildProject } from "./__fixtures__/project";
import { applyTimelineImport, importTimelineFile } from "./index";
import { resolveFrameRate } from "./timecode";
import {
  TICKS_PER_SECOND,
  frameRateFromTicksPerFrame,
  gunzip,
  importPrproj,
  listPrprojSequences,
  looksLikePrproj,
  parsePrprojXml,
  parseTicks,
  prprojToSequence,
  readPrproj,
  resolveRef,
  ticksToFrames,
  ticksToSeconds,
} from "./prproj";

const fixtureDir = fileURLToPath(new URL("./__fixtures__/", import.meta.url));
const xml = readFileSync(`${fixtureDir}main-cut.prproj.xml`, "utf8");
const gz = new Uint8Array(readFileSync(`${fixtureDir}main-cut.prproj`));

let counter = 0;
const makeId = () => `t${++counter}`;
const opts = (items: readonly MediaItem[] = []) => ({ mediaItems: items, makeId });
const sec = (s: number) => BigInt(Math.round(s * Number(TICKS_PER_SECOND)));

describe("tick math", () => {
  it("uses Premiere's 254016000000 ticks per second", () => {
    expect(TICKS_PER_SECOND).toBe(254_016_000_000n);
    expect(ticksToSeconds(254_016_000_000n)).toBe(1);
    expect(ticksToSeconds(127_008_000_000n)).toBe(0.5);
  });

  it("converts ticks to frames at the exact rational rate", () => {
    const r25 = resolveFrameRate(25);
    const r2997 = resolveFrameRate(29.97);
    const r24 = resolveFrameRate(24);
    expect(ticksToFrames(10_160_640_000n, r25)).toBe(1);
    expect(ticksToFrames(sec(10), r25)).toBe(250);
    // 29.97: one frame is 8475667200 ticks
    expect(ticksToFrames(8_475_667_200n, r2997)).toBe(1);
    expect(ticksToFrames(8_475_667_200n * 1800n, r2997)).toBe(1800);
    expect(ticksToFrames(10_584_000_000n * 24n, r24)).toBe(24);
    // rounds to the nearest frame, half up
    expect(ticksToFrames(10_160_640_000n / 2n - 1n, r25)).toBe(0);
    expect(ticksToFrames(10_160_640_000n / 2n, r25)).toBe(1);
    expect(ticksToFrames(-10_160_640_000n, r25)).toBe(-1);
  });

  it("does not lose frames past 2^53 ticks (a 10 hour sequence)", () => {
    const tenHours = 36_000n * TICKS_PER_SECOND; // 9.14e15 ticks
    expect(Number(tenHours) > Number.MAX_SAFE_INTEGER).toBe(true);
    expect(ticksToFrames(tenHours + 10_160_640_000n, resolveFrameRate(25))).toBe(900_001);
  });

  it("derives the frame rate from ticks per frame", () => {
    expect(frameRateFromTicksPerFrame(10_160_640_000n)).toMatchObject({ num: 25, den: 1 });
    expect(frameRateFromTicksPerFrame(8_475_667_200n)).toMatchObject({ num: 30000, den: 1001 });
    expect(frameRateFromTicksPerFrame(10_594_584_000n)).toMatchObject({ num: 24000, den: 1001 });
    expect(frameRateFromTicksPerFrame(0n)).toBeUndefined();
  });

  it("parses tick text strictly", () => {
    expect(parseTicks("254016000000")).toBe(254_016_000_000n);
    expect(parseTicks(" -91445760000000000 ")).toBe(-91_445_760_000_000_000n);
    expect(parseTicks("9223372036854775807")).toBe(9_223_372_036_854_775_807n);
    expect(parseTicks("12.5")).toBeUndefined();
    expect(parseTicks("")).toBeUndefined();
    expect(parseTicks(undefined)).toBeUndefined();
  });
});

describe("gzip container", () => {
  it("detects a .prproj by gzip magic or by PremiereData", () => {
    expect(looksLikePrproj(gz)).toBe(true);
    expect(looksLikePrproj(new TextEncoder().encode(xml))).toBe(true);
    expect(looksLikePrproj(new TextEncoder().encode("<xmeml version='5'></xmeml>"))).toBe(false);
  });

  it("reads gzip through DecompressionStream and through the dependency-free fallback", async () => {
    const viaStream = await gunzip(gz);
    expect(new TextDecoder().decode(viaStream)).toBe(xml);
    const g = globalThis as { DecompressionStream?: unknown };
    const saved = g.DecompressionStream;
    g.DecompressionStream = undefined;
    try {
      expect(new TextDecoder().decode(await gunzip(gz))).toBe(xml);
      // a stream with a file name in the header (gzip FNAME), like `gzip file.prproj` writes
      const named = new Uint8Array(gzipSync(Buffer.from(xml)));
      expect(new TextDecoder().decode(await gunzip(named))).toBe(xml);
    } finally {
      g.DecompressionStream = saved;
    }
  });

  it("rejects corrupt gzip and non-Premiere XML", async () => {
    const bad = new Uint8Array(gz);
    bad.fill(7, 40, 80);
    await expect(readPrproj(bad)).rejects.toThrow();
    await expect(readPrproj(new TextEncoder().encode("<xmeml/>"))).rejects.toThrow(/Premiere/);
  });
});

describe("object graph", () => {
  const doc = parsePrprojXml(xml);

  it("indexes ObjectID and ObjectUID objects and resolves both reference kinds", () => {
    expect(doc.version).toBe("3");
    const byId = resolveRef(doc, { name: "X", attrs: { ObjectRef: "102" }, children: [], text: "" });
    expect(byId?.attrs.ObjectID).toBe("102");
    const byUid = resolveRef(doc, { name: "X", attrs: { ObjectURef: "aaaaaaaa-0000-4000-8000-000000000001" }, children: [], text: "" });
    expect(byUid?.name).toBe("Media");
    expect(resolveRef(doc, { name: "X", attrs: { ObjectRef: "999999" }, children: [], text: "" })).toBeUndefined();
  });

  it("lists sequences with size, rate, track counts and nesting", () => {
    const list = listPrprojSequences(doc);
    expect(list.map((s) => s.name).sort()).toEqual(["Alt Cut", "Lower Third Nest", "Main Cut"]);
    const main = list.find((s) => s.name === "Main Cut")!;
    expect(main).toMatchObject({ width: 1920, height: 1080, fps: 25, videoTracks: 2, audioTracks: 2, nested: false });
    expect(main.clipCount).toBe(8);
    expect(list.find((s) => s.name === "Lower Third Nest")!.nested).toBe(true);
    expect(list.find((s) => s.name === "Alt Cut")!.fps).toBeCloseTo(29.97, 2);
  });

  it("defaults to the biggest sequence that is not a nest", () => {
    expect(prprojToSequence(doc).sequence.name).toBe("Main Cut");
    expect(prprojToSequence(doc, { sequenceId: listPrprojSequences(doc).find((s) => s.name === "Alt Cut")!.id }).sequence.name).toBe("Alt Cut");
  });

  it("walks Sequence > TrackGroups > Tracks > ClipItems > SubClip > Clip > Source > Media", () => {
    const { sequence } = prprojToSequence(doc);
    const media = Object.fromEntries(sequence.media.map((m) => [m.name, m]));
    expect(Object.keys(media).sort()).toEqual(["broll.mov", "interview.mp4", "overlay.png", "theme song.wav"]);
    expect(media["interview.mp4"]).toMatchObject({ kind: "video", hasAudio: true, hasVideo: true, width: 1920, durationSec: 60 });
    expect(media["interview.mp4"].rate.num).toBe(30000);
    expect(media["broll.mov"]).toMatchObject({ width: 3840, height: 2160, hasAudio: false });
    expect(media["theme song.wav"]).toMatchObject({ kind: "audio", durationSec: 180 });
    expect(media["overlay.png"].kind).toBe("image");
    expect(media["theme song.wav"].pathUrl).toBe("file://localhost/C%3A/Music/theme%20song.wav");
    expect(media["interview.mp4"].binPath).toEqual(["Footage"]);
    expect(media["overlay.png"].binPath).toEqual(["Footage", "Graphics"]);
    expect(media["theme song.wav"].binPath).toEqual(["Audio"]);
  });
});

describe("main cut import", () => {
  const parsed = prprojToSequence(parsePrprojXml(xml));
  const seq = parsed.sequence;
  const video = seq.tracks.filter((t) => t.kind === "video");
  const audio = seq.tracks.filter((t) => t.kind === "audio");

  it("reads sequence name, rate and size", () => {
    expect(seq.name).toBe("Main Cut");
    expect(seq.rate).toMatchObject({ num: 25, den: 1 });
    expect([seq.width, seq.height]).toEqual([1920, 1080]);
  });

  it("places clips from start / end ticks with source in / out", () => {
    const [a, b, c] = video[0].clips;
    expect([a.startFrame, a.endFrame]).toEqual([0, 125]);
    expect([a.inSec, a.outSec]).toEqual([2, 7]);
    expect(a.speed).toBe(1);
    expect([b.startFrame, b.endFrame]).toEqual([125, 225]);
    expect([b.inSec, b.outSec]).toEqual([0, 8]);
    expect([c.startFrame, c.endFrame]).toEqual([225, 275]);
  });

  it("derives speed from source range over timeline range", () => {
    expect(video[0].clips[1].speed).toBe(2);
    expect(video[0].clips[1].reversed).toBe(false);
  });

  it("reads reverse playback from an audio item", () => {
    const reversed = audio.flatMap((t) => t.clips).find((c) => c.reversed);
    expect(reversed).toMatchObject({ startFrame: 200, endFrame: 250, inSec: 20, outSec: 22, speed: 1 });
  });

  it("reads disabled items", () => {
    expect(video[0].clips[2].disabled).toBe(true);
    expect(video[0].clips[0].disabled).toBeUndefined();
  });

  it("reads basic motion, opacity and volume", () => {
    const b = video[0].clips[1];
    // position 0.75:0.25 of 1920x1080 -> +480 / -270 px from centre; scale 50%
    expect(b.motion).toMatchObject({ x: 480, y: -270, scale: 0.5 });
    expect(video[0].clips[0].motion).toBeUndefined();
    const overlay = video[1].clips[0];
    expect(overlay.opacity).toBe(0.5);
    const music = audio.flatMap((t) => t.clips).find((c) => c.name === "theme song.wav" && !c.reversed)!;
    expect(music.volume).toBe(0.5);
  });

  it("targets tracks from the track flag", () => {
    // A1 held only the merged linked audio and is gone; the music track (now A1) is the targeted one.
    expect(audio).toHaveLength(1);
    expect(audio[0].targeted).toBe(true);
    expect(video[0].targeted).toBeUndefined();
  });

  it("merges the linked audio item of a video clip into it", () => {
    const interview = video[0].clips[0];
    expect(interview.withAudio).toBe(true);
    expect(audio.flatMap((t) => t.clips).some((c) => c.name === "interview.mp4")).toBe(false);
    expect(parsed.report.notes.join(" ")).toMatch(/1 audio clips linked/);
  });

  it("reads a cross dissolve with its alignment", () => {
    expect(video[0].transitions).toEqual([{ kind: "dissolve", startFrame: 112 + 1, endFrame: 138, alignment: "center" }]);
  });

  it("reads sequence markers, including range markers and chapter kind", () => {
    expect(seq.markers).toEqual([
      { frame: 25, name: "Intro", comment: "start here" },
      { frame: 150, name: "Chapter 2", durationFrames: 50, kind: "chapter" },
    ]);
  });

  it("builds a nested sequence from a sequence source", () => {
    const nest = video[1].clips[1];
    expect(nest.nested?.name).toBe("Lower Third Nest");
    expect(nest.mediaKey).toBe("");
    expect(nest.nested!.tracks[0].clips[0]).toMatchObject({ name: "broll.mov", inSec: 1, outSec: 4 });
    expect(seq.media.map((m) => m.name)).not.toContain("Lower Third Nest");
  });
});

describe("import report", () => {
  const { report } = prprojToSequence(parsePrprojXml(xml));
  const byFeature = (f: string) => report.items.filter((i) => i.feature === f);

  it("reports effects other than motion, opacity and volume as dropped", () => {
    const blur = byFeature("Effect: Gaussian Blur");
    expect(blur).toHaveLength(1);
    expect(blur[0]).toMatchObject({ severity: "dropped", clipName: "overlay.png" });
  });

  it("reports disabled clips and the motion approximation", () => {
    expect(byFeature("Disabled clip")).toHaveLength(1);
    expect(byFeature("Motion")[0].severity).toBe("approximated");
  });

  it("counts dropped and approximated items and lists what is never read", () => {
    expect(report.dropped).toBe(report.items.filter((i) => i.severity === "dropped").length);
    expect(report.approximated).toBe(report.items.filter((i) => i.severity === "approximated").length);
    expect(report.dropped).toBeGreaterThan(0);
    expect(report.notes.join(" ")).toMatch(/Lumetri/);
    expect(report.notes.join(" ")).toMatch(/Alt Cut/);
  });

  it("reports unsupported transitions, animated values and unplaceable items instead of losing them silently", () => {
    const changed = xml
      .replace("<TransitionName>Cross Dissolve</TransitionName>", "<TransitionName>Cross Zoom</TransitionName>")
      .replace(/AE\.ADBE Cross Dissolve/g, "AE.ADBE Cross Zoom")
      .replace(/<DisplayName>Cross Dissolve<\/DisplayName>/, "<DisplayName>Cross Zoom</DisplayName>")
      .replace(/(<Name>Opacity<\/Name>\s*<CurrentValue>50<\/CurrentValue>)/, "$1<IsTimeVarying>true</IsTimeVarying>");
    const r = prprojToSequence(parsePrprojXml(changed));
    expect(r.report.items.some((i) => i.feature === "Transition: Cross Zoom" && i.severity === "dropped")).toBe(true);
    expect(r.sequence.tracks.find((t) => t.kind === "video")!.transitions).toHaveLength(0);
    expect(r.report.items.some((i) => i.feature === "Animated opacity")).toBe(true);
  });

  it("reports a clip with no media", () => {
    const changed = xml.replace(/<Media ObjectURef="aaaaaaaa-0000-4000-8000-000000000004"\/>/, "");
    const r = prprojToSequence(parsePrprojXml(changed));
    expect(r.report.items.some((i) => i.feature === "Clip without media" && i.clipName === "overlay.png")).toBe(true);
  });

  it("reports media with no file path and makes it a placeholder", async () => {
    const changed = xml.replace(/<FilePath>\/Volumes\/Shoot\/Graphics\/overlay\.png<\/FilePath>\s*<ActualMediaFilePath>[^<]*<\/ActualMediaFilePath>/, "");
    const r = prprojToSequence(parsePrprojXml(changed));
    expect(r.report.items.some((i) => i.feature === "Media without a file path")).toBe(true);
  });
});

describe("relink and import into a project", () => {
  it("makes offline placeholders for media that is not in the bin", async () => {
    const result = await importPrproj(gz, opts());
    expect(result.format).toBe("prproj");
    expect(result.unmatched.map((u) => u.name).sort()).toEqual(["broll.mov", "interview.mp4", "overlay.png", "theme song.wav"]);
    expect(result.newMedia.every((m) => m.isPlaceholder)).toBe(true);
    expect(result.sequenceName).toBe("Main Cut");
    expect(result.settings).toEqual({ width: 1920, height: 1080, frameRate: 25 });
    expect(result.prproj.sequences).toHaveLength(3);
    expect(result.importReport?.dropped).toBeGreaterThan(0);
    expect(result.importReport?.items.some((i) => i.feature === "Effect: Gaussian Blur")).toBe(true);
  });

  it("relinks media that is already in the bin by file name", async () => {
    const existing = buildProject(25).mediaLibrary.items.find((m) => m.id === "m-interview")!;
    const result = await importPrproj(gz, opts([existing]));
    expect(result.matched.map((m) => m.name)).toContain("interview.mp4");
    expect(result.newMedia.map((m) => m.name)).not.toContain("interview.mp4");
  });

  it("creates the bins of the master clips on the placeholders", async () => {
    const result = await importPrproj(gz, opts());
    const names = Object.fromEntries((result.newBins ?? []).map((b) => [b.id, b]));
    const interview = result.newMedia.find((m) => m.name === "interview.mp4")!;
    const overlay = result.newMedia.find((m) => m.name === "overlay.png")!;
    expect(names[interview.binId!].name).toBe("Footage");
    expect(names[overlay.binId!]).toMatchObject({ name: "Graphics", parentId: interview.binId });
  });

  it("turns tracks into OpenReel tracks with motion, opacity, volume, speed and disabled state", async () => {
    const result = await importPrproj(gz, opts());
    const clips = result.tracks.flatMap((t) => t.clips);
    const broll = clips.find((c) => c.speed === 2)!;
    expect(broll.transform).toMatchObject({ position: { x: 480, y: -270 }, scale: { x: 0.5, y: 0.5 } });
    const disabled = clips.find((c) => c.metadata?.importedDisabled)!;
    expect(disabled.transform.opacity).toBe(0);
    expect(disabled.volume).toBe(0);
    expect(clips.find((c) => c.reversed)?.speed).toBeUndefined();
    expect(result.targetedTrackIds).toHaveLength(1);
    expect(result.markers.map((m) => m.label)).toEqual(["Intro", "Chapter 2"]);
    expect(result.markers[1]).toMatchObject({ time: 6, duration: 2, kind: "chapter" });
    expect(result.nests).toHaveLength(1);
    const video = result.tracks.filter((t) => t.type === "video");
    expect(video[1].transitions.length + video[0].transitions.length).toBe(1);
  });

  it("is reachable through importTimelineFile (sync path rejects gzip with a clear message)", () => {
    expect(() => importTimelineFile(gz, opts())).toThrow();
  });

  it("commits as ONE undoable action that also adds and removes the bins and nested sequence", async () => {
    const project: Project = {
      id: "p",
      name: "P",
      createdAt: 0,
      modifiedAt: 0,
      settings: { width: 1280, height: 720, frameRate: 25, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [] },
      timeline: { duration: 0, tracks: [], markers: [], subtitles: [] },
    };
    const result = await importPrproj(gz, opts());
    const next = applyTimelineImport(project, result, "replace");
    expect(next.bins?.map((b) => b.name).sort()).toEqual(["Audio", "Footage", "Graphics"]);
    expect(next.mediaLibrary.items).toHaveLength(4);
    const executor = new ActionExecutor();
    const outcome = await executor.execute({ type: "project/applyEditSnapshot", id: "imp", timestamp: 1, params: { snapshot: editSnapshot(next) } }, project);
    expect(outcome.success).toBe(true);
    expect(project.timeline.tracks.length).toBeGreaterThan(0);
    expect(project.bins).toHaveLength(3);
    expect(project.sequences?.length).toBeGreaterThanOrEqual(2);
    await executor.undo(project);
    expect(project.timeline.tracks).toHaveLength(0);
    expect(project.bins).toBeUndefined();
    expect(project.mediaLibrary.items).toHaveLength(0);
    await executor.redo(project);
    expect(project.bins).toHaveLength(3);
  });

  it("reuses bins that already exist instead of duplicating them", async () => {
    const project: Project = {
      id: "p",
      name: "P",
      createdAt: 0,
      modifiedAt: 0,
      settings: { width: 1280, height: 720, frameRate: 25, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [] },
      timeline: { duration: 0, tracks: [], markers: [], subtitles: [] },
      bins: [{ id: "existing", name: "Footage" }],
    };
    const result = await importPrproj(gz, opts());
    const next = applyTimelineImport(project, result, "replace");
    expect(next.bins?.filter((b) => b.name === "Footage")).toHaveLength(1);
    const interview = next.mediaLibrary.items.find((m) => m.name === "interview.mp4")!;
    expect(interview.binId).toBe("existing");
    const overlay = next.mediaLibrary.items.find((m) => m.name === "overlay.png")!;
    expect(next.bins?.find((b) => b.id === overlay.binId)).toMatchObject({ name: "Graphics", parentId: "existing" });
  });
});

describe("robustness", () => {
  it("fails clearly on a project with no sequences", () => {
    const empty = '<?xml version="1.0"?><PremiereData Version="3"><Project ObjectID="1"/></PremiereData>';
    expect(() => prprojToSequence(parsePrprojXml(empty))).toThrow(/no sequences/);
  });

  it("survives a reference loop between nested sequences", () => {
    // Make the nest sequence contain a clip that plays the main sequence.
    const main = parsePrprojXml(xml);
    const list = listPrprojSequences(main);
    const mainId = list.find((s) => s.name === "Main Cut")!.id;
    const looped = xml.replace('<Sequence ObjectURef="ffffffff-0000-4000-8000-000000000003"/>', `<Sequence ObjectURef="${mainId}"/>`);
    const r = prprojToSequence(parsePrprojXml(looped), { sequenceId: mainId });
    expect(r.sequence.tracks.length).toBeGreaterThan(0);
  });

  it("clamps a sentinel out point to the clip length", () => {
    const sentinel = xml.replace(new RegExp(`<OutPoint>${Number(TICKS_PER_SECOND) * 7}</OutPoint>`), "<OutPoint>9223372036854775807</OutPoint>");
    const r = prprojToSequence(parsePrprojXml(sentinel));
    const a = r.sequence.tracks[0].clips[0];
    expect(a.outSec - a.inSec).toBeCloseTo(5, 6);
    expect(a.speed).toBe(1);
  });
});
