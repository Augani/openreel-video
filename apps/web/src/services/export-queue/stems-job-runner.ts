import {
  ZipWriter,
  createCachedMixdownRenderer,
  getAudioEngine,
  encodeStemWav,
  planStems,
  renderStemPcm,
  type ExportJob,
  type ExportStemOutput,
  type Project,
  StemExportError,
} from "@openreel/core";
import { createBrowserOutputSink } from "./export-queue-storage";
import type { RunJobHooks } from "./export-queue-runner";
import { ExportJobCancelled, createDiskWritable } from "./export-queue-runner";

const isDesktop = (): boolean => typeof window !== "undefined" && window.openreel?.platform === "desktop";

let activeAbort: AbortController | null = null;
/** Lets the queue's Cancel reach a stems job that is rendering. */
export const cancelRunningStemsJob = (): void => {
  activeAbort?.abort();
};

export interface RunStemsResult {
  readonly output: { filename: string; bytes: number; storage: "browser" | "disk"; path?: string };
  readonly stemOutputs: ExportStemOutput[];
}

/**
 * Renders every selected bus, track or audio type of the job's project snapshot as a WAV through the
 * export mixdown and streams them into a store-only zip (one stem in memory at
 * a time). Outputs line up sample for sample, so the stems re-sum in a DAW.
 */
export async function runStemsJob(job: ExportJob, project: Project, hooks: RunJobHooks): Promise<RunStemsResult> {
  const mode = job.stems?.mode ?? "bus";
  const ids = job.stems?.ids ?? job.stems?.busIds;
  const plan = planStems(project, { mode, ids: ids ? [...ids] : undefined });
  if (plan.length === 0) {
    throw new Error(
      mode === "bus"
        ? "None of the selected buses carries any audio. Route tracks into a bus, then add the stems again."
        : "None of the selected tracks or audio types carries any audio.",
    );
  }
  const checkCancelled = () => {
    if (hooks.isCancelled()) throw new ExportJobCancelled();
  };
  checkCancelled();
  const controller = new AbortController();
  activeAbort = controller;
  const renderer = createCachedMixdownRenderer(getAudioEngine());
  const bitDepth = job.stems?.bitDepth ?? 24;
  const desktop = isDesktop();

  let writable: FileSystemWritableFileStream;
  let finish: () => Promise<RunStemsResult["output"]>;
  let discard: () => Promise<void>;
  if (desktop) {
    const fs = window.openreel!.fs;
    const path = await fs.tempFilePath("zip", true);
    writable = await createDiskWritable(path);
    finish = async () => ({ filename: job.outputName, bytes: 0, storage: "disk", path });
    discard = async () => {
      await fs.releaseTemp?.(path).catch(() => undefined);
    };
  } else {
    const sink = await createBrowserOutputSink(job.id, "zip", "application/zip");
    writable = sink.writable;
    finish = async () => ({ filename: job.outputName, bytes: await sink.finish(), storage: "browser" });
    discard = () => sink.discard();
  }

  const zip = new ZipWriter(async (chunk: Uint8Array) => {
    await writable.write(chunk as unknown as Parameters<FileSystemWritableFileStream["write"]>[0]);
  });
  const stemOutputs: ExportStemOutput[] = [];
  try {
    for (let i = 0; i < plan.length; i += 1) {
      const item = plan[i];
      checkCancelled();
      hooks.onProgress(i / plan.length, `Rendering ${item.name} (${i + 1}/${plan.length})`);
      const pcm = await renderStemPcm(project, item, renderer, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (hooks.isCancelled()) controller.abort();
          hooks.onProgress((i + fraction * 0.95) / plan.length, `Rendering ${item.name} (${i + 1}/${plan.length})`);
        },
      });
      checkCancelled();
      const wav = encodeStemWav(pcm, bitDepth);
      await zip.add({ name: item.fileName, data: wav });
      stemOutputs.push({
        busId: item.busId,
        kind: item.kind,
        name: item.name,
        filename: item.fileName,
        bytes: wav.byteLength,
        sampleRate: pcm.sampleRate,
        channels: pcm.channels.length,
        durationSec: pcm.frames / pcm.sampleRate,
      });
    }
    hooks.onProgress(0.99, "Writing archive");
    await zip.finish();
    await writable.close();
    const output = await finish();
    return { output: desktop ? { ...output, bytes: zip.bytesWritten } : output, stemOutputs };
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await discard();
    if (error instanceof StemExportError && /cancelled/i.test(error.message)) throw new ExportJobCancelled();
    throw error;
  } finally {
    if (activeAbort === controller) activeAbort = null;
  }
}
