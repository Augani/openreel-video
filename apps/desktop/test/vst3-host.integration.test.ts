/**
 * The real VST3 helper (openreel-vst3host, C++ on the Steinberg VST3 SDK) against a real VST3 plugin built in the test setup from
 * the SDK's own "adelay" example (MIT, scripts/build-vst3-testplugins.mjs, into a temp folder; never committed), plus deliberately
 * broken builds of the same example (segfault, hang, NaN, crash after the scan).
 *
 * adelay's DSP is analytic: output[n] = input[n - D], D = max(1, trunc(delay * sampleRate)), delay a normalized 0..1 parameter.
 * Everything below is checked against that, against the helper's own command line `offline` render, and for protocol parity with
 * the Audio Unit helper.
 *
 * Needs the built helper (pnpm --filter @openreel/desktop build:vst3host), CMake and network access to fetch the pinned SDK on the
 * first run (cached under apps/desktop/.cache); skipped when any of that is missing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without types
import { buildTestPlugins } from "../scripts/build-vst3-testplugins.mjs";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { HelperProcess } from "../src/main/plughost/helper-process";
import { PlugHostService } from "../src/main/plughost/host-service";
import { renderThroughHelper } from "../src/main/plughost/render";

const exe = process.platform === "win32" ? "openreel-vst3host.exe" : "openreel-vst3host";
const HELPER = process.env.OPENREEL_VST3HOST_PATH ?? path.resolve(__dirname, `../resources/vst3host/${process.platform}-${process.arch}/${exe}`);
const AU_HELPER = process.env.OPENREEL_PLUGHOST_PATH ?? path.resolve(__dirname, `../resources/plughost/darwin-${process.arch}/openreel-plughost`);
const hasCmake = spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0;
const enabled = existsSync(HELPER) && hasCmake;
const d = enabled ? describe : describe.skip;
const SR = 48000;
const DELAY_ID = "vst3:0CDBB66985D548A9BFD8371909D24BB3";
const DELAY_PARAM = "100";

let work = "";
let folder = "";
const bundle = (name: string) => path.join(folder, `${name}.vst3`);
const spawnFor = (mode: string, format?: string) => (format === "au" ? null : { command: HELPER, args: [mode] });
const spawnOptions = { command: HELPER, args: ["serve"] };

beforeAll(async () => {
  if (!enabled) return;
  work = mkdtempSync(path.join(os.tmpdir(), "vst3-host-"));
  folder = (await buildTestPlugins(path.join(work, "plugins"), { log: () => undefined })) ?? "";
}, 300_000);
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const noise = (frames: number, seed = 7): Float32Array[] =>
  [0, 1].map((ch) => {
    let s = seed + ch * 1000;
    return Float32Array.from({ length: frames }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return ((s >>> 8) / 16777216 - 0.5) * 0.8;
    });
  });
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let worst = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
};
/** adelay's analytic output for a constant normalized delay. */
const expectedDelay = (input: Float32Array, delay: number, offsetSamples = 0): Float32Array => {
  const D = Math.max(1, Math.trunc(delay * SR));
  return Float32Array.from({ length: input.length }, (_, n) => {
    const src = n - D + offsetSamples;
    return src >= 0 && src < input.length ? input[src] : 0;
  });
};

function helperOffline(pluginPath: string, input: Float32Array[], file: { base?: Record<string, number>; lanes?: Record<string, number[][]> }, state?: string): Float32Array[] {
  const inPath = path.join(work, `in-${Math.random().toString(36).slice(2)}.f32`);
  const planar = new Float32Array(input.length * input[0].length);
  input.forEach((c, i) => planar.set(c, i * c.length));
  writeFileSync(inPath, Buffer.from(planar.buffer));
  writeFileSync(`${inPath}.json`, JSON.stringify({ base: file.base ?? {}, lanes: file.lanes ?? {} }));
  const args = ["offline", "--id", "vst3:00000000000000000000000000000000", "--path", pluginPath, "--in", inPath, "--out", `${inPath}.out`, "--channels", String(input.length), "--rate", String(SR), "--automation", `${inPath}.json`];
  if (state) {
    writeFileSync(`${inPath}.state`, state);
    args.push("--state", `${inPath}.state`);
  }
  execFileSync(HELPER, args, { stdio: ["ignore", "ignore", "ignore"] });
  const bytes = readFileSync(`${inPath}.out`);
  const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = all.length / input.length;
  return input.map((_, c) => all.slice(c * frames, (c + 1) * frames));
}

