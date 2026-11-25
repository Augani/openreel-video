import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { analyseMorphCut, MorphCutCancelled } from "./analysis";
import { pickDenseBackend } from "./render";
import { getMorphCutRegistry } from "./registry";
import { MORPH_CUT_ANALYSING_MESSAGE, MORPH_CUT_CANCELLED_MESSAGE, MORPH_CUT_FAILED_MESSAGE, MORPH_CUT_VERSION, type MorphAnalysis, type MorphCutQuality } from "./types";

/**
 * Runs (or reuses) the analysis of one transition and publishes its state: "analysing" with progress, then "ready"
 * or "failed". Returns the analysis. Identical keys share one running job, so the preview, the export and the
 * background scheduler never analyse the same cut twice.
 */
export interface MorphCutJob {
  readonly transitionId: string;
  readonly key: string;
  readonly quality: MorphCutQuality;
  /** Decodes the two reference frames at the project size. Called only when the key is not cached. */
  readonly loadFrames: () => Promise<{ a: RGBAFrame; b: RGBAFrame } | null>;
}

const running = new Map<string, Promise<MorphAnalysis | null>>();
/** The key each transition is currently waiting for: a job that finishes for an older key must not publish. */
const latestKey = new Map<string, string>();
/** One abort controller per running job, so the badge's Cancel can stop it. */
const controllers = new Map<string, AbortController>();

/**
 * Stops the analysis running for a transition. The transition keeps rendering as a cross dissolve and the background
 * scan will not restart it until `restartMorphCutAnalysis` clears the cancelled state. Returns whether a job was running.
 */
export function cancelMorphCutAnalysis(transitionId: string): boolean {
  const controller = controllers.get(transitionId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Forgets a cancelled state so the next scan analyses the transition again. */
export function restartMorphCutAnalysis(transitionId: string): void {
  const registry = getMorphCutRegistry();
  if (registry.getState(transitionId).status === "cancelled") registry.clearState(transitionId);
}

export function morphCutCacheKey(parts: { sourceKeyA: string; timeA: number; sourceKeyB: string; timeB: number; width: number; height: number; quality: MorphCutQuality }): string {
  return `morph${MORPH_CUT_VERSION}|${parts.sourceKeyA}@${parts.timeA.toFixed(4)}|${parts.sourceKeyB}@${parts.timeB.toFixed(4)}|${parts.width}x${parts.height}|${parts.quality}`;
}

function publish(job: MorphCutJob, analysis: MorphAnalysis): void {
  const registry = getMorphCutRegistry();
  registry.activate(job.transitionId, job.key);
  const current = registry.getState(job.transitionId);
  // a render loop asks for the cached analysis every frame: do not wake every subscriber for an unchanged state
  if (current.key === job.key && (current.status === "ready" || current.status === "failed")) return;
  registry.setState(job.transitionId, {
    status: analysis.ok ? "ready" : "failed",
    progress: 1,
    message: analysis.ok ? "" : MORPH_CUT_FAILED_MESSAGE,
    key: job.key,
    analysisMs: analysis.analysisMs,
    backend: analysis.backend,
    confidence: analysis.metrics.confidence,
  });
}

export function runMorphCutAnalysis(job: MorphCutJob): Promise<MorphAnalysis | null> {
  const registry = getMorphCutRegistry();
  const cached = registry.getResult(job.key);
  if (cached) {
    latestKey.set(job.transitionId, job.key);
    publish(job, cached);
    return Promise.resolve(cached);
  }
  const previous = registry.getState(job.transitionId);
  if (previous.status === "cancelled" && previous.key === job.key) return Promise.resolve(null);
  const inflight = running.get(`${job.transitionId}|${job.key}`);
  if (inflight) return inflight;
  latestKey.set(job.transitionId, job.key);
  registry.deactivate(job.transitionId);
  registry.setState(job.transitionId, { status: "analysing", progress: 0, message: MORPH_CUT_ANALYSING_MESSAGE, key: job.key });
  const controller = new AbortController();
  controllers.set(job.transitionId, controller);
  const promise = (async (): Promise<MorphAnalysis | null> => {
    try {
      const frames = await job.loadFrames();
      if (controller.signal.aborted) throw new MorphCutCancelled();
      if (!frames) {
        registry.setState(job.transitionId, { status: "failed", progress: 1, message: "Morph Cut could not read the frames at this cut", key: job.key });
        return null;
      }
      const backend = await pickDenseBackend();
      const analysis = await analyseMorphCut(frames.a, frames.b, {
        key: job.key,
        quality: job.quality,
        backend,
        signal: controller.signal,
        onProgress: (fraction) => registry.setState(job.transitionId, { status: "analysing", progress: fraction, message: MORPH_CUT_ANALYSING_MESSAGE, key: job.key }),
      });
      registry.putResult(job.key, analysis);
      if (latestKey.get(job.transitionId) === job.key) publish(job, analysis);
      return analysis;
    } catch (error) {
      if (error instanceof MorphCutCancelled) {
        registry.setState(job.transitionId, { status: "cancelled", progress: 0, message: MORPH_CUT_CANCELLED_MESSAGE, key: job.key });
        return null;
      }
      console.warn("[MorphCut] analysis failed:", error);
      registry.setState(job.transitionId, { status: "failed", progress: 1, message: MORPH_CUT_FAILED_MESSAGE, key: job.key });
      return null;
    }
  })().finally(() => {
    running.delete(`${job.transitionId}|${job.key}`);
    if (controllers.get(job.transitionId) === controller) controllers.delete(job.transitionId);
  });
  running.set(`${job.transitionId}|${job.key}`, promise);
  return promise;
}
