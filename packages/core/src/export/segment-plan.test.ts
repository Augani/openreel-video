import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import type { VideoExportSettings } from "./types";
import { chooseSegmentWorkers, decideSegments, exportTimelineDuration, planSegments, segmentExportBlocker, segmentInputsFor, validateSegments } from "./segment-plan";

const settings = (patch: Partial<VideoExportSettings> = {}): VideoExportSettings =>
  ({
    width: 1920,
    height: 1080,
    frameRate: 30,
    format: "mp4",
    codec: "h264",
    bitrate: 8000,
    quality: 80,
    keyframeInterval: 60,
    audioSettings: { format: "aac", sampleRate: 48000, bitrate: 192, channels: 2 },
    smartRender: false,
    ...patch,
  }) as VideoExportSettings;

const clip = (id: string, startTime: number, duration: number, effects: Array<{ type: string; enabled?: boolean }> = []) => ({
  id,
  startTime,
  duration,
  effects: effects.map((effect, i) => ({ id: `${id}-fx${i}`, type: effect.type, enabled: effect.enabled ?? true, params: {} })),
});

const projectOf = (clips: ReturnType<typeof clip>[], duration: number): Project =>
  ({ timeline: { duration, tracks: [{ id: "v1", clips }] } }) as unknown as Project;

describe("planSegments", () => {
  it("covers every frame exactly once, with no gap, overlap or empty segment", () => {
    for (const total of [1000, 1801, 2400, 9999]) {
      const plan = planSegments({ totalFrames: total, cutFrames: [], targetSegmentFrames: 180 });
      expect(plan.segments.length).toBeGreaterThan(1);
      expect(validateSegments(plan.segments, total)).toBeNull();
      expect(plan.segments[0].startFrame).toBe(0);
      expect(plan.segments.at(-1)!.endFrame).toBe(total);
    }
  });

  it("cuts at the clip edge nearest the ideal boundary", () => {
    const plan = planSegments({ totalFrames: 1000, cutFrames: [170, 365, 540, 905], targetSegmentFrames: 180 });
    const starts = plan.segments.map((segment) => segment.startFrame);
    expect(starts).toContain(170);
    expect(starts).toContain(365);
    expect(starts).toContain(540);
  });

  it("is a function of the project alone: the same input gives the same boundaries", () => {
    const input = { totalFrames: 3600, cutFrames: [100, 400, 777, 1500], targetSegmentFrames: 180 };
    expect(planSegments(input)).toEqual(planSegments({ ...input }));
  });

  it("never puts a boundary inside a span that renders from the frames before it", () => {
    const plan = planSegments({
      totalFrames: 1200,
      cutFrames: [],
      forbiddenSpans: [{ startFrame: 100, endFrame: 700, reason: "feedback" }],
      targetSegmentFrames: 180,
    });
    for (const segment of plan.segments.slice(1)) {
      expect(segment.startFrame > 100 && segment.startFrame < 700).toBe(false);
    }
    expect(validateSegments(plan.segments, 1200)).toBeNull();
  });

  it("stays one segment when a single span covers the whole export", () => {
    const plan = planSegments({
      totalFrames: 1200,
      cutFrames: [],
      forbiddenSpans: [{ startFrame: 0, endFrame: 1200, reason: "feedback" }],
      targetSegmentFrames: 180,
    });
    expect(plan.segments).toHaveLength(1);
    expect(plan.reasons.length).toBeGreaterThan(0);
  });

  it("does not split a short export", () => {
    expect(planSegments({ totalFrames: 200, cutFrames: [], targetSegmentFrames: 180 }).segments).toHaveLength(1);
  });

  it("never leaves a trailing sliver shorter than the minimum", () => {
    const plan = planSegments({ totalFrames: 1810, cutFrames: [], targetSegmentFrames: 180, minSegmentFrames: 90 });
    for (const segment of plan.segments) expect(segment.endFrame - segment.startFrame).toBeGreaterThanOrEqual(90);
  });
});

