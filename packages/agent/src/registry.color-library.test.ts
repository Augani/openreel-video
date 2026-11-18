import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { parseCubeToLutData } from "@openreel/core/color/cube-lut";
import { lutToJson } from "@openreel/core/color/lut-json";
import type { Clip } from "@openreel/core/types/timeline";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import type { ColorLibraryBridge, ScopesBridge, ScopesState } from "./host";
import { makeProjectWithClip } from "./test-fixtures";

const CUBE = `LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

function setup() {
  const project = makeProjectWithClip();
  const base = project.timeline.tracks[0].clips[0];
  (project.timeline.tracks[0].clips as Clip[]).push({ ...base, id: "c2", startTime: 5 } as Clip);
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  return { host, history };
}

function gradeOf(host: HeadlessHost, id: string) {
  return host
    .getProject()
    .timeline.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === id)?.colorGrading;
}

describe("agent colour library tools", () => {
  it("saves a graded clip as a look and applies it to several clips as ONE undo step", async () => {
    const { host, history } = setup();
    await executeTool(
      "set_color_grading",
      { clipId: "c1", colorGrading: { temperature: 25, pipelineVersion: 2 } },
      host,
    );
    const saved = await executeTool("save_look", { clipId: "c1", name: "Warm" }, host);
    expect(saved.ok).toBe(true);
    const listed = await executeTool("list_color_library", {}, host);
    expect((listed.data as { looks: unknown[] }).looks).toHaveLength(1);

    const before = history.getUndoStackSize();
    const applied = await executeTool("apply_look", { lookId: "warm", clipIds: ["c2"] }, host);
    expect(applied.ok).toBe(true);
    expect(gradeOf(host, "c2")?.temperature).toBe(25);
    expect(history.getUndoStackSize()).toBe(before + 1);
    history.undoGroup();
    expect(history.getUndoStackSize()).toBe(before);
  });

  it("rejects a blank name, an ungraded clip and unknown looks/clips", async () => {
    const { host } = setup();
    expect((await executeTool("save_look", { clipId: "c1", name: "x" }, host)).ok).toBe(false);
    await executeTool("set_color_grading", { clipId: "c1", colorGrading: { temperature: 5 } }, host);
    expect((await executeTool("save_look", { clipId: "c1", name: "  " }, host)).ok).toBe(false);
    expect((await executeTool("apply_look", { lookId: "nope", clipIds: ["c1"] }, host)).ok).toBe(false);
    await executeTool("save_look", { clipId: "c1", name: "A" }, host);
    const missing = await executeTool("apply_look", { lookId: "A", clipIds: ["c1", "ghost"] }, host);
    expect(missing.ok).toBe(false);
  });

  it("puts a library LUT in the input slot, distinct from the creative LUT", async () => {
    const { host } = setup();
    const lut = lutToJson(parseCubeToLutData(CUBE));
    await executeTool("set_color_grading", { clipId: "c1", colorGrading: { lut, temperature: 3 } }, host);
    const saved = await executeTool("save_clip_lut_to_library", { clipId: "c1", name: "Log2Rec" }, host);
    expect(saved.ok).toBe(true);

    const applied = await executeTool(
      "apply_library_lut",
      { lutId: "Log2Rec", clipIds: ["c1", "c2"], slot: "input", intensity: 0.5 },
      host,
    );
    expect(applied.ok).toBe(true);
    expect(gradeOf(host, "c1")?.inputLut?.intensity).toBe(0.5);
    expect(gradeOf(host, "c1")?.lut?.intensity).toBe(1);
    expect(gradeOf(host, "c2")?.inputLut).toBeDefined();
    expect(gradeOf(host, "c2")?.lut).toBeUndefined();

    const removed = await executeTool("remove_clip_lut", { clipIds: ["c1"], slot: "input" }, host);
    expect(removed.ok).toBe(true);
    expect(gradeOf(host, "c1")?.inputLut).toBeUndefined();
    expect(gradeOf(host, "c1")?.lut).toBeDefined();

    const bad = await executeTool("apply_library_lut", { lutId: "Log2Rec", clipId: "c1", intensity: 3 }, host);
    expect(bad.ok).toBe(false);
    expect((await executeTool("apply_library_lut", { lutId: "Log2Rec", clipId: "c1", slot: "x" }, host)).ok).toBe(false);
  });

  it("exports a .cube through the host only, and reports a missing LUT", async () => {
    const { host } = setup();
    const lut = lutToJson(parseCubeToLutData(CUBE));
    await executeTool("set_color_grading", { clipId: "c1", colorGrading: { lut } }, host);
    const headless = await executeTool("export_lut_cube", { clipId: "c1" }, host);
    expect(headless.ok).toBe(false);
    expect(headless.error?.code).toBe("UNSUPPORTED_HOST");

    const files: Array<{ filename: string; text: string }> = [];
    const bridge: ColorLibraryBridge = {
      listLooks: async () => [],
      saveLook: async () => undefined,
      deleteLook: async () => false,
      listLuts: async () => [],
      saveLut: async () => undefined,
      deleteLut: async () => false,
      exportCube: async (filename, text) => void files.push({ filename, text }),
    };
    Object.assign(host, { colorLibrary: bridge });
    const done = await executeTool("export_lut_cube", { clipId: "c1", filename: "grade" }, host);
    expect(done.ok).toBe(true);
    expect(files[0].filename).toBe("grade.cube");
    expect(files[0].text).toContain("LUT_3D_SIZE 2");
    expect((await executeTool("export_lut_cube", { clipId: "c1", slot: "input" }, host)).ok).toBe(false);
  });

  it("opens scopes with a nit scale and false colour through the bridge", async () => {
    const { host } = setup();
    let state: ScopesState = { visible: false, kind: "waveform", scale: "ire", falseColor: false };
    const patches: unknown[] = [];
    const bridge: ScopesBridge = {
      getState: () => state,
      setVisible: (visible, kind) => {
        state = { ...state, visible, kind: kind ?? state.kind };
        return state;
      },
      setView: (patch) => {
        patches.push(patch);
        state = { ...state, ...patch };
        return state;
      },
      captureFrame: async () => null,
    };
    Object.assign(host, { scopes: bridge });
    const res = await executeTool("open_scopes", { kind: "hls", scale: "pq", falseColor: true }, host);
    expect(res.ok).toBe(true);
    expect(patches).toEqual([{ scale: "pq", falseColor: true }]);
    expect((await executeTool("open_scopes", { kind: "yc" }, host)).ok).toBe(true);
    state = { ...state, visible: false, kind: "waveform" };
    expect((await executeTool("open_scopes", { kind: "hls", scale: "nope" }, host)).ok).toBe(false);
    expect(state.visible).toBe(false);
    expect(state.kind).toBe("waveform");
    expect((await executeTool("open_scopes", { kind: "bogus" }, host)).ok).toBe(false);
  });

  it("export_lut_cube is not flagged read-only because it writes a file", async () => {
    const { listTools } = await import("./registry");
    const tool = listTools().find((t) => t.name === "export_lut_cube");
    expect(tool?.readOnly).toBe(false);
  });

  it("refuses to grade clips that are not on a video or image track", async () => {
    const { host } = setup();
    const project = host.getProject();
    const base = project.timeline.tracks[0].clips[0];
    (project.timeline.tracks as unknown as unknown[]).push({
      ...project.timeline.tracks[0],
      id: "aud",
      type: "audio",
      clips: [{ ...base, id: "aclip" }],
    });
    const res = await executeTool("apply_look", { lookId: "warm", clipIds: ["aclip"] }, host);
    expect(res.ok).toBe(false);
  });
});
