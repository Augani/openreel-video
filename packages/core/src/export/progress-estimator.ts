/**
 * Honest export progress and ETA. Progress never moves backwards, the ETA is
 * withheld until there is enough signal, counts down between updates, and
 * converges to zero as progress reaches 1. The clock is injected so the
 * behaviour is testable with a fake clock.
 */

export interface EtaSnapshot {
  /** Monotonic 0..1. */
  readonly fraction: number;
  readonly elapsedSeconds: number;
  /** Seconds left, or null while there is not yet enough data to say. */
  readonly etaSeconds: number | null;
}

export interface ProgressEstimatorOptions {
  /** Trailing window for the "recent speed" estimate. */
  readonly windowMs?: number;
  /** No ETA before this much time has passed... */
  readonly minElapsedMs?: number;
  /** ...and this much progress has been made. */
  readonly minFraction?: number;
}

export class ProgressEstimator {
  private readonly windowMs: number;
  private readonly minElapsedMs: number;
  private readonly minFraction: number;
  private startedAt: number | null = null;
  private samples: { t: number; f: number }[] = [];
  private fraction = 0;
  private shownEta: number | null = null;
  private shownAt = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    options: ProgressEstimatorOptions = {},
  ) {
    this.windowMs = options.windowMs ?? 10_000;
    this.minElapsedMs = options.minElapsedMs ?? 2_000;
    this.minFraction = options.minFraction ?? 0.02;
  }

  start(): void {
    this.startedAt = this.now();
    this.samples = [{ t: this.startedAt, f: 0 }];
    this.fraction = 0;
    this.shownEta = null;
    this.shownAt = this.startedAt;
  }

  /**
   * Between progress reports: the last ETA counted down by the time that has passed
   * (never below one second while unfinished), without adding a sample. Progress that
   * genuinely stalls is picked up by the next `update`.
   */
  tick(): EtaSnapshot {
    if (this.startedAt === null) this.start();
    const t = this.now();
    const base = { fraction: this.fraction, elapsedSeconds: (t - this.startedAt!) / 1000 };
    if (this.fraction >= 1) return { ...base, etaSeconds: 0 };
    if (this.shownEta === null) return { ...base, etaSeconds: null };
    return { ...base, etaSeconds: Math.max(1, this.shownEta - (t - this.shownAt) / 1000) };
  }

  update(rawFraction: number): EtaSnapshot {
    if (this.startedAt === null) this.start();
    const startedAt = this.startedAt!;
    const t = this.now();
    const clamped = Number.isFinite(rawFraction) ? Math.min(1, Math.max(0, rawFraction)) : this.fraction;
    this.fraction = Math.max(this.fraction, clamped);
    const f = this.fraction;
    this.samples.push({ t, f });
    const cutoff = t - this.windowMs;
    while (this.samples.length > 2 && this.samples[1].t < cutoff) this.samples.shift();

    const elapsedMs = t - startedAt;
    const base = { fraction: f, elapsedSeconds: elapsedMs / 1000 };
    if (f >= 1) {
      this.shownEta = 0;
      this.shownAt = t;
      return { ...base, etaSeconds: 0 };
    }
    if (elapsedMs < this.minElapsedMs || f < this.minFraction) return { ...base, etaSeconds: null };

    const overallRate = f / elapsedMs; // fraction per ms
    const oldest = this.samples[0];
    const windowMs = t - oldest.t;
    const recentRate = windowMs > 0 ? (f - oldest.f) / windowMs : 0;
    // Blend: the recent speed reacts to the encode getting slower or faster, the
    // overall speed damps noise. A stall (recent 0) leans on the overall speed.
    const w = Math.min(1, windowMs / this.windowMs) ** 2;
    const rate = recentRate > 0 ? w * recentRate + (1 - w) * overallRate : 0.5 * overallRate;
    if (!(rate > 0)) return { ...base, etaSeconds: null };
    const target = (1 - f) / rate / 1000;

    let eta: number;
    if (this.shownEta === null) {
      eta = target;
    } else {
      // Count down in real time from the last shown value, then pull toward the
      // fresh estimate so a changed speed is absorbed without the display jumping.
      const counted = Math.max(0, this.shownEta - (t - this.shownAt) / 1000);
      eta = counted + 0.4 * (target - counted);
    }
    this.shownEta = eta;
    this.shownAt = t;
    return { ...base, etaSeconds: Math.max(0, eta) };
  }
}

/** "about 2 min 10 s left", or "estimating…" when unknown. */
export function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds)) return "estimating…";
  const total = Math.max(0, Math.round(etaSeconds));
  if (total < 5) return "a few seconds left";
  if (total < 60) return `about ${Math.round(total / 5) * 5} s left`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
  return `about ${minutes} min ${String(seconds).padStart(2, "0")} s left`;
}
