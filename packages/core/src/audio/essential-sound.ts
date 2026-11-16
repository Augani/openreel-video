import type {
  AudioType,
  AutomationPoint,
  Clip,
  Effect,
  EssentialSoundBlock,
  EssentialSoundOptions,
  Track,
} from "../types";
import { AUDIO_TYPES } from "../types/timeline";
import {
  planClipNormalization,
  type ClipNormalizationInput,
  type ClipNormalizationPlan,
} from "./loudness/clip-normalize";

/**
 * Essential Sound: tag a clip as Dialogue, Music, SFX or Ambience and get the
 * loudness match, repair, clarity EQ and ducking that type usually wants.
 *
 * Everything here is pure planning over the engines that already exist (the
 * clip audio effects, `planClipNormalization`, the ducking settings). The web
 * app turns the plan into ordinary undoable actions inside one history group.
 */

/** Music sits this many LU under the dialogue target (-16 -> -23 LUFS). */
export const MUSIC_BELOW_DIALOGUE_LU = 7;
export const SFX_TARGET_LUFS = -20;
export const AMBIENCE_TARGET_LUFS = -28;
export const DEFAULT_DIALOGUE_TARGET_LUFS = -16;

export const AUDIO_TYPE_LABELS: Record<AudioType, string> = {
  dialogue: "Dialogue",
  music: "Music",
  sfx: "SFX",
  ambience: "Ambience",
};

export const DEFAULT_ESSENTIAL_SOUND_OPTIONS: EssentialSoundOptions = {
  loudness: true,
  repair: false,
  clarity: true,
  ducking: true,
  reduceNoise: true,
  reduceRumble: true,
  clarityAmount: 0.5,
  duckAmountDb: 12,
  duckFadeMs: 300,
  dialogueTargetLufs: DEFAULT_DIALOGUE_TARGET_LUFS,
};

export const ESSENTIAL_BLOCKS: readonly EssentialSoundBlock[] = ["repair", "clarity", "loudness", "ducking"];

const ROLE_TO_TYPE: Partial<Record<NonNullable<Track["role"]>, AudioType>> = {
  dialogue: "dialogue",
  music: "music",
  effects: "sfx",
  ambience: "ambience",
};

export const isAudioType = (value: unknown): value is AudioType =>
  typeof value === "string" && (AUDIO_TYPES as readonly string[]).includes(value);

/** Type implied by a track role alone, or null for general/captions/missing. */
export function audioTypeFromRole(role: Track["role"] | undefined): AudioType | null {
  return (role && ROLE_TO_TYPE[role]) || null;
}

/** The clip's own tag, otherwise inferred from its parent track's role. */
export function resolveAudioType(clip: Pick<Clip, "audioType" | "trackId">, tracks: readonly Pick<Track, "id" | "role">[]): AudioType | null {
  if (isAudioType(clip.audioType)) return clip.audioType;
  return audioTypeFromRole(tracks.find((track) => track.id === clip.trackId)?.role);
}

/** Merge partial options over the defaults, clamping every number into range. */
export function normalizeEssentialOptions(options?: Partial<EssentialSoundOptions> | null): EssentialSoundOptions {
  const o = { ...DEFAULT_ESSENTIAL_SOUND_OPTIONS, ...(options ?? {}) };
  const num = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    loudness: !!o.loudness,
    repair: !!o.repair,
    clarity: !!o.clarity,
    ducking: !!o.ducking,
    reduceNoise: !!o.reduceNoise,
    reduceRumble: !!o.reduceRumble,
    clarityAmount: num(o.clarityAmount, 0, 1, 0.5),
    duckAmountDb: num(o.duckAmountDb, 1, 40, 12),
    duckFadeMs: num(o.duckFadeMs, 10, 3000, 300),
    dialogueTargetLufs: num(o.dialogueTargetLufs, -40, -6, DEFAULT_DIALOGUE_TARGET_LUFS),
  };
}

