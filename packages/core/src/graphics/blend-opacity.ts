/**
 * Alpha factor (0..1) a 2D overlay renderer applies for a clip's blend opacity.
 *
 * The project stores `blendOpacity` on a 0-100 scale (the inspector's Blend Opacity slider, and what the three.js
 * overlay renderer divides by 100). Clips with a non-normal blend mode are drawn by the three.js renderer, which
 * applies the opacity itself, so the 2D renderers only apply it for normal blending (no double application).
 */
export function overlayBlendAlpha(clip: { readonly blendMode?: string; readonly blendOpacity?: number }): number {
  if (clip.blendOpacity === undefined || !Number.isFinite(clip.blendOpacity)) return 1;
  if (clip.blendMode && clip.blendMode !== "normal") return 1;
  return Math.max(0, Math.min(1, clip.blendOpacity / 100));
}
