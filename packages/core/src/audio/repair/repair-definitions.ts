import type { AudioRack, Effect, Project, Timeline } from "../../types";
import { REPAIR_EFFECT_TYPES, isRepairEffectType, type RepairEffectType } from "./repair-dsp";

/** Parameter metadata shared by clip effects, track/bus racks and the repair panel. */
export interface RepairParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly unit: string;
  /** Rendered as an on/off switch (value 0/1). */
  readonly toggle?: boolean;
}

export interface RepairPreset {
  readonly id: string;
  readonly label: string;
  readonly params: Readonly<Record<string, number>>;
}

export interface RepairEffectDefinition {
  readonly type: RepairEffectType;
  readonly label: string;
  readonly description: string;
  readonly params: readonly RepairParamSpec[];
  readonly presets: readonly RepairPreset[];
  /** True when the effect reports a gain-reduction meter. */
  readonly hasMeter: boolean;
  /** Honest note shown next to experimental effects. */
  readonly caveat?: string;
}

const p = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  unit = "",
  toggle = false,
): RepairParamSpec => ({ key, label, min, max, step, default: def, unit, ...(toggle ? { toggle: true } : {}) });

export const REPAIR_EFFECT_DEFINITIONS: Record<RepairEffectType, RepairEffectDefinition> = {
  deHum: {
    type: "deHum",
    label: "DeHum",
    description: "Notch filters on the mains hum frequency and its harmonics.",
    hasMeter: false,
    params: [
      p("frequency", "Hum frequency", 40, 70, 0.1, 60, "Hz"),
      p("harmonics", "Harmonics", 1, 8, 1, 4),
      p("q", "Notch Q", 5, 100, 1, 30),
      p("depth", "Depth", 0, 1, 0.01, 1),
    ],
    presets: [
      { id: "hum60", label: "60 Hz mains (US)", params: { frequency: 60, harmonics: 4, q: 30, depth: 1 } },
      { id: "hum50", label: "50 Hz mains (EU)", params: { frequency: 50, harmonics: 4, q: 30, depth: 1 } },
      { id: "hum60w", label: "60 Hz, gentle", params: { frequency: 60, harmonics: 3, q: 12, depth: 0.8 } },
      { id: "hum50w", label: "50 Hz, gentle", params: { frequency: 50, harmonics: 3, q: 12, depth: 0.8 } },
    ],
  },
  deClick: {
    type: "deClick",
    label: "DeClick",
    description: "Finds short impulse clicks and interpolates over them.",
    hasMeter: false,
    params: [p("sensitivity", "Sensitivity", 0, 1, 0.01, 0.5), p("maxWidth", "Max click width", 2, 48, 1, 24, "smp")],
    presets: [
      { id: "light", label: "Light (mouth clicks)", params: { sensitivity: 0.4, maxWidth: 12 } },
      { id: "standard", label: "Standard", params: { sensitivity: 0.5, maxWidth: 24 } },
      { id: "heavy", label: "Heavy (vinyl / crackle)", params: { sensitivity: 0.8, maxWidth: 32 } },
    ],
  },
  deClip: {
    type: "deClip",
    label: "DeClip",
    description: "Rebuilds the flattened tops of clipped peaks with a smooth curve.",
    hasMeter: false,
    params: [p("threshold", "Clip level", -24, 0, 0.1, -0.5, "dBFS"), p("maxRun", "Max clipped run", 4, 120, 1, 64, "smp")],
    presets: [
      { id: "digital", label: "Digital clipping (0 dBFS)", params: { threshold: -0.3, maxRun: 64 } },
      { id: "soft", label: "Soft-limited peaks", params: { threshold: -3, maxRun: 48 } },
    ],
  },
  deEss: {
    type: "deEss",
    label: "DeEss",
    description: "Compresses only the sibilance band; everything else passes untouched.",
    hasMeter: true,
    params: [
      p("frequency", "Center", 2500, 12000, 50, 6500, "Hz"),
      p("bandwidthQ", "Band Q", 0.3, 6, 0.1, 1.5),
      p("threshold", "Threshold", -60, 0, 0.5, -30, "dB"),
      p("ratio", "Ratio", 1, 20, 0.1, 6, ":1"),
      p("attack", "Attack", 0.0002, 0.05, 0.0002, 0.001, "s"),
      p("release", "Release", 0.005, 0.5, 0.005, 0.05, "s"),
      p("listen", "Listen to band", 0, 1, 1, 0, "", true),
    ],
    presets: [
      { id: "female", label: "Female voice", params: { frequency: 7500, bandwidthQ: 1.5, threshold: -30, ratio: 6 } },
      { id: "male", label: "Male voice", params: { frequency: 5500, bandwidthQ: 1.5, threshold: -30, ratio: 6 } },
      { id: "gentle", label: "Gentle", params: { frequency: 6500, bandwidthQ: 1.2, threshold: -26, ratio: 3 } },
      { id: "heavy", label: "Heavy", params: { frequency: 6500, bandwidthQ: 1.5, threshold: -36, ratio: 12 } },
    ],
  },
  deReverb: {
    type: "deReverb",
    label: "DeReverb",
    description: "Spectral subtraction of the late reverberant tail.",
    hasMeter: false,
    caveat:
      "Reduces the late tail of a roomy recording; it cannot remove early reflections, and strong settings make speech thin. Adds about 21 ms of latency.",
    params: [
      p("amount", "Amount", 0, 1, 0.01, 0.6),
      p("rt60", "Room decay (RT60)", 0.1, 3, 0.05, 0.8, "s"),
      p("floor", "Max reduction", -40, 0, 1, -18, "dB"),
    ],
    presets: [
      { id: "light", label: "Light", params: { amount: 0.35, rt60: 0.6, floor: -12 } },
      { id: "medium", label: "Medium", params: { amount: 0.6, rt60: 0.8, floor: -18 } },
      { id: "strong", label: "Strong (large room)", params: { amount: 0.85, rt60: 1.4, floor: -24 } },
    ],
  },
  gate: {
    type: "gate",
    label: "Gate",
    description: "Closes between phrases to remove low-level noise and room tone.",
    hasMeter: true,
    params: [
      p("threshold", "Threshold", -80, 0, 0.5, -50, "dB"),
      p("range", "Range", -80, 0, 1, -30, "dB"),
      p("attack", "Attack", 0.0002, 0.2, 0.0002, 0.002, "s"),
      p("hold", "Hold", 0, 1, 0.005, 0.05, "s"),
      p("release", "Release", 0.01, 2, 0.01, 0.15, "s"),
    ],
    presets: [
      { id: "dialogue", label: "Dialogue", params: { threshold: -48, range: -24, attack: 0.002, hold: 0.08, release: 0.2 } },
      { id: "tight", label: "Tight", params: { threshold: -40, range: -45, attack: 0.001, hold: 0.03, release: 0.08 } },
    ],
  },
  brickwallLimiter: {
    type: "brickwallLimiter",
    label: "Brickwall Limiter",
    description: "Lookahead true-peak limiter: nothing, inter-sample peaks included, gets past the ceiling.",
    hasMeter: true,
    params: [p("ceiling", "Ceiling", -24, 0, 0.1, -1, "dBTP"), p("release", "Release", 0.01, 1, 0.01, 0.1, "s")],
    presets: [
      { id: "broadcast", label: "Broadcast (-2 dBTP)", params: { ceiling: -2, release: 0.15 } },
      { id: "streaming", label: "Streaming (-1 dBTP)", params: { ceiling: -1, release: 0.1 } },
      { id: "sfx", label: "SFX safety (-3 dBTP)", params: { ceiling: -3, release: 0.1 } },
    ],
  },
  lowPass: {
    type: "lowPass",
    label: "Low-Pass Filter",
    description: "Butterworth low-pass, 12 to 48 dB per octave. Rolls off hiss and brightness above the cutoff.",
    hasMeter: false,
    params: [p("frequency", "Cutoff", 100, 20000, 10, 12000, "Hz"), p("slope", "Slope", 12, 48, 12, 12, "dB/oct")],
    presets: [
      { id: "ambience", label: "Soften ambience (9 kHz)", params: { frequency: 9000, slope: 12 } },
      { id: "telephone", label: "Telephone (3.4 kHz)", params: { frequency: 3400, slope: 24 } },
      { id: "muffled", label: "Muffled (1.2 kHz)", params: { frequency: 1200, slope: 24 } },
    ],
  },
};

