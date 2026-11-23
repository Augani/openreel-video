import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import type { Subtitle } from "@openreel/core/types/timeline";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

type Loose = Record<string, unknown>;

const cue = (id: string, spec: Array<[string, number, number]>, speaker: string): Subtitle => ({
  id,
  text: spec.map((w) => w[0]).join(" "),
  startTime: spec[0][1],
  endTime: spec[spec.length - 1][2],
  words: spec.map(([text, startTime, endTime]) => ({ text, startTime, endTime })),
  speaker,
});

function build(): Project {
  const project = makeProjectWithClip();
  const proto = structuredClone(project.timeline.tracks[0].clips[0]) as unknown as Loose;
  const clip = (id: string, trackId: string, metadata?: Loose) => ({
    ...structuredClone(proto),
    id,
    trackId,
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    ...(metadata ? { metadata } : {}),
  });
  const track = (id: string, type: string, name: string, clips: unknown[]) => ({
    id, type, name, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
  });
  const tracks = project.timeline.tracks as unknown as unknown[];
  tracks.length = 0;
  tracks.push(
    track("v1", "video", "V1", [clip("c1", "v1")]),
    track("a1", "audio", "A1", [clip("a-1", "a1", { separatedFromClipId: "c1" })]),
  );
  (project.timeline as { duration: number }).duration = 10;
  (project.timeline as { subtitles: Subtitle[] }).subtitles = [
    cue("s1", [["Hello", 0.5, 0.9], ["there.", 0.9, 1.4]], "Ann"),
    cue("s2", [["Um,", 2.0, 2.3], ["this", 2.5, 2.8], ["is", 2.8, 3.0], ["like", 3.0, 3.2], ["great.", 3.2, 3.8]], "Ann"),
    cue("s3", [["Thanks", 6.0, 6.5], ["all.", 6.5, 7.0]], "Bob"),
  ];
  return project;
}

function setup() {
  const history = new ActionHistory();
  const host = new HeadlessHost(build(), { history });
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo };
}
const spans = (host: HeadlessHost, trackId: string) =>
  (host.getProject().timeline.tracks.find((t) => t.id === trackId)?.clips ?? [])
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => [+c.startTime.toFixed(4), +c.duration.toFixed(4)]);

