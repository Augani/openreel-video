import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const project = makeProjectWithClip() as Project;
  (project.mediaLibrary as { items: unknown[] }).items = [
    {
      id: "m1", name: "Interview.mp4", type: "video", blob: null, fileHandle: null,
      metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, channels: 2, sampleRate: 48000 },
    },
  ];
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  return { host, history, project };
}

const mainClips = (host: HeadlessHost) =>
  host
    .getProject()
    .timeline.tracks.flatMap((t) => t.clips)
    .map((c) => [+c.startTime.toFixed(4), +c.duration.toFixed(4), +c.inPoint.toFixed(4)]);

describe("interchange agent tools", () => {
  it("registers export_timeline_xml and import_timeline_xml over MCP", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    for (const name of ["export_timeline_xml", "import_timeline_xml"]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name)).toBe(true);
    }
    expect(getTool("export_timeline_xml")!.readOnly).toBe(true);
    expect(getTool("import_timeline_xml")!.destructive).toBe(true);
  });

  it("exports OTIO with a report and imports it back as one undo step", async () => {
    const { host, history } = setup();
    const before = mainClips(host);
    const exported = await executeTool("export_timeline_xml", { format: "otio" }, host);
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    const data = exported.data as {
      files: { filename: string; content: string }[];
      report: { items: unknown[]; dropped: number; approximated: number };
    };
    expect(data.files[0].filename).toMatch(/\.otio$/);
    expect(JSON.parse(data.files[0].content).OTIO_SCHEMA).toBe("Timeline.1");
    expect(Array.isArray(data.report.items)).toBe(true);
    const edl = await executeTool("export_timeline_xml", { format: "edl" }, host);
    expect((edl.data as { report: { items: { feature: string }[] } }).report.items.some((i) => i.feature === "Clip audio")).toBe(true);

    const result = await executeTool("import_timeline_xml", { xml: data.files[0].content }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result.data as { format: string }).format).toBe("otio");
    expect((result.data as { unmatched: unknown[] }).unmatched).toEqual([]);
    expect(mainClips(host)).toEqual(before);
    expect(history.getUndoStackSize()).toBe(1);
  });

  it("exports xmeml, fcpxml and edl", async () => {
    const { host } = setup();
    for (const [format, marker] of [
      ["xmeml", "<xmeml"],
      ["fcpxml", "<fcpxml"],
      ["edl", "TITLE:"],
    ] as const) {
      const result = await executeTool("export_timeline_xml", { format }, host);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const files = (result.data as { files: { content: string }[] }).files;
      expect(files[0].content).toContain(marker);
    }
    expect((await executeTool("export_timeline_xml", { format: "nope" }, host)).ok).toBe(false);
  });

  it("imports an exported timeline back as one undo step, with dry run and bad input handled", async () => {
    const { host, history } = setup();
    const exported = await executeTool("export_timeline_xml", {}, host);
    const xml = (exported.data as { files: { content: string }[] }).files[0].content;
    const before = mainClips(host);

    const dry = await executeTool("import_timeline_xml", { xml, dryRun: true }, host);
    expect(dry.ok).toBe(true);
    expect((dry.data as { applied: boolean }).applied).toBe(false);
    expect(history.getUndoStackSize()).toBe(0);

    const result = await executeTool("import_timeline_xml", { xml }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((result.data as { unmatched: unknown[] }).unmatched).toEqual([]);
    expect(mainClips(host)).toEqual(before);
    expect(history.getUndoStackSize()).toBe(1);

    await new ActionExecutor(history).undo(host.getProject());
    expect(history.getUndoStackSize()).toBe(0);

    expect((await executeTool("import_timeline_xml", { xml: "<html/>" }, host)).ok).toBe(false);
  });

  it("exports a chosen sequence (by name) while another is active, with the AAF note in the report", async () => {
    const { host } = setup();
    const ids = host.getProject().timeline.tracks.flatMap((t) => t.clips.map((c) => c.id));
    const nested = await executeTool("nest_clips", { clipIds: [ids[0]], name: "Intro" }, host);
    expect(nested.ok, JSON.stringify(nested)).toBe(true);
    const exported = await executeTool("export_timeline_xml", { format: "otio", sequence: "intro" }, host);
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    const data = exported.data as { files: { filename: string; content: string }[]; report: { notes: string[] } };
    expect(data.files[0].filename).toBe("Intro.otio");
    expect(JSON.parse(data.files[0].content).name).toBe("Intro");
    expect(data.report.notes.join(" ")).toContain("AAF is available");
    // The active sequence is untouched and still exports under the project name with the nest as a stack.
    const parent = await executeTool("export_timeline_xml", { format: "otio" }, host);
    expect(JSON.stringify(JSON.parse((parent.data as { files: { content: string }[] }).files[0].content).tracks)).toContain("Stack.1");
    const missing = await executeTool("export_timeline_xml", { format: "otio", sequence: "nope" }, host);
    expect(missing.ok).toBe(false);
  });
});

describe("EDL import via import_timeline_xml", () => {
  const EDL = [
    "TITLE: CUT",
    "FCM: NON-DROP FRAME",
    "",
    "001  INTERVIE V     C        00:00:02:00 00:00:06:00 01:00:00:00 01:00:04:00",
    "* FROM CLIP NAME: Interview.mp4",
    "002  OFFLINE1 V     C        00:00:00:00 00:00:02:00 01:00:04:00 01:00:06:00",
    "",
  ].join("\n");

  it("relinks by reel, keeps reel metadata and reports offline reels; one undo step", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("import_timeline_xml", { xml: EDL, frameRate: 30 }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const data = result.data as { format: string; matched: unknown[]; unmatched: { name: string }[] };
    expect(data.format).toBe("edl");
    expect(data.matched).toHaveLength(1);
    expect(data.unmatched.map((u) => u.name)).toEqual(["OFFLINE1"]);
    const clips = host.getProject().timeline.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(2);
    expect(clips.map((c) => c.metadata?.edl)).toEqual([
      expect.objectContaining({ reel: "INTERVIE", sourceIn: "00:00:02:00" }),
      expect.objectContaining({ reel: "OFFLINE1" }),
    ]);
    expect(history.getUndoStackSize()).toBe(before + 1);
  });
});