export const defaultRepairParams = (type: RepairEffectType): Record<string, number> =>
  Object.fromEntries(REPAIR_EFFECT_DEFINITIONS[type].params.map((spec) => [spec.key, spec.default]));

export function sanitizeRepairParams(
  type: RepairEffectType,
  raw: Record<string, unknown> | undefined,
): Record<string, number> {
  const out = defaultRepairParams(type);
  for (const spec of REPAIR_EFFECT_DEFINITIONS[type].params) {
    const v = raw?.[spec.key];
    const value = typeof v === "boolean" ? (v ? 1 : 0) : v;
    if (typeof value === "number" && Number.isFinite(value)) out[spec.key] = Math.max(spec.min, Math.min(spec.max, value));
  }
  return out;
}

/** Tail (seconds of audio before a render window that it needs to be warm). */
export function repairWarmupSeconds(type: RepairEffectType): number {
  switch (type) {
    case "deReverb":
      return 1.5;
    case "deHum":
      return 1;
    case "deEss":
    case "gate":
      return 0.5;
    default:
      return 0.1;
  }
}

export const REPAIR_TYPES_LIST = REPAIR_EFFECT_TYPES;

type WorkletKind = (type: string, params?: Record<string, unknown>) => boolean;
/** A compressor with a sidechain key runs in the worklet (the keyed linked compressor), in stereo as well as 5.1. */
const isKeyedCompressor = (type: string, params?: Record<string, unknown>): boolean =>
  type === "compressor" && typeof params?.keySource === "string" && params.keySource.length > 0;
