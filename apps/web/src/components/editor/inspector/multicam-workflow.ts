import type {
  Action,
  CameraAngle,
  Clip,
  MediaItem,
  MultiCamGroup,
  MulticamSequenceClip,
  Project,
  SyncResult,
  Track,
  MulticamDriftModel,
  MulticamManifest,
  MulticamManifestConstraints,
  MulticamVadTrack,
  MulticamCalibrationRange,
} from "@openreel/core";

export interface MulticamSyncAnalysis {
  results: Map<string, SyncResult>;
  drift: Record<string, MulticamDriftModel>;
}

export interface ResolvedMulticamSource {
  angle: CameraAngle;
  clip: Clip;
  media: MediaItem;
  track: Track;
}

export function resolveMulticamSources(
  project: Project,
  group: MultiCamGroup,
): ResolvedMulticamSource[] {
  return group.angles.map((angle) => {
    const track = project.timeline.tracks.find((candidate) =>
      candidate.clips.some((clip) => clip.id === angle.clipId),
    );
    const clip = track?.clips.find((candidate) => candidate.id === angle.clipId);
    if (!track || !clip) {
      throw new Error(`${angle.name} is no longer available on the timeline.`);
    }
    const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
    if (!media) {
      throw new Error(`${angle.name} is missing its source media.`);
    }
    return { angle, clip, media, track };
  });
}

export function prepareMulticamAnalysisAudio(
  buffer: AudioBuffer,
  targetSampleRate = 2_000,
): { samples: Float32Array; sampleRate: number } {
  const sampleRate = Math.min(buffer.sampleRate, targetSampleRate);
  const samples = new Float32Array(Math.floor(buffer.length * sampleRate / buffer.sampleRate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  // Average each source window before downsampling, with one exact rate across cameras.
  for (let index = 0; index < samples.length; index++) {
    const start = Math.floor(index * buffer.sampleRate / sampleRate);
    const end = Math.min(buffer.length, Math.floor((index + 1) * buffer.sampleRate / sampleRate));
    let sum = 0;
    for (const channel of channels) {
      for (let source = start; source < end; source++) sum += channel[source];
    }
    samples[index] = sum / Math.max(1, (end - start) * channels.length);
  }
  return { samples, sampleRate };
}

export function buildMulticamManifest(
  project: Project,
  group: MultiCamGroup,
  sources: readonly ResolvedMulticamSource[],
  constraints: MulticamManifestConstraints,
): MulticamManifest {
  const participantAngles = group.angles.filter(
    (angle) => !/\bwide\b/i.test(angle.name),
  );
  const participants = participantAngles.map((angle, index) => ({
    id: `participant-${angle.id}`,
    name: angle.name,
    audio: angle.id,
    seat: index,
  }));
  const participantByAngle = new Map(
    participantAngles.map((angle, index) => [angle.id, participants[index]!.id]),
  );
  const cameras = group.angles.map((angle) => {
    const source = sources.find((entry) => entry.angle.id === angle.id);
    const isWide = /\bwide\b/i.test(angle.name);
    return {
      id: angle.id,
      type: isWide ? "wide" as const : "closeup" as const,
      subject: isWide ? "all" : (participantByAngle.get(angle.id) ?? "all"),
      file: source?.media.sourceFile?.name ?? source?.media.name ?? angle.name,
      clipId: angle.clipId,
      angleId: angle.id,
    };
  });
  const reference = cameras.find((camera) => camera.type === "wide")?.id ?? cameras[0]?.id ?? "";
  return {
    spec: "openreel-multicam/v1",
    fps: project.settings.frameRate,
    sync: { method: "audio-crosscorr", reference },
    participants,
    cameras,
    constraints,
  };
}

export function findMulticamCalibrationRanges(
  tracks: ReadonlyMap<string, MulticamVadTrack>,
  options: { speakingThreshold?: number; quietThreshold?: number; minimumMs?: number } = {},
): {
  ranges: MulticamCalibrationRange[];
  silenceRange?: { startTime: number; endTime: number };
} {
  const speakingThreshold = options.speakingThreshold ?? 0.7;
  const quietThreshold = options.quietThreshold ?? 0.3;
  const minimumMs = options.minimumMs ?? 500;
  const entries = [...tracks.entries()];
  const windowMs = Math.min(...entries.map(([, track]) => track.windowMs));
  if (!entries.length || !Number.isFinite(windowMs)) return { ranges: [] };
  const count = Math.min(
    ...entries.map(([, track]) => Math.floor(track.probabilities.length * track.windowMs / windowMs)),
  );
  const ranges: MulticamCalibrationRange[] = [];
  let silenceStart: number | undefined;
  let silenceRange: { startTime: number; endTime: number } | undefined;
  const activeRuns = new Map<string, number>();
  for (let index = 0; index <= count; index++) {
    const probabilities = new Map(entries.map(([id, track]) => [
      id,
      track.probabilities[Math.floor((index * windowMs) / track.windowMs)] ?? 0,
    ]));
    const alone = entries.find(([id]) =>
      (probabilities.get(id) ?? 0) >= speakingThreshold &&
      entries.every(([other]) => other === id || (probabilities.get(other) ?? 0) <= quietThreshold),
    )?.[0];
    for (const [id] of entries) {
      const start = activeRuns.get(id);
      if (alone === id && start === undefined) activeRuns.set(id, index);
      if (alone !== id && start !== undefined) {
        if ((index - start) * windowMs >= minimumMs) {
          ranges.push({ speakerAngleId: id, startTime: start * windowMs / 1_000, endTime: index * windowMs / 1_000 });
        }
        activeRuns.delete(id);
      }
    }
    const silent = entries.every(([, track]) =>
      (track.probabilities[Math.floor((index * windowMs) / track.windowMs)] ?? 0) <= quietThreshold,
    );
    if (silent && silenceStart === undefined) silenceStart = index;
    if ((!silent || index === count) && silenceStart !== undefined) {
      if (!silenceRange && (index - silenceStart) * windowMs >= minimumMs) {
        silenceRange = { startTime: silenceStart * windowMs / 1_000, endTime: index * windowMs / 1_000 };
      }
      silenceStart = undefined;
    }
  }
  return { ranges, silenceRange };
}

export async function analyzeMulticamSyncInWorker(
  buffers: ReadonlyMap<string, AudioBuffer>,
  referenceAngleId: string,
): Promise<MulticamSyncAnalysis> {
  const referenceBuffer = buffers.get(referenceAngleId);
  if (!referenceBuffer) throw new Error("The multicam reference audio is missing.");
  const reference = prepareMulticamAnalysisAudio(referenceBuffer, 1_000);
  const results = new Map<string, SyncResult>();
  const drift: Record<string, MulticamDriftModel> = {};
  results.set(referenceAngleId, { offset: 0, confidence: 1, method: "audio" });
  for (const [angleId, buffer] of buffers) {
    if (angleId === referenceAngleId) continue;
    const target = prepareMulticamAnalysisAudio(buffer, 1_000);
    const duration = Math.min(reference.samples.length, target.samples.length) / reference.sampleRate;
    const maxOffsetSeconds = Math.max(0.05, Math.min(30, (duration - 1) / 2));
    const worker = new Worker(
      new URL("../../../workers/multicam-analysis-worker.ts", import.meta.url),
      { type: "module" },
    );
    const requestId = crypto.randomUUID();
    const model = await new Promise<MulticamDriftModel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Audio synchronization timed out. Try shorter source clips or set offsets manually."));
      }, 60_000);
      worker.onmessage = (event: MessageEvent<{ requestId: string; type: string; model?: MulticamDriftModel; message?: string }>) => {
        if (event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        worker.terminate();
        if (event.data.type === "result" && event.data.model) resolve(event.data.model);
        else reject(new Error(event.data.message ?? "Audio synchronization failed."));
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || "Audio synchronization worker failed."));
      };
      worker.postMessage({
        requestId,
        type: "drift",
        reference: reference.samples,
        target: target.samples,
        sampleRate: reference.sampleRate,
        options: { blockSeconds: Math.min(5, Math.max(1, duration / 3)), intervalSeconds: 300, maxOffsetSeconds, analysisSampleRate: 400 },
      });
    });
    drift[angleId] = model;
    results.set(angleId, {
      offset: model.interceptSeconds,
      confidence: model.confidence,
      method: model.confidence > 0 ? "audio" : "manual",
    });
  }
  return { results, drift };
}

