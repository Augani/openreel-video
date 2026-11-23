import { blendRGBA, type RGBAFrame } from "./frame-blend";
import { computeFlowPair, synthesizeFrame, type FlowPair } from "./optical-flow-cpu";
import { GpuOpticalFlow, type GpuFlowPair } from "./optical-flow-gpu";
import { ByteLruCache } from "./interpolation-cache";
import { detectSceneCut } from "./scene-cut";
import { flowParamsFor, flowParamsKey, type InterpolationQuality, type SourceSamplePlan, type TimeInterpolation } from "./types";

/**
 * Produces the in-between frame of a retimed clip for Frame Blending and Optical Flow.
 *
 * The result depends only on the two source frames, the position t between them, the mode and the quality, so the
 * preview and the export (which both reach it through VideoEngine.renderFrame at the same `frameSampleTime`) get
 * the same pixels. Finished frames are cached by (source, frame pair, t, mode, params, size); the expensive flow
 * of a frame pair is cached separately, so the several intermediates between one pair (25% speed: three) cost
 * one flow estimation. The GPU path is used when WebGPU compute is available, the CPU reference otherwise;
 * both implement the same algorithm.
 */
export type FrameLike = RGBAFrame | ImageBitmap;
export type TimeInterpolationBackend = "auto" | "gpu" | "cpu";

export interface InterpolationJob {
  readonly mode: Exclude<TimeInterpolation, "frameSampling">;
  /** Identity of the footage (media id, plus anything that changes its pixels such as a proxy or stabilized blob). */
  readonly sourceKey: string;
  readonly plan: SourceSamplePlan;
  readonly quality?: InterpolationQuality;
  /** Decodes the source frame at a source time (seconds). Called only on a cache miss. */
  readonly loadFrame: (time: number) => Promise<FrameLike | null>;
}

export interface InterpolatedFrame extends RGBAFrame {
  readonly path: "blend" | "gpu" | "cpu" | "cut";
  readonly cacheHit: boolean;
}

export interface InterpolatorStats {
  frameHits: number;
  frameMisses: number;
  flowHits: number;
  flowMisses: number;
  gpuFrames: number;
  cpuFrames: number;
  blendFrames: number;
  /** Pairs judged to be scene cuts (the nearer source frame was output instead of an interpolation). */
  cutFrames: number;
  cutChecks: number;
  lastComputeMs: number;
}

const FRAME_CACHE_BYTES = 192 * 1024 * 1024;
const SOURCE_CACHE_BYTES = 96 * 1024 * 1024;

type FlowEntry =
  | { kind: "cpu"; a: RGBAFrame; b: RGBAFrame; flow: FlowPair }
  | { kind: "gpu"; width: number; height: number; pair: GpuFlowPair };

const isRgba = (f: FrameLike): f is RGBAFrame => typeof (f as RGBAFrame).data !== "undefined";

export function bitmapToRGBA(bitmap: ImageBitmap): RGBAFrame {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, data: image.data };
}

export async function rgbaToBitmap(frame: RGBAFrame): Promise<ImageBitmap> {
  const image = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
  return createImageBitmap(image);
}

export class TimeInterpolator {
  private readonly frames = new ByteLruCache<RGBAFrame>(FRAME_CACHE_BYTES);
  private readonly sources = new ByteLruCache<RGBAFrame>(SOURCE_CACHE_BYTES);
  private readonly flows = new ByteLruCache<FlowEntry>(48 * 1024 * 1024, (entry) => {
    if (entry.kind === "gpu") entry.pair.destroy();
  });
  private readonly cuts = new Map<string, boolean>();
  private gpu: GpuOpticalFlow | null = null;
  private gpuProbe: Promise<void> | null = null;
  private backend: TimeInterpolationBackend = "auto";
  readonly stats: InterpolatorStats = { frameHits: 0, frameMisses: 0, flowHits: 0, flowMisses: 0, gpuFrames: 0, cpuFrames: 0, blendFrames: 0, cutFrames: 0, cutChecks: 0, lastComputeMs: 0 };
  private readonly inflight = new Map<string, Promise<InterpolatedFrame | null>>();

