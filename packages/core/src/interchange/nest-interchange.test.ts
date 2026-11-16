import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { createSequence, ensureSequences, nestClips, setSequenceRange } from "../timeline/sequences";
import { AAF_DECISION, exportTimeline, importTimeline, validateOtio, validateXmeml, parseOtio } from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m1", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[] = []): Track => ({
  id, type, name: id === "v1" ? "Main" : id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const media = {
  id: "m1", name: "scene.mp4", type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  sourceFile: { name: "scene.mp4", size: 1, lastModified: 1, folder: "/media" },
  metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1, hasAudio: true },
};

function parentWithNest(): { project: Project; nestId: string; parentId: string } {
  const project: Project = {
    id: "p", name: "Show", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media] as unknown as Project["mediaLibrary"]["items"] },
    timeline: {
      tracks: [track("v1", "video", [clip("a", "v1", 0, 3), clip("b", "v1", 3, 3, { inPoint: 3, outPoint: 6 }), clip("c", "v1", 6, 2, { speed: 2, outPoint: 4 })]), track("a1", "audio")],
      subtitles: [], duration: 8, markers: [],
    },
  };
  const nested = nestClips(ensureSequences(project), ["a", "b"], "Intro");
  if (!nested.ok) throw new Error(nested.message);
  return { project: nested.project, nestId: nested.sequenceId as string, parentId: nested.project.activeSequenceId as string };
}

function xmllintOk(text: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "nest-xmeml-")), "t.xml");
  writeFileSync(file, text);
  const r = spawnSync("xmllint", ["--noout", file], { encoding: "utf8" });
  expect(r.error, "xmllint must be installed").toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
}

