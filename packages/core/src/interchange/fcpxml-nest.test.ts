import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { calculateProjectDuration } from "../timeline/project-duration";
import { ensureSequences, nestClips, syncActiveSequence } from "../timeline/sequences";
import { applyTimelineImport, exportTimeline, importTimeline, parseFcpxml, planTimelineImport, projectToSequence, serializeFcpxml } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const DTD = join(here, "__fixtures__", "fcpxml-1.10.dtd");

function dtdValid(xml: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "fcpxml-nest-")), "t.fcpxml");
  writeFileSync(file, xml);
  const r = spawnSync("xmllint", ["--noout", "--dtdvalid", DTD, file], { encoding: "utf8" });
  expect(r.error, "xmllint must be installed").toBeUndefined();
  expect(`${r.stdout}${r.stderr}`.replaceAll(DTD, "<dtd>"), "DTD validation output").toBe("");
  expect(r.status).toBe(0);
}

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m1", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[] = []): Track => ({
  id, type, name: id === "v1" ? "Main" : id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const mediaItem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  sourceFile: { name, size: 1, lastModified: 1, folder: "/media" },
  metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1, hasAudio: true, ...extra },
});

function baseProject(): Project {
  return {
    id: "p", name: "Show", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [mediaItem("m1", "scene.mp4")] as unknown as Project["mediaLibrary"]["items"] },
    timeline: {
      tracks: [
        track("v1", "video", [clip("a", "v1", 0, 3), clip("b", "v1", 3, 3, { inPoint: 3, outPoint: 6 }), clip("c", "v1", 6, 2, { speed: 2, outPoint: 4 })]),
        track("a1", "audio"),
      ],
      subtitles: [], duration: 8, markers: [],
    },
  };
}

function withNest(): { project: Project; nestId: string } {
  const nested = nestClips(ensureSequences(baseProject()), ["a", "b"], "Intro");
  if (!nested.ok) throw new Error(nested.message);
  return { project: nested.project, nestId: nested.sequenceId as string };
}

const framesOf = (seconds: number): number => Math.round(seconds * 30);

