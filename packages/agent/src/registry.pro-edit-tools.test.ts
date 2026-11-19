import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { CAPABILITY_MANIFEST } from "@openreel/core/capabilities/manifest";
import { PRO_EFFECT_TYPES } from "@openreel/core/video/pro-effects";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import type {
  SceneAnalysisSummary,
  SceneDetectionBridge,
  ScopeFrame,
  ScopesBridge,
  ScopesState,
} from "./host";
import { getTool, toMcpTools } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

const FPS = 30;

type MutableClip = {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  [key: string]: unknown;
};

/** Main track "Main" with c1|c2|c3 (5s each, source 5..10 of a 20s media) and an overlay "B-roll" above it. */
function makeProject(): Project {
  const project = makeProjectWithClip();
  const base = project.timeline.tracks[0];
  const proto = structuredClone(base.clips[0]) as unknown as MutableClip;
  const clip = (id: string, startTime: number): MutableClip => ({
    ...structuredClone(proto),
    id,
    startTime,
    duration: 5,
    inPoint: 5,
    outPoint: 10,
    trackId: "t-main",
  });
  const tracks = project.timeline.tracks as unknown as Array<Record<string, unknown>>;
  tracks.length = 0;
  tracks.push(
    {
      id: "t-broll", type: "video", name: "B-roll", clips: [], transitions: [],
      locked: false, hidden: false, muted: false, solo: false,
    },
    {
      id: "t-main", type: "video", name: "Main",
      clips: [clip("c1", 0), clip("c2", 5), clip("c3", 10)], transitions: [],
      locked: false, hidden: false, muted: false, solo: false,
    },
  );
  (project.timeline as { duration: number }).duration = 15;
  (project.settings as { frameRate: number }).frameRate = FPS;
  (project.mediaLibrary as { items: unknown[] }).items = [
    {
      id: "m1", name: "Interview.mp4", type: "video", blob: null,
      metadata: { duration: 20, width: 1920, height: 1080, frameRate: FPS },
    },
    {
      id: "m2", name: "Voice.wav", type: "audio", blob: null,
      metadata: { duration: 8, width: 0, height: 0, frameRate: 0 },
    },
  ];
  return project;
}

function setup(project: Project = makeProject()) {
  const history = new ActionHistory();
  // Live-only bridges are attached per test to stand in for the browser host.
  const host = new HeadlessHost(project, { history }) as HeadlessHost & {
    sceneDetection?: SceneDetectionBridge;
    scopes?: ScopesBridge;
  };
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, history, undo, project };
}

const clipsOf = (host: HeadlessHost, trackId = "t-main") =>
  (host.getProject().timeline.tracks.find((t) => t.id === trackId)?.clips ?? [])
    .slice()
    .sort((a, b) => a.startTime - b.startTime);
const clipById = (host: HeadlessHost, id: string) =>
  host.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
const layout = (host: HeadlessHost, trackId = "t-main") =>
  clipsOf(host, trackId).map((c) => [c.id, +c.startTime.toFixed(4), +c.duration.toFixed(4)]);

