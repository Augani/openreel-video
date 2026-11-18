import { describe, it, expect } from "vitest";
import { buildProject } from "../__fixtures__/project";
import { exportTimeline, importTimelineFile } from "../index";
import { parseAaf } from "./aaf-reader";
describe("AAF reader robustness", () => {
  it("mutated exports never hang", () => {
    const p = buildProject(24);
    const bytes = exportTimeline(p, "aaf").files[0].bytes!;
    let s = 99; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff);
    let errs = 0, oks = 0;
    for (let i = 0; i < 300; i++) {
      const b = new Uint8Array(bytes);
      for (let k = 0; k < 1 + (i % 20); k++) b[rnd() % b.length] = rnd() & 255;
      const cut = i % 5 === 0 ? b.subarray(0, rnd() % b.length) : b;
      try { parseAaf(cut); oks++; } catch (e) { expect(e).toBeInstanceOf(Error); errs++; }
    }
    expect(oks + errs).toBe(300);
  }, 120000);
  it("garbage + short + empty", () => {
    for (const b of [new Uint8Array(0), new Uint8Array(10), Uint8Array.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])])
      expect(() => importTimelineFile(b, { mediaItems: [] } as never)).toThrow();
  });
});
