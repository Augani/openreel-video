/**
 * The heavy half of Time Interpolation (optical-flow CPU reference, the WGSL kernels, the WebGPU driver, scene-cut
 * detection, the frame caches). VideoEngine loads it with a dynamic import() the first time a clip with Frame Blending
 * or Optical Flow needs an in-between frame, so none of it is parsed or compiled at startup or by the editor chunk.
 * Everything that is needed to decide *whether* a clip interpolates (types, planSourceSamples, the source key) stays in
 * ./types and ./source-key.
 */
export { getTimeInterpolator, bitmapToRGBA, rgbaToBitmap } from "./time-interpolator";