export function getMulticamAnalysisDuration(
  sources: readonly ResolvedMulticamSource[],
  buffers: ReadonlyMap<string, AudioBuffer>,
): number {
  if (sources.length === 0) return 0;
  return sources.reduce((duration, source) => {
    const buffer = buffers.get(source.angle.id);
    if (!buffer) return 0;
    const playbackRate = Math.max(0.01, source.clip.speed ?? 1);
    const availableMediaDuration = Math.max(
      0,
      Math.min(buffer.duration, source.clip.outPoint) - source.clip.inPoint - Math.max(0, source.angle.offset),
    ) / playbackRate;
    const alignedDuration = Math.min(source.clip.duration, availableMediaDuration);
    return Math.min(duration, alignedDuration);
  }, Number.POSITIVE_INFINITY);
}

export function updateAlignedSourceOffsets(
  group: MultiCamGroup,
  sources: readonly ResolvedMulticamSource[],
  results: ReadonlyMap<string, SyncResult>,
): void {
  const reference = sources[0];
  if (!reference) return;
  for (const source of sources) {
    const result = results.get(source.angle.id);
    if (!result || !Number.isFinite(result.offset) || result.confidence < 0.2 || result.method !== "audio") {
      throw new Error(`Could not reliably sync ${source.angle.name}. Set camera offsets manually or use recordings with shared reference audio.`);
    }
  }
  for (const source of sources) {
    const result = results.get(source.angle.id);
    const angle = group.angles.find((candidate) => candidate.id === source.angle.id);
    if (!result || !angle) continue;
    angle.offset = result.offset + reference.clip.inPoint - source.clip.inPoint;
  }
  // Start where every trimmed source has footage, rather than leaving a gap
  // when a camera needs samples before its selected in point.
  const commonStart = Math.max(0, ...group.angles.map((angle) => -angle.offset));
  if (commonStart > 0) {
    group.syncPoint += commonStart;
    for (const angle of group.angles) angle.offset += commonStart;
  }
}

