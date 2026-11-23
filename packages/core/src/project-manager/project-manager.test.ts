import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { multicamClipSourceTime } from "../multicam/fixed-audio";
import {
  DEFAULT_PROJECT_MANAGER_OPTIONS,
  type DiskInfo,
  type ItemResult,
  type ProjectManagerOptions,
  applyPlan,
  buildSegments,
  capSegmentCount,
  collectMediaUsage,
  estimateItemBytes,
  estimatePlan,
  exactFrameRate,
  mapRange,
  mapSourceTime,
  mergeRanges,
  planProjectManager,
  resolvePreset,
  segmentsDuration,
  snapRangeToFrames,
  videoBytesPerSecond,
  withHandles,
} from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, mediaId: string, inPoint: number, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId, trackId, startTime, duration, inPoint, outPoint: inPoint + duration * Math.abs(extra.speed ?? 1),
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[]): Track => ({
  id, type, name: id, mode: "standard", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const item = (id: string, duration: number, extra: Record<string, unknown> = {}) => ({
  id, name: `${id} name`, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: false,
  metadata: { duration, width: 1280, height: 720, frameRate: 24, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1000 },
  sourceFile: { name: `${id}.mp4`, size: 1000, lastModified: 1, path: `/src/${id}.mp4` },
  ...extra,
});

/** A (used twice with a gap), B (2x speed), C (unused), D (reversed + ramp). */
function project(): Project {
  const v1 = track("v1", "video", [
    clip("a1", "v1", 0, 2, "A", 10),
    clip("a2", "v1", 2, 2, "A", 30),
    clip("b1", "v1", 4, 3, "B", 20, { speed: 2 }),
    clip("d1", "v1", 7, 2, "D", 5, { reversed: true, speedKeyframes: [{ id: "k1", time: 0, speed: 1, easing: "linear" }, { id: "k2", time: 2, speed: 2, easing: "linear" }] }),
  ]);
  return {
    id: "p", name: "P", createdAt: 1, modifiedAt: 1,
    settings: { width: 1280, height: 720, frameRate: 24, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [item("A", 60), item("B", 60), item("C", 60), item("D", 60)] } as unknown as Project["mediaLibrary"],
    timeline: { tracks: [v1, track("a1t", "audio", [])], subtitles: [], duration: 9, markers: [] },
  } as unknown as Project;
}

const disk = (): Record<string, DiskInfo> =>
  Object.fromEntries(["A", "B", "C", "D"].map((id) => [id, { exists: true, size: 1_000_000, width: 1280, height: 720, fps: 24, duration: 60, hasVideo: true, hasAudio: true, videoCodec: "h264", audioChannels: 2, sampleRate: 48000 }]));

const opts = (extra: Partial<ProjectManagerOptions> = {}): ProjectManagerOptions => ({
  ...DEFAULT_PROJECT_MANAGER_OPTIONS,
  sequenceIds: ["seq_main"],
  mode: "consolidate",
  trim: true,
  handleFrames: 12,
  preset: "prores-422",
  ...extra,
});

describe("range maths", () => {
  it("merges overlapping and touching ranges and drops empty ones", () => {
    expect(mergeRanges([{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 9, end: 9 }, { start: 7, end: 8 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
    ]);
  });
  it("joins ranges closer than the gap but not farther ones", () => {
    expect(mergeRanges([{ start: 0, end: 1 }, { start: 1.5, end: 2 }, { start: 5, end: 6 }], 1)).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 6 },
    ]);
  });
  it("adds handles clamped to the file", () => {
    expect(withHandles({ start: 0.2, end: 9.9 }, 0.5, 10)).toEqual({ start: 0, end: 10 });
    expect(withHandles({ start: 3, end: 4 }, 0.5, 10)).toEqual({ start: 2.5, end: 4.5 });
  });
  it("snaps a range outward to whole frames", () => {
    const r = snapRangeToFrames({ start: 1.01, end: 2.01 }, 24, 60);
    expect(r.start * 24).toBeCloseTo(24, 9);
    expect(r.end * 24).toBeCloseTo(49, 9);
    // a range already on the grid does not grow
    expect(snapRangeToFrames({ start: 1, end: 2 }, 24, 60)).toEqual({ start: 1, end: 2 });
  });
  it("recognises NTSC rates", () => {
    expect(exactFrameRate(29.97)).toBeCloseTo(30000 / 1001, 9);
    expect(exactFrameRate(23.976)).toBeCloseTo(24000 / 1001, 9);
    expect(exactFrameRate(25)).toBe(25);
    expect(exactFrameRate(0)).toBe(0);
  });
  it("caps the segment count by merging the closest neighbours", () => {
    const ranges = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 3.5, end: 4 }, { start: 10, end: 11 }];
    expect(capSegmentCount(ranges, 3)).toEqual([{ start: 0, end: 1 }, { start: 2, end: 4 }, { start: 10, end: 11 }]);
    expect(capSegmentCount(ranges, 1)).toEqual([{ start: 0, end: 11 }]);
  });
  it("lays segments end to end and maps times and ranges", () => {
    const segs = buildSegments([{ start: 10, end: 14 }, { start: 30, end: 33 }]);
    expect(segs.map((s) => s.outStart)).toEqual([0, 4]);
    expect(segmentsDuration(segs)).toBe(7);
    expect(mapSourceTime(segs, 12)).toBe(2);
    expect(mapSourceTime(segs, 31)).toBe(5);
    expect(mapSourceTime(segs, 20)).toBeNull();
    expect(mapRange(segs, 30.5, 32)).toEqual({ start: 4.5, end: 6 });
    expect(mapRange(segs, 13, 31)).toBeNull(); // straddles the cut
  });
  it("keeps mapped times exactly on the frame grid", () => {
    const fps = 30000 / 1001;
    const segs = buildSegments([{ start: 100 / fps, end: 160 / fps }, { start: 400 / fps, end: 460 / fps }]);
    const t = mapSourceTime(segs, 410 / fps, fps)!;
    expect(Math.floor(t * fps)).toBe(70);
    expect(t * fps).toBe(70);
  });
});

