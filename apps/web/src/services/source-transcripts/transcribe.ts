import type { MediaItem, Subtitle } from "@openreel/core";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { loadAudioBuffer } from "../../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../../utils/whisper-audio";
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, type WhisperModelKey } from "../../workers/whisper-models";
import { isDesktopRenderer } from "../../workers/whisper-threads";

interface WorkerChunk {
  text: string;
  timestamp: [number | null, number | null];
}

export const mediaBlobOf = async (media: MediaItem): Promise<Blob | null> =>
  media.blob ?? (media.fileHandle ? await media.fileHandle.getFile().catch(() => null) : null);

/** Whisper phrase chunks as cues in source seconds (word timings inside a phrase are estimated by the transcript model). */
export function chunksToCues(chunks: readonly WorkerChunk[], duration: number, idPrefix: string): Subtitle[] {
  const cues: Subtitle[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    const startTime = Math.max(0, chunk.timestamp?.[0] ?? 0);
    const rawEnd = chunk.timestamp?.[1] ?? startTime + 3;
    const endTime = Math.max(startTime + 0.05, duration > 0 ? Math.min(duration, rawEnd) : rawEnd);
    cues.push({ id: `${idPrefix}-${cues.length}`, text, startTime, endTime });
  }
  return cues;
}

export interface TranscribeOptions {
  model?: WhisperModelKey;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number | null, message: string) => void;
}

/** Transcribe one media item's first audio track with the on-device Whisper worker (the Auto Caption pipeline). */
export async function transcribeMediaItem(media: MediaItem, options: TranscribeOptions = {}): Promise<Subtitle[]> {
  const blob = await mediaBlobOf(media);
  if (!blob) throw new Error("Reconnect the source media before transcribing it.");
  const model = options.model ?? DEFAULT_WHISPER_MODEL;
  const context = new AudioContext();
  try {
    const buffer = await loadAudioBuffer(context, blob, {
      onProgress: (p) => options.onProgress?.(p.progress * 0.2, p.message),
    });
    if (!buffer) throw new Error("The audio of this clip could not be decoded.");
    const samples = audioBufferToWhisperSamples(buffer);
    const worker = new Worker(new URL("../../workers/whisper-worker.ts", import.meta.url), { type: "module" });
    try {
      const requestId = crypto.randomUUID();
      options.onProgress?.(0.2, `Loading ${WHISPER_MODELS[model].shortLabel}…`);
      const chunks = await new Promise<WorkerChunk[]>((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (options.signal?.aborted) return abort();
        options.signal?.addEventListener("abort", abort, { once: true });
        worker.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
          if (event.data.requestId !== requestId) return;
          const type = event.data.type;
          if (type === "model-progress") {
            const value = Number(event.data.progress ?? 0);
            options.onProgress?.(0.2 + Math.min(1, value > 1 ? value / 100 : value) * 0.3, "Loading the speech model…");
          } else if (type === "transcription-progress") options.onProgress?.(0.6, "Transcribing on this device…");
          else if (type === "result") resolve((event.data.chunks as WorkerChunk[] | undefined) ?? []);
          else if (type === "error") reject(new Error(String(event.data.message ?? "Local transcription failed.")));
        });
        worker.postMessage({
          requestId,
          type: "transcribe",
          audio: samples,
          model,
          language: options.language,
          desktop: isDesktopRenderer(),
        });
      });
      return chunksToCues(chunks, buffer.duration, `st-${media.id.slice(0, 8)}`);
    } finally {
      worker.terminate();
    }
  } finally {
    void context.close().catch(() => undefined);
  }
}

/** Transcribe as a tracked background task, so it shows in the Background Tasks panel and can be cancelled. */
export const transcribeMediaTracked = (media: MediaItem, options: Omit<TranscribeOptions, "signal"> = {}): Promise<Subtitle[]> =>
  backgroundTasks.track({ kind: "transcription", source: "transcription", title: `Transcribing ${media.name}` }, (ctx) =>
    transcribeMediaItem(media, {
      ...options,
      signal: ctx.signal,
      onProgress: (fraction, message) => {
        ctx.progress(fraction, message);
        options.onProgress?.(fraction, message);
      },
    }),
  );
