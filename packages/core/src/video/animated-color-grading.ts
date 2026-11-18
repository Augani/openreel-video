import type {
  ClipColorGrading,
  ToneValues,
  VignetteValues,
} from "./color-grading-engine";
import { DEFAULT_TONE, DEFAULT_VIGNETTE } from "./color-grading-defaults";
import { keyframeEngine } from "./keyframe-engine";
import type { Clip } from "../types/timeline";
import {
  HUE_CURVE_INFO,
  HUE_CURVE_KINDS,
  createDefaultHueCurves,
  normalizeHueCurvePoints,
  type HueCurveKind,
  type HueCurvesValues,
} from "./hue-curves";

/**
 * Hue curves are keyframed per control point: `colorGrade.hueCurve.<kind>.<n>`
 * animates the output (y) of the n-th point (counted left to right) of that
 * curve. The point's x position and the number of points are not animated, so
 * a curve with keyframes keeps its point count (the editor refuses adding or
 * removing points until the curve's keyframes are removed).
 */
const HUE_CURVE_PROPERTY = /^colorGrade\.hueCurve\.(hueVsSat|hueVsHue|hueVsLuma|lumaVsSat)\.(\d+)$/;

export function hueCurvePointProperty(kind: HueCurveKind, index: number): string {
  return `colorGrade.hueCurve.${kind}.${index}`;
}

export function parseHueCurveProperty(property: string): { kind: HueCurveKind; index: number } | null {
  const match = HUE_CURVE_PROPERTY.exec(property);
  return match ? { kind: match[1] as HueCurveKind, index: Number(match[2]) } : null;
}

/** Keyframe descriptor of a hue-curve point (also served by `getStaticDescriptor`). */
export function hueCurvePointLabel(kind: HueCurveKind, index: number): string {
  return `${HUE_CURVE_INFO[kind].label} point ${index + 1}`;
}

/** True when any keyframe animates a point of this curve. */
export function hueCurveHasKeyframes(
  keyframes: readonly { property: string }[] | undefined,
  kind: HueCurveKind,
): boolean {
  return keyframes?.some((keyframe) => parseHueCurveProperty(keyframe.property)?.kind === kind) ?? false;
}

/**
 * Keyframable Basic Correction / Vignette parameters. Ids follow the existing
 * `colorGrade.*` namespace (temperature and tint already live there).
 */
export interface ColorGradeKeyframeProperty {
  readonly id: string;
  readonly label: string;
  readonly group: "tone" | "vignette";
  readonly key: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const toneProperty = (
  key: keyof ToneValues,
  label: string,
): ColorGradeKeyframeProperty => ({
  id: `colorGrade.tone.${key}`,
  label,
  group: "tone",
  key,
  defaultValue: DEFAULT_TONE[key],
  min: -1,
  max: 1,
  step: 0.01,
});

const vignetteProperty = (
  key: keyof VignetteValues,
  label: string,
  min: number,
  max: number,
): ColorGradeKeyframeProperty => ({
  id: `colorGrade.vignette.${key}`,
  label,
  group: "vignette",
  key,
  defaultValue: DEFAULT_VIGNETTE[key],
  min,
  max,
  step: 0.01,
});

export const COLOR_GRADE_KEYFRAME_PROPERTIES: readonly ColorGradeKeyframeProperty[] =
  [
    toneProperty("exposure", "Exposure"),
    toneProperty("contrast", "Contrast"),
    toneProperty("highlights", "Highlights"),
    toneProperty("shadows", "Shadows"),
    toneProperty("whites", "Whites"),
    toneProperty("blacks", "Blacks"),
    vignetteProperty("amount", "Vignette Amount", -1, 1),
    vignetteProperty("midpoint", "Vignette Midpoint", 0, 1),
    vignetteProperty("roundness", "Vignette Roundness", -1, 1),
    vignetteProperty("feather", "Vignette Feather", 0, 1),
  ];

const COLOR_GRADE_ANIMATED_IDS: ReadonlySet<string> = new Set([
  ...COLOR_GRADE_KEYFRAME_PROPERTIES.map((property) => property.id),
  "colorGrade.temperature",
  "colorGrade.tint",
]);

function isAnimatedGradeProperty(property: string): boolean {
  return COLOR_GRADE_ANIMATED_IDS.has(property) || parseHueCurveProperty(property) !== null;
}

type AnimatableGrade = Pick<
  ClipColorGrading,
  "tone" | "vignette" | "temperature" | "tint"
> & { hueCurves?: HueCurvesValues };

export function hasAnimatedColorGrading(
  clip: Partial<Pick<Clip, "keyframes">>,
): boolean {
  return (
    clip.keyframes?.some((keyframe) => isAnimatedGradeProperty(keyframe.property)) ?? false
  );
}

/**
 * The clip's colour grade at a clip-local time: the stored grade with every
 * keyframed tone / vignette / white-balance value sampled in. Returns the
 * stored grade untouched when nothing is keyframed, so static clips pay nothing.
 */
export function getAnimatedColorGrading<T extends AnimatableGrade>(
  clip: Partial<Pick<Clip, "keyframes">> & { colorGrading?: T },
  localTime: number,
): T | undefined {
  const base = clip.colorGrading;
  const keyframes = clip.keyframes;
  if (!keyframes || !hasAnimatedColorGrading(clip)) return base;

  const sampleAt = (property: string): number | undefined => {
    const group = keyframeEngine.getKeyframesForProperty(keyframes, property);
    if (group.length === 0) return undefined;
    const value = keyframeEngine.getValueAtTime(group, localTime).value;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };

  let tone: ToneValues | undefined;
  let vignette: VignetteValues | undefined;
  for (const property of COLOR_GRADE_KEYFRAME_PROPERTIES) {
    const value = sampleAt(property.id);
    if (value === undefined) continue;
    if (property.group === "tone") {
      tone ??= { ...DEFAULT_TONE, ...base?.tone };
      tone[property.key as keyof ToneValues] = value;
    } else {
      vignette ??= { ...DEFAULT_VIGNETTE, ...base?.vignette };
      vignette[property.key as keyof VignetteValues] = value;
    }
  }
  let hueCurves: HueCurvesValues | undefined;
  const hueProperties = new Set<string>();
  for (const keyframe of keyframes) if (parseHueCurveProperty(keyframe.property)) hueProperties.add(keyframe.property);
  for (const property of hueProperties) {
    const target = parseHueCurveProperty(property)!;
    const value = sampleAt(property);
    if (value === undefined) continue;
    if (!hueCurves) {
      hueCurves = createDefaultHueCurves();
      for (const kind of HUE_CURVE_KINDS) {
        const stored = base?.hueCurves?.[kind];
        if (stored) hueCurves[kind] = normalizeHueCurvePoints(stored);
      }
    }
    const point = hueCurves[target.kind][target.index];
    if (point) hueCurves[target.kind][target.index] = { x: point.x, y: Math.max(0, Math.min(1, value)) };
  }
  const temperature = sampleAt("colorGrade.temperature");
  const tint = sampleAt("colorGrade.tint");

  return {
    ...base,
    ...(tone ? { tone } : {}),
    ...(vignette ? { vignette } : {}),
    ...(hueCurves ? { hueCurves } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(tint !== undefined ? { tint } : {}),
  } as T;
}