describe("used ranges", () => {
  it("collects every clip's source range per file and leaves unused media out", () => {
    const { usage, usedItemIds } = collectMediaUsage(project(), ["seq_main"]);
    expect(usage.get("A")?.ranges).toEqual([{ start: 10, end: 12 }, { start: 30, end: 32 }]);
    expect(usage.get("B")?.ranges).toEqual([{ start: 20, end: 26 }]);
    expect(usage.has("C")).toBe(false);
    expect(usedItemIds.has("C")).toBe(false);
  });

  it("plans trimmed segments with handles, in frames, and does not merge a gap larger than the merge gap", () => {
    const plan = planProjectManager(project(), opts({ handleFrames: 12 }), disk());
    const a = plan.items.find((i) => i.mediaId === "A")!;
    expect(a.segments).toHaveLength(2);
    // 12 frames at 24 fps = 0.5 s each side
    expect(a.segments![0].srcStart).toBeCloseTo(9.5, 9);
    expect(a.segments![0].srcEnd).toBeCloseTo(12.5, 9);
    expect(a.segments![1].srcStart).toBeCloseTo(29.5, 9);
    expect(a.segments![1].outStart).toBeCloseTo(3, 9);
    expect(a.keptSeconds).toBeCloseTo(6, 9);
    expect(plan.droppedMediaIds).toEqual(["C"]);
  });

  it("merges ranges whose handles overlap into one segment", () => {
    const p = project();
    p.timeline.tracks[0].clips[1] = clip("a2", "v1", 2, 2, "A", 12.5);
    const plan = planProjectManager(p, opts({ handleFrames: 12 }), disk());
    const a = plan.items.find((i) => i.mediaId === "A")!;
    expect(a.segments).toHaveLength(1);
    expect(a.segments![0].srcStart).toBeCloseTo(9.5, 9);
    expect(a.segments![0].srcEnd).toBeCloseTo(15, 9);
  });

  it("keeps the whole file when trim is off, and copies it in collect mode", () => {
    const plan = planProjectManager(project(), opts({ trim: false }), disk());
    expect(plan.items.every((i) => i.segments === null)).toBe(true);
    const collect = planProjectManager(project(), opts({ mode: "collect" }), disk());
    expect(collect.items.every((i) => i.action === "copy")).toBe(true);
  });

  it("match source without trimming is a plain copy, a preset is a transcode", () => {
    const same = planProjectManager(project(), opts({ trim: false, preset: "match-source" }), disk());
    expect(same.items.every((i) => i.action === "copy")).toBe(true);
    const prores = planProjectManager(project(), opts({ trim: false, preset: "prores-422-hq" }), disk());
    expect(prores.items.every((i) => i.action === "transcode" && i.preset === "prores-422-hq")).toBe(true);
    expect(resolvePreset("match-source", "prores")).toBe("prores-422-hq");
    expect(resolvePreset("match-source", "dnxhd")).toBe("dnxhr-hq");
    expect(resolvePreset("match-source", "hevc")).toBe("h264");
  });

  it("keeps unused media (whole) when exclude-unused is off", () => {
    const plan = planProjectManager(project(), opts({ excludeUnused: false }), disk());
    const c = plan.items.find((i) => i.mediaId === "C")!;
    expect(c.segments).toBeNull();
    expect(plan.droppedMediaIds).toEqual([]);
  });

  it("names files after the media when asked and keeps names unique", () => {
    const p = project();
    (p.mediaLibrary.items as unknown as Array<{ name: string }>)[0].name = "Interview";
    (p.mediaLibrary.items as unknown as Array<{ name: string }>)[1].name = "interview";
    const plan = planProjectManager(p, opts({ renameToClipNames: true, trim: false }), disk());
    expect(plan.items.find((i) => i.mediaId === "A")!.outRel).toBe("Media/Interview.mov");
    expect(plan.items.find((i) => i.mediaId === "B")!.outRel).toBe("Media/interview_2.mov");
  });

  it("leaves offline media out of the run with a warning", () => {
    const d = disk();
    d.B = { exists: false };
    const plan = planProjectManager(project(), opts(), d);
    expect(plan.items.find((i) => i.mediaId === "B")!.action).toBe("offline");
    expect(plan.warnings.join(" ")).toMatch(/offline/);
  });

  it("a multicam angle keeps one stretch covering the shared window of the other angle's clips", () => {
    const p = project();
    (p as { multicamSources?: unknown }).multicamSources = [
      { id: "mc", name: "MC", syncMethod: "manual", audio: { mode: "follow" }, createdAt: 1, angles: [
        { id: "a", name: "A", mediaId: "A", offset: 0, duration: 60, color: "#f00" },
        { id: "c", name: "C", mediaId: "C", offset: 5, duration: 60, color: "#0f0" },
      ] },
    ];
    p.timeline.tracks[0].clips[0] = clip("a1", "v1", 0, 2, "A", 10, { metadata: { multicam: { sourceId: "mc", angleId: "a" } } });
    const plan = planProjectManager(p, opts({ handleFrames: 0 }), disk());
    const c = plan.items.find((i) => i.mediaId === "C")!;
    // shared 10..12 on angle C (offset 5) is C's own time 5..7
    expect(c.segments).toHaveLength(1);
    expect(c.segments![0].srcStart).toBeCloseTo(5, 9);
    expect(c.segments![0].srcEnd).toBeCloseTo(7, 9);
    expect(plan.droppedMediaIds).not.toContain("C");
    const a = plan.items.find((i) => i.mediaId === "A")!;
    expect(a.segments).toHaveLength(1); // single stretch for a multicam angle
  });
});