const repairOnly: WorkletKind = (type, params) => isRepairEffectType(type) || isKeyedCompressor(type, params);
/** A 5.1 mix also runs compressors and limiters in the worklet (the linked six-channel compressor). */
const repairOrLinkedDynamics: WorkletKind = (type) => isRepairEffectType(type) || type === "compressor" || type === "limiter";

const rackUsesRepair = (rack: AudioRack | undefined, kind: WorkletKind): boolean =>
  !!rack && rack.effects.some((fx) => !fx.bypassed && kind(fx.type, fx.params));
const effectsUseRepair = (effects: readonly Effect[] | undefined, kind: WorkletKind): boolean =>
  !!effects && effects.some((fx) => fx.enabled && kind(fx.type, fx.params as Record<string, unknown>));

const timelineUsesRepair = (timeline: Pick<Timeline, "tracks" | "audioBuses" | "masterAudioRack">, kind: WorkletKind): boolean =>
  rackUsesRepair(timeline.masterAudioRack, kind) ||
  (timeline.audioBuses ?? []).some((bus) => rackUsesRepair(bus.rack, kind)) ||
  timeline.tracks.some((track) => rackUsesRepair(track.audioRack, kind) || track.clips.some((clip) => effectsUseRepair(clip.audioEffects, kind)));

/**
 * True when rendering this project needs the repair worklet loaded. `surround`: the mix is 5.1, where
 * compressors and limiters are worklet processors too (the native node would fold six channels to two).
 */
export const projectUsesRepairEffects = (project: Project, surround = false): boolean => {
  const kind = surround ? repairOrLinkedDynamics : repairOnly;
  return (
    timelineUsesRepair(project.timeline, kind) ||
    (project.compoundClips ?? []).some((compound) => timelineUsesRepair(compound.content as Pick<Timeline, "tracks">, kind))
  );
};
