import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUBTITLE_STYLE_PRESETS, splitCaptionIntoSingleLineCues, type TranscriptionSegment, type Clip, type MediaItem } from "@openreel/core";
import { getReferenceCaptionStyle } from "./reference-caption-style";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../../../utils/whisper-audio";
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, isWhisperModelKey, type WhisperModelKey } from "../../../workers/whisper-models";
import { isDesktopRenderer } from "../../../workers/whisper-threads";

export const CAPTION_STYLE_PRESETS = [
  "pop-words",
  "default",
  "modern",
  "bold",
  "cinematic",
  "minimal",
] as const;
export const WHISPER_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "hi", name: "Hindi" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "vi", name: "Vietnamese" },
] as const;

export interface AutoCaptionOptions {
  clipId?: string;
  clipIds?: readonly string[];
  sourceTrackId?: string;
  sourceLabel?: string;
  maxWordsPerLine?: number;
  initialLanguage?: string;
  initialStyle?: string;
  initialHighlightWords?: boolean;
  initialRemoveFillers?: boolean;
  referenceStyles?: boolean;
  onLanguageChange?: (language: string) => void;
  onStyleChange?: (style: string) => void;
}

interface WorkerChunk {
  text: string;
  timestamp: [number | null, number | null];
}

type WorkerState = "idle" | "loading" | "ready";
interface CaptionAudioSource { clip: Clip; media: MediaItem }
interface CaptionOwner {
  projectId: string;
  sources: CaptionAudioSource[];
  model: WhisperModelKey;
  sourceTrackId?: string;
  sourceLabel?: string;
}
interface CaptionTranscriptSegment extends TranscriptionSegment { sourceClipId?: string }

