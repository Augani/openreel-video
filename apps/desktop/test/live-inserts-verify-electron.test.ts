/**
 * Independent verification of live plugin inserts in the real Electron app (different signals and parameters than
 * live-inserts-electron.test.ts): crash/hang peak and click measurement, parameter-to-audible latency per block size,
 * live-vs-offline difference with other parameters, and underruns with several concurrent inserts under CPU load.
 *
 * Opt in with OPENREEL_DESKTOP_LIVE_VERIFY_E2E=1 (needs a VITE_OPENREEL_E2E=1 desktop build). Metrics go to OPENREEL_LIVE_LOG_DIR.
 */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveStepConfig } from "../src/main/plughost/live-chain";
import { burstInput, noiseInput } from "./live-sim/live-sim";
import { SR, differenceDb, offlineReference, rmsOf } from "./live-sim/measure";

const root = path.resolve(__dirname, "../../..");
const AU_HELPER = path.join(root, `apps/desktop/resources/plughost/darwin-${process.arch}/openreel-plughost`);
const enabled =
  process.env.OPENREEL_DESKTOP_LIVE_VERIFY_E2E === "1" &&
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
  console.log(`[verify-metric] ${name} ${JSON.stringify(value)}`);
  if (LOG_DIR) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOG_DIR, `${name}.json`), JSON.stringify(value, null, 2));
  }
};

let app: any;
let page: any;
let work = "";
const probe = (options: Record<string, unknown>): Promise<any> => page.evaluate((o: unknown) => (window as any).__openreelE2E.liveInsertProbe(o), options);
const toArr = (input: Float32Array[]) => input.map((c) => Array.from(c));
const sine = (frames: number, hz: number, amp: number): Float32Array[] => {
  const c = Float32Array.from({ length: frames }, (_, n) => amp * Math.sin((2 * Math.PI * hz * n) / SR));
  return [c, Float32Array.from(c)];
};
const maxAbs = (a: ArrayLike<number>, from: number, to: number): number => {
  let m = 0;
  for (let i = from; i < to; i += 1) m = Math.max(m, Math.abs(a[i]));
  return m;
};
const maxStep = (a: ArrayLike<number>, from: number, to: number): number => {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i += 1) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
  return m;
};
const helperPids = (): number[] => {
  const appPid = app.process().pid as number;
  try {
    return execFileSync("/usr/bin/pgrep", ["-P", String(appPid), "-f", "openreel-plughost"], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
};
const auStep = (pluginId: string, values: Record<string, number>): LiveStepConfig => ({ pluginId, effectId: "fx", values, automation: {}, spawn: { command: AU_HELPER, args: ["serve"] } });

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "live-verify-"));
  const { _electron } = loadPlaywright();
  app = await _electron.launch({ args: [path.join(root, "apps/desktop"), `--user-data-dir=${path.join(work, "profile")}`], env: { ...process.env, OPENREEL_SKIP_ONBOARDING: "1" }, timeout: 120_000 });
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