  setBackend(backend: TimeInterpolationBackend): void {
    if (backend === this.backend) return;
    this.backend = backend;
    this.flows.clear();
    this.frames.clear();
  }

  getBackend(): TimeInterpolationBackend {
    return this.backend;
  }

  /** Cached frames and flows are dropped (the footage or the project changed). */
  clear(): void {
    this.frames.clear();
    this.sources.clear();
    this.flows.clear();
    this.cuts.clear();
  }

  /** Is the frame already rendered (a scrub to it is instant)? */
  isCached(job: Pick<InterpolationJob, "mode" | "sourceKey" | "plan" | "quality">, width: number, height: number): boolean {
    return this.frames.has(this.frameKey(job, width, height));
  }

  private frameKey(job: Pick<InterpolationJob, "mode" | "sourceKey" | "plan" | "quality">, width: number, height: number): string {
    const params = job.mode === "opticalFlow" ? flowParamsKey(flowParamsFor(job.quality)) : "-";
    const tq = Math.round(job.plan.t * 1000);
    return `${job.sourceKey}|${job.plan.frameBefore}|${job.plan.frameAfter}|${tq}|${job.mode}|${params}|${width}x${height}`;
  }

  private pairKey(job: InterpolationJob, width: number, height: number, path: "gpu" | "cpu"): string {
    return `${job.sourceKey}|${job.plan.frameBefore}|${job.plan.frameAfter}|${flowParamsKey(flowParamsFor(job.quality))}|${width}x${height}|${path}`;
  }

  private async gpuInstance(): Promise<GpuOpticalFlow | null> {
    if (this.backend === "cpu") return null;
    if (this.gpu?.isLost) {
      this.gpu = null;
      this.gpuProbe = null;
      this.flows.clear();
    }
    if (!this.gpuProbe) {
      this.gpuProbe = GpuOpticalFlow.create().then((g) => {
        this.gpu = g;
      });
    }
    await this.gpuProbe;
    return this.gpu;
  }

  private async source(job: InterpolationJob, time: number, index: number): Promise<{ rgba: RGBAFrame | null; raw: FrameLike | null }> {
    const key = `${job.sourceKey}|${index}`;
    const cached = this.sources.get(key);
    if (cached) return { rgba: cached, raw: cached };
    const raw = await job.loadFrame(time);
    if (!raw) return { rgba: null, raw: null };
    const rgba = isRgba(raw) ? raw : bitmapToRGBA(raw);
    this.sources.set(key, rgba, rgba.data.byteLength);
    return { rgba, raw };
  }

  /**
   * The interpolated frame, or null when a source frame is unavailable or the two differ in size (the caller
   * then falls back to Frame Sampling).
   */
  async render(job: InterpolationJob): Promise<InterpolatedFrame | null> {
    if (!job.plan.needsInterpolation) return null;
    // size is only known after decoding; the key's size is that of the first frame, resolved below
    const inflightKey = `${job.sourceKey}|${job.plan.frameBefore}|${job.plan.frameAfter}|${Math.round(job.plan.t * 1000)}|${job.mode}|${job.quality ?? "medium"}`;
    const running = this.inflight.get(inflightKey);
    if (running) return running;
    const promise = this.renderUncached(job).finally(() => this.inflight.delete(inflightKey));
    this.inflight.set(inflightKey, promise);
    return promise;
  }