export function useAutoCaptions({ clipId, clipIds, sourceTrackId, sourceLabel, maxWordsPerLine = 5, initialLanguage = "en", initialStyle = "default", initialHighlightWords, initialRemoveFillers = false, referenceStyles = false, onLanguageChange, onStyleChange }: AutoCaptionOptions) {
  const projectId = useProjectStore((state) => state.project.id);
  const project = useProjectStore((state) => state.project);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const operationLocked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const busyRef = useRef(false);
  const generation = useRef(0);
  const cancelRequest = useRef<(() => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ownerRef = useRef<CaptionOwner | null>(null);
  const progressScope = useRef({ index: 0, total: 1 });
  const [isAdding, setIsAdding] = useState(false);
  const [highlightOverride, setHighlightWords] = useState(initialHighlightWords);
  const [removeFillers, setRemoveFillers] = useState(initialRemoveFillers);
  useEffect(() => { setSelectedLanguage(initialLanguage); }, [initialLanguage]);
  useEffect(() => { setSelectedStyle(initialStyle); }, [initialStyle]);
  const workerRef = useRef<Worker | null>(null);
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage);
  const [selectedStyle, setSelectedStyle] = useState(initialStyle);
  const referenceTextStyle = referenceStyles ? getReferenceCaptionStyle(selectedStyle, project.settings.height) : undefined;
  const highlightWords = highlightOverride ?? selectedStyle === "pop-words";
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>(
    DEFAULT_WHISPER_MODEL,
  );
  const [modelBackends, setModelBackends] = useState<
    Partial<Record<WhisperModelKey, "webgpu" | "wasm">>
  >({});
  const [segments, setSegments] = useState<CaptionTranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedItems = useUIStore((state) => state.selectedItems);
  const resolvedClipId =
    clipId ?? selectedItems.find((item) => item.type === "clip")?.id ?? "";
  const { sources, requestedCount } = useMemo(() => {
    const requested = new Set(clipIds ?? (resolvedClipId ? [resolvedClipId] : []));
    const media = new Map(project.mediaLibrary.items.map(item => [item.id, item]));
    const sources: CaptionAudioSource[] = [];
    for (const track of project.timeline.tracks) for (const clip of track.clips) {
      const item = media.get(clip.mediaId);
      if (requested.has(clip.id) && item && (item.type === "video" || item.type === "audio"))
        sources.push({ clip, media: item });
    }
    return { sources: sources.sort((a, b) => a.clip.startTime - b.clip.startTime), requestedCount: requested.size };
  }, [clipIds, resolvedClipId, project.timeline.tracks, project.mediaLibrary.items]);
  const canTranscribe = Boolean(
    sources.length && sources.length === requestedCount && !exporting && !operationLocked,
  );

  const releaseWorker = useCallback(() => {
    cancelRequest.current?.();
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);
  const cancel = useCallback(() => {
    generation.current += 1;
    releaseWorker();
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    busyRef.current = false;
    setWorkerState("idle");
    setModelBackends({});
    setIsTranscribing(false);
    setIsAdding(false);
    setProgress(0);
    setProgressMessage("");
    progressScope.current = { index: 0, total: 1 };
  }, [releaseWorker]);
  useEffect(() => {
    cancel();
    ownerRef.current = null;
    setSegments([]);
    setError(null);
    return () => { generation.current += 1; releaseWorker(); void audioContextRef.current?.close().catch(() => undefined); };
  }, [projectId, cancel, releaseWorker]);

  // Mirror the local transcription run into the unified background-task panel. One row per run:
  // it keeps its creation time while progress ticks and stays as history (completed / failed / cancelled).
  const taskIdRef = useRef<string | null>(null);
  const userCancelled = useRef(false);
  const cancelFromPanel = useCallback(() => { userCancelled.current = true; cancel(); }, [cancel]);
  useEffect(() => {
    if (isTranscribing) {
      if (!taskIdRef.current) { taskIdRef.current = `transcription:captions:${Date.now()}`; userCancelled.current = false; }
      backgroundTasks.upsert(
        { id: taskIdRef.current, kind: "transcription", source: "transcription", title: "Transcribing captions", detail: progressMessage || undefined, status: "running", progress },
        { cancel: cancelFromPanel },
      );
      return;
    }
    const id = taskIdRef.current;
    if (!id) return;
    taskIdRef.current = null;
    const base = { id, kind: "transcription" as const, source: "transcription", title: "Transcribing captions" };
    backgroundTasks.upsert(
      error ? { ...base, status: "failed", error }
        : userCancelled.current ? { ...base, status: "cancelled" }
          : { ...base, status: "completed", progress: 1 },
    );
  }, [isTranscribing, progress, progressMessage, cancelFromPanel, error]);

  const sourceIsCurrent = useCallback((owner: NonNullable<typeof ownerRef.current>) => {
    const current = useProjectStore.getState();
    if (current.project.id !== owner.projectId || !owner.sources.every(({ clip, media }) => {
      const candidate = current.getClip(clip.id);
      return candidate && ["mediaId", "startTime", "duration", "inPoint", "outPoint", "speed", "audioTrackIndex"].every(key =>
        candidate[key as keyof Clip] === clip[key as keyof Clip]) &&
        current.getMediaItem(candidate.mediaId)?.blob === media.blob &&
        current.getMediaItem(candidate.mediaId)?.fileHandle === media.fileHandle;
    })) return false;
    if (!owner.sourceTrackId) return true;
    const track = current.project.timeline.tracks.find(item => item.id === owner.sourceTrackId);
    const ids = track?.clips.filter(clip => {
      const type = current.getMediaItem(clip.mediaId)?.type;
      return type === "video" || type === "audio";
    }).map(clip => clip.id).sort();
    const expected = owner.sources.map(source => source.clip.id).sort();
    return Boolean(ids && ids.length === expected.length && ids.every((id, index) => id === expected[index]));
  }, []);

  const runWorker = useCallback(
    (
      type: "load" | "transcribe",
      audio?: Float32Array,
    ): Promise<{ text?: string; chunks?: WorkerChunk[] }> => {
      const worker = workerRef.current ?? new Worker(
        new URL("../../../workers/whisper-worker.ts", import.meta.url), { type: "module" },
      );
      workerRef.current = worker;
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
          worker.removeEventListener("messageerror", handleError);
          if (cancelRequest.current === abort) cancelRequest.current = null;
        };
        const abort = () => { cleanup(); reject(new DOMException("Caption operation cancelled.", "AbortError")); };
        const handleError = () => { cleanup(); reject(new Error("The caption worker stopped. Try again.")); };
        cancelRequest.current = abort;
        const handleMessage = (
          event: MessageEvent<Record<string, unknown>>,
        ) => {
          if (event.data.requestId !== requestId) return;
          const messageType = event.data.type;
          if (messageType === "model-progress") {
            setWorkerState("loading");
            const rawProgress = Number(event.data.progress ?? 0);
            setProgress(rawProgress > 1 ? rawProgress / 100 : rawProgress);
            const file = String(event.data.file ?? "caption model")
              .split("/")
              .pop();
            setProgressMessage(`Downloading ${file || "caption model"}…`);
          } else if (messageType === "transcription-progress") {
            setWorkerState("ready");
            const { index, total } = progressScope.current;
            const ratio = Math.max(0, Math.min(1, Number(event.data.progress ?? 0)));
            setProgress((index + .2 + ratio * .8) / total);
            setProgressMessage(total === 1 ? "Transcribing selected clip locally…" : `Transcribing clip ${index + 1} of ${total} locally…`);
          } else if (messageType === "ready") {
            cleanup();
            setWorkerState("ready");
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            setProgressMessage("Offline caption model is ready");
            resolve({});
          } else if (messageType === "result") {
            cleanup();
            setWorkerState("ready");
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress((progressScope.current.index + 1) / progressScope.current.total);
            resolve({
              text: String(event.data.text ?? ""),
              chunks: (event.data.chunks ?? []) as WorkerChunk[],
            });
          } else if (messageType === "error") {
            cleanup();
            reject(
              new Error(
                String(event.data.message ?? "Local transcription failed."),
              ),
            );
          }
        };
        worker.addEventListener("message", handleMessage);
        worker.addEventListener("error", handleError);
        worker.addEventListener("messageerror", handleError);
        try {
        if (audio) {
          worker.postMessage(
            {
              requestId,
              type,
              audio,
              language: selectedLanguage,
              model: selectedModel,
              desktop: isDesktopRenderer(),
            },
            [audio.buffer],
          );
        } else {
          worker.postMessage({
            requestId,
            type,
            language: selectedLanguage,
            model: selectedModel,
            desktop: isDesktopRenderer(),
          });
        }
        } catch (reason) { cleanup(); reject(reason); }
      });
    },
    [selectedLanguage, selectedModel],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!isWhisperModelKey(value) || busyRef.current || value === selectedModel) return;
      // Keep one resident inference model; downloaded files remain in browser cache.
      releaseWorker();
        setModelBackends({});
      setSelectedModel(value);
      setSegments([]);
      setError(null);
      setProgress(0);
      setProgressMessage("");
      setWorkerState("idle");
    },
    [releaseWorker, selectedModel],
  );

  const handlePrepareModel = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = generation.current;
    setError(null);
    setWorkerState("loading");
    setProgress(0);
    setProgressMessage("Preparing offline caption model…");
    try {
      await runWorker("load");
    } catch (reason) {
      if (request !== generation.current) return;
      releaseWorker();
      setWorkerState("idle");
      setError(
        reason instanceof Error ? reason.message : "Model download failed.",
      );
    } finally { if (request === generation.current) busyRef.current = false; }
  }, [releaseWorker, runWorker]);

  const handleTranscribe = useCallback(async () => {
    if (!canTranscribe || busyRef.current) return;
    busyRef.current = true;
    const request = generation.current;
    const owner: CaptionOwner = { projectId,
      sources: sources.map(({ clip, media }) => ({ clip: { ...clip }, media })),
      model: selectedModel, sourceTrackId, sourceLabel };
    if (!sourceIsCurrent(owner)) {
      busyRef.current = false;
      setError("The source clip changed. Generate captions again.");
      return;
    }
    ownerRef.current = owner;
    setError(null);
    setSegments([]);
    setIsTranscribing(true);
    setProgress(0);
    setProgressMessage("Extracting selected clip audio…");

    let audioContext: AudioContext | null = null;
    try {
      const allSegments: CaptionTranscriptSegment[] = [];
      // Retain only the preceding decode to reuse adjacent trims without
      // caching decoded audio for the entire track.
      const decodeCache: { previous?: { blob: Blob; audioTrackIndex?: number; buffer: AudioBuffer } } = {};
      for (let index = 0; index < owner.sources.length; index++) {
        const { clip, media: mediaItem } = owner.sources[index];
        const total = owner.sources.length;
        progressScope.current = { index, total };
        const sourceBlob =
          mediaItem.blob ??
          (mediaItem.fileHandle ? await mediaItem.fileHandle.getFile() : null);
        if (!sourceBlob) {
          throw new Error("Reconnect the source media before creating captions.");
        }
        if (request !== generation.current) return;
        if (!audioContext) {
          audioContext = new AudioContext();
          audioContextRef.current = audioContext;
        }
        const previousDecode = decodeCache.previous;
        const audioBuffer: AudioBuffer | null = previousDecode?.blob === sourceBlob && previousDecode.audioTrackIndex === clip.audioTrackIndex
          ? previousDecode.buffer : await loadAudioBuffer(audioContext, sourceBlob, {
          audioTrackIndex: clip.audioTrackIndex,
          onProgress: (next) => {
            if (request !== generation.current) return;
            setProgress((index + next.progress * 0.18) / total);
            setProgressMessage(total === 1 ? next.message : `Clip ${index + 1} of ${total} · ${next.message}`);
          },
        });
        if (!audioBuffer)
          throw new Error("The selected clip audio could not be decoded.");
        decodeCache.previous = { blob: sourceBlob, audioTrackIndex: clip.audioTrackIndex, buffer: audioBuffer };

        if (request !== generation.current) return;
        if (!sourceIsCurrent(owner)) throw new Error("The source clip changed. Generate captions again.");
        const sourceStart = Math.max(0, clip.inPoint ?? 0);
        const sourceEnd = Math.min(
          audioBuffer.duration,
          clip.outPoint > sourceStart
            ? clip.outPoint
            : sourceStart + clip.duration * Math.max(clip.speed ?? 1, 0.01),
        );
        const samples = audioBufferToWhisperSamples(
          audioBuffer,
          sourceStart,
          sourceEnd,
        );
        setProgress((index + .2) / total);
        setProgressMessage(
          workerState === "ready"
            ? `Transcribing with ${WHISPER_MODELS[selectedModel].shortLabel}…`
            : `Downloading ${WHISPER_MODELS[selectedModel].shortLabel}, then transcribing…`,
        );
        const result = await runWorker("transcribe", samples);
        if (request !== generation.current) return;
        if (!sourceIsCurrent(owner)) throw new Error("The source clip changed. Generate captions again.");
        const sourceDuration = Math.max(0.1, sourceEnd - sourceStart);
        const playbackSpeed = Math.max(clip.speed ?? 1, 0.01);
        const clipEndTime = clip.startTime + clip.duration;
        const nextSegments: CaptionTranscriptSegment[] = (result.chunks ?? [])
          .map((chunk) => {
            const start = Math.max(0, chunk.timestamp?.[0] ?? 0);
            const end = Math.min(
              sourceDuration,
              chunk.timestamp?.[1] ?? Math.min(sourceDuration, start + 3),
            );
            return {
              text: chunk.text.trim(),
              startTime: Math.min(
                clipEndTime,
                clip.startTime + start / playbackSpeed,
              ),
              endTime: Math.min(
                clipEndTime,
                clip.startTime + Math.max(start + 0.1, end) / playbackSpeed,
              ),
              confidence: 1,
              sourceClipId: clip.id,
            };
          })
          .filter(
            (segment) =>
              segment.text.length > 0 && segment.endTime > segment.startTime,
          );
        if (nextSegments.length === 0 && result.text?.trim()) {
          nextSegments.push({
            text: result.text.trim(),
            startTime: clip.startTime,
            endTime: clipEndTime,
            confidence: 1,
            sourceClipId: clip.id,
          });
        }
        allSegments.push(...nextSegments);
      }
      if (allSegments.length === 0) {
        throw new Error(owner.sources.length === 1 ? "No speech was detected in the selected clip." : "No speech was detected in the source clips.");
      }
      ownerRef.current = owner;
      setSegments(allSegments);
      setProgressMessage("Captions are ready to add");
    } catch (reason) {
      if (request !== generation.current) return;
      ownerRef.current = null;
      releaseWorker(); setWorkerState("idle"); setModelBackends({});
      setError(reason instanceof Error ? reason.message : "Local transcription failed.");
    } finally {
      await audioContext?.close().catch(() => undefined);
      if (audioContextRef.current === audioContext) audioContextRef.current = null;
      if (request === generation.current) { busyRef.current = false; setIsTranscribing(false); }
    }
  }, [canTranscribe, sources, sourceTrackId, sourceLabel, projectId, releaseWorker, runWorker, selectedModel, sourceIsCurrent, workerState]);

  const handleAddToTimeline = useCallback(async () => {
    const owner = ownerRef.current;
    if (!owner || segments.length === 0 || busyRef.current) return;
    const ui = useUIStore.getState(), timeline = useTimelineStore.getState();
    if (ui.exportState.isExporting || timeline.playbackLockedReason) return;
    if (!sourceIsCurrent(owner)) { setError("The source clip changed. Generate captions again before adding them."); return; }
    if (owner.sources.some(({ clip }) => useProjectStore.getState().project.timeline.tracks.find(track => track.clips.some(item => item.id === clip.id))?.locked)) {
      setError("Unlock the source track before adding captions."); return;
    }
    busyRef.current = true; setIsAdding(true); setError(null); timeline.pause();
    const style = SUBTITLE_STYLE_PRESETS[selectedStyle === "pop-words" ? "modern" : selectedStyle] ?? SUBTITLE_STYLE_PRESETS.default;
    const store = useProjectStore.getState();
    store.beginHistoryGroup("Add generated captions");
    timeline.lockPlayback("Adding captions");
    const cues = segments.flatMap(segment => splitCaptionIntoSingleLineCues(segment.text, segment.startTime, segment.endTime, maxWordsPerLine)
      .map(cue => ({ ...cue, sourceClipId: segment.sourceClipId ?? owner.sources[0].clip.id })))
      .map(cue => ({ ...cue, text: removeFillers ? removeCaptionFillers(cue.text) : cue.text })).filter(cue => cue.text);
    let addedCount = 0;
    try {
      for (const cue of cues) {
        if (!sourceIsCurrent(owner)) throw new Error("The source clip changed while captions were being added.");
        const created = await useProjectStore.getState().addSubtitle({
          id: `whisper-${crypto.randomUUID()}`, text: cue.text, startTime: cue.startTime, endTime: cue.endTime, style,
          ...(highlightWords ? { animationStyle: "word-by-word" as const } : {}),
        }, { captionSource: "whisper", captionSourceClipId: cue.sourceClipId,
          captionMaxWordsPerLine: maxWordsPerLine, captionWhisperModel: owner.model });
        if (!created) throw new Error("A caption could not be added. Your remaining transcript is still available.");
        if (referenceTextStyle) useProjectStore.getState().updateTextStyle(created.id, referenceTextStyle);
        addedCount += 1;
      }
      setSegments([]); ownerRef.current = null;
      setProgressMessage(`${addedCount} single-line caption clips added`);
    } catch (reason) {
      // Retry only the uncommitted cues; do not duplicate already added text.
      setSegments(cues.slice(addedCount).map(cue => ({ ...cue, confidence: 1 })));
      setError(reason instanceof Error ? reason.message : "Could not add captions.");
    } finally {
      store.endHistoryGroup(); timeline.unlockPlayback();
      busyRef.current = false; setIsAdding(false);
    }
  }, [segments, selectedStyle, maxWordsPerLine, removeFillers, highlightWords, referenceTextStyle, sourceIsCurrent]);

  const modelStatus = useMemo(() => {
    const model = WHISPER_MODELS[selectedModel];
    if (workerState === "ready") {
      const backend = modelBackends[selectedModel];
      return `Downloaded and cached${backend ? ` · ${backend === "webgpu" ? "GPU" : "CPU"}` : ""}`;
    }
    if (workerState === "loading")
      return progressMessage || "Downloading model…";
    return `${model.downloadSize} · ${model.description}`;
  }, [modelBackends, progressMessage, selectedModel, workerState]);

  return { workerState, isTranscribing, isAdding, progress, progressMessage, selectedLanguage,
    setSelectedLanguage: (value: string) => { if (!busyRef.current) { setSelectedLanguage(value); onLanguageChange?.(value); } },
    selectedStyle, setSelectedStyle: (value: string) => { if (!busyRef.current) { setSelectedStyle(value); onStyleChange?.(value); } },
    selectedModel, handleModelChange, handlePrepareModel, handleTranscribe, handleAddToTimeline,
    modelStatus, segments, error, canTranscribe, referenceTextStyle, referenceStyles, highlightWords, setHighlightWords, removeFillers, setRemoveFillers, cancel,
    sourceCount: sources.length,
    sourceName: ownerRef.current
      ? ownerRef.current.sourceLabel ?? (ownerRef.current.sources.length === 1 ? ownerRef.current.sources[0].media.name : `${ownerRef.current.sources.length} audio clips`)
      : sourceLabel ?? (sources.length === 1 ? sources[0].media.name : sources.length ? `${sources.length} audio clips` : undefined),
    mutationBlocked: exporting || operationLocked };

}
export type AutoCaptionControls = ReturnType<typeof useAutoCaptions>;

/** Caption text cleanup only; source audio and cue boundaries stay intact. */
export function removeCaptionFillers(text: string): string {
  return text.replace(/(^|[\s,;:—–])(?:um+|uh+)(?=$|[\s,.!?;:—–])/gi, "$1")
    .replace(/\s+([,.!?;:])/g, "$1").replace(/([,;:])(?:\s*[,;:])+/g, "$1").replace(/^[\s,;:—–]+|[\s,;:—–]+$/g, "")
    .replace(/\s+/g, " ").replace(/^[.!?]+$/, "").trim();
}
