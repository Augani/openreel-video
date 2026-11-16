import type { AudioType, AutomationPoint, Clip, LiveDuckingConfig, Timeline, Track } from "../types/timeline";
import { resolveAudioType, type DuckingPlan } from "./essential-sound";
import { clampVolume } from "./volume-automation";

/**
 * Live ducking: the gain dip under dialogue is not stored as keyframes. The
 * clip keeps a small `LiveDuckingConfig` (metadata.liveDucking) and the dip is
 * computed from where the dialogue clips ARE right now, every time the clip's
 * volume lane is resolved (preview, mixdown, export, stems). Move or trim a
 * dialogue clip and every ducked clip follows, with no re-analysis step.
 *
 * "Dialogue activity" means the extent of dialogue clips (Essential Sound tag
 * Dialogue, or a track whose role is Dialogue), not the speech level inside
 * them. Gaps between words are not ducked; the gap between clips is.
 */

export const DEFAULT_LIVE_DUCKING: LiveDuckingConfig = {
  enabled: true,
  amountDb: 12,
  attackMs: 300,
  releaseMs: 300,
  holdMs: 200,
};

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Merge a partial config over the defaults, clamping every number into range. */
export function normalizeLiveDucking(config?: Partial<LiveDuckingConfig> | null): LiveDuckingConfig {
  const c = { ...DEFAULT_LIVE_DUCKING, ...(config ?? {}) };
  return {
    enabled: c.enabled !== false,
    amountDb: clamp(c.amountDb, 1, 40, DEFAULT_LIVE_DUCKING.amountDb),
    attackMs: clamp(c.attackMs, 10, 3000, DEFAULT_LIVE_DUCKING.attackMs),
    releaseMs: clamp(c.releaseMs, 10, 3000, DEFAULT_LIVE_DUCKING.releaseMs),
    holdMs: clamp(c.holdMs, 0, 3000, DEFAULT_LIVE_DUCKING.holdMs),
  };
}

export const getLiveDucking = (clip: Pick<Clip, "metadata">): LiveDuckingConfig | null => {
  const raw = clip.metadata?.liveDucking;
  if (!raw || typeof raw !== "object") return null;
  const config = normalizeLiveDucking(raw);
  return config.enabled ? config : null;
};

export interface DuckingInterval {
  readonly start: number;
  readonly end: number;
}

type TimelineTracks = Pick<Timeline, "tracks">;

const DUCKABLE_TRACK_TYPES: readonly Track["type"][] = ["audio", "video"];

/** Clips whose presence ducks `clip`: Dialogue-typed, audible, on an unmuted track, never the clip itself. */
export function findDialogueSources(clip: Pick<Clip, "id" | "trackId">, timeline: TimelineTracks): Clip[] {
  const sources: Clip[] = [];
  for (const track of timeline.tracks) {
    if (track.muted || track.hidden || !DUCKABLE_TRACK_TYPES.includes(track.type)) continue;
    for (const other of track.clips) {
      if (other.id === clip.id || !(other.volume > 0) || !(other.duration > 0)) continue;
      const type: AudioType | null = resolveAudioType(other, timeline.tracks);
      if (type === "dialogue") sources.push(other);
    }
  }
  return sources;
}

/**
 * Time ranges (seconds from the start of `clip`, clipped to the clip) during
 * which dialogue is playing, with gaps shorter than the hold (and the ramps,
 * which would overlap anyway) merged into one duck.
 */
export function dialogueActivityFor(
  clip: Pick<Clip, "id" | "trackId" | "startTime" | "duration">,
  timeline: TimelineTracks,
  config: LiveDuckingConfig,
): DuckingInterval[] {
  const raw = findDialogueSources(clip, timeline)
    .map((source) => ({ start: source.startTime - clip.startTime, end: source.startTime + source.duration - clip.startTime }))
    .filter((range) => range.end > -config.releaseMs / 1000 && range.start < clip.duration + config.attackMs / 1000)
    .sort((a, b) => a.start - b.start);
  const mergeGap = Math.max(config.holdMs, config.attackMs + config.releaseMs) / 1000;
  const merged: { start: number; end: number }[] = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end <= mergeGap) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Piecewise-linear gain envelope (1 = untouched) for the given dialogue ranges. */
