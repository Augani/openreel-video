import { describe, expect, it } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const project = makeProjectWithClip() as Project;
  const item = (id: string, name: string, duration: number) => ({
    id,
    name,
    type: "video",
    blob: null,
    fileHandle: null,
    metadata: { duration, width: 1920, height: 1080, frameRate: 30, channels: 2, sampleRate: 48000 },
  });
  (project.mediaLibrary as { items: unknown[] }).items = [
    item("m1", "Interview.mp4", 20),
    item("m2", "Broll.mp4", 8),
  ];
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  return { host, history };
}
const items = (host: HeadlessHost) => host.getProject().mediaLibrary.items;
const undoDepth = (history: ActionHistory) => history.getUndoStackSize();

describe("bin agent tools", () => {
  it("registers over MCP", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    for (const name of [
      "create_bin",
      "move_to_bin",
      "set_label",
      "make_subclip",
      "list_bins",
      "delete_bin",
      "rename_bin",
    ]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("create_bin from selection, nested bin, move_to_bin and list_bins; one undo step each", async () => {
    const { host, history } = setup();
    const made = await executeTool("create_bin", { name: "Interviews", mediaIds: ["m1"] }, host);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const binId = (made.data as { binId: string }).binId;
    expect(items(host).find((m) => m.id === "m1")!.binId).toBe(binId);
    expect(undoDepth(history)).toBe(1);

    const nested = await executeTool("create_bin", { name: "Day 1", parent: "interviews" }, host);
    expect(nested.ok).toBe(true);
    const moved = await executeTool("move_to_bin", { mediaIds: ["m2"], bin: "Day 1" }, host);
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    expect(undoDepth(history)).toBe(3);
    const listed = await executeTool("list_bins", {}, host);
    const bins = (listed.data as { bins: { name: string; path: string; itemCount: number }[] }).bins;
    expect(bins.map((b) => b.path)).toEqual(["Interviews", "Interviews/Day 1"]);
    expect(bins[1].itemCount).toBe(1);

    const cyc = await executeTool("move_to_bin", { binIds: [binId], bin: "Day 1" }, host);
    expect(cyc.ok).toBe(false);
    const back = await executeTool("move_to_bin", { mediaIds: ["m2"], bin: "root" }, host);
    expect(back.ok).toBe(true);
    expect(items(host).find((m) => m.id === "m2")!.binId).toBeUndefined();
  });

  it("set_label on media and clips, rejecting unknown labels", async () => {
    const { host } = setup();
    const clipId = host.getProject().timeline.tracks.flatMap((t) => t.clips)[0].id;
    const r = await executeTool("set_label", { label: "Mango", mediaIds: ["m1"], clipIds: [clipId] }, host);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(items(host)[0].label).toBe("mango");
    expect(host.getProject().timeline.tracks.flatMap((t) => t.clips)[0].label).toBe("mango");
    const inherit = await executeTool("set_label", { label: "inherit", clipIds: [clipId] }, host);
    expect(inherit.ok).toBe(true);
    expect(host.getProject().timeline.tracks.flatMap((t) => t.clips)[0].label).toBeUndefined();
    expect((await executeTool("set_label", { label: "chartreuse", mediaIds: ["m1"] }, host)).ok).toBe(false);
  });

  it("make_subclip creates a window item as one undo step", async () => {
    const { host, history } = setup();
    const r = await executeTool(
      "make_subclip",
      { mediaId: "m1", inPoint: 2, outPoint: 6, restrictTrims: true, name: "Quote" },
      host,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const sub = items(host).find((m) => m.subclip)!;
    expect(sub.name).toBe("Quote");
    expect(sub.subclip).toMatchObject({ parentId: "m1", inPoint: 2, outPoint: 6, restrictTrims: true });
    expect(undoDepth(history)).toBe(1);
    expect((await executeTool("make_subclip", { mediaId: "m1", inPoint: 5, outPoint: 5 }, host)).ok).toBe(false);
  });

  it("delete_bin needs confirm and removes contents in one step", async () => {
    const { host, history } = setup();
    await executeTool("create_bin", { name: "Trash", mediaIds: ["m1", "m2"] }, host);
    const dry = await executeTool("delete_bin", { bin: "Trash" }, host);
    expect(dry.ok).toBe(true);
    expect((dry.data as { deleted: boolean }).deleted).toBe(false);
    expect(items(host)).toHaveLength(2);
    const done = await executeTool("delete_bin", { bin: "Trash", confirm: true }, host);
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(items(host)).toHaveLength(0);
    expect(undoDepth(history)).toBe(2);
  });

  it("log metadata, find_media and smart bins: one undo step each, live counts", async () => {
    const { host, history } = setup();
    for (const name of ["set_media_log", "find_media", "list_smart_bins", "create_smart_bin", "delete_smart_bin"])
      expect(getTool(name), name).toBeDefined();

    const logged = await executeTool("set_media_log", { mediaIds: ["m1"], scene: "12", take: "2", goodTake: true, description: "Wide, rain" }, host);
    expect(logged.ok, JSON.stringify(logged)).toBe(true);
    expect(items(host).find((m) => m.id === "m1")).toMatchObject({ scene: "12", take: "2", goodTake: true, description: "Wide, rain" });
    expect(undoDepth(history)).toBe(1);
    expect((await executeTool("set_media_log", { mediaIds: ["m1"] }, host)).ok).toBe(false);
    expect((await executeTool("set_media_log", { mediaIds: ["nope"], scene: "1" }, host)).ok).toBe(false);

    const found = await executeTool("find_media", { query: "scene:12 good:yes" }, host);
    expect((found.data as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["m1"]);
    expect(((await executeTool("find_media", { query: "rain" }, host)).data as { total: number }).total).toBe(1);

    const made = await executeTool("create_smart_bin", { name: "Good scene 12", query: "scene:12 good:yes" }, host);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(undoDepth(history)).toBe(2);
    const listed = async () => (await executeTool("list_smart_bins", {}, host)).data as { smartBins: { name: string; itemCount: number }[] };
    expect((await listed()).smartBins).toMatchObject([{ name: "Good scene 12", itemCount: 1 }]);
    await executeTool("set_media_log", { mediaIds: ["m2"], scene: "12", goodTake: true }, host);
    expect((await listed()).smartBins[0].itemCount).toBe(2);
    expect((await executeTool("create_smart_bin", { name: "X", query: "a", column: "bogus" }, host)).ok).toBe(false);

    const removed = await executeTool("delete_smart_bin", { smartBin: "good scene 12" }, host);
    expect(removed.ok).toBe(true);
    expect((await listed()).smartBins).toEqual([]);
    expect(items(host)).toHaveLength(2);
    expect((await executeTool("delete_smart_bin", { smartBin: "ghost" }, host)).ok).toBe(false);
  });
});

describe("XMP-style metadata through set_media_log / find_media", () => {
  it("sets keywords, log comment and reel as one undo step and finds them", async () => {
    const { host, history } = setup();
    const done = await executeTool("set_media_log", { mediaIds: ["m1"], keywords: ["Night", "night", "interior"], logComment: "use second half", reel: "A007" }, host);
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(items(host).find((m) => m.id === "m1")).toMatchObject({ keywords: ["Night", "interior"], logComment: "use second half", reel: "A007" });
    expect(undoDepth(history)).toBe(1);
    const byKeyword = await executeTool("find_media", { query: "keyword:interior reel:a007" }, host);
    expect((byKeyword.data as { items: { id: string; keywords: string[] }[] }).items).toMatchObject([{ id: "m1", keywords: ["Night", "interior"] }]);
    expect((await executeTool("set_media_log", { mediaIds: ["m1"], keywords: "night" }, host)).ok).toBe(false);
    expect((await executeTool("set_media_log", { mediaIds: ["m1"], keywords: [] }, host)).ok).toBe(true);
    expect(items(host).find((m) => m.id === "m1")!.keywords).toBeUndefined();
  });
});

describe("interpret_footage tool", () => {
  it("sets and clears an interpretation, one undo step each", async () => {
    const { host, history } = setup();
    expect(getTool("interpret_footage")).toBeDefined();
    const set = await executeTool("interpret_footage", { mediaIds: ["m1"], frameRate: 24, pixelAspectRatio: 1.5, fieldOrder: "upper" }, host);
    expect(set.ok, JSON.stringify(set)).toBe(true);
    expect(items(host).find((m) => m.id === "m1")!.interpretation).toEqual({ frameRate: 24, pixelAspectRatio: 1.5, fieldOrder: "upper" });
    expect(undoDepth(history)).toBe(1);
    const cleared = await executeTool("interpret_footage", { mediaIds: ["m1"], clear: true }, host);
    expect(cleared.ok).toBe(true);
    expect(items(host).find((m) => m.id === "m1")!.interpretation).toBeUndefined();
  });
  it("merges into the existing interpretation instead of replacing it", async () => {
    const { host } = setup();
    await executeTool("interpret_footage", { mediaIds: ["m1"], frameRate: 24 }, host);
    const r = await executeTool("interpret_footage", { mediaIds: ["m1"], fieldOrder: "upper" }, host);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(items(host).find((m) => m.id === "m1")!.interpretation).toEqual({ frameRate: 24, fieldOrder: "upper" });
    expect(getTool("interpret_footage")!.description).not.toMatch(/do NOT apply/);
  });
  it("sets pixel aspect, field order and deinterlace, and list_media reports the effective values", async () => {
    const { host, history } = setup();
    const r = await executeTool("interpret_footage", { mediaIds: ["m1"], pixelAspectRatio: 4 / 3, fieldOrder: "lower", deinterlace: "bob" }, host);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(undoDepth(history)).toBe(1);
    const listed = await executeTool("list_media", {}, host);
    const m1 = (listed.data as { id: string; interpretation: Record<string, unknown> }[]).find((m) => m.id === "m1")!;
    expect(m1.interpretation).toMatchObject({ fieldOrder: "lower", deinterlace: "bob", displayWidth: 2560, displayHeight: 1080, overridden: true });
    const m2 = (listed.data as { id: string; interpretation: Record<string, unknown> }[]).find((m) => m.id === "m2")!;
    expect(m2.interpretation).toMatchObject({ pixelAspectRatio: 1, fieldOrder: "progressive", overridden: false });
    expect((await executeTool("interpret_footage", { mediaIds: ["m1"], deinterlace: "weave" }, host)).ok).toBe(false);
  });
  it("sets the sequence pixel aspect through update_project_settings and rejects bad values", async () => {
    const { host } = setup();
    const ok = await executeTool("update_project_settings", { pixelAspectRatio: 0.9091, fieldOrder: "upper" }, host);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(host.getProject().settings.pixelAspectRatio).toBeCloseTo(0.9091);
    expect(host.getProject().settings.fieldOrder).toBe("upper");
    expect((await executeTool("update_project_settings", { pixelAspectRatio: 9 }, host)).ok).toBe(false);
  });
  it("rejects bad input", async () => {
    const { host } = setup();
    expect((await executeTool("interpret_footage", { mediaIds: ["m1"], frameRate: 0 }, host)).ok).toBe(false);
    expect((await executeTool("interpret_footage", { mediaIds: ["nope"], frameRate: 24 }, host)).ok).toBe(false);
    expect((await executeTool("interpret_footage", { mediaIds: ["m1"] }, host)).ok).toBe(false);
  });
});
