const MAX_ONNX_THREADS = 8;

/** True in the desktop renderer (main thread only; workers cannot see window.openreel). */
export function isDesktopRenderer(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop";
}

/**
 * Wasm thread count for ONNX: leave one core for the UI, cap at 8. Multi-threading
 * is desktop-only; web (isolated or not) and non-isolated contexts get 1.
 */
export function pickOnnxThreads(
  crossOriginIsolated: boolean,
  hardwareConcurrency: number,
  desktop = false,
): number {
  if (!crossOriginIsolated || !desktop) return 1;
  const cores = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 1;
  return Math.max(1, Math.min(MAX_ONNX_THREADS, Math.floor(cores) - 1));
}

/**
 * Directory URL of the one onnxruntime-web WASM set (ort/, emitted by vite-plugins/ort-runtime) as seen from the whisper worker.
 * Built, the worker lives in <base>/assets/, so the runtime is its sibling; the dev server serves it at /ort/.
 */
export function ortWasmPathsFor(workerHref: string, dev: boolean): string {
  return dev ? new URL("/ort/", workerHref).toString() : new URL("../ort/", workerHref).toString();
}
