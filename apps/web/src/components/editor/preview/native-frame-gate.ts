/**
 * Redundant-redraw gate for native (HTMLVideoElement) playback.
 *
 * The draw loop runs on requestAnimationFrame, which is 60-120 Hz, while a 24-30 fps clip presents a new
 * decoded frame only every 33-42 ms. Redrawing the same frame on every rAF repaints the background, re-draws
 * the video into the Program canvas and copies the canvas into a bitmap three or four times per source frame.
 * The gate remembers what the canvas last showed and lets the loop skip a pass when nothing it draws changed.
 */

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface Watch {
  count: number;
  handle: number;
}

/**
 * Counts the frames a video element has presented, through requestVideoFrameCallback. `token` is null for an
 * element that is not watched or on an engine without the API (the caller then always redraws).
 */
export class VideoFrameTokens {
  private readonly watches = new Map<HTMLVideoElement, Watch>();

  watch(video: HTMLVideoElement): void {
    const element = video as FrameCallbackVideo;
    if (this.watches.has(video) || typeof element.requestVideoFrameCallback !== "function") return;
    const state: Watch = { count: 0, handle: 0 };
    const onFrame = (): void => {
      state.count += 1;
      if (this.watches.get(video) === state) state.handle = element.requestVideoFrameCallback!(onFrame);
    };
    state.handle = element.requestVideoFrameCallback(onFrame);
    this.watches.set(video, state);
  }

  token(video: HTMLVideoElement): number | null {
    return this.watches.get(video)?.count ?? null;
  }

  dispose(): void {
    for (const [video, state] of this.watches) {
      const element = video as FrameCallbackVideo;
      if (typeof element.cancelVideoFrameCallback === "function") element.cancelVideoFrameCallback(state.handle);
    }
    this.watches.clear();
  }
}

/**
 * `shouldDraw(key)` is true when the canvas must be repainted. A null key means "this pass is not skippable"
 * (overlays, effects or anything else the key cannot describe) and always draws.
 */
export class NativeFrameGate {
  private last: string | null = null;

  shouldDraw(key: string | null): boolean {
    if (key === null || key !== this.last) {
      this.last = key;
      return true;
    }
    return false;
  }

  reset(): void {
    this.last = null;
  }
}

/** Throttle for the "last good frame" safety copy: a full canvas readback is only worth it now and then. */
export class IntervalGate {
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs: number) {}

  due(now: number): boolean {
    if (now - this.lastAt < this.intervalMs) return false;
    this.lastAt = now;
    return true;
  }
}