export function loudnessTargetFor(type: AudioType, options: Pick<EssentialSoundOptions, "dialogueTargetLufs">): number {
  switch (type) {
    case "dialogue":
      return options.dialogueTargetLufs;
    case "music":
      return options.dialogueTargetLufs - MUSIC_BELOW_DIALOGUE_LU;
    case "sfx":
      return SFX_TARGET_LUFS;
    case "ambience":
      return AMBIENCE_TARGET_LUFS;
  }
}

/** One audio effect the panel wants on the clip, before it has an id. */
export interface PlannedEffect {
  readonly block: Exclude<EssentialSoundBlock, "loudness" | "ducking">;
  /** Stable identity inside the clip's chain: how re-applying finds its own effect. */
  readonly key: string;
  readonly type: "eq" | "compressor" | "noiseReduction" | "brickwallLimiter" | "lowPass";
  readonly params: Record<string, unknown>;
  readonly label: string;
}

export interface DuckingPlan {
  readonly enabled: boolean;
  readonly againstTrackRoles: readonly ["dialogue"];
  readonly amountDb: number;
  readonly fadeMs: number;
  /** Why ducking is off, when the type or the project rules it out. */
  readonly reason?: string;
}

export interface EssentialSoundPlan {
  readonly audioType: AudioType;
  readonly options: EssentialSoundOptions;
  /** LUFS the clip is matched to, or null when Loudness is off. */
  readonly loudnessTarget: number | null;
  /** Ordered: repair first, then clarity. */
  readonly effectChain: readonly PlannedEffect[];
  readonly ducking: DuckingPlan;
  /** The gain action, when a measurement and the clip were supplied. */
  readonly normalization: ClipNormalizationPlan | null;
}

const eqBand = (type: string, frequency: number, gain: number, q: number) => ({ type, frequency, gain, q });
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function repairEffects(type: AudioType, options: EssentialSoundOptions): PlannedEffect[] {
  if (type !== "dialogue" || !options.repair) return [];
  const chain: PlannedEffect[] = [];
  if (options.reduceRumble) {
    chain.push({
      block: "repair",
      key: "rumble",
      type: "eq",
      label: "Reduce rumble",
      params: { bands: [eqBand("highpass", 100, 0, 0.9)] },
    });
  }
  if (options.reduceNoise) {
    chain.push({
      block: "repair",
      key: "noise",
      type: "noiseReduction",
      label: "Reduce noise",
      params: { threshold: -40, reduction: 0.5, attack: 10, release: 100, focus: "speech" },
    });
  }
  return chain;
}

function clarityEffects(type: AudioType, options: EssentialSoundOptions): PlannedEffect[] {
  if (!options.clarity) return [];
  const a = options.clarityAmount;
  switch (type) {
    case "dialogue":
      return [
        {
          block: "clarity",
          key: "dialogue-eq",
          type: "eq",
          label: "High-pass 80 Hz + presence",
          params: { bands: [eqBand("highpass", 80, 0, 0.707), eqBand("peaking", 3000, round(1 + 4 * a), 1)] },
        },
        {
          block: "clarity",
          key: "dialogue-compressor",
          type: "compressor",
          label: "Light compression",
          params: { threshold: -20, ratio: 2.5, attack: 0.01, release: 0.15, knee: 30 },
        },
      ];
    case "music":
      return [
        {
          block: "clarity",
          key: "music-scoop",
          type: "eq",
          label: "Mid scoop",
          params: { bands: [eqBand("peaking", 1500, -round(1 + 5 * a), 0.8)] },
        },
      ];
    case "sfx":
      // A true lookahead brickwall limiter: SFX peaks never get past the ceiling.
      return [
        {
          block: "clarity",
          key: "sfx-limiter",
          type: "brickwallLimiter",
          label: "Brickwall limiter",
          params: { ceiling: -3 - round(6 * (1 - a), 1), release: 0.1 },
        },
      ];
    case "ambience":
      return [
        {
          block: "clarity",
          key: "ambience-lowpass",
          type: "lowPass",
          label: "Low-pass",
          params: { frequency: round(12000 - 6000 * a, 0), slope: 12 },
        },
      ];
  }
}

