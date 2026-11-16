import {
  correctMulticamBleedEnergies,
  type MulticamBleedCalibration,
} from "./bleed-calibration";

export type MulticamOverlapStrategy = "hold" | "winner";

export interface MulticamVadTrack {
  windowMs: number;
  probabilities: Float32Array;
}

interface MulticamAudioSource {
  angleId: string;
  samples: Float32Array;
  sampleRate: number;
  /** Seconds to advance into this source to align it with the group timeline. */
  offsetSeconds?: number;
  vad?: MulticamVadTrack;
}

export interface MulticamActivityPoint {
  startTime: number;
  endTime: number;
  activeAngleIds: string[];
  /** Relative energy scores. The strongest source in a window has a score of 1. */
  scores: Record<string, number>;
  speechProbabilities?: Record<string, number>;
}

export interface MulticamActivityMap {
  angleIds: string[];
  duration: number;
  windowMs: number;
  points: MulticamActivityPoint[];
}

interface MulticamActivityOptions {
  windowMs?: number;
  durationSeconds?: number;
  noiseFloorPercentile?: number;
  activityThresholdDb?: number;
  bleedRatio?: number;
  analysisSampleRate?: number;
  vadThreshold?: number;
  bleedCalibration?: MulticamBleedCalibration;
}

export interface MulticamEditPolicy {
  overlapStrategy: MulticamOverlapStrategy;
  minShotMs: number;
  maxShotMs: number;
  reactionShotMs: number;
  cutLeadMs: number;
  backchannelMaxMs: number;
  /** Begin reaction-shot consideration after this much uninterrupted screen time. */
  reactionShotAfterMs: number;
  /** Avoid consecutive angles that frame the same participant. */
  forbidJumpCutSameSubject: boolean;
  initialAngleId?: string;
}

export type MulticamEditReason =
  | "speaker"
  | "overlap-hold"
  | "overlap-winner"
  | "silence-hold"
  | "max-shot"
  | "backchannel-hold"
  | "turn-collision-winner"
  | "successful-interruption"
  | "sustained-overlap"
  | "group-reaction"
  | "reaction-shot"
  | "layout-budget"
  | "directive";

export interface MulticamEditDecision {
  angleId: string;
  startTime: number;
  endTime: number;
  reason: MulticamEditReason;
  confidence: number;
}

export interface MulticamEditDecisionList {
  duration: number;
  segments: MulticamEditDecision[];
}

const DEFAULT_MULTICAM_ACTIVITY_OPTIONS: Required<
  Omit<MulticamActivityOptions, "durationSeconds" | "bleedCalibration">
> = {
  windowMs: 50,
  noiseFloorPercentile: 0.2,
  activityThresholdDb: 8,
  bleedRatio: 0.55,
  analysisSampleRate: 2_000,
  vadThreshold: 0.5,
};

