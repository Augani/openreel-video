import { describe, expect, it, vi } from "vitest";
import { NATIVE_PLUGIN_BYPASS_TTL_MS, NATIVE_PLUGIN_FAILURE_TTL_MS, NativePluginRenderCache, stepSignature } from "./native-plugin-cache";
import { NativePluginCancelledError, NativePluginUnavailableError, type NativePluginBackend, type NativePluginRenderRequest, type NativePluginStep } from "./native-plugin-types";

const SR = 8000;
const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;
const source = (seed = 1): AudioBuffer => makeBuffer([Float32Array.from({ length: 800 }, (_, i) => Math.sin(i * 0.1 * seed))], SR);
const step = (effectId: string, gain: number, extra: Partial<NativePluginStep> = {}): NativePluginStep => ({ effectId, pluginId: `p:${effectId}`, values: { gain }, automation: {}, ...extra });
const gainBackend = (calls: NativePluginRenderRequest[] = []): NativePluginBackend => ({
  render: async (request) => {
    calls.push(request);
    return { channels: request.channels.map((c) => c.map((v) => v * (request.values.gain ?? 1))), latencySamples: 64 };
  },
});

describe("NativePluginRenderCache", () => {
  it("renders once per content and plugin settings, and the second request is a cache hit", async () => {
    const calls: NativePluginRenderRequest[] = [];
    const cache = new NativePluginRenderCache({ backend: gainBackend(calls), makeBuffer });
    const input = source();
    expect(cache.peek(input, [step("a", 0.5)])).toBeNull();
    const first = await cache.request(input, [step("a", 0.5)]);
    expect(first.buffer.getChannelData(0)[10]).toBeCloseTo(input.getChannelData(0)[10] * 0.5, 7);
    expect(cache.peek(input, [step("a", 0.5)])).toBe(first.buffer);
    const second = await cache.request(source(), [step("a", 0.5)]);
    expect(second.buffer).toBe(first.buffer);
    expect(calls).toHaveLength(1);
    expect(cache.reportedLatency(input, [step("a", 0.5)], 0)).toBe(64);
  });

  it("re-renders only from the step that changed", async () => {
    const calls: NativePluginRenderRequest[] = [];
    const cache = new NativePluginRenderCache({ backend: gainBackend(calls), makeBuffer });
    const input = source();
    await cache.request(input, [step("a", 0.5), step("b", 0.5)]);
    expect(calls).toHaveLength(2);
    const out = await cache.request(input, [step("a", 0.5), step("b", 0.25)]);
    expect(calls).toHaveLength(3);
    expect(out.buffer.getChannelData(0)[10]).toBeCloseTo(input.getChannelData(0)[10] * 0.125, 7);
  });

  it("keys on state chunk and automation, not just parameter values", () => {
    const a = stepSignature(step("a", 1));
    expect(stepSignature(step("a", 1, { state: "xyz" }))).not.toBe(a);
    expect(stepSignature(step("a", 1, { automation: { "0": [[0, 1], [1, 2]] } }))).not.toBe(a);
    expect(stepSignature({ ...step("a", 1), effectId: "other" })).toBe(a);
  });

  it("joins a running job instead of starting another", async () => {
    let release: () => void = () => undefined;
    const render = vi.fn(() => new Promise<{ channels: Float32Array[]; latencySamples: number }>((resolve) => { release = () => resolve({ channels: [new Float32Array(800)], latencySamples: 0 }); }));
    const cache = new NativePluginRenderCache({ backend: { render }, makeBuffer });
    const input = source();
    const one = cache.request(input, [step("a", 1)]);
    const two = cache.request(input, [step("a", 1)]);
    expect(cache.status(input, [step("a", 1)]).state).toBe("running");
    release();
    expect((await one).buffer).toBe((await two).buffer);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("bypasses and reports a plugin that is unavailable, and tries again after the TTL", async () => {
    let now = 1000;
    let installed = false;
    const backend: NativePluginBackend = {
      render: async (request) => {
        if (!installed) throw new NativePluginUnavailableError(request.pluginId, "not installed");
        return { channels: request.channels.map((c) => c.map((v) => v * 0.1)), latencySamples: 0 };
      },
    };
    const cache = new NativePluginRenderCache({ backend, makeBuffer, now: () => now });
    const input = source();
    const result = await cache.request(input, [step("a", 1), step("b", 1)]);
    expect(result.buffer).toBe(input);
    expect([...result.bypassed.keys()]).toEqual(["a", "b"]);
    expect(cache.peek(input, [step("a", 1)])).toBe(input);
    expect(cache.bypassReason(input, [step("a", 1)], 0)).toBe("not installed");
    installed = true;
    now += NATIVE_PLUGIN_BYPASS_TTL_MS + 1;
    const retried = await cache.request(input, [step("a", 1)]);
    expect(retried.bypassed.size).toBe(0);
    expect(retried.buffer.getChannelData(0)[10]).toBeCloseTo(input.getChannelData(0)[10] * 0.1, 7);
  });

  it("bypasses everything when there is no host at all", async () => {
    const cache = new NativePluginRenderCache({ makeBuffer });
    const input = source();
    const result = await cache.request(input, [step("a", 1)]);
    expect(result.buffer).toBe(input);
    expect(result.bypassed.get("a")).toMatch(/desktop app/);
  });

  it("rejects with the reason when a plugin fails mid render, and remembers it briefly", async () => {
    let now = 0;
    const render = vi.fn(async () => { throw new Error("helper crashed (SIGSEGV)"); });
    const cache = new NativePluginRenderCache({ backend: { render }, makeBuffer, now: () => now });
    const input = source();
    await expect(cache.request(input, [step("a", 1)])).rejects.toThrow(/SIGSEGV/);
    expect(cache.status(input, [step("a", 1)])).toMatchObject({ state: "failed", error: "helper crashed (SIGSEGV)" });
    await expect(cache.request(input, [step("a", 1)])).rejects.toThrow(/SIGSEGV/);
    expect(render).toHaveBeenCalledTimes(1);
    now += NATIVE_PLUGIN_FAILURE_TTL_MS + 1;
    await expect(cache.request(input, [step("a", 1)])).rejects.toThrow(/SIGSEGV/);
    expect(render).toHaveBeenCalledTimes(2);
    cache.clearFailures();
    expect(cache.status(input, [step("a", 1)]).state).toBe("idle");
  });

  it("cancel aborts the job without caching or remembering a failure", async () => {
    const backend: NativePluginBackend = {
      render: (_request, options) => new Promise((_resolve, reject) => { const poll = setInterval(() => { if (options?.signal?.aborted) { clearInterval(poll); reject(new NativePluginCancelledError()); } }, 1); }),
    };
    const cache = new NativePluginRenderCache({ backend, makeBuffer });
    const input = source();
    const pending = cache.request(input, [step("a", 1)]);
    expect(cache.cancel(input, [step("a", 1)])).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(NativePluginCancelledError);
    expect(cache.status(input, [step("a", 1)]).state).toBe("idle");
  });

  it("notifies progress, status and ready listeners", async () => {
    const backend: NativePluginBackend = { render: async (request, options) => { options?.onProgress?.(0.5); return { channels: request.channels.map((c) => c.slice()), latencySamples: 0 }; } };
    const cache = new NativePluginRenderCache({ backend, makeBuffer });
    const states: string[] = [];
    const ready = vi.fn();
    cache.onStatus((_b, s) => states.push(`${s.state}:${s.fraction}`));
    cache.onReady(ready);
    await cache.request(source(), [step("a", 1)]);
    expect(states).toEqual(["running:0", "running:0.5", "ready:1"]);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("cancelSource aborts every running chain for the source and reports idle", async () => {
    const backend: NativePluginBackend = {
      render: (_request, options) => new Promise((_, reject) => (options?.signal as AbortSignal | undefined)?.addEventListener("abort", () => reject(new NativePluginCancelledError()))),
    };
    const cache = new NativePluginRenderCache({ backend, makeBuffer });
    const input = source();
    const states: string[] = [];
    cache.onStatus((_buffer, status) => states.push(status.state));
    const pending = cache.request(input, [step("a", 1)]).catch((error: unknown) => error);
    expect(cache.cancelSource(source(2))).toBe(false);
    expect(cache.cancelSource(input)).toBe(true);
    expect(await pending).toBeInstanceOf(NativePluginCancelledError);
    await Promise.resolve();
    expect(states.at(-1)).toBe("idle");
    expect(cache.status(input, [step("a", 1)]).state).toBe("idle");
  });
});
