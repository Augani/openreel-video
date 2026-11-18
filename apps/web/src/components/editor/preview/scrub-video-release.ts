/**
 * How long a paused-frame `<video>` element (and the hardware decoder behind it) is kept after the last
 * paused frame before it is torn down.
 *
 * It used to be 350 ms, shorter than the gap between two ordinary ruler clicks, so every click of a 4K
 * session paid for a fresh element: metadata parse, decoder session setup and a cold GOP. Keeping it for a
 * few seconds reuses the element across a click-seek session while still freeing the decoder when the
 * editor is left idle. The saving is modest (see apps/desktop/PERF.md for the measured figures).
 * Retention is bounded: Preview keeps at most two paused-frame elements (it evicts the oldest beyond
 * that), and playback start releases them immediately regardless of this delay.
 */
export const SCRUB_VIDEO_RELEASE_DELAY_MS = 4000;

export interface ScrubVideoReleaser {
  /** (Re)arm the idle timer; `release` runs once if no further schedule/cancel happens within the delay. */
  schedule(release: () => void): void;
  /** Disarm the timer without releasing (a new seek is using the cached elements, or release is immediate). */
  cancel(): void;
  readonly pending: boolean;
}

export function createScrubVideoReleaser(delayMs: number = SCRUB_VIDEO_RELEASE_DELAY_MS): ScrubVideoReleaser {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    schedule(release) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        release();
      }, delayMs);
    },
    cancel,
    get pending() {
      return timer !== null;
    },
  };
}
