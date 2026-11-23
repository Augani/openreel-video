import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Project } from "../../types";
import { clipSpectralRegions, planSpectralRegionsAction } from "./spectral-edit";
import { sanitizeSpectralRegions, spectralRegionsKey, type SpectralRegion } from "./spectral-regions";
import { createSpectralHandler } from "./spectral-worker-core";
import { applySpectralRegions } from "./spectral-dsp";

const base = { id: "a", enabled: true, gainDb: -120, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;
const project = () => ({ id: "p", name: "p", createdAt: 0, modifiedAt: 0, settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 }, mediaLibrary: { items: [] },
  timeline: { duration: 4, subtitles: [], markers: [], tracks: [{ id: "t", name: "A", type: "audio", hidden: false, muted: false, solo: false, locked: false, transitions: [], clips: [{ id: "clip", mediaId: "m", trackId: "t", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, volume: 1, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 } }] }] } }) as unknown as Project;

describe("spectral masks: undo/redo, versioning, cache key, worker identity", () => {
  it("mixed legacy rect + lasso heal; undo/redo exact; version dropped when masks leave", async () => {
    const p = project(); const ex = new ActionExecutor(); const clip = () => p.timeline.tracks[0].clips[0];
    const fx = () => (clip().audioEffects ?? []).find((e) => e.type === "spectralRepair");
    let n = 0;
    const commit = async (r: SpectralRegion[]) => { const a = planSpectralRegionsAction(clip(), r, { actionId: `a${++n}`, effectId: "fx" }); if (a) expect((await ex.execute(a, p)).success).toBe(true); return a; };
    const rect = sanitizeSpectralRegions([{ ...base, id: "r", mode: "remove", startTime: 1, endTime: 2, lowHz: 100, highHz: 200 }]);
    const lasso = sanitizeSpectralRegions([{ ...base, id: "l", mode: "heal", shape: "lasso", points: [{ t: 1, hz: 400 }, { t: 2, hz: 800 }, { t: 1.5, hz: 3000 }] }]);
    await commit(rect); expect(fx()!.params.version).toBeUndefined();
    const s1 = JSON.stringify(fx());
    await commit([...rect, ...lasso]); expect(fx()!.params.version).toBe(2);
    const s2 = JSON.stringify(fx());
    await commit(rect); expect(fx()!.params.version).toBeUndefined();
    expect(JSON.stringify(fx())).toBe(s1);
    expect(await commit(rect)).toBeNull();
    await ex.undo(p); expect(JSON.stringify(fx())).toBe(s2);
    await ex.undo(p); expect(JSON.stringify(fx())).toBe(s1);
    await ex.redo(p); expect(JSON.stringify(fx())).toBe(s2);
    await ex.redo(p); expect(JSON.stringify(fx())).toBe(s1);
    expect(clipSpectralRegions(clip())).toHaveLength(1);
  });
  it("cache key changes with every mask parameter", () => {
    const mk = (o: object) => spectralRegionsKey(sanitizeSpectralRegions([{ ...base, id: "x", mode: "heal", shape: "brush", points: [{ t: 1, hz: 1000 }], brushSeconds: 0.05, brushOctaves: 0.1, ...o }]));
    const k = mk({});
    for (const o of [{ mode: "remove" }, { feather: 3 }, { brushSeconds: 0.06 }, { brushOctaves: 0.2 }, { points: [{ t: 1, hz: 1001 }] }, { shape: "lasso", points: [{ t: 1, hz: 1000 }, { t: 2, hz: 1000 }, { t: 2, hz: 3000 }] }]) expect(mk(o)).not.toBe(k);
    expect(mk({ id: "other" })).toBe(k);
  });
  it("worker handler (preview) == direct apply (export) after structured clone, stereo", () => {
    const n = 48000; const l = Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin(i * 0.05) + 0.01 * Math.sin(i * 1.7)); const r = l.map((v) => -v);
    const regs = sanitizeSpectralRegions([{ ...base, id: "h", mode: "heal", shape: "brush", points: [{ t: 0.2, hz: 800 }, { t: 0.6, hz: 1600 }], brushSeconds: 0.05, brushOctaves: 0.2 }]);
    const viaWorker = createSpectralHandler()({ id: 1, kind: "repair", channels: [l.slice(), r.slice()], sampleRate: 48000, regions: structuredClone(regs) }).channels!;
    const direct = applySpectralRegions([l, r], 48000, regs);
    for (let c = 0; c < 2; c++) expect(Array.from(viaWorker[c])).toEqual(Array.from(direct[c]));
  });
});