function duckingPlan(type: AudioType, options: EssentialSoundOptions): DuckingPlan {
  const base = { againstTrackRoles: ["dialogue"] as ["dialogue"], amountDb: options.duckAmountDb, fadeMs: options.duckFadeMs };
  if (type === "dialogue") {
    return { ...base, enabled: false, reason: "Dialogue is never ducked." };
  }
  if (!options.ducking) return { ...base, enabled: false };
  return { ...base, enabled: true };
}

/**
 * The ordered plan for tagging a clip as `type`. `measuredLoudness` (and
 * `clip`, which carries the gain being changed) turn the loudness target into
 * the one gain action; without them only the target is reported.
 */
export function planEssentialSound(
  type: AudioType,
  options: Partial<EssentialSoundOptions> | null | undefined,
  measuredLoudness?: ClipNormalizationInput | null,
  clip?: Pick<Clip, "id" | "volume" | "automation">,
): EssentialSoundPlan {
  const resolved = normalizeEssentialOptions(options);
  const loudnessTarget = resolved.loudness ? loudnessTargetFor(type, resolved) : null;
  return {
    audioType: type,
    options: resolved,
    loudnessTarget,
    effectChain: [...repairEffects(type, resolved), ...clarityEffects(type, resolved)],
    ducking: duckingPlan(type, resolved),
    normalization:
      loudnessTarget !== null && measuredLoudness && clip ? planClipNormalization(clip, measuredLoudness, loudnessTarget) : null,
  };
}

// ---------------------------------------------------------------------------
// Tagged effects: the panel only ever touches effects it added.

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, v]) => [key, stable(v)]),
    );
  }
  return value;
};

/** Order-independent signature of an effect's params. */
export const paramsSignature = (params: Record<string, unknown>): string => JSON.stringify(stable(params));

export function essentialTag(effect: Effect): NonNullable<Effect["metadata"]>["essentialSound"] | null {
  const tag = effect.metadata?.essentialSound;
  return tag && typeof tag.key === "string" && typeof tag.block === "string" ? tag : null;
}

/** True when the user changed a tagged effect's parameters after the panel applied it. */
export function isUserEdited(effect: Effect): boolean {
  const tag = essentialTag(effect);
  return !!tag && tag.sig !== paramsSignature(effect.params);
}

export function createTaggedEffect(planned: PlannedEffect, id: string): Effect {
  return {
    id,
    type: planned.type,
    enabled: true,
    params: structuredClone(planned.params),
    metadata: { essentialSound: { block: planned.block, key: planned.key, sig: paramsSignature(planned.params) } },
  };
}

export interface EffectReconciliation {
  readonly add: PlannedEffect[];
  readonly replace: { effectId: string; planned: PlannedEffect }[];
  readonly remove: string[];
  /** Tagged effects left alone because the user edited them. */
  readonly keptUserEdited: string[];
}

/**
 * Diff the clip's current chain against the plan for the given blocks.
 *  - effects the panel added and the plan still wants are updated in place;
 *  - effects the panel added and the plan no longer wants are removed;
 *  - effects the user edited are never overwritten (and only removed with `force`);
 *  - effects the panel did not add are never touched.
 * Reconciling the result again yields no work (idempotent).
 */
export function reconcileEssentialEffects(
  existing: readonly Effect[],
  planned: readonly PlannedEffect[],
  blocks: readonly EssentialSoundBlock[],
  options: { force?: boolean } = {},
): EffectReconciliation {
  const add: PlannedEffect[] = [];
  const replace: { effectId: string; planned: PlannedEffect }[] = [];
  const remove: string[] = [];
  const keptUserEdited: string[] = [];
  const owned = existing.filter((effect) => {
    const tag = essentialTag(effect);
    return tag && blocks.includes(tag.block);
  });
  const matched = new Set<string>();
  for (const want of planned) {
    const current = owned.find((effect) => essentialTag(effect)?.key === want.key && !matched.has(effect.id));
    if (!current) {
      add.push(want);
      continue;
    }
    matched.add(current.id);
    if (isUserEdited(current)) {
      keptUserEdited.push(current.id);
    } else if (essentialTag(current)?.sig !== paramsSignature(want.params) || current.type !== want.type) {
      replace.push({ effectId: current.id, planned: want });
    }
  }
  for (const effect of owned) {
    if (matched.has(effect.id)) continue;
    if (isUserEdited(effect) && !options.force) keptUserEdited.push(effect.id);
    else remove.push(effect.id);
  }
  return { add, replace, remove, keptUserEdited };
}

