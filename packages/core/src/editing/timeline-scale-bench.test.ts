import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { planClipSpeedEdit } from "./clip-speed-edit";
import { planRippleDelete } from "./ripple-delete";
import {
  applyTimelineToolEdits,
  validateTimelineToolEdits,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "media", trackId, startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[]): Track => ({
  id, name: id.toUpperCase(), type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});

/** `count` back-to-back 2 s clips on V1 with linked A1 clips, plus markers and captions. */
function buildSequence(count: number, follower = false): Project {
  const v: Clip[] = [], a: Clip[] = [];
  for (let i = 0; i < count; i++) {
    v.push(clip(`v${i}`, "v1", i * 2, 2));
    a.push(clip(`a${i}`, "a1", i * 2, 2));
  }
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      duration: count * 2,
      markers: Array.from({ length: count }, (_, i) => ({ id: `m${i}`, time: i * 2, label: "m", color: "#fff" })),
      subtitles: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, text: "x", startTime: i * 2, endTime: i * 2 + 1.5 })),
      tracks: [
        track("v1", "video", v),
        track("a1", "audio", a),
        ...(follower ? [track("v2", "video", Array.from({ length: count / 2 }, (_, i) => clip(`f${i}`, "v2", i * 4 + 2.5, 0.5)))] : []),
      ],
    },
  } as unknown as Project;
}

const best = <T>(runs: number, fn: () => T): [T, number] => {
  let result!: T;
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    result = fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return [result, fastest];
};
/** What the editor does for one action: plan, validate, apply (one undo step). */
const commit = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const startOf = (p: Project, id: string) =>
  p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!.startTime;

/**
 * Timeline action time at scale (docs/PREMIERE-GAPS.md, "1000+ clip
 * measurements"). Sequences hold N picture clips plus N linked audio clips
 * (2N clips), N markers and N captions, so every ripple also moves markers and
 * captions. Measured on an Apple-silicon laptop (plan + validate + apply, best
 * of 3), after batching the shifts and indexing the validator: ripple speed
 * 16 ms (N = 1000) and 51 ms (N = 4000); ripple delete 9 ms and 34 ms; about
 * 1.3x to 1.7x those with a sync-locked follower track. Before the fix both
 * ripples were O(n^2): ripple speed took about 200 ms at N = 1000 and about
 * 760 ms at N = 2000 (4x per doubling, so roughly 3 s at N = 4000, which was
 * not run). The bounds below sit about 15x above the linear timings (CI
 * machines are slower and noisy) and under the quadratic estimate at N = 4000,
 * so a regression to O(n^2) fails here.
 */
const BOUND_MS = { 1000: 250, 4000: 1000 } as const;

describe("timeline action time at 1000+ clips", () => {
  for (const follower of [false, true]) {
    const where = follower ? "with an unlocked sync-locked follower track" : "edit tracks only";
    for (const count of [1000, 4000] as const) {
      it(`ripple speed of every clip, N=${count}, ${where}`, () => {
        const p = buildSequence(count, follower);
        const ids = p.timeline.tracks.filter((t) => t.id !== "v2").flatMap((t) => t.clips.map((c) => c.id));
        // Slowing down keeps the follower track legal (growing never blocks).
        const speed = follower ? 0.5 : 2;
        const [plan, planMs] = best(3, () => planClipSpeedEdit(p, ids, { speed }, { ripple: true }, "op"));
        const [next, applyMs] = best(3, () => commit(p, plan));
        const ms = planMs + applyMs;
        console.log(`  plan ${planMs.toFixed(1)} apply ${applyMs.toFixed(1)}`);
        console.log(`BENCH ripple-speed N=${count} (${2 * count} clips${follower ? " + follower" : ""}): ${ms.toFixed(1)} ms`);
        const k = count - 1;
        // Clip k used to start at 2k, lasted 2 s; at speed s it lasts 2/s and starts at k*2/s.
        expect(startOf(next, `v${k}`)).toBeCloseTo((k * 2) / speed, 6);
        expect(startOf(next, `a${k}`)).toBeCloseTo((k * 2) / speed, 6);
        expect(next.timeline.markers[k].time).toBeCloseTo((k * 2) / speed, 6);
        expect(next.timeline.subtitles[k].startTime).toBeCloseTo((k * 2) / speed, 6);
        if (follower) {
          const i = count / 2 - 1; // follower i sits after 2i + 1 clip ends, each 2/speed - 2 s longer
          expect(startOf(next, `f${i}`)).toBeCloseTo(i * 4 + 2.5 + (2 / speed - 2) * (2 * i + 1), 6);
        }
        expect(ms).toBeLessThan(BOUND_MS[count]);
      }, 120000);

      it(`ripple delete of every other clip, N=${count}, ${where}`, () => {
        const p = buildSequence(count, follower);
        const ids = p.timeline.tracks
          .filter((t) => t.id !== "v2")
          .flatMap((t) => t.clips.filter((_, i) => i % 2 === 0).map((c) => c.id));
        const [next, ms] = best(3, () => commit(p, planRippleDelete(p, ids, "op")));
        console.log(`BENCH ripple-delete N=${count} (${count} of ${2 * count} clips${follower ? " + follower" : ""}): ${ms.toFixed(1)} ms`);
        // Kept clips are the odd ones; each closes up to start at its rank * 2.
        const v = next.timeline.tracks.find((t) => t.id === "v1")!.clips;
        expect(v).toHaveLength(count / 2);
        expect(v[v.length - 1].startTime).toBeCloseTo((count / 2 - 1) * 2, 6);
        expect(next.timeline.tracks.find((t) => t.id === "a1")!.clips).toHaveLength(count / 2);
        expect(ms).toBeLessThan(BOUND_MS[count]);
      }, 120000);
    }
  }
});
