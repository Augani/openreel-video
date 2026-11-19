import type { MulticamTranscriptSegment } from "@openreel/core";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { audioBufferToWhisperSamples } from "../utils/whisper-audio";
import type { WhisperModelKey } from "../workers/whisper-models";
import { isDesktopRenderer } from "../workers/whisper-threads";

interface WorkerChunk {
  text: string;
  timestamp: [number | null, number | null];
}

export function whisperChunksToMulticamTranscript(
  chunks: readonly WorkerChunk[],
): MulticamTranscriptSegment[] {
  return chunks.flatMap((chunk) => {
    const text = chunk.text.trim();
    if (!text) return [];
    const start = Math.max(0, chunk.timestamp[0] ?? 0);
    const end = Math.max(start, chunk.timestamp[1] ?? start + 3);
    return [{ startMs: Math.round(start * 1_000), endMs: Math.round(end * 1_000), text }];
  });
}

export function transcribeMulticamChannels(
  buffers: ReadonlyMap<string, AudioBuffer>,
  options: {
    model?: WhisperModelKey;
    language?: string;
    onStatus?: (angleId: string, message: string) => void;
  } = {},
): Promise<Record<string, MulticamTranscriptSegment[]>> {
  return backgroundTasks.track(
    { kind: "transcription", source: "transcription", title: `Transcribing multicam \u00b7 ${buffers.size} angle${buffers.size === 1 ? "" : "s"}` },
    (ctx) => transcribeMulticamChannelsUntracked(buffers, {
      ...options,
      signal: ctx.signal,
      onStatus: (angleId, message) => { ctx.progress(null, message); options.onStatus?.(angleId, message); },
    }),
  );
}

async function transcribeMulticamChannelsUntracked(
  buffers: ReadonlyMap<string, AudioBuffer>,
  options: {
    model?: WhisperModelKey;
    language?: string;
    onStatus?: (angleId: string, message: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Record<string, MulticamTranscriptSegment[]>> {
  const worker = new Worker(
    new URL("../workers/whisper-worker.ts", import.meta.url),
    { type: "module" },
  );
  try {
    const transcripts: Record<string, MulticamTranscriptSegment[]> = {};
    for (const [angleId, buffer] of buffers) {
      const requestId = crypto.randomUUID();
      options.onStatus?.(angleId, "Loading local Whisper model…");
      const result = await new Promise<{ chunks: WorkerChunk[] }>((resolve, reject) => {
        if (options.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        const handleMessage = (event: MessageEvent<Record<string, unknown>>) => {
          if (event.data.requestId !== requestId) return;
          const type = event.data.type;
          if (type === "model-progress") {
            const progress = Number(event.data.progress ?? 0);
            options.onStatus?.(
              angleId,
              `Loading local Whisper model · ${Math.round((progress > 1 ? progress / 100 : progress) * 100)}%`,
            );
          } else if (type === "transcription-progress") {
            options.onStatus?.(angleId, "Transcribing locally…");
          } else if (type === "result") {
            worker.removeEventListener("message", handleMessage);
            resolve({ chunks: (event.data.chunks as WorkerChunk[] | undefined) ?? [] });
          } else if (type === "error") {
            worker.removeEventListener("message", handleMessage);
            reject(new Error(String(event.data.message ?? "Local transcription failed.")));
          }
        };
        worker.addEventListener("message", handleMessage);
        worker.postMessage({
          requestId,
          type: "transcribe",
          audio: audioBufferToWhisperSamples(buffer),
          model: options.model ?? "fast",
          language: options.language,
          desktop: isDesktopRenderer(),
        });
      });
      transcripts[angleId] = whisperChunksToMulticamTranscript(result.chunks);
    }
    return transcripts;
  } finally {
    worker.terminate();
  }
}
