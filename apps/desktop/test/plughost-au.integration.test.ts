/**
 * The real helper against the Audio Units that ship with macOS (AUDelay, AULowpass, AUPeakLimiter, AUMultibandCompressor):
 * scan, parameter discovery, offline render, latency compensation, parameter automation and the state chunk round trip, with
 * the editor's pipe render checked sample for sample against the helper's own command line `offline` render.
 *
 * Needs macOS and the built helper (pnpm --filter @openreel/desktop build:plughost); skipped elsewhere.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { HelperProcess } from "../src/main/plughost/helper-process";
import { PlugHostService } from "../src/main/plughost/host-service";
import { renderThroughHelper } from "../src/main/plughost/render";

const HELPER = process.env.OPENREEL_PLUGHOST_PATH ?? path.resolve(__dirname, `../resources/plughost/darwin-${process.arch}/openreel-plughost`);
const enabled = process.platform === "darwin" && existsSync(HELPER);
const d = enabled ? describe : describe.skip;
const SR = 48000;
const DELAY = "au:aufx:dely:appl";
const LOWPASS = "au:aufx:lpas:appl";
const LIMITER = "au:aufx:lmtr:appl";
const MBC = "au:aufx:mcmp:appl";
const spawnOptions = { command: HELPER, args: ["serve"] };

let work = "";
beforeAll(() => {
  if (enabled) work = mkdtempSync(path.join(os.tmpdir(), "plughost-au-"));
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const burst = (frames: number): Float32Array[] => {
  const mk = (f: number) => Float32Array.from({ length: frames }, (_, i) => (i > 4000 && i < 24000 ? 0.5 * Math.sin((2 * Math.PI * f * i) / SR) * Math.min(1, (i - 4000) / 500) : 0));
  return [mk(440), mk(660)];
};

/** The helper's own offline render (Swift block loop, no pipe): the reference the editor's render has to equal. */
function helperOffline(id: string, input: Float32Array[], file: { base?: Record<string, number>; lanes?: Record<string, number[][]> }, state?: string): Float32Array[] {
  const inPath = path.join(work, `in-${Math.random()}.f32`);
  const outPath = `${inPath}.out`;
  const planar = new Float32Array(input.length * input[0].length);
  input.forEach((c, i) => planar.set(c, i * c.length));
  writeFileSync(inPath, Buffer.from(planar.buffer));
  const autoPath = `${inPath}.json`;
  writeFileSync(autoPath, JSON.stringify({ base: file.base ?? {}, lanes: file.lanes ?? {} }));
  const args = ["offline", "--id", id, "--in", inPath, "--out", outPath, "--channels", String(input.length), "--rate", String(SR), "--automation", autoPath];
  if (state) {
    writeFileSync(`${inPath}.state`, state);
    args.push("--state", `${inPath}.state`);
  }
  execFileSync(HELPER, args, { stdio: ["ignore", "ignore", "ignore"] });
  const bytes = readFileSync(outPath);
  const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = all.length / input.length;
  return input.map((_, c) => all.slice(c * frames, (c + 1) * frames));
}

const maxDiff = (a: Float32Array, b: Float32Array): number => {
  let worst = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
};
const rms = (a: Float32Array): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

