import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { synthesizeFrame, type FlowPair } from "../time-interpolation/optical-flow-cpu";
import { GpuOpticalFlow, type GpuFieldSet } from "../time-interpolation/optical-flow-gpu";
import { getTimeInterpolator } from "../time-interpolation/time-interpolator";
import { cpuDenseBackend, type DenseFlowBackend } from "./analysis";
import type { MorphAnalysis, MorphField } from "./types";

/**
 * Renders a Morph Cut frame: the two live frames of the transition span are warped toward each other through the
 * analysed displacement fields and cross dissolved with occlusion aware weights. That is exactly the in-between
 * synthesis of Time Interpolation (same kernels, same constants) evaluated at the transition's progress, so the
 * morph at progress 0 is the outgoing frame and at progress 1 the incoming frame, and the CPU reference and the
 * WebGPU kernel agree.
 */
export type MorphRenderPath = "gpu" | "cpu";

let gpuPromise: Promise<GpuOpticalFlow | null> | null = null;
let gpuInstance: GpuOpticalFlow | null = null;
const uploaded = new Map<string, GpuFieldSet>();

export async function getMorphGpu(): Promise<GpuOpticalFlow | null> {
  if (getTimeInterpolator().getBackend() === "cpu") return null;
  if (gpuInstance?.isLost) {
    gpuInstance = null;
    gpuPromise = null;
    for (const set of uploaded.values()) set.destroy();
    uploaded.clear();
  }
  if (!gpuPromise) {
    gpuPromise = GpuOpticalFlow.create().then((g) => {
      gpuInstance = g;
      return g;
    });
  }
  return gpuPromise;
}

/** Drops the GPU resources of the module (tests, device loss, project close). */
export function disposeMorphGpu(): void {
  for (const set of uploaded.values()) set.destroy();
  uploaded.clear();
  gpuInstance?.dispose();
  gpuInstance = null;
  gpuPromise = null;
}

/** Dense flow of the analysis on the GPU (null when WebGPU compute is unavailable). */
export async function createGpuDenseBackend(): Promise<DenseFlowBackend | null> {
  const gpu = await getMorphGpu();
  if (!gpu) return null;
  return {
    name: "gpu",
    async compute(a, b, params, onStage) {
      const pair = gpu.prepare(a, b, a.width, a.height, params);
      try {
        const flow = await gpu.readFlow(pair);
        onStage?.(1, 1);
        return flow;
      } finally {
        pair.destroy();
      }
    },
  };
}

/** The best dense-flow backend this device supports, honouring the shared CPU/GPU preference. */
export async function pickDenseBackend(): Promise<DenseFlowBackend> {
  try {
    return (await createGpuDenseBackend()) ?? cpuDenseBackend;
  } catch {
    return cpuDenseBackend;
  }
}

export function fieldToFlowPair(field: MorphField, width: number): FlowPair {
  return { width: field.width, height: field.height, factor: width / field.width, ab: field.ab, ba: field.ba, confAB: field.confAB, confBA: field.confBA };
}

/** Is the frame size the analysis grid maps to (aspect ratio within 2%)? Otherwise the field would not line up. */
export function fieldFitsFrame(field: MorphField, width: number, height: number): boolean {
  const gridAspect = field.width / field.height;
  const aspect = width / height;
  return Math.abs(gridAspect - aspect) / aspect < 0.02;
}

/** How many Morph Cut frames each implementation has rendered (tests and the benchmark read it). */
export const morphRenderStats = { gpuFrames: 0, cpuFrames: 0, lastRenderMs: 0 };

export interface MorphFrameResult {
  readonly data: Uint8ClampedArray;
  readonly path: MorphRenderPath;
}

export async function renderMorphFrame(analysis: MorphAnalysis, a: RGBAFrame, b: RGBAFrame, t: number): Promise<MorphFrameResult> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const result = await renderMorphFrameUncounted(analysis, a, b, t);
  morphRenderStats[result.path === "gpu" ? "gpuFrames" : "cpuFrames"]++;
  morphRenderStats.lastRenderMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  return result;
}

async function renderMorphFrameUncounted(analysis: MorphAnalysis, a: RGBAFrame, b: RGBAFrame, t: number): Promise<MorphFrameResult> {
  const field = analysis.field;
  if (!field) throw new Error("Morph Cut analysis has no field");
  const width = a.width;
  const height = a.height;
  const gpu = await getMorphGpu();
  if (gpu) {
    try {
      const key = `${analysis.key}|${width}`;
      let set = uploaded.get(key);
      if (!set) {
        set = gpu.uploadFields(field.width, field.height, width / field.width, field);
        uploaded.set(key, set);
        while (uploaded.size > 6) {
          const oldest = uploaded.keys().next().value as string;
          uploaded.get(oldest)?.destroy();
          uploaded.delete(oldest);
        }
      }
      return { data: await gpu.synthesizeWith(set, a, b, width, height, t), path: "gpu" };
    } catch {
      disposeMorphGpu();
      gpuPromise = Promise.resolve(null);
    }
  }
  return { data: synthesizeFrame(a, b, fieldToFlowPair(field, width), t), path: "cpu" };
}
