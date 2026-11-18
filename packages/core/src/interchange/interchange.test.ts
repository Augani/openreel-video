import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProject } from "./__fixtures__/project";
import { layoutOf } from "./__fixtures__/layout";
import {
  exportTimeline,
  importTimeline,
  parseInterchangeSequence,
  planTimelineImport,
  resolveFrameRate,
  type InterchangeFormat,
} from "./index";
import { parseXml } from "./xml";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "__fixtures__", name);

let counter = 0;
const makeId = (): string => `t${++counter}`;

const RATES: { fps: number; drop: boolean }[] = [
  { fps: 23.976, drop: false },
  { fps: 24, drop: false },
  { fps: 25, drop: false },
  { fps: 29.97, drop: false },
  { fps: 29.97, drop: true },
  { fps: 30, drop: false },
  { fps: 50, drop: false },
  { fps: 59.94, drop: false },
  { fps: 59.94, drop: true },
  { fps: 60, drop: false },
];

function roundTrip(fps: number, drop: boolean, format: "xmeml" | "fcpxml") {
  const project = buildProject(fps);
  const rate = resolveFrameRate(fps, { dropFrame: drop });
  const exported = exportTimeline(project, format, { dropFrame: drop });
  const text = exported.files[0].content;
  const imported = importTimeline(text, { mediaItems: project.mediaLibrary.items, makeId });
  const before = layoutOf(project.timeline.tracks, project.timeline.markers, project.mediaLibrary.items, rate);
  const after = layoutOf(
    imported.tracks,
    imported.markers,
    [...project.mediaLibrary.items, ...imported.newMedia],
    rate,
  );
  return { project, text, imported, before, after, rate };
}

describe.each(["xmeml", "fcpxml"] as const)("%s round trip", (format) => {
  it.each(RATES)("export -> import is structurally equal at $fps (drop=$drop)", ({ fps, drop }) => {
    const { before, after, imported } = roundTrip(fps, drop, format);
    expect(after).toEqual(before);
    expect(imported.unmatched).toEqual([]);
    expect(imported.matched.map((m) => m.name).sort()).toEqual(["broll clip.mov", "interview.mp4", "music.wav"]);
    expect(imported.settings.frameRate).toBeCloseTo(resolveFrameRate(fps).num / resolveFrameRate(fps).den, 6);
  });

  it("reports unmatched media and creates relinkable placeholders", () => {
    const project = buildProject(30);
    const text = exportTimeline(project, format).files[0].content;
    const bin = project.mediaLibrary.items.filter((m) => m.name !== "music.wav");
    const imported = importTimeline(text, { mediaItems: bin, makeId });
    expect(imported.unmatched).toEqual([
      expect.objectContaining({ name: "music.wav", clipCount: 1 }),
    ]);
    expect(imported.newMedia).toHaveLength(1);
    expect(imported.newMedia[0]).toMatchObject({ name: "music.wav", isPlaceholder: true, type: "audio" });
    expect(imported.newMedia[0].sourceFile?.name).toBe("music.wav");
  });

  it("relinks by filename case-insensitively and by unique stem", () => {
    const project = buildProject(30);
    const text = exportTimeline(project, format).files[0].content;
    const bin = project.mediaLibrary.items.map((m) =>
      m.name === "interview.mp4"
        ? { ...m, name: "INTERVIEW.MP4", sourceFile: undefined }
        : m.name === "music.wav"
          ? { ...m, name: "music.mp3", sourceFile: undefined }
          : m,
    );
    const imported = importTimeline(text, { mediaItems: bin, makeId });
    expect(imported.unmatched.map((u) => u.name)).toEqual([]);
  });
});

