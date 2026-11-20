/**
 * Warms the OS audio stack off the main thread. The first `AudioContext` of an app run blocks its
 * constructor for ~150 ms (output device discovery in the audio service, measured on macOS) and the
 * editor creates one while it opens, i.e. on the "New project" path. `enumerateDevices()` is
 * asynchronous and walks the same device list, after which the constructor takes ~45 ms. Without a
 * capture permission the labels stay empty, so this neither prompts nor reveals anything.
 * See apps/desktop/PERF.md, "Cold start round 2".
 */
export function warmAudioDevices(
  nav: { mediaDevices?: { enumerateDevices(): Promise<unknown> } } | undefined,
): void {
  try {
    void nav?.mediaDevices?.enumerateDevices().catch(() => undefined);
  } catch {
    // An optimisation: it must never break the app.
  }
}