describe("premiere-parity agent tools: registration", () => {
  const NAMES = [
    "roll_trim", "slide_trim", "rate_stretch", "insert_media", "overwrite_media",
    "lift_range", "extract_range", "add_edit_all_tracks", "match_frame",
    "detect_scenes", "apply_scene_cuts", "open_scopes", "close_scopes",
    "get_scope_stats", "list_pro_effects", "set_clip_mask_path",
  ];

  it("registers every tool with a valid schema and exposes it over MCP", () => {
    const mcp = new Map(toMcpTools().map((t) => [t.name, t]));
    for (const name of NAMES) {
      const tool = getTool(name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.type).toBe("object");
      expect(tool!.description.length).toBeGreaterThan(40);
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("keeps the capability manifest in sync with the registry", () => {
    const { premiere, proEffects } = CAPABILITY_MANIFEST;
    const listed = [
      ...premiere.trimTools.map((t) => t.tool),
      ...premiere.rangeEdits,
      ...premiere.sceneDetection.tools,
      ...premiere.scopes.tools,
    ];
    for (const name of listed) expect(getTool(name), name).toBeDefined();
    expect(proEffects).toHaveLength(47);
    expect(proEffects.map((e) => e.type)).toContain("halftone");
  });

  it("marks read-only tools as read-only and destructive range edits as destructive", () => {
    for (const name of ["match_frame", "detect_scenes", "get_scope_stats", "list_pro_effects"])
      expect(getTool(name)!.readOnly, name).toBe(true);
    for (const name of ["lift_range", "extract_range", "overwrite_media"])
      expect(getTool(name)!.destructive, name).toBe(true);
  });
});

describe("roll_trim / slide_trim / rate_stretch", () => {
  it("rolls the cut by seconds and by frames as one undo step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("roll_trim", { clipId: "c1", delta: 1 }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(layout(host)).toEqual([["c1", 0, 6], ["c2", 6, 4], ["c3", 10, 5]]);
    expect(clipById(host, "c1")).toMatchObject({ inPoint: 5, outPoint: 11 });
    expect(clipById(host, "c2")).toMatchObject({ inPoint: 6, outPoint: 10 });
    expect((result.data as { appliedDelta: number }).appliedDelta).toBe(1);

    const frames = await executeTool("roll_trim", { clipId: "c1", deltaFrame: -15 }, host);
    expect(frames.ok).toBe(true);
    expect(layout(host)).toEqual([["c1", 0, 5.5], ["c2", 5.5, 4.5], ["c3", 10, 5]]);

    await undo();
    expect(layout(host)).toEqual([["c1", 0, 6], ["c2", 6, 4], ["c3", 10, 5]]);
    await undo();
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
  });

  it("rolls the cut at a clip's left edge and clamps to the source handles", async () => {
    const { host } = setup();
    const result = await executeTool(
      "roll_trim", { clipId: "c2", edge: "left", delta: -100 }, host,
    );
    expect(result.ok).toBe(true);
    const data = result.data as { clamped: boolean; appliedDelta: number };
    expect(data.clamped).toBe(true);
    // c2 can only reach back through its 5s of handle; c1 keeps one frame.
    expect(data.appliedDelta).toBeLessThan(0);
    expect(data.appliedDelta).toBeGreaterThanOrEqual(-5);
    const [c1, c2] = clipsOf(host);
    expect(c1.startTime + c1.duration).toBeCloseTo(c2.startTime, 6);
    expect(c1.duration).toBeGreaterThanOrEqual(1 / FPS - 1e-6);
  });

  it("slides a clip between its neighbours without changing total duration", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("slide_trim", { clipId: "c2", delta: 1 }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(layout(host)).toEqual([["c1", 0, 6], ["c2", 6, 5], ["c3", 11, 4]]);
    expect(clipById(host, "c2")).toMatchObject({ inPoint: 5, outPoint: 10 });
  });

  it("rate-stretches the last clip into free space and reports the new speed", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool(
      "rate_stretch", { clipId: "c3", edge: "right", delta: 5 }, host,
    );
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    const c3 = clipById(host, "c3")!;
    expect(c3.duration).toBeCloseTo(10, 6);
    expect(c3.speed).toBeCloseTo(0.5, 6);
    expect((result.data as { speed: number }).speed).toBeCloseTo(0.5, 6);
    await undo();
    expect(clipById(host, "c3")).toMatchObject({ duration: 5 });
    expect(clipById(host, "c3")!.speed ?? 1).toBe(1);
  });

  it("rejects missing deltas, both units at once, unknown clips and bad edges", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    for (const [name, args] of [
      ["roll_trim", { clipId: "c1" }],
      ["roll_trim", { clipId: "c1", delta: 1, deltaFrame: 3 }],
      ["roll_trim", { clipId: "nope", delta: 1 }],
      ["roll_trim", { clipId: "c1", edge: "middle", delta: 1 }],
      ["roll_trim", { clipId: "c3", delta: 1 }], // no clip after c3
      ["slide_trim", { clipId: "c1", delta: 1 }], // no clip before c1
    ] as const) {
      const result = await executeTool(name, args, host);
      expect(result.ok, `${name} ${JSON.stringify(args)}`).toBe(false);
    }
    expect(history.getUndoStackSize()).toBe(before);
  });

  it("refuses locked tracks and reports a zero move as NO_CHANGE", async () => {
    const { host, project } = setup();
    const none = await executeTool("roll_trim", { clipId: "c1", delta: 0.001 }, host);
    expect(none.ok).toBe(false);
    expect(none.error?.code).toBe("NO_CHANGE");
    (project.timeline.tracks[1] as { locked: boolean }).locked = true;
    const locked = await executeTool("roll_trim", { clipId: "c1", delta: 1 }, host);
    expect(locked.ok).toBe(false);
  });
});

