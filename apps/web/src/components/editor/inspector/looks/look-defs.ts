import { lutToJson, type ClipColorGrading } from "@openreel/core";
import type { ColorGradingSettings } from "../../../../bridges/effects-bridge";
import type { PreviewEffectDef } from "../../panels/effect-previews/preview-engine";

const MAX_DEFS = 256;
const defs = new Map<string, PreviewEffectDef>();

/** Stable def per id so a card does not re-render its preview, bounded so imported/deleted LUTs and looks cannot pile up. */
export function memoLookDef(id: string, make: () => PreviewEffectDef): PreviewEffectDef {
  const hit = defs.get(id);
  if (hit) {
    defs.delete(id);
    defs.set(id, hit);
    return hit;
  }
  const def = make();
  defs.set(id, def);
  while (defs.size > MAX_DEFS) {
    const oldest = defs.keys().next().value;
    if (oldest === undefined) break;
    defs.delete(oldest);
  }
  return def;
}

export function lookDefCacheSize(): number {
  return defs.size;
}

function lutSignature(lut: { size?: number; data?: ArrayLike<number>; intensity?: number }): string {
  const data = lut.data ?? [];
  const step = Math.max(1, Math.floor(data.length / 64));
  let sum = 0;
  for (let i = 0; i < data.length; i += step) sum = (sum * 31 + Math.round((data[i] ?? 0) * 1000)) % 1_000_003;
  return `${lut.size ?? 0}:${data.length}:${lut.intensity ?? 1}:${sum}`;
}

/** Content signature of a grade (LUT tables sampled), so a card def changes only when the clip's grade really changes. */
export function gradeSignature(grading: ColorGradingSettings | ClipColorGrading | null | undefined): string {
  if (!grading) return "none";
  return JSON.stringify(grading, (key, value) =>
    (key === "lut" || key === "inputLut") && value && typeof value === "object" ? lutSignature(value) : value,
  );
}

/** The store hands out runtime LUT tables; clip grades (and the renderer's grading routine) use their JSON form. */
export function settingsToClipGrading(settings: ColorGradingSettings | ClipColorGrading | undefined): ClipColorGrading {
  if (!settings) return {};
  const { lut, inputLut, ...rest } = settings as ColorGradingSettings;
  const out: ClipColorGrading = { ...(rest as ClipColorGrading) };
  if (lut) out.lut = lutToJson(lut);
  if (inputLut) out.inputLut = lutToJson(inputLut);
  return out;
}

/**
 * The grade a card renders: the clip's current grade with the card's change merged in, exactly as the apply path
 * (updateColorGrading, applyLutEntryToClips) merges it, so the card shows what applying will produce on this clip.
 * A clip's first grade uses the Premiere-order pipeline, like the store does.
 */
export function mergedPreviewGrading(
  current: ColorGradingSettings | ClipColorGrading | null | undefined,
  change: Partial<ClipColorGrading>,
): ClipColorGrading {
  const clipGrade = settingsToClipGrading(current ?? undefined);
  const base: ClipColorGrading = Object.keys(clipGrade).length > 0 ? clipGrade : { pipelineVersion: 2 };
  return { ...base, ...change };
}

export interface PreviewClipEffect {
  readonly type: string;
  readonly params: Record<string, unknown>;
}

/** The clip's enabled effects, in their stored order: what the renderer runs before the clip's grade. */
export function clipEffectsForPreview(
  effects: ReadonlyArray<{ type: string; enabled?: boolean; params: Record<string, unknown> }> | undefined,
): PreviewClipEffect[] {
  return (effects ?? []).filter((effect) => effect.enabled !== false).map((effect) => ({ type: effect.type, params: { ...effect.params } }));
}

/** Content signature of a clip's effect chain, so a card def changes only when the chain really changes. */
export function effectsSignature(effects: ReadonlyArray<PreviewClipEffect>): string {
  return effects.length === 0 ? "fx0" : `fx${effects.length}:${JSON.stringify(effects)}`;
}

/** Whether a grade does anything to the picture (an empty object, as stored for a never-graded clip, does not). */
export function hasGrade(grading: ClipColorGrading | null | undefined): grading is ClipColorGrading {
  return !!grading && Object.keys(grading).length > 0;
}

/**
 * What the clip looks like right now (its effects, then its grade): the "before" of a before / after comparison.
 */
export function currentLookDef(
  effects: ReadonlyArray<PreviewClipEffect>,
  current: ColorGradingSettings | ClipColorGrading | null | undefined,
): PreviewEffectDef {
  const grading = settingsToClipGrading(current ?? undefined);
  const graded = hasGrade(grading);
  const id = `look-before-${effectsSignature(effects)}-${gradeSignature(graded ? current : null)}`;
  return memoLookDef(id, () => ({
    id,
    kind: "look",
    type: "current",
    ...(effects.length > 0 ? { effects } : {}),
    ...(graded ? { grading } : {}),
  }));
}