export const DEFAULT_MULTICAM_EDIT_POLICY: MulticamEditPolicy = {
  overlapStrategy: "hold",
  minShotMs: 1_800,
  maxShotMs: 30_000,
  reactionShotMs: 2_000,
  cutLeadMs: 120,
  backchannelMaxMs: 700,
  reactionShotAfterMs: 12_000,
  forbidJumpCutSameSubject: true,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finiteNonNegative = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;

const finiteNumber = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function percentile(values: readonly number[], position: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(clamp(position, 0, 1) * (sorted.length - 1));
  return sorted[index] ?? 0;
}

function windowRms(
  source: MulticamAudioSource,
  startTime: number,
  endTime: number,
  analysisSampleRate: number,
): number {
  const offset = finiteNumber(source.offsetSeconds, 0);
  const sourceStart = startTime + offset;
  const startSample = Math.max(0, Math.floor(sourceStart * source.sampleRate));
  const endSample = Math.min(
    source.samples.length,
    Math.ceil((endTime + offset) * source.sampleRate),
  );
  if (endSample <= startSample) return 0;

  const stride = Math.max(1, Math.floor(source.sampleRate / analysisSampleRate));
  let sumSquares = 0;
  let count = 0;
  for (let index = startSample; index < endSample; index += stride) {
    const sample = source.samples[index] ?? 0;
    sumSquares += sample * sample;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSquares / count) : 0;
}

/**
 * Builds a deterministic, compact speech-activity artifact from isolated camera
 * or microphone recordings. Activity is relative to every source in a window,
 * which rejects quieter copies of the same voice caused by microphone bleed.
 */
export function analyzeMulticamActivity(
  sources: readonly MulticamAudioSource[],
  options: MulticamActivityOptions = {},
): MulticamActivityMap {
  const validSources = sources.filter(
    (source) =>
      source.angleId.length > 0 &&
      source.sampleRate > 0 &&
      Number.isFinite(source.sampleRate),
  );
  const windowMs = Math.max(
    10,
    finiteNonNegative(options.windowMs, DEFAULT_MULTICAM_ACTIVITY_OPTIONS.windowMs),
  );
  const windowSeconds = windowMs / 1_000;
  const availableDuration = validSources.reduce((longest, source) => {
    const offset = finiteNumber(source.offsetSeconds, 0);
    return Math.max(longest, source.samples.length / source.sampleRate - offset);
  }, 0);
  const duration = Math.max(
    0,
    Math.min(
      availableDuration,
      finiteNonNegative(options.durationSeconds, availableDuration),
    ),
  );
  const windowCount = Math.ceil(duration / windowSeconds);
  const analysisSampleRate = Math.max(
    100,
    finiteNonNegative(
      options.analysisSampleRate,
      DEFAULT_MULTICAM_ACTIVITY_OPTIONS.analysisSampleRate,
    ),
  );
  const energies = new Map<string, number[]>();

  for (const source of validSources) {
    const sourceEnergies: number[] = [];
    for (let index = 0; index < windowCount; index++) {
      const startTime = index * windowSeconds;
      sourceEnergies.push(
        windowRms(
          source,
          startTime,
          Math.min(duration, startTime + windowSeconds),
          analysisSampleRate,
        ),
      );
    }
    energies.set(source.angleId, sourceEnergies);
  }

  const floorPosition = clamp(
    options.noiseFloorPercentile ??
      DEFAULT_MULTICAM_ACTIVITY_OPTIONS.noiseFloorPercentile,
    0,
    1,
  );
  const thresholdMultiplier = Math.pow(
    10,
    finiteNonNegative(
      options.activityThresholdDb,
      DEFAULT_MULTICAM_ACTIVITY_OPTIONS.activityThresholdDb,
    ) / 20,
  );
  const correctedEnergies = new Map<string, number[]>(
    validSources.map((source) => [source.angleId, []]),
  );
  for (let index = 0; index < windowCount; index++) {
    const raw: Record<string, number> = {};
    for (const source of validSources) {
      raw[source.angleId] = energies.get(source.angleId)?.[index] ?? 0;
    }
    const corrected = correctMulticamBleedEnergies(raw, options.bleedCalibration);
    for (const source of validSources) {
      correctedEnergies.get(source.angleId)?.push(corrected[source.angleId] ?? 0);
    }
  }

  const thresholds = new Map<string, number>();
  for (const source of validSources) {
    const sourceEnergies = correctedEnergies.get(source.angleId) ?? [];
    const floor = percentile(sourceEnergies, floorPosition);
    const peak = sourceEnergies.reduce(
      (strongest, energy) => Math.max(strongest, energy),
      0,
    );
    // Continuously active microphones have no silent calibration window. Cap
    // the adaptive threshold below their peak so relative-energy comparison can
    // still identify them, while the absolute floor rejects digital silence.
    thresholds.set(
      source.angleId,
      Math.max(0.001, Math.min(floor * thresholdMultiplier, peak * 0.5)),
    );
  }

  const bleedRatio = clamp(
    options.bleedRatio ?? DEFAULT_MULTICAM_ACTIVITY_OPTIONS.bleedRatio,
    0,
    1,
  );
  const vadThreshold = clamp(
    options.vadThreshold ?? DEFAULT_MULTICAM_ACTIVITY_OPTIONS.vadThreshold,
    0,
    1,
  );
  const points: MulticamActivityPoint[] = [];
  for (let index = 0; index < windowCount; index++) {
    let strongest = 0;
    for (const source of validSources) {
      strongest = Math.max(
        strongest,
        correctedEnergies.get(source.angleId)?.[index] ?? 0,
      );
    }

    const scores: Record<string, number> = {};
    const speechProbabilities: Record<string, number> = {};
    const activeAngleIds: string[] = [];
    for (const source of validSources) {
      const energy = correctedEnergies.get(source.angleId)?.[index] ?? 0;
      const sourceWindowMiddle =
        (index + 0.5) * windowMs + finiteNumber(source.offsetSeconds, 0) * 1_000;
      const vadIndex = source.vad
        ? Math.floor(sourceWindowMiddle / source.vad.windowMs)
        : -1;
      const speechProbability = source.vad
        ? (source.vad.probabilities[vadIndex] ?? 0)
        : 1;
      speechProbabilities[source.angleId] = speechProbability;
      scores[source.angleId] = strongest > 0 ? energy / strongest : 0;
      if (
        speechProbability >= vadThreshold &&
        energy >= (thresholds.get(source.angleId) ?? Number.POSITIVE_INFINITY) &&
        energy >= strongest * bleedRatio
      ) {
        activeAngleIds.push(source.angleId);
      }
    }

    points.push({
      startTime: index * windowSeconds,
      endTime: Math.min(duration, (index + 1) * windowSeconds),
      activeAngleIds,
      scores,
      speechProbabilities,
    });
  }

  return {
    angleIds: validSources.map((source) => source.angleId),
    duration,
    windowMs,
    points,
  };
}

interface CandidateRun {
  angleId: string;
  startTime: number;
  endTime: number;
  reason: Exclude<MulticamEditReason, "max-shot">;
  confidence: number;
  pointCount: number;
}

function strongestAngle(
  point: MulticamActivityPoint,
  angleIds: readonly string[],
): string | undefined {
  return angleIds.reduce<string | undefined>((winner, angleId) => {
    if (!winner) return angleId;
    return (point.scores[angleId] ?? 0) > (point.scores[winner] ?? 0)
      ? angleId
      : winner;
  }, undefined);
}

function candidateRuns(
  activity: MulticamActivityMap,
  policy: MulticamEditPolicy,
): CandidateRun[] {
  const firstActive = activity.points.find((point) => point.activeAngleIds.length > 0);
  let current =
    (policy.initialAngleId && activity.angleIds.includes(policy.initialAngleId)
      ? policy.initialAngleId
      : undefined) ??
    (firstActive ? strongestAngle(firstActive, firstActive.activeAngleIds) : undefined) ??
    activity.angleIds[0];
  if (!current) return [];

  const runs: CandidateRun[] = [];
  for (const point of activity.points) {
    let candidate = current;
    let reason: CandidateRun["reason"] = "silence-hold";
    if (point.activeAngleIds.length === 1) {
      candidate = point.activeAngleIds[0] ?? current;
      reason = "speaker";
    } else if (point.activeAngleIds.length > 1) {
      if (policy.overlapStrategy === "hold" && point.activeAngleIds.includes(current)) {
        candidate = current;
        reason = "overlap-hold";
      } else {
        candidate = strongestAngle(point, point.activeAngleIds) ?? current;
        reason = policy.overlapStrategy === "winner" ? "overlap-winner" : "overlap-hold";
      }
    }

    const confidence = clamp(point.scores[candidate] ?? 0, 0, 1);
    const previous = runs[runs.length - 1];
    if (previous && previous.angleId === candidate && previous.reason === reason) {
      previous.endTime = point.endTime;
      previous.confidence =
        (previous.confidence * previous.pointCount + confidence) /
        (previous.pointCount + 1);
      previous.pointCount++;
    } else {
      runs.push({
        angleId: candidate,
        startTime: point.startTime,
        endTime: point.endTime,
        reason,
        confidence,
        pointCount: 1,
      });
    }
    current = candidate;
  }
  return runs;
}

function mergeAdjacentRuns(runs: readonly CandidateRun[]): CandidateRun[] {
  const merged: CandidateRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && previous.angleId === run.angleId) {
      const previousDuration = previous.endTime - previous.startTime;
      const runDuration = run.endTime - run.startTime;
      const total = previousDuration + runDuration;
      previous.endTime = run.endTime;
      previous.confidence =
        total > 0
          ? (previous.confidence * previousDuration + run.confidence * runDuration) /
            total
          : previous.confidence;
      if (previous.reason === "silence-hold" && run.reason !== "silence-hold") {
        previous.reason = run.reason;
      }
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function suppressBackchannels(
  runs: readonly CandidateRun[],
  backchannelMaxSeconds: number,
): CandidateRun[] {
  let result = runs.map((run) => ({ ...run }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < result.length; index++) {
      const run = result[index];
      const previous = result[index - 1];
      const next = result[index + 1];
      if (!run || !previous) continue;
      const isBrief = run.endTime - run.startTime <= backchannelMaxSeconds;
      const returnsToPrevious = !next || next.angleId === previous.angleId;
      if (isBrief && run.angleId !== previous.angleId && returnsToPrevious) {
        run.angleId = previous.angleId;
        run.reason = previous.reason;
        changed = true;
      }
    }
    result = mergeAdjacentRuns(result);
  }
  return result;
}

function buildSpeakerSegments(
  runs: readonly CandidateRun[],
  duration: number,
  policy: MulticamEditPolicy,
): MulticamEditDecision[] {
  const first = runs[0];
  if (!first || duration <= 0) return [];
  const minShot = finiteNonNegative(policy.minShotMs, 0) / 1_000;
  const cutLead = finiteNonNegative(policy.cutLeadMs, 0) / 1_000;
  const segments: MulticamEditDecision[] = [
    {
      angleId: first.angleId,
      startTime: 0,
      endTime: duration,
      reason: first.reason,
      confidence: first.confidence,
    },
  ];

  for (const run of runs.slice(1)) {
    const current = segments[segments.length - 1];
    if (!current || current.angleId === run.angleId) continue;
    const cutTime = Math.max(current.startTime + minShot, run.startTime - cutLead);
    if (cutTime >= run.endTime || cutTime >= duration) continue;
    current.endTime = cutTime;
    segments.push({
      angleId: run.angleId,
      startTime: cutTime,
      endTime: duration,
      reason: run.reason,
      confidence: run.confidence,
    });
  }
  return segments;
}

function scoreAngleInRange(
  activity: MulticamActivityMap,
  angleId: string,
  startTime: number,
  endTime: number,
): number {
  let total = 0;
  let count = 0;
  for (const point of activity.points) {
    if (point.endTime <= startTime || point.startTime >= endTime) continue;
    total += point.scores[angleId] ?? 0;
    count++;
  }
  return count > 0 ? total / count : 0;
}

function addReactionShots(
  segments: readonly MulticamEditDecision[],
  activity: MulticamActivityMap,
  policy: MulticamEditPolicy,
): MulticamEditDecision[] {
  const maxShot = finiteNonNegative(policy.maxShotMs, 0) / 1_000;
  const reactionDuration = Math.max(
    finiteNonNegative(policy.minShotMs, 0),
    finiteNonNegative(policy.reactionShotMs, 0),
  ) / 1_000;
  if (maxShot <= 0 || reactionDuration <= 0 || activity.angleIds.length < 2) {
    return [...segments];
  }

  const output: MulticamEditDecision[] = [];
  for (const segment of segments) {
    let cursor = segment.startTime;
    while (segment.endTime - cursor >= maxShot + reactionDuration) {
      const reactionStart = cursor + maxShot;
      const reactionEnd = Math.min(segment.endTime, reactionStart + reactionDuration);
      const alternate = activity.angleIds
        .filter((angleId) => angleId !== segment.angleId)
        .map((angleId) => ({
          angleId,
          score: scoreAngleInRange(activity, angleId, reactionStart, reactionEnd),
        }))
        .sort((a, b) => b.score - a.score || a.angleId.localeCompare(b.angleId))[0];
      if (!alternate) break;
      output.push({ ...segment, startTime: cursor, endTime: reactionStart });
      output.push({
        angleId: alternate.angleId,
        startTime: reactionStart,
        endTime: reactionEnd,
        reason: "max-shot",
        confidence: clamp(alternate.score, 0, 1),
      });
      cursor = reactionEnd;
    }
    if (cursor < segment.endTime) {
      output.push({ ...segment, startTime: cursor });
    }
  }
  return output;
}

/** Pure decision layer: identical activity and policy inputs always produce the same EDL. */
export function decideMulticamEdit(
  activity: MulticamActivityMap,
  policy: MulticamEditPolicy = DEFAULT_MULTICAM_EDIT_POLICY,
): MulticamEditDecisionList {
  const runs = suppressBackchannels(
    candidateRuns(activity, policy),
    finiteNonNegative(policy.backchannelMaxMs, 0) / 1_000,
  );
  const speakerSegments = buildSpeakerSegments(runs, activity.duration, policy);
  return {
    duration: activity.duration,
    segments: addReactionShots(speakerSegments, activity, policy),
  };
}
