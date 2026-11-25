import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";

type Ensure = (project: unknown, signal: AbortSignal, onProgress?: (f: number, l: string) => void) => Promise<number>;
const ensure = vi.hoisted(() => vi.fn());
vi.mock("./content-aware-fill", () => ({ ensureRemovalAnalysesForExport: ensure }));
const implement = (fn: Ensure): void => { ensure.mockImplementation(fn as never); };

import { prepareObjectRemovalForExport } from "./export-object-removal";

const projectWith = (objectRemoval?: Record<string, unknown>): Pick<Project, "timeline"> =>
  ({ timeline: { tracks: [{ clips: [{ id: "c1", objectRemoval }] }] } }) as unknown as Pick<Project, "timeline">;
const enabled = { enabled: true, maskId: "m", analysisKey: "k", dilate: 2, feather: 2 };

describe("prepareObjectRemovalForExport", () => {
  beforeEach(() => { ensure.mockReset(); });

  it("does nothing, and loads nothing, for a project without Remove Object", async () => {
    expect(await prepareObjectRemovalForExport(projectWith(), { isCancelled: () => false, onProgress: vi.fn() })).toBe(0);
    expect(await prepareObjectRemovalForExport(projectWith({ ...enabled, enabled: false }), { isCancelled: () => false, onProgress: vi.fn() })).toBe(0);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("re-runs the analysis for a Remove Object clip and forwards its progress", async () => {
    implement(async (_p, _s, onProgress) => {
      onProgress?.(0.5, "Analysing Remove Object");
      return 1;
    });
    const onProgress = vi.fn();
    expect(await prepareObjectRemovalForExport(projectWith(enabled), { isCancelled: () => false, onProgress })).toBe(1);
    expect(onProgress).toHaveBeenCalledWith(0.5, "Analysing Remove Object");
  });

  it("aborts the analysis when the export is cancelled and reports a cancellation", async () => {
    let cancelled = false;
    implement((_p, signal) => new Promise<number>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("stopped")));
    }));
    const pending = prepareObjectRemovalForExport(projectWith(enabled), { isCancelled: () => cancelled, onProgress: vi.fn() });
    cancelled = true;
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes a real failure through", async () => {
    ensure.mockRejectedValue(new Error("The first frame could not be read"));
    await expect(prepareObjectRemovalForExport(projectWith(enabled), { isCancelled: () => false, onProgress: vi.fn() })).rejects.toThrow(/first frame/);
  });
});
