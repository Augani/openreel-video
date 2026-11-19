/**
 * Stall recovery for the Source monitor's media element.
 *
 * Chrome's media pipeline can wedge after a seek: the element reports readyState < HAVE_FUTURE_DATA
 * (a "waiting" event), or a seek that never completes, although the whole file is buffered, and it
 * never resumes by itself. Pause/play does not help, but re-issuing the seek to the current position does.
 * The watchdog below detects exactly that state and reports when to re-seek.
 */

export interface MediaSample {
  currentTime: number;
  readyState: number;
  seeking: boolean;
  /** End of the buffered range containing currentTime, or -1 when none does. */
  bufferedEnd: number;
}

const HAVE_FUTURE_DATA = 3;
/** Buffered data this far ahead of the playhead means the element is not simply waiting for bytes. */
const MIN_BUFFERED_AHEAD = 0.25;

/**
 * True when the element looks wedged: it has no future data (or a seek that never completes) although
 * local data past the playhead is buffered, so it is not simply waiting for bytes.
 */
export function isWedged(s: MediaSample): boolean {
  return (s.seeking || s.readyState < HAVE_FUTURE_DATA) && s.bufferedEnd > s.currentTime + MIN_BUFFERED_AHEAD;
}

export function sampleMedia(el: HTMLMediaElement): MediaSample {
  let bufferedEnd = -1;
  for (let i = 0; i < el.buffered.length; i++) {
    if (el.buffered.start(i) <= el.currentTime + 0.05 && el.buffered.end(i) > el.currentTime) {
      bufferedEnd = el.buffered.end(i);
      break;
    }
  }
  return { currentTime: el.currentTime, readyState: el.readyState, seeking: el.seeking, bufferedEnd };
}

/**
 * Tracks consecutive wedged samples at an unchanged position. `check` returns true once the element
 * has been wedged for `stallMs` (`seekMs` while a seek is pending, since real seeks can be slow on a
 * loaded machine), then restarts the timer so a failed recovery is retried.
 */
export class StallWatchdog {
  private stuckSince: number | null = null;
  private lastTime = Number.NaN;

  constructor(
    private readonly stallMs = 700,
    private readonly seekMs = 2000,
  ) {}

  check(sample: MediaSample, now: number): boolean {
    if (!isWedged(sample) || sample.currentTime !== this.lastTime) {
      this.lastTime = sample.currentTime;
      this.stuckSince = isWedged(sample) ? now : null;
      return false;
    }
    if (this.stuckSince === null) this.stuckSince = now;
    if (now - this.stuckSince < (sample.seeking ? this.seekMs : this.stallMs)) return false;
    this.stuckSince = now;
    return true;
  }
}
