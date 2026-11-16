/**
 * A playback frame decode that never answers must not freeze the preview.
 *
 * The multi-track playback loop awaits every active layer's `sink.getCanvas()` before it paints and before it
 * lets the next frame start. A WebCodecs decoder that stops producing output (hardware decoders are reclaimed
 * by the browser under memory or GPU pressure, a seek into a corrupt GOP) leaves that promise pending forever:
 * the Program monitor and the timeline playhead stop while the audio clock runs on. That is the "playhead
 * advanced 16 s of 46 s" stall seen once on the layered 4K playback soak (docs/known-limitations.md, Memory): the
 * playhead store is only updated by frames, so a pending decode freezes it. The stall was not reproduced, so this
 * is a bound on the one unbounded await in the loop, not a proven root-cause fix.
 *
 * The deadline turns the hang into an error the caller handles by dropping that layer's frame and rebuilding
 * its decoder, so a wedge costs about one deadline (4 s), not the rest of the playback.
 */
// Generous: a seek into a 10 s 4K GOP under load takes up to ~1.5 s (scrub p95); this only catches a decode that never answers.
export const FRAME_DECODE_DEADLINE_MS = 4000;

export class FrameDecodeTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`Frame decode did not answer within ${deadlineMs} ms`);
    this.name = "FrameDecodeTimeoutError";
  }
}

export function withDecodeDeadline<T>(
  work: Promise<T>,
  deadlineMs: number = FRAME_DECODE_DEADLINE_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FrameDecodeTimeoutError(deadlineMs)), deadlineMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