  private async renderUncached(job: InterpolationJob): Promise<InterpolatedFrame | null> {
    const { plan } = job;
    const first = await this.source(job, plan.timeBefore, plan.frameBefore);
    if (!first.rgba) return null;
    const width = first.rgba.width;
    const height = first.rgba.height;
    const key = this.frameKey(job, width, height);
    const hit = this.frames.get(key);
    if (hit) {
      this.stats.frameHits++;
      return { ...hit, path: job.mode === "frameBlending" ? "blend" : "cpu", cacheHit: true };
    }
    this.stats.frameMisses++;
    const second = await this.source(job, plan.timeAfter, plan.frameAfter);
    if (!second.rgba || second.rgba.width !== width || second.rgba.height !== height) return null;
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let result: { data: Uint8ClampedArray; path: "blend" | "gpu" | "cpu" | "cut" };
    if (this.isCut(job, first.rgba, second.rgba)) {
      // a cut: show the nearer source frame, whichever backend would have synthesised the rest
      const nearer = plan.t < 0.5 ? first.rgba : second.rgba;
      result = { data: new Uint8ClampedArray(nearer.data), path: "cut" };
      this.stats.cutFrames++;
    } else if (job.mode === "frameBlending") {
      result = { data: blendRGBA(first.rgba, second.rgba, plan.t), path: "blend" };
      this.stats.blendFrames++;
    } else {
      result = await this.opticalFlow(job, first, second, width, height);
    }
    this.stats.lastComputeMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    const frame: RGBAFrame = { width, height, data: result.data };
    this.frames.set(key, frame, result.data.byteLength);
    return { ...frame, path: result.path, cacheHit: false };
  }

  /** The cut decision of a frame pair, made once (it does not depend on t, the mode or the backend). */
  private isCut(job: InterpolationJob, a: RGBAFrame, b: RGBAFrame): boolean {
    const key = `${job.sourceKey}|${job.plan.frameBefore}|${job.plan.frameAfter}|${a.width}x${a.height}`;
    let cut = this.cuts.get(key);
    if (cut === undefined) {
      cut = detectSceneCut(a, b).isCut;
      this.stats.cutChecks++;
      if (this.cuts.size >= 4096) this.cuts.clear();
      this.cuts.set(key, cut);
    }
    return cut;
  }

  private async opticalFlow(
    job: InterpolationJob,
    first: { rgba: RGBAFrame | null; raw: FrameLike | null },
    second: { rgba: RGBAFrame | null; raw: FrameLike | null },
    width: number,
    height: number,
  ): Promise<{ data: Uint8ClampedArray; path: "gpu" | "cpu" }> {
    const params = flowParamsFor(job.quality);
    const a = first.rgba!;
    const b = second.rgba!;
    const gpu = await this.gpuInstance();
    if (gpu && this.backend !== "cpu") {
      try {
        const key = this.pairKey(job, width, height, "gpu");
        let entry = this.flows.get(key);
        if (entry?.kind !== "gpu") {
          this.stats.flowMisses++;
          const pair = gpu.prepare(a, b, width, height, params);
          entry = { kind: "gpu", width, height, pair };
          this.flows.set(key, entry, width * height * 8);
        } else {
          this.stats.flowHits++;
        }
        const data = await gpu.synthesize(entry.pair, job.plan.t);
        this.stats.gpuFrames++;
        return { data, path: "gpu" };
      } catch (error) {
        if (this.backend === "gpu") throw error;
        // a device that fails mid-way is abandoned for this session; the CPU reference takes over
        this.gpu?.dispose();
        this.gpu = null;
        this.gpuProbe = Promise.resolve();
        this.flows.clear();
      }
    }
    if (this.backend === "gpu") throw new Error("WebGPU compute is not available");
    const key = this.pairKey(job, width, height, "cpu");
    let entry = this.flows.get(key);
    if (entry?.kind !== "cpu") {
      this.stats.flowMisses++;
      entry = { kind: "cpu", a, b, flow: computeFlowPair(a, b, params) };
      this.flows.set(key, entry, entry.flow.ab.byteLength * 3);
    } else {
      this.stats.flowHits++;
    }
    const data = synthesizeFrame(entry.a, entry.b, entry.flow, job.plan.t);
    this.stats.cpuFrames++;
    return { data, path: "cpu" };
  }
}

let shared: TimeInterpolator | null = null;
export function getTimeInterpolator(): TimeInterpolator {
  if (!shared) shared = new TimeInterpolator();
  return shared;
}
