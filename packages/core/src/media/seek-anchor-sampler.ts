/**
 * Seek anchors: a sparse, low-resolution frame index of a video, sampled in one
 * forward decode pass. Seeking a long-GOP clip (GOP 250, B-frames) costs ~100 ms
 * because the decoder must restart at the previous keyframe and decode every
 * frame up to the target. The preview paints the nearest anchor while that exact
 * decode finishes, so a click-seek changes the picture almost immediately and is
 * then refined to the exact frame.
 */

export interface SeekAnchorPlanOptions {
  /** Upper bound on anchors per media (memory is anchors x width x height x 4). */
  readonly maxAnchors?: number;
  /** Closest allowed spacing in seconds. */
  readonly minSpacing?: number;
}

export const DEFAULT_MAX_ANCHORS = 150;
export const DEFAULT_MIN_SPACING = 0.5;

/** Evenly spaced anchor timestamps in [0, duration), at most `maxAnchors`. */
export function planAnchorTimes(
  durationSeconds: number,
  options: SeekAnchorPlanOptions = {},
): number[] {
  const maxAnchors = Math.max(1, options.maxAnchors ?? DEFAULT_MAX_ANCHORS);
  const minSpacing = Math.max(0.05, options.minSpacing ?? DEFAULT_MIN_SPACING);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const spacing = Math.max(minSpacing, durationSeconds / maxAnchors);
  const times: number[] = [];
  for (let t = 0; t < durationSeconds - 1e-6; t += spacing) {
    times.push(Math.round(t * 1000) / 1000);
  }
  return times;
}

export interface SeekAnchor {
  readonly time: number;
  readonly bitmap: ImageBitmap;
}

export interface SampleSeekAnchorsOptions extends SeekAnchorPlanOptions {
  /** Anchors are downscaled to at most this width (never upscaled). */
  readonly maxWidth?: number;
  readonly signal?: AbortSignal;
  /**
   * Awaited before each anchor is requested. Lets the caller hold the decode
   * back while the user is seeking, scrubbing or playing.
   */
  readonly waitUntilIdle?: () => Promise<void>;
  /** Receives ownership of each anchor bitmap. */
  readonly onAnchor: (anchor: SeekAnchor) => void;
}

export interface SampleSeekAnchorsResult {
  readonly completed: boolean;
  readonly anchors: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes one low-res frame per planned timestamp with a single mediabunny
 * CanvasSink pass. Resolves `completed: false` when aborted or unsupported.
 */
export async function sampleSeekAnchors(
  blob: Blob,
  options: SampleSeekAnchorsOptions,
): Promise<SampleSeekAnchorsResult> {
  const empty: SampleSeekAnchorsResult = {
    completed: false,
    anchors: 0,
    durationSeconds: 0,
    width: 0,
    height: 0,
  };
  const { signal } = options;
  if (signal?.aborted) return empty;
  // Opening the source configures a full-resolution hardware decoder (tens of MB at 4K). Do not do
  // that while the editor is busy: the sampler's decoder used to open on top of playback's.
  await options.waitUntilIdle?.();
  if (signal?.aborted) return empty;
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || signal?.aborted || !(await track.canDecode())) return empty;
    const duration = await input.computeDuration();
    const times = planAnchorTimes(duration, options);
    if (times.length === 0) return empty;

    const maxWidth = options.maxWidth ?? 256;
    const srcW = track.displayWidth;
    const srcH = track.displayHeight;
    const width = Math.max(2, Math.min(maxWidth, srcW));
    const height = Math.max(2, Math.round((width * srcH) / srcW));
    const sink = new CanvasSink(track, { width, height, fit: "contain", poolSize: 2 });

    async function* gated(): AsyncGenerator<number> {
      for (const t of times) {
        if (signal?.aborted) return;
        await options.waitUntilIdle?.();
        if (signal?.aborted) return;
        yield t;
      }
    }

    let anchors = 0;
    const iterator = sink.canvasesAtTimestamps(gated());
    try {
      let index = 0;
      for await (const wrapped of iterator) {
        if (signal?.aborted) break;
        const time = times[index++];
        if (!wrapped || time === undefined) continue;
        const bitmap = await createImageBitmap(wrapped.canvas);
        if (signal?.aborted) {
          bitmap.close();
          break;
        }
        options.onAnchor({ time, bitmap });
        anchors += 1;
      }
    } finally {
      await iterator.return?.(undefined);
    }
    return {
      completed: !signal?.aborted && anchors > 0,
      anchors,
      durationSeconds: duration,
      width,
      height,
    };
  } finally {
    input.dispose();
  }
}
