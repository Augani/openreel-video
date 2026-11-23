import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import type { EditingHost, RenderCacheBridge, RenderCacheRunResult } from "./host";

function hostWithCache(): { host: EditingHost; calls: Array<unknown>; state: { frames: number } } {
  const base = new HeadlessHost(makeEmptyProject());
  const calls: unknown[] = [];
  const state = { frames: 0 };
  const bridge: RenderCacheBridge = {
    renderInToOut: async (options): Promise<RenderCacheRunResult> => {
      calls.push(options ?? "whole");
      state.frames = 60;
      return { status: "completed", framesRendered: 60, framesSkipped: 0, totalFrames: 60, elapsedMs: 1500, codec: "mock" };
    },
    deleteRenderFiles: async () => {
      const removedFrames = state.frames;
      state.frames = 0;
      return { removedFrames };
    },
    getStatus: () => ({
      rendering: false,
      frameCount: state.frames,
      bytes: state.frames * 100,
      budgetBytes: 1000,
      cachedRanges: state.frames ? [{ start: 0, end: 2 }] : [],
      segments: [{ start: 0, end: 2, level: state.frames ? "cached" : "heavy", reasons: ["glow"] }],
    }),
  };
  return { host: Object.assign(base, { renderCache: bridge }), calls, state };
}

describe("render cache tools", () => {
  it("registers the three tools with the right flags", () => {
    expect(getTool("render_in_to_out")?.expensive).toBe(true);
    expect(getTool("delete_render_files")?.readOnly).toBe(false);
    expect(getTool("get_render_status")?.readOnly).toBe(true);
  });

  for (const [name, args] of [
    ["render_in_to_out", {}],
    ["delete_render_files", {}],
    ["get_render_status", {}],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`${name} fails gracefully without the capability`, async () => {
      const result = await executeTool(name, args, new HeadlessHost(makeEmptyProject()));
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("UNSUPPORTED");
      expect(result.summary.toLowerCase()).toContain("render cache");
    });
  }

  it("renders, reports status and deletes through the bridge", async () => {
    const { host, calls } = hostWithCache();
    const before = await executeTool("get_render_status", {}, host);
    expect(before.ok).toBe(true);
    expect((before.data as { segments: Array<{ level: string }> }).segments[0].level).toBe("heavy");

    const rendered = await executeTool("render_in_to_out", {}, host);
    expect(rendered.ok).toBe(true);
    expect(calls).toEqual(["whole"]);
    expect((rendered.data as { framesRendered: number }).framesRendered).toBe(60);

    const ranged = await executeTool("render_in_to_out", { rangeStart: 1, rangeEnd: 2 }, host);
    expect(ranged.ok).toBe(true);
    expect(calls[1]).toEqual({ rangeStart: 1, rangeEnd: 2 });

    const after = await executeTool("get_render_status", {}, host);
    expect((after.data as { frameCount: number; segments: Array<{ level: string }> }).frameCount).toBe(60);
    expect((after.data as { segments: Array<{ level: string }> }).segments[0].level).toBe("cached");

    const deleted = await executeTool("delete_render_files", {}, host);
    expect(deleted.ok).toBe(true);
    expect((deleted.data as { removedFrames: number }).removedFrames).toBe(60);
    expect(((await executeTool("get_render_status", {}, host)).data as { frameCount: number }).frameCount).toBe(0);
  });

  it("validates the range", async () => {
    const { host, calls } = hostWithCache();
    for (const args of [{ rangeStart: 2 }, { rangeStart: 3, rangeEnd: 1 }, { rangeStart: -1, rangeEnd: 1 }]) {
      const result = await executeTool("render_in_to_out", args, host);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("INVALID_PARAMS");
    }
    expect(calls).toEqual([]);
  });

  it("surfaces a failed render as an error", async () => {
    const { host } = hostWithCache();
    host.renderCache = {
      ...host.renderCache!,
      renderInToOut: async () => ({
        status: "failed",
        framesRendered: 3,
        framesSkipped: 0,
        totalFrames: 60,
        elapsedMs: 10,
        codec: "mock",
        message: "Render cache is full",
      }),
    };
    const result = await executeTool("render_in_to_out", {}, host);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("RENDER_FAILED");
    expect(result.summary).toContain("full");
  });

  it("passes effectsOnly through (Render Effects In to Out), with and without an explicit range", async () => {
    const { host, calls } = hostWithCache();
    await executeTool("render_in_to_out", { effectsOnly: true }, host);
    await executeTool("render_in_to_out", { rangeStart: 1, rangeEnd: 3, effectsOnly: true }, host);
    await executeTool("render_in_to_out", { rangeStart: 1, rangeEnd: 3 }, host);
    expect(calls).toEqual([{ effectsOnly: true }, { rangeStart: 1, rangeEnd: 3, effectsOnly: true }, { rangeStart: 1, rangeEnd: 3 }]);
  });
});
