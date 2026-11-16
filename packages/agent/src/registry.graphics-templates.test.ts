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
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo };
}

const TOOLS = ["list_graphic_templates", "insert_graphic_template", "set_template_parameter", "save_graphic_template"];

interface Listed {
  templates: Array<{ id: string; name: string; category: string; parameters: Array<{ id: string; type: string }> }>;
  graphics: Array<{ id: string; startSec: number; durationSec: number; values: Record<string, unknown> }>;
}

describe("essential graphics agent tools", () => {
  it("are registered and exposed over MCP", () => {
    const mcp = new Set(toMcpTools().map((tool) => tool.name));
    for (const name of TOOLS) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("list_graphic_templates lists the built-ins with their exposed controls", async () => {
    const { host } = setup();
    const listed = await executeTool("list_graphic_templates", {}, host);
    expect(listed.ok).toBe(true);
    const data = listed.data as Listed;
    expect(data.templates.length).toBeGreaterThanOrEqual(8);
    const categories = new Set(data.templates.map((template) => template.category));
    for (const category of ["lower-third", "title", "callout", "end-card"]) expect(categories.has(category)).toBe(true);
    const lowerThird = data.templates.find((template) => template.id === "builtin-lt-classic-bar");
    expect(lowerThird?.parameters.map((parameter) => parameter.id)).toContain("name");
    const filtered = await executeTool("list_graphic_templates", { category: "title" }, host);
    expect((filtered.data as Listed).templates.every((template) => template.category === "title")).toBe(true);
  });

  it("insert_graphic_template places ONE graphic in ONE undo step; undo removes every layer", async () => {
    const { host, history, undo } = setup();
    const before = JSON.stringify([host.getProject().textClips ?? [], host.getProject().shapeClips ?? [], host.getProject().timeline.tracks.length]);
    const result = await executeTool(
      "insert_graphic_template",
      { templateId: "Classic Bar", startTime: 1, duration: 6, values: { name: "Ada Lovelace", accent: "#00aa55" } },
      host,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    const project = host.getProject();
    expect(project.graphicInstances).toHaveLength(1);
    expect(project.textClips?.find((clip) => clip.id.endsWith("__name"))?.text).toBe("Ada Lovelace");
    expect(project.shapeClips?.find((clip) => clip.id.endsWith("__accent"))?.style.fill.color).toBe("#00aa55");
    expect(project.graphicInstances?.[0]).toMatchObject({ startTime: 1, duration: 6 });
    expect((await undo()).success).toBe(true);
    const after = host.getProject();
    expect(after.graphicInstances ?? []).toHaveLength(0);
    expect(JSON.stringify([after.textClips ?? [], after.shapeClips ?? [], after.timeline.tracks.length])).toBe(before);
  });

  it("insert_graphic_template rejects unknown controls and values of the wrong type without changing the project", async () => {
    const { host, history } = setup();
    const unknown = await executeTool("insert_graphic_template", { templateId: "builtin-lt-classic-bar", values: { nope: 1 } }, host);
    expect(unknown.ok).toBe(false);
    const wrong = await executeTool("insert_graphic_template", { templateId: "builtin-lt-classic-bar", values: { accent: "banana" } }, host);
    expect(wrong.ok).toBe(false);
    const missing = await executeTool("insert_graphic_template", { templateId: "does-not-exist" }, host);
    expect(missing.ok).toBe(false);
    expect(history.getUndoStackSize()).toBe(0);
    expect(host.getProject().graphicInstances).toBeUndefined();
  });

  it("set_template_parameter edits several controls in one undo step and undo is exact", async () => {
    const { host, history, undo } = setup();
    const inserted = await executeTool("insert_graphic_template", { templateId: "builtin-lt-classic-bar", startTime: 0 }, host);
    const graphicId = (inserted.data as { id: string }).id;
    const base = JSON.stringify([host.getProject().graphicInstances, host.getProject().textClips, host.getProject().shapeClips]);
    const result = await executeTool(
      "set_template_parameter",
      { graphicId, values: { name: "Grace Hopper", showTitle: false, accent: "#112233" } },
      host,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(history.getUndoStackSize()).toBe(2);
    const project = host.getProject();
    expect(project.textClips?.some((clip) => clip.id.endsWith("__title"))).toBe(false);
    expect(project.textClips?.find((clip) => clip.id.endsWith("__name"))?.text).toBe("Grace Hopper");
    expect((await undo()).success).toBe(true);
    expect(JSON.stringify([host.getProject().graphicInstances, host.getProject().textClips, host.getProject().shapeClips])).toBe(base);
    const single = await executeTool("set_template_parameter", { graphicId, parameterId: "nameSize", value: 60 }, host);
    expect(single.ok).toBe(true);
    const bad = await executeTool("set_template_parameter", { graphicId, parameterId: "accent", value: 12 }, host);
    expect(bad.ok).toBe(false);
    const ghost = await executeTool("set_template_parameter", { graphicId: "graphic_missing", parameterId: "name", value: "x" }, host);
    expect(ghost.ok).toBe(false);
  });

  it("accepts a member clip id (what selection uses) in place of the graphic id", async () => {
    const { host } = setup();
    await executeTool("insert_graphic_template", { templateId: "builtin-lt-classic-bar" }, host);
    const memberId = (host.getProject().textClips ?? [])[0].id;
    const result = await executeTool("set_template_parameter", { graphicId: memberId, parameterId: "name", value: "Via member" }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("save_graphic_template saves current values as defaults, lists them, and re-inserts identically", async () => {
    const { host, history } = setup();
    const inserted = await executeTool(
      "insert_graphic_template",
      { templateId: "builtin-lt-classic-bar", startTime: 2, duration: 7, values: { name: "Saved Person", accent: "#ff00aa" } },
      host,
    );
    const graphicId = (inserted.data as { id: string }).id;
    const undoDepth = history.getUndoStackSize();
    const saved = await executeTool("save_graphic_template", { graphicId, name: "Agent Lower Third" }, host);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(history.getUndoStackSize(), "saving a template does not touch the project").toBe(undoDepth);
    const listed = (await executeTool("list_graphic_templates", { category: "custom" }, host)).data as Listed;
    const custom = listed.templates.find((template) => template.name === "Agent Lower Third");
    expect(custom).toBeDefined();
    const again = await executeTool("insert_graphic_template", { templateId: "Agent Lower Third", startTime: 2 }, host);
    expect(again.ok, JSON.stringify(again)).toBe(true);
    const [first, second] = host.getProject().graphicInstances ?? [];
    expect(second.duration).toBe(first.duration);
    const strip = (id: string) =>
      JSON.stringify([host.getProject().textClips, host.getProject().shapeClips].map((list) => (list ?? []).filter((clip) => clip.id.startsWith(id))))
        .replaceAll(id, "G").replaceAll(/track_[0-9a-f-]+/g, "T");
    expect(strip(second.id)).toBe(strip(first.id));
    const noName = await executeTool("save_graphic_template", { graphicId }, host);
    expect(noName.ok).toBe(false);
  });

  it("set_sequence_frame_size rescales graphics with the frame in ONE undo step, and can opt out", async () => {
    const { host, history, undo } = setup();
    await executeTool("insert_graphic_template", { templateId: "builtin-title-hero", startTime: 0 }, host);
    const fontOf = () => Math.max(...(host.getProject().textClips ?? []).map((clip) => clip.style.fontSize));
    const before = fontOf();
    const depth = history.getUndoStackSize();
    const scaled = await executeTool("set_sequence_frame_size", { width: 640, height: 360 }, host);
    expect(scaled.ok, JSON.stringify(scaled)).toBe(true);
    expect(history.getUndoStackSize() - depth).toBe(1);
    expect(host.getProject().settings).toMatchObject({ width: 640, height: 360 });
    expect(fontOf()).toBeCloseTo(before / 3, 3);
    expect((await undo()).success).toBe(true);
    expect(host.getProject().settings.width).toBe(1920);
    expect(fontOf()).toBeCloseTo(before, 6);
    const plain = await executeTool("set_sequence_frame_size", { width: 640, height: 360, scaleGraphics: false }, host);
    expect(plain.ok).toBe(true);
    expect(fontOf()).toBeCloseTo(before, 6);
    expect((await executeTool("set_sequence_frame_size", { width: 4, height: 360 }, host)).ok).toBe(false);
  });
});
