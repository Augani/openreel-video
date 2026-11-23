import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";
import type { EditingHost, SpectralSourceBridge } from "./host";

const SR = 48000;
const source = (): { mono: Float32Array; sampleRate: number; duration: number } => {
  const n = 3 * SR;
  const mono = new Float32Array(n);
  let seed = 5;
  for (let i = 0; i < n; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const t = i / SR;
    // A speech-like glide plus a steady 3.1 kHz whine from 0.5 s to 2.5 s, light noise, and one loud click at 1.5 s.
    mono[i] = 0.1 * Math.sin(2 * Math.PI * (200 * t + 20 * t * t)) + 0.04 * Math.sin(2 * Math.PI * 3100 * t) * (t > 0.5 && t < 2.5 ? 1 : 0) + 0.002 * (seed / 4294967296 - 0.5);
  }
  mono[Math.round(1.5 * SR)] += 2.5;
  mono[Math.round(1.5 * SR) + 1] -= 1.8;
  return { mono, sampleRate: SR, duration: 3 };
};

function setup(withBridge = true) {
  const history = new ActionHistory();
  const base = new HeadlessHost(makeProjectWithClip(), { history });
  const bridge: SpectralSourceBridge = { getSource: async () => source() };
  const host = (withBridge ? Object.assign(base, { spectralSource: bridge }) : base) as EditingHost & HeadlessHost;
  return { host, history };
}
const effect = (host: HeadlessHost) => (host.getProject().timeline.tracks[0].clips[0].audioEffects ?? []).find((e) => e.type === "spectralRepair");
const regionsOf = (host: HeadlessHost) => ((effect(host)?.params.regions as Array<Record<string, unknown>>) ?? []);

