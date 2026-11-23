import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../types";
import { buildLinkIndex, findLinkedPartners } from "./split-edit";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration: number, inPoint = 0, extra: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m", trackId, startTime, duration, inPoint, outPoint: inPoint + duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...extra,
});
const track = (id: string, type: Track["type"], clips: Clip[]): Track => ({
  id, name: id, type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
});

describe("findLinkedPartners with a link index", () => {
  it("finds the same partners with and without an index, including J/L cuts and fragments", () => {
    let seed = 11;
    let pairs = 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let round = 0; round < 40; round++) {
      const v: Clip[] = [], a: Clip[] = [];
      let t = 0;
      for (let i = 0; i < 30; i++) {
        const d = 1 + Math.floor(rnd() * 3);
        const src = Math.floor(rnd() * 5);
        v.push(clip(`v${i}`, "v", t, d, src));
        // Audio roughly lines up, sometimes offset (L-cut) or with a different source origin.
        a.push(clip(`a${i}`, "a", t + (rnd() < 0.3 ? 0.5 : 0), d, rnd() < 0.8 ? src : src + 1, rnd() < 0.5 ? { metadata: { separatedFromClipId: `v${i}` } } : {}));
        t += d;
      }
      const tracks = [track("v", "video", v), track("a", "audio", a)];
      const index = buildLinkIndex(tracks);
      for (const c of [...v, ...a]) {
        const plain = findLinkedPartners(c, tracks).map((p) => p.clip.id);
        const indexed = findLinkedPartners(c, tracks, index).map((p) => p.clip.id);
        expect(indexed).toEqual(plain);
        pairs += indexed.length;
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });
});
