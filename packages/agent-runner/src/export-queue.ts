import type { JobKind, JobRunner } from "@openreel/agent";

export interface ExportJobSpec {
  readonly id: string;
  readonly kind: JobKind;
  readonly params: Record<string, unknown>;
}

export interface ExportJobResult {
  readonly id: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface ExportQueueOptions {
  readonly concurrency?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Drives a batch of export/render jobs through a JobRunner (e.g. the GPU worker)
 * with a bounded worker pool — the "export these N variants" capability. Results
 * are returned in input order; a failing job never aborts the rest.
 */
export async function runExportQueue(
  jobs: ExportJobSpec[],
  runner: JobRunner,
  options: ExportQueueOptions = {},
): Promise<ExportJobResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const results = new Array<ExportJobResult>(jobs.length);
  let nextIndex = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        const result = await runner(job.kind, job.params);
        results[index] = {
          id: job.id,
          ok: result.ok,
          data: result.data,
          error: result.error,
        };
      } catch (error) {
        results[index] = {
          id: job.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      done++;
      options.onProgress?.(done, jobs.length);
    }
  };

  const poolSize = Math.min(concurrency, jobs.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}
