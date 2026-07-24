import { describe, it, expect, vi } from "vitest";
import type { JobKind, JobResult } from "@openreel/agent";
import { runExportQueue, type ExportJobSpec } from "./export-queue";

function specs(n: number): ExportJobSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `export-${i}`,
    kind: "exportVideo" as JobKind,
    params: { variant: i },
  }));
}

describe("runExportQueue", () => {
  it("drives multiple jobs and respects the concurrency cap", async () => {
    let active = 0;
    let maxActive = 0;
    const runner = async (): Promise<JobResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, data: { jobID: "j" } };
    };

    const results = await runExportQueue(specs(5), runner, { concurrency: 2 });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it("preserves input order and isolates failures", async () => {
    const runner = async (_kind: JobKind, params: Record<string, unknown>): Promise<JobResult> => {
      if (params.variant === 1) return { ok: false, error: "GPU OOM" };
      return { ok: true, data: { variant: params.variant } };
    };
    const results = await runExportQueue(specs(3), runner, { concurrency: 3 });
    expect(results.map((r) => r.id)).toEqual(["export-0", "export-1", "export-2"]);
    expect(results[1]).toMatchObject({ ok: false, error: "GPU OOM" });
    expect(results[0].ok).toBe(true);
    expect(results[2].ok).toBe(true);
  });

  it("captures a thrown runner as an error result without aborting siblings", async () => {
    const runner = async (_kind: JobKind, params: Record<string, unknown>): Promise<JobResult> => {
      if (params.variant === 1) throw new Error("runner crashed");
      return { ok: true };
    };
    const results = await runExportQueue(specs(3), runner, { concurrency: 3 });
    expect(results[1]).toMatchObject({ ok: false, error: "runner crashed" });
    expect(results[0].ok).toBe(true);
    expect(results[2].ok).toBe(true);
  });

  it("returns an empty array for no jobs", async () => {
    const runner = vi.fn(async (): Promise<JobResult> => ({ ok: true }));
    const results = await runExportQueue([], runner, { concurrency: 4 });
    expect(results).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports progress for each completed job", async () => {
    const progress: Array<[number, number]> = [];
    await runExportQueue(specs(3), async () => ({ ok: true }), {
      concurrency: 1,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});