describe("insert / overwrite / lift / extract / add edit / match frame", () => {
  it("inserts on the main (V1) track, not the top overlay lane, and ripples later clips", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("insert_media", { mediaId: "m1", at: 5, sourceIn: 0, sourceOut: 2 }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    const data = result.data as { clipId: string; trackId: string; duration: number };
    expect(data.trackId).toBe("t-main");
    expect(clipsOf(host, "t-broll")).toHaveLength(0);
    expect(data.duration).toBe(2);
    expect(layout(host)).toEqual([
      ["c1", 0, 5], [data.clipId, 5, 2], ["c2", 7, 5], ["c3", 12, 5],
    ]);
    await undo();
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
  });

  it("splits a clip under the insert point and honours atFrame and an explicit trackId", async () => {
    const { host } = setup();
    const result = await executeTool(
      "insert_media", { mediaId: "m1", atFrame: 75, sourceIn: 0, sourceOut: 1, trackId: "t-broll" }, host,
    );
    expect(result.ok).toBe(true);
    expect(clipsOf(host, "t-broll")).toHaveLength(1);
    expect(clipsOf(host, "t-broll")[0].startTime).toBeCloseTo(2.5, 6);
    // Insert ripples every unlocked track: c1 (0..5) is split at 2.5 on Main.
    const main = clipsOf(host);
    expect(main.length).toBe(4);
    expect(main[0]).toMatchObject({ id: "c1" });
    expect(main[0].duration).toBeCloseTo(2.5, 6);
    expect(main[1].startTime).toBeCloseTo(3.5, 6);
  });

  it("overwrites without moving anything and refuses incompatible or unknown targets", async () => {
    const { host } = setup();
    const ok = await executeTool("overwrite_media", { mediaId: "m1", at: 4, sourceIn: 0, sourceOut: 2 }, host);
    expect(ok.ok).toBe(true);
    const main = clipsOf(host);
    expect(main.map((c) => c.id)).toContain("c3");
    expect(clipById(host, "c3")!.startTime).toBe(10);
    expect(main.find((c) => c.id === "c1")!.duration).toBeCloseTo(4, 6);
    // c2 is split at 6s: its remainder keeps its position, only 4..6 is replaced.
    const remainder = main.find((c) => Math.abs(c.startTime - 6) < 1e-6)!;
    expect(remainder.duration).toBeCloseTo(4, 6);
    expect(main.reduce((total, c) => total + c.duration, 0)).toBeCloseTo(15, 6);

    expect((await executeTool("overwrite_media", { mediaId: "missing", at: 0 }, host)).ok).toBe(false);
    expect((await executeTool("insert_media", { mediaId: "m2", at: 0, trackId: "t-main" }, host)).ok).toBe(false);
    expect((await executeTool("insert_media", { mediaId: "m1" }, host)).ok).toBe(false);
    expect((await executeTool("insert_media", { mediaId: "m2", at: 0 }, host)).ok).toBe(false); // no audio track
  });

  it("lifts a range leaving a gap and extracts one closing it, each as one undo step", async () => {
    const lift = setup();
    const liftBefore = lift.history.getUndoStackSize();
    const lifted = await executeTool("lift_range", { start: 2, end: 7 }, lift.host);
    expect(lifted.ok).toBe(true);
    expect(lift.history.getUndoStackSize()).toBe(liftBefore + 1);
    expect(layout(lift.host).map(([, s, d]) => [s, d])).toEqual([[0, 2], [7, 3], [10, 5]]);
    await lift.undo();
    expect(layout(lift.host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);

    const extract = setup();
    const extractBefore = extract.history.getUndoStackSize();
    const extracted = await executeTool("extract_range", { startFrame: 60, endFrame: 210 }, extract.host);
    expect(extracted.ok).toBe(true);
    expect(extract.history.getUndoStackSize()).toBe(extractBefore + 1);
    expect(layout(extract.host).map(([, s, d]) => [s, d])).toEqual([[0, 2], [2, 3], [5, 5]]);
    await extract.undo();
    expect(layout(extract.host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
  });

  it("restricts lift to the named tracks and rejects empty or invalid ranges", async () => {
    const { host } = setup();
    expect((await executeTool("lift_range", { start: 2, end: 7, trackIds: ["t-broll"] }, host)).ok).toBe(false);
    expect(clipsOf(host)).toHaveLength(3);
    expect((await executeTool("lift_range", { start: 7, end: 2 }, host)).ok).toBe(false);
    expect((await executeTool("lift_range", { start: 2 }, host)).ok).toBe(false);
    expect((await executeTool("extract_range", { start: 100, end: 120 }, host)).ok).toBe(false);
  });

  it("adds an edit on every unlocked track at once", async () => {
    const { host, project, history } = setup();
    // Put a clip on the overlay lane under the same time.
    const overlay = structuredClone(clipById(host, "c1")!) as unknown as MutableClip;
    overlay.id = "o1";
    overlay.trackId = "t-broll";
    (project.timeline.tracks[0].clips as unknown as MutableClip[]).push(overlay);
    const before = history.getUndoStackSize();
    const result = await executeTool("add_edit_all_tracks", { timeFrame: 60 }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(clipsOf(host, "t-main")).toHaveLength(4);
    expect(clipsOf(host, "t-broll")).toHaveLength(2);
    expect((await executeTool("add_edit_all_tracks", { time: 99 }, host)).ok).toBe(false);
  });

  it("match_frame reports the source media and timecode at a timeline time", async () => {
    const { host } = setup();
    const atTime = await executeTool("match_frame", { time: 5.5 }, host);
    expect(atTime.ok).toBe(true);
    expect(atTime.data).toMatchObject({
      clipId: "c2", mediaId: "m1", mediaName: "Interview.mp4",
      sourceTime: 5.5, sourceTimecode: "00:00:05:15", sourceFrame: 165,
    });
    const byClip = await executeTool("match_frame", { clipId: "c3" }, host);
    expect(byClip.data).toMatchObject({ clipId: "c3", sourceTime: 5, timelineTime: 10 });
    expect((await executeTool("match_frame", { time: 99 }, host)).ok).toBe(false);
    expect((await executeTool("match_frame", { clipId: "zzz" }, host)).ok).toBe(false);
  });
});

describe("scene detection tools", () => {
  class FakeScenes implements SceneDetectionBridge {
    calls: unknown[] = [];
    async analyse(input: { clipId: string; sensitivity: number; minSceneLength: number }): Promise<SceneAnalysisSummary> {
      this.calls.push(["analyse", input]);
      return {
        analysisId: "a1",
        clipId: input.clipId,
        cuts: [{ sourceTime: 7, timelineTime: 2, score: 0.8 }],
      };
    }
    async apply(input: { analysisId: string; splitClip: boolean; addMarkers: boolean }) {
      this.calls.push(["apply", input]);
      return { splits: input.splitClip ? 1 : 0, markers: input.addMarkers ? 1 : 0, droppedCuts: 0, skippedLockedLinked: 0 };
    }
  }

  it("fails clearly where frame decoding is unavailable", async () => {
    const { host } = setup();
    const result = await executeTool("detect_scenes", { clipId: "c1" }, host);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED");
    expect((await executeTool("apply_scene_cuts", { analysisId: "a1" }, host)).error?.code).toBe("UNSUPPORTED");
  });

  it("analyses with sensitivity then applies splits and markers", async () => {
    const { host } = setup();
    const scenes = new FakeScenes();
    host.sceneDetection = scenes;
    const detected = await executeTool("detect_scenes", { clipId: "c1", sensitivity: 0.8, minSceneLength: 2 }, host);
    expect(detected.ok).toBe(true);
    expect(scenes.calls[0]).toEqual(["analyse", { clipId: "c1", sensitivity: 0.8, minSceneLength: 2 }]);
    expect((detected.data as SceneAnalysisSummary).cuts[0].timelineTime).toBe(2);

    const defaults = await executeTool("detect_scenes", { clipId: "c1" }, host);
    expect(defaults.ok).toBe(true);
    expect(scenes.calls[1]).toEqual(["analyse", { clipId: "c1", sensitivity: 0.5, minSceneLength: 1 }]);

    const applied = await executeTool("apply_scene_cuts", { analysisId: "a1", splitClip: true, addMarkers: true }, host);
    expect(applied.ok).toBe(true);
    expect(applied.data).toMatchObject({ splits: 1, markers: 1 });
    expect(scenes.calls[2]).toEqual(["apply", { analysisId: "a1", splitClip: true, addMarkers: true }]);
    // Splitting is the default when nothing is chosen.
    await executeTool("apply_scene_cuts", { analysisId: "a1" }, host);
    expect(scenes.calls[3]).toEqual(["apply", { analysisId: "a1", splitClip: true, addMarkers: false }]);
  });

  it("validates sensitivity, minSceneLength, the clip and the apply flags", async () => {
    const { host } = setup();
    host.sceneDetection = new FakeScenes();
    for (const args of [
      { clipId: "c1", sensitivity: 1.5 },
      { clipId: "c1", sensitivity: -1 },
      { clipId: "c1", minSceneLength: -1 },
      { clipId: "missing" },
    ])
      expect((await executeTool("detect_scenes", args, host)).ok, JSON.stringify(args)).toBe(false);
    expect((await executeTool("apply_scene_cuts", { analysisId: "a1", splitClip: false, addMarkers: false }, host)).ok).toBe(false);
    expect((await executeTool("apply_scene_cuts", { analysisId: "" }, host)).ok).toBe(false);
    expect((await executeTool("apply_scene_cuts", { analysisId: "a1", splitClip: "yes" }, host)).ok).toBe(false);
  });
});

describe("scopes tools", () => {
  function solid(width: number, height: number, rgb: [number, number, number], a = 255): ScopeFrame {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([...rgb, a], i * 4);
    return { data, width, height };
  }
  function split(width: number, height: number): ScopeFrame {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        data.set(x < width / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * width + x) * 4);
    return { data, width, height };
  }

  class FakeScopes implements ScopesBridge {
    visible = false;
    kind: ScopesState["kind"] = "waveform";
    frame: ScopeFrame | null = split(64, 36);
    seeks: Array<number | undefined> = [];
    getState(): ScopesState { return { visible: this.visible, kind: this.kind }; }
    setVisible(visible: boolean, kind?: ScopesState["kind"]): ScopesState {
      this.visible = visible;
      if (kind) this.kind = kind;
      return this.getState();
    }
    async captureFrame(options?: { timeSec?: number }) {
      this.seeks.push(options?.timeSec);
      return this.frame;
    }
  }

  it("opens and closes the panel and rejects an unknown kind", async () => {
    const { host } = setup();
    const scopes = new FakeScopes();
    host.scopes = scopes;
    const open = await executeTool("open_scopes", { kind: "parade" }, host);
    expect(open.ok).toBe(true);
    expect(open.data).toEqual({ visible: true, kind: "parade" });
    expect(scopes.visible).toBe(true);
    const close = await executeTool("close_scopes", {}, host);
    expect(close.data).toEqual({ visible: false, kind: "parade" });
    expect((await executeTool("open_scopes", { kind: "bogus" }, host)).ok).toBe(false);
  });

  it("reads luma range, clipping and averages from the program frame", async () => {
    const { host } = setup();
    const scopes = new FakeScopes();
    host.scopes = scopes;
    const result = await executeTool("get_scope_stats", {}, host);
    expect(result.ok).toBe(true);
    const { stats } = result.data as { stats: import("@openreel/core/video/scope-stats").ScopeStats };
    expect(stats.luma.min).toBe(0);
    expect(stats.luma.max).toBe(100);
    expect(stats.luma.average).toBeCloseTo(50, 0);
    expect(stats.luma.blackClipPct).toBeCloseTo(50, 0);
    expect(stats.luma.whiteClipPct).toBeCloseTo(50, 0);
    expect(stats.dominantHue).toBeNull();
    expect(stats.warnings.join(" ")).toMatch(/clipped/i);
    expect(stats.warnings.join(" ")).toMatch(/crushed/i);
    expect(scopes.seeks).toEqual([undefined]);
  });

  it("seeks when a time is given and reports the dominant hue of a colour frame", async () => {
    const { host } = setup();
    const scopes = new FakeScopes();
    scopes.frame = solid(32, 18, [200, 40, 40]);
    host.scopes = scopes;
    const result = await executeTool("get_scope_stats", { timeFrame: 90 }, host);
    expect(result.ok).toBe(true);
    expect(scopes.seeks).toEqual([3]);
    const { stats } = result.data as { stats: import("@openreel/core/video/scope-stats").ScopeStats };
    expect(stats.dominantHue?.name).toBe("red");
    expect(stats.dominantHue!.degrees).toBeLessThan(10);
    expect(stats.saturation.average).toBeGreaterThan(70);
    expect(stats.luma.blackClipPct).toBe(0);
  });

  it("fails clearly without scopes, without a frame, and on a transparent frame", async () => {
    const { host } = setup();
    expect((await executeTool("get_scope_stats", {}, host)).error?.code).toBe("UNSUPPORTED");
    expect((await executeTool("open_scopes", {}, host)).error?.code).toBe("UNSUPPORTED");
    const scopes = new FakeScopes();
    host.scopes = scopes;
    scopes.frame = null;
    expect((await executeTool("get_scope_stats", {}, host)).error?.code).toBe("NOT_READY");
    scopes.frame = solid(8, 8, [10, 10, 10], 0);
    expect((await executeTool("get_scope_stats", {}, host)).error?.code).toBe("EMPTY_FRAME");
  });
});

describe("pro effects through add_video_effect", () => {
  it("lists all 47 pro effects with ranges, defaults and neutral values", async () => {
    const { host } = setup();
    const all = await executeTool("list_pro_effects", {}, host);
    expect(all.ok).toBe(true);
    const list = all.data as Array<{ type: string; params: Array<{ key: string; default: unknown; neutral: unknown }> }>;
    expect(list.map((e) => e.type).sort()).toEqual([...PRO_EFFECT_TYPES].sort());
    expect(list).toHaveLength(47);
    for (const effect of list) {
      expect(effect.params.length).toBeGreaterThan(0);
      for (const p of effect.params) expect(p).toHaveProperty("neutral");
    }
    const one = await executeTool("list_pro_effects", { effectType: "mosaic" }, host);
    expect((one.data as unknown[]).length).toBe(1);
    expect((await executeTool("list_pro_effects", { effectType: "nope" }, host)).ok).toBe(false);
  });

  it("seeds defaults so a bare add is not a neutral no-op, and validates ranges", async () => {
    const { host } = setup();
    const bare = await executeTool("add_video_effect", { clipId: "c1", effectType: "mosaic" }, host);
    expect(bare.ok).toBe(true);
    const mosaic = clipById(host, "c1")!.effects.find((e) => e.type === "mosaic")!;
    const { PRO_EFFECT_DEFAULTS } = await import("@openreel/core/video/pro-effects");
    expect(mosaic.params).toMatchObject(PRO_EFFECT_DEFAULTS.mosaic);

    const custom = await executeTool(
      "add_video_effect", { clipId: "c1", effectType: "posterize", params: { levels: 4 } }, host,
    );
    expect(custom.ok).toBe(true);
    expect(clipById(host, "c1")!.effects.find((e) => e.type === "posterize")!.params).toMatchObject({ levels: 4 });

    const count = clipById(host, "c1")!.effects.length;
    for (const [effectType, params] of [
      ["mosaic", { notAParam: 1 }],
      ["posterize", { levels: 9999 }],
      ["posterize", { levels: "many" }],
      ["mirror", { mode: "diagonal" }],
    ] as const) {
      const bad = await executeTool("add_video_effect", { clipId: "c1", effectType, params }, host);
      expect(bad.ok, `${effectType} ${JSON.stringify(params)}`).toBe(false);
      expect(bad.error?.code).toBe("INVALID_PARAMS");
    }
    expect(clipById(host, "c1")!.effects).toHaveLength(count);
  });
});

describe("review additions", () => {
  it("update_video_effect range-checks pro effect params and still updates valid ones", async () => {
    const { host } = setup();
    await executeTool("add_video_effect", { clipId: "c1", effectType: "posterize", params: { levels: 4 } }, host);
    const effect = clipById(host, "c1")!.effects.find((e) => e.type === "posterize")!;
    const bad = await executeTool("update_video_effect", { clipId: "c1", effectId: effect.id, params: { levels: 9999 } }, host);
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
    expect(clipById(host, "c1")!.effects.find((e) => e.id === effect.id)!.params).toMatchObject({ levels: 4 });
    const good = await executeTool("update_video_effect", { clipId: "c1", effectId: effect.id, params: { levels: 6 } }, host);
    expect(good.ok).toBe(true);
    expect(clipById(host, "c1")!.effects.find((e) => e.id === effect.id)!.params).toMatchObject({ levels: 6 });
  });

  it("insert_media refuses (without editing) when the main track is locked instead of using the overlay lane", async () => {
    const { host, project, history } = setup();
    (project.timeline.tracks[1] as { locked: boolean }).locked = true;
    const before = history.getUndoStackSize();
    const result = await executeTool("insert_media", { mediaId: "m1", at: 5, sourceIn: 0, sourceOut: 2 }, host);
    expect(result.ok).toBe(false);
    expect(history.getUndoStackSize()).toBe(before);
    expect(clipsOf(host, "t-broll")).toHaveLength(0);
  });

  it("lift_range leaves locked tracks untouched", async () => {
    const { host, project } = setup();
    (project.timeline.tracks[1] as { locked: boolean }).locked = true;
    const result = await executeTool("lift_range", { start: 2, end: 7 }, host);
    expect(result.ok).toBe(false);
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
  });

  it("match_frame clamps an out-of-clip time to the clip and reports the clamped timeline time", async () => {
    const { host } = setup();
    const result = await executeTool("match_frame", { clipId: "c1", time: 50 }, host);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ timelineTime: 5, sourceTime: 10 });
  });
});


describe("live-host parity: linked clips and match-frame selection", () => {
  function withAudioTwin() {
    const project = makeProject();
    const tracks = project.timeline.tracks as unknown as Array<Record<string, unknown>>;
    const c3 = structuredClone(
      (tracks[1].clips as MutableClip[]).find((c) => c.id === "c3")!,
    ) as MutableClip;
    tracks.push({
      id: "t-audio", type: "audio", name: "A1",
      clips: [{ ...c3, id: "a3", trackId: "t-audio" }], transitions: [],
      locked: false, hidden: false, muted: false, solo: false,
    });
    return setup(project);
  }

  it("rate_stretch derives linked clip ids from the host when none are given", async () => {
    const { host } = withAudioTwin();
    const seen: string[][] = [];
    (host as unknown as { resolveLinkedClipIds: unknown }).resolveLinkedClipIds = (
      _project: Project,
      ids: readonly string[],
    ) => {
      seen.push([...ids]);
      return [...ids, "a3"];
    };
    const result = await executeTool("rate_stretch", { clipId: "c3", edge: "right", delta: 5 }, host);
    expect(result.ok).toBe(true);
    expect(seen).toEqual([["c3"]]);
    expect(clipById(host, "a3")!.duration).toBeCloseTo(10, 6);
    expect(clipById(host, "c3")!.duration).toBeCloseTo(10, 6);
  });

  it("an explicit linkedClipIds list overrides the host's derivation", async () => {
    const { host } = withAudioTwin();
    let called = false;
    (host as unknown as { resolveLinkedClipIds: unknown }).resolveLinkedClipIds = () => {
      called = true;
      return ["c3", "a3"];
    };
    const result = await executeTool(
      "rate_stretch", { clipId: "c3", edge: "right", delta: 5, linkedClipIds: [] }, host,
    );
    expect(result.ok).toBe(true);
    expect(called).toBe(false);
    expect(clipById(host, "a3")!.duration).toBeCloseTo(5, 6);
  });

  it("roll_trim also resolves links through the host", async () => {
    const { host } = setup();
    const seen: string[][] = [];
    (host as unknown as { resolveLinkedClipIds: unknown }).resolveLinkedClipIds = (
      _project: Project,
      ids: readonly string[],
    ) => {
      seen.push([...ids]);
      return [...ids];
    };
    expect((await executeTool("roll_trim", { clipId: "c1", delta: 1 }, host)).ok).toBe(true);
    expect(seen).toEqual([["c1"]]);
  });

  it("match_frame selects the source media in the library", async () => {
    const { host } = setup();
    const selected: string[] = [];
    (host as unknown as { selectLibraryMedia: unknown }).selectLibraryMedia = (id: string) => {
      selected.push(id);
    };
    const result = await executeTool("match_frame", { clipId: "c2" }, host);
    expect(result.ok).toBe(true);
    expect(selected).toEqual(["m1"]);
  });
});

describe("source monitor agent tools", () => {
  it("insert_from_source uses the host's source marks, fits three-point ranges, one undo step", async () => {
    const { host, history, undo } = setup();
    const marks: Record<string, { in?: number; out?: number }> = { m1: { in: 3, out: 5 } };
    (host as unknown as { sourceMonitor: unknown }).sourceMonitor = {
      open: () => undefined,
      getMarks: (id: string) => marks[id] ?? {},
      setMarks: (id: string, m: { in?: number | null; out?: number | null }) => {
        const cur = { ...(marks[id] ?? {}) } as Record<string, number | undefined>;
        for (const k of ["in", "out"] as const) {
          if (m[k] === null) delete cur[k];
          else if (typeof m[k] === "number") cur[k] = m[k] as number;
        }
        marks[id] = cur;
      },
    };
    const before = history.getUndoStackSize();
    const result = await executeTool("insert_from_source", { mediaId: "m1", at: 5 }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    const data = result.data as { clipId: string; rule: string };
    expect(data.rule).toBe("source-range-at-playhead");
    expect(layout(host)).toEqual([["c1", 0, 5], [data.clipId, 5, 2], ["c2", 7, 5], ["c3", 12, 5]]);
    await undo();
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);

    // Source In only + sequence range fits the Out.
    expect((await executeTool("set_source_in_out", { mediaId: "m1", in: 4, out: null }, host)).ok).toBe(true);
    const fit = await executeTool(
      "overwrite_from_source",
      { mediaId: "m1", sequenceIn: 1, sequenceOut: 3, trackId: "t-broll" },
      host,
    );
    expect(fit.ok).toBe(true);
    expect(fit.data).toMatchObject({ rule: "fit-source-in", startTime: 1, duration: 2, sourceIn: 4, sourceOut: 6 });
  });

  it("open_in_source_monitor / set_source_in_out need the live editor", async () => {
    const { host } = setup();
    expect((await executeTool("open_in_source_monitor", { mediaId: "m1" }, host)).ok).toBe(false);
    expect((await executeTool("set_source_in_out", { mediaId: "m1", in: 1 }, host)).ok).toBe(false);
    const r = await executeTool("overwrite_from_source", { mediaId: "m1", sourceIn: 0, sourceOut: 1, at: 0 }, host);
    expect(r.ok).toBe(true);
  });

  it("refuses a track that cannot hold the stream (audio on a video track, video-only on audio)", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    const audioOnVideo = await executeTool(
      "overwrite_from_source", { mediaId: "m2", sourceIn: 0, sourceOut: 1, at: 0, trackId: "t-broll" }, host,
    );
    expect(audioOnVideo.ok).toBe(false);
    const videoAudioOnVideo = await executeTool(
      "overwrite_from_source", { mediaId: "m1", sourceIn: 0, sourceOut: 1, at: 0, trackId: "t-broll", component: "audio" }, host,
    );
    expect(videoAudioOnVideo.ok).toBe(false);
    expect(history.getUndoStackSize()).toBe(before);
    expect(clipsOf(host, "t-broll")).toHaveLength(0);
  });
});

