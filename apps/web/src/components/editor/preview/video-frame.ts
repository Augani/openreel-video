/** HTMLMediaElement.HAVE_CURRENT_DATA: the current frame is decoded and drawable. */
const HAVE_CURRENT_DATA = 2;

/** How long to wait for a just-seeked element to present a drawable frame. */
export const FRAME_READY_TIMEOUT_MS = 1000;

/** Capture attempts before giving up (the first plus retries after the frame is ready). */
export const CAPTURE_ATTEMPTS = 3;

const isNotUsable = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "InvalidStateError";

/**
 * Resolves once the element has a drawable current frame, or after the
 * timeout. A seek can resolve (`seeked`) before the decoder has presented the
 * frame on slow or software decoders, and `createImageBitmap` then throws
 * InvalidStateError ("The image source is not usable").
 */
export function waitForDrawableFrame(
  video: HTMLVideoElement,
  timeoutMs: number = FRAME_READY_TIMEOUT_MS,
): Promise<void> {
  if (video.readyState >= HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    const events = ["loadeddata", "canplay", "seeked"] as const;
    const done = () => {
      clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    for (const name of events) video.addEventListener(name, done);
  });
}

/**
 * Capture only the decoded video pixels for preview compositing.
 *
 * The caller owns project background and layer ordering. Expanding a paused
 * video frame to the project canvas here would add opaque letterbox padding
 * that can cover lower tracks and would make paused rendering diverge from
 * native playback.
 *
 * A frame that is not drawable yet is waited for and the capture retried, so a
 * slow decoder does not turn into "Preview unavailable". Other errors, and a
 * frame that never becomes drawable, are rethrown for the caller's fallback.
 */
export async function captureNativeVideoFrame(
  video: HTMLVideoElement,
): Promise<ImageBitmap> {
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1 || video.readyState < HAVE_CURRENT_DATA) await waitForDrawableFrame(video);
    try {
      return await createImageBitmap(video);
    } catch (error) {
      if (!isNotUsable(error) || attempt >= CAPTURE_ATTEMPTS) throw error;
    }
  }
}

/**
 * Decodes one frame of a media blob with WebCodecs (mediabunny), without an
 * HTMLVideoElement. The paused preview's last fallback: some decoders (e.g.
 * headless Chrome on Linux without a GPU) never make a <video> frame usable for
 * createImageBitmap, while WebCodecs (the export path) decodes it fine.
 */
export async function decodeFrameWithWebCodecs(
  blob: Blob,
  timeSeconds: number,
): Promise<ImageBitmap | null> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const wrapped = await new CanvasSink(track).getCanvas(Math.max(0, timeSeconds));
    return wrapped ? await createImageBitmap(wrapped.canvas) : null;
  } finally {
    input[Symbol.dispose]?.();
  }
}
