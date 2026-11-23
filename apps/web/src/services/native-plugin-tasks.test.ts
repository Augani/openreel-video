import { afterEach, describe, expect, it } from "vitest";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { NativePluginCancelledError, setNativePluginBackend, type NativePluginBackend } from "@openreel/core";
import { watchNativePluginRenderTasks } from "./native-plugin-tasks";

const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
  ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;
const source = (seed = 1) => makeBuffer([Float32Array.from({ length: 400 }, (_, i) => Math.sin(i * 0.2 * seed))], 8000);
const steps = [{ effectId: "e", pluginId: "p", values: {}, automation: {} }];
const rows = () => backgroundTasks.getSnapshot().filter((t) => t.source === "plugin-render");

afterEach(() => {
  backgroundTasks.clearFinished();
  setNativePluginBackend(undefined);
});

describe("plugin render tasks", () => {
  it("shows progress, cancels through the cache, and retries a failure", async () => {
    let mode: "hang" | "fail" | "ok" = "hang";
    const backend: NativePluginBackend = {
      render: (request, options) =>
        new Promise((resolve, reject) => {
          if (mode === "fail") return reject(new Error("Plugin crashed"));
          if (mode === "ok") return resolve({ channels: [...request.channels], latencySamples: 0 });
          options?.onProgress?.(0.5);
          (options?.signal as AbortSignal | undefined)?.addEventListener("abort", () => reject(new NativePluginCancelledError()));
        }),
    };
    setNativePluginBackend(backend);
    const { getSharedNativePluginCache } = await import("@openreel/core");
    const dispose = watchNativePluginRenderTasks();
    const cache = getSharedNativePluginCache(makeBuffer);
    const input = source();

    const first = cache.request(input, steps).catch((e: unknown) => e);
    await Promise.resolve();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "running", kind: "render" });
    expect(rows()[0].progress).toBeCloseTo(0.5, 5);
    expect(rows()[0].can.cancel).toBe(true);

    backgroundTasks.cancel(rows()[0].id);
    expect(await first).toBeInstanceOf(NativePluginCancelledError);
    await vi_waitFor(() => rows()[0]?.status === "cancelled");

    backgroundTasks.clearFinished();
    mode = "fail";
    const failed = cache.request(input, steps).catch((e: unknown) => e);
    await failed;
    await vi_waitFor(() => rows()[0]?.status === "failed");
    expect(rows()[0].error).toBe("Plugin crashed");
    expect(rows()[0].can.retry).toBe(true);

    mode = "ok";
    backgroundTasks.retry(rows()[0].id);
    await cache.request(input, steps);
    await vi_waitFor(() => rows()[0]?.status === "completed");
    expect(rows()).toHaveLength(1);
    dispose();
  });

  it("titles a track or bus stem render with the target's name, and keeps the generic title for a clip", async () => {
    setNativePluginBackend({ render: async (request) => ({ channels: [...request.channels], latencySamples: 0 }) });
    const { getSharedNativePluginCache } = await import("@openreel/core");
    const dispose = watchNativePluginRenderTasks();
    const cache = getSharedNativePluginCache(makeBuffer);
    await cache.request(source(5), steps, { label: "Track Drums" });
    await cache.request(source(6), steps, { label: "Bus Music" });
    await cache.request(source(7), steps);
    expect(rows().map((row) => row.title).sort()).toEqual(["Audio plugin render", "Plugins on Bus Music", "Plugins on Track Drums"]);
    expect(rows().every((row) => row.status === "completed")).toBe(true);
    dispose();
  });

  it("does not add a row for a cache hit", async () => {
    setNativePluginBackend({ render: async (request) => ({ channels: [...request.channels], latencySamples: 0 }) });
    const { getSharedNativePluginCache } = await import("@openreel/core");
    const dispose = watchNativePluginRenderTasks();
    const cache = getSharedNativePluginCache(makeBuffer);
    const input = source(3);
    await cache.request(input, steps);
    expect(rows()[0]?.status).toBe("completed");
    backgroundTasks.clearFinished();
    await cache.request(input, steps);
    expect(rows()).toHaveLength(0);
    dispose();
  });
});

async function vi_waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
}
