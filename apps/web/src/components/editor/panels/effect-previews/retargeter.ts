export interface Retargeter {
  /** Call on every playhead / selection / project change. Only the last call in a burst has an effect. */
  schedule(): void;
  cancel(): void;
}

/**
 * Trailing debounce for re-pointing the previews at new footage: `evaluate` runs once, `delayMs`
 * after the last `schedule()`. While `isPlaying()` the playhead moves every frame, so the run is
 * skipped (the transport stopping schedules again).
 */
export function createRetargeter(options: {
  delayMs: number;
  isPlaying: () => boolean;
  evaluate: () => void;
}): Retargeter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (options.isPlaying()) return;
        options.evaluate();
      }, options.delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
