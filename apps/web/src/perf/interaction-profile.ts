import { startRenderCounting, stopRenderCounting, type RenderSnapshot } from "../test/render-hook";

export interface InteractionSample {
  cpuMs: number;
  wallMs: number;
  commits: number;
  renders: number;
  byComponent: Record<string, number>;
}

/**
 * Runs `work` once and reports main-thread CPU (user+system of this process,
 * immune to other processes' load), wall time and React commit / component render counts.
 */
export async function sample(work: () => void | Promise<void>): Promise<InteractionSample> {
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  startRenderCounting();
  await work();
  const snap: RenderSnapshot = stopRenderCounting();
  const wallMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  return {
    cpuMs: (cpu.user + cpu.system) / 1000,
    wallMs,
    commits: snap.commits,
    renders: snap.total,
    byComponent: snap.byComponent,
  };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function topComponents(samples: InteractionSample[], limit = Number(process.env.PERF_TOP ?? 6)): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const s of samples) for (const [k, v] of Object.entries(s.byComponent)) totals.set(k, (totals.get(k) ?? 0) + v);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([k, v]) => [k, Math.round(v / samples.length)]);
}