describe("planTimelineImport", () => {
  it("replace swaps media tracks and keeps text tracks; append keeps everything", () => {
    const project = buildProject(30);
    const text = exportTimeline(project, "xmeml").files[0].content;
    const textTrack = { id: "t-text", type: "text" as const, name: "Titles", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false };
    const host = { ...project, timeline: { ...project.timeline, tracks: [...project.timeline.tracks, textTrack] } };
    const imported = importTimeline(text, { mediaItems: host.mediaLibrary.items, makeId });
    const replaced = planTimelineImport(host, imported, "replace");
    expect(replaced.timeline.tracks.map((t) => t.type)).toEqual(["video", "video", "text", "audio"]);
    expect(replaced.timeline.tracks.some((t) => host.timeline.tracks.includes(t) && t.type !== "text")).toBe(false);
    const appended = planTimelineImport(host, imported, "append");
    expect(appended.timeline.tracks).toHaveLength(host.timeline.tracks.length + imported.tracks.length);
    expect(appended.timeline.markers).toHaveLength(4);
    expect(replaced.timeline.duration).toBeCloseTo(174 / 30, 6);
  });

  it("replace keeps locked media tracks untouched", () => {
    const project = buildProject(30);
    const text = exportTimeline(project, "xmeml").files[0].content;
    const [first, ...rest] = project.timeline.tracks;
    const locked = { ...first, locked: true };
    const host = { ...project, timeline: { ...project.timeline, tracks: [locked, ...rest] } };
    const imported = importTimeline(text, { mediaItems: host.mediaLibrary.items, makeId });
    const replaced = planTimelineImport(host, imported, "replace");
    expect(replaced.timeline.tracks.filter((t) => t === locked)).toHaveLength(1);
    expect(replaced.timeline.tracks).toHaveLength(imported.tracks.length + 1);
  });
});

describe("golden fixtures", () => {
  const project = buildProject(29.97);
  const goldens: [InterchangeFormat, string][] = [
    ["xmeml", "golden-2997.xmeml.xml"],
    ["fcpxml", "golden-2997.fcpxml"],
    ["edl", "golden-2997-V1.edl"],
  ];
  it.each(goldens)("%s output matches the checked-in golden file", (format, file) => {
    const files = exportTimeline(project, format).files;
    // EDL: one file per video track; V1 (Main) is the bottom track.
    const content = format === "edl" ? files.find((f) => f.filename.endsWith("_V1.edl"))!.content : files[0].content;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(fixture(file), content);
    expect(content).toBe(readFileSync(fixture(file), "utf8"));
  });
});

describe("EDL (CMX3600)", () => {
  const eventLine = /^(\d{3})  ([A-Z0-9]{1,8} *) V {5}([CD]) {3}(\d{3}| {3})  (\d\d:\d\d:\d\d[:;]\d\d) (\d\d:\d\d:\d\d[:;]\d\d) (\d\d:\d\d:\d\d[:;]\d\d) (\d\d:\d\d:\d\d[:;]\d\d)$/;
  for (const { fps, drop } of RATES) {
    it(`obeys the column rules at ${fps} drop=${drop}`, () => {
      const project = buildProject(fps);
      const files = exportTimeline(project, "edl", { dropFrame: drop }).files;
      expect(files.map((f) => f.filename)).toEqual(["Interchange_Test_V1.edl", "Interchange_Test_V2.edl"]);
      for (const file of files) {
        const lines = file.content.split("\n");
        expect(lines[0]).toMatch(/^TITLE: /);
        expect(lines[1]).toBe(drop ? "FCM: DROP FRAME" : "FCM: NON-DROP FRAME");
        let events = 0;
        for (const line of lines.slice(2)) {
          if (!line || line.startsWith("*") || line.startsWith("M2")) continue;
          const m = eventLine.exec(line);
          expect(m, `bad EDL line: "${line}"`).not.toBeNull();
          // fixed columns: reel at 6-13, track at 15, type at 21, times start at col 30
          expect(line[14]).toBe("V");
          expect(line[20]).toMatch(/[CD]/);
          expect(line.slice(29, 40)).toMatch(/^\d\d:\d\d:\d\d[:;]\d\d$/);
          expect(line.slice(65)).toHaveLength(11);
          expect(line.length).toBe(76);
          if (drop) expect(line).toContain(";");
          events++;
        }
        expect(events).toBeGreaterThan(0);
      }
    });
  }

  it("emits the dissolve as a two-line CMX event with the transition frames", () => {
    const edl = exportTimeline(buildProject(30), "edl").files[0].content;
    expect(edl).toMatch(/^002 {2}\S+ +V {5}C {8}\d\d:\d\d:\d\d:\d\d/m);
    expect(edl).toMatch(/^002 {2}\S+ +V {5}D {3}020 {2}/m);
    expect(edl).toMatch(/^M2 /m); // clip B is 200% speed
    expect(edl).toContain("* TO CLIP NAME: broll clip.mov");
  });

  it("record times are frame exact from 01:00:00:00", () => {
    const edl = exportTimeline(buildProject(25), "edl").files[0].content;
    expect(edl).toContain("001  INTERVIE V     C        00:00:01:05 00:00:03:05 01:00:00:00 01:00:02:00");
  });
});