function fakeResults(plan: ReturnType<typeof planProjectManager>): Record<string, ItemResult> {
  return Object.fromEntries(
    plan.items
      .filter((i) => i.action !== "offline")
      .map((i) => [i.mediaId, { outPath: `/out/${i.outRel}`, size: 5, duration: i.keptSeconds, width: 1280, height: 720, frameRate: 24, codec: i.preset?.startsWith("prores") ? "prores" : "h264" }]),
  );
}

describe("in/out rewrite", () => {
  it("shows the same source frame at every timeline time after the rewrite, across speed, reverse and ramps", () => {
    const original = project();
    const plan = planProjectManager(original, opts({ handleFrames: 6 }), disk());
    const rewritten = applyPlan(original, plan, fakeResults(plan), { projectId: "new", now: 5 });
    const before = original.timeline.tracks[0].clips;
    const after = rewritten.timeline.tracks[0].clips;
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      const planned = plan.items.find((p) => p.mediaId === before[i].mediaId)!;
      expect(after[i].startTime).toBe(before[i].startTime);
      expect(after[i].duration).toBe(before[i].duration);
      expect(after[i].speed).toBe(before[i].speed);
      for (let k = 0; k <= 8; k++) {
        const t = before[i].startTime + (before[i].duration * k) / 8;
        const src = multicamClipSourceTime(before[i], t);
        const mapped = mapSourceTime(planned.segments!, src, planned.fps);
        expect(mapped, `${before[i].id} at ${t}`).not.toBeNull();
        expect(multicamClipSourceTime(after[i], t)).toBeCloseTo(mapped!, 6);
      }
    }
    // the frame number is preserved on the grid
    expect(Math.round(after[0].inPoint * 24)).toBe(Math.round((10 - plan.items[0].segments![0].srcStart) * 24));
  });

  it("points items at the new files, drops unused media and keeps the used ones' fields", () => {
    const original = project();
    const plan = planProjectManager(original, opts(), disk());
    const out = applyPlan(original, plan, fakeResults(plan), { projectId: "new", now: 5, projectName: "P copy" });
    expect(out.id).toBe("new");
    expect(out.name).toBe("P copy");
    const ids = out.mediaLibrary.items.map((m) => m.id);
    expect(ids).toEqual(["A", "B", "D"]);
    const a = out.mediaLibrary.items[0];
    expect(a.sourceFile?.path).toBe("/out/Media/A.mov");
    expect(a.metadata.duration).toBeCloseTo(plan.items[0].keptSeconds, 9);
    expect((a as { nativeSource?: { codec: string } }).nativeSource?.codec).toBe("prores");
    expect(out.sequences?.[0].timeline).toBe(out.timeline);
  });

  it("shifts master and clip markers through the segment map and drops those in a cut", () => {
    const original = project();
    (original.mediaLibrary.items[0] as unknown as { markers: unknown }).markers = [{ id: "in", time: 11, label: "x", color: "#fff" }, { id: "out", time: 20, label: "y", color: "#fff" }];
    const plan = planProjectManager(original, opts({ handleFrames: 0 }), disk());
    const out = applyPlan(original, plan, fakeResults(plan), { projectId: "new", now: 5 });
    const markers = (out.mediaLibrary.items[0] as unknown as { markers: Array<{ id: string; time: number }> }).markers;
    expect(markers.map((m) => m.id)).toEqual(["in"]);
    expect(markers[0].time).toBeCloseTo(1, 9);
  });

  it("keeps a multicam clip's shared time by moving the angle offset with the trim", () => {
    const original = project();
    (original as { multicamSources?: unknown }).multicamSources = [
      { id: "mc", name: "MC", syncMethod: "manual", audio: { mode: "follow" }, createdAt: 1, angles: [
        { id: "a", name: "A", mediaId: "A", offset: 2, duration: 60, color: "#f00" },
        { id: "c", name: "C", mediaId: "C", offset: 5, duration: 60, color: "#0f0" },
      ] },
    ];
    original.timeline.tracks[0].clips[0] = clip("a1", "v1", 0, 2, "A", 10, { metadata: { multicam: { sourceId: "mc", angleId: "a" } } });
    original.timeline.tracks[0].clips.splice(1, 1); // only the multicam clip uses A
    const plan = planProjectManager(original, opts({ handleFrames: 0 }), disk());
    const out = applyPlan(original, plan, fakeResults(plan), { projectId: "new", now: 5 });
    const mc = (out as { multicamSources?: Array<{ angles: Array<{ id: string; offset: number; duration: number }> }> }).multicamSources![0];
    const aSeg = plan.items.find((i) => i.mediaId === "A")!.segments![0];
    const newClip = out.timeline.tracks[0].clips[0];
    const angleA = mc.angles.find((a) => a.id === "a")!;
    // shared time at the clip start: before 10 + 2, after the new in point + the new offset
    expect(newClip.inPoint + angleA.offset).toBeCloseTo(12, 9);
    expect(aSeg.outStart).toBe(0);
    const angleC = mc.angles.find((a) => a.id === "c")!;
    const cSeg = plan.items.find((i) => i.mediaId === "C")!.segments![0];
    // angle C at shared 12 is C's own time 7; after the trim that is 7 - srcStart, plus the new offset
    expect(7 - cSeg.srcStart + angleC.offset).toBeCloseTo(12, 9);
  });

  it("keeps only the chosen sequences and the ones they nest", () => {
    const original = project();
    const withSeqs = { ...original, activeSequenceId: undefined } as Project;
    const plan = planProjectManager(withSeqs, opts(), disk());
    expect(plan.sequenceIds).toEqual(["seq_main"]);
    expect(() => planProjectManager(withSeqs, opts({ sequenceIds: ["nope"] }), disk())).toThrow(/at least one sequence/);
  });
});

