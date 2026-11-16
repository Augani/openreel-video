import type { ExportQueueBridge, ExportQueueJobInfo, QueueExportRequest, QueueStemsRequest } from "@openreel/agent";
import { getVideoExportValidationError, DEFAULT_VIDEO_SETTINGS, projectForSequence, type ExportJob, type VideoExportSettings } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useExportQueueStore } from "../../stores/export-queue-store";
import { extendedSettingsPatch, findVideoPreset } from "./export-options";

/**
 * Jobs queued with an `outputPath`: when the job completes, its app-owned temp file is copied to the
 * agent's destination (re-checked against the allowed roots in main) and the job reports that path,
 * size and SHA-256. Until then the job still reads as running, so a poll never sees a half state.
 */
interface Destination {
  outputPath: string;
  overwrite: boolean;
  started: boolean;
}
type Finalized = { ok: true; path: string; sizeBytes: number; sha256: string } | { ok: false; error: string };
const destinations = new Map<string, Destination>();
const finalized = new Map<string, Finalized>();
let watching = false;

async function finalizeJob(id: string, destination: Destination, from: string): Promise<void> {
  const place = window.openreel?.mcp?.placeOutput;
  try {
    if (typeof place !== "function") throw new Error("outputPath needs the desktop app.");
    const placed = await place({ from, to: destination.outputPath, overwrite: destination.overwrite, move: true });
    finalized.set(
      id,
      placed.ok
        ? { ok: true, path: placed.path, sizeBytes: placed.sizeBytes, sha256: placed.sha256 }
        : { ok: false, error: `The export finished but could not be placed at ${destination.outputPath}: ${placed.message} The rendered file is still at ${from}.` },
    );
  } catch (error) {
    finalized.set(id, { ok: false, error: error instanceof Error ? error.message : "Could not place the export." });
  } finally {
    destinations.delete(id);
  }
}

function watchQueue(): void {
  if (watching) return;
  watching = true;
  useExportQueueStore.subscribe((state) => {
    // Prune finished results for jobs that were removed from the queue.
    for (const id of finalized.keys()) {
      if (!state.queue.jobs.some((entry) => entry.id === id)) finalized.delete(id);
    }
    for (const [id, destination] of destinations) {
      const job = state.queue.jobs.find((entry) => entry.id === id);
      if (!job || job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") {
        destinations.delete(id);
      } else if (job.status === "completed" && !destination.started) {
        destination.started = true;
        if (job.output?.path) void finalizeJob(id, destination, job.output.path);
        else destinations.delete(id);
      }
    }
  });
}

function toInfo(job: ExportJob): ExportQueueJobInfo {
  const final = finalized.get(job.id);
  // Completed, but the copy to outputPath is still running: keep reporting "running".
  const finalizing = destinations.has(job.id) && job.status === "completed";
  return {
    id: job.id,
    outputName: job.outputName,
    sequenceName: job.sequenceName,
    presetLabel: job.presetLabel,
    status: finalizing ? "running" : final && !final.ok && job.status === "completed" ? "failed" : job.status,
    progress: finalizing ? Math.min(job.progress, 0.99) : job.progress,
    elapsedMs: job.elapsedMs,
    etaMs: job.etaMs,
    range: job.range,
    usePreviews: job.usePreviews,
    framesFromCache: job.framesFromCache,
    smartRender: job.smartRender,
    error: final && !final.ok ? final.error : job.error,
    outputPath: final?.ok ? final.path : job.output?.path,
    outputBytes: final?.ok ? final.sizeBytes : job.output?.bytes,
    ...(final?.ok ? { sha256: final.sha256 } : {}),
    ...(job.kind === "stems"
      ? {
          kind: "stems" as const,
          stems: (job.stemOutputs ?? []).map((stem) => ({
            busId: stem.busId,
            name: stem.name,
            fileName: stem.filename,
            bytes: stem.bytes,
            sampleRate: stem.sampleRate,
            channels: stem.channels,
            durationSec: stem.durationSec,
          })),
        }
      : {}),
  };
}