/** The c1|c2|c3 video track plus a linked audio track a1|a2|a3 (same source windows). */
function makeLinkedProject(): Project {
  const project = makeProject();
  const tracks = project.timeline.tracks as unknown as Array<{ clips: MutableClip[] } & Record<string, unknown>>;
  const main = tracks.find((t) => t.id === "t-main")!;
  tracks.push({
    id: "t-audio", type: "audio", name: "Audio", transitions: [],
    locked: false, hidden: false, muted: false, solo: false,
    clips: main.clips.map((c) => ({
      ...structuredClone(c),
      id: c.id.replace("c", "a"),
      trackId: "t-audio",
      metadata: { separatedFromClipId: c.id },
    })),
  });
  return project;
}

describe("make_split_edit / extend_edit", () => {
  it("registers both tools and lists them in the capability manifest", () => {
    for (const name of ["make_split_edit", "extend_edit"]) {
      expect(getTool(name), name).toBeDefined();
      expect(CAPABILITY_MANIFEST.premiere.rangeEdits).toContain(name);
    }
  });

  it("makes an L-cut of 12 frames as one undo step, picture cut unchanged", async () => {
    const { host, history, undo } = setup(makeLinkedProject());
    const before = history.getUndoStackSize();
    const result = await executeTool("make_split_edit", { clipId: "c1", kind: "l" }, host);
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
    expect(layout(host, "t-audio")).toEqual([["a1", 0, 5.4], ["a2", 5.4, 4.6], ["a3", 10, 5]]);
    expect(clipById(host, "a2")).toMatchObject({ inPoint: 5.4, outPoint: 10 });
    const data = result.data as { moves: Array<{ appliedFrames: number; limit: string | null }> };
    expect(data.moves[0]).toMatchObject({ appliedFrames: 12, limit: null });

    // Repeating is a no-op (the offset is measured from the picture cut).
    const again = await executeTool("make_split_edit", { clipId: "a1", kind: "l" }, host);
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("NO_CHANGE");

    await undo();
    expect(layout(host, "t-audio")).toEqual([["a1", 0, 5], ["a2", 5, 5], ["a3", 10, 5]]);
  });

  it("makes a J-cut from the next clip's left edge and reports handle limits", async () => {
    const { host } = setup(makeLinkedProject());
    const result = await executeTool("make_split_edit", { clipId: "c2", edge: "left", kind: "j", frames: 6 }, host);
    expect(result.ok).toBe(true);
    expect(layout(host, "t-audio")).toEqual([["a1", 0, 4.8], ["a2", 4.8, 5.2], ["a3", 10, 5]]);
    // Ask for far more than the 20s source can give.
    const limited = await executeTool("make_split_edit", { clipId: "a2", edge: "right", kind: "l", frames: 600 }, host);
    expect(limited.ok).toBe(true);
    const moves = (limited.data as { moves: Array<{ limit: string | null }> }).moves;
    expect(moves[0].limit).not.toBeNull();
  });

  it("explains a missing link and rejects bad arguments", async () => {
    const { host } = setup();
    const unlinked = await executeTool("make_split_edit", { clipId: "c1", kind: "l" }, host);
    expect(unlinked.ok).toBe(false);
    expect(unlinked.summary).toMatch(/linked video and audio/);
    expect((await executeTool("make_split_edit", { clipId: "c1", kind: "x" }, host)).ok).toBe(false);
    expect((await executeTool("make_split_edit", { clipId: "zzz", kind: "l" }, host)).ok).toBe(false);
  });

  it("extend_edit rolls a side-only cut to a time and undoes in one step", async () => {
    const { host, history, undo } = setup(makeLinkedProject());
    const before = history.getUndoStackSize();
    const result = await executeTool(
      "extend_edit", { clipId: "c1", edge: "right", timeFrame: 156, side: "audio" }, host,
    );
    expect(result.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
    expect(layout(host, "t-audio")).toEqual([["a1", 0, 5.2], ["a2", 5.2, 4.8], ["a3", 10, 5]]);
    await undo();
    expect(layout(host, "t-audio")).toEqual([["a1", 0, 5], ["a2", 5, 5], ["a3", 10, 5]]);

    const both = await executeTool("extend_edit", { clipId: "c1", time: 6 }, host);
    expect(both.ok).toBe(true);
    expect(layout(host)).toEqual([["c1", 0, 6], ["c2", 6, 4], ["c3", 10, 5]]);
    expect(layout(host, "t-audio")).toEqual([["a1", 0, 6], ["a2", 6, 4], ["a3", 10, 5]]);
  });

  it("extend_edit reports no-ops and locked tracks", async () => {
    const { host } = setup(makeLinkedProject());
    const same = await executeTool("extend_edit", { clipId: "c1", time: 5 }, host);
    expect(same.error?.code).toBe("NO_CHANGE");
    (host.getProject().timeline.tracks.find((t) => t.id === "t-audio") as { locked: boolean }).locked = true;
    const locked = await executeTool("extend_edit", { clipId: "c1", time: 6, side: "audio" }, host);
    expect(locked.ok).toBe(false);
    expect((await executeTool("extend_edit", { time: 6 }, host)).ok).toBe(false);
  });
});

describe("set_clip_mask_path", () => {
  const tri = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2, handleOut: { x: 0.9, y: 0.3 }, handleIn: { x: 0.7, y: 0.1 } },
    { x: 0.5, y: 0.8 },
  ];

  it("adds a drawn mask, keyframes it and undoes each call in one step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const added = await executeTool("set_clip_mask_path", { clipId: "c1", points: tri, feathering: 4 }, host);
    expect(added.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    const maskId = (added.data as { maskId: string }).maskId;
    const mask = () => host.getProject().masks?.find((m) => m.id === maskId);
    expect(mask()).toMatchObject({ clipId: "c1", type: "drawn", feathering: 4, inverted: false });
    expect(mask()!.path.points).toHaveLength(3);
    expect(mask()!.path.points[1].handleOut).toEqual({ x: 0.9, y: 0.3 });

    const moved = tri.map((p) => ({ ...p, x: p.x + 0.1 }));
    const key = await executeTool("set_clip_mask_path", { clipId: "c1", maskId, points: moved, timeSeconds: 2 }, host);
    expect(key.ok).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 2);
    expect(mask()!.keyframes.map((k) => k.time)).toEqual([2]);

    await undo();
    expect(mask()!.keyframes).toHaveLength(0);
    await undo();
    expect(mask()).toBeUndefined();
  });

  it("rejects bad input without touching history", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    for (const args of [
      { clipId: "nope", points: tri },
      { clipId: "c1", points: tri.slice(0, 2) },
      { clipId: "c1", points: [...tri.slice(0, 2), { x: "a", y: 1 }] },
      { clipId: "c1", points: tri, opacity: 2 },
      { clipId: "c1" },
      { clipId: "c1", points: tri, timeSeconds: 1 },
      { clipId: "c1", maskId: "missing", points: tri },
    ]) {
      expect((await executeTool("set_clip_mask_path", args, host)).ok, JSON.stringify(args)).toBe(false);
    }
    const added = await executeTool("set_clip_mask_path", { clipId: "c1", points: tri }, host);
    const maskId = (added.data as { maskId: string }).maskId;
    const wrongCount = await executeTool(
      "set_clip_mask_path",
      { clipId: "c1", maskId, points: [...tri, { x: 0.5, y: 0.5 }], timeSeconds: 1 },
      host,
    );
    expect(wrongCount.ok).toBe(false);
    expect(history.getUndoStackSize()).toBe(before + 1);
  });
});

