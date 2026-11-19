import { v4 as uuidv4 } from "uuid";
import {
  applySpeakerStyles,
  clusterEmbeddings,
  detectionCues,
  mirrorSpeakersToTranslations,
  ensureSpeakerProfiles,
  labelCuesBySpeaker,
  type Clip,
  type MediaItem,
  type Subtitle,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../utils/whisper-audio";
import type { DiarizationWorkerResponse } from "../workers/diarization-worker";
import type { CommandOutcome } from "./premiere-edit-commands";

/**
 * On-device speaker diarization for the caption cues. Each cue's audio is
 * decoded from the source clip under it, voice-printed in a worker, clustered,
 * and the result (Speaker 1..N labels + profiles, with their caption looks
 * baked on) is committed as ONE undo step. Nothing leaves the machine.
 */

const MAX_CUE_SECONDS = 10;

export interface DiarizeOptions {
  /** Exact number of speakers; omit to detect automatically. */
  speakerCount?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
}

export type DiarizeOutcome = CommandOutcome & { speakers?: number; skipped?: number };

function clipUnder(project: ReturnType<typeof useProjectStore.getState>["project"], time: number) {
  const media = new Map(project.mediaLibrary.items.map((item) => [item.id, item]));
  let found: { clip: Clip; media: MediaItem } | undefined;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      const item = media.get(clip.mediaId);
      if (!item || (item.type !== "audio" && item.type !== "video")) continue;
      if (time < clip.startTime || time >= clip.startTime + clip.duration) continue;
      if (!found || item.type === "audio") found = { clip, media: item };
    }
  }
  return found;
}

function runWorker(
  segments: Array<{ id: string; samples: Float32Array }>,
  options: DiarizeOptions,
): Promise<Map<string, Float32Array | null>> {
  const worker = new Worker(new URL("../workers/diarization-worker.ts", import.meta.url), { type: "module" });
  const requestId = uuidv4();
  return new Promise((resolve, reject) => {
    const done = () => {
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      done();
      reject(new DOMException("Speaker detection cancelled.", "AbortError"));
    };
    options.signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<DiarizationWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "progress") options.onProgress?.(0.4 + message.progress * 0.55, "Analysing voices…");
      else {
        done();
        resolve(new Map(message.embeddings.map((e) => [e.id, e.embedding])));
      }
    };
    worker.onerror = () => {
      done();
      reject(new Error("The speaker analysis worker stopped. Try again."));
    };
    worker.postMessage({ requestId, segments }, segments.map((s) => s.samples.buffer));
  });
}