describe("FCPXML compound clips (nests)", () => {
  it("exports a nest as <media><sequence> + <ref-clip>, DTD-valid, with no flatten report entry", () => {
    const { project } = withNest();
    const out = exportTimeline(project, "fcpxml");
    const xml = out.files[0].content;
    dtdValid(xml);
    expect(xml).toMatch(/<media id="r\d+" name="Intro">\s*<sequence /);
    expect(xml).toMatch(/<ref-clip ref="r\d+"[^>]*name="Intro"/);
    expect(xml).not.toContain("<mc-clip");
    // the nest's own clips are inside the compound's spine, the parent keeps the clip that was not nested
    expect(xml.match(/<asset-clip /g)?.length).toBe(3);
    expect(out.report.items.filter((item) => item.feature === "Nested sequence")).toEqual([]);
    expect(out.warnings.some((w) => w.includes("flattened"))).toBe(false);
  });

  it("keeps EDL flattening and its report entry", () => {
    const { project } = withNest();
    const edl = exportTimeline(project, "edl");
    expect(edl.report.items.find((i) => i.feature === "Nested sequence")?.detail).toContain("flattened");
  });

  it("a nest used twice shares ONE compound resource (edit once, change everywhere)", () => {
    const { project, nestId } = withNest();
    const parentTrack = project.timeline.tracks.find((t) => t.type === "video")!;
    const first = parentTrack.clips.find((c) => c.mediaId === `compound:${nestId}`)!;
    const second: Clip = { ...first, id: "nest-2", startTime: 20, trackId: parentTrack.id };
    const doubled: Project = {
      ...project,
      timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => (t.id === parentTrack.id ? { ...t, clips: [...t.clips, second] } : t)) },
    };
    const xml = exportTimeline(doubled, "fcpxml").files[0].content;
    dtdValid(xml);
    expect(xml.match(/<media id=/g)?.length).toBe(1);
    expect(xml.match(/<ref-clip /g)?.length).toBe(2);
  });

  it("a retimed nest keeps its timeMap on the ref-clip (no 'retime' flatten approximation)", () => {
    const { project, nestId } = withNest();
    const retimed: Project = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.mediaId === `compound:${nestId}` ? { ...c, speed: 2, duration: 3, outPoint: 6 } : c)) })),
      },
    };
    const out = exportTimeline(retimed, "fcpxml");
    dtdValid(out.files[0].content);
    expect(out.files[0].content).toMatch(/<ref-clip [^>]*>\s*<timeMap>/);
    expect(out.report.items.some((i) => i.feature === "Nested sequence retime")).toBe(false);
  });

  it("round-trips: export, import and commit gives the same nest with the same clips and an editable sequence", () => {
    const { project } = withNest();
    const xml = exportTimeline(project, "fcpxml").files[0].content;
    const parsed = parseFcpxml(xml);
    expect(parsed.report.warnings).toEqual([]);
    const result = importTimeline(xml, { mediaItems: project.mediaLibrary.items });
    expect(result.nests).toHaveLength(1);
    expect(result.unmatched).toEqual([]);
    expect(result.nests?.[0].name).toBe("Intro");
    const innerClips = result.nests?.[0].tracks.filter((t) => t.type === "video").flatMap((t) => t.clips) ?? [];
    expect(innerClips.map((c) => [framesOf(c.startTime), framesOf(c.duration), framesOf(c.inPoint)])).toEqual([[0, 90, 0], [90, 90, 90]]);
    const mainClips = result.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips);
    const nestClip = mainClips.find((c) => c.mediaId.startsWith("compound:"));
    expect(nestClip).toBeDefined();
    expect([framesOf(nestClip!.startTime), framesOf(nestClip!.duration)]).toEqual([0, 180]);
    expect(mainClips.find((c) => !c.mediaId.startsWith("compound:"))).toMatchObject({ speed: 2 });

    // Commit it into a fresh project: the nest is a real sequence that the nest clip resolves.
    const target: Project = { ...baseProject(), timeline: { tracks: [], subtitles: [], markers: [], duration: 0 } };
    const applied = applyTimelineImport(target, result, "replace");
    expect(applied.sequences).toHaveLength(2);
    const nestSequence = applied.sequences?.find((s) => s.name === "Intro");
    expect(nestSequence).toBeDefined();
    const live = syncActiveSequence(applied);
    const liveNest = live.timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaId.startsWith("compound:"));
    expect(liveNest?.mediaId).toBe(`compound:${nestSequence?.id}`);
    expect(applied.compoundClips?.map((c) => c.id)).toContain(nestSequence?.id);
    expect(applied.nestedInstances?.map((i) => i.id)).toContain(liveNest?.id);
    expect(calculateProjectDuration(applied)).toBeCloseTo(8, 1);
    // Exporting the imported project again gives the same structure (idempotent round trip).
    const again = exportTimeline(applied, "fcpxml").files[0].content;
    dtdValid(again);
    expect(again.match(/<ref-clip /g)?.length).toBe(1);
    expect(again.match(/<asset-clip /g)?.length).toBe(3);
  });

  it("nests inside nests round-trip too, shared definitions stay shared", () => {
    const { project } = withNest();
    const outer = nestClips(project, project.timeline.tracks.flatMap((t) => t.clips).map((c) => c.id).slice(0, 2), "Outer");
    if (!outer.ok) throw new Error(outer.message);
    const xml = exportTimeline(outer.project, "fcpxml").files[0].content;
    dtdValid(xml);
    expect(xml.match(/<media id=/g)?.length).toBe(2);
    const result = importTimeline(xml, { mediaItems: outer.project.mediaLibrary.items });
    expect(result.nests?.map((n) => n.name).sort()).toEqual(["Intro", "Outer"]);
    const applied = applyTimelineImport({ ...baseProject(), timeline: { tracks: [], subtitles: [], markers: [], duration: 0 } }, result, "replace");
    expect(applied.sequences).toHaveLength(3);
  });

  it("existing media-only FCPXML imports are unchanged (no nests, no sequences added)", () => {
    const project = baseProject();
    const xml = exportTimeline(project, "fcpxml").files[0].content;
    const result = importTimeline(xml, { mediaItems: project.mediaLibrary.items });
    expect(result.nests).toBeUndefined();
    const applied = applyTimelineImport(project, result, "replace");
    expect(applied.sequences).toBeUndefined();
    expect(planTimelineImport(project, result, "replace").timeline.tracks.length).toBe(applied.timeline.tracks.length);
  });

  it("skips a self-referencing compound clip with a warning instead of looping", () => {
    const { project } = withNest();
    const xml = exportTimeline(project, "fcpxml").files[0].content;
    const looped = xml.replace(/(<media id="(r\d+)" name="Intro">[\s\S]*?<spine>)/, `$1<ref-clip ref="$2" offset="0s" start="0s" duration="1s" name="Loop"/>`);
    const parsed = parseFcpxml(looped);
    expect(parsed.report.warnings.some((w) => w.includes("contains itself"))).toBe(true);
  });
});

