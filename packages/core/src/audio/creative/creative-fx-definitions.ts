/**
 * Parameter metadata for the creative / utility audio effects (Chorus, Flanger, Phaser, Distortion, Stereo Width,
 * Invert Polarity, Channel Swap / Mono). Pure data with no Web Audio or worklet imports: the rack, the clip chain, the
 * agent tools and the worklet all read the same table, so a parameter means the same thing everywhere.
 */

export type CreativeFxType =
  | "chorus"
  | "flanger"
  | "phaser"
  | "distortion"
  | "stereoWidth"
  | "invertPolarity"
  | "channelMap";

export interface CreativeParamSpec {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly unit: string;
  /** Rendered as an on/off switch (value 0/1). */
  readonly toggle?: boolean;
  /** Value is an index into these labels (rendered as a select). */
  readonly options?: readonly string[];
}

export interface CreativeFxDefinition {
  readonly type: CreativeFxType;
  readonly label: string;
  readonly description: string;
  readonly params: readonly CreativeParamSpec[];
}

/** The worklet exposes one k-rate AudioParam per parameter slot (`p0`..`p6`); a definition never has more params than this. */
export const CREATIVE_FX_MAX_PARAMS = 7;
/**
 * Slot `p7` carries the timeline clock: seconds to add to the context time to get the timeline time. LFO phase follows
 * the timeline, so preview from any playhead position and an export that starts earlier (to warm the effects up) hear
 * the same modulation.
 */
export const CREATIVE_FX_CLOCK_SLOT = 7;
/** Effects whose modulation phase follows the timeline clock. */
export const TIMELINE_CLOCKED_FX: readonly CreativeFxType[] = ["chorus", "flanger", "phaser"];

const p = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  unit = "",
  extra: Pick<CreativeParamSpec, "toggle" | "options"> = {},
): CreativeParamSpec => ({ key, label, min, max, step, default: def, unit, ...extra });

const modDelayParams = (rate: number, depth: number, delay: number, feedback: number, spread: number): CreativeParamSpec[] => [
  p("rate", "Rate", 0.05, 10, 0.01, rate, "Hz"),
  p("depth", "Depth", 0, 1, 0.01, depth),
  p("delay", "Delay", 0.1, 30, 0.1, delay, "ms"),
  p("feedback", "Feedback", -0.9, 0.9, 0.01, feedback),
  p("spread", "Stereo spread", 0, 1, 0.01, spread),
  p("mix", "Mix", 0, 1, 0.01, 0.5),
];

export const CHANNEL_MAP_MODES = ["Normal", "Swap L / R", "Mono (L + R)", "Left to both", "Right to both"] as const;
export const DISTORTION_MODES = ["Soft", "Hard", "Tube"] as const;

