import {
  createMulticamSource,
  findAudioOffset,
  findAudioOffsetStreaming,
  wavBlobSource,
  type AudioChunkSource,
  flattenMulticam,
  getMulticamSources,
  insertMulticamClip,
  listMulticamClips,
  multicamClipAtTime,
  recordMulticamCuts,
  setMulticamAudioMode,
  switchMulticamAngle,
  type CreateMulticamSourceOptions,
  type MulticamAudioMode,
  type MulticamCut,
  type MulticamEditResult,
  type MulticamSource,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useMulticamStore } from "../stores/multicam-monitor-store";
import { toast } from "../stores/notification-store";
import { loadAudioBuffer } from "../utils/load-audio-buffer";
import { commitSequenceEdit } from "./sequence-commands";

/**
 * Multicam commands. Each is a pure function from @openreel/core
 * (multicam/source.ts) committed as exactly ONE undo step through
 * `commitSequenceEdit` (`project/applyEditSnapshot`), the path sequences and
 * the agent tools use.
 */

const fullProject = (): Project => useProjectStore.getState().getFullProject();

async function run(title: string, label: string, build: (project: Project) => MulticamEditResult): Promise<MulticamEditResult> {
  const result = (await commitSequenceEdit(label, build)) as MulticamEditResult;
  if (!result.ok) toast.warning(title, result.message);
  return result;
}

/** The source the monitor currently works on. */
export function currentMulticamSource(project: Project = useProjectStore.getState().project): MulticamSource | null {
  const playhead = useTimelineStore.getState().playheadPosition;
  const under = multicamClipAtTime(project, playhead);
  if (under) return under.source;
  const sources = getMulticamSources(project);
  const chosen = useMulticamStore.getState().sourceId;
  return sources.find((s) => s.id === chosen) ?? sources[0] ?? null;
}

/** Angle shown at the playhead, including angles picked in a recording pass that is not committed yet. */
export function activeAngleId(project: Project, playhead: number, pending: readonly MulticamCut[]): string | null {
  const live = [...pending].reverse().find((cut) => cut.time <= playhead + 1e-6);
  if (live) return live.angleId;
  return multicamClipAtTime(project, playhead)?.angle.id ?? null;
}

export interface AudioSyncProgress {
  (message: string): void;
}

/**
 * Decode each media's audio and correlate it against the first. Returns the
 * offset of every angle relative to the first (shared-time seconds of its time 0)
 * and a 0..1 confidence.
 */
export async function analyzeAudioOffsets(
  mediaIds: readonly string[],
  onProgress?: AudioSyncProgress,
): Promise<{ offsets: number[]; confidence: number[] }> {
  const streamed = await analyzeAudioOffsetsStreaming(mediaIds, onProgress);
  return streamed ?? analyzeAudioOffsetsInMemory(mediaIds, onProgress);
}

/**
 * Memory-bounded path: each angle's audio is extracted to a WAV blob and then
 * read in one-second chunks, reduced to an envelope and a short fine window
 * (core multicam/audio-sync-stream.ts), so a long recording is never decoded
 * whole. Returns null when a source cannot be extracted as WAV so the caller
 * falls back to the in-memory decode.
 */
async function analyzeAudioOffsetsStreaming(
  mediaIds: readonly string[],
  onProgress?: AudioSyncProgress,
): Promise<{ offsets: number[]; confidence: number[] } | null> {
  const items = useProjectStore.getState().project.mediaLibrary.items;
  const sources: AudioChunkSource[] = [];
  try {
    const { extractAudioWav } = await import("@openreel/core/media");
    for (const [index, id] of mediaIds.entries()) {
      const media = items.find((m) => m.id === id);
      if (!media?.blob) throw new Error(`${media?.name ?? id} needs its source media relinked.`);
      onProgress?.(`Reading audio of ${media.name} (${index + 1}/${mediaIds.length})`);
      sources.push(await wavBlobSource(await extractAudioWav(media.blob, 0)));
    }
  } catch {
    return null;
  }
  const offsets: number[] = [0];
  const confidence: number[] = [1];
  for (let index = 1; index < sources.length; index++) {
    const name = items.find((m) => m.id === mediaIds[index])?.name ?? `angle ${index + 1}`;
    onProgress?.(`Matching ${name} to ${items.find((m) => m.id === mediaIds[0])?.name ?? "the first angle"}`);
    const result = await findAudioOffsetStreaming(sources[0], sources[index]);
    offsets.push(result.offsetSeconds);
    confidence.push(result.confidence);
  }
  return { offsets, confidence };
}