d("VST3 helper protocol", () => {
  it("answers hello like the Audio Unit helper (same keys, protocol 1) and rejects bad requests with the same error shape", async () => {
    const vst3 = new HelperProcess(spawnOptions);
    const hello = await vst3.start();
    expect(hello).toMatchObject({ type: "ready", protocol: 1, helper: "openreel-vst3host", formats: ["vst3"] });
    await expect(vst3.request({ type: "block", frames: 4 }, 5000, new Uint8Array(32))).rejects.toMatchObject({ kind: "plugin", message: "no plugin is open" });
    await expect(vst3.request({ type: "frobnicate" }, 5000)).rejects.toMatchObject({ kind: "plugin", message: "unknown message type frobnicate" });
    await expect(vst3.request({ type: "probe", id: DELAY_ID, path: path.join(work, "nope.vst3") }, 10_000)).rejects.toMatchObject({ kind: "plugin", message: expect.stringMatching(/could not be loaded/) });
    await expect(vst3.request({ type: "open", id: DELAY_ID }, 5000)).rejects.toMatchObject({ kind: "plugin", message: expect.stringMatching(/needs the path/) });
    const list = await vst3.request({ type: "list" }, 5000);
    expect(list.json).toMatchObject({ type: "components", components: [] });
    vst3.kill();
    if (process.platform === "darwin" && existsSync(AU_HELPER)) {
      const au = new HelperProcess({ command: AU_HELPER, args: ["serve"] });
      const auHello = await au.start();
      expect(Object.keys(auHello).sort()).toEqual(Object.keys(hello).sort());
      expect(auHello.protocol).toBe(hello.protocol);
      await expect(au.request({ type: "block", frames: 4 }, 5000, new Uint8Array(32))).rejects.toMatchObject({ kind: "plugin", message: "no plugin is open" });
      await expect(au.request({ type: "frobnicate" }, 5000)).rejects.toMatchObject({ kind: "plugin", message: "unknown message type frobnicate" });
      au.kill();
    }
  });

  it("ends the session on a frame that does not parse (garbage in, exit out), and exits cleanly when stdin closes", async () => {
    const helper = new HelperProcess(spawnOptions);
    await helper.start();
    const exited = new Promise<unknown>((resolve) => helper.once("exit", resolve));
    // not a frame: wrong magic
    (helper as unknown as { child: { stdin: { write: (b: Buffer) => void } } }).child.stdin.write(Buffer.from("this is definitely not a frame"));
    expect(await exited).toMatchObject({ kind: "crash", message: expect.stringMatching(/exited with code 0/) });
  });
});

d("VST3 scan, validation and blocklist on real plugins", () => {
  it("scans the temp folder: the SDK example loads with its real class id, parameters and latency; broken builds are blocked in their own processes", async () => {
    expect(folder, "the test plugins built").not.toBe("");
    const blocklist = new PluginBlocklist(path.join(work, "bl.json"));
    const host = new PlugHostService({ helper: spawnFor, blocklist, vst3Roots: [folder], probeTimeoutMs: 4000 });
    const scan = await host.scanNow();
    const by = new Map(scan.plugins.map((p) => [path.basename(p.path ?? "", ".vst3"), p]));
    expect(by.get("adelay")).toMatchObject({ id: DELAY_ID, format: "vst3", name: "ADelay", status: "ok", latencySamples: 0, parameterCount: 2 });
    expect(by.get("adelay_latency")).toMatchObject({ status: "ok", latencySamples: 100 });
    expect(by.get("adelay_crash_late")?.status, "passes the scan (8 blocks), dies later").toBe("ok");
    expect(by.get("adelay_crash")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/SIGSEGV|SIGBUS/) });
    expect(by.get("adelay_hang")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/did not answer/) });
    expect(by.get("adelay_nan")).toMatchObject({ status: "blocked", statusReason: expect.stringMatching(/NaN/) });
    expect(blocklist.list().map((e) => e.kind).sort(), "crash and hang are remembered; NaN is a refusal").toEqual(["crash", "timeout"]);
    const described = await host.describe(DELAY_ID);
    expect(described.parameters.map((p) => [p.key, p.name, p.min, p.max])).toEqual(expect.arrayContaining([["100", "Delay", 0, 1], ["101", "Bypass", 0, 1]]));
    expect(described.parameters.find((p) => p.key === DELAY_PARAM)).toMatchObject({ value: 1, unitName: "sec", indexed: false });
    expect(described.parameters.find((p) => p.key === "101")).toMatchObject({ indexed: true });
    expect(typeof described.state).toBe("string");
    host.dispose();
  }, 120_000);
});

