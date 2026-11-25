import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NATIVE_PLUGIN_BLOCK_FRAMES, blockParameterValues } from "../../../packages/core/src/audio/native-plugin/native-plugin-render";
import { NativePluginCancelledError, NativePluginRenderError } from "../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { PluginBlocklist } from "../src/main/plughost/blocklist";
import { HelperProcess } from "../src/main/plughost/helper-process";
import { PlugHostService } from "../src/main/plughost/host-service";
import { renderThroughHelper } from "../src/main/plughost/render";

const MOCK = path.resolve(__dirname, "fixtures/mock-plughost.mjs");
const spawnOptions = { command: process.execPath, args: [MOCK, "serve"] };
const SR = 48000;
const signal = (frames: number, seed = 1): Float32Array => Float32Array.from({ length: frames }, (_, i) => Math.sin(i * 0.013 * seed) * 0.5 + (i === 777 ? 0.4 : 0));
let work = "";
beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "plughost-render-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

const request = (pluginId: string, channels: Float32Array[], extra: Record<string, unknown> = {}) => ({ pluginId, values: {}, automation: {}, channels, sampleRate: SR, ...extra });

describe("pipe render", () => {
  it("applies the plugin to every block and returns the same length", async () => {
    const left = signal(3000, 1);
    const right = signal(3000, 2);
    const result = await renderThroughHelper(spawnOptions, request("au:aufx:gain:mock", [left, right], { values: { "0": 0.5 } }));
    expect(result.latencySamples).toBe(0);
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]).toHaveLength(3000);
    for (const i of [0, 511, 512, 777, 2999]) {
      expect(result.channels[0][i]).toBeCloseTo(left[i] * 0.5, 7);
      expect(result.channels[1][i]).toBeCloseTo(right[i] * 0.5, 7);
    }
  });

  it("compensates a plugin's reported latency exactly: the output is aligned with the input", async () => {
    const input = signal(5000);
    const result = await renderThroughHelper(spawnOptions, request("au:aufx:lkah:mock", [input], { values: { "0": 1 } }));
    expect(result.latencySamples).toBe(300);
    expect(result.channels[0]).toHaveLength(5000);
    // the mock delays by 300 frames; compensation puts every sample back where it was
    expect(Array.from(result.channels[0])).toEqual(Array.from(input));
    expect(result.channels[0][777]).toBe(input[777]);
  });

  it("applies parameter automation per block (block-rate), matching blockParameterValues", async () => {
    const input = Float32Array.from({ length: 4096 }, () => 0.5);
    const automation = { "0": [[0, 0], [4096 / SR, 2]] as Array<[number, number]> };
    const result = await renderThroughHelper(spawnOptions, request("au:aufx:gain:mock", [input], { automation, values: { "0": 1 } }));
    for (const start of [0, 512, 1024, 3584]) {
      const expected = 0.5 * blockParameterValues({ "0": 1 }, automation, start, SR)["0"];
      expect(result.channels[0][start]).toBeCloseTo(expected, 6);
      expect(result.channels[0][start + NATIVE_PLUGIN_BLOCK_FRAMES - 1]).toBeCloseTo(expected, 6);
    }
    expect(result.channels[0][3584]).toBeGreaterThan(result.channels[0][512]);
  });

  it("restores the saved state chunk, then lets explicit values override it", async () => {
    const state = Buffer.from(JSON.stringify({ gain: 0.25 })).toString("base64");
    const input = signal(1000);
    const fromState = await renderThroughHelper(spawnOptions, request("au:aufx:gain:mock", [input], { state }));
    expect(fromState.channels[0][500]).toBeCloseTo(input[500] * 0.25, 7);
    const overridden = await renderThroughHelper(spawnOptions, request("au:aufx:gain:mock", [input], { state, values: { "0": 2 } }));
    expect(overridden.channels[0][500]).toBeCloseTo(input[500] * 2, 7);
  });

  it("runs a stereo-only plugin dual-mono for a mono clip and folds the result back to mono", async () => {
    const input = signal(1500);
    const result = await renderThroughHelper(spawnOptions, request("au:aufx:mono:mock", [input], { values: { "0": 0.5 } }));
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0][600]).toBeCloseTo(input[600] * 0.5, 7);
  });

  it("reports progress up to 1", async () => {
    const seen: number[] = [];
    await renderThroughHelper(spawnOptions, request("au:aufx:gain:mock", [signal(5000)]), { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(5);
    expect(seen[seen.length - 1]).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("cancels mid-render and kills the helper", async () => {
    let helper: HelperProcess | undefined;
    const flag = { aborted: false };
    const pending = renderThroughHelper(spawnOptions, request("au:aufx:gain:mock", [signal(48000 * 20)]), { signal: flag, onHelper: (h) => (helper = h), onProgress: (f) => { if (f > 0.02) flag.aborted = true; } });
    await expect(pending).rejects.toBeInstanceOf(NativePluginCancelledError);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(helper?.alive).toBe(false);
  });

  it("turns a crash in the middle of a render into a failure with the reason, and NaN output into a failure", async () => {
    await expect(renderThroughHelper(spawnOptions, request("au:aufx:cr3b:mock", [signal(20000)]))).rejects.toThrow(/SIGSEGV|access violation/);
    await expect(renderThroughHelper(spawnOptions, request("au:aufx:nan0:mock", [signal(2000)]))).rejects.toBeInstanceOf(NativePluginRenderError);
    await expect(renderThroughHelper(spawnOptions, request("au:aufx:hang:mock", [signal(2000)]), { openTimeoutMs: 400 })).rejects.toThrow(/did not answer/);
  });

  it("returns empty input unchanged without starting a helper", async () => {
    const result = await renderThroughHelper({ command: "/nonexistent", args: [] }, request("au:aufx:gain:mock", [new Float32Array(0)]));
    expect(result.channels[0]).toHaveLength(0);
  });
});

describe("host service", () => {
  const service = () => new PlugHostService({ helper: () => spawnOptions, blocklist: new PluginBlocklist(path.join(work, `bl-${Math.random()}.json`)), vst3Roots: [], probeTimeoutMs: 4000 });

  it("renders through a scanned plugin and reports outcomes instead of throwing", async () => {
    const host = service();
    const ok = await host.render("j1", request("au:aufx:gain:mock", [signal(1200)], { values: { "0": 0.5 } }));
    expect(ok.ok).toBe(true);
    expect(ok.result?.channels[0]).toHaveLength(1200);
    expect(await host.render("j2", request("au:aufx:none:none", [signal(100)]))).toMatchObject({ ok: false, kind: "unavailable", message: expect.stringMatching(/not installed/) });
    expect(await host.render("j3", request("au:aufx:cras:mock", [signal(100)]))).toMatchObject({ ok: false, kind: "unavailable", message: expect.stringMatching(/cannot be used/) });
  }, 30_000);

  it("blocks a plugin that crashes mid-render so it is not loaded again, and fails the render loudly", async () => {
    const host = service();
    await host.scanNow();
    const failed = await host.render("j4", request("au:aufx:cr3b:mock", [signal(20000)]));
    expect(failed).toMatchObject({ ok: false, kind: "failed", message: expect.stringMatching(/SIGSEGV|access violation/) });
    expect(host.usableIds().has("au:aufx:cr3b:mock")).toBe(false);
    expect(await host.render("j5", request("au:aufx:cr3b:mock", [signal(2000)]))).toMatchObject({ ok: false, kind: "unavailable" });
    expect(host.usableIds().has("au:aufx:gain:mock")).toBe(true);
  }, 30_000);

  it("cancels a running job by id", async () => {
    const host = service();
    await host.scanNow();
    const pending = host.render("job-x", request("au:aufx:gain:mock", [signal(48000 * 30)]), (f) => { if (f > 0.01) host.cancel("job-x"); });
    expect(await pending).toMatchObject({ ok: false, kind: "cancelled" });
  }, 30_000);

  it("describes a plugin's parameters, latency and state", async () => {
    const host = service();
    const described = await host.describe("au:aufx:lkah:mock");
    expect(described).toMatchObject({ latencySamples: 300, parameters: [expect.objectContaining({ key: "0", name: "Gain", min: 0, max: 4 })] });
    expect(JSON.parse(Buffer.from(described.state as string, "base64").toString())).toEqual({ gain: 1 });
  });
});
