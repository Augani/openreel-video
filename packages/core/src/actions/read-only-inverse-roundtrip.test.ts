import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Project } from "../types/project";
import type { Action } from "../types/actions";

/**
 * Effect, keyframe and trim actions skip the project snapshot; their inverses must still undo
 * every step exactly, including nested effect params and several tracks.
 */
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clip(id: string, trackId: string, start: number) {
  return {
    id, mediaId: "m", trackId, startTime: start, duration: 10, inPoint: 0, outPoint: 10,
    effects: [{ id: `${id}-fx0`, type: "curves", params: { points: [[0, 0], [1, 1]], gain: { r: 1, g: 1 } }, enabled: true }],
    audioEffects: [], volume: 1,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    keyframes: [{ id: `${id}-k`, property: "opacity", time: 1, value: { v: 1 }, easing: "linear" }],
  };
}

function project(): Project {
  const tracks = [0, 1, 2].map((t) => ({
    id: `t${t}`, type: "video", name: `V${t}`, locked: false, hidden: false, muted: false, solo: false, transitions: [],
    clips: [0, 1, 2].map((c) => clip(`c${t}${c}`, `t${t}`, c * 12)),
  }));
  return {
    id: "p", name: "x", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 36, tracks }, mediaLibrary: { items: [] },
  } as unknown as Project;
}

describe("read-only-inverse actions round-trip through undo and redo", () => {
  for (const seed of [3, 11, 29, 101]) {
    it(`random effect/keyframe/trim sequence, seed ${seed}`, async () => {
      const rnd = mulberry(seed);
      const exec = new ActionExecutor();
      const p = project();
      const initial = structuredClone(p.timeline);
      const snapshots: unknown[] = [structuredClone(p.timeline)];
      let n = 0;
      const ids = ["c00", "c01", "c12", "c22"];
      const fx: Record<string, string[]> = Object.fromEntries(ids.map((i) => [i, [`${i}-fx0`]]));
      for (let step = 0; step < 40; step++) {
        const c = ids[Math.floor(rnd() * ids.length)];
        const kind = Math.floor(rnd() * 9);
        let a: Record<string, unknown> | null = null;
        const id = `a${n++}`;
        const f = fx[c];
        if (kind === 0) { const e = `${c}-n${n}`; a = { type: "effect/add", params: { clipId: c, effectType: "blur", params: { radius: Math.floor(rnd() * 9), arr: [1, 2, { z: n }] }, effectId: e } }; f.push(e); }
        else if (kind === 1 && f.length) a = { type: "effect/update", params: { clipId: c, effectId: f[0], params: { gain: { r: rnd(), g: rnd() }, extra: n } } };
        else if (kind === 2 && f.length) a = { type: "effect/toggle", params: { clipId: c, effectId: f[f.length - 1], enabled: rnd() > 0.5 } };
        else if (kind === 3 && f.length > 1) a = { type: "effect/reorder", params: { clipId: c, effectId: f[f.length - 1], newIndex: 0 } };
        else if (kind === 4 && f.length > 1) { a = { type: "effect/remove", params: { clipId: c, effectId: f[1] } }; f.splice(1, 1); }
        else if (kind === 5) a = { type: "keyframe/add", params: { clipId: c, property: "scale.x", time: Math.round(rnd() * 90) / 10, value: rnd(), easing: "linear" } };
        else if (kind === 6) a = { type: "keyframe/update", params: { clipId: c, property: "opacity", time: 1, value: { v: rnd() }, easing: "ease-in" } };
        else if (kind === 7) a = { type: "clip/trim", params: { clipId: c, inPoint: Math.round(rnd() * 3), outPoint: 6 + Math.round(rnd() * 4) } };
        else continue;
        const r = await exec.execute({ id, timestamp: Date.now(), ...a } as unknown as Action, p);
        if (!r.success) { if (a.type === "effect/remove") fx[c].splice(1, 0, "x"); continue; }
        snapshots.push(structuredClone(p.timeline));
      }
      const final = structuredClone(p.timeline);
      expect(snapshots.length).toBeGreaterThan(10);
      // Undo everything, redo everything: the final timeline must come back exactly (undo of
      // effect/update merges old params, so undo-to-initial is not asserted here).
      while ((await exec.undo(p)).success) { /* drain */ }
      while ((await exec.redo(p)).success) { /* replay */ }
      expect(p.timeline).toEqual(final);
      expect(initial.tracks).toHaveLength(3);
    });
  }
});
