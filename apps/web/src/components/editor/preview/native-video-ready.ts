const abortError = () =>
  new DOMException("Frame request cancelled", "AbortError");

export function waitForVideoMetadata(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("error", failed);
      video.removeEventListener("emptied", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Video metadata could not be loaded"));
    };
    const aborted = () => {
      cleanup();
      reject(abortError());
    };
    video.addEventListener("loadedmetadata", ready);
    video.addEventListener("error", failed);
    video.addEventListener("emptied", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(failed, 10000);
  });
}

/** Register readiness listeners before seeking; a paused frame needs no subsequent playback frame. */
export function seekVideoFrame(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  const hasFrame = (tolerance = 0.01) =>
    !video.seeking &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    Math.abs(video.currentTime - time) <= tolerance;
  if (hasFrame(1e-6)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackId: number | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      if (
        callbackId !== undefined &&
        typeof video.cancelVideoFrameCallback === "function"
      )
        video.cancelVideoFrameCallback(callbackId);
      for (const name of ["seeked", "loadeddata", "canplay"])
        video.removeEventListener(name, ready);
      video.removeEventListener("error", failed);
      video.removeEventListener("emptied", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const ready = () => {
      if (hasFrame()) finish();
    };
    const failed = () => finish(new Error(
      `Video frame could not be decoded (requested ${time.toFixed(4)}s, current ${video.currentTime.toFixed(4)}s, readyState ${video.readyState}, seeking ${video.seeking})`,
    ));
    const aborted = () => finish(abortError());
    for (const name of ["seeked", "loadeddata", "canplay"])
      video.addEventListener(name, ready);
    video.addEventListener("error", failed);
    video.addEventListener("emptied", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(failed, 5000);
    try {
      if (typeof video.requestVideoFrameCallback === "function")
        callbackId = video.requestVideoFrameCallback(ready);
      video.currentTime = time;
      ready();
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error("Could not seek video"),
      );
    }
  });
}