export const CREATIVE_FX_DEFINITIONS: Record<CreativeFxType, CreativeFxDefinition> = {
  chorus: {
    type: "chorus",
    label: "Chorus",
    description: "A short modulated delay mixed with the dry signal: thickens and widens a voice or instrument.",
    params: modDelayParams(0.8, 0.5, 12, 0, 0.5),
  },
  flanger: {
    type: "flanger",
    label: "Flanger",
    description: "A very short modulated delay with feedback: the sweeping comb-filter jet sound.",
    params: modDelayParams(0.25, 0.7, 2, 0.5, 0.25),
  },
  phaser: {
    type: "phaser",
    label: "Phaser",
    description: "A chain of all-pass filters swept by an LFO: moving notches in the spectrum.",
    params: [
      p("rate", "Rate", 0.05, 10, 0.01, 0.5, "Hz"),
      p("depth", "Depth", 0, 1, 0.01, 0.8),
      p("frequency", "Centre", 100, 4000, 10, 800, "Hz"),
      p("feedback", "Feedback", -0.9, 0.9, 0.01, 0.4),
      p("stages", "Stages", 2, 12, 2, 4),
      p("mix", "Mix", 0, 1, 0.01, 0.5),
    ],
  },
  distortion: {
    type: "distortion",
    label: "Distortion",
    description: "Soft clip, hard clip or tube-style waveshaping with a tone filter after the shaper.",
    params: [
      p("mode", "Mode", 0, 2, 1, 0, "", { options: DISTORTION_MODES }),
      p("drive", "Drive", 0, 40, 0.5, 12, "dB"),
      p("tone", "Tone", 500, 20000, 10, 12000, "Hz"),
      p("level", "Output", -24, 12, 0.5, -6, "dB"),
      p("mix", "Mix", 0, 1, 0.01, 1),
    ],
  },
  stereoWidth: {
    type: "stereoWidth",
    label: "Stereo Width",
    description: "Mid/side balance: width 0 is mono, 1 leaves the image alone, 2 doubles the side signal.",
    params: [p("width", "Width", 0, 2, 0.01, 1), p("midGain", "Mid level", -12, 12, 0.1, 0, "dB")],
  },
  invertPolarity: {
    type: "invertPolarity",
    label: "Invert Polarity",
    description: "Flips the sign of the selected channels. Fixes out-of-phase mics; exact, no filtering.",
    params: [p("left", "Left", 0, 1, 1, 1, "", { toggle: true }), p("right", "Right", 0, 1, 1, 1, "", { toggle: true })],
  },
  channelMap: {
    type: "channelMap",
    label: "Channel Swap / Mono",
    description: "Swap left and right, fold to mono, or copy one side to both.",
    params: [p("mode", "Mode", 0, CHANNEL_MAP_MODES.length - 1, 1, 0, "", { options: CHANNEL_MAP_MODES })],
  },
};

export const CREATIVE_FX_TYPES = Object.keys(CREATIVE_FX_DEFINITIONS) as CreativeFxType[];

export const isCreativeFxType = (value: unknown): value is CreativeFxType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CREATIVE_FX_DEFINITIONS, value);

/** Params whose change is a discrete switch (never smoothed in the DSP). */
export const isDiscreteCreativeParam = (spec: CreativeParamSpec): boolean => !!spec.toggle || !!spec.options || spec.key === "stages";

export const defaultCreativeParams = (type: CreativeFxType): Record<string, number> =>
  Object.fromEntries(CREATIVE_FX_DEFINITIONS[type].params.map((spec) => [spec.key, spec.default]));

/** Every known key clamped into range (booleans count as 0/1); unknown keys are dropped. */
export function sanitizeCreativeParams(type: CreativeFxType, raw: Record<string, unknown> | undefined): Record<string, number> {
  const out = defaultCreativeParams(type);
  for (const spec of CREATIVE_FX_DEFINITIONS[type].params) {
    const v = raw?.[spec.key];
    const value = typeof v === "boolean" ? (v ? 1 : 0) : v;
    if (typeof value === "number" && Number.isFinite(value)) {
      const clamped = Math.max(spec.min, Math.min(spec.max, value));
      out[spec.key] = isDiscreteCreativeParam(spec) ? Math.round(clamped) : clamped;
    }
  }
  return out;
}

/** Sanitised params as the ordered slot values the worklet reads (`p0`..). */
export const creativeParamValues = (type: CreativeFxType, raw: Record<string, unknown> | undefined): number[] => {
  const clean = sanitizeCreativeParams(type, raw);
  return CREATIVE_FX_DEFINITIONS[type].params.map((spec) => clean[spec.key]);
};

/** Audible tail (seconds) the effect adds after its input stops. */
export function creativeFxTailSeconds(type: CreativeFxType, raw: Record<string, unknown> | undefined): number {
  const q = sanitizeCreativeParams(type, raw);
  switch (type) {
    case "chorus":
    case "flanger": {
      if (q.mix <= 0) return 0;
      const fb = Math.min(0.9, Math.abs(q.feedback));
      const repeats = fb > 0 ? Math.ceil(Math.log(1e-5) / Math.log(fb)) : 1;
      return (q.delay * 1.8 * repeats) / 1000;
    }
    case "phaser":
      return q.mix > 0 ? 0.05 + (Math.abs(q.feedback) > 0.2 ? 0.4 : 0.05) : 0;
    case "distortion":
      return 0.05;
    default:
      return 0;
  }
}
