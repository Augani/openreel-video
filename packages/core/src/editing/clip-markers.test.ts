import { describe, expect, it } from "vitest";
import type { Clip, Marker } from "../types/timeline";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import { buildProject } from "../interchange/__fixtures__/project";
import { exportTimeline, importTimeline } from "../interchange";
import {
  flattenClipMarkers,
  resolveClipMarkers,
  sourceTimeForTimelineMarker,
  sourceToTimelineTime,
  timelineToSourceTime,
} from "./clip-markers";
import { clipSourceTimeAt } from "./premiere-edits";

const mk = (id: string, time: number, extra: Partial<Marker> = {}): Marker => ({ id, time, label: id, color: "#f00", ...extra });

const clip = (over: Partial<Clip>): Clip =>
  ({
    id: "c",
    mediaId: "m",
    trackId: "t",
    startTime: 10,
    duration: 5,
    inPoint: 20,
    outPoint: 25,
    effects: [],
    audioEffects: [],
    keyframes: [],
    volume: 1,
    ...over,
  }) as unknown as Clip;

describe("source <-> timeline marker offset mapping", () => {
  it("maps with the in-point at normal speed", () => {
    const c = clip({});
    expect(sourceToTimelineTime(c, 22)).toBeCloseTo(12);
    expect(timelineToSourceTime(c, 12)).toBeCloseTo(22);
  });

  it("scales by speed (2x: 4 source seconds take 2 timeline seconds)", () => {
    const c = clip({ speed: 2, duration: 2.5, inPoint: 20, outPoint: 25 });
    expect(sourceToTimelineTime(c, 24)).toBeCloseTo(10 + 4 / 2);
    expect(timelineToSourceTime(c, 12)).toBeCloseTo(24);
  });

  it("slow motion stretches (0.5x)", () => {
    const c = clip({ speed: 0.5, duration: 10 });
    expect(sourceToTimelineTime(c, 21)).toBeCloseTo(10 + 1 / 0.5);
  });

  it("reverse plays the out point first", () => {
    const c = clip({ reversed: true });
    expect(sourceToTimelineTime(c, 25)).toBeCloseTo(10);
    expect(sourceToTimelineTime(c, 20)).toBeCloseTo(15);
    expect(sourceToTimelineTime(c, 23)).toBeCloseTo(12);
  });

  it("reverse and speed together", () => {
    const c = clip({ reversed: true, speed: 2, duration: 2.5 });
    expect(sourceToTimelineTime(c, 23)).toBeCloseTo(10 + 2 / 2);
    expect(timelineToSourceTime(c, 11)).toBeCloseTo(23);
  });

  it("agrees with the playback engine's source time (speed, reverse, both)", () => {
    for (const over of [{}, { speed: 2, duration: 2.5 }, { reversed: true }, { reversed: true, speed: 0.5, duration: 10 }]) {
      const c = clip(over);
      for (const f of [0, 0.3, 0.5, 0.9]) {
        const t = c.startTime + c.duration * f;
        expect(timelineToSourceTime(c, t)).toBeCloseTo(clipSourceTimeAt(c, t), 6);
      }
    }
  });
});

describe("resolveClipMarkers", () => {
  it("hides markers outside the trimmed range and merges master with clip markers", () => {
    const c = clip({ markers: [mk("own", 24)] });
    const out = resolveClipMarkers(c, { markers: [mk("m-in", 21), mk("m-before", 5), mk("m-after", 40)] });
    expect(out.map((r) => [r.marker.id, r.scope])).toEqual([
      ["m-in", "master"],
      ["own", "clip"],
    ]);
    expect(out.map((r) => r.timelineTime)).toEqual([11, 14]);
  });

  it("clips a range marker to the in/out range and scales its length by speed", () => {
    const c = clip({ speed: 2, duration: 2.5 });
    const [r] = resolveClipMarkers(c, { markers: [mk("r", 18, { duration: 6 })] });
    // visible source 20..24 -> 2 timeline seconds starting at the clip start
    expect(r.timelineTime).toBeCloseTo(10);
    expect(r.timelineDuration).toBeCloseTo(2);
  });

  it("puts a reversed range marker at its earliest timeline time", () => {
    const c = clip({ reversed: true });
    const [r] = resolveClipMarkers(c, { markers: [mk("r", 21, { duration: 2 })] });
    expect(r.timelineTime).toBeCloseTo(12); // source 23 plays at 12, source 21 at 14
    expect(r.timelineDuration).toBeCloseTo(2);
  });

  it("shows a master marker on every instance at its own offset", () => {
    const media = { markers: [mk("shared", 22)] };
    const a = clip({ id: "a", startTime: 0 });
    const b = clip({ id: "b", startTime: 100, speed: 2, duration: 2.5 });
    const flat = flattenClipMarkers([a, b], () => media);
    expect(flat.map((r) => [r.clipId, r.timelineTime])).toEqual([
      ["a", 2],
      ["b", 101],
    ]);
  });

  it("places a timeline marker at the right source time, null off the clip", () => {
    const c = clip({ speed: 2, duration: 2.5 });
    expect(sourceTimeForTimelineMarker(c, 11)).toBeCloseTo(22);
    expect(sourceTimeForTimelineMarker(c, 50)).toBeNull();
  });
});

