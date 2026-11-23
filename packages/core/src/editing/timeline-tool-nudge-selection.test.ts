import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../types/timeline";
import type { Project } from "../types/project";
import { applyTimelineToolEdits, validateTimelineToolEdits } from "./timeline-tool-edit";
import { planToolNudge, planToolNudgeSelection } from "./timeline-tool-nudge";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
// Every clip plays source seconds 4..8 of a 20 s file at normal speed.
const clip = (id: string, trackId: string, startTime: number): Clip => ({
  id, trackId, mediaId: "source", startTime, duration: 4, inPoint: 4, outPoint: 8, effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, clips: Clip[], locked = false): Track => ({ id, name: id, type: "video", clips, transitions: [], locked, hidden: false, muted: false, solo: false });
function fixture(locked = false): Project {
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 40, tracks: [track("v1", [clip("a", "v1", 0), clip("b", "v1", 4), clip("c", "v1", 8)]), track("v2", [clip("d", "v2", 0)], locked)] },
    mediaLibrary: { items: [{ id: "source", name: "s", type: "video", metadata: { duration: 20, frameRate: 30 } }] },
  } as unknown as Project;
}
const byId = (project: Project) => new Map(project.timeline.tracks.flatMap((t) => t.clips).map((c) => [c.id, c] as const));
const frame = 1 / 30;

describe("planToolNudgeSelection", () => {
  it("ripples every selected edit point in one plan: each tail moves one frame and everything after shifts by the sum", () => {
    const project = fixture();
    const { plan, nudged, skipped } = planToolNudgeSelection(project, { mode: "ripple", itemIds: ["a", "b", "c"], playhead: 100, frames: 1 });
    expect({ nudged, skipped }).toEqual({ nudged: 3, skipped: 0 });
    validateTimelineToolEdits(project, plan.edits);
    const after = byId(applyTimelineToolEdits(project, plan.edits));
    expect(after.get("a")!.duration).toBeCloseTo(4 + frame, 9);
    expect(after.get("b")!.startTime).toBeCloseTo(4 + frame, 9);
    expect(after.get("b")!.duration).toBeCloseTo(4 + frame, 9);
    expect(after.get("c")!.startTime).toBeCloseTo(8 + 2 * frame, 9);
    expect(after.get("c")!.duration).toBeCloseTo(4 + frame, 9);
    // Same result as nudging the three edit points one at a time (right to left) by hand.
    let manual = project;
    for (const id of ["c", "b", "a"]) manual = applyTimelineToolEdits(manual, planToolNudge(manual, { mode: "ripple", itemId: id, edge: "right", frames: 1 }).edits);
    const expected = byId(manual);
    for (const id of ["a", "b", "c"]) {
      expect(after.get(id)!.startTime).toBeCloseTo(expected.get(id)!.startTime, 9);
      expect(after.get(id)!.duration).toBeCloseTo(expected.get(id)!.duration, 9);
    }
  });

  it("slips every selected clip by the same amount, in one plan", () => {
    const project = fixture();
    const { plan, nudged } = planToolNudgeSelection(project, { mode: "slip", itemIds: ["a", "b", "c", "d"], playhead: 0, frames: 2 });
    expect(nudged).toBe(1);
    validateTimelineToolEdits(project, plan.edits);
    const after = byId(applyTimelineToolEdits(project, plan.edits));
    for (const id of ["a", "b", "c", "d"]) expect(after.get(id)!.inPoint).toBeCloseTo(4 - 2 * frame, 9);
  });

  it("nudges aligned clips on several tracks as one edit point and counts the ones that cannot move", () => {
    const project = fixture(true);
    const { plan, nudged, skipped, firstError } = planToolNudgeSelection(project, { mode: "ripple", itemIds: ["a", "d", "b"], playhead: 100, frames: 1 });
    // a and d share an edit point but d's track is locked: that point is skipped, b moves.
    expect({ nudged, skipped }).toEqual({ nudged: 1, skipped: 1 });
    expect(firstError).toMatch(/Unlock/);
    validateTimelineToolEdits(project, plan.edits);
    const after = byId(applyTimelineToolEdits(project, plan.edits));
    expect(after.get("a")!.duration).toBeCloseTo(4, 9);
    expect(after.get("b")!.duration).toBeCloseTo(4 + frame, 9);
  });

  it("returns an empty plan, not an exception, when nothing can move", () => {
    const project = fixture();
    const { plan, nudged, skipped } = planToolNudgeSelection(project, { mode: "ripple", itemIds: ["a"], playhead: 100, frames: -400 });
    expect(plan.edits).toEqual([]);
    expect({ nudged, skipped }).toEqual({ nudged: 0, skipped: 1 });
  });
});

