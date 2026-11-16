import { describe, expect, it } from "vitest";
import type { Marker } from "../types/timeline";
import type { Project } from "../types/project";
import { buildProject } from "./__fixtures__/project";
import { exportTimeline, importTimeline } from "./index";
import {
  CSV_COLUMNS,
  chaptersText,
  formatChapterTime,
  markersCsv,
  markersEdlLocs,
  nearestMarkerColorName,
  parseEdlLocs,
} from "./marker-export";

const mk = (time: number, label: string, extra: Partial<Marker> = {}): Marker => ({
  id: `m${time}`,
  time,
  label,
  color: "#3b82f6",
  ...extra,
});

describe("chaptersText", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatChapterTime(0)).toBe("0:00");
    expect(formatChapterTime(65)).toBe("1:05");
    expect(formatChapterTime(3600 + 62)).toBe("1:01:02");
  });

  it("forces the first chapter at 0:00 with an Intro chapter", () => {
    const { text, warnings } = chaptersText([mk(15, "Setup"), mk(60, "Build"), mk(125, "Wrap up")]);
    expect(text.split("\n")).toEqual(["0:00 Intro", "0:15 Setup", "1:00 Build", "2:05 Wrap up"]);
    expect(warnings).toEqual([]);
  });

  it("moves a chapter that is already first to 0:00 instead of adding an Intro", () => {
    const { text } = chaptersText([mk(0.4, "Cold open"), mk(30, "Two"), mk(90, "Three")]);
    expect(text.split("\n")[0]).toBe("0:00 Cold open");
    expect(text.split("\n")).toHaveLength(3);
  });

  it("uses chapter markers when there are any, otherwise all markers", () => {
    const withKinds = chaptersText([mk(5, "note"), mk(20, "A", { kind: "chapter" }), mk(50, "B", { kind: "chapter" })]);
    expect(withKinds.text.split("\n")).toEqual(["0:00 Intro", "0:20 A", "0:50 B"]);
    const all = chaptersText([mk(5, "note")]);
    expect(all.text).toBe("0:00 Intro\n0:05 note");
  });

  it("warns below the minimum chapter count", () => {
    const { warnings, text } = chaptersText([mk(0, "One"), mk(30, "Two")]);
    expect(text).toBe("0:00 One\n0:30 Two");
    expect(warnings.some((w) => /at least 3 chapters/.test(w))).toBe(true);
  });

  it("warns about chapters shorter than 10 seconds, including the last one with a duration", () => {
    const short = chaptersText([mk(0, "A"), mk(5, "B"), mk(40, "C")]);
    expect(short.warnings.some((w) => /"A" at 0:00/.test(w))).toBe(true);
    const last = chaptersText([mk(0, "A"), mk(20, "B"), mk(40, "C")], { totalDuration: 45 });
    expect(last.warnings.some((w) => /"C" at 0:40/.test(w))).toBe(true);
    const fine = chaptersText([mk(0, "A"), mk(20, "B"), mk(40, "C")], { totalDuration: 60 });
    expect(fine.warnings).toEqual([]);
  });

  it("collapses duplicates at the same second and sorts by time", () => {
    const { chapters } = chaptersText([mk(40, "C"), mk(0, "A"), mk(20.2, "B"), mk(20.7, "B2")]);
    expect(chapters.map((c) => c.title)).toEqual(["A", "B", "C"]);
  });

  it("warns on an empty list and produces no text", () => {
    const result = chaptersText([]);
    expect(result.text).toBe("");
    expect(result.warnings).toHaveLength(1);
  });
});

describe("markersCsv", () => {
  it("has Premiere's column order and SMPTE timecode at 29.97 drop-frame", () => {
    const csv = markersCsv(
      [
        mk(61.5, "Later", { kind: "chapter", comment: 'He said "hi", twice' }),
        mk(1, "First", { duration: 2 }),
      ],
      29.97,
    );
    const lines = csv.split("\n");
    expect(lines[0].split(",")).toEqual([...CSV_COLUMNS]);
    expect(CSV_COLUMNS).toEqual(["Marker Name", "Description", "In", "Out", "Duration", "Marker Type"]);
    expect(lines[1]).toBe("First,,00:00:01;00,00:00:03;00,00:00:02;00,Comment");
    // 61.5 s = frame 1843 at 29.97; drop-frame skips ;00 and ;01 at minute 1, so it reads 00:01:01;15
    expect(lines[2]).toBe('Later,"He said ""hi"", twice",00:01:01;15,00:01:01;15,00:00:00;00,Chapter');
  });

  it("uses non-drop colons at 25 fps and tabs on request", () => {
    const csv = markersCsv([mk(2, "A", { duration: 1 })], 25, { delimiter: "\t" });
    expect(csv.split("\n")[1]).toBe("A\t\t00:00:02:00\t00:00:03:00\t00:00:01:00\tComment");
  });
});

