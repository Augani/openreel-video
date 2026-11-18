import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import type { LoudnessBridge, LoudnessMeasurement } from "./host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

const measurement = (overrides: Partial<LoudnessMeasurement> = {}): LoudnessMeasurement => ({
  integratedLufs: -26,
  loudnessRangeLu: 4.2,
  truePeakDbtp: -12,
  samplePeakDbfs: -12.5,
  momentaryMaxLufs: -23,
  shortTermMaxLufs: -24,
  durationSec: 5,
  sampleRate: 48000,
  channels: 2,
  ...overrides,
});

function hostWith(bridge: Partial<LoudnessBridge> | undefined) {
  const host = new HeadlessHost(makeProjectWithClip());
  if (bridge) (host as unknown as { loudness: LoudnessBridge }).loudness = bridge as LoudnessBridge;
  return host;
}

const clipVolume = (host: HeadlessHost) => host.getProject().timeline.tracks[0].clips[0].volume;

describe("agent loudness tools", () => {
  it("registers measure_loudness and normalize_clip_loudness", () => {
    expect(getTool("measure_loudness")?.readOnly).toBe(true);
    expect(getTool("normalize_clip_loudness")).toBeDefined();
  });

  it("fails clearly on a host with no audio renderer", async () => {
    const r = await executeTool("measure_loudness", {}, hostWith(undefined));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("UNSUPPORTED_HOST");
  });

  it("measures the timeline and a clip through the bridge", async () => {
    const calls: string[] = [];
    const host = hostWith({
      measureTimeline: async (range) => {
        calls.push(`timeline:${range ? `${range.startTime}-${range.endTime}` : "all"}`);
        return measurement({ integratedLufs: -20.123 });
      },
      measureClip: async (clipId) => {
        calls.push(`clip:${clipId}`);
        return { clipId, ...measurement() };
      },
    });
    const t = await executeTool("measure_loudness", { startTime: 1, endTime: 3 }, host);
    expect(t.ok).toBe(true);
    expect((t.data as LoudnessMeasurement).integratedLufs).toBeCloseTo(-20.123, 3);
    const c = await executeTool("measure_loudness", { scope: "clip", clipId: "c1" }, host);
    expect(c.ok).toBe(true);
    expect(calls).toEqual(["timeline:1-3", "clip:c1"]);
    expect((await executeTool("measure_loudness", { scope: "clip" }, host)).ok).toBe(false);
  });

  it("normalizes a clip to the target with exactly one gain action", async () => {
    const host = hostWith({
      measureClip: async (clipId) => ({ clipId, ...measurement({ integratedLufs: -26, truePeakDbtp: -12 }) }),
    });
    const r = await executeTool("normalize_clip_loudness", { clipId: "c1", targetLufs: -16 }, host);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ applied: true, gainDb: 10, resultingLufs: -16, clamped: false });
    expect(clipVolume(host)).toBeCloseTo(Math.pow(10, 10 / 20), 6);
  });

  it("caps the gain at +12 dB, ignores silence and rejects a bad target", async () => {
    const quiet = hostWith({
      measureClip: async (clipId) => ({ clipId, ...measurement({ integratedLufs: -45, truePeakDbtp: -30 }) }),
    });
    const r = await executeTool("normalize_clip_loudness", { clipId: "c1", targetLufs: -14 }, quiet);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ clamped: true });
    expect(clipVolume(quiet)).toBeCloseTo(4, 6);

    const silent = hostWith({
      measureClip: async (clipId) => ({
        clipId,
        ...measurement({ integratedLufs: null, truePeakDbtp: null, samplePeakDbfs: null }),
      }),
    });
    const s = await executeTool("normalize_clip_loudness", { clipId: "c1" }, silent);
    expect(s.ok).toBe(true);
    expect(s.data).toMatchObject({ applied: false });
    expect(clipVolume(silent)).toBe(1);

    expect((await executeTool("normalize_clip_loudness", { clipId: "c1", targetLufs: 3 }, quiet)).ok).toBe(false);
  });
});