export function duckingEnvelope(intervals: readonly DuckingInterval[], config: LiveDuckingConfig): AutomationPoint[] {
  const ducked = Math.pow(10, -config.amountDb / 20);
  const attack = config.attackMs / 1000;
  const release = config.releaseMs / 1000;
  const points: AutomationPoint[] = [];
  for (const range of intervals) {
    points.push({ time: range.start - attack, value: 1 });
    points.push({ time: range.start, value: ducked });
    points.push({ time: range.end, value: ducked });
    points.push({ time: range.end + release, value: 1 });
  }
  return points;
}

const valueAt = (points: readonly AutomationPoint[], time: number, initial: number): number => {
  if (points.length === 0) return initial;
  let prev: AutomationPoint = { time: Number.NEGATIVE_INFINITY, value: initial };
  for (const point of points) {
    if (point.time === time) return point.value;
    if (point.time > time) {
      if (prev.time === Number.NEGATIVE_INFINITY) return point.value;
      const span = point.time - prev.time;
      return span <= 0 ? point.value : prev.value + ((point.value - prev.value) * (time - prev.time)) / span;
    }
    prev = point;
  }
  return prev.value;
};

/**
 * The clip's volume lane with live ducking applied: the base lane (or the flat
 * clip volume when it has none) multiplied by the dip under the dialogue
 * clips. Returns `base` untouched when the clip is not ducked or no dialogue
 * overlaps it. Times are seconds from the clip start, values absolute volume.
 */
export function applyLiveDuckingToLane(
  clip: Pick<Clip, "id" | "trackId" | "startTime" | "duration" | "volume" | "metadata">,
  timeline: TimelineTracks,
  base: readonly AutomationPoint[],
): AutomationPoint[] {
  const config = getLiveDucking(clip);
  if (!config) return base as AutomationPoint[];
  const intervals = dialogueActivityFor(clip, timeline, config).filter(
    (range) => range.end > 0 && range.start < clip.duration,
  );
  if (intervals.length === 0) return base as AutomationPoint[];
  const envelope = duckingEnvelope(intervals, config);
  const baseVolume = clampVolume(clip.volume);
  // A lane implicitly starts at the clip volume at t = 0.
  const baseLane = base.length > 0 ? [{ time: 0, value: baseVolume }, ...base.filter((p) => p.time > 0)] : [];
  const times = new Set<number>([0, clip.duration]);
  for (const point of baseLane) times.add(point.time);
  for (const point of envelope) if (point.time > 0 && point.time < clip.duration) times.add(point.time);
  return [...times]
    .filter((time) => time >= 0 && time <= clip.duration)
    .sort((a, b) => a - b)
    .map((time) => ({
      time,
      value: clampVolume(valueAt(baseLane, time, baseVolume) * valueAt(envelope, time, 1)),
    }));
}

export interface LiveDuckingPlan {
  /** The config to store on the clip, or null when ducking cannot apply. */
  readonly config: LiveDuckingConfig | null;
  /** Why ducking is off. */
  readonly reason?: string;
  /** True when dialogue is playing under the clip right now (otherwise the duck is armed and waits for dialogue). */
  readonly active: boolean;
}

/** Essential Sound's ducking plan as a live config. Arms the duck even before any dialogue is under the clip. */
export function planLiveDucking(
  plan: DuckingPlan,
  clip: Pick<Clip, "id" | "trackId" | "startTime" | "duration">,
  timeline: TimelineTracks,
): LiveDuckingPlan {
  if (!plan.enabled) return { config: null, reason: plan.reason, active: false };
  const hasDialogueTrack = timeline.tracks.some((track) => track.id !== clip.trackId && track.role === "dialogue");
  const hasTaggedDialogue = timeline.tracks.some((track) =>
    track.clips.some((other) => other.id !== clip.id && other.audioType === "dialogue"),
  );
  if (!hasDialogueTrack && !hasTaggedDialogue) {
    return {
      config: null,
      reason: "Ducking is off: no track has the Dialogue role. Set a track's role to Dialogue first.",
      active: false,
    };
  }
  const config = normalizeLiveDucking({
    enabled: true,
    amountDb: plan.amountDb,
    attackMs: plan.fadeMs,
    releaseMs: plan.fadeMs,
    holdMs: DEFAULT_LIVE_DUCKING.holdMs,
  });
  return { config, active: dialogueActivityFor(clip, timeline, config).length > 0 };
}

/** Stable string of everything that decides a clip's live duck; changes when a dialogue clip moves, trims, appears or goes. */
export function liveDuckingSignature(clip: Clip, timeline: TimelineTracks): string {
  const config = getLiveDucking(clip);
  if (!config) return "";
  return JSON.stringify([config, applyLiveDuckingToLane(clip, timeline, [])]);
}