/** Export queue for agents: same store and snapshot rules as the Export dialog. */
export function createExportQueueBridge(): ExportQueueBridge {
  return {
    async enqueueStems(request: QueueStemsRequest): Promise<ExportQueueJobInfo> {
      const store = useExportQueueStore.getState();
      const job = store.enqueueStems({ busIds: request.busIds, bitDepth: request.bitDepth, outputName: request.filename });
      if (!job) throw new Error("Nothing to export: none of the selected buses carries audio.");
      if (request.start !== false) store.start();
      return toInfo(useExportQueueStore.getState().queue.jobs.find((entry) => entry.id === job.id) ?? job);
    },
    async enqueue(request: QueueExportRequest): Promise<ExportQueueJobInfo> {
      const full = useProjectStore.getState().getFullProject();
      const project =
        request.sequenceId && request.sequenceId !== full.activeSequenceId
          ? projectForSequence(full, request.sequenceId)
          : full;
      if (!project) throw new Error(`Sequence not found: ${request.sequenceId}`);
      let presetLabel: string | undefined;
      let base: Partial<VideoExportSettings> = {};
      if (request.preset) {
        const preset = findVideoPreset(request.preset, project.settings);
        if (!preset) {
          throw new Error(`Unknown video preset '${request.preset}'. Call get_export_options for the preset ids.`);
        }
        base = preset.settings;
        presetLabel = preset.label;
      }
      const extended = extendedSettingsPatch(
        {
          codec: request.codec,
          bitDepth: request.bitDepth,
          hdr: request.hdr,
          audioChannels: request.audioChannels,
          timecode: request.timecode,
          targetLufs: request.targetLufs,
          truePeakCeilingDb: request.truePeakCeilingDb,
          maxBitrateKbps: request.maxBitrateKbps,
          rateControl: request.rateControl,
        },
        project.settings,
        { ...base, ...(request.codec ? { codec: request.codec } : {}), ...(request.format ? { format: request.format } : {}) },
      );
      const duration = project.timeline.duration;
      if (request.rangeEnd !== undefined && request.rangeEnd > duration + 1e-7) {
        throw new Error(`rangeEnd ${request.rangeEnd}s is past the end of the timeline (${duration.toFixed(2)}s).`);
      }
      const width = request.width ?? base.width ?? project.settings.width;
      const height = request.height ?? base.height ?? project.settings.height;
      const frameRate = request.frameRate ?? base.frameRate ?? project.settings.frameRate;
      const invalid = getVideoExportValidationError(
        { ...DEFAULT_VIDEO_SETTINGS, ...base, ...(request.format ? { format: request.format } : {}), ...(request.codec ? { codec: request.codec } : {}), ...(request.bitrate ? { bitrate: request.bitrate } : {}), ...extended, width, height, frameRate },
        duration,
      );
      if (invalid) throw new Error(invalid);
      const store = useExportQueueStore.getState();
      const job = store.enqueue({
        presetLabel,
        usePreviews: request.usePreviews,
        outputName: request.filename,
        sequenceId: request.sequenceId,
        settings: {
          ...base,
          ...(request.format ? { format: request.format } : {}),
          ...(request.codec ? { codec: request.codec } : {}),
          ...(request.bitrate ? { bitrate: request.bitrate } : {}),
          ...extended,
          ...(request.smartRender === false ? { smartRender: false } : {}),
          ...(request.captions?.length
            ? {
                captions: {
                  tracks: request.captions.map((track) => ({
                    captionTrackId: track.captionTrackId,
                    burnIn: track.burnIn ?? true,
                    sidecar: "none" as const,
                    embedded: track.embedded ?? "none",
                  })),
                },
              }
            : {}),
          width,
          height,
          frameRate,
          ...(request.rangeStart !== undefined && request.rangeEnd !== undefined
            ? { range: { startTime: request.rangeStart, endTime: request.rangeEnd } }
            : {}),
        },
      });
      if (!job) throw new Error("Nothing to export: the timeline is empty.");
      if (request.outputPath) {
        destinations.set(job.id, { outputPath: request.outputPath, overwrite: request.overwrite === true, started: false });
        watchQueue();
      }
      if (request.start !== false) store.start();
      return toInfo(useExportQueueStore.getState().queue.jobs.find((entry) => entry.id === job.id) ?? job);
    },
    list: () => useExportQueueStore.getState().queue.jobs.map(toInfo),
    cancel(jobId: string) {
      const store = useExportQueueStore.getState();
      const before = store.queue.jobs.find((job) => job.id === jobId);
      if (!before) return { found: false };
      store.cancel(jobId);
      return { found: true, status: useExportQueueStore.getState().queue.jobs.find((job) => job.id === jobId)?.status };
    },
  };
}
