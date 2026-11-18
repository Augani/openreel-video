import { describe, it, expect } from "vitest";
import { fixedAudioRuns, sharedTimeAt, type MulticamClipRef } from "./fixed-audio";
import type { Clip } from "../types/timeline";
import type { MulticamAngle } from "./source";

function rnd(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
describe("retimed fixed audio stays locked (randomised)", () => {
  it("audio source time equals picture shared time", () => {
    const r = rnd(7);
    let checked = 0;
    for (let it = 0; it < 400; it++) {
      const offA = r() * 2, offF = r() * 2;
      const angle = { id: "a", offset: offA, duration: 30 } as unknown as MulticamAngle;
      const fixed = { id: "f", offset: offF, duration: 10 + r() * 15 } as unknown as MulticamAngle;
      const speed = [1, 2, 0.5, 1.5][Math.floor(r() * 4)];
      const reversed = r() < 0.4;
      const n = 1 + Math.floor(r() * 4);
      let t = r();
      const refs: MulticamClipRef[] = [];
      for (let i = 0; i < n; i++) {
        const span = 1 + r() * 3;
        const inPoint = r() * 10;
        const dur = span / speed;
        const clip = { id: "c" + i, startTime: t, duration: dur, inPoint, outPoint: inPoint + span, speed, reversed } as unknown as Clip;
        refs.push({ clip, angle, track: {}, source: {} } as unknown as MulticamClipRef);
        t += dur * (r() < 0.3 ? 0.6 : 1);
      }
      const runs = fixedAudioRuns(refs, fixed);
      for (const run of runs) {
        const rs = run.retime.speed ?? 1;
        for (let k = 0; k < 10; k++) {
          const tt = run.start + (run.duration * (k + 0.5)) / 10;
          const local = tt - run.start;
          const audioSrc = run.retime.reversed ? run.outPoint - local * rs : run.inPoint + local * rs;
          const cover = refs.find((x) => tt >= x.clip.startTime - 1e-9 && tt < x.clip.startTime + x.clip.duration - 1e-9);
          if (!cover) continue;
          const shared = sharedTimeAt(cover.clip, angle, tt);
          const audioShared = audioSrc + fixed.offset;
          expect(audioShared).toBeCloseTo(shared, 5);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