describe("decideSegments", () => {
  const clips = [clip("a", 0, 18), clip("b", 18, 18), clip("c", 36, 18), clip("d", 54, 18)];

  it("splits a long H.264 export at clip edges", () => {
    const decision = decideSegments(projectOf(clips, 72), settings());
    expect(decision.parallel).toBe(true);
    expect(validateSegments(decision.segments, 2160)).toBeNull();
    const starts = decision.segments.map((segment) => segment.startFrame);
    expect(starts).toEqual(expect.arrayContaining([540, 1080, 1620]));
  });

  it("falls back to serial when a feedback effect spans the whole timeline", () => {
    const decision = decideSegments(projectOf([clip("a", 0, 60, [{ type: "video-feedback" }])], 60), settings());
    expect(decision.parallel).toBe(false);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it("ignores a disabled history effect", () => {
    const decision = decideSegments(projectOf([clip("a", 0, 60, [{ type: "video-feedback", enabled: false }])], 60), settings());
    expect(decision.parallel).toBe(true);
  });

  it("splits a range export relative to the range start", () => {
    const decision = decideSegments(projectOf(clips, 72), settings({ range: { startTime: 10, endTime: 50 } }));
    expect(decision.parallel).toBe(true);
    expect(validateSegments(decision.segments, 1200)).toBeNull();
    // The clip edges at 18 s and 36 s are frames 240 and 780 of the range.
    expect(decision.segments.map((segment) => segment.startFrame)).toEqual(expect.arrayContaining([240, 780]));
  });

  it("does not split a short export", () => {
    expect(decideSegments(projectOf([clip("a", 0, 8)], 8), settings()).parallel).toBe(false);
  });

  it.each([
    ["vp9", { codec: "vp9" }],
    ["ProRes 4444", { codec: "prores", proresProfile: "4444" }],
    ["two-pass", { rateControl: "vbr2" }],
    ["10-bit", { colorDepth: 10 }],
    ["webm", { format: "webm" }],
    ["mkv", { format: "mkv" }],
    ["off", { parallelSegments: "off" }],
    ["already a segment", { segmentWindow: { startFrame: 0, endFrame: 10, role: "video" } }],
    ["smart render on ProRes", { codec: "prores", smartRender: undefined }],
    ["smart render smallest", { encodeMode: "smallest", smartRender: undefined }],
  ])("refuses %s", (_name, patch) => {
    expect(segmentExportBlocker(settings(patch as Partial<VideoExportSettings>))).not.toBeNull();
  });

  it("allows ProRes 422 with smart render off", () => {
    expect(segmentExportBlocker(settings({ codec: "prores", format: "mov", proresProfile: "hq", smartRender: false }))).toBeNull();
  });
});

describe("segmentInputsFor", () => {
  it("reports clip edges in export frames and history spans", () => {
    const inputs = segmentInputsFor(projectOf([clip("a", 0, 10), clip("b", 10, 10, [{ type: "trails" }])], 20), settings());
    expect(inputs.totalFrames).toBe(600);
    expect(inputs.cutFrames).toEqual(expect.arrayContaining([0, 300, 600]));
    expect(inputs.forbiddenSpans).toEqual([{ startFrame: 300, endFrame: 600, reason: expect.stringContaining("trails") }]);
  });
});

describe("chooseSegmentWorkers", () => {
  const GB = 1024 ** 3;
  const base = { width: 1920, height: 1080, segmentCount: 10 };
  it("scales with cores and caps at four", () => {
    expect(chooseSegmentWorkers({ ...base, logicalCores: 2, systemMemoryBytes: 32 * GB })).toBe(1);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 4, systemMemoryBytes: 32 * GB })).toBe(1);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 8, systemMemoryBytes: 32 * GB })).toBe(2);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 12, systemMemoryBytes: 16 * GB })).toBe(4);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 64, systemMemoryBytes: 128 * GB })).toBe(4);
  });
  it("is capped by memory", () => {
    expect(chooseSegmentWorkers({ ...base, logicalCores: 32, systemMemoryBytes: 3 * GB })).toBe(1);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 32, systemMemoryBytes: 1 * GB })).toBe(0);
    expect(chooseSegmentWorkers({ ...base, width: 7680, height: 4320, logicalCores: 32, systemMemoryBytes: 16 * GB })).toBeLessThan(4);
  });
  it("backs off under memory pressure and on hardware encoders", () => {
    expect(chooseSegmentWorkers({ ...base, logicalCores: 32, systemMemoryBytes: 64 * GB, pressure: "critical" })).toBe(0);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 32, systemMemoryBytes: 64 * GB, pressure: "elevated" })).toBe(2);
    expect(chooseSegmentWorkers({ ...base, logicalCores: 32, systemMemoryBytes: 64 * GB, hardwareEncoder: true })).toBe(2);
  });
  it("never exceeds the segment count", () => {
    expect(chooseSegmentWorkers({ ...base, logicalCores: 32, systemMemoryBytes: 64 * GB, segmentCount: 2 })).toBe(2);
  });
});