d("VST3 render on the SDK's adelay example", () => {
  const render = (pluginPath: string, input: Float32Array[], values: Record<string, number>, automation: Record<string, Array<[number, number]>> = {}, state?: string) =>
    renderThroughHelper(spawnOptions, { pluginId: DELAY_ID, values, automation, channels: input, sampleRate: SR, ...(state ? { state } : {}) }, { pluginPath });

  it("delays by exactly D = trunc(delay x sampleRate) samples, across 512 frame block boundaries, in every channel", async () => {
    const input = noise(20000);
    for (const delay of [0.002, 0.025, 0.1]) {
      const out = await render(bundle("adelay"), input, { [DELAY_PARAM]: delay });
      for (let c = 0; c < 2; c += 1) expect(maxDiff(out.channels[c], expectedDelay(input[c], delay)), `delay ${delay}, channel ${c}`).toBe(0);
    }
  }, 60_000);

  it("equals the helper's own offline render sample for sample, also with automation, and differs from bypass and from the static value", async () => {
    const input = noise(36000);
    const lanes = { [DELAY_PARAM]: [[0, 0.01], [0.3, 0.05], [0.6, 0.02]] as Array<[number, number]> };
    const piped = await render(bundle("adelay"), input, { [DELAY_PARAM]: 0.01 }, lanes);
    const reference = helperOffline(bundle("adelay"), input, { base: { [DELAY_PARAM]: 0.01 }, lanes });
    for (let c = 0; c < 2; c += 1) expect(maxDiff(piped.channels[c], reference[c]), `piped vs offline, channel ${c}`).toBe(0);
    // the first block is still on the first lane value: analytic there
    expect(maxDiff(piped.channels[0].subarray(0, 512), expectedDelay(input[0], 0.01).subarray(0, 512))).toBe(0);
    const staticOut = await render(bundle("adelay"), input, { [DELAY_PARAM]: 0.01 });
    expect(maxDiff(piped.channels[0], staticOut.channels[0]), "automation changes the sound").toBeGreaterThan(0.1);
    expect(maxDiff(piped.channels[0], input[0]), "and differs from bypass").toBeGreaterThan(0.1);
    // the first 480 samples of the delayed plugin are silence where the dry input is not
    expect(Math.max(...Array.from(staticOut.channels[0].subarray(0, 480)).map(Math.abs))).toBe(0);
  }, 60_000);

  it("reports latency and the editor's render compensates it exactly (adelay_latency: 100 samples)", async () => {
    const input = noise(20000, 11);
    const delay = 0.01;
    const out = await renderThroughHelper(spawnOptions, { pluginId: "vst3:0A0B0C0211223344556677889 9AABBC2".replace(" ", ""), values: { [DELAY_PARAM]: delay }, automation: {}, channels: input, sampleRate: SR }, { pluginPath: bundle("adelay_latency") });
    expect(out.latencySamples).toBe(100);
    // the helper feeds N + L frames and drops the first L outputs: out[n] = in[n + L - D]
    for (let c = 0; c < 2; c += 1) expect(maxDiff(out.channels[c], expectedDelay(input[c], delay, 100))).toBe(0);
    const reference = helperOffline(bundle("adelay_latency"), input, { base: { [DELAY_PARAM]: delay } });
    expect(maxDiff(out.channels[0], reference[0])).toBe(0);
  }, 60_000);

  it("round-trips the state chunk (component + controller): state saved from a configured instance renders like the parameters it holds", async () => {
    const helper = new HelperProcess(spawnOptions);
    await helper.start();
    await helper.request({ type: "open", id: DELAY_ID, path: bundle("adelay"), sampleRate: SR, channels: 2, maxBlock: 512, params: { [DELAY_PARAM]: 0.03125 } }, 20_000);
    const saved = await helper.request({ type: "getState" }, 10_000);
    const state = saved.json.state as string;
    expect(typeof state).toBe("string");
    const raw = Buffer.from(state, "base64");
    expect(raw.subarray(0, 4).toString("latin1")).toBe("ORV3");
    // the SDK example's component state (stored as a float, so the test uses a value that is exact in float32)
    // the SDK example's component state is a little endian float (delay) and an int32 (bypass)
    const compLen = raw.readUInt32LE(5);
    expect(compLen).toBe(8);
    expect(raw.readFloatLE(9)).toBeCloseTo(0.03125, 6);
    // restoring into a fresh instance through setState brings the value back
    await helper.request({ type: "open", id: DELAY_ID, path: bundle("adelay"), sampleRate: SR, channels: 2, maxBlock: 512 }, 20_000);
    const restored = await helper.request({ type: "setState", state }, 10_000);
    expect((restored.json.parameters as Array<{ key: string; value: number }>).find((p) => p.key === DELAY_PARAM)?.value).toBeCloseTo(0.03125, 6);
    helper.kill();
    const input = noise(15000, 3);
    const fromState = await render(bundle("adelay"), input, {}, {}, state);
    const fromValues = await render(bundle("adelay"), input, { [DELAY_PARAM]: 0.03125 });
    expect(maxDiff(fromState.channels[0], fromValues.channels[0])).toBe(0);
    expect(maxDiff(fromState.channels[0], expectedDelay(input[0], 0.03125))).toBe(0);
    const plain = await render(bundle("adelay"), input, {});
    expect(maxDiff(fromState.channels[0], plain.channels[0]), "the default (1 s) delay is not the saved one").toBeGreaterThan(0.1);
    expect(maxDiff(fromState.channels[0], helperOffline(bundle("adelay"), input, {}, state)[0]), "the CLI restores the same chunk to the same result").toBe(0);
    await expect(render(bundle("adelay"), input, {}, {}, Buffer.from("garbage").toString("base64"))).rejects.toThrow(/state is not readable/);
  }, 90_000);

  it("falls back to dual mono when a mono source meets a plugin that wants stereo", async () => {
    const mono = [noise(6000, 5)[0]];
    const out = await render(bundle("adelay"), mono, { [DELAY_PARAM]: 0.01 });
    expect(out.channels).toHaveLength(1);
    expect(maxDiff(out.channels[0], expectedDelay(mono[0], 0.01))).toBeLessThan(1e-7);
  }, 60_000);
});

