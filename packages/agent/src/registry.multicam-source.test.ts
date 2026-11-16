import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { listMulticamClips } from "@openreel/core/multicam/source";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const base = makeProjectWithClip() as Project;
  const media = ["camA", "camB", "camC"].map((id) => ({
    id, name: `${id}.mp4`, type: "video" as const, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
    metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "", sampleRate: 48000, channels: 2, fileSize: 1 },
  }));
  const project = { ...base, mediaLibrary: { items: media }, timeline: { ...base.timeline, tracks: [], duration: 0 } } as unknown as Project;
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo };
}

describe("multicam agent tools", () => {
  it("registers create_multicam, switch_angle and flatten_multicam over MCP", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    for (const name of ["create_multicam", "switch_angle", "flatten_multicam", "record_multicam_cuts", "list_multicam_sources"]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("creates a synced source (manual offsets), cuts, switches and flattens; each call is one undo step", async () => {
    const { host, history, undo } = setup();
    const made = await executeTool("create_multicam", { mediaIds: ["camA", "camB", "camC"], syncMethod: "manual", offsets: [0, 1.5, 0.5], name: "Take" }, host);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(history.getUndoStackSize()).toBe(1);
    expect(listMulticamClips(host.getProject())).toHaveLength(1);

    const cut = await executeTool("record_multicam_cuts", { endTime: 8, cuts: [{ time: 2, angle: 2 }, { time: 5, angle: 3 }] }, host);
    expect(cut.ok, JSON.stringify(cut)).toBe(true);
    expect(history.getUndoStackSize()).toBe(2);
    expect(listMulticamClips(host.getProject()).map((r) => r.angle.name)).toEqual(["camA", "camB", "camC", "camA"]);

    const switched = await executeTool("switch_angle", { atTime: 3, angle: "camC" }, host);
    expect(switched.ok, JSON.stringify(switched)).toBe(true);
    expect(history.getUndoStackSize()).toBe(3);
    expect(listMulticamClips(host.getProject())[1].angle.name).toBe("camC");

    const flat = await executeTool("flatten_multicam", {}, host);
    expect(flat.ok, JSON.stringify(flat)).toBe(true);
    expect(history.getUndoStackSize()).toBe(4);
    expect(listMulticamClips(host.getProject())).toHaveLength(0);
    expect(host.getProject().timeline.tracks[0].clips).toHaveLength(4);

    expect((await undo()).success).toBe(true);
    expect(listMulticamClips(host.getProject())).toHaveLength(4);
  });

  it("audio sync without a decoding host asks for offsets, and bad input is refused", async () => {
    const { host } = setup();
    const noHost = await executeTool("create_multicam", { mediaIds: ["camA", "camB"] }, host);
    expect(noHost.ok).toBe(false);
    expect(noHost.error?.code).toBe("UNSUPPORTED");
    const one = await executeTool("create_multicam", { mediaIds: ["camA"], syncMethod: "manual", offsets: [0] }, host);
    expect(one.ok).toBe(false);
    const badAngle = await executeTool("switch_angle", { atTime: 1, angle: 9 }, host);
    expect(badAngle.ok).toBe(false);
  });

  it("syncs by timecode and in points", async () => {
    const { host } = setup();
    const made = await executeTool("create_multicam", { mediaIds: ["camA", "camB"], syncMethod: "timecode", timecodes: [3600, 3602.5], place: false }, host);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const sources = (made.data as { angles: { offsetSec: number }[] }).angles;
    expect(sources.map((a) => a.offsetSec)).toEqual([0, 2.5]);
  });
});