d("Audio Unit helper on the Apple built-in plugins", () => {
  it("scans and validates the built-in effects in sandboxed probes", async () => {
    const host = new PlugHostService({ helper: (mode) => ({ command: HELPER, args: [mode] }), blocklist: new PluginBlocklist(path.join(work, "bl.json")), vst3Roots: [] });
    const scan = await host.scanNow();
    expect(scan.helperAvailable).toBe(true);
    for (const id of [DELAY, LOWPASS, LIMITER, MBC]) expect(scan.plugins.find((p) => p.id === id)).toMatchObject({ format: "au", status: "ok", vendor: "Apple" });
    expect(scan.plugins.find((p) => p.id === MBC)?.latencySamples).toBeGreaterThan(0);
    expect(scan.plugins.find((p) => p.id === DELAY)?.parameterCount).toBeGreaterThanOrEqual(4);
    const described = await host.describe(DELAY);
    expect(described.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(["Dry/Wet Mix", "Delay Time", "Feedback"]));
    expect(typeof described.state).toBe("string");
  }, 120_000);

  it("survives the helper being killed mid-render (the editor side only sees a failed render naming the signal)", async () => {
    const input = [0, 1].map(() => new Float32Array(SR * 60).fill(0.1));
    let helper: HelperProcess | undefined;
    const pending = renderThroughHelper(spawnOptions, { pluginId: DELAY, values: {}, automation: {}, channels: input, sampleRate: SR }, {
      onHelper: (h) => (helper = h),
      onProgress: (fraction) => {
        if (fraction > 0.05 && helper?.pid) process.kill(helper.pid, "SIGKILL");
      },
    });
    await expect(pending).rejects.toThrow(/killed by SIGKILL/);
    // a fresh helper renders fine straight afterwards
    const ok = await renderThroughHelper(spawnOptions, { pluginId: DELAY, values: {}, automation: {}, channels: [new Float32Array(2048)], sampleRate: SR });
    expect(ok.channels[0]).toHaveLength(2048);
  }, 120_000);

  it("rejects an unknown component with a plain error instead of crashing", async () => {
    const helper = new HelperProcess(spawnOptions);
    await helper.start();
    await expect(helper.request({ type: "probe", id: "au:aufx:zzzz:zzzz" }, 20_000)).rejects.toMatchObject({ kind: "plugin" });
    helper.kill();
  });

  it("renders AUDelay offline, audibly different from bypass, and equal to the helper's own offline render", async () => {
    const input = burst(48000);
    const values = { "0": 100, "1": 0.1, "2": 40 };
    const piped = await renderThroughHelper(spawnOptions, { pluginId: DELAY, values, automation: {}, channels: input, sampleRate: SR });
    const reference = helperOffline(DELAY, input, { base: values });
    for (let c = 0; c < 2; c += 1) expect(maxDiff(piped.channels[c], reference[c])).toBe(0);
    expect(maxDiff(piped.channels[0], input[0])).toBeGreaterThan(0.1);
    // 100 % wet at 100 ms: the dry burst start is gone and an echo appears 100 ms later
    expect(rms(piped.channels[0].subarray(4000, 4400))).toBeLessThan(0.05);
    expect(rms(piped.channels[0].subarray(4000 + 4800 + 2000, 4000 + 4800 + 2400))).toBeGreaterThan(0.1);
  }, 120_000);

  it("automates a parameter: Dry/Wet swept from dry to wet matches the helper's offline render exactly and morphs the sound", async () => {
    const input = burst(48000);
    const lanes = { "0": [[0.1, 0], [0.4, 100]] };
    const base = { "1": 0.05, "2": 30 };
    const piped = await renderThroughHelper(spawnOptions, { pluginId: DELAY, values: { "0": 50, ...base }, automation: { "0": lanes["0"] as Array<[number, number]> }, channels: input, sampleRate: SR });
    const reference = helperOffline(DELAY, input, { base: { "0": 50, ...base }, lanes });
    for (let c = 0; c < 2; c += 1) expect(maxDiff(piped.channels[c], reference[c])).toBe(0);
    const staticWet = await renderThroughHelper(spawnOptions, { pluginId: DELAY, values: { "0": 100, ...base }, automation: {}, channels: input, sampleRate: SR });
    expect(maxDiff(piped.channels[0], staticWet.channels[0])).toBeGreaterThan(0.05);
    // early in the burst the lane is fully dry (the input shows through), after the sweep it is fully wet
    expect(rms(piped.channels[0].subarray(5000, 5400))).toBeGreaterThan(0.2);
    expect(rms(piped.channels[0].subarray(19000, 19400))).toBeGreaterThan(0.05);
  }, 120_000);

  it("compensates the reported latency of a lookahead plugin: output lines up with the input", async () => {
    // broadband noise so the correlation peak is unique (a pure tone correlates at every whole period)
    let seed = 99;
    const input = [0, 1].map(() => Float32Array.from({ length: 48000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return ((seed >>> 8) / 16777216 - 0.5) * 0.6; }));
    const piped = await renderThroughHelper(spawnOptions, { pluginId: MBC, values: {}, automation: {}, channels: input, sampleRate: SR });
    expect(piped.latencySamples).toBeGreaterThan(0);
    // cross-correlate around zero lag: the best alignment of compensated output and input must be lag 0
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = -300; lag <= 300; lag += 1) {
      let score = 0;
      for (let i = 6000; i < 20000; i += 1) score += input[0][i] * (piped.channels[0][i + lag] ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    expect(best).toBe(0);
    const reference = helperOffline(MBC, input, {});
    expect(maxDiff(piped.channels[0], reference[0])).toBe(0);
  }, 120_000);

  it("filters with AULowpass and limits with AUPeakLimiter, both equal to the reference render", async () => {
    const input = burst(48000);
    const low = await renderThroughHelper(spawnOptions, { pluginId: LOWPASS, values: { "0": 300 }, automation: {}, channels: input, sampleRate: SR });
    expect(maxDiff(low.channels[1], helperOffline(LOWPASS, input, { base: { "0": 300 } })[1])).toBe(0);
    expect(rms(low.channels[1].subarray(8000, 20000))).toBeLessThan(rms(input[1].subarray(8000, 20000)) * 0.5);
    const loud = input.map((c) => c.map((v) => v * 6));
    const limited = await renderThroughHelper(spawnOptions, { pluginId: LIMITER, values: {}, automation: {}, channels: loud, sampleRate: SR });
    expect(maxDiff(limited.channels[0], helperOffline(LIMITER, loud, {})[0])).toBe(0);
    expect(Math.max(...limited.channels[0].map(Math.abs))).toBeLessThan(Math.max(...loud[0].map(Math.abs)));
  }, 120_000);

  it("round-trips the plugin state chunk: state saved from a configured instance renders like the parameters it holds", async () => {
    const helper = new HelperProcess(spawnOptions);
    await helper.start();
    await helper.request({ type: "open", id: DELAY, sampleRate: SR, channels: 2, maxBlock: 512, params: { "0": 100, "1": 0.2, "2": 20 } }, 20_000);
    const saved = await helper.request({ type: "getState" }, 10_000);
    helper.kill();
    const state = saved.json.state as string;
    expect(typeof state).toBe("string");
    expect(Buffer.from(state, "base64").subarray(0, 6).toString("latin1")).toBe("bplist");
    const input = burst(24000);
    const fromState = await renderThroughHelper(spawnOptions, { pluginId: DELAY, state, values: {}, automation: {}, channels: input, sampleRate: SR });
    const fromValues = await renderThroughHelper(spawnOptions, { pluginId: DELAY, values: { "0": 100, "1": 0.2, "2": 20 }, automation: {}, channels: input, sampleRate: SR });
    expect(maxDiff(fromState.channels[0], fromValues.channels[0])).toBe(0);
    const plain = await renderThroughHelper(spawnOptions, { pluginId: DELAY, values: {}, automation: {}, channels: input, sampleRate: SR });
    expect(maxDiff(fromState.channels[0], plain.channels[0])).toBeGreaterThan(0.05);
    // the CLI restores the same chunk to the same result
    expect(maxDiff(fromState.channels[0], helperOffline(DELAY, input, {}, state)[0])).toBe(0);
  }, 120_000);
});

d("plugin window bridge", () => {
  it("opens the plugin's own editor in a separate helper, streams parameter edits and returns the final state on close", async () => {
    const host = new PlugHostService({ helper: (mode) => ({ command: HELPER, args: [mode] }), blocklist: new PluginBlocklist(path.join(work, "bl-ui.json")), vst3Roots: [] });
    const events: Array<{ type: string; key?: string; value?: number; state?: string | null; parameters?: Array<{ key: string; value: number }> }> = [];
    const sessionId = await host.openUi(DELAY, { title: "AUDelay", values: { "1": 0.25 } }, (event) => events.push(event));
    expect(events[0]).toMatchObject({ type: "opened", sessionId });
    await host.setUiParameter(sessionId, "0", 80);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(events.find((e) => e.type === "paramChanged")).toMatchObject({ key: "0", value: 80 });
    host.closeUi(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const final = events.find((e) => e.type === "state");
    expect(typeof final?.state).toBe("string");
    expect(final?.parameters?.find((p) => p.key === "0")?.value).toBe(80);
    expect(final?.parameters?.find((p) => p.key === "1")?.value).toBeCloseTo(0.25, 5);
    expect(events.some((e) => e.type === "closed")).toBe(true);
    host.dispose();
  }, 60_000);
});