d("live inserts, independent verification", () => {
  for (const [label, signal, hz, killAtMs] of [["sine-1k-0.9", "kill", 1000, 2600], ["sine-220-0.95", "kill", 220, 3200]] as const) {
    it(`SIGKILL mid-playback (${label}): peak never exceeds the louder of dry/wet and no click`, async () => {
      void signal;
      const amp = label.endsWith("0.9") ? 0.9 : 0.95;
      const input = sine(SR * 5, hz, amp);
      const killer = (async () => {
        await sleep(killAtMs);
        const kids = helperPids();
        for (const pid of kids) process.kill(pid, "SIGKILL");
        return kids.length;
      })();
      const result = await probe({ pluginId: LOWPASS, effectId: "fx", values: { "0": 400, "1": 0 }, blockFrames: 256, input: toArr(input) });
      expect(await killer).toBeGreaterThan(0);
      expect(result.hostStatuses.some((s: { state: string }) => s.state === "crashed")).toBe(true);
      const out: number[] = result.output[0];
      const start = Math.round((result.sourceStartTime - result.recorderStartTime) * SR);
      const from = start + 2048;
      const to = Math.min(out.length, start + SR * 5);
      const peak = maxAbs(out, from, to);
      const step = maxStep(out, from, to);
      const dryStep = 2 * Math.PI * hz / SR * amp;
      // the louder of the two steady signals: the dry sine, and the plugin's own output before the kill (a resonant low-pass can be louder than its input)
      const windows: number[] = [];
      for (let k = from; k + 2048 <= to; k += 2048) windows.push(maxAbs(out, k, k + 2048));
      const wetPeak = Math.max(...windows.slice(0, Math.max(1, result.stats.wetBlocks > 20 ? Math.floor((result.stats.wetBlocks * 256) / 2048) - 2 : 1)));
      record(`verify-crash-${label}`, { peak, wetPeak, windows, maxStep: step, dryMaxStep: dryStep, statuses: result.hostStatuses, stats: result.stats });
      expect(peak).toBeLessThanOrEqual(Math.max(amp, wetPeak) * 1.001);
      expect(step).toBeLessThan(dryStep * 2.2 + 0.01);
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
    }, 120_000);
  }

  it("SIGSTOP for 400 ms then SIGCONT: no loud click, the insert recovers", async () => {
    const amp = 0.9;
    const input = sine(SR * 6, 700, amp);
    const stopper = (async () => {
      await sleep(2800);
      const kids = helperPids();
      for (const pid of kids) process.kill(pid, "SIGSTOP");
      await sleep(400);
      for (const pid of kids) process.kill(pid, "SIGCONT");
      return kids.length;
    })();
    const result = await probe({ pluginId: LOWPASS, effectId: "fx", values: { "0": 350, "1": 0 }, blockFrames: 256, input: toArr(input) });
    expect(await stopper).toBeGreaterThan(0);
    const out: number[] = result.output[0];
    const start = Math.round((result.sourceStartTime - result.recorderStartTime) * SR);
    const peak = maxAbs(out, start + 2048, Math.min(out.length, start + SR * 6));
    const step = maxStep(out, start + 2048, Math.min(out.length, start + SR * 6));
    record("verify-sigstop-400ms", { peak, maxStep: step, stats: result.stats, statuses: result.hostStatuses });
    expect(peak).toBeLessThanOrEqual(amp * 1.001);
    expect(step).toBeLessThan(2 * Math.PI * 700 / SR * amp * 2.2 + 0.01);
  }, 120_000);

  for (const blockFrames of [128, 256, 512] as const) {
    it(`parameter to audible, 3 repeats (AUPeakLimiter pre-gain -40 to -10, 0.3 bursts, ${blockFrames})`, async () => {
      const values: number[] = [];
      for (let rep = 0; rep < 3; rep += 1) {
        const input = burstInput(SR * 3).map((c) => c.map((v) => v * 0.3));
        const result = await probe({ pluginId: LIMITER, effectId: "fx", values: { "2": -40 }, blockFrames, input: toArr(input), changeAtMs: 1400 + rep * 37, changeTo: { "2": -10 } });
        const out: number[] = result.output[0];
        const q = 128;
        const b0 = Math.floor((result.changeContextTime - 0.5 - result.recorderStartTime) * SR / q);
        const b1 = Math.floor((result.changeContextTime - 0.1 - result.recorderStartTime) * SR / q);
        const baseline = rmsOf(out, b0 * q, b1 * q);
        let ms: number | null = null;
        for (let k = 0; (k + 1) * q <= out.length; k += 1) {
          const heardAt = result.recorderStartTime + ((k + 1) * q) / SR;
          if (heardAt <= result.changeContextTime) continue;
          if (rmsOf(out, k * q, (k + 1) * q) > baseline * 10) { ms = (heardAt - result.changeContextTime) * 1000; break; }
        }
        if (ms !== null) values.push(ms);
      }
      record(`verify-param-latency-${blockFrames}`, { samplesMs: values });
      expect(values.length).toBeGreaterThanOrEqual(2);
      expect(Math.min(...values)).toBeLessThan(50);
    }, 240_000);
  }

  for (const [name, pluginId, values, blockFrames] of [["lowpass-5k", LOWPASS, { "0": 5000, "1": -3 }, 128], ["lowpass-5k", LOWPASS, { "0": 5000, "1": -3 }, 512], ["limiter+6dB", LIMITER, { "2": 6 }, 256]] as const) {
    it(`live equals offline after alignment (${name}, ${blockFrames}, noise seed 9)`, async () => {
      const input = noiseInput(SR * 3, 9);
      let result: any;
      for (let i = 0; i < 4; i += 1) {
        result = await probe({ pluginId, effectId: "fx", values, blockFrames, input: toArr(input) });
        if (result.stats.underruns === 0 && result.stats.lateBlocks === 0) break;
      }
      const reference = await offlineReference([auStep(pluginId, { ...values })], input);
      const estimate = Math.round((result.sourceStartTime - result.recorderStartTime) * SR);
      let best = Number.POSITIVE_INFINITY;
      let bestLatency = 0;
      for (const latency of [result.latencyFrames, result.latencyFrames - result.pluginLatencyFrames, result.latencyFrames + result.pluginLatencyFrames]) {
        for (let delta = -600; delta <= 600; delta += 1) {
          const offset = estimate + delta;
          const db = differenceDb(Float32Array.from(result.output[0]), reference[0], offset + latency, offset + latency + SR / 2, offset + latency + SR * 2);
          if (db < best) { best = db; bestLatency = latency; }
        }
      }
      record(`verify-diff-${name}-${blockFrames}`, { differenceDb: Number.isFinite(best) ? best : "exact", bestLatency, latencyFrames: result.latencyFrames, pluginLatencyFrames: result.pluginLatencyFrames, stats: result.stats });
      if (result.stats.underruns === 0) expect(best).toBeLessThan(-100);
    }, 240_000);
  }

  it("four concurrent inserts for 12 s under 6 CPU burners: underruns counted, never an error, crossfaded output bounded", async () => {
    const burners = Array.from({ length: 6 }, () => spawn("/usr/bin/yes", [], { stdio: ["ignore", "ignore", "ignore"] }));
    try {
      const amp = 0.8;
      const input = sine(SR * 12, 523, amp);
      const specs = [LOWPASS, LIMITER, LOWPASS, LIMITER].map((id, i) => ({ pluginId: id, effectId: "fx", values: id === LOWPASS ? { "0": 3000 + i * 200, "1": 0 } : { "2": 0 }, blockFrames: 256, input: toArr(input) }));
      const results: any[] = await Promise.all(specs.map((s) => probe(s)));
      const summary = results.map((r) => {
        const start = Math.round((r.sourceStartTime - r.recorderStartTime) * SR);
        const out: number[] = r.output[0];
        return { underruns: r.stats.underruns, lateBlocks: r.stats.lateBlocks, blocks: r.stats.blocksSent, peak: maxAbs(out, start + 4096, out.length - 4096), hostStatuses: r.hostStatuses, main: r.main };
      });
      record("verify-4-inserts-load", summary);
      for (const s of summary) {
        expect(s.hostStatuses).toEqual([]);
        expect(s.peak).toBeLessThan(amp * 1.5);
      }
    } finally {
      for (const b of burners) b.kill("SIGKILL");
    }
  }, 300_000);
});