describe("validateSegments", () => {
  it("reports gaps, overlaps and short covers", () => {
    expect(validateSegments([{ index: 0, startFrame: 0, endFrame: 10 }, { index: 1, startFrame: 11, endFrame: 20 }], 20)).toMatch(/starts at frame 11/);
    expect(validateSegments([{ index: 0, startFrame: 0, endFrame: 10 }, { index: 1, startFrame: 9, endFrame: 20 }], 20)).toMatch(/starts at frame 9/);
    expect(validateSegments([{ index: 0, startFrame: 0, endFrame: 10 }], 20)).toMatch(/10 of 20/);
  });
});

describe("planSegments (randomised)", () => {
  it("always tiles the export, never cuts inside a forbidden span and never makes a segment shorter than the minimum", () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let round = 0; round < 400; round++) {
      const totalFrames = Math.floor(rnd() * 20000) + 1;
      const target = Math.floor(rnd() * 600) + 1;
      const cutFrames = Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * (totalFrames + 200)) - 100);
      const forbiddenSpans = Array.from({ length: Math.floor(rnd() * 5) }, () => {
        const startFrame = Math.floor(rnd() * totalFrames);
        return { startFrame, endFrame: startFrame + Math.floor(rnd() * 3000), reason: "history" };
      });
      const minSegmentFrames = Math.max(1, Math.floor(target / 2));
      const plan = planSegments({ totalFrames, cutFrames, forbiddenSpans, targetSegmentFrames: target });
      expect(validateSegments(plan.segments, totalFrames)).toBeNull();
      for (const segment of plan.segments.slice(1)) {
        expect(forbiddenSpans.some((span) => segment.startFrame > span.startFrame && segment.startFrame < span.endFrame)).toBe(false);
      }
      if (plan.segments.length > 1) {
        for (const segment of plan.segments) expect(segment.endFrame - segment.startFrame).toBeGreaterThanOrEqual(minSegmentFrames);
      }
    }
  });
});

describe("exportTimelineDuration", () => {
  it("follows the export engine, not timeline.duration (which also counts adjustment layers, nests and motion)", () => {
    const base = projectOf([clip("a", 0, 20)], 45);
    expect(exportTimelineDuration(base)).toBe(20);
    expect(segmentInputsFor(base, settings()).totalFrames).toBe(600);
  });

  it("counts overlays on this timeline's tracks and subtitles, and ignores overlays of other tracks", () => {
    const base = projectOf([clip("a", 0, 20)], 20) as unknown as Record<string, unknown>;
    const project = {
      ...base,
      textClips: [{ trackId: "v1", startTime: 18, duration: 6 }, { trackId: "other", startTime: 0, duration: 90 }],
      timeline: { ...(base.timeline as object), subtitles: [{ endTime: 25 }] },
    } as unknown as Project;
    expect(exportTimelineDuration(project)).toBe(25);
    expect(segmentInputsFor(project, settings()).totalFrames).toBe(750);
  });

  it("clamps a range to the rendered length", () => {
    const project = projectOf([clip("a", 0, 20)], 45);
    expect(segmentInputsFor(project, settings({ range: { startTime: 5, endTime: 40 } })).totalFrames).toBe(450);
  });
});