const act = (type: string, params: Record<string, unknown>): Action =>
  ({ id: `a${Math.random()}`, type, timestamp: Date.now(), params }) as unknown as Action;

describe("clipmarker/set action", () => {
  it("sets, undoes and redoes clip markers and master markers", async () => {
    const project = buildProject(30) as Project;
    const ex = new ActionExecutor();
    const clipId = project.timeline.tracks[0].clips[0].id;
    const mediaId = project.timeline.tracks[0].clips[0].mediaId;

    expect((await ex.execute(act("clipmarker/set", { clipId, markers: [mk("x", 2)] }), project)).success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].markers).toHaveLength(1);
    expect((await ex.execute(act("clipmarker/set", { mediaId, markers: [mk("y", 3)] }), project)).success).toBe(true);
    expect(project.mediaLibrary.items.find((i) => i.id === mediaId)?.markers).toHaveLength(1);

    await ex.undo(project);
    expect(project.mediaLibrary.items.find((i) => i.id === mediaId)?.markers).toBeUndefined();
    await ex.undo(project);
    expect(project.timeline.tracks[0].clips[0].markers ?? []).toHaveLength(0);
    await ex.redo(project);
    expect(project.timeline.tracks[0].clips[0].markers?.[0].id).toBe("x");
  });

  it("rejects missing targets and bad markers", async () => {
    const project = buildProject(30) as Project;
    const ex = new ActionExecutor();
    expect((await ex.execute(act("clipmarker/set", { clipId: "nope", markers: [] }), project)).success).toBe(false);
    expect((await ex.execute(act("clipmarker/set", { markers: [] }), project)).success).toBe(false);
    const clipId = project.timeline.tracks[0].clips[0].id;
    expect((await ex.execute(act("clipmarker/set", { clipId, markers: [{ id: "q", time: -1, label: "", color: "" }] }), project)).success).toBe(false);
  });
});

const mainTrack = (p: Project) => p.timeline.tracks.find((t) => t.id === "t-main")!;

describe("XMEML clip markers", () => {
  it("writes clip and master markers in the clipitem and reads them back in source time", () => {
    const project = buildProject(30) as Project;
    const first = mainTrack(project).clips[0]; // A: source 1s..3s
    const mediaId = first.mediaId;
    (project.mediaLibrary as { items: unknown }).items = project.mediaLibrary.items.map((i) =>
      i.id === mediaId ? { ...i, markers: [mk("master", 2, { comment: "from source" })] } : i,
    );
    (mainTrack(project) as { clips: unknown }).clips = mainTrack(project).clips.map((c) =>
      c.id === first.id ? { ...c, markers: [mk("own", 1.5, { duration: 1 })] } : c,
    );
    const text = exportTimeline(project, "xmeml").files[0].content;
    expect(text).toContain("<name>master</name>");
    expect(text).toContain("<name>own</name>");

    let n = 0;
    const imported = importTimeline(text, { mediaItems: project.mediaLibrary.items, makeId: () => `i${++n}` });
    const clips = imported.tracks.flatMap((t) => t.clips).filter((c) => c.markers?.length);
    const labels = clips.flatMap((c) => (c.markers ?? []).map((m) => [m.label, Math.round(m.time * 100) / 100, m.duration ? Math.round(m.duration * 100) / 100 : 0]));
    expect(labels).toContainEqual(["master", 2, 0]);
    expect(labels).toContainEqual(["own", 1.5, 1]);
  });

  it("omits markers outside the clip's range and honours includeMarkers:false", () => {
    const project = buildProject(30) as Project;
    const first = mainTrack(project).clips[0];
    (mainTrack(project) as { clips: unknown }).clips = mainTrack(project).clips.map((c) =>
      c.id === first.id ? { ...c, markers: [mk("outside", 500)] } : c,
    );
    expect(exportTimeline(project, "xmeml").files[0].content).not.toContain("<name>outside</name>");
    const withIn = mainTrack(project).clips.map((c) => (c.id === first.id ? { ...c, markers: [mk("inside", 1.2)] } : c));
    (mainTrack(project) as { clips: unknown }).clips = withIn;
    expect(exportTimeline(project, "xmeml", { includeMarkers: false }).files[0].content).not.toContain("<name>inside</name>");
  });
});
