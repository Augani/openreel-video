/**
 * The monitor's VR view: a rectilinear window onto an equirectangular frame, aimed with pan / tilt / roll / field of
 * view. It runs the same VR Projection shader (or the CPU reference when WebGL2 is unavailable) as the effect, so
 * what the monitor shows is what Reframe to flat renders. It is a VIEW only: it never reaches the project, the render
 * cache or an export.
 */
import { MotionShaderRenderer } from "../motion/motion-shader-renderer";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";
import { applyProEffect, proEffectGpuUniforms } from "./pro-effects";
import { loadVrRuntime } from "./vr-runtime-loader";
import { type VrViewParams } from "./vr-view-params";

export * from "./vr-view-params";

function effectParams(view: VrViewParams): Record<string, unknown> {
  return { mode: "rectilinear", layout: view.layout, fov: view.fov, pan: view.pan, tilt: view.tilt, roll: view.roll, aspect: view.aspect };
}

/** Loads the VR effects runtime the view renders with (the monitor overlay awaits this before its first draw). */
export function prepareVrView(): Promise<void> {
  return loadVrRuntime().then(() => undefined);
}

let renderer: MotionShaderRenderer | null = null;
let cpuScratch: OffscreenCanvas | null = null;

/**
 * Renders the view of `source` (an equirect frame) into a canvas of the SAME size as the source; the picture sits in
 * `vrViewWindow(width, height, aspect)` and the rest is transparent. Returns null when nothing could be rendered.
 */
export function renderVrView(
  source: HTMLCanvasElement | OffscreenCanvas,
  view: VrViewParams,
): HTMLCanvasElement | OffscreenCanvas | null {
  const { width, height } = source;
  if (!width || !height) return null;
  const params = effectParams(view);
  if (MotionShaderRenderer.isSupported()) {
    renderer ??= new MotionShaderRenderer();
    const result = renderer.render(PRO_EFFECT_SHADER_DEFS["vr-projection"], {
      width,
      height,
      time: 0,
      params: proEffectGpuUniforms("vr-projection", params, height),
      inputCanvas: source,
      strict: true,
    });
    if (result) return result as HTMLCanvasElement | OffscreenCanvas;
  }
  if (typeof OffscreenCanvas === "undefined") return null;
  if (!cpuScratch || cpuScratch.width !== width || cpuScratch.height !== height) cpuScratch = new OffscreenCanvas(width, height);
  const ctx = cpuScratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  applyProEffect("vr-projection", params, pixels.data, width, height);
  ctx.putImageData(pixels, 0, 0);
  return cpuScratch;
}
