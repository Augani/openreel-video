import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { serializeEditorState } from "./serialize";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const project = makeProjectWithClip() as Project;
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo };
}
const clipIds = (host: HeadlessHost) => host.getProject().timeline.tracks.flatMap((t) => t.clips.map((c) => c.id));

describe("sequence agent tools", () => {
  it("registers over MCP", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    for (const name of ["list_sequences", "create_sequence", "open_sequence", "nest_clips"]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("lists the implicit main sequence of a pre-sequence project", async () => {
    const { host } = setup();
    const listed = await executeTool("list_sequences", {}, host);
    expect(listed.ok).toBe(true);
    const data = listed.data as { sequences: { name: string; active: boolean; clipCount: number }[] };
    expect(data.sequences).toHaveLength(1);
    expect(data.sequences[0]).toMatchObject({ name: "Sequence 1", active: true });
    expect(data.sequences[0].clipCount).toBeGreaterThan(0);
  });

  it("create_sequence opens a new empty sequence in one undo step; undo returns to the original", async () => {
    const { host, history, undo } = setup();
    const original = clipIds(host);
    const made = await executeTool("create_sequence", { name: "Vertical", width: 1080, height: 1920 }, host);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    expect(host.getProject().settings).toMatchObject({ width: 1080, height: 1920 });
    expect(clipIds(host)).toEqual([]);
    expect(serializeEditorState(host.getProject()).sequences).toMatchObject({ count: 2, activeSequenceName: "Vertical" });
    expect((await undo()).success).toBe(true);
    expect(clipIds(host)).toEqual(original);
    expect(host.getProject().settings.width).toBe(1920);
  });

  it("nest_clips, open_sequence (by clipId) and back by name; each is one undo step", async () => {
    const { host, history, undo } = setup();
    const ids = clipIds(host);
    const nested = await executeTool("nest_clips", { clipIds: [ids[0]], name: "Intro" }, host);
    expect(nested.ok, JSON.stringify(nested)).toBe(true);
    const nestClipId = (nested.data as { nestClipId: string }).nestClipId;
    expect(clipIds(host)).toEqual([nestClipId]);
    expect(history.getUndoStackSize()).toBe(1);

    const opened = await executeTool("open_sequence", { clipId: nestClipId }, host);
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    expect(clipIds(host)).toEqual([ids[0]]);
    expect(history.getUndoStackSize()).toBe(2);

    const back = await executeTool("open_sequence", { sequence: "sequence 1" }, host);
    expect(back.ok).toBe(true);
    expect(clipIds(host)).toEqual([nestClipId]);
    const again = await executeTool("open_sequence", { sequence: "Sequence 1" }, host);
    expect(again.summary).toMatch(/already the active/);
    const missing = await executeTool("open_sequence", { sequence: "nope" }, host);
    expect(missing.ok).toBe(false);

    // Undo walks back across the switches: first to inside the nest, then to the pre-open view.
    expect((await undo()).success).toBe(true);
    expect(clipIds(host)).toEqual([ids[0]]);
    expect((await undo()).success).toBe(true);
    expect(clipIds(host)).toEqual([nestClipId]);
    expect((await undo()).success).toBe(true);
    expect(clipIds(host)).toEqual(ids);
  });

  it("nest_clips reports refusals without changing history", async () => {
    const { host, history } = setup();
    const empty = await executeTool("nest_clips", { clipIds: [] }, host);
    expect(empty.ok).toBe(false);
    expect(history.getUndoStackSize()).toBe(0);
  });

  it("goes through the host's sequence command bridge when there is one (In/Out and playhead parking like the UI)", async () => {
    const { host } = setup();
    const labels: string[] = [];
    const bridged = Object.assign(host, {
      sequenceCommands: {
        commit: async (label: string, build: (p: Project) => import("@openreel/core/timeline/sequences").SequenceEditResult) => {
          labels.push(label);
          const result = build(host.getProject());
          if (!result.ok) return result;
          await host.applyAction({
            type: "project/applyEditSnapshot", id: "bridge", timestamp: 1,
            params: { snapshot: (await import("@openreel/core/actions/handlers/edit-snapshot")).editSnapshot(result.project) },
          });
          return result;
        },
      },
    });
    const ids = clipIds(host);
    const nested = await executeTool("nest_clips", { clipIds: [ids[0]], name: "Intro" }, bridged);
    expect(nested.ok, JSON.stringify(nested)).toBe(true);
    const opened = await executeTool("open_sequence", { sequence: "Intro" }, bridged);
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    expect(labels).toEqual(["Nest clips", "Open sequence"]);
  });
});
