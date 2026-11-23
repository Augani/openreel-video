import type { PreviewEffectDef } from "./preview-engine";

/**
 * Card-scale compensation. A card is ~150 px wide, so per-pixel noise averages away: grain at its real
 * default amount reads as "no effect" there (measured: mean 1.9/255 difference from the plain footage).
 * The amount is raised so the texture survives the downscale; every other effect shows its true defaults.
 */
export const GRAIN_CARD_BOOST = 2.5;

/**
 * Card-scale compensation for the text burn-ins: at ~150 px wide a 5 % high timecode is a smudge, so the text is drawn
 * 1.8x larger, and the clip name moves to the bottom where the card's "Sample text" badge does not cover it. The
 * badge says the text is a sample; every other parameter is the real default.
 */
export const BURN_IN_CARD_SIZE_BOOST = 1.8;

export function previewParams(def: PreviewEffectDef, resolved: Record<string, unknown>): Record<string, unknown> {
  if ((def.type === "burn-in-timecode" || def.type === "burn-in-name") && typeof resolved.size === "number") {
    return {
      ...resolved,
      size: Math.min(30, resolved.size * BURN_IN_CARD_SIZE_BOOST),
      ...(def.type === "burn-in-name" ? { position: "bottom-left" } : {}),
    };
  }
  if (def.type === "grain" && typeof resolved.amount === "number") {
    return { ...resolved, amount: Math.min(100, resolved.amount * GRAIN_CARD_BOOST) };
  }
  return resolved;
}

/**
 * Blend progress of a transition card's poster. Mid-way (0.5) is right for blends and wipes, but the dips
 * are solid black / white there (the outgoing shot has already faded out), so they rest earlier, while both
 * the dimmed outgoing shot and the colour are still visible. Hover still sweeps the whole 0..1 range.
 */
export const DIP_POSTER_PROGRESS = 0.3;
export const FLARE_POSTER_PROGRESS = 0.18;
export const FLIP_POSTER_PROGRESS = 0.15;
export const SPIN_POSTER_PROGRESS = 0.09;
export const FLIP_OVER_POSTER_PROGRESS = 0.2;
export function transitionPosterProgress(def: PreviewEffectDef): number {
  switch (def.type) {
    case "dipToBlack":
    case "dipToWhite":
      return DIP_POSTER_PROGRESS;
    // Flash / burn / leak peak at the cut (a solid flare); earlier the flare builds over the outgoing shot.
    case "flash":
    case "filmBurn":
      return FLARE_POSTER_PROGRESS;
    // Edge-on at the middle of the flip, a sliver at 0.3: rest early, while the outgoing card is still wide
    // enough to read as footage turning about its axis.
    case "flip":
      return FLIP_POSTER_PROGRESS;
    // The perspective card is edge-on (nothing on screen) at the half way point: rest while the outgoing side is still wide.
    case "flipOver":
      return FLIP_OVER_POSTER_PROGRESS;
    // A half turn (0.5) is the same still clockwise and counter-clockwise, and by 0.3 the outgoing shot is a
    // small faded tilted tile: rest while it is still large and clearly turned.
    case "spin":
      return SPIN_POSTER_PROGRESS;
    // A clock sweep at the half is a straight vertical edge, i.e. Wipe Right. A third of the way it is a wedge.
    case "radialWipe":
      return 0.35;
    case "crossfade":
      // Eased dissolves are mostly one shot at 0.5; pick the point where the eased mix is about half and half.
      if (def.params?.curve === "ease-out") return 0.3;
      if (def.params?.curve === "ease-in") return 0.7;
      return 0.5;
    default:
      return 0.5;
  }
}

/**
 * Effects whose result cannot be judged from a single default render of plain footage get an honest
 * badge on the card instead of silently looking like the source.
 */
export function previewNote(def: PreviewEffectDef): string | null {
  // Morph Cut analyses the two clips it is applied to; a card has no pair of related shots, so it previews as a dissolve.
  if (def.kind === "transition") return def.type === "morphCut" ? "Needs analysis" : null;
  switch (def.type) {
    case "chromaKey":
    case "ultra-key":
      return "Sample key";
    case "stabilize":
      return "Needs analysis";
    // A held frame is indistinguishable from the source in a still: the card shows it as it plays.
    case "posterize-time":
      return "Hover to play";
    case "burn-in-timecode":
    case "burn-in-name":
      return "Sample text";
    default:
      return null;
  }
}

/** Distance in RGB (0..1) under which a pixel counts as the default green key colour. */
const GREEN_KEY_DISTANCE = 0.45;

export interface KeyColor {
  r: number;
  g: number;
  b: number;
}

/**
 * The colour a chroma-key card removes from `rgba` (a small downscale of the footage, 0..255 RGBA):
 * the default green when the footage has a green screen, otherwise the footage's dominant saturated hue,
 * otherwise (grey footage) its average colour, so the card always demonstrates a real key on real pixels.
 */
export function pickSampleKeyColor(rgba: Uint8ClampedArray | Uint8Array): KeyColor {
  const pixels = rgba.length / 4;
  if (pixels === 0) return { r: 0, g: 1, b: 0 };
  const BUCKETS = 12;
  const counts = new Array<number>(BUCKETS).fill(0);
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
  let greenish = 0;
  let total = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    total = [total[0] + r, total[1] + g, total[2] + b];
    if (Math.hypot(r, g - 1, b) < GREEN_KEY_DISTANCE) greenish++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (max < 0.2 || chroma / (max || 1) < 0.3) continue;
    let hue: number;
    if (max === r) hue = ((g - b) / chroma + 6) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    const bucket = Math.min(BUCKETS - 1, Math.floor((hue / 6) * BUCKETS));
    counts[bucket]++;
    sums[bucket][0] += r;
    sums[bucket][1] += g;
    sums[bucket][2] += b;
  }
  if (greenish / pixels >= 0.03) return { r: 0, g: 1, b: 0 };
  let best = 0;
  for (let bucket = 1; bucket < BUCKETS; bucket++) if (counts[bucket] > counts[best]) best = bucket;
  if (counts[best] / pixels >= 0.03) {
    const n = counts[best];
    return { r: sums[best][0] / n, g: sums[best][1] / n, b: sums[best][2] / n };
  }
  return { r: total[0] / pixels, g: total[1] / pixels, b: total[2] / pixels };
}

/**
 * The effects a look card renders: exactly the params "apply" writes. The card-scale grain boost belongs to
 * single-effect cards only; a look must not show more grain than applying it gives.
 */
export function lookEffectsFor(def: PreviewEffectDef): Array<{ id: string; type: string; enabled: true; params: Record<string, unknown> }> {
  return (def.effects ?? []).map((effect, index) => ({
    id: `look-preview-${index}`,
    type: effect.type,
    enabled: true,
    params: { ...effect.params },
  }));
}