// ---------------------------------------------------------------------------
// Ducking

export interface ResolvedDucking {
  readonly enabled: boolean;
  /** Tracks whose clips trigger the duck: role in `againstTrackRoles`, never the clip's own track. */
  readonly sourceTrackIds: string[];
  readonly reason?: string;
}

/** Resolve ducking against tracks whose role is 'dialogue' only. */
export function resolveEssentialDucking(
  plan: DuckingPlan,
  clip: Pick<Clip, "id" | "trackId" | "startTime" | "duration">,
  tracks: readonly Pick<Track, "id" | "role" | "clips" | "muted">[],
): ResolvedDucking {
  if (!plan.enabled) return { enabled: false, sourceTrackIds: [], reason: plan.reason };
  const dialogueTracks = tracks.filter((track) => track.id !== clip.trackId && !!track.role && plan.againstTrackRoles.includes(track.role as "dialogue"));
  if (dialogueTracks.length === 0) {
    return { enabled: false, sourceTrackIds: [], reason: "Ducking is off: no track has the Dialogue role. Set a track's role to Dialogue first." };
  }
  const end = clip.startTime + clip.duration;
  const overlapping = dialogueTracks.filter(
    (track) => !track.muted && track.clips.some((other) => other.id !== clip.id && other.startTime < end && other.startTime + other.duration > clip.startTime),
  );
  if (overlapping.length === 0) {
    return { enabled: false, sourceTrackIds: [], reason: "Ducking is off: no dialogue plays under this clip." };
  }
  return { enabled: true, sourceTrackIds: overlapping.map((track) => track.id) };
}

/** AudioDuckingSettings shape (apps/web stores/project) for the plan; reduction is the fraction removed. */
export function duckingSettingsFor(plan: Pick<DuckingPlan, "amountDb" | "fadeMs">, sourceTrackId: string) {
  return {
    enabled: true,
    sourceTrackId,
    threshold: -30,
    reduction: 1 - Math.pow(10, -plan.amountDb / 20),
    attack: plan.fadeMs / 1000,
    release: plan.fadeMs / 1000,
    holdTime: 0.2,
  };
}

const laneAt = (lane: readonly AutomationPoint[], time: number): number => {
  if (time <= lane[0].time) return lane[0].value;
  const last = lane[lane.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 1; i < lane.length; i++) {
    if (time <= lane[i].time) {
      const a = lane[i - 1];
      const b = lane[i];
      return b.time === a.time ? b.value : a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time);
    }
  }
  return last.value;
};

/**
 * Several dialogue tracks each produce a duck lane; the clip follows whichever
 * is lowest at every moment (it ducks while ANY dialogue speaks).
 */
export function mergeDuckingLanes(lanes: readonly (readonly AutomationPoint[])[]): AutomationPoint[] {
  const filled = lanes.filter((lane) => lane.length > 0);
  if (filled.length === 0) return [];
  if (filled.length === 1) return filled[0].map((point) => ({ ...point }));
  const times = [...new Set(filled.flatMap((lane) => lane.map((point) => point.time)))].sort((a, b) => a - b);
  return times.map((time) => ({ time, value: Math.min(...filled.map((lane) => laneAt(lane, time))) }));
}

/** True when a lane is exactly what `applied` recorded (the user has not edited it since). */
export const sameLane = (a: readonly AutomationPoint[] | null | undefined, b: readonly AutomationPoint[] | null | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
