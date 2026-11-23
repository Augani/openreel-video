/**
 * Live (realtime) plugin inserts against the real VST3 helper and the VST3 SDK's own "adelay" example, built in the test setup
 * into a temp folder (never committed): live output against the plugin's analytic output and against the cached offline render,
 * the plugin's reported latency, a parameter change heard within 50 ms, and a plugin that segfaults or hangs mid-stream.
 *
 * Timing sensitive (a wall-clock audio thread): opt in with OPENREEL_LIVE_REALTIME=1 (pnpm --filter @openreel/desktop test:live-realtime).
 * Needs the built helper (pnpm --filter @openreel/desktop build:vst3host), CMake and, on the first run, network access for the pinned
 * SDK (cached under apps/desktop/.cache); skipped when any of that is missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without types
import { buildTestPlugins } from "../scripts/build-vst3-testplugins.mjs";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { PlugHostService } from "../src/main/plughost/host-service";
import { LiveChain, type LiveStepConfig } from "../src/main/plughost/live-chain";
import { burstInput, noiseInput, runLiveSim } from "./live-sim/live-sim";
import { QUANTUM, SR, audioThreadStarved, audibleLatencyMs, cleanRun, differenceDb, offlineReference, rmsOf, sampleChange } from "./live-sim/measure";

const exe = process.platform === "win32" ? "openreel-vst3host.exe" : "openreel-vst3host";
const HELPER = process.env.OPENREEL_VST3HOST_PATH ?? path.resolve(__dirname, `../resources/vst3host/${process.platform}-${process.arch}/${exe}`);
const hasCmake = spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0;
const enabled = process.env.OPENREEL_LIVE_REALTIME === "1" && existsSync(HELPER) && hasCmake;
const d = enabled ? describe : describe.skip;
const DELAY_PARAM = "100";
const LOG_DIR = process.env.OPENREEL_LIVE_LOG_DIR;

let work = "";
let folder = "";
const found = new Map<string, { id: string; path: string }>();

const step = (name: string, values: Record<string, number> = {}, effectId = name): LiveStepConfig => {
  const plugin = found.get(name);
  if (!plugin) throw new Error(`test plugin ${name} was not built`);
  return { pluginId: plugin.id, effectId, values, automation: {}, spawn: { command: HELPER, args: ["serve"] }, pluginPath: plugin.path };
};
const record = (name: string, value: unknown): void => {
  console.log(`[live-metric] ${name} ${JSON.stringify(value)}`);
  if (LOG_DIR) {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(path.join(LOG_DIR, `${name}.json`), JSON.stringify(value, null, 2));
  }
};

beforeAll(async () => {
  if (!enabled) return;
  work = mkdtempSync(path.join(os.tmpdir(), "live-vst3-"));
  folder = (await buildTestPlugins(path.join(work, "plugins"), { log: () => undefined })) ?? "";
  const host = new PlugHostService({ helper: (mode, format) => (format === "au" ? null : { command: HELPER, args: [mode] }), blocklist: new PluginBlocklist(path.join(work, "bl.json")), vst3Roots: [folder] });
  const scan = await host.scanNow();
  for (const p of scan.plugins) if (p.path && p.format === "vst3") found.set(path.basename(p.path, ".vst3"), { id: p.id, path: p.path });
  // the crash/hang/NaN builds are blocked by the scan (that is the scan's job); live inserts need their ids anyway to be opened directly
  for (const name of ["adelay", "adelay_latency", "adelay_crash_late", "adelay_hang", "adelay_nan"]) {
    if (!found.has(name)) {
      const bundle = path.join(folder, `${name}.vst3`);
      if (existsSync(bundle)) found.set(name, { id: scan.plugins.find((p) => p.path === bundle)?.id ?? "", path: bundle });
    }
  }
}, 300_000);
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

d("live inserts on the VST3 SDK's adelay example", () => {
  it("the live output is the plugin's analytic output, delayed by the reported insert latency, and equals the offline render", async () => {
    const seconds = 4;
    const delay = 0.01;
    const input = noiseInput(SR * seconds);
    const chainSteps = [step("adelay", { [DELAY_PARAM]: delay })];
    const result = await cleanRun(() => runLiveSim({ steps: chainSteps, blockFrames: 256, seconds, input, record: true }));
    expect(result.chain.failed).toBeNull();
    if (!audioThreadStarved(result)) expect(result.stats.underruns).toBeLessThanOrEqual(Math.max(2, Math.ceil(result.stats.blocksSent * 0.01)));
    const D = result.latencyFrames;
    const samples = Math.max(1, Math.trunc(delay * SR));
    for (let n = D + SR / 2; n < SR * seconds - 1024; n += 977) expect(result.recorded![0][n]).toBe(input[0][n - D - samples]);
    const reference = await offlineReference(chainSteps, input);
    const db = differenceDb(result.recorded![0], reference[0], D, D + SR / 4, SR * seconds - 512);
    record("diff-adelay-vst3", { latencyFrames: D, differenceDb: Number.isFinite(db) ? db : "exact (0 difference)", prefillBlocks: result.prefillBlocks, roundTripMs: result.open.roundTripMs });
    expect(db).toBeLessThan(-100);
  }, 120_000);

  it("a plugin that reports 100 samples of latency: the insert reports D = J * B + 100 and the output lines up with the offline render", async () => {
    const seconds = 3;
    const input = noiseInput(SR * seconds, 11);
    const chainSteps = [step("adelay_latency", { [DELAY_PARAM]: 0.005 })];
    const result = await cleanRun(() => runLiveSim({ steps: chainSteps, blockFrames: 128, seconds, input, record: true }));
    expect(result.open.pluginLatencyFrames).toBe(100);
    expect(result.latencyFrames).toBe(result.prefillBlocks * 128 + 100);
    const reference = await offlineReference(chainSteps, input);
    expect(differenceDb(result.recorded![0], reference[0], result.latencyFrames, result.latencyFrames + SR / 4, SR * seconds - 512)).toBeLessThan(-100);
  }, 120_000);

  for (const blockFrames of [128, 256, 512] as const) {
    it(`parameter change is audible within 50 ms at ${blockFrames} frame blocks`, async () => {
      const seconds = 3;
      // delay 0.5 s then 0.05 s on a 440 Hz tone that starts at 1.0 s: the output goes from silent (tone still in the delay line) to audible
      const input = burstInput(SR * seconds).map((c) => Float32Array.from(c, (v, i) => (i >= SR * 1.0 ? v : 0)));
      let changedAt = 0n;
      const result = await runLiveSim({
        steps: [step("adelay", { [DELAY_PARAM]: 0.9 })],
        blockFrames,
        seconds,
        input,
        during: async (chain, control) => {
          changedAt = await sampleChange(chain, 1500, control, () => chain.setValues("adelay", { [DELAY_PARAM]: 0.001 }));
        },
      });
      // up to the change the delay (0.9 s) keeps the tone out; afterwards the 1 ms delay passes it at once
      const before = rmsOf(result.rms.slice(Math.floor((SR * 1.2) / QUANTUM), Math.floor((SR * 1.45) / QUANTUM)));
      expect(before).toBeLessThan(0.01);
      const latency = audibleLatencyMs(result, changedAt, (rms) => rms > 0.15);
      record(`param-latency-vst3-${blockFrames}`, { latencyMs: latency, blockFrames, prefillBlocks: result.prefillBlocks, insertLatencyMs: (result.latencyFrames / SR) * 1000 });
      expect(latency).not.toBeNull();
      expect(latency!).toBeLessThan(50);
    }, 60_000);
  }

  it("a plugin that segfaults after 60 blocks: the stream crossfades to the aligned dry signal, the failure is reported, nothing throws into the app", async () => {
    const seconds = 3;
    const input = burstInput(SR * seconds);
    const result = await runLiveSim({ steps: [step("adelay_crash_late", { [DELAY_PARAM]: 0.0 })], blockFrames: 256, seconds, input, record: true });
    expect(result.chain.failed).toMatch(/killed by|exited with code/);
    expect(result.hostFailed).toBeTruthy();
    const D = result.latencyFrames;
    const n = SR * 2;
    expect(result.recorded![0][n]).toBeCloseTo(input[0][n - D], 4);
    let worst = 0;
    for (let i = 1; i < result.recorded![0].length; i += 1) worst = Math.max(worst, Math.abs(result.recorded![0][i] - result.recorded![0][i - 1]));
    expect(worst).toBeLessThan(0.2);
  }, 60_000);

  it("a plugin that hangs is killed on the block deadline and reported at open (no live insert, no hang of the app)", async () => {
    const chain = new LiveChain({ steps: [step("adelay_hang")], sampleRate: SR, blockFrames: 256, post: () => undefined, blockTimeoutMs: 500, openTimeoutMs: 10_000 });
    await expect(chain.open()).rejects.toThrow(/did not answer|exited|killed/);
    expect(chain.pids).toEqual([]);
  }, 60_000);

  it("a plugin that returns NaN is stopped at the first bad block", async () => {
    // NaN is caught by the live path while streaming (open's silent warm-up block is not checked); drive it like the worklet does
    const posted: Array<Record<string, unknown>> = [];
    const probe = new LiveChain({ steps: [step("adelay_nan")], sampleRate: SR, blockFrames: 256, post: (m) => posted.push(m) });
    await probe.open().catch(() => undefined);
    probe.onMessage({ t: "epoch", epoch: 1, seconds: 0 });
    probe.onMessage({ t: "in", epoch: 1, seq: 0, data: new Float32Array(512).fill(0.1) });
    await new Promise((r) => setTimeout(r, 500));
    expect(posted.some((m) => m.t === "status" && m.state === "crashed")).toBe(true);
    expect(probe.failed).toMatch(/NaN|infinite/);
    probe.dispose();
  }, 60_000);
});
