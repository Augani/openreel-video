/**
 * Dropped-frame counter behind Premiere's "Show Dropped Frame Indicator". The playback controller
 * increments it whenever the clock tells it to skip a frame or a frame render fails; the UI
 * subscribes. Kept separate from the controller so it is testable without an audio context.
 */
export type DroppedFrameListener = (count: number) => void;

/** Dropped frames at or above this count turn the indicator from green to yellow. */
export const DROPPED_FRAME_WARNING_THRESHOLD = 1;

export type DroppedFrameLevel = "ok" | "dropped";

export function droppedFrameLevel(count: number): DroppedFrameLevel {
  return count >= DROPPED_FRAME_WARNING_THRESHOLD ? "dropped" : "ok";
}

export class DroppedFrameCounter {
  private total = 0;
  private readonly listeners = new Set<DroppedFrameListener>();

  get count(): number {
    return this.total;
  }

  increment(by = 1): void {
    if (!(by > 0)) return;
    this.total += by;
    this.emit();
  }

  /** Starts a fresh count (a new playback run). Does nothing, and notifies nobody, when already zero. */
  reset(): void {
    if (this.total === 0) return;
    this.total = 0;
    this.emit();
  }

  /** Calls the listener on every change; the returned function unsubscribes. */
  subscribe(listener: DroppedFrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.total);
      } catch {
        // A listener must not stop the others or the playback loop.
      }
    }
  }
}

/**
 * The count every presenter writes into. The PlaybackController (clock-driven skips, failed renders) and the
 * Program monitor's own present loop (frames that arrived late) share it, so the indicator reflects what the
 * viewer actually sees.
 */
export const sharedDroppedFrames = new DroppedFrameCounter();

/**
 * Derives dropped frames from the cadence of presented frames: a frame that arrives more than 1.5 frame
 * durations after the previous one means the frames in between were not shown. Gaps beyond `maxGapMs`
 * (a seek, a loop wrap, a pause) are not counted as drops; the next present starts a fresh interval.
 */
export class PresentCadenceTracker {
  private lastAt: number | null = null;

  constructor(
    private readonly counter: DroppedFrameCounter,
    private readonly frameDurationMs: number,
    private readonly maxGapMs = 2000,
  ) {}

  /** Starts a new run; the first present afterwards is never counted. */
  begin(): void {
    this.lastAt = null;
  }

  /** Reports a frame shown at `nowMs`; returns the number of frames judged dropped before it. */
  presented(nowMs: number, rate = 1): number {
    const previous = this.lastAt;
    this.lastAt = nowMs;
    if (previous === null || !(this.frameDurationMs > 0)) return 0;
    const expected = this.frameDurationMs / (rate > 0 ? rate : 1);
    const gap = nowMs - previous;
    if (gap > this.maxGapMs || gap <= expected * 1.5) return 0;
    const dropped = Math.round(gap / expected) - 1;
    if (dropped > 0) this.counter.increment(dropped);
    return Math.max(0, dropped);
  }
}