async function analyzeAudioOffsetsInMemory(
  mediaIds: readonly string[],
  onProgress?: AudioSyncProgress,
): Promise<{ offsets: number[]; confidence: number[] }> {
  const items = useProjectStore.getState().project.mediaLibrary.items;
  const context = new AudioContext();
  try {
    let reference: { samples: Float32Array; rate: number } | null = null;
    const offsets: number[] = [];
    const confidence: number[] = [];
    for (const [index, id] of mediaIds.entries()) {
      const media = items.find((m) => m.id === id);
      if (!media?.blob) throw new Error(`${media?.name ?? id} needs its source media relinked.`);
      onProgress?.(`Reading audio of ${media.name} (${index + 1}/${mediaIds.length})`);
      const buffer = await loadAudioBuffer(context, media.blob);
      if (!buffer) throw new Error(`Could not decode audio for ${media.name}.`);
      const samples = buffer.getChannelData(0);
      if (!reference) {
        reference = { samples, rate: buffer.sampleRate };
        offsets.push(0);
        confidence.push(1);
        continue;
      }
      onProgress?.(`Matching ${media.name} to ${items.find((m) => m.id === mediaIds[0])?.name ?? "the first angle"}`);
      // Yield so the progress text paints before the correlation blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = findAudioOffset(reference.samples, reference.rate, samples, buffer.sampleRate);
      offsets.push(result.offsetSeconds);
      confidence.push(result.confidence);
    }
    return { offsets, confidence };
  } finally {
    void context.close();
  }
}

export interface CreateSourceCommandOptions extends CreateMulticamSourceOptions {
  /** Also place the source on the timeline at the playhead (one undo step with the creation). */
  readonly placeAtPlayhead?: boolean;
}

export async function createMulticamSourceCommand(options: CreateSourceCommandOptions): Promise<MulticamEditResult> {
  const { placeAtPlayhead, ...creation } = options;
  const startTime = useTimelineStore.getState().playheadPosition;
  const result = await run("Multi-camera source", "Create multi-camera source", (project) => {
    const created = createMulticamSource(project, creation);
    if (!created.ok || !created.sourceId || !placeAtPlayhead) return created;
    const placed = insertMulticamClip(created.project, { sourceId: created.sourceId, startTime });
    return placed.ok ? { ...placed, sourceId: created.sourceId } : placed;
  });
  if (result.ok && result.sourceId) useMulticamStore.getState().setSourceId(result.sourceId);
  return result;
}

export function placeMulticamSource(sourceId: string, angleId?: string): Promise<MulticamEditResult> {
  const startTime = useTimelineStore.getState().playheadPosition;
  return run("Multi-camera source", "Place multi-camera source", (project) => insertMulticamClip(project, { sourceId, startTime, angleId }));
}

/** Switch the multicam clip under the playhead to another angle (one undo step). */
export async function switchAngleAtPlayhead(angleId: string): Promise<MulticamEditResult> {
  const project = fullProject();
  const under = multicamClipAtTime(project, useTimelineStore.getState().playheadPosition);
  if (!under) {
    const message = "Park the playhead on a multicam clip to switch its angle.";
    toast.warning("Multi-camera", message);
    return { ok: false, message };
  }
  if (under.angle.id === angleId) return { ok: true, project };
  return run("Switch angle", "Switch multicam angle", (p) => switchMulticamAngle(p, [under.clip.id], angleId));
}