describe("spectral editing agent tools", () => {
  it("registers the lazy group in a stable place with the right flags", () => {
    for (const name of ["list_spectral_regions", "add_spectral_region", "update_spectral_region", "remove_spectral_region", "find_spectral_tones", "remove_spectral_tones", "remove_spectral_clicks", "add_spectral_magic_wand", "add_spectral_harmonic_region"]) {
      expect(getTool(name), name).toBeDefined();
    }
    expect(getTool("list_spectral_regions")?.readOnly).toBe(true);
    expect(getTool("find_spectral_tones")?.readOnly).toBe(true);
    expect(getTool("add_spectral_region")?.readOnly).toBe(false);
    expect(getTool("remove_spectral_region")?.destructive).toBe(true);
  });

  it("adds rect, band, lasso and brush regions, each as one undo step, and lists them", async () => {
    const { host, history } = setup(false);
    const before = history.getDisplayHistory().length;
    const empty = await executeTool("list_spectral_regions", { clipId: "c1" }, host);
    expect((empty.data as { regions: unknown[] }).regions).toEqual([]);

    const rect = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", mode: "attenuate", startTime: 0.5, endTime: 1, lowHz: 500, highHz: 900, gainDb: -18 }, host);
    expect(rect.ok).toBe(true);
    const band = await executeTool("add_spectral_region", { clipId: "c1", shape: "band", mode: "remove", lowHz: 50, highHz: 70 }, host);
    expect(band.ok).toBe(true);
    const lasso = await executeTool("add_spectral_region", { clipId: "c1", shape: "lasso", points: [{ t: 1, hz: 400 }, { t: 2, hz: 800 }, { t: 1.5, hz: 3000 }], feather: 3 }, host);
    expect(lasso.ok).toBe(true);
    const brush = await executeTool("add_spectral_region", { clipId: "c1", shape: "brush", points: [{ t: 1, hz: 1000 }, { t: 2, hz: 2000 }], brushSeconds: 0.05, brushOctaves: 0.1 }, host);
    expect(brush.ok).toBe(true);
    expect(history.getDisplayHistory().length).toBe(before + 4);

    const listed = (await executeTool("list_spectral_regions", { clipId: "c1" }, host)).data as { regions: Array<Record<string, unknown>> };
    expect(listed.regions.map((r) => [r.mode, r.shape])).toEqual([["attenuate", "rect"], ["remove", "rect"], ["remove", "lasso"], ["remove", "brush"]]);
    expect(listed.regions[0].gainDb).toBe(-18);
    expect(listed.regions[2].feather).toBe(3);
    expect(effect(host)?.params.version).toBe(2);

    expect(regionsOf(host)).toHaveLength(4);
  });

  it("updates mode, gain, visibility and geometry as one step each, and removes one or all", async () => {
    const { host, history } = setup(false);
    const added = await executeTool("add_spectral_region", { clipId: "c1", shape: "lasso", points: [{ t: 1, hz: 400 }, { t: 2, hz: 800 }, { t: 1.5, hz: 3000 }] }, host);
    const id = (added.data as { regionId: string }).regionId;
    const steps = history.getDisplayHistory().length;
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: id, mode: "attenuate", gainDb: -9 }, host)).ok).toBe(true);
    expect(regionsOf(host)[0]).toMatchObject({ mode: "attenuate", gainDb: -9 });
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: id, enabled: false }, host)).ok).toBe(true);
    expect(regionsOf(host)[0].enabled).toBe(false);
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: id, points: [{ t: 1, hz: 400 }, { t: 3, hz: 800 }, { t: 1.5, hz: 3000 }] }, host)).ok).toBe(true);
    expect(regionsOf(host)[0].endTime).toBe(3);
    expect(history.getDisplayHistory().length).toBe(steps + 3);
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: "nope", enabled: true }, host)).error?.code).toBe("REGION_NOT_FOUND");
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: id, mode: "melt" }, host)).ok).toBe(false);

    await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 0, endTime: 1, lowHz: 100, highHz: 200 }, host);
    expect(regionsOf(host)).toHaveLength(2);
    expect((await executeTool("remove_spectral_region", { clipId: "c1", regionId: id }, host)).ok).toBe(true);
    expect(regionsOf(host)).toHaveLength(1);
    expect((await executeTool("remove_spectral_region", { clipId: "c1", all: true }, host)).ok).toBe(true);
    expect(effect(host)).toBeUndefined();
    expect((await executeTool("remove_spectral_region", { clipId: "c1" }, host)).ok).toBe(false);
  });

  it("rejects bad input without changing the clip", async () => {
    const { host, history } = setup(false);
    const steps = history.getDisplayHistory().length;
    expect((await executeTool("add_spectral_region", {}, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_region", { clipId: "nope", lowHz: 1, highHz: 2 }, host)).error?.code).toBe("CLIP_NOT_FOUND");
    expect((await executeTool("add_spectral_region", { clipId: "c1", shape: "blob" }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_region", { clipId: "c1", shape: "lasso", points: [{ t: 1, hz: 100 }, { t: 2, hz: 100 }] }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 1, endTime: 1, lowHz: 100, highHz: 200 }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", mode: "zap", startTime: 0, endTime: 1, lowHz: 100, highHz: 200 }, host)).ok).toBe(false);
    expect(history.getDisplayHistory().length).toBe(steps);
    expect(effect(host)).toBeUndefined();
  });

  it("finds a steady tone and a click, heals them in one undo step each, and honours dryRun", async () => {
    const { host, history } = setup();
    const found = await executeTool("find_spectral_tones", { clipId: "c1" }, host);
    const tones = (found.data as { tones: Array<{ hz: number; startTime: number; endTime: number }> }).tones;
    expect(tones.length).toBeGreaterThanOrEqual(1);
    expect(tones[0].hz).toBeGreaterThan(3080);
    expect(tones[0].hz).toBeLessThan(3120);
    expect(effect(host)).toBeUndefined();

    const steps = history.getDisplayHistory().length;
    const removed = await executeTool("remove_spectral_tones", { clipId: "c1", hz: 3100 }, host);
    expect(removed.ok).toBe(true);
    expect(history.getDisplayHistory().length).toBe(steps + 1);
    expect(regionsOf(host)).toHaveLength(1);
    expect(regionsOf(host)[0]).toMatchObject({ mode: "remove" });
    expect((removed.data as { modes: string[] }).modes).toEqual(["remove"]);
    expect((await executeTool("remove_spectral_tones", { clipId: "c1", hz: 8000 }, host)).summary).toMatch(/nothing changed/);
    expect(regionsOf(host)).toHaveLength(1);

    const dry = await executeTool("remove_spectral_clicks", { clipId: "c1", dryRun: true }, host);
    const clicks = (dry.data as { clicks: Array<{ time: number }> }).clicks;
    expect(clicks).toHaveLength(1);
    expect(Math.abs(clicks[0].time - 1.5)).toBeLessThan(0.01);
    expect(regionsOf(host)).toHaveLength(1);
    const healed = await executeTool("remove_spectral_clicks", { clipId: "c1" }, host);
    expect(healed.ok).toBe(true);
    expect(regionsOf(host)).toHaveLength(2);
    expect(history.getDisplayHistory().length).toBe(steps + 2);
  });

  it("defaults a partial-duration selection to remove and a whole-source selection or band to heal", async () => {
    const { host } = setup(false);
    const partial = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 1, endTime: 1.5, lowHz: 3000, highHz: 3200 }, host);
    expect((partial.data as { mode: string }).mode).toBe("remove");
    const band = await executeTool("add_spectral_region", { clipId: "c1", shape: "band", lowHz: 50, highHz: 70 }, host);
    expect((band.data as { mode: string }).mode).toBe("heal");
    const whole = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 0, endTime: 5, lowHz: 100, highHz: 200 }, host);
    expect((whole.data as { mode: string }).mode).toBe("heal");
    const asked = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", mode: "heal", startTime: 1, endTime: 1.5, lowHz: 3000, highHz: 3200 }, host);
    expect((asked.data as { mode: string }).mode).toBe("heal");
  });

  it("warns when an explicit heal covers only a slice of a steady partial, and not for a remove", async () => {
    const { host } = setup();
    const slice = { clipId: "c1", shape: "rect", startTime: 1.2, endTime: 1.6, lowHz: 3050, highHz: 3150 };
    const healed = await executeTool("add_spectral_region", { ...slice, mode: "heal" }, host);
    expect(healed.ok).toBe(true);
    expect((healed.data as { warning?: string }).warning).toMatch(/continues on both sides/);
    const removed = await executeTool("add_spectral_region", slice, host);
    expect((removed.data as { warning?: string; mode: string }).warning).toBeUndefined();
    expect((removed.data as { mode: string }).mode).toBe("remove");
  });

  it("lets the caller choose the mode of tone and click removal, with heal warned on a continuing tone", async () => {
    const { host } = setup();
    const attenuated = await executeTool("remove_spectral_tones", { clipId: "c1", hz: 3100, mode: "attenuate" }, host);
    expect((attenuated.data as { modes: string[] }).modes).toEqual(["attenuate"]);
    expect(regionsOf(host)[0]).toMatchObject({ mode: "attenuate", gainDb: -12 });
    expect((await executeTool("remove_spectral_tones", { clipId: "c1", mode: "melt" }, host)).ok).toBe(false);
    const clicks = await executeTool("remove_spectral_clicks", { clipId: "c1", mode: "remove" }, host);
    expect(clicks.ok).toBe(true);
    expect(regionsOf(host)[1]).toMatchObject({ mode: "remove" });
  });

  it("explains that finding needs the live decoder on a headless host", async () => {
    const { host } = setup(false);
    expect((await executeTool("find_spectral_tones", { clipId: "c1" }, host)).error?.code).toBe("UNSUPPORTED_HOST");
    expect((await executeTool("remove_spectral_clicks", { clipId: "c1" }, host)).error?.code).toBe("UNSUPPORTED_HOST");
  });

  it("adds a magic-wand region at the whine as one undo step, stores its cells, and lists and re-runs it", async () => {
    const { host, history } = setup();
    const steps = history.getDisplayHistory().length;
    const added = await executeTool("add_spectral_magic_wand", { clipId: "c1", time: 1.5, hz: 3105, toleranceDb: 6, channel: "left" }, host);
    expect(added.ok).toBe(true);
    expect(history.getDisplayHistory().length).toBe(steps + 1);
    const data = added.data as { regionId: string; cells: number; startTime: number; endTime: number; lowHz: number; highHz: number; mode: string };
    expect(data.mode).toBe("remove");
    expect(data.cells).toBeGreaterThan(100);
    expect(data.lowHz).toBeLessThan(3100);
    expect(data.highHz).toBeGreaterThan(3100);
    expect(data.endTime - data.startTime).toBeGreaterThan(1.5);
    const stored = regionsOf(host)[0] as { shape: string; channel: string; wand: { runs: number[]; seed: { hz: number }; toleranceDb: number } };
    expect(stored).toMatchObject({ shape: "wand", channel: "left" });
    expect(stored.wand.runs.length).toBeGreaterThan(1);
    expect(effect(host)?.params.version).toBe(3);
    const listed = (await executeTool("list_spectral_regions", { clipId: "c1" }, host)).data as { regions: Array<Record<string, unknown>> };
    expect(listed.regions[0]).toMatchObject({ shape: "wand", channel: "left", wand: { toleranceDb: 6, localContrast: false } });
    expect(JSON.stringify(listed.regions[0])).not.toContain("runs");
    // Re-running with another tolerance replaces the cells in one step; the seed is kept.
    const before = history.getDisplayHistory().length;
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: data.regionId, toleranceDb: 3, channel: "right" }, host)).ok).toBe(true);
    expect(history.getDisplayHistory().length).toBe(before + 1);
    expect(regionsOf(host)[0]).toMatchObject({ channel: "right", wand: { toleranceDb: 3 } });
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: data.regionId, channel: "both" }, host)).ok).toBe(true);
    expect((regionsOf(host)[0] as { channel?: string }).channel).toBeUndefined();
    // A seed outside the audio and a bad channel change nothing.
    const count = history.getDisplayHistory().length;
    expect((await executeTool("add_spectral_magic_wand", { clipId: "c1", time: 99, hz: 3100 }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_magic_wand", { clipId: "c1", time: 1.5, hz: 3100, channel: "middle" }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_magic_wand", { clipId: "c1", time: 1.5 }, host)).ok).toBe(false);
    expect(history.getDisplayHistory().length).toBe(count);
  });

  it("adds a harmonic region that tracks the glide from a point or a box, as one undo step", async () => {
    const { host, history } = setup();
    const steps = history.getDisplayHistory().length;
    const added = await executeTool("add_spectral_harmonic_region", { clipId: "c1", time: 1.5, hz: 262, harmonics: 1, bandCents: 60 }, host);
    expect(added.ok).toBe(true);
    expect(history.getDisplayHistory().length).toBe(steps + 1);
    const data = added.data as { regionId: string; f0Start: number; f0End: number; startTime: number; endTime: number; trackPoints: number; mode: string };
    // The test source glides 200 + 40 t Hz (200 Hz at 0 s to 320 Hz at 3 s).
    expect(Math.abs(data.f0Start - 200)).toBeLessThan(15);
    expect(Math.abs(data.f0End - 320)).toBeLessThan(10);
    expect(data.startTime).toBeLessThan(0.1);
    expect(data.endTime).toBeGreaterThan(2.9);
    expect(data.mode).toBe("remove");
    const stored = regionsOf(host)[0] as { shape: string; harmonic: { harmonics: number; bandCents: number }; points: unknown[] };
    expect(stored).toMatchObject({ shape: "harmonic", harmonic: { harmonics: 1, bandCents: 60 } });
    expect(stored.points.length).toBe(data.trackPoints);
    const listed = (await executeTool("list_spectral_regions", { clipId: "c1" }, host)).data as { regions: Array<Record<string, unknown>> };
    expect(listed.regions[0].points).toBeUndefined();
    expect(listed.regions[0].harmonic).toMatchObject({ harmonics: 1, trackPoints: data.trackPoints });
    // update: the series settings are one step.
    const id = data.regionId;
    const before = history.getDisplayHistory().length;
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: id, harmonics: 3, bandCents: 80, channel: "left" }, host)).ok).toBe(true);
    expect(history.getDisplayHistory().length).toBe(before + 1);
    expect(regionsOf(host)[0]).toMatchObject({ channel: "left", harmonic: { harmonics: 3, bandCents: 80 } });
    expect((await executeTool("update_spectral_region", { clipId: "c1", regionId: id, toleranceDb: 3 }, host)).ok).toBe(true);
    // A box takes the strongest peak inside it and tracks only inside its time span.
    const boxed = await executeTool("add_spectral_harmonic_region", { clipId: "c1", startTime: 1, endTime: 2, lowHz: 200, highHz: 400, harmonics: 1 }, host);
    expect(boxed.ok).toBe(true);
    const boxData = boxed.data as { startTime: number; endTime: number };
    expect(boxData.startTime).toBeGreaterThanOrEqual(0.95);
    expect(boxData.endTime).toBeLessThanOrEqual(2.05);
    // Bad input changes nothing.
    const count = history.getDisplayHistory().length;
    expect((await executeTool("add_spectral_harmonic_region", { clipId: "c1" }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_harmonic_region", { clipId: "c1", time: 1, hz: 3 }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_harmonic_region", { clipId: "c1", time: 1, hz: 262, channel: "x" }, host)).ok).toBe(false);
    expect(history.getDisplayHistory().length).toBe(count);
  });

  it("takes a channel on the plain add tool, and the wand and harmonic tools need the live decoder", async () => {
    const { host } = setup(false);
    const added = await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", mode: "attenuate", startTime: 0.5, endTime: 1, lowHz: 500, highHz: 900, channel: "right" }, host);
    expect(added.ok).toBe(true);
    expect(regionsOf(host)[0]).toMatchObject({ channel: "right" });
    expect(effect(host)?.params.version).toBe(3);
    expect((await executeTool("add_spectral_region", { clipId: "c1", shape: "rect", startTime: 0.5, endTime: 1, lowHz: 500, highHz: 900, channel: "side" }, host)).ok).toBe(false);
    expect((await executeTool("add_spectral_magic_wand", { clipId: "c1", time: 1, hz: 500 }, host)).error?.code).toBe("UNSUPPORTED_HOST");
    expect((await executeTool("add_spectral_harmonic_region", { clipId: "c1", time: 1, hz: 262 }, host)).error?.code).toBe("UNSUPPORTED_HOST");
  });
});