describe("FCPXML 1.10", () => {
  // DTD + xmllint validation lives in validation.test.ts (it fails, never skips, without xmllint).
  it("writes exact rational times for NTSC rates", () => {
    const xml = exportTimeline(buildProject(29.97), "fcpxml").files[0].content;
    expect(xml).toContain('frameDuration="1001/30000s"');
    expect(xml).toContain('duration="29029/5000s"');
  });
});

describe("hand-authored Premiere / Final Cut files", () => {
  it("imports a Premiere-style xmeml with -1 edges around a transition, link pairs and a time remap", () => {
    const text = readFileSync(fixture("premiere-sample.xml"), "utf8");
    const { sequence } = parseInterchangeSequence(text);
    expect(sequence.rate).toMatchObject({ timebase: 24, ntsc: true });
    const [v1] = sequence.tracks.filter((t) => t.kind === "video");
    expect(v1.clips.map((c) => [c.startFrame, c.endFrame])).toEqual([[0, 48], [48, 120]]);
    expect(v1.transitions).toHaveLength(1);
    expect(v1.clips[1].speed).toBeCloseTo(0.5, 6);
    expect(v1.clips[0].withAudio).toBe(true);
    expect(v1.clips[0].volume).toBeCloseTo(0.7, 6);
    // the linked audio items are folded into the video clip, so no audio tracks remain
    expect(sequence.tracks.filter((t) => t.kind === "audio")).toHaveLength(0);
    expect(sequence.markers).toEqual([{ frame: 12, name: "Cue", comment: "note" }]);
    const imported = importTimeline(text, { mediaItems: [], makeId });
    expect(imported.unmatched.map((u) => u.name)).toEqual(["shot_a.mov", "shot_b.mov"]);
    expect(imported.tracks[0].transitions).toHaveLength(1);
    expect(imported.tracks[0].transitions[0].duration).toBeCloseTo(12 * 1001 / 24000, 6);
  });

  it("imports a Final Cut Pro X FCPXML with connected clips, a retime and a dissolve", () => {
    const text = readFileSync(fixture("fcpx-sample.fcpxml"), "utf8");
    const { sequence } = parseInterchangeSequence(text);
    expect(sequence.rate).toMatchObject({ timebase: 25, ntsc: false });
    const videos = sequence.tracks.filter((t) => t.kind === "video");
    expect(videos).toHaveLength(2);
    expect(videos[0].clips.map((c) => [c.startFrame, c.endFrame])).toEqual([[0, 100], [100, 200]]);
    expect(videos[0].clips[1].speed).toBeCloseTo(2, 6);
    expect(videos[0].clips[1].inSec).toBeCloseTo(4, 6);
    expect(videos[0].clips[1].outSec).toBeCloseTo(12, 6);
    expect(videos[0].transitions).toEqual([expect.objectContaining({ startFrame: 94, endFrame: 106 })]);
    // connected clip: parent offset 0 / start 0 -> sits at 2s on lane 1
    expect(videos[1].clips[0]).toMatchObject({ startFrame: 50, endFrame: 100 });
    expect(videos[1].clips[0].opacity).toBeCloseTo(0.4, 6);
    expect(videos[0].clips[0].volume).toBeCloseTo(10 ** (-6 / 20), 6);
    expect(sequence.markers).toEqual([{ frame: 25, name: "Hello" }]);
  });

  it("rejects non-timeline XML and malformed XML", () => {
    expect(() => parseInterchangeSequence("<html/>")).toThrow(/not a Final Cut/);
    expect(() => parseInterchangeSequence("<xmeml version=\"5\"><sequence>")).toThrow();
  });
});

describe("xml helpers", () => {
  it("escapes markup in names and reads it back", () => {
    const { text, imported } = roundTrip(30, false, "xmeml");
    expect(text).toContain("Beat &amp; Drop &lt;b&gt;");
    expect(imported.markers.map((m) => m.label)).toContain("Beat & Drop <b>");
    expect(parseXml("<a x='1'><![CDATA[<k>]]><!-- c --><b/></a>").text).toBe("<k>");
  });
});