export async function switchAngleOfClips(clipIds: readonly string[], angleId: string): Promise<MulticamEditResult> {
  return run("Switch angle", "Switch multicam angle", (p) => switchMulticamAngle(p, clipIds, angleId));
}

export function flattenMulticamCommand(options: { sourceId?: string; clipIds?: readonly string[] } = {}): Promise<MulticamEditResult> {
  return run("Flatten multi-camera", "Flatten multicam to active angle", (p) => flattenMulticam(p, options));
}

export function setAudioModeCommand(sourceId: string, mode: MulticamAudioMode): Promise<MulticamEditResult> {
  return run("Multi-camera audio", "Set multicam audio", (p) => setMulticamAudioMode(p, sourceId, mode));
}

// ---------------------------------------------------------------------------
// Live recording
// ---------------------------------------------------------------------------

export function startRecording(): boolean {
  const monitor = useMulticamStore.getState();
  if (monitor.recording || monitor.committing) return false;
  const timeline = useTimelineStore.getState();
  if (timeline.playbackLockedReason) {
    toast.warning("Multi-camera", timeline.playbackLockedReason);
    return false;
  }
  const project = fullProject();
  const clips = listMulticamClips(project, currentMulticamSource(project)?.id);
  if (clips.length === 0) {
    toast.warning("Multi-camera", "Place a multicam clip on the timeline before recording.");
    return false;
  }
  const first = clips[0].clip;
  const last = clips.reduce((end, ref) => Math.max(end, ref.clip.startTime + ref.clip.duration), 0);
  let start = timeline.playheadPosition;
  if (start < first.startTime || start >= last - 1 / Math.max(1, project.settings.frameRate)) {
    start = first.startTime;
    timeline.seekTo(start);
  }
  monitor.begin(start);
  timeline.play();
  return true;
}

/** Stop the pass and commit every recorded cut as ONE undo step. */
export async function stopRecording(): Promise<MulticamEditResult | null> {
  const monitor = useMulticamStore.getState();
  if (!monitor.recording) return null;
  // Finish first: pausing re-enters this function through the playback subscription.
  const endTime = useTimelineStore.getState().playheadPosition;
  const cuts = monitor.finish();
  const timeline = useTimelineStore.getState();
  if (timeline.playbackState === "playing") timeline.pause();
  if (cuts.length === 0) return null;
  const sourceId = currentMulticamSource()?.id;
  monitor.setCommitting(true);
  try {
    return await run("Record cuts", `Record ${cuts.length} multicam cut${cuts.length === 1 ? "" : "s"}`, (p) =>
      recordMulticamCuts(p, { cuts, endTime, sourceId }),
    );
  } finally {
    useMulticamStore.getState().setCommitting(false);
  }
}

/** Number-key / tile action: a live cut while recording, else a switch of the clip under the playhead. */
export function cutToAngle(angleId: string): void {
  const monitor = useMulticamStore.getState();
  if (monitor.recording) {
    monitor.addCut({ time: useTimelineStore.getState().playheadPosition, angleId });
    return;
  }
  void switchAngleAtPlayhead(angleId);
}

/** Number key `n` (1-based) picks the n-th angle of the current source. */
export function cutToAngleNumber(n: number): boolean {
  const source = currentMulticamSource();
  const angle = source?.angles[n - 1];
  if (!angle) return false;
  cutToAngle(angle.id);
  return true;
}

let installed = false;
/** Finish a pass when playback stops for any reason (Space, end of timeline, a lock). */
export function installMulticamAutoStop(): void {
  if (installed) return;
  installed = true;
  useTimelineStore.subscribe((state, previous) => {
    if (previous.playbackState === "playing" && state.playbackState !== "playing" && useMulticamStore.getState().recording) {
      void stopRecording();
    }
  });
}
installMulticamAutoStop();
