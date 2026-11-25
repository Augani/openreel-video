/**
 * Plan + run of the WebGPU grade chain for callers outside VideoEngine (the live preview's effects bridge).
 * Kept separate so those callers can import it lazily: the WGSL and the planner stay out of the startup chunks.
 */
import type { Effect } from "../types/timeline";
import { GpuGradeChain, isWebGpuGradeSupported } from "./gpu-grade-chain";
import { planGpuGradeChain, type GpuGradeInput } from "./gpu-grade-plan";

export { GpuGradeChain, isWebGpuGradeSupported };
export type { GpuGradeInput };

/**
 * Runs a clip's enabled effects and colour grade over `image` on the chain. Resolves to a new bitmap the caller owns,
 * or null when the chain cannot take the clip (an effect without a WGSL port, no WebGPU, a failure): the caller then
 * uses its Canvas2D / WebGL path on the untouched `image`.
 */
export async function runGpuGrade(
  chain: GpuGradeChain,
  image: ImageBitmap,
  effects: readonly Effect[],
  grading: GpuGradeInput | undefined,
): Promise<ImageBitmap | null> {
  let plan: ReturnType<typeof planGpuGradeChain>;
  try {
    plan = planGpuGradeChain(effects, grading, image.width, image.height);
  } catch (error) {
    console.warn("Failed to plan the GPU grade chain, using the Canvas2D grade", error);
    return null;
  }
  if (!plan || plan.passes.length === 0) return null;
  return chain.run(image, plan);
}