interface TimelineActionOptions {
  project: Project;
  group: MultiCamGroup;
  groups: MultiCamGroup[];
  outputTrackId: string;
  sequence: readonly MulticamSequenceClip[];
  createId?: () => string;
  now?: () => number;
}

/**
 * Returns the complete action batch for an automatic edit. Callers wrap the
 * batch in a history group so source-track muting, output replacement, and
 * multicam metadata all undo together.
 */
export function createMulticamTimelineActions({
  project,
  group,
  groups,
  outputTrackId,
  sequence,
  createId = () => crypto.randomUUID(),
  now = () => Date.now(),
}: TimelineActionOptions): Action[] {
  const actions: Action[] = [];
  const action = (type: string, params: Record<string, unknown>): Action => ({
    type,
    id: createId(),
    timestamp: now(),
    params,
  });
  const existingOutputIndex = project.timeline.tracks.findIndex(
    (track) => track.id === outputTrackId,
  );
  if (existingOutputIndex >= 0) {
    actions.push(action("track/remove", { trackId: outputTrackId }));
  }

  const sourceTrackIds = new Set(
    group.angles
      .map((angle) => angle.trackId)
      .filter((trackId) => trackId.length > 0 && trackId !== outputTrackId),
  );
  for (const trackId of sourceTrackIds) {
    const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
    if (!track) continue;
    if (!track.hidden) {
      actions.push(action("track/hide", { trackId, hidden: true }));
    }
    if (!track.muted) {
      actions.push(action("track/mute", { trackId, muted: true }));
    }
  }

  actions.push(
    action("track/add", {
      trackType: "video",
      trackId: outputTrackId,
      position: existingOutputIndex >= 0 ? existingOutputIndex : 0,
    }),
    action("track/rename", {
      trackId: outputTrackId,
      name: `${group.name} Auto Edit`,
    }),
  );
  for (const segment of sequence) {
    actions.push(
      action("clip/add", {
        trackId: outputTrackId,
        mediaId: segment.clip.mediaId,
        startTime: segment.clip.startTime,
        sourceClip: segment.clip,
      }),
    );
  }
  actions.push(action("multicam/setAll", { groups }));
  return actions;
}

export function createMulticamOutputTrack(
  group: MultiCamGroup,
  outputTrackId: string,
  sequence: readonly MulticamSequenceClip[],
): Track {
  return {
    id: outputTrackId,
    type: "video",
    name: `${group.name} Auto Edit`,
    clips: sequence.map((segment) => structuredClone(segment.clip)),
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

export function createMulticamApplyEditAction({
  project,
  group,
  groups,
  outputTrackId,
  sequence,
  createId = () => crypto.randomUUID(),
  now = () => Date.now(),
}: TimelineActionOptions): Action {
  const existingOutputIndex = project.timeline.tracks.findIndex(
    (track) => track.id === outputTrackId,
  );
  return {
    type: "multicam/applyEdit",
    id: createId(),
    timestamp: now(),
    params: {
      outputTracks: [createMulticamOutputTrack(group, outputTrackId, sequence)],
      replacedOutputTrackIds: previousOutputTrackIds(project, group.id),
      outputTrackPosition: existingOutputIndex >= 0 ? existingOutputIndex : 0,
      sourceTrackIds: [...new Set(
        group.angles
          .map((angle) => angle.trackId)
          .filter((trackId) => trackId.length > 0 && trackId !== outputTrackId),
      )],
      groups,
    },
  };
}

export function createMulticamApplyTracksAction(input: {
  project: Project;
  group: MultiCamGroup;
  groups: MultiCamGroup[];
  outputTracks: Track[];
  createId?: () => string;
  now?: () => number;
}): Action {
  const outputIds = new Set(input.outputTracks.map((track) => track.id));
  const existingOutputIndex = input.project.timeline.tracks.findIndex((track) =>
    outputIds.has(track.id),
  );
  return {
    type: "multicam/applyEdit",
    id: (input.createId ?? (() => crypto.randomUUID()))(),
    timestamp: (input.now ?? (() => Date.now()))(),
    params: {
      outputTracks: input.outputTracks.map((track) => structuredClone(track)),
      replacedOutputTrackIds: previousOutputTrackIds(input.project, input.group.id),
      outputTrackPosition: existingOutputIndex >= 0 ? existingOutputIndex : 0,
      sourceTrackIds: [...new Set(
        input.group.angles
          .map((angle) => angle.trackId)
          .filter((trackId) => trackId.length > 0 && !outputIds.has(trackId)),
      )],
      groups: input.groups,
    },
  };
}

function previousOutputTrackIds(project: Project, groupId: string): string[] {
  const group = project.multicamGroups?.find((entry) => entry.id === groupId);
  return group?.outputTrackIds ?? (group?.outputTrackId ? [group.outputTrackId] : []);
}