// A small deterministic PRNG so a failing seed can be replayed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProject(rand: () => number, shape: { tracks: number; perTrack: number; locked: boolean; transitions: boolean; text: boolean; populatedFollower: boolean; misaligned: boolean }): { project: Project; ids: string[]; linked: Map<string, string[]> } {
  const frameRate = [24, 25, 30, 29.97][Math.floor(rand() * 4)];
  const tracks: Track[] = [];
  const linked = new Map<string, string[]>();
  const ids: string[] = [];
  const grid = 1 / frameRate;
  for (let t = 0; t < shape.tracks; t++) {
    const clips: Clip[] = [];
    let cursor = Math.round(rand() * 4) * grid;
    for (let c = 0; c < shape.perTrack; c++) {
      cursor += rand() < 0.4 ? Math.round(rand() * 6) * grid : 0;
      const duration = (2 + Math.floor(rand() * 40)) * grid;
      const inPoint = Math.floor(rand() * 8) * grid;
      const outPoint = inPoint + duration * (rand() < 0.1 ? 1.5 : 1);
      clips.push({
        id: `t${t}c${c}`, trackId: `t${t}`, mediaId: rand() < 0.15 ? "still" : "source", startTime: cursor, duration, inPoint, outPoint,
        effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...(rand() < 0.15 ? { speed: 2 } : {}), ...(rand() < 0.1 ? { reversed: true } : {}),
      } as Clip);
      cursor += duration;
      ids.push(`t${t}c${c}`);
    }
    tracks.push({ ...track(`t${t}`, clips, shape.locked && t === shape.tracks - 1), ...(rand() < 0.2 ? { syncLock: false } : {}), ...(shape.transitions && t === 0 && clips.length > 1 ? { transitions: [{ id: "tr", type: "crossfade", clipAId: clips[0].id, clipBId: clips[1].id, duration: 0.2 }] } : {}) } as Track);
  }
  if (shape.populatedFollower) tracks.push(track("music", [clip("m0", "music", 5)]));
  // Link clips of consecutive tracks that happen to have the same index (aligned or not, like a real selection).
  for (let t = 0; t + 1 < shape.tracks; t += 2) {
    for (let c = 0; c < shape.perTrack; c++) {
      if (rand() < 0.5) {
        const a = tracks[t].clips[c], b = tracks[t + 1].clips[c];
        if (!shape.misaligned) (b as { startTime: number }).startTime = a.startTime, (b as { duration: number }).duration = a.duration, (b as { inPoint: number }).inPoint = a.inPoint, (b as { outPoint: number }).outPoint = a.outPoint;
        linked.set(a.id, [b.id]);
        linked.set(b.id, [a.id]);
      }
    }
  }
  const project = {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate, sampleRate: 48000, channels: 2 },
    timeline: { duration: 200, tracks },
    mediaLibrary: { items: [{ id: "source", name: "s", type: "video", metadata: { duration: 20, frameRate } }, { id: "still", name: "i", type: "image", metadata: { duration: 0, frameRate } }] },
    ...(shape.text ? { textClips: [{ id: "tx", trackId: "t0", startTime: 1, duration: 2, text: "hi", metadata: { captionSourceClipId: "t0c0" } }] } : {}),
  } as unknown as Project;
  return { project, ids, linked };
}