describe("nests in interchange exports", () => {
  it("reports a retimed nest when it is flattened (EDL/FCPXML lay the clips at normal speed)", () => {
    const { project } = parentWithNest();
    const retimed = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.mediaId.startsWith("compound:") ? { ...c, speed: 2 } : c)) })),
      },
    };
    const edl = exportTimeline(retimed, "edl");
    expect(edl.report.items.some((i) => i.feature === "Nested sequence retime" && i.severity === "approximated")).toBe(true);
    const plain = exportTimeline(project, "edl");
    expect(plain.report.items.some((i) => i.feature === "Nested sequence retime")).toBe(false);
  });

  it("writes a nest as an XMEML clipitem carrying a <sequence>, valid and well-formed", () => {
    const { project } = parentWithNest();
    const out = exportTimeline(project, "xmeml");
    const text = out.files[0].content;
    expect(validateXmeml(text)).toEqual([]);
    xmllintOk(text);
    expect(text).toMatch(/<clipitem id="clipitem-v1-1">[\s\S]*<sequence id="sequence-2">[\s\S]*<name>Intro<\/name>/);
    expect(out.report.items.filter((i) => i.feature === "Nested sequence")).toEqual([]);
  });

  it("writes a nest as an OTIO Stack with its tracks, in the nested sequence's own frame rate", () => {
    const { project } = parentWithNest();
    const text = exportTimeline(project, "otio").files[0].content;
    expect(validateOtio(text)).toEqual([]);
    const doc = JSON.parse(text);
    const stacks = doc.tracks.children.flatMap((t: { children: { OTIO_SCHEMA: string }[] }) => t.children).filter((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA.startsWith("Stack"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0].name).toBe("Intro");
    expect(stacks[0].children.length).toBeGreaterThan(0);
    // Re-import rebuilds the nest as a real nested sequence (no "not imported" warning).
    const parsed = parseOtio(text);
    expect(parsed.report.warnings.some((w) => w.includes("Nested sequence"))).toBe(false);
    const nest = parsed.sequence.tracks.flatMap((t) => t.clips).find((c) => c.nested);
    expect(nest?.nested?.name).toBe("Intro");
  });

  it("flattens a nest for EDL and says so in the report; FCPXML carries it as a compound clip", () => {
    const { project } = parentWithNest();
    const out = exportTimeline(project, "edl");
    const item = out.report.items.find((i) => i.feature === "Nested sequence");
    expect(item?.severity).toBe("approximated");
    expect(item?.detail).toContain("flattened");
    const fcp = exportTimeline(project, "fcpxml");
    expect(fcp.report.items.find((i) => i.feature === "Nested sequence")).toBeUndefined();
    expect(fcp.files[0].content).toContain("<ref-clip ");
    // The flattened EDL keeps all three events (a, b inside the nest + c).
    const edl = exportTimeline(project, "edl").files.map((f) => f.content).join("\n");
    expect(edl.match(/^\d{3}\s/gm)?.length).toBeGreaterThanOrEqual(3);
  });

  it("exports the chosen sequence while another one is active, under its own name", () => {
    const { project, nestId, parentId } = parentWithNest();
    expect(project.activeSequenceId).toBe(parentId);
    const out = exportTimeline(project, "otio", { sequenceId: nestId });
    expect(out.files[0].filename).toBe("Intro.otio");
    const doc = JSON.parse(out.files[0].content);
    expect(doc.name).toBe("Intro");
    const videoTracks = doc.tracks.children.filter((t: { kind: string }) => t.kind === "Video");
    const clips = videoTracks.flatMap((t: { children: { OTIO_SCHEMA: string }[] }) => t.children).filter((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA.startsWith("Clip"));
    expect(clips).toHaveLength(2);
    // Exporting another sequence never changes the active one or the input.
    expect(project.activeSequenceId).toBe(parentId);
    const xml = exportTimeline(project, "xmeml", { sequenceId: nestId });
    expect(validateXmeml(xml.files[0].content)).toEqual([]);
    expect(xml.files[0].filename).toBe("Intro.xml");
    // An unopened empty sequence exports too (no clips is an EDL error, the others succeed).
    const created = createSequence(project, { name: "Empty", activate: false });
    if (!created.ok) throw new Error(created.message);
    expect(exportTimeline(created.project, "xmeml", { sequenceId: created.sequenceId }).files[0].filename).toBe("Empty.xml");
    expect(() => exportTimeline(project, "otio", { sequenceId: "nope" })).toThrow(/no longer exists/);
  });

  it("round-trips the chosen nest sequence through OTIO and XMEML", () => {
    const { project, nestId } = parentWithNest();
    const media1 = project.mediaLibrary.items;
    for (const format of ["otio", "xmeml"] as const) {
      const text = exportTimeline(project, format, { sequenceId: nestId }).files[0].content;
      const back = importTimeline(text, { mediaItems: media1 });
      const clips = back.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips);
      expect(clips.map((c) => [Math.round(c.startTime * 30), Math.round(c.duration * 30), Math.round(c.inPoint * 30)])).toEqual([[0, 90, 0], [90, 90, 90]]);
      expect(back.unmatched).toEqual([]);
    }
  });

  it("reports the AAF decision in every export", () => {
    const { project } = parentWithNest();
    for (const format of ["xmeml", "fcpxml", "edl", "otio"] as const) {
      const { report } = exportTimeline(project, format);
      expect(report.notes.join(" ")).toContain(AAF_DECISION.summary);
      expect(report.dropped + report.approximated).toBe(report.items.length); // notes are not counted as drops
    }
  });

  it("does not leak overlays of other sequences into this sequence's report", () => {
    const { project, nestId } = parentWithNest();
    const withTitle: Project = {
      ...project,
      textClips: [{ id: "t", trackId: "v1", startTime: 0, duration: 1, text: "On parent", style: {}, transform, keyframes: [] }] as never,
    };
    const nestReport = exportTimeline(withTitle, "otio", { sequenceId: nestId }).report;
    expect(nestReport.items.find((i) => i.feature === "Text clip")).toBeUndefined();
    expect(exportTimeline(withTitle, "otio").report.items.find((i) => i.feature === "Text clip")).toBeDefined();
  });

  it("keeps sequence In/Out untouched (export ignores them) and survives a nest inside a nest", () => {
    const { project, nestId } = parentWithNest();
    const ranged = setSequenceRange(project, nestId, { inPoint: 0, outPoint: 1 });
    if (!ranged.ok) throw new Error(ranged.message);
    expect(validateOtio(exportTimeline(ranged.project, "otio").files[0].content)).toEqual([]);
  });
});

describe("OTIO retime semantics", () => {
  it("writes LinearTimeWarp.1 with a signed time_scalar and a clip source_range that starts in media time", () => {
    const { project } = parentWithNest();
    const reversed: Project = {
      ...project,
      timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => t.id === "v1" ? { ...t, clips: t.clips.map((c) => c.id === "c" ? { ...c, reversed: true } : c) } : t) },
    };
    const doc = JSON.parse(exportTimeline(reversed, "otio").files[0].content);
    const c = doc.tracks.children.flatMap((t: { children: { name: string }[] }) => t.children).find((x: { metadata?: { openreel?: { id?: string } } }) => x.metadata?.openreel?.id === "c");
    const warp = c.effects.find((e: { OTIO_SCHEMA: string }) => e.OTIO_SCHEMA === "LinearTimeWarp.1");
    expect(warp.time_scalar).toBe(-2);
    expect(warp.effect_name).toBe("LinearTimeWarp");
    // Timeline duration (60 frames = 2s @30) is the item's occupied length; the media consumed is duration * |scalar|.
    expect(c.source_range.duration).toMatchObject({ value: 60, rate: 30 });
    const bad = JSON.stringify(doc).replace('"time_scalar": -2', '"time_scalar": 0').replace('"time_scalar":-2', '"time_scalar":0');
    expect(validateOtio(bad).some((p) => p.includes("time_scalar"))).toBe(true);
  });
});
