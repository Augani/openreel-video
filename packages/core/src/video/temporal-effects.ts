/**
 * Temporal (Premiere "Time") video effects: Echo and Posterize Time.
 *
 * Both are pro effects in every way that matters to the rest of the app (spec,
 * defaults, inspector, keyframes, agent schemas, presets), but neither can be
 * a per-frame pixel pass: they decide WHICH source frames are shown, not how a
 * frame looks. This module is the single source of truth for that decision:
 *
 *  - TEMPORAL_PRO_EFFECT_SPECS: labels, ranges, defaults and neutral values.
 *  - posterizeTime / posterizedClipTime: Posterize Time quantises the clip-local
 *    time onto a fixed frame grid, so the source frame shown is the same for
 *    every output frame inside one posterized frame.
 *  - planEcho: the clip-local times of the echo frames (t - k * echoTime), with
 *    the intensity of each, dropping echoes that fall outside the clip.
 *  - compositeEchoReference: the pure per-pixel definition of the six echo
 *    operators. The renderer (echo-compositor.ts) draws the same operators with
 *    Canvas2D composite modes and is checked against this reference.
 *
 * Everything is a pure function of (clip-local time, parameters): there is no
 * wall clock and no frame history, so preview, playback scrubbing and export
 * produce the identical frame for the same timeline position.
 */
import type {
  ProEffectCategory,
  ProEffectParamSpec,
  ProEffectSpec,
} from "./pro-effects";

export const TEMPORAL_PRO_EFFECT_TYPES = ["echo", "posterize-time"] as const;

export type TemporalEffectType = (typeof TEMPORAL_PRO_EFFECT_TYPES)[number];

const TEMPORAL_SET: ReadonlySet<string> = new Set(TEMPORAL_PRO_EFFECT_TYPES);

export function isTemporalEffectType(type: string): type is TemporalEffectType {
  return TEMPORAL_SET.has(type);
}

/** Temporal effects only ever change a layer's alpha through the Composite operators of Echo. */
export const TEMPORAL_EFFECTS_WRITING_ALPHA: readonly TemporalEffectType[] = [
  "echo",
];

export const ECHO_OPERATORS = [
  "add",
  "maximum",
  "minimum",
  "screen",
  "composite-back",
  "composite-front",
] as const;

export type EchoOperator = (typeof ECHO_OPERATORS)[number];

/** Upper bound of "Number of echoes": each echo costs one extra decoded frame per output frame. */
export const MAX_ECHOES = 32;
/** Echo time slider range, seconds (positive = frames from the past, negative = from the future). */
export const MAX_ECHO_TIME = 2;
/** Highest Posterize Time frame rate, frames per second. */
export const MAX_POSTERIZE_FPS = 120;

/** Tolerance that keeps `0.3 * 10` style float products from falling one frame short. */
const FRAME_EPSILON = 1e-6;
/** Tolerance of the clip boundary test of echo frames, seconds. */
const BOUNDARY_EPSILON = 1e-9;

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  neutral: number,
  unit?: string,
): ProEffectParamSpec => ({
  key,
  label,
  kind: "number",
  min,
  max,
  step,
  unit,
  default: def,
  neutral,
  keyframable: true,
});

const TIME_CATEGORY: ProEffectCategory = "Time";

export const TEMPORAL_PRO_EFFECT_SPECS: Readonly<
  Record<TemporalEffectType, ProEffectSpec>