describe("EDL locators", () => {
  it("writes LOC lines that parse back", () => {
    const markers = [mk(10, "Beat & Drop", { color: "#ef4444" }), mk(2.5, "Intro", { color: "#22c55e" })];
    const lines = markersEdlLocs(markers, 29.97);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\* LOC: 01:00:02;\d\d GREEN {4}Intro$/);
    const parsed = parseEdlLocs(lines.join("\n"), 29.97);
    expect(parsed.map((p) => [p.name, p.color])).toEqual([
      ["Intro", "GREEN"],
      ["Beat & Drop", "RED"],
    ]);
    expect(parsed[0].time).toBeCloseTo(2.5, 1);
    expect(parsed[1].time).toBeCloseTo(10, 1);
  });

  it("maps a colour to the nearest locator colour name", () => {
    expect(nearestMarkerColorName("#3b82f6")).toBe("BLUE");
    expect(nearestMarkerColorName("#ff0000")).toBe("RED");
    expect(nearestMarkerColorName("not a colour")).toBe("RED");
  });
});

describe("timeline interchange keeps markers", () => {
  const withMarkers = (fps: number): Project => {
    const project = buildProject(fps);
    return {
      ...project,
      timeline: {
        ...project.timeline,
        markers: [
          { id: "a", time: 30 / fps, label: "Intro", color: "#3b82f6" },
          { id: "b", time: 60 / fps, label: "Range", color: "#ef4444", duration: 24 / fps, comment: "fix <this> & that" },
        ],
      },
    };
  };
  let n = 0;
  const makeId = (): string => `x${++n}`;

  for (const format of ["xmeml", "fcpxml", "otio"] as const) {
    it(`${format} round trip keeps marker names, times, durations and comments`, () => {
      const project = withMarkers(30);
      const text = exportTimeline(project, format).files[0].content;
      const imported = importTimeline(text, { mediaItems: project.mediaLibrary.items, makeId });
      expect(imported.markers.map((m) => m.label)).toEqual(["Intro", "Range"]);
      expect(imported.markers[0].time).toBeCloseTo(1, 6);
      expect(imported.markers[0].duration).toBeUndefined();
      expect(imported.markers[1].time).toBeCloseTo(2, 6);
      expect(imported.markers[1].duration).toBeCloseTo(0.8, 6);
      expect(imported.markers[1].comment).toBe("fix <this> & that");
    });
  }

  it("xmeml writes the range as in/out frames and the comment", () => {
    const text = exportTimeline(withMarkers(30), "xmeml").files[0].content;
    expect(text).toMatch(/<name>Range<\/name>\s*<comment>fix &lt;this&gt; &amp; that<\/comment>\s*<in>60<\/in>\s*<out>84<\/out>/);
  });

  it("fcpxml writes the range duration instead of one frame", () => {
    const text = exportTimeline(withMarkers(30), "fcpxml").files[0].content;
    expect(text).toMatch(/<marker [^>]*duration="4\/5s"[^>]*value="Range"/);
  });

  it("edl round trip keeps marker names and times as LOC lines", () => {
    const project = withMarkers(30);
    const edl = exportTimeline(project, "edl").files[0].content;
    const locs = parseEdlLocs(edl, 30);
    expect(locs.map((l) => [l.name, l.frame])).toEqual([
      ["Intro", 30],
      ["Range", 60],
    ]);
    expect(locs[1].color).toBe("RED");
  });

  it("includeMarkers: false leaves markers out of every format", () => {
    const project = withMarkers(30);
    expect(exportTimeline(project, "xmeml", { includeMarkers: false }).files[0].content).not.toContain("<marker>");
    expect(exportTimeline(project, "edl", { includeMarkers: false }).files[0].content).not.toContain("LOC:");
    expect(exportTimeline(project, "fcpxml", { includeMarkers: false }).files[0].content).not.toContain("<marker ");
    const otio = JSON.parse(exportTimeline(project, "otio", { includeMarkers: false }).files[0].content);
    expect(otio.tracks.markers).toEqual([]);
  });
});
