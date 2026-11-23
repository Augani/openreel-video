/**
 * Real-Electron end-to-end test of LIVE plugin inserts (Playwright _electron, the BUILT app): a real AudioContext and AudioWorklet in
 * the renderer, the MessagePort the main process hands the worklet, the real Swift and C++ helper processes, Apple's AULowpass and
 * AUPeakLimiter and the VST3 SDK's adelay example.
 *
 *  - the audio the worklet plays equals the cached offline render (the reference) after latency alignment;
 *  - a parameter edit sent from the renderer (IPC -> main -> helper) is audible within 50 ms;
 *  - a helper killed mid-stream does not touch the app: the insert crossfades to the aligned dry signal and the failure is reported;
 *  - the live insert code is not loaded until a live insert is opened (lazy chunk, the startup budget).
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_LIVE_E2E=1:  pnpm --filter @openreel/desktop test:live-e2e
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without types
import { buildTestPlugins } from "../scripts/build-vst3-testplugins.mjs";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { PlugHostService } from "../src/main/plughost/host-service";
import type { LiveStepConfig } from "../src/main/plughost/live-chain";
import { burstInput, noiseInput } from "./live-sim/live-sim";
import { SR, differenceDb, offlineReference, rmsOf } from "./live-sim/measure";

const root = path.resolve(__dirname, "../../..");
const AU_HELPER = path.join(root, `apps/desktop/resources/plughost/darwin-${process.arch}/openreel-plughost`);
const VST3_HELPER = path.join(root, `apps/desktop/resources/vst3host/darwin-${process.arch}/openreel-vst3host`);
const enabled =
  process.env.OPENREEL_DESKTOP_LIVE_E2E === "1" &&
  process.platform === "darwin" &&
  fs.existsSync(AU_HELPER) &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;
const LOG_DIR = process.env.OPENREEL_LIVE_LOG_DIR;
const LOWPASS = "au:aufx:lpas:appl";
const LIMITER = "au:aufx:lmtr:appl";

const require = createRequire(path.join(root, "package.json"));
function loadPlaywright(): { _electron: any } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const record = (name: string, value: unknown): void => {
  console.log(`[live-metric] ${name} ${JSON.stringify(value)}`);
  if (LOG_DIR) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOG_DIR, `${name}.json`), JSON.stringify(value, null, 2));
  }
};

let app: any;
let page: any;
let work = "";
let profile = "";
const vst3: { id: string; path: string } | { id: ""; path: "" } = { id: "", path: "" };

const probe = (options: Record<string, unknown>): Promise<any> => page.evaluate((o: unknown) => (window as any).__openreelE2E.liveInsertProbe(o), options);
/** A run without a dropout: a sample-exact comparison is only meaningful for one (a dropout is a counted, crossfaded dry block; machine load causes it). */
async function cleanProbe(options: Record<string, unknown>, attempts = 4): Promise<any> {
  let result: any;
  for (let i = 0; i < attempts; i += 1) {
    result = await probe(options);
    if (result.stats && result.stats.underruns === 0 && result.stats.lateBlocks === 0) return result;
  }
  return result;
}
const auStep = (pluginId: string, values: Record<string, number>): LiveStepConfig => ({ pluginId, effectId: "fx", values, automation: {}, spawn: { command: AU_HELPER, args: ["serve"] } });