> = {
  echo: {
    type: "echo",
    label: "Echo",
    description: "Combine frames from other moments of the clip into trails",
    category: TIME_CATEGORY,
    params: [
      num("echoTime", "Echo time", -MAX_ECHO_TIME, MAX_ECHO_TIME, 0.001, 0.033, 0, "s"),
      num("echoes", "Number of echoes", 0, MAX_ECHOES, 1, 2, 0),
      num("startIntensity", "Starting intensity", 0, 1, 0.01, 1, 1),
      num("decay", "Decay", 0, 1, 0.01, 0.5, 0.5),
      {
        key: "operator",
        label: "Echo operator",
        kind: "select",
        default: "add",
        neutral: "add",
        options: [
          { value: "add", label: "Add" },
          { value: "maximum", label: "Maximum" },
          { value: "minimum", label: "Minimum" },
          { value: "screen", label: "Screen" },
          { value: "composite-back", label: "Composite in Back" },
          { value: "composite-front", label: "Composite in Front" },
        ],
      },
    ],
  },
  "posterize-time": {
    type: "posterize-time",
    label: "Posterize Time",
    description: "Hold frames to play the clip at a lower, steady frame rate",
    category: TIME_CATEGORY,
    params: [
      // 0 is "off": the clip keeps its own frame rate, which makes the neutral value an exact no-op.
      num("frameRate", "Frame rate", 0, MAX_POSTERIZE_FPS, 1, 1, 0, "fps"),
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Parameter reading                                                           */
/* -------------------------------------------------------------------------- */

const finite = (raw: unknown, fallback: number): number =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;

const clamp = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value;

export interface ResolvedEcho {
  /** Seconds between echoes; positive reaches back in time (sample = t - k * echoTime). */
  readonly echoTime: number;
  /** Whole number of echoes behind the current frame, 0..MAX_ECHOES. */
  readonly echoes: number;
  readonly startIntensity: number;
  readonly decay: number;
  readonly operator: EchoOperator;
}

/** Reads stored (possibly keyframe-interpolated, possibly partial) params into valid Echo values. */
export function resolveEcho(params: Readonly<Record<string, unknown>>): ResolvedEcho {
  const operator = params.operator;
  return {
    echoTime: clamp(finite(params.echoTime, 0), -MAX_ECHO_TIME, MAX_ECHO_TIME),
    // Keyframes interpolate between integers, so the count rounds rather than truncates.
    echoes: Math.round(clamp(finite(params.echoes, 0), 0, MAX_ECHOES)),
    startIntensity: clamp(finite(params.startIntensity, 1), 0, 1),
    decay: clamp(finite(params.decay, 0.5), 0, 1),
    operator: (ECHO_OPERATORS as readonly unknown[]).includes(operator)
      ? (operator as EchoOperator)
      : "add",
  };
}

/** Posterize Time frame rate in fps; 0 when off. */
export function resolvePosterizeRate(params: Readonly<Record<string, unknown>>): number {
  return clamp(finite(params.frameRate, 0), 0, MAX_POSTERIZE_FPS);
}

/** True when the effect leaves the picture and the frame selection unchanged. */
export function isTemporalNeutral(
  type: TemporalEffectType,
  params: Readonly<Record<string, unknown>>,
): boolean {
  if (type === "echo") return resolveEcho(params).echoes === 0;
  return resolvePosterizeRate(params) <= 0;
}

/* -------------------------------------------------------------------------- */
/* Posterize Time                                                              */
/* -------------------------------------------------------------------------- */

/** Index of the posterized frame that clip-local time `t` falls into. */
export function posterizeFrameIndex(t: number, fps: number): number {
  return Math.floor(t * fps + FRAME_EPSILON);
}

/**
 * Clip-local time of the posterized frame containing `t`: the start of the
 * 1/fps interval. A rate of 0 (or less) or a non-finite time returns `t`.
 */
export function posterizeTime(t: number, fps: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(fps) || fps <= 0) return t;
  return posterizeFrameIndex(t, fps) / fps;
}

/** Minimal shape of an effect the clip-level helpers read. */
export interface TemporalEffectLike {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * Clip-local time the clip's frame is taken from once an enabled Posterize
 * Time effect is applied (the first one wins). `effects` must already be
 * sampled at `localTime`, so a keyframed frame rate is the rate at this frame.
 */
export function posterizedClipTime(
  effects: readonly TemporalEffectLike[],
  localTime: number,
): number {
  for (const effect of effects) {
    if (effect.type !== "posterize-time" || effect.enabled === false) continue;
    const fps = resolvePosterizeRate(effect.params ?? {});
    if (fps > 0) return posterizeTime(localTime, fps);
  }
  return localTime;
}

/** The first enabled, non-neutral Echo among `effects`, with its position in the list. */
export function findActiveEcho(
  effects: readonly TemporalEffectLike[],
): { readonly index: number; readonly echo: ResolvedEcho } | null {
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    if (effect.type !== "echo" || effect.enabled === false) continue;
    const echo = resolveEcho(effect.params ?? {});
    if (echo.echoes > 0) return { index, echo };
  }
  return null;
}

/**
 * Does this clip pick frames other than its own at its playhead position? True for an enabled, non-neutral Echo or
 * Posterize Time, or for keyframes of their parameters (which can switch one on). The preview routes such clips
 * through the canonical engine renderer (the one export uses) and the engine skips the frame-time resolution
 * for every other clip, so the check is cheap and conservative.
 */
export function clipHasTemporalEffects(clip: {
  readonly effects?: readonly TemporalEffectLike[];
  readonly keyframes?: readonly { readonly property: string }[];
}): boolean {
  const active = clip.effects?.some(
    (e) =>
      isTemporalEffectType(e.type) &&
      e.enabled !== false &&
      !isTemporalNeutral(e.type, e.params ?? {}),
  );
  if (active) return true;
  return (
    clip.keyframes?.some(
      (k) =>
        k.property.startsWith("effect.echo.") ||
        k.property.startsWith("effect.posterize-time."),
    ) ?? false
  );
}

/* -------------------------------------------------------------------------- */
/* Echo                                                                        */
/* -------------------------------------------------------------------------- */

/** Clip-local time of echo `k` (1-based) for a frame at `t`. */
export function echoSampleTime(t: number, k: number, echoTime: number): number {
  return t - k * echoTime;
}

/** Intensity of echo `k`: starting intensity times decay^k (k = 0 is the current frame). */
export function echoIntensity(k: number, startIntensity: number, decay: number): number {
  return startIntensity * Math.pow(decay, k);
}

export interface EchoSample {
  /** 1-based echo number. */
  readonly k: number;
  /** Clip-local time of the frame the echo shows, seconds. */
  readonly localTime: number;
  /** Opacity / mix weight of the echo, 0..1. */
  readonly weight: number;
}

/**
 * The echoes to draw for a frame at clip-local time `localTime` of a clip that
 * lasts `clipDuration` seconds, in the order the operator composites them.
 * Echoes that would reach before the clip's first frame or past its end show
 * nothing (there is no footage there) and are dropped, as are echoes whose
 * intensity is zero.
 */
export function planEcho(
  localTime: number,
  clipDuration: number,
  echo: ResolvedEcho,
): EchoSample[] {
  const samples: EchoSample[] = [];
  for (let k = 1; k <= echo.echoes; k++) {
    const t = echoSampleTime(localTime, k, echo.echoTime);
    if (t < -BOUNDARY_EPSILON || t > clipDuration - BOUNDARY_EPSILON) continue;
    const weight = echoIntensity(k, echo.startIntensity, echo.decay);
    if (weight <= 0) continue;
    samples.push({ k, localTime: Math.max(0, t), weight });
  }
  return echoCompositeOrder(samples, echo.operator);
}

/**
 * Composite in Front stacks the farthest echo first so the nearest ends on
 * top; every other operator walks outwards from the current frame.
 */
export function echoCompositeOrder<T extends { readonly k: number }>(
  samples: readonly T[],
  operator: EchoOperator,
): T[] {
  const ordered = [...samples].sort((a, b) => a.k - b.k);
  return operator === "composite-front" ? ordered.reverse() : ordered;
}

/** Operators that scale the current frame by the starting intensity (the composites keep it opaque). */
export function echoDimsBase(operator: EchoOperator): boolean {
  return operator !== "composite-back" && operator !== "composite-front";
}

export interface EchoPixels {
  /** Straight-alpha RGBA, 0..255. */
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly weight: number;
}

/**
 * Reference implementation of the six echo operators on straight-alpha RGBA
 * buffers of equal size. `samples` must be in compositing order (planEcho).
 *
 *  add            Porter-Duff plus, clamped: base*start + sum(w_k * echo_k)
 *  maximum        lighten blend of each echo over the result at opacity w_k
 *  minimum        darken blend, same compositing
 *  screen         screen blend, same compositing
 *  composite-back echo_k placed behind the result at opacity w_k
 *  composite-front echo_k placed over the result at opacity w_k
 *
 * Blend modes follow the W3C compositing model with separable blend functions
 * and source alpha = weight * echo alpha; this is also exactly what the
 * Canvas2D composite operations draw.
 */
export function compositeEchoReference(
  base: Uint8ClampedArray | Uint8Array,
  samples: readonly EchoPixels[],
  echo: Pick<ResolvedEcho, "operator" | "startIntensity">,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length);
  const dim = echoDimsBase(echo.operator) ? echo.startIntensity : 1;
  const op = echo.operator;
  for (let i = 0; i < base.length; i += 4) {
    let cr = (base[i] / 255) * dim;
    let cg = (base[i + 1] / 255) * dim;
    let cb = (base[i + 2] / 255) * dim;
    let ca = base[i + 3] / 255;
    for (const sample of samples) {
      const sr = sample.data[i] / 255;
      const sg = sample.data[i + 1] / 255;
      const sb = sample.data[i + 2] / 255;
      const as = (sample.data[i + 3] / 255) * sample.weight;
      let nr: number;
      let ng: number;
      let nb: number;
      let na: number;
      if (op === "add") {
        // Premultiplied sum, clamped.
        na = Math.min(1, ca + as);
        const pr = Math.min(1, cr * ca + sr * as);
        const pg = Math.min(1, cg * ca + sg * as);
        const pb = Math.min(1, cb * ca + sb * as);
        nr = na > 0 ? pr / na : 0;
        ng = na > 0 ? pg / na : 0;
        nb = na > 0 ? pb / na : 0;
      } else if (op === "composite-back") {
        na = ca + as * (1 - ca);
        nr = na > 0 ? (ca * cr + (1 - ca) * as * sr) / na : 0;
        ng = na > 0 ? (ca * cg + (1 - ca) * as * sg) / na : 0;
        nb = na > 0 ? (ca * cb + (1 - ca) * as * sb) / na : 0;
      } else if (op === "composite-front") {
        na = as + ca * (1 - as);
        nr = na > 0 ? (as * sr + (1 - as) * ca * cr) / na : 0;
        ng = na > 0 ? (as * sg + (1 - as) * ca * cg) / na : 0;
        nb = na > 0 ? (as * sb + (1 - as) * ca * cb) / na : 0;
      } else {
        na = as + ca * (1 - as);
        const blend = (b: number, s: number): number =>
          op === "maximum"
            ? Math.max(b, s)
            : op === "minimum"
              ? Math.min(b, s)
              : b + s - b * s;
        const mix = (b: number, s: number): number =>
          na > 0
            ? (as * (1 - ca) * s + as * ca * blend(b, s) + (1 - as) * ca * b) / na
            : 0;
        nr = mix(cr, sr);
        ng = mix(cg, sg);
        nb = mix(cb, sb);
      }
      cr = nr;
      cg = ng;
      cb = nb;
      ca = na;
    }
    out[i] = Math.round(cr * 255);
    out[i + 1] = Math.round(cg * 255);
    out[i + 2] = Math.round(cb * 255);
    out[i + 3] = Math.round(ca * 255);
  }
  return out;
}
