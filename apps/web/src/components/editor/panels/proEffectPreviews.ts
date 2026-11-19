import type { CSSProperties } from "react";
import { PRO_EFFECT_SPECS, PRO_EFFECT_TYPES, type ProEffectType } from "@openreel/core";
import type { EditorEffectPreviewDef } from "./EffectsTransitionsPanel";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** CSS approximations animated over progress p in [0, 1]; the real pixels come from the core shaders. */
const PREVIEW_STYLES: Record<ProEffectType, (p: number) => CSSProperties> = {
  mosaic: (p) => ({
    filter: `contrast(${lerp(1, 1.15, p)}) saturate(${lerp(1, 1.2, p)})`,
    imageRendering: "pixelated",
    transform: `scale(${lerp(1, 1.04, p)})`,
  }),
  posterize: (p) => ({
    filter: `contrast(${lerp(1, 1.8, p)}) saturate(${lerp(1, 1.6, p)})`,
  }),
  mirror: (p) => ({ transform: `scaleX(${p > 0.5 ? -1 : 1})` }),
  "lens-distortion": (p) => ({
    transform: `scale(${lerp(1, 1.1, p)})`,
    borderRadius: `${lerp(0, 24, p)}%`,
  }),
  "directional-blur": (p) => ({
    filter: `blur(${lerp(0, 3, p)}px)`,
    transform: `translateX(${lerp(0, 4, p)}px)`,
  }),
  "find-edges": (p) => ({
    filter: `grayscale(${p}) contrast(${lerp(1, 3, p)}) invert(${p})`,
  }),
  emboss: (p) => ({
    filter: `grayscale(${p}) contrast(${lerp(1, 2, p)})`,
  }),
  exposure: (p) => ({
    filter: `brightness(${lerp(0.9, 1.5, p)}) contrast(${lerp(1, 1.05, p)})`,
  }),
  threshold: (p) => ({ filter: `grayscale(1) contrast(${lerp(1, 50, p)})` }),
  halftone: (p) => ({
    filter: `contrast(${lerp(1, 1.6, p)}) saturate(${lerp(1, 1.3, p)})`,
    backgroundImage:
      "radial-gradient(circle, rgba(0,0,0,0.45) 1px, transparent 1.5px)",
    backgroundSize: "4px 4px",
  }),
  "vhs-glitch": (p) => ({
    filter: `saturate(${lerp(1, 1.3, p)}) contrast(${lerp(1, 1.1, p)})`,
    textShadow: `${lerp(0, 3, p)}px 0 red, ${lerp(0, -3, p)}px 0 cyan`,
    backgroundImage:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0, rgba(0,0,0,0.25) 1px, transparent 1px, transparent 3px)",
  }),
  "unsharp-mask": (p) => ({
    filter: `contrast(${lerp(1, 1.3, p)}) saturate(${lerp(1, 1.1, p)})`,
  }),
  "gaussian-blur": (p) => ({ filter: `blur(${lerp(0, 4, p)}px)` }),
  crop: (p) => ({
    clipPath: `inset(${lerp(0, 12, p)}% ${lerp(0, 12, p)}% ${lerp(0, 12, p)}% ${lerp(0, 12, p)}%)`,
  }),
  vibrance: (p) => ({ filter: `saturate(${lerp(1, 1.6, p)})` }),
  skew: (p) => ({ transform: `skewX(${lerp(0, -14, p)}deg)` }),
  "hsl-secondary": (p) => ({ filter: `saturate(${lerp(1, 0.4, p)})` }),
  "camera-blur": (p) => ({ filter: `blur(${lerp(0, 3.5, p)}px) brightness(${lerp(1, 1.08, p)})` }),
  "channel-blur": (p) => ({
    filter: `blur(${lerp(0, 2, p)}px)`,
    textShadow: `${lerp(0, 3, p)}px 0 rgba(255,0,0,0.6)`,
  }),
  "tilt-shift": (p) => ({
    filter: `saturate(${lerp(1, 1.4, p)}) contrast(${lerp(1, 1.1, p)})`,
    maskImage: `linear-gradient(180deg, transparent ${lerp(0, 18, p)}%, #000 45%, #000 55%, transparent ${lerp(100, 82, p)}%)`,
  }),
  "luma-key": (p) => ({ filter: `contrast(${lerp(1, 2.4, p)}) brightness(${lerp(1, 1.25, p)})` }),
  "color-key": (p) => ({
    filter: `hue-rotate(${lerp(0, 90, p)}deg) saturate(${lerp(1, 1.5, p)})`,
    opacity: lerp(1, 0.75, p),
  }),
  "ultra-key": (p) => ({
    filter: `hue-rotate(${lerp(0, 18, p)}deg) saturate(${lerp(1, 1.3, p)})`,
    boxShadow: `inset 0 0 0 ${lerp(0, 5, p)}px rgba(34,197,94,.75)`,
  }),
  "alpha-adjust": (p) => ({ opacity: lerp(1, 0.45, p) }),
  "leave-color": (p) => ({ filter: `grayscale(${lerp(0, 0.85, p)}) contrast(${lerp(1, 1.1, p)})` }),
  "change-to-color": (p) => ({ filter: `hue-rotate(${lerp(0, 140, p)}deg) saturate(${lerp(1, 1.3, p)})` }),
  solarize: (p) => ({ filter: `invert(${lerp(0, 0.5, p)}) contrast(${lerp(1, 1.5, p)})` }),
  levels: (p) => ({ filter: `contrast(${lerp(1, 1.35, p)}) brightness(${lerp(1, 1.05, p)})` }),
  "channel-mixer": (p) => ({ filter: `hue-rotate(${lerp(0, 60, p)}deg) saturate(${lerp(1, 1.2, p)})` }),
  "tint-map": (p) => ({ filter: `sepia(${lerp(0, 0.8, p)}) hue-rotate(${lerp(0, 190, p)}deg)` }),
  spherize: (p) => ({
    transform: `scale(${lerp(1, 1.12, p)})`,
    borderRadius: `${lerp(0, 50, p)}%`,
  }),
  twirl: (p) => ({ transform: `rotate(${lerp(0, 22, p)}deg) scale(${lerp(1, 1.1, p)})` }),
  ripple: (p) => ({
    transform: `skewY(${lerp(0, 4, p)}deg)`,
    filter: `saturate(${lerp(1, 1.15, p)})`,
  }),
  "turbulent-displace": (p) => ({
    transform: `skew(${lerp(0, 3, p)}deg, ${lerp(0, -2, p)}deg)`,
    filter: `contrast(${lerp(1, 1.1, p)})`,
  }),
  offset: (p) => ({ transform: `translateX(${lerp(0, 18, p)}%)` }),
  "corner-pin": (p) => ({ transform: `perspective(120px) rotateY(${lerp(0, -22, p)}deg)` }),
  "polar-coordinates": (p) => ({
    borderRadius: `${lerp(0, 50, p)}%`,
    transform: `rotate(${lerp(0, 90, p)}deg)`,
  }),
  replicate: (p) => ({
    transform: `scale(${lerp(1, 0.5, p)})`,
    backgroundImage: "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
    backgroundSize: "50% 50%",
  }),
  "color-emboss": (p) => ({ filter: `contrast(${lerp(1, 2, p)}) saturate(${lerp(1, 1.4, p)})` }),
  noise: (p) => ({
    filter: `contrast(${lerp(1, 1.2, p)})`,
    backgroundImage: "repeating-conic-gradient(rgba(255,255,255,0.18) 0% 25%, transparent 0% 50%)",
    backgroundSize: `${lerp(8, 3, p)}px ${lerp(8, 3, p)}px`,
  }),
  "bevel-alpha": (p) => ({
    boxShadow: `inset ${lerp(0, 3, p)}px ${lerp(0, 3, p)}px 4px rgba(255,255,255,0.7), inset ${lerp(0, -3, p)}px ${lerp(0, -3, p)}px 4px rgba(0,0,0,0.6)`,
  }),
  "four-color-gradient": (p) => ({
    backgroundImage: `linear-gradient(135deg, rgba(255,60,90,${lerp(0, 0.5, p)}), rgba(40,120,255,${lerp(0, 0.5, p)}))`,
  }),
  "lens-flare": (p) => ({
    backgroundImage: `radial-gradient(circle at 72% 28%, rgba(255,240,200,${lerp(0, 0.95, p)}) 0, rgba(255,200,120,${lerp(0, 0.4, p)}) 14%, transparent 34%)`,
  }),
  "strobe-light": (p) => ({ filter: `brightness(${p > 0.5 ? 1.9 : 1})` }),
  // Stand-ins for the CSS card fallback only; the real cards render real footage frames (effect-previews).
  echo: (p) => ({
    filter: `drop-shadow(${lerp(0, -7, p)}px 0 0 rgba(255,255,255,0.35)) drop-shadow(${lerp(0, -14, p)}px 0 0 rgba(255,255,255,0.18))`,
  }),
  "posterize-time": (p) => ({ transform: `translateX(${Math.floor(p * 4) * 2 - 3}px)` }),
  grid: (p) => ({
    backgroundImage: `linear-gradient(rgba(255,255,255,${lerp(0, 0.6, p)}) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,${lerp(0, 0.6, p)}) 1px, transparent 1px)`,
    backgroundSize: "12px 12px",
  }),
};

/**
 * The browser shows one entry per concept, so these supersede the older
 * Gaussian blur / Pixelate / Mirror / Lens distort / Posterize / VHS cards.
 * The H/V qualifier is dropped from the blur label: it is the only Gaussian
 * blur listed.
 */
const LABEL_OVERRIDES: Partial<Record<ProEffectType, string>> = {
  "gaussian-blur": "Gaussian Blur",
};

/** Keep the search terms of the hidden legacy twins (Fisheye) matching. */
const DESCRIPTION_OVERRIDES: Partial<Record<ProEffectType, string>> = {
  "lens-distortion": "Barrel, pincushion or fisheye warp with zoom compensation",
};

export const PRO_EFFECT_PREVIEWS: EditorEffectPreviewDef[] = PRO_EFFECT_TYPES.map(
  (type) => {
    const spec = PRO_EFFECT_SPECS[type];
    return {
      id: `pro-${type}`,
      type,
      label: LABEL_OVERRIDES[type] ?? spec.label,
      description: DESCRIPTION_OVERRIDES[type] ?? spec.description,
      category: spec.category,
      previewStyle: PREVIEW_STYLES[type],
    };
  },
);