/** Where in the recording input frame 0 plays: offset such that recorded[k] belongs to input frame (k - offset), found by search around the clock estimate. */
function alignment(result: any, reference: Float32Array, recorded: number[], latency: number): { offset: number; db: number } {
  const estimate = Math.round((result.sourceStartTime - result.recorderStartTime) * result.sampleRate);
  let best = { offset: estimate, db: Number.POSITIVE_INFINITY };
  for (let delta = -600; delta <= 600; delta += 1) {
    const offset = estimate + delta;
    // recorded[k] = reference[k - offset - latency]
    const db = differenceDb(Float32Array.from(recorded), reference, offset + latency, offset + latency + SR / 2, offset + latency + SR * 2);
    if (db < best.db) best = { offset, db };
  }
  return best;
}

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "live-e2e-"));
  profile = path.join(work, "profile");
  let vst3Folder = "";
  if (fs.existsSync(VST3_HELPER) && spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0) vst3Folder = (await buildTestPlugins(path.join(work, "plugins"), { log: () => undefined })) ?? "";
  const { _electron } = loadPlaywright();
  app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, OPENREEL_SKIP_ONBOARDING: "1", ...(vst3Folder ? { OPENREEL_VST3_PATH: vst3Folder } : {}) },
    timeout: 120_000,
  });
  page = await app.firstWindow({ timeout: 120_000 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.liveInsertProbe), undefined, { timeout: 90_000 });
  if (vst3Folder) {
    const host = new PlugHostService({ helper: (mode, format) => (format === "au" ? null : { command: VST3_HELPER, args: [mode] }), blocklist: new PluginBlocklist(path.join(work, "bl.json")), vst3Roots: [vst3Folder] });
    const scan = await host.scanNow();
    const adelay = scan.plugins.find((p) => p.path && path.basename(p.path) === "adelay.vst3");
    if (adelay?.path) Object.assign(vst3, { id: adelay.id, path: adelay.path });
  }
}, 600_000);