describe("FCPXML multicam (mc-clip)", () => {
  function multicamProject(): Project {
    const project = baseProject();
    const second = mediaItem("m2", "camB.mp4");
    const cut = (id: string, mediaId: string, angleId: string, start: number, inPoint: number): Clip =>
      clip(id, "v1", start, 2, { mediaId, inPoint, outPoint: inPoint + 2, metadata: { multicam: { sourceId: "mc1", angleId } } });
    return {
      ...project,
      mediaLibrary: { items: [...project.mediaLibrary.items, second] as unknown as Project["mediaLibrary"]["items"] },
      multicamSources: [{
        id: "mc1", name: "Interview", syncMethod: "audio", audio: { mode: "follow" }, createdAt: 1,
        angles: [
          { id: "angA", name: "Cam A", mediaId: "m1", offset: 0, duration: 20, color: "#ef4444" },
          { id: "angB", name: "Cam B", mediaId: "m2", offset: 1.5, duration: 20, color: "#22c55e" },
        ],
      }],
      timeline: {
        ...project.timeline,
        tracks: [track("v1", "video", [cut("k1", "m1", "angA", 0, 4), cut("k2", "m2", "angB", 2, 2.5)]), track("a1", "audio")],
        duration: 4,
      },
    };
  }

  it("writes a multicam resource with every angle and mc-clips with the active angle, DTD-valid", () => {
    const project = multicamProject();
    const out = exportTimeline(project, "fcpxml");
    const xml = out.files[0].content;
    dtdValid(xml);
    expect(xml).toMatch(/<media id="r\d+" name="Interview">\s*<multicam /);
    expect(xml.match(/<mc-angle /g)?.length).toBe(2);
    expect(xml.match(/<mc-clip /g)?.length).toBe(2);
    expect(xml).toContain('<mc-source angleID="angA"');
    expect(xml).toContain('<mc-source angleID="angB"');
    // No "flattened to its active angle" entry: the angles are carried.
    expect(out.report.items.some((i) => i.feature === "Multicam clip")).toBe(false);
    expect(out.report.notes.join(" ")).toContain("mc-clip");
    // OTIO and EDL still report the flatten; XMEML carries the angles as a multiclip.
    expect(exportTimeline(project, "otio").report.items.some((i) => i.feature === "Multicam clip")).toBe(true);
    expect(exportTimeline(project, "xmeml").report.items.some((i) => i.feature === "Multicam clip")).toBe(false);
  });

  it("places the angle at its shared-timeline offset: mc-clip start = clip in-point + angle offset", () => {
    const xml = exportTimeline(multicamProject(), "fcpxml").files[0].content;
    // cut 2 plays Cam B from its media second 2.5 = shared 4.0s
    expect(xml).toMatch(/<mc-clip ref="r\d+" offset="2s" start="4s" duration="2s"/);
    // Cam B's angle clip is placed 1.5s into the shared timeline
    expect(xml).toMatch(/<mc-angle name="Cam B" angleID="angB">\s*<asset-clip [^>]*offset="3\/2s"/);
  });

  it("imports an mc-clip as its active angle's clip with the right source window and a clear warning", () => {
    const project = multicamProject();
    const xml = exportTimeline(project, "fcpxml").files[0].content;
    const result = importTimeline(xml, { mediaItems: project.mediaLibrary.items });
    const clips = result.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((x, y) => x.startTime - y.startTime);
    expect(clips.map((c) => [c.mediaId, framesOf(c.startTime), framesOf(c.duration), Math.round(c.inPoint * 10) / 10])).toEqual([
      ["m1", 0, 60, 4],
      ["m2", 60, 60, 2.5],
    ]);
    expect(result.warnings.filter((w) => w.includes("Multicam clip")).length).toBe(2);
    expect(result.warnings.join(" ")).toContain("active angle");
    expect(result.unmatched).toEqual([]);
  });

  it("serialising a hand-built sequence without multicam is unchanged by the new fields", () => {
    const { sequence } = projectToSequence(baseProject());
    expect(sequence.multicam).toBeUndefined();
    expect(serializeFcpxml(sequence)).toContain("<spine>");
  });
});