describe("disk space estimate", () => {
  it("copies count the file size", () => {
    const plan = planProjectManager(project(), opts({ mode: "collect" }), disk());
    expect(estimatePlan(plan).mediaBytes).toBe(3 * 1_000_000);
  });
  it("transcodes count the picture at the preset rate plus PCM audio for the kept seconds", () => {
    const plan = planProjectManager(project(), opts({ preset: "dnxhr-hq" }), disk());
    const a = plan.items.find((i) => i.mediaId === "A")!;
    const expected = videoBytesPerSecond("dnxhr-hq", 1280, 720, 24) * a.keptSeconds + 2 * 48000 * 2 * a.keptSeconds;
    expect(estimateItemBytes(a)).toBeCloseTo(expected, 3);
    expect(estimatePlan(plan).totalBytes).toBeGreaterThan(0);
  });
  it("a trimmed copy is estimated smaller than an untrimmed one", () => {
    const trimmed = estimatePlan(planProjectManager(project(), opts({ trim: true }), disk())).totalBytes;
    const whole = estimatePlan(planProjectManager(project(), opts({ trim: false }), disk())).totalBytes;
    expect(trimmed).toBeLessThan(whole / 4);
  });
  it("counts proxies and render files only when included, and no render files for a trimmed copy", () => {
    const d = disk();
    d.A = { ...d.A, proxySize: 400 };
    const p = project();
    (p.mediaLibrary.items[0] as unknown as { proxy: unknown }).proxy = { storage: "path", path: "/src/A_proxy.mov", codec: "prores", width: 1, height: 1, frameRate: 24, duration: 60, fileSize: 400, status: "ready", source: "generated", createdAt: 1 };
    const withProxy = planProjectManager(p, opts({ mode: "collect", includeProxies: true }), d);
    expect(estimatePlan(withProxy).proxyBytes).toBe(400);
    expect(estimatePlan(planProjectManager(p, opts({ mode: "collect", includeProxies: false }), d)).proxyBytes).toBe(0);
    const render = planProjectManager(p, opts({ mode: "collect", includeRenderFiles: true }), d);
    expect(estimatePlan(render, 1234).renderBytes).toBe(1234);
    const trimmed = planProjectManager(p, opts({ trim: true, includeRenderFiles: true }), d);
    expect(estimatePlan(trimmed, 1234).renderBytes).toBe(0);
    expect(trimmed.warnings.join(" ")).toMatch(/Render files/);
  });
});