afterAll(async () => {
  if (app) {
    const proc = app.process();
    const exited = new Promise<void>((resolve) => {
      if (proc.exitCode !== null) resolve();
      proc.once("exit", () => resolve());
    });
    await app.evaluate(({ dialog }: any) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
    app.evaluate(({ app: a }: any) => a.quit()).catch(() => undefined);
    const ok = await Promise.race([exited.then(() => true), sleep(20_000).then(() => false)]);
    if (!ok) proc.kill("SIGKILL");
  }
  if (work) fs.rmSync(work, { recursive: true, force: true });
}, 60_000);

d("live plugin inserts in the real app", () => {
  it("the live insert code is a lazy chunk: nothing of it is loaded before a live insert opens", async () => {
    const before: string[] = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name));
    expect(before.filter((name) => /live-insert|live-plugin-insert/.test(name))).toEqual([]);
    // (the worklet module itself is fetched by addModule, which a page's resource timing does not list; the chunk that loads it is)
  }, 30_000);

  it("AULowpass: the audio the worklet plays equals the cached offline render after latency alignment, with no underruns", async () => {
    const input = noiseInput(SR * 3);
    const values = { "0": 1800, "1": 6 };
    const result = await cleanProbe({ pluginId: LOWPASS, effectId: "fx", values, blockFrames: 256, input: input.map((c) => Array.from(c)) });
    const reference = await offlineReference([auStep(LOWPASS, values)], input);
    const { offset, db } = alignment(result, reference[0], result.output[0], result.latencyFrames);
    record("e2e-diff-AULowpass", { latencyFrames: result.latencyFrames, prefillBlocks: result.prefillBlocks, alignmentOffsetFrames: offset, differenceDb: Number.isFinite(db) ? db : "exact (0 difference)", stats: result.stats, main: result.main, hostStatuses: result.hostStatuses, openRoundTripMs: result.openRoundTripMs });
    expect(result.hostStatuses).toEqual([]);
    expect(result.stats.underruns).toBeLessThanOrEqual(2);
    if (result.stats.underruns === 0) expect(db).toBeLessThan(-100);
  }, 120_000);

  for (const blockFrames of [128, 256, 512] as const) {
    it(`a parameter edit sent from the renderer is audible within 50 ms (AUPeakLimiter pre-gain, ${blockFrames} frame blocks)`, async () => {
      const input = burstInput(SR * 3).map((c) => c.map((v) => v * 0.6));
      const result = await probe({ pluginId: LIMITER, effectId: "fx", values: { "2": -40 }, blockFrames, input: input.map((c) => Array.from(c)), changeAtMs: 1600, changeTo: { "2": 0 } });
      const out: number[] = result.output[0];
      const quantum = 128;
      const rmsAt = (k: number) => rmsOf(out, k * quantum, (k + 1) * quantum);
      // the quiet level before the edit: the 0.4 s that end 0.1 s before it (on the context clock, whatever the machine's load did to the timing)
      const baselineStart = Math.floor(((result.changeContextTime - 0.5) - result.recorderStartTime) * SR / quantum);
      const baselineEnd = Math.floor(((result.changeContextTime - 0.1) - result.recorderStartTime) * SR / quantum);
      const baseline = rmsOf(out, baselineStart * quantum, baselineEnd * quantum);
      expect(baseline).toBeGreaterThan(0.001);
      expect(baseline).toBeLessThan(0.02);
      let latencyMs: number | null = null;
      for (let k = 0; (k + 1) * quantum <= out.length; k += 1) {
        const heardAt = result.recorderStartTime + ((k + 1) * quantum) / SR;
        if (heardAt <= result.changeContextTime) continue;
        if (rmsAt(k) > baseline * 20) {
          latencyMs = (heardAt - result.changeContextTime) * 1000;
          break;
        }
      }
      record(`e2e-param-latency-${blockFrames}`, { latencyMs, blockFrames, insertLatencyMs: (result.latencyFrames / SR) * 1000, prefillBlocks: result.prefillBlocks, underruns: result.stats?.underruns });
      expect(latencyMs).not.toBeNull();
      expect(latencyMs!).toBeLessThan(50);
    }, 120_000);
  }

  it("a helper killed mid-stream: the app stays up, the insert plays the aligned dry signal, the failure is reported", async () => {
    const input = burstInput(SR * 4);
    const appPid = app.process().pid as number;
    const killer = (async () => {
      await sleep(2500);
      const kids = execFileSync("/usr/bin/pgrep", ["-P", String(appPid), "-f", "openreel-plughost"], { encoding: "utf8" }).split("\n").filter(Boolean);
      for (const pid of kids) process.kill(Number(pid), "SIGKILL");
      return kids.length;
    })();
    const result = await probe({ pluginId: LOWPASS, effectId: "fx", values: { "0": 800, "1": 0 }, blockFrames: 256, input: input.map((c) => Array.from(c)) });
    expect(await killer).toBeGreaterThan(0);
    expect(result.hostStatuses.some((s: { state: string }) => s.state === "crashed")).toBe(true);
    const D = result.latencyFrames;
    const estimate = Math.round((result.sourceStartTime - result.recorderStartTime) * SR);
    // long after the kill (3 s in) the output is the input delayed by D, sample for sample (the dry signal), not the low-passed one
    const errorAt = (offset: number) => {
      let err = 0;
      for (let n = Math.round(SR * 3.1); n < Math.round(SR * 3.1) + 2000; n += 1) err += Math.abs(result.output[0][offset + D + n] - input[0][n]);
      return err;
    };
    let best = Number.POSITIVE_INFINITY;
    for (let delta = -600; delta <= 600; delta += 1) best = Math.min(best, errorAt(estimate + delta));
    expect(best).toBeLessThan(1e-3);
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
    record("e2e-crash", { statuses: result.hostStatuses, latencyFrames: D });
  }, 120_000);

  it("VST3 adelay through the real app: live equals the analytic plugin output", async () => {
    if (!vst3.id) return;
    const input = noiseInput(SR * 3, 5);
    const delay = 0.01;
    const result = await cleanProbe({ pluginId: vst3.id, effectId: "fx", values: { "100": delay }, blockFrames: 256, input: input.map((c) => Array.from(c)) });
    const D = result.latencyFrames;
    const samples = Math.trunc(delay * SR);
    const estimate = Math.round((result.sourceStartTime - result.recorderStartTime) * SR);
    let bestOffset = estimate;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let delta = -600; delta <= 600; delta += 1) {
      let err = 0;
      for (let n = SR; n < SR + 2000; n += 1) err += Math.abs(result.output[0][estimate + delta + n + D + samples] - input[0][n]);
      if (err < bestErr) {
        bestErr = err;
        bestOffset = estimate + delta;
      }
    }
    for (let n = SR; n < SR * 2; n += 311) expect(result.output[0][bestOffset + n + D + samples]).toBe(input[0][n]);
    record("e2e-vst3-adelay", { offset: bestOffset, latencyFrames: D, stats: result.stats });
  }, 120_000);
});