d("VST3 crash, hang and NaN isolation", () => {
  it("a segfaulting plugin costs the helper process and the render fails naming the signal; a fresh helper renders fine straight afterwards", async () => {
    const input = noise(4096);
    await expect(renderThroughHelper(spawnOptions, { pluginId: DELAY_ID, values: {}, automation: {}, channels: input, sampleRate: SR }, { pluginPath: bundle("adelay_crash") })).rejects.toThrow(/killed by SIG(SEGV|BUS)|exited with code/);
    const ok = await renderThroughHelper(spawnOptions, { pluginId: DELAY_ID, values: { [DELAY_PARAM]: 0.01 }, automation: {}, channels: input, sampleRate: SR }, { pluginPath: bundle("adelay") });
    expect(maxDiff(ok.channels[0], expectedDelay(input[0], 0.01))).toBe(0);
  }, 60_000);

  it("a hung plugin is killed at the per-block deadline and the render fails with the timeout", async () => {
    const started = Date.now();
    await expect(renderThroughHelper(spawnOptions, { pluginId: DELAY_ID, values: {}, automation: {}, channels: noise(4096), sampleRate: SR }, { pluginPath: bundle("adelay_hang"), blockTimeoutMs: 1500 })).rejects.toThrow(/did not answer/);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it("a plugin that outputs NaN fails the render instead of poisoning the mix", async () => {
    await expect(renderThroughHelper(spawnOptions, { pluginId: DELAY_ID, values: {}, automation: {}, channels: noise(4096), sampleRate: SR }, { pluginPath: bundle("adelay_nan") })).rejects.toThrow(/NaN/);
  }, 60_000);

  it("a plugin that passes the scan and dies mid-render fails loudly, is blocked under its class id, and the next clip does not load it again", async () => {
    const blocklist = new PluginBlocklist(path.join(work, "bl-late.json"));
    const host = new PlugHostService({ helper: spawnFor, blocklist, vst3Roots: [folder], probeTimeoutMs: 4000 });
    const scan = await host.scanNow();
    const late = scan.plugins.find((p) => p.path === bundle("adelay_crash_late"));
    expect(late?.status).toBe("ok");
    const id = late?.id as string;
    const failed = await host.render("late-1", { pluginId: id, values: {}, automation: {}, channels: noise(60 * 512 + 1000), sampleRate: SR });
    expect(failed).toMatchObject({ ok: false, kind: "failed", message: expect.stringMatching(/killed by SIG(SEGV|BUS)/) });
    expect(blocklist.get(id)).toMatchObject({ kind: "crash" });
    expect(await host.render("late-2", { pluginId: id, values: {}, automation: {}, channels: noise(2000), sampleRate: SR })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(host.usableIds().has(DELAY_ID)).toBe(true);
    host.dispose();
  }, 120_000);
});

const ui = process.platform === "darwin" ? d : describe.skip;
ui("VST3 plugin window (macOS, ui mode)", () => {
  it("opens the plugin's own editor (IPlugView in an NSWindow) in a separate helper, streams its edits and a pushed value, and returns the final state on close", async () => {
    const host = new PlugHostService({ helper: spawnFor, blocklist: new PluginBlocklist(path.join(work, "bl-ui.json")), vst3Roots: [folder], probeTimeoutMs: 4000 });
    const scan = await host.scanNow();
    const uiPlugin = scan.plugins.find((p) => p.path === bundle("adelay_ui"));
    expect(uiPlugin?.status).toBe("ok");
    const events: Array<{ type: string; key?: string; value?: number; state?: string | null; parameters?: Array<{ key: string; value: number }> }> = [];
    const sessionId = await host.openUi(uiPlugin!.id, { title: "adelay_ui", values: { "101": 0 } }, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: "opened", sessionId });
    // the test editor performs a user edit (Delay -> 0.25) 300 ms after it is attached
    await new Promise((r) => setTimeout(r, 900));
    expect(events.find((e) => e.type === "paramChanged")).toMatchObject({ key: DELAY_PARAM, value: 0.25 });
    await host.setUiParameter(sessionId, DELAY_PARAM, 0.5);
    await new Promise((r) => setTimeout(r, 400));
    expect(events.filter((e) => e.type === "paramChanged").at(-1)).toMatchObject({ key: DELAY_PARAM, value: 0.5 });
    host.closeUi(sessionId);
    await new Promise((r) => setTimeout(r, 1500));
    const final = events.find((e) => e.type === "state");
    expect(typeof final?.state).toBe("string");
    expect(final?.parameters?.find((p) => p.key === DELAY_PARAM)?.value).toBe(0.5);
    // the processor's own state followed the edits (the helper pushed them through one silent block)
    expect(Buffer.from(final!.state as string, "base64").readFloatLE(9)).toBeCloseTo(0.5, 6);
    expect(events.some((e) => e.type === "closed")).toBe(true);
    // a plugin without an editor reports it instead of opening an empty window
    const plain = scan.plugins.find((p) => p.path === bundle("adelay"));
    await expect(host.openUi(plain!.id, { title: "adelay" }, () => undefined)).rejects.toThrow(/no editor/);
    host.dispose();
  }, 90_000);
});
