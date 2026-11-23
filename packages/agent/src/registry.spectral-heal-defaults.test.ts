import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeProjectWithClip } from "./test-fixtures";
import type { EditingHost, SpectralSourceBridge } from "./host";

// Independent parameters: a 5 s source, a 1700 Hz whine that lasts the whole clip (A) or only 1.0 s to 3.5 s (B).
const SR = 48000;
const build = (toneFrom: number, toneTo: number) => {
  const n = 5 * SR;
  const mono = new Float32Array(n);
  let seed = 9;
  for (let i = 0; i < n; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const t = i / SR;
    mono[i] = 0.08 * Math.sin(2 * Math.PI * (180 * t + 25 * t * t)) + 0.05 * Math.sin(2 * Math.PI * 1700 * t) * (t >= toneFrom && t < toneTo ? 1 : 0) + 0.003 * (seed / 4294967296 - 0.5);
  }
  return { mono, sampleRate: SR, duration: 5 };
};
const setup = (toneFrom: number, toneTo: number) => {
  const src = build(toneFrom, toneTo);
  const bridge: SpectralSourceBridge = { getSource: async () => src };
  const host = Object.assign(new HeadlessHost(makeProjectWithClip(), { history: new ActionHistory() }), { spectralSource: bridge }) as EditingHost & HeadlessHost;
  return host;
};
const regions = (host: HeadlessHost) =>
  ((host.getProject().timeline.tracks[0].clips[0].audioEffects ?? []).find((e) => e.type === "spectralRepair")?.params.regions as Array<{ mode: string }>) ?? [];

describe("heal defaults (independent)", () => {
  it("a partial slice of a persistent tone defaults to remove, with no warning", async () => {
    const host = setup(0, 5);
    const r = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 2, endTime: 2.4, lowHz: 1650, highHz: 1750 }, host);
    expect(r.ok).toBe(true);
    expect((r.data as { mode: string }).mode).toBe("remove");
    expect(regions(host)[0].mode).toBe("remove");
    expect((r.data as { warning?: string }).warning).toBeUndefined();
  });

  it("explicit heal on that slice warns but is still stored as heal; whole-source heal does not warn", async () => {
    const host = setup(0, 5);
    const r = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", mode: "heal", startTime: 2, endTime: 2.4, lowHz: 1650, highHz: 1750 }, host);
    expect((r.data as { warning?: string }).warning).toMatch(/remove/);
    expect(r.summary).toMatch(/Warning/);
    expect(regions(host)[0].mode).toBe("heal");
    const whole = setup(0, 5);
    const w = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 0, endTime: 5, lowHz: 1650, highHz: 1750 }, whole);
    expect((w.data as { mode: string }).mode).toBe("heal");
    expect((w.data as { warning?: string }).warning).toBeUndefined();
  });

  it("remove_spectral_tones removes a tone lasting part of the clip and heals one lasting all of it", async () => {
    const partial = setup(1, 3.5);
    const p = await executeTool("remove_spectral_tones", { clipId: "c1" }, partial);
    expect(p.ok).toBe(true);
    expect((p.data as { modes: string[] }).modes).toEqual(["remove"]);
    expect(regions(partial).map((r) => r.mode)).toEqual(["remove"]);
    const full = setup(0, 5);
    const f = await executeTool("remove_spectral_tones", { clipId: "c1" }, full);
    expect((f.data as { modes: string[] }).modes).toEqual(["heal"]);
    const forced = await executeTool("remove_spectral_tones", { clipId: "c1", mode: "attenuate" }, setup(1, 3.5));
    expect((forced.data as { modes: string[] }).modes).toEqual(["attenuate"]);
    const bad = await executeTool("remove_spectral_tones", { clipId: "c1", mode: "bogus" }, setup(1, 3.5));
    expect(bad.ok).toBe(false);
  });
});