describe("caption agent tools", () => {
  it("registers the tools", () => {
    for (const name of [
      "export_captions",
      "transcript_cut_range",
      "remove_filler_words",
      "remove_pauses",
      "rename_speaker",
      "merge_speakers",
      "import_captions",
      "get_caption_transcript",
      "caption_qc",
    ])
      expect(getTool(name), name).toBeDefined();
  });

  it("exports WebVTT with voice tags and TTML", async () => {
    const { host } = setup();
    const vtt = await executeTool("export_captions", { format: "vtt" }, host);
    expect(vtt.ok, vtt.summary).toBe(true);
    const content = (vtt.data as { content: string }).content;
    expect(content.startsWith("WEBVTT")).toBe(true);
    expect(content).toContain("00:00:00.500 --> 00:00:01.400\n<v Ann>Hello there.</v>");
    const ttml = await executeTool("export_captions", { format: "ttml" }, host);
    expect((ttml.data as { content: string }).content).toContain("<ttm:name type=\"alias\">Bob</ttm:name>");
    expect((await executeTool("export_captions", { format: "nope" }, host)).ok).toBe(false);
  });

  it("exports SCC with a validation report and EBU-STL as base64, and both re-import", async () => {
    const { host } = setup();
    const scc = await executeTool("export_captions", { format: "scc", offsetSeconds: 3600, dropFrame: false }, host);
    expect(scc.ok, scc.summary).toBe(true);
    const sccContent = (scc.data as { content: string }).content;
    expect(sccContent.startsWith("Scenarist_SCC V1.0")).toBe(true);
    expect(sccContent).toMatch(/\d\d:\d\d:\d\d:\d\d\t9420 9420 94ae 94ae/);

    const stl = await executeTool("export_captions", { format: "stl", frameRate: 25 }, host);
    expect(stl.ok, stl.summary).toBe(true);
    const stlData = stl.data as { contentBase64: string; bytes: number; extension: string };
    expect(stlData.extension).toBe("stl");
    expect(stlData.bytes).toBe(1024 + 128 * 3);

    const { host: other } = setup();
    (other.getProject().timeline as { subtitles: Subtitle[] }).subtitles = [];
    const a = await executeTool("import_captions", { content: sccContent, offsetSeconds: 3600, frameRate: 29.97 }, other);
    expect(a.ok, a.summary).toBe(true);
    expect(other.getProject().timeline.subtitles.map((c) => c.text)).toEqual(["Hello there.", "Um, this is like great.", "Thanks all."]);
    for (const [i, expected] of [0.5, 2.0, 6.0].entries())
      expect(Math.abs(other.getProject().timeline.subtitles[i].startTime - expected)).toBeLessThanOrEqual(1 / 29.97);

    const { host: third } = setup();
    (third.getProject().timeline as { subtitles: Subtitle[] }).subtitles = [];
    const b = await executeTool("import_captions", { contentBase64: stlData.contentBase64 }, third);
    expect(b.ok, b.summary).toBe(true);
    expect(third.getProject().timeline.subtitles.map((c) => c.text)).toEqual(["Hello there.", "Um, this is like great.", "Thanks all."]);
    expect(third.getProject().timeline.subtitles[2].startTime).toBeCloseTo(6, 6);
  });

  it("previews the embedded subtitle tracks a video export would carry", async () => {
    const { host } = setup();
    const web = await executeTool("export_captions", { embedded: "subtitle" }, host);
    expect(web.ok, web.summary).toBe(true);
    const payload = (web.data as { embedded: Array<{ kind: string; language: string }> }).embedded;
    expect(payload.map((p) => p.kind)).toEqual(["webvtt"]);
    const cc = await executeTool("export_captions", { embedded: "cea608", container: "mov", desktop: true }, host);
    expect((cc.data as { embedded: Array<{ kind: string }> }).embedded[0].kind).toBe("cea608");
    const refused = await executeTool("export_captions", { embedded: "cea608" }, host);
    expect((refused.data as { warnings: string[] }).warnings[0]).toMatch(/desktop/);
  });

  it("caption_qc reports reading speed, gaps and row problems with jump times", async () => {
    const { host } = setup();
    const subs = host.getProject().timeline.subtitles as Subtitle[];
    subs.push({ id: "fast", text: "This caption has far too many characters for its tiny duration", startTime: 8, endTime: 8.5 });
    subs.push({ id: "near", text: "right after", startTime: 8.52, endTime: 10 });
    const result = await executeTool("caption_qc", { frameRate: 25 }, host);
    expect(result.ok, result.summary).toBe(true);
    const data = result.data as { issues: Array<{ code: string; cueId: string; time: number }>; counts: Record<string, number> };
    const codes = data.issues.map((i) => `${i.code}:${i.cueId}`);
    expect(codes).toContain("cps:fast");
    expect(codes).toContain("min-duration:fast");
    expect(codes).toContain("gap:near");
    expect(data.issues.find((i) => i.code === "cps")!.time).toBe(8);
    expect((await executeTool("caption_qc", { maxCps: -1 }, host)).ok).toBe(false);
  });

  it("transcript_cut_range cuts linked tracks together as one undo step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("transcript_cut_range", { start: 2.5, end: 3.8 }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(spans(host, "v1")).toEqual([[0, 2.5], [2.5, 6.2]]);
    expect(spans(host, "a1")).toEqual(spans(host, "v1"));
    expect(host.getProject().timeline.subtitles.find((s) => s.id === "s3")!.startTime).toBeCloseTo(4.7, 6);
    await undo();
    expect(spans(host, "v1")).toEqual([[0, 10]]);
    expect(host.getProject().timeline.subtitles.find((s) => s.id === "s3")!.startTime).toBe(6);
  });

  it("remove_filler_words previews, then removes every filler in one undo step", async () => {
    const { host, history } = setup();
    const preview = await executeTool("remove_filler_words", { preview: true }, host);
    expect((preview.data as { fillers: unknown[] }).fillers).toHaveLength(2);
    expect(history.getUndoStackSize()).toBe(0);
    const result = await executeTool("remove_filler_words", {}, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    // "Um," 2.0-2.3 and "like" 3.0-3.2 removed: 0.5s total.
    const total = spans(host, "v1").reduce((sum, c) => sum + c[1], 0);
    expect(total).toBeCloseTo(9.5, 6);
    expect(spans(host, "a1")).toEqual(spans(host, "v1"));
  });

  it("remove_pauses cuts long gaps leaving breathing room", async () => {
    const { host, history } = setup();
    const result = await executeTool("remove_pauses", { minDuration: 1, keep: 0.2 }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    // Gaps: 1.4->2.0 (0.6, under 1s), 3.8->6.0 (2.2s): cut 2.0s.
    const total = spans(host, "v1").reduce((sum, c) => sum + c[1], 0);
    expect(total).toBeCloseTo(8, 6);
  });

  it("rename_speaker updates every caption in one undo step", async () => {
    const { host, history, undo } = setup();
    const result = await executeTool("rename_speaker", { from: "Ann", to: "Annabel" }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    expect(host.getProject().timeline.subtitles.map((s) => s.speaker)).toEqual(["Annabel", "Annabel", "Bob"]);
    await undo();
    expect(host.getProject().timeline.subtitles.map((s) => s.speaker)).toEqual(["Ann", "Ann", "Bob"]);
    expect((await executeTool("rename_speaker", { from: "Nobody", to: "X" }, host)).ok).toBe(false);
  });

  it("merge_speakers folds one speaker into another in one undo step", async () => {
    const { host, history, undo } = setup();
    const result = await executeTool("merge_speakers", { from: "Bob", into: "Ann" }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    expect(host.getProject().timeline.subtitles.map((s) => s.speaker)).toEqual(["Ann", "Ann", "Ann"]);
    await undo();
    expect(host.getProject().timeline.subtitles.map((s) => s.speaker)).toEqual(["Ann", "Ann", "Bob"]);
    expect((await executeTool("merge_speakers", { from: "Bob", into: "Nobody" }, host)).ok).toBe(false);
    expect((await executeTool("merge_speakers", { from: "Ann", into: "Ann" }, host)).ok).toBe(false);
  });

  it("import_captions adds a translation track", async () => {
    const { host } = setup();
    const result = await executeTool(
      "import_captions",
      { content: "WEBVTT\n\n00:00.500 --> 00:01.400\n<v Ann>Bonjour</v>\n", captionTrackId: "fr", language: "fr" },
      host,
    );
    expect(result.ok, result.summary).toBe(true);
    const subs = host.getProject().timeline.subtitles;
    expect(subs).toHaveLength(4);
    expect(subs[3]).toMatchObject({ text: "Bonjour", speaker: "Ann", language: "fr", captionTrackId: "fr" });
    const exported = await executeTool("export_captions", { format: "vtt", captionTrackId: "fr" }, host);
    expect((exported.data as { content: string }).content).toContain("Bonjour");
    expect((exported.data as { content: string }).content).not.toContain("Hello");
  });

  it("imports MCC and SCC with a caption channel, reports what was not imported, and exports MCC", async () => {
    const { MCC_HELLO, SCC_POSITIONED } = await import("@openreel/core/captions/fixtures");
    const { host } = setup();
    (host.getProject().timeline as { subtitles: Subtitle[] }).subtitles = [];
    const mcc = await executeTool("import_captions", { content: MCC_HELLO }, host);
    expect(mcc.ok, mcc.summary).toBe(true);
    const data = mcc.data as { format: string; added: number; issues: Array<{ code: string; message: string }> };
    expect(data.format).toBe("mcc");
    expect(data.issues.map((i) => i.code)).toContain("cc-other-channel");
    expect(host.getProject().timeline.subtitles.map((c) => c.text)).toEqual(["Hello"]);

    (host.getProject().timeline as { subtitles: Subtitle[] }).subtitles = [];
    const cc2 = await executeTool("import_captions", { content: SCC_POSITIONED, ccChannel: 2 }, host);
    expect(cc2.ok, cc2.summary).toBe(true);
    expect(host.getProject().timeline.subtitles.map((c) => c.text)).toEqual(["Channel two"]);

    const exported = await executeTool("export_captions", { format: "mcc", dropFrame: false }, host);
    expect(exported.ok, exported.summary).toBe(true);
    expect((exported.data as { content: string }).content.startsWith("File Format=MacCaption_MCC V2.0")).toBe(true);
    expect((await executeTool("import_captions", { content: "File Format=MacCaption_MCC V2.0\n\nnope" }, host)).ok).toBe(false);
  });

  it("imports a timed plain-text transcript", async () => {
    const { host } = setup();
    (host.getProject().timeline as { subtitles: Subtitle[] }).subtitles = [];
    const r = await executeTool("import_captions", { content: "[00:00:01] Hello\n[00:00:03] World\n" }, host);
    expect(r.ok, r.summary).toBe(true);
    expect((r.data as { format: string }).format).toBe("txt");
    expect(host.getProject().timeline.subtitles.map((c) => c.text)).toEqual(["Hello", "World"]);
  });
});