// Splits of followers (sync lock) get random ids; everything else is compared exactly.
const maskSplitIds = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/split-[0-9a-f]+-[0-9a-f]+/g, "split-X").replace(/:split:[0-9a-f-]{36}:/g, ":split:X:"));
const normalise = (result: ReturnType<typeof planToolNudgeSelection>) => {
  const edits = maskSplitIds(result.plan.edits) as Array<{ kind: string; id: string; trackId: string; index: number }>;
  const key = (e: { kind: string; id: string; trackId: string; index: number }) => `${e.kind}:${e.id}:${e.trackId}:${String(e.index).padStart(6, "0")}:${JSON.stringify(e)}`;
  edits.sort((a, b) => key(a).localeCompare(key(b)));
  return { nudged: result.nudged, skipped: result.skipped, firstError: result.firstError, label: result.plan.label, delta: result.plan.delta, edits };
};

describe("planToolNudgeSelection: batched ripple planner equals one edit point at a time", () => {
  it("returns the same edits, counts and errors as the sequential planner on 600 random projects (every shape, every fallback)", () => {
    let batchedShapes = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const rand = rng(seed);
      const shape = {
        tracks: 1 + Math.floor(rand() * 4),
        perTrack: 1 + Math.floor(rand() * 12),
        // Mostly the shape the batched planner handles; the rest must fall back and still agree.
        locked: seed % 11 === 0,
        transitions: seed % 13 === 0,
        text: seed % 17 === 0,
        populatedFollower: seed % 7 === 0,
        misaligned: seed % 5 === 0,
      };
      const { project, ids, linked } = randomProject(rand, shape);
      const picked = seed % 3 === 0 ? ids.filter(() => rand() < 0.7) : ids;
      const itemIds = picked.length ? picked : [ids[0]];
      const frames = [1, -1, 5, -5, 30, -400][Math.floor(rand() * 6)];
      const options = { mode: "ripple" as const, itemIds, linkedIdsOf: (id: string) => linked.get(id) ?? [], playhead: rand() * 40, frames };
      const sequential = normalise(planToolNudgeSelection(project, { ...options, forceSequential: true }));
      const batched = normalise(planToolNudgeSelection(project, options));
      expect(batched, `seed ${seed}`).toEqual(sequential);
      if (!shape.locked && !shape.transitions && !shape.text && !shape.populatedFollower && !shape.misaligned && seed % 3 !== 0) batchedShapes++;
    }
    expect(batchedShapes).toBeGreaterThan(100);
  });

  it("nudges 2000 selected clips (1000 linked pairs) well inside a second", () => {
    const N = 1000;
    const make = (prefix: string, trackId: string) => Array.from({ length: N }, (_, i) => ({ ...clip(`${prefix}-${i}`, trackId, i), duration: 1, inPoint: i % 5, outPoint: (i % 5) + 1 }));
    const project = fixture();
    (project.timeline as { tracks: Track[] }).tracks = [track("v1", make("p", "v1")), track("a1", make("a", "a1")), track("empty", [])];
    const ids = project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id));
    const linkedIdsOf = (id: string) => [id.startsWith("p-") ? `a-${id.slice(2)}` : `p-${id.slice(2)}`];
    const started = performance.now();
    const fast = planToolNudgeSelection(project, { mode: "ripple", itemIds: ids, linkedIdsOf, playhead: 1e6, frames: 1 });
    const elapsed = performance.now() - started;
    expect(fast.nudged).toBe(N);
    expect(fast.plan.edits).toHaveLength(2 * N);
    expect(elapsed).toBeLessThan(500);
    expect(normalise(fast)).toEqual(normalise(planToolNudgeSelection(project, { mode: "ripple", itemIds: ids, linkedIdsOf, playhead: 1e6, frames: 1, forceSequential: true })));
  });
});
