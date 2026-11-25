import {
  chooseSegmentWorkers,
  decideSegments,
  getMemoryGovernor,
  getVidstabEngine,
  validateSegments,
  type ExportJob,
  type ExportSegment,
  type Project,
  type VideoExportSettings,
} from "@openreel/core";
import { chaptersMetadataFor } from "../export-chapters-metadata";
import { gpuYuvInputAvailable, nativeStartFields } from "../native-ffmpeg-backend";
import { saveSnapshot } from "./export-queue-storage";

/**
 * Desktop parallel segment export, editor-window side. The timeline is cut into segments (core/export/segment-plan),
 * hidden worker windows render them at the same time, and the main process joins the pieces losslessly with the one
 * audio track (see main/ipc/segment-export.ts). Anything that cannot be split safely, or a machine that has no room
 * for a second renderer, returns null and the caller exports serially as before.
 */
export interface ParallelRunHooks {
  onProgress(progress01: number, phase: string): void;
  isCancelled(): boolean;
}

export interface ParallelRunResult {
  readonly path: string;
  readonly workers: number;
  readonly segments: number;
  readonly encoder: string;
}

export class ParallelExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ParallelExportCancelled";
  }
}

let activeCancel: (() => void) | null = null;
/** Cancel the parallel export that is running, if any. */
export const cancelParallelExport = (): void => activeCancel?.();

export interface ParallelPlan {
  readonly segments: readonly ExportSegment[];
  readonly workers: number;
  readonly totalFrames: number;
}

/** The plan for this export on this machine, or why it stays serial. */
export function planParallelExport(
  project: Project,
  settings: VideoExportSettings,
  machine: { logicalCores: number; memoryBytes: number; pressure?: "normal" | "elevated" | "critical"; forceWorkers?: number },
): { plan: ParallelPlan | null; reasons: readonly string[] } {
  const decision = decideSegments(project, settings);
  if (!decision.parallel) return { plan: null, reasons: decision.reasons };
  const totalFrames = decision.segments.at(-1)!.endFrame;
  const invalid = validateSegments(decision.segments, totalFrames);
  if (invalid) return { plan: null, reasons: [invalid] };
  const workers = chooseSegmentWorkers({
    logicalCores: machine.logicalCores,
    systemMemoryBytes: machine.memoryBytes,
    width: settings.width,
    height: settings.height,
    pressure: machine.pressure,
    segmentCount: decision.segments.length,
  });
  // A forced count (benchmarks run the same plan one segment at a time to compare it with the concurrent run) skips the machine check.
  if (machine.forceWorkers !== undefined) return { plan: { segments: decision.segments, workers: Math.max(1, Math.min(8, Math.floor(machine.forceWorkers))), totalFrames }, reasons: [] };
  if (workers < 1) return { plan: null, reasons: ["This computer has no room for the render workers."] };
  return { plan: { segments: decision.segments, workers, totalFrames }, reasons: [] };
}

/** Whether a clip renders from something only this (editor) window holds, which hidden worker windows cannot reproduce. */
export function hasWindowLocalRenderState(project: Project): boolean {
  const vidstab = getVidstabEngine();
  return project.timeline.tracks.some((track) => track.clips.some((clip) => vidstab.hasStabilized(clip.id)));
}

/**
 * Run the export in parallel segments to `outputPath`. Resolves with null when parallel export does not apply
 * (nothing was started); rejects when it started and failed.
 */
export async function tryParallelSegmentExport(args: {
  job: ExportJob;
  project: Project;
  settings: VideoExportSettings;
  outputPath: string;
  hooks: ParallelRunHooks;
}): Promise<ParallelRunResult | null> {
  const bridge = window.openreel;
  const segments = bridge?.exportSegments;
  if (!bridge || !segments || typeof bridge.probeHardware !== "function") return null;
  const { job, project, settings, outputPath, hooks } = args;

  let hardware: Awaited<ReturnType<typeof bridge.probeHardware>>;
  try {
    hardware = await bridge.probeHardware();
  } catch {
    return null;
  }
  const { plan } = planParallelExport(project, settings, {
    logicalCores: hardware.cpu.logicalCores,
    memoryBytes: hardware.memory.totalBytes,
    pressure: getMemoryGovernor().policy.pressure,
    forceWorkers: (window as { __openreelSegmentWorkers?: number }).__openreelSegmentWorkers,
  });
  // Why an export stays one stream is `reasons`; the export simply runs serially.
  if (!plan) return null;
  // A stabilized clip renders from a blob that lives only in this window's memory; a worker window would export the unstabilized source.
  if (hasWindowLocalRenderState(project)) return null;
  // The workers read the project back from the queue's snapshot store; without a stored snapshot they have nothing to render.
  if (!(await saveSnapshot(job.id, project))) return null;

  const chaptersMetadata = await chaptersMetadataFor(project, settings, project.timeline.duration);
  const events: Array<{ sessionId: string; type: string; framesDone?: number; totalFrames?: number; phase?: string; message?: string; encoder?: string; workers?: number }> = [];
  let sessionId: string | null = null;
  let wake: (() => void) | null = null;
  const stop = segments.onEvent((event) => {
    events.push(event as (typeof events)[number]);
    wake?.();
  });
  try {
    const started = await segments.start({
      jobId: job.id,
      settings: { ...settings, parallelSegments: undefined },
      start: {
        ...nativeStartFields(settings, outputPath, plan.totalFrames, 0, await gpuYuvInputAvailable(settings)),
        // Chapters are muxed once, at the final join of the segments.
        ...(chaptersMetadata ? { chaptersMetadata } : {}),
      },
      segments: plan.segments,
      workers: plan.workers,
    });
    sessionId = started.sessionId;
    activeCancel = () => void segments.cancel(started.sessionId).catch(() => undefined);
    for (;;) {
      if (hooks.isCancelled()) {
        activeCancel();
        throw new ParallelExportCancelled();
      }
      const mine = events.splice(0).filter((event) => event.sessionId === sessionId);
      for (const event of mine) {
        if (event.type === "error") throw new Error(event.message || "Export failed");
        if (event.type === "done") {
          hooks.onProgress(1, "Complete");
          return { path: outputPath, workers: plan.workers, segments: plan.segments.length, encoder: event.encoder ?? started.encoder };
        }
        if (event.type === "progress" && event.totalFrames) {
          // Rendering is nearly all of the work; joining and the audio finish are a short tail.
          const share = Math.min(1, (event.framesDone ?? 0) / event.totalFrames) * 0.97;
          hooks.onProgress(share, `${event.phase ?? "Rendering segments"} (${plan.workers} workers)`);
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 200);
      });
    }
  } catch (error) {
    if (sessionId) await segments.cancel(sessionId).catch(() => undefined);
    throw error;
  } finally {
    activeCancel = null;
    stop();
  }
}
