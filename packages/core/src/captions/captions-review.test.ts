import { describe, expect, it } from "vitest";
import { encodeScc, parseScc } from "./scc";
import { encodeStl, parseStl } from "./ebu-stl";
import { parseCaptionBytes } from "./caption-formats";
import type { Subtitle } from "../types/timeline";

const cue = (i: number, s: number, e: number, text: string): Subtitle => ({ id: `c${i}`, text, startTime: s, endTime: e });

function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("review: broadcast caption round trips", () => {
  const rates: Array<[number, boolean]> = [[29.97, true], [29.97, false], [25, false], [30, false], [24, false]];
  for (const [fps, df] of rates) {
    it(`SCC random cues survive at ${fps} df=${df}`, () => {
      const r = rng(7);
      const cues: Subtitle[] = [];
      let t = 3 + r() * 5;
      for (let i = 0; i < 40; i++) {
        const d = 1 + r() * 2.5;
        cues.push(cue(i, t, t + d, `Line ${i} hello`));
        t += d + 0.5 + r() * 40;
      }
      const enc = encodeScc(cues, { frameRate: fps, dropFrame: df });
      const out = parseScc(enc.content, { frameRate: fps });
      expect(out.subtitles.length).toBe(cues.length);
      out.subtitles.forEach((s, i) => {
        expect(s.text).toBe(cues[i].text);
        expect(Math.abs(s.startTime - cues[i].startTime)).toBeLessThanOrEqual(1.01 / fps);
        expect(Math.abs(s.endTime - cues[i].endTime)).toBeLessThanOrEqual(1.01 / fps);
      });
    });
  }
  it("STL random cues survive", () => {
    const r = rng(3);
    const cues: Subtitle[] = [];
    let t = 1;
    for (let i = 0; i < 60; i++) {
      const d = 1 + r() * 3;
      cues.push(cue(i, t, t + d, `Caption ${i}\nsecond`));
      t += d + 0.2 + r() * 20;
    }
    const enc = encodeStl(cues, { frameRate: 25 });
    const out = parseStl(enc.bytes, {});
    expect(out.subtitles.length).toBe(60);
    out.subtitles.forEach((s, i) => {
      expect(s.text).toBe(cues[i].text);
      expect(Math.abs(s.startTime - cues[i].startTime)).toBeLessThanOrEqual(0.041);
    });
  });
  it("malformed input never throws", () => {
    const r = rng(11);
    for (let n = 0; n < 200; n++) {
      const len = Math.floor(r() * 3000);
      const b = new Uint8Array(len).map(() => Math.floor(r() * 256));
      if (n % 2 === 0 && len > 11) b.set(new TextEncoder().encode("850STL25.01"), 0);
      expect(() => parseCaptionBytes(b)).not.toThrow();
    }
    expect(() => parseScc("Scenarist_SCC V1.0\n\n00:00:01;00\t94ae 94ae zz 9420 \n00:99:99:99\t9420")).not.toThrow();
  });
  it("STL keeps wall time at 24, 50 and 60 fps (labels are 25/30 frames)", () => {
    for (const fps of [24, 23.976, 30, 50, 59.94, 60]) {
      const cues = [cue(0, 10, 12.5, "Hello"), cue(1, 3600 + 5, 3600 + 7, "Later")];
      const bytes = encodeStl(cues, { frameRate: fps }).bytes;
      const out = parseStl(bytes, { frameRate: fps });
      expect(out.subtitles.length).toBe(2);
      for (const [i, s] of out.subtitles.entries()) {
        expect(Math.abs(s.startTime - cues[i].startTime)).toBeLessThan(0.06);
        expect(Math.abs(s.endTime - cues[i].endTime)).toBeLessThan(0.06);
      }
    }
  });
  it("SCC never writes a frame label above 29 (50 / 60 fps timelines use half rate)", () => {
    for (const fps of [50, 59.94, 60]) {
      const enc = encodeScc([cue(0, 10, 12, "Hi"), cue(1, 20.5, 22, "There")], { frameRate: fps });
      const labels = [...enc.content.matchAll(/^(\d\d):(\d\d):(\d\d)[:;](\d\d)/gm)];
      expect(labels.length).toBeGreaterThan(0);
      for (const m of labels) expect(Number(m[4])).toBeLessThan(30);
      const out = parseScc(enc.content, { frameRate: fps });
      expect(out.subtitles.length).toBe(2);
      expect(Math.abs(out.subtitles[1].startTime - 20.5)).toBeLessThan(0.07);
    }
  });
});

import { checkCaptions } from "./caption-qc";

describe("review: caption QC overlap", () => {
  it("flags a cue overlapping an earlier long cue, not only its immediate predecessor", () => {
    const report = checkCaptions([cue(0, 0, 10, "A long caption that spans"), cue(1, 1, 2, "Inside"), cue(2, 5, 6, "Also inside")]);
    const overlaps = report.issues.filter((i) => i.code === "overlap");
    expect(overlaps.map((o) => o.cueIndex)).toEqual([2, 3]);
    expect(overlaps[1].message).toContain("cue 1 ends");
  });
});