describe("trim_edit_point / delete_gap", () => {
  it("is registered and exposed over MCP", () => {
    const mcp = new Map(toMcpTools().map((t) => [t.name, t]));
    for (const name of ["trim_edit_point", "delete_gap"]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
  });

  it("rolls a cut by frames (default at a cut) as one undo step", async () => {
    const { host, history, undo } = setup();
    const before = history.getUndoStackSize();
    const result = await executeTool("trim_edit_point", { clipId: "c1", edge: "right", frames: 15 }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(before + 1);
    expect(layout(host)).toEqual([["c1", 0, 5.5], ["c2", 5.5, 4.5], ["c3", 10, 5]]);
    expect(result.data).toMatchObject({ kind: "roll", appliedFrames: 15 });
    await undo();
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
  });

  it("ripples a free edge and honours an explicit ripple on a cut", async () => {
    const { host } = setup();
    const free = await executeTool("trim_edit_point", { clipId: "c3", edge: "right", frames: -30 }, host);
    expect(free.ok, free.summary).toBe(true);
    expect(free.data).toMatchObject({ kind: "ripple", appliedFrames: -30 });
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 4]]);
    const cut = await executeTool(
      "trim_edit_point", { clipId: "c1", edge: "right", frames: -30, kind: "ripple" }, host,
    );
    expect(cut.ok, cut.summary).toBe(true);
    expect(layout(host)).toEqual([["c1", 0, 4], ["c2", 4, 5], ["c3", 9, 4]]);
  });

  it("validates its arguments and never changes anything on failure", async () => {
    const { host, history } = setup();
    const before = history.getUndoStackSize();
    for (const args of [
      { clipId: "nope", edge: "right", frames: 1 },
      { clipId: "c1", frames: 1 },
      { clipId: "c1", edge: "middle", frames: 1 },
      { clipId: "c1", edge: "right", frames: 1.5 },
      { clipId: "c1", edge: "right", frames: 1, kind: "slip" },
    ])
      expect((await executeTool("trim_edit_point", args, host)).ok, JSON.stringify(args)).toBe(false);
    expect(history.getUndoStackSize()).toBe(before);
  });

  it("deletes a gap by time, rippling later clips, and rejects times that are not in a gap", async () => {
    const { host, history, undo } = setup();
    await host.applyAction({
      type: "clip/move", id: "mv", timestamp: 0,
      params: { clipId: "c3", startTime: 12, trackId: "t-main" },
    });
    const before = layout(host);
    expect(before[2]).toEqual(["c3", 12, 5]);
    expect((await executeTool("delete_gap", { trackId: "t-main", time: 3 }, host)).ok).toBe(false);
    const stack = history.getUndoStackSize();
    const result = await executeTool("delete_gap", { trackId: "t-main", time: 11 }, host);
    expect(result.ok, result.summary).toBe(true);
    expect(history.getUndoStackSize()).toBe(stack + 1);
    expect(layout(host)).toEqual([["c1", 0, 5], ["c2", 5, 5], ["c3", 10, 5]]);
    await undo();
    expect(layout(host)).toEqual(before);
  });
});