export async function diarizeCaptions(options: DiarizeOptions = {}): Promise<DiarizeOutcome> {
  const store = useProjectStore.getState();
  const all: Subtitle[] = store.project.timeline.subtitles;
  // Hidden translated tracks repeat the same time ranges; analyse the visible track only.
  const subtitles = detectionCues(all);
  if (!subtitles.length) return { success: false, message: "There are no captions to label yet." };

  const plan = subtitles.map((cue) => ({ cue, source: clipUnder(store.project, (cue.startTime + cue.endTime) / 2) }));
  const usable = plan.filter((p) => p.source);
  if (!usable.length) return { success: false, message: "No captions overlap a clip with audio." };
  // A source with no audio stream at all gets its own message (not "could not be decoded").
  const silent = (item: MediaItem) =>
    item.metadata?.hasAudio === false || (item.type === "video" && item.metadata?.hasAudio === undefined && item.metadata?.audioTrackCount === 0);
  const withAudio = usable.filter((p) => !silent((p.source as NonNullable<typeof p.source>).media));
  if (!withAudio.length)
    return { success: false, message: "The clips under these captions have no audio track, so there are no voices to tell apart." };

  const audioContext = new AudioContext();
  try {
    const segments: Array<{ id: string; samples: Float32Array }> = [];
    let previous: { blob: Blob; track?: number; buffer: AudioBuffer } | undefined;
    // Cues in clip order so adjacent cues share one decode.
    const ordered = withAudio.sort((a, b) => a.cue.startTime - b.cue.startTime);
    for (let i = 0; i < ordered.length; i++) {
      if (options.signal?.aborted) throw new DOMException("Speaker detection cancelled.", "AbortError");
      const { cue, source } = ordered[i];
      const { clip, media } = source as NonNullable<typeof source>;
      const blob = media.blob ?? (media.fileHandle ? await media.fileHandle.getFile() : null);
      if (!blob) return { success: false, message: "Reconnect the source media before detecting speakers." };
      let buffer: AudioBuffer | null =
        previous && previous.blob === blob && previous.track === clip.audioTrackIndex ? previous.buffer : null;
      if (!buffer) {
        buffer = await loadAudioBuffer(audioContext, blob, { audioTrackIndex: clip.audioTrackIndex });
        if (buffer) previous = { blob, track: clip.audioTrackIndex, buffer };
      }
      options.onProgress?.((i / ordered.length) * 0.4, "Reading audio…");
      if (!buffer) continue;
      const speed = Math.max(clip.speed ?? 1, 0.01);
      const from = Math.max(0, (clip.inPoint ?? 0) + (Math.max(cue.startTime, clip.startTime) - clip.startTime) * speed);
      const to = Math.min(
        buffer.duration,
        from + Math.min(MAX_CUE_SECONDS, (Math.min(cue.endTime, clip.startTime + clip.duration) - Math.max(cue.startTime, clip.startTime)) * speed),
      );
      if (to > from) segments.push({ id: cue.id, samples: audioBufferToWhisperSamples(buffer, from, to) });
    }
    if (!segments.length) return { success: false, message: "No audio could be read from the clips under the captions." };

    options.onProgress?.(0.4, "Analysing voices…");
    const embeddings = await runWorker(segments, options);
    const voiced = subtitles.map((cue) => embeddings.get(cue.id) ?? null);
    const indexes = voiced.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
    if (indexes.length < 1) return { success: false, message: "No speech was clear enough to tell voices apart." };

    const clustered = clusterEmbeddings(indexes.map((i) => voiced[i] as Float32Array), { speakerCount: options.speakerCount });
    const clusters: Array<number | null> = subtitles.map(() => null);
    indexes.forEach((cueIndex, k) => (clusters[cueIndex] = clustered[k]));

    const current = useProjectStore.getState();
    if (current.project.timeline.subtitles !== all) return { success: false, message: "The captions changed while detecting speakers. Run it again." };
    // A re-run maps each voice back onto the speaker it overlaps most (renamed ones keep their name and look); the rest are replaced.
    const { labels, profiles } = labelCuesBySpeaker(subtitles, clusters, current.project.speakers ?? [], {
      previous: subtitles.map((cue) => cue.speaker),
    });
    const labelById = new Map(subtitles.map((cue, i) => [cue.id, labels[i]] as const));
    const detected = all.map((cue) => {
      const label = labelById.get(cue.id);
      return label ? { ...cue, speaker: label } : cue;
    });
    // Translated cues of the same time range share the speaker (and so the colour / label).
    const labelled = mirrorSpeakersToTranslations(detected, new Set(subtitles.map((cue) => cue.id)));
    const used = new Set(labelled.map((cue) => cue.speaker));
    const finalProfiles = ensureSpeakerProfiles(labelled, profiles).filter((p) => used.has(p.name));
    const result = await current.executeAction({
      type: "speaker/apply",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { subtitles: applySpeakerStyles(labelled, finalProfiles), profiles: finalProfiles },
    });
    options.onProgress?.(1, "Done");
    return result.success
      ? { success: true, speakers: new Set(labels.filter(Boolean)).size, skipped: subtitles.length - indexes.length }
      : { success: false, message: result.error?.message ?? "Speaker labels could not be applied." };
  } finally {
    void audioContext.close().catch(() => undefined);
  }
}
