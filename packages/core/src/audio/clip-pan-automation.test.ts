import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../types/timeline";
import { resolveClipPanAutomation, resolveClipPitchCorrection } from "./clip-audio-resolution";
import {
  getPanAutomationPointsForRange,
  schedulePanAutomationOnParam,
} from "./clip-pan-automation";

/** Minimal AudioParam that evaluates its own automation timeline. */
class FakeParam {
  events: Array<{ kind: "set" | "ramp"; time: number; value: number }> = [];
  cancelScheduledValues(): void {
    this.events = [];
  }
  setValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "set", time, value });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "ramp", time, value });
  }
  valueAt(t: number): number {
    let prev = this.events[0];
    for (const e of this.events.slice(1)) {
      if (e.time >= t) {
        if (e.kind === "ramp") return prev.value + ((e.value - prev.value) * (t - prev.time)) / (e.time - prev.time);
        return prev.value;
      }
      prev = e;
    }
    return prev.value;
  }
}

const gains = (pan: number) => {
  const x = (pan + 1) / 2; // equal power, as StereoPannerNode on a mono source
  return { l: Math.cos((x * Math.PI) / 2), r: Math.sin((x * Math.PI) / 2) };
};

describe("pan automation scheduling", () => {
  it("L/R energy follows a left-to-right sweep", () => {
    const param = new FakeParam();
    const scheduled = schedulePanAutomationOnParam(
      param as unknown as AudioParam,
      [{ time: 0, value: -1 }, { time: 4, value: 1 }],
      0, 0, 4, 10,
    );
    expect(scheduled).toBe(true);
    let leftEarly = 0, rightEarly = 0, leftLate = 0, rightLate = 0;
    for (let t = 0; t < 1; t += 0.01) {
      const g = gains(param.valueAt(10 + t));
      leftEarly += g.l ** 2; rightEarly += g.r ** 2;
    }
    for (let t = 3; t < 4; t += 0.01) {
      const g = gains(param.valueAt(10 + t));
      leftLate += g.l ** 2; rightLate += g.r ** 2;
    }
    expect(leftEarly).toBeGreaterThan(rightEarly * 3);
    expect(rightLate).toBeGreaterThan(leftLate * 3);
    expect(param.valueAt(12)).toBeCloseTo(0, 5);
  });

  it("rebases to a partially rendered window and clamps to -1..1", () => {
    const pts = getPanAutomationPointsForRange(
      [{ time: 0, value: -2 }, { time: 4, value: 1 }],
      2, 1, 0,
    );
    expect(pts[0].time).toBe(0);
    expect(pts[0].value).toBeCloseTo(0, 5);
    expect(pts[pts.length - 1].time).toBe(1);
    expect(pts[pts.length - 1].value).toBeCloseTo(0.5, 5);
  });

  it("schedules nothing without automation", () => {
    const param = new FakeParam();
    expect(schedulePanAutomationOnParam(param as unknown as AudioParam, [], 0.3, 0, 2, 0)).toBe(false);
    expect(param.events).toHaveLength(0);
  });
});

const clip = (over: Partial<Clip>): Clip => ({
  id: "c", mediaId: "m", trackId: "t", startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
  effects: [], audioEffects: [], volume: 1, keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  ...over,
});

describe("clip resolution", () => {
  const pan = [{ time: 0, value: -1 }, { time: 1, value: 1 }];
  it("resolves own and linked pan lanes and the pitch flag", () => {
    const video = clip({ id: "v", trackId: "tv" });
    const audio = clip({ id: "a", trackId: "ta", automation: { pan }, pitchCorrection: false });
    const tracks = [
      { id: "tv", clips: [video] },
      { id: "ta", clips: [audio] },
    ] as unknown as Track[];
    expect(resolveClipPanAutomation(audio, { tracks })).toEqual(pan);
    expect(resolveClipPanAutomation(video, { tracks })).toEqual(pan);
    expect(resolveClipPitchCorrection(video, { tracks })).toBe(false);
    expect(resolveClipPitchCorrection(clip({ id: "x", mediaId: "other" }), { tracks })).toBe(true);
  });
});
