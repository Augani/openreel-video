import React, { useCallback, useMemo, useState } from "react";
import { Search } from "@/icons/lucide-compat";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import type {
  VideoEffectType,
} from "../../../bridges/effects-bridge";
import type { Clip, TransitionType } from "@openreel/core";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { serializeEditorEffectDropPayload } from "../timeline/effect-drop";
import { t as ti } from "../../../i18n";
import { useTranslation } from "react-i18next";

// ─── Effect & Transition catalogs ──────────────────────────────────
// Each item ships with a small CSS recipe used to animate the live
// preview thumbnail. The thumbnail itself comes from the user's
// currently-selected clip when available, falling back to a gradient.

export type EffectCategory =
  | "Basic"
  | "Color"
  | "Blur"
  | "Creative"
  | "Stylize";
type EffectCategoryFilter = "All" | EffectCategory;

export interface EditorEffectPreviewDef {
  id?: string;
  type: VideoEffectType;
  label: string;
  description: string;
  category: EffectCategory;
  params?: Record<string, unknown>;
  /** Returns a CSS filter / transform / opacity string for the preview
   *  given an animation progress p in [0, 1] (or a paused 0.5 hover state). */
  previewStyle: (p: number) => React.CSSProperties;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const EDITOR_EFFECT_PREVIEWS: EditorEffectPreviewDef[] = [
  {
    type: "brightness",
    label: "Brightness",
    description: "Lift midtones and highlights",
    category: "Basic",
    previewStyle: (p) => ({ filter: `brightness(${lerp(0.9, 1.6, p)})` }),
  },
  {
    type: "contrast",
    label: "Contrast",
    description: "Punchier shadows and highlights",
    category: "Basic",
    previewStyle: (p) => ({ filter: `contrast(${lerp(0.8, 1.8, p)})` }),
  },
  {
    type: "saturation",
    label: "Saturation",
    description: "Boost or mute color intensity",
    category: "Basic",
    previewStyle: (p) => ({ filter: `saturate(${lerp(0.5, 2.0, p)})` }),
  },
  {
    type: "grayscale",
    label: "Grayscale",
    description: "Convert color to monochrome",
    category: "Color",
    previewStyle: (p) => ({ filter: `grayscale(${p})` }),
  },
  {
    type: "sepia",
    label: "Sepia",
    description: "Warm vintage color treatment",
    category: "Color",
    previewStyle: (p) => ({ filter: `sepia(${p})` }),
  },
  {
    type: "invert",
    label: "Invert",
    description: "Reverse image color values",
    category: "Creative",
    previewStyle: (p) => ({ filter: `invert(${p})` }),
  },
  {
    type: "tonal",
    label: "Tonal Balance",
    description: "Shape shadows, mids, and highlights",
    category: "Basic",
    previewStyle: (p) => ({
      filter: `brightness(${lerp(0.92, 1.14, p)}) contrast(${lerp(0.9, 1.35, p)})`,
    }),
  },
  {
    type: "temperature",
    label: "Temperature",
    description: "Warm / cool color shift",
    category: "Color",
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.6, p)}) hue-rotate(${lerp(-12, 12, p)}deg)`,
    }),
  },
  {
    type: "tint",
    label: "Tint",
    description: "Magenta / green color shift",
    category: "Color",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 60, p)}deg)`,
    }),
  },
  {
    type: "hue",
    label: "Hue",
    description: "Rotate the color wheel",
    category: "Color",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 360, p)}deg)`,
    }),
  },
  {
    type: "blur",
    label: "Blur",
    description: "Soft gaussian defocus",
    category: "Blur",
    previewStyle: (p) => ({ filter: `blur(${lerp(0, 6, p)}px)` }),
  },
  {
    type: "motion-blur",
    label: "Motion Blur",
    description: "Directional smear",
    category: "Blur",
    previewStyle: (p) => ({
      filter: `blur(${lerp(0, 3, p)}px)`,
      transform: `translateX(${lerp(0, 6, p)}px)`,
    }),
  },
  {
    type: "radial-blur",
    label: "Radial Blur",
    description: "Zoom-style radial motion",
    category: "Blur",
    previewStyle: (p) => ({
      filter: `blur(${lerp(0, 4, p)}px)`,
      transform: `scale(${lerp(1, 1.12, p)})`,
    }),
  },
  {
    type: "sharpen",
    label: "Sharpen",
    description: "Unsharp-mask edge enhance",
    category: "Creative",
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.4, p)}) brightness(${lerp(1, 1.05, p)})`,
    }),
  },
  {
    type: "vignette",
    label: "Vignette",
    description: "Darkened edges for focus",
    category: "Creative",
    previewStyle: (p) => ({
      boxShadow: `inset 0 0 ${lerp(0, 50, p)}px ${lerp(0, 25, p)}px rgba(0,0,0,0.65)`,
    }),
  },
  {
    type: "grain",
    label: "Film Grain",
    description: "Analog film texture",
    category: "Creative",
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.1, p)})`,
      opacity: lerp(1, 0.92, p),
    }),
  },
  {
    type: "shadow",
    label: "Drop Shadow",
    description: "Cast a soft shadow",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `drop-shadow(${lerp(0, 4, p)}px ${lerp(0, 4, p)}px ${lerp(0, 8, p)}px rgba(0,0,0,0.6))`,
    }),
  },
  {
    type: "glow",
    label: "Glow",
    description: "Bright outer halo",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 1.15, p)}) drop-shadow(0 0 ${lerp(0, 12, p)}px var(--accent))`,
    }),
  },
  {
    type: "chromatic-aberration",
    label: "Chromatic Aberration",
    description: "RGB-channel split offset",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 6, p)}deg)`,
      textShadow: `${lerp(0, 2, p)}px 0 red, ${lerp(0, -2, p)}px 0 cyan`,
    }),
  },
  {
    type: "chromaKey",
    label: "Chroma Key",
    description: "Remove green or blue screen backgrounds",
    category: "Stylize",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 18, p)}deg) saturate(${lerp(1, 1.35, p)})`,
      boxShadow: `inset 0 0 0 ${lerp(0, 5, p)}px rgba(34,197,94,.75)`,
    }),
  },
  {
    id: "cinematic-punch",
    type: "contrast",
    label: "Cinematic Punch",
    description: "Bold contrast for high-impact edits",
    category: "Basic",
    params: { value: 1.35 },
    previewStyle: (p) => ({ filter: `contrast(${lerp(1, 1.35, p)})` }),
  },
  {
    id: "golden-hour",
    type: "temperature",
    label: "Golden Hour",
    description: "Warm sunlit color treatment",
    category: "Color",
    params: { value: 35 },
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.48, p)}) saturate(${lerp(1, 1.22, p)})`,
    }),
  },
  {
    id: "soft-focus",
    type: "blur",
    label: "Soft Focus",
    description: "Gentle diffusion for portraits and titles",
    category: "Blur",
    params: { radius: 12, type: "gaussian" },
    previewStyle: (p) => ({ filter: `blur(${lerp(0, 4, p)}px)` }),
  },
  {
    id: "dream-bloom",
    type: "glow",
    label: "Dream Bloom",
    description: "Soft lavender halo and highlight bloom",
    category: "Stylize",
    params: { radius: 28, intensity: 1.25, color: "#c4b5fd" },
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 1.15, p)}) drop-shadow(0 0 ${lerp(0, 16, p)}px #c4b5fd)`,
    }),
  },
  {
    id: "retro-grain",
    type: "grain",
    label: "Retro Grain",
    description: "Fine monochrome texture for vintage edits",
    category: "Creative",
    params: { amount: 0.18, size: 0.7, roughness: 0.65, colored: false },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.12, p)}) grayscale(${lerp(0, 0.15, p)})`,
    }),
  },
  {
    id: "rgb-split",
    type: "chromatic-aberration",
    label: "RGB Split",
    description: "Strong channel separation for digital cuts",
    category: "Stylize",
    params: { amount: 12, angle: 0 },
    previewStyle: (p) => ({
      textShadow: `${lerp(0, 4, p)}px 0 red, ${lerp(0, -4, p)}px 0 cyan`,
    }),
  },
  {
    id: "shader-vhs",
    type: "shader",
    label: "VHS",
    description: "Animated tape jitter, grain, and scanlines",
    category: "Stylize",
    params: { shaderId: "vhs", intensity: 0.75, scanlines: 0.4, jitter: 0.45 },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.2, p)}) saturate(${lerp(1, 0.82, p)})`,
      transform: `translateX(${Math.sin(p * Math.PI * 8) * 2}px)`,
      boxShadow: `inset ${lerp(0, 3, p)}px 0 rgba(255,0,80,.35), inset ${lerp(0, -3, p)}px 0 rgba(0,220,255,.35)`,
    }),
  },
  {
    id: "shader-posterize",
    type: "shader",
    label: "Posterize",
    description: "Reduce footage into bold graphic color bands",
    category: "Creative",
    params: { shaderId: "posterize", levels: 5, mix: 1 },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.65, p)}) saturate(${lerp(1, 1.35, p)})`,
    }),
  },
  {
    id: "shader-duotone",
    type: "shader",
    label: "Duotone",
    description: "Map shadows and highlights to two custom colors",
    category: "Color",
    params: {
      shaderId: "duotone",
      shadowColor: "#11133f",
      highlightColor: "#ffca6b",
      mix: 0.9,
      contrast: 1.15,
    },
    previewStyle: (p) => ({
      filter: `grayscale(${p}) sepia(${p}) hue-rotate(${lerp(0, 330, p)}deg) saturate(${lerp(1, 2.2, p)})`,
    }),
  },
  {
    id: "shader-prism",
    type: "shader",
    label: "Prism Split",
    description: "Directional RGB refraction with adjustable offset",
    category: "Stylize",
    params: { shaderId: "prism", amount: 8, angle: 0, mix: 1 },
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 10, p)}deg)`,
      boxShadow: `inset ${lerp(0, 5, p)}px 0 rgba(255,40,90,.5), inset ${lerp(0, -5, p)}px 0 rgba(0,220,255,.5)`,
    }),
  },
  {
    id: "shader-fisheye",
    type: "shader",
    label: "Fisheye",
    description: "Curved lens distortion focused at frame center",
    category: "Creative",
    params: { shaderId: "fisheye", strength: 0.55, radius: 0.8 },
    previewStyle: (p) => ({
      transform: `scale(${lerp(1, 1.12, p)})`,
      borderRadius: `${lerp(0, 24, p)}%`,
    }),
  },
  {
    id: "shader-wave-warp",
    type: "shader",
    label: "Wave Warp",
    description: "Animated horizontal liquid distortion",
    category: "Creative",
    params: { shaderId: "wave-warp", amplitude: 0.025, frequency: 5, speed: 1.5 },
    previewStyle: (p) => ({
      transform: `translateX(${Math.sin(p * Math.PI * 2) * 5}px) skewY(${Math.sin(p * Math.PI * 2) * 1.5}deg)`,
    }),
  },
  {
    id: "shader-scanlines",
    type: "shader",
    label: "Scanlines",
    description: "Animated CRT line texture",
    category: "Stylize",
    params: { shaderId: "scanlines", density: 360, intensity: 0.3, speed: 0.2 },
    previewStyle: (p) => ({
      filter: `brightness(${lerp(1, 0.82, p)}) contrast(${lerp(1, 1.25, p)})`,
      backgroundImage:
        "repeating-linear-gradient(0deg,rgba(0,0,0,.35) 0 1px,transparent 1px 3px)",
    }),
  },
  {
    id: "shader-edge-glow",
    type: "shader",
    label: "Edge Glow",
    description: "Neon color traced along image detail",
    category: "Stylize",
    params: { shaderId: "edge-glow", strength: 4, radius: 1.5, color: "#4de8ff" },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.45, p)}) drop-shadow(0 0 ${lerp(0, 9, p)}px #4de8ff)`,
    }),
  },
];

export const EDITOR_EFFECT_CATEGORIES: EffectCategory[] = [
  "Basic",
  "Color",
  "Blur",
  "Creative",
  "Stylize",
];

interface TransitionDef {
  id?: string;
  type: TransitionType;
  label: string;
  description: string;
  params?: Record<string, unknown>;
  /** Render the preview as two colored panels animated according to
   *  this transition's progress p in [0, 1]. */
  renderPreview: (
    p: number,
    thumbUrl: string | null,
  ) => React.ReactElement;
}

type TransitionCategory = "Dissolves" | "Wipes" | "Movement" | "Stylized";
type TransitionCategoryFilter = "All" | TransitionCategory;

const TRANSITION_CATEGORIES: TransitionCategory[] = [
  "Dissolves",
  "Wipes",
  "Movement",
  "Stylized",
];

const transitionCategory = (type: TransitionType): TransitionCategory => {
  if (type === "crossfade" || type === "dipToBlack" || type === "dipToWhite") {
    return "Dissolves";
  }
  if (
    type === "wipe" ||
    type === "circleReveal" ||
    type === "radialWipe" ||
    type === "blinds" ||
    type === "diamondReveal" ||
    type === "splitReveal" ||
    type === "mosaic"
  ) {
    return "Wipes";
  }
  if (
    type === "slide" ||
    type === "push" ||
    type === "whipPan" ||
    type === "spin" ||
    type === "flip" ||
    type === "pageTurn"
  ) {
    return "Movement";
  }
  return "Stylized";
};

const renderThumb = (
  thumbUrl: string | null,
  style: React.CSSProperties,
  tint: string,
): React.ReactElement => (
  <div className="absolute inset-0 overflow-hidden" style={style}>
    {thumbUrl ? (
      <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
    ) : (
      <div
        className="w-full h-full"
        style={{
          background: `linear-gradient(135deg, ${tint}, oklch(0.45 0.12 200))`,
        }}
      />
    )}
  </div>
);

const TRANSITIONS: TransitionDef[] = [
  {
    type: "crossfade",
    label: "Crossfade",
    description: "Smooth opacity blend",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "dipToBlack",
    label: "Dip to Black",
    description: "Fade through black",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: p < 0.5 ? 1 - p * 2 : 0 }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p >= 0.5 ? (p - 0.5) * 2 : 0 }, "oklch(0.72 0.16 162)")}
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: p < 0.5 ? p * 2 : (1 - p) * 2 }}
        />
      </>
    ),
  },
  {
    type: "dipToWhite",
    label: "Dip to White",
    description: "Fade through white",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: p < 0.5 ? 1 - p * 2 : 0 }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p >= 0.5 ? (p - 0.5) * 2 : 0 }, "oklch(0.72 0.16 162)")}
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{ opacity: p < 0.5 ? p * 2 : (1 - p) * 2 }}
        />
      </>
    ),
  },
  {
    type: "wipe",
    label: "Wipe",
    description: "Hard edge sweeps across",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { clipPath: `inset(0 ${p * 100}% 0 0)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  ...([
    { id: "wipe-left", label: "Wipe Left", direction: "left" },
    { id: "wipe-right", label: "Wipe Right", direction: "right" },
    { id: "wipe-up", label: "Wipe Up", direction: "up" },
    { id: "wipe-down", label: "Wipe Down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "wipe",
    label,
    description: `Directional ${direction} reveal`,
    params: { direction, softness: 0 },
    renderPreview: (p, thumb) => {
      const incomingClip =
        direction === "left"
          ? `inset(0 ${(1 - p) * 100}% 0 0)`
          : direction === "right"
            ? `inset(0 0 0 ${(1 - p) * 100}%)`
            : direction === "up"
              ? `inset(0 0 ${(1 - p) * 100}% 0)`
              : `inset(${(1 - p) * 100}% 0 0 0)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { clipPath: incomingClip },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  {
    type: "slide",
    label: "Slide",
    description: "New clip slides in",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { transform: `translateX(${-p * 100}%)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { transform: `translateX(${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  ...([
    { id: "slide-left", label: "Slide Left", direction: "left" },
    { id: "slide-right", label: "Slide Right", direction: "right" },
    { id: "slide-up", label: "Slide Up", direction: "up" },
    { id: "slide-down", label: "Slide Down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "slide",
    label,
    description: `Slide the next clip ${direction}`,
    params: { direction },
    renderPreview: (p, thumb) => {
      const transform =
        direction === "left"
          ? `translateX(${(1 - p) * 100}%)`
          : direction === "right"
            ? `translateX(${-(1 - p) * 100}%)`
            : direction === "up"
              ? `translateY(${(1 - p) * 100}%)`
              : `translateY(${-(1 - p) * 100}%)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { transform },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  {
    type: "push",
    label: "Push",
    description: "Outgoing clip is shoved off",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { transform: `translateX(${-p * 100}%)` }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { transform: `translateX(${(1 - p) * 100}%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "zoom",
    label: "Zoom",
    description: "Scale up and dissolve",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          { transform: `scale(${1 + p * 1.5})`, opacity: 1 - p },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          { transform: `scale(${1.5 - p * 0.5})`, opacity: p },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  {
    type: "circleReveal",
    label: "Circle Reveal",
    description: "Iris reveal from the center",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { clipPath: `circle(${p * 75}% at 50% 50%)` }, "oklch(0.72 0.16 162)")}
      </>
    ),
  },
  {
    type: "blur",
    label: "Blur Dissolve",
    description: "Blur out and into the next clip",
    renderPreview: (p, thumb) => {
      const b = Math.sin(p * Math.PI) * 6;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p, filter: `blur(${b}px)` }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p, filter: `blur(${b}px)` }, "oklch(0.72 0.16 162)")}
        </>
      );
    },
  },
  {
    type: "whipPan",
    label: "Whip Pan",
    description: "Fast motion-blurred pan",
    renderPreview: (p, thumb) => {
      const b = Math.sin(p * Math.PI) * 8;
      return (
        <>
          {renderThumb(
            thumb,
            { transform: `translateX(${-p * 100}%)`, filter: `blur(${b}px)` },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { transform: `translateX(${(1 - p) * 100}%)`, filter: `blur(${b}px)` },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "radialWipe",
    label: "Radial Wipe",
    description: "Clock-style angular sweep",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            maskImage: `conic-gradient(from -90deg, #000 ${p * 360}deg, transparent 0deg)`,
            WebkitMaskImage: `conic-gradient(from -90deg, #000 ${p * 360}deg, transparent 0deg)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  {
    type: "pixelate",
    label: "Pixelate",
    description: "Break the cut into a chunky pixel mosaic",
    params: { maxPixelSize: 48 },
    renderPreview: (p, thumb) => {
      const block = 2 + Math.round(Math.sin(p * Math.PI) * 12);
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay"
            style={{
              backgroundImage:
                "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
              backgroundSize: `${block}px ${block}px`,
            }}
          />
        </>
      );
    },
  },
  {
    type: "glitch",
    label: "Glitch Cut",
    description: "Digital slice displacement at the cut",
    params: { intensity: 0.08, slices: 12 },
    renderPreview: (p, thumb) => {
      const amount = Math.sin(p * Math.PI) * 12;
      return (
        <>
          {renderThumb(
            thumb,
            {
              opacity: 1 - p * 0.65,
              transform: `translateX(${-amount}px)`,
              filter: `hue-rotate(${-amount * 2}deg)`,
            },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            {
              opacity: p,
              transform: `translateX(${amount}px)`,
              clipPath:
                "polygon(0 0,100% 0,100% 18%,0 18%,0 30%,100% 30%,100% 48%,0 48%,0 62%,100% 62%,100% 82%,0 82%)",
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "blinds",
    label: "Venetian Blinds",
    description: "Reveal the next shot through repeating slats",
    params: { count: 8, direction: "vertical" },
    renderPreview: (p, thumb) => {
      const open = Math.max(0.5, p * 12);
      const mask = `repeating-linear-gradient(90deg,#000 0 ${open}px,transparent ${open}px 12px)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            { maskImage: mask, WebkitMaskImage: mask },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "diamondReveal",
    label: "Diamond Reveal",
    description: "Geometric iris expanding from the center",
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            clipPath: `polygon(50% ${50 - p * 70}%, ${50 + p * 70}% 50%, 50% ${50 + p * 70}%, ${50 - p * 70}% 50%)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  },
  ...([
    { id: "spin-clockwise", label: "Spin Clockwise", rotations: 1 },
    { id: "spin-counter", label: "Spin Counterclockwise", rotations: -1 },
  ] as const).map<TransitionDef>(({ id, label, rotations }) => ({
    id,
    type: "spin",
    label,
    description: ti("Rotating scale transition with a smooth handoff"),
    params: { rotations },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          {
            opacity: 1 - p,
            transform: `rotate(${rotations * p * 360}deg) scale(${1 - p * 0.75})`,
          },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          {
            opacity: p,
            transform: `rotate(${rotations * (p - 1) * 360}deg) scale(${0.25 + p * 0.75})`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  ...([
    { id: "flip-horizontal", label: "Flip Horizontal", axis: "horizontal" },
    { id: "flip-vertical", label: "Flip Vertical", axis: "vertical" },
  ] as const).map<TransitionDef>(({ id, label, axis }) => ({
    id,
    type: "flip",
    label,
    description: `Card-style ${axis} flip between shots`,
    params: { axis },
    renderPreview: (p, thumb) => {
      const firstHalf = p < 0.5;
      const phase = firstHalf ? 1 - p * 2 : (p - 0.5) * 2;
      const transform =
        axis === "horizontal" ? `scaleX(${phase})` : `scaleY(${phase})`;
      return renderThumb(
        thumb,
        { transform },
        firstHalf ? "oklch(0.55 0.14 295)" : "oklch(0.72 0.16 162)",
      );
    },
  })),
  ...([
    { id: "split-horizontal", label: "Split Horizontal", orientation: "horizontal" },
    { id: "split-vertical", label: "Split Vertical", orientation: "vertical" },
  ] as const).map<TransitionDef>(({ id, label, orientation }) => ({
    id,
    type: "splitReveal",
    label,
    description: `Reveal the next shot outward from the ${orientation === "horizontal" ? "center line" : "middle"}`,
    params: { orientation },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
        {renderThumb(
          thumb,
          {
            clipPath:
              orientation === "horizontal"
                ? `inset(0 ${50 - p * 50}% 0 ${50 - p * 50}%)`
                : `inset(${50 - p * 50}% 0 ${50 - p * 50}% 0)`,
          },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  {
    id: "flash-cut",
    type: "flash",
    label: "Flash Cut",
    description: "High-energy white flash through the edit",
    params: { intensity: 1 },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
        {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
        <div
          className="pointer-events-none absolute inset-0 bg-white"
          style={{ opacity: Math.sin(p * Math.PI) }}
        />
      </>
    ),
  },
  ...([
    {
      id: "film-burn",
      label: "Film Burn",
      description: "Warm analog light leak through the edit",
      intensity: 1,
      warmth: 0.75,
      gradient:
        "linear-gradient(110deg, rgb(255 40 0), rgb(255 170 20) 48%, rgb(255 245 210))",
    },
    {
      id: "film-burn-red",
      label: "Red Film Burn",
      description: "Dense red-orange flare for dramatic cuts",
      intensity: 1.3,
      warmth: 1,
      gradient:
        "linear-gradient(105deg, rgb(125 0 0), rgb(255 35 0) 45%, rgb(255 210 80))",
    },
    {
      id: "light-leak-cool",
      label: "Cool Light Leak",
      description: "Blue-white optical flare through the edit",
      intensity: 0.9,
      warmth: 0,
      gradient:
        "linear-gradient(110deg, rgb(15 65 255), rgb(65 220 255) 48%, rgb(245 250 255))",
    },
  ] as const).map<TransitionDef>(
    ({ id, label, description, intensity, warmth, gradient }) => ({
      id,
      type: "filmBurn",
      label,
      description,
      params: { intensity, warmth },
      renderPreview: (p, thumb) => {
      const burn = Math.sin(p * Math.PI);
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: burn,
              background: gradient,
              mixBlendMode: "screen",
            }}
          />
        </>
      );
    },
    }),
  ),
  {
    type: "mosaic",
    label: "Mosaic Reveal",
    description: "Tiles assemble the next shot in a shuffled pattern",
    params: { tiles: 8, randomness: 0.85 },
    renderPreview: (p, thumb) => {
      const tileSize = 12;
      const cutoff = Math.round(p * 100);
      const mask = `linear-gradient(135deg, #000 ${cutoff}%, transparent ${cutoff + 18}%)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            {
              maskImage: mask,
              WebkitMaskImage: mask,
              backgroundSize: `${tileSize}px ${tileSize}px`,
              imageRendering: "pixelated",
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  {
    type: "ripple",
    label: "Ripple",
    description: "A fluid wave distorts both shots through the cut",
    params: { amplitude: 0.04, waves: 3 },
    renderPreview: (p, thumb) => {
      const wave = Math.sin(p * Math.PI) * 6;
      return (
        <>
          {renderThumb(
            thumb,
            { opacity: 1 - p, transform: `translateX(${-wave}px) skewY(${wave * 0.25}deg)` },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { opacity: p, transform: `translateX(${wave}px) skewY(${-wave * 0.25}deg)` },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  },
  ...([
    { id: "page-turn-left", label: "Page Turn Left", direction: "left" },
    { id: "page-turn-right", label: "Page Turn Right", direction: "right" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "pageTurn",
    label,
    description: `Fold the outgoing shot toward the ${direction}`,
    params: { direction, shadow: 0.55 },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(thumb, {}, "oklch(0.72 0.16 162)")}
        {renderThumb(
          thumb,
          {
            transform: `scaleX(${1 - p})`,
            transformOrigin: direction === "left" ? "left center" : "right center",
            filter: `brightness(${1 - Math.sin(p * Math.PI) * 0.25})`,
          },
          "oklch(0.55 0.14 295)",
        )}
      </>
    ),
  })),
  {
    type: "colorSplit",
    label: "Color Split",
    description: "Prismatic channel ghosts collide at the edit",
    params: { maxOffset: 18, angle: 0 },
    renderPreview: (p, thumb) => {
      const offset = Math.sin(p * Math.PI) * 7;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - p }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: p }, "oklch(0.72 0.16 162)")}
          <div
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              transform: `translateX(${offset}px)`,
              background: "linear-gradient(90deg,rgba(255,0,80,.5),transparent 45%,rgba(0,220,255,.55))",
              opacity: Math.sin(p * Math.PI) * 0.7,
            }}
          />
        </>
      );
    },
  },
  ...([
    {
      id: "crossfade-linear",
      label: "Linear Dissolve",
      description: "Constant-speed opacity blend",
      curve: "linear",
    },
    {
      id: "crossfade-ease-in",
      label: "Slow In Dissolve",
      description: "Blend accelerates into the cut",
      curve: "ease-in",
    },
    {
      id: "crossfade-ease-out",
      label: "Slow Out Dissolve",
      description: "Blend settles gently after the cut",
      curve: "ease-out",
    },
  ] as const).map<TransitionDef>(({ id, label, description, curve }) => ({
    id,
    type: "crossfade",
    label,
    description,
    params: { curve },
    renderPreview: (p, thumb) => {
      const eased =
        curve === "ease-in"
          ? p * p
          : curve === "ease-out"
            ? p * (2 - p)
            : p;
      return (
        <>
          {renderThumb(thumb, { opacity: 1 - eased }, "oklch(0.55 0.14 295)")}
          {renderThumb(thumb, { opacity: eased }, "oklch(0.72 0.16 162)")}
        </>
      );
    },
  })),
  ...([
    {
      id: "wipe-soft-left",
      label: "Soft Wipe Left",
      direction: "left",
      softness: 0.45,
    },
    {
      id: "wipe-soft-right",
      label: "Soft Wipe Right",
      direction: "right",
      softness: 0.45,
    },
    {
      id: "wipe-diagonal",
      label: "Diagonal Wipe",
      direction: "diagonal",
      softness: 0,
    },
  ] as const).map<TransitionDef>(({ id, label, direction, softness }) => ({
    id,
    type: "wipe",
    label,
    description:
      direction === "diagonal"
        ? "Angular reveal from the corner"
        : "Feathered directional reveal",
    params: { direction, softness },
    renderPreview: (p, thumb) => {
      const clipPath =
        direction === "right"
          ? `inset(0 0 0 ${(1 - p) * 100}%)`
          : direction === "diagonal"
            ? `polygon(0 0, ${p * 200}% 0, 0 ${p * 200}%)`
            : `inset(0 ${(1 - p) * 100}% 0 0)`;
      return (
        <>
          {renderThumb(thumb, {}, "oklch(0.55 0.14 295)")}
          {renderThumb(
            thumb,
            {
              clipPath,
              filter: softness > 0 ? "blur(1.5px)" : undefined,
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  ...([
    { id: "push-left", label: "Push Left", direction: "left" },
    { id: "push-right", label: "Push Right", direction: "right" },
    { id: "push-up", label: "Push Up", direction: "up" },
    { id: "push-down", label: "Push Down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "push",
    label,
    description: `Both clips travel ${direction}`,
    params: { direction },
    renderPreview: (p, thumb) => {
      const outgoingTransform =
        direction === "left"
          ? `translateX(${-p * 100}%)`
          : direction === "right"
            ? `translateX(${p * 100}%)`
            : direction === "up"
              ? `translateY(${-p * 100}%)`
              : `translateY(${p * 100}%)`;
      const incomingTransform =
        direction === "left"
          ? `translateX(${(1 - p) * 100}%)`
          : direction === "right"
            ? `translateX(${-(1 - p) * 100}%)`
            : direction === "up"
              ? `translateY(${(1 - p) * 100}%)`
              : `translateY(${-(1 - p) * 100}%)`;
      return (
        <>
          {renderThumb(
            thumb,
            { transform: outgoingTransform },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            { transform: incomingTransform },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
  ...([
    {
      id: "zoom-top-left",
      label: "Zoom Top Left",
      center: { x: 0.15, y: 0.15 },
    },
    {
      id: "zoom-bottom-right",
      label: "Zoom Bottom Right",
      center: { x: 0.85, y: 0.85 },
    },
    {
      id: "zoom-punch",
      label: "Punch Zoom",
      center: { x: 0.5, y: 0.5 },
    },
  ] as const).map<TransitionDef>(({ id, label, center }) => ({
    id,
    type: "zoom",
    label,
    description: ti("Focused scale-and-dissolve transition"),
    params: { scale: id === "zoom-punch" ? 3 : 2, center },
    renderPreview: (p, thumb) => (
      <>
        {renderThumb(
          thumb,
          {
            opacity: 1 - p,
            transform: `scale(${1 + p * (id === "zoom-punch" ? 2 : 1)})`,
            transformOrigin: `${center.x * 100}% ${center.y * 100}%`,
          },
          "oklch(0.55 0.14 295)",
        )}
        {renderThumb(
          thumb,
          { opacity: p },
          "oklch(0.72 0.16 162)",
        )}
      </>
    ),
  })),
  ...([
    { id: "whip-left", label: "Whip Left", direction: "left" },
    { id: "whip-right", label: "Whip Right", direction: "right" },
    { id: "whip-up", label: "Whip Up", direction: "up" },
    { id: "whip-down", label: "Whip Down", direction: "down" },
  ] as const).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "whipPan",
    label,
    description: `Motion-blurred whip ${direction}`,
    params: { direction },
    renderPreview: (p, thumb) => {
      const axis = direction === "left" || direction === "right" ? "X" : "Y";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      const blur = Math.sin(p * Math.PI) * 8;
      return (
        <>
          {renderThumb(
            thumb,
            {
              transform: `translate${axis}(${sign * p * 100}%)`,
              filter: `blur(${blur}px)`,
            },
            "oklch(0.55 0.14 295)",
          )}
          {renderThumb(
            thumb,
            {
              transform: `translate${axis}(${-sign * (1 - p) * 100}%)`,
              filter: `blur(${blur}px)`,
            },
            "oklch(0.72 0.16 162)",
          )}
        </>
      );
    },
  })),
];

// ─── Drag payload helpers ──────────────────────────────────────────
export const EFFECT_DRAG_MIME = "application/x-openreel-effect";
export const TRANSITION_DRAG_MIME = "application/x-openreel-transition";

const PREVIEW_CYCLE_MS = 1800;

// ─── Cards ────────────────────────────────────────────────────────

const EffectCard: React.FC<{
  def: EditorEffectPreviewDef;
  thumbUrl: string | null;
  onApply: () => void;
}> = ({ def, thumbUrl, onApply }) => {
  const { t: tr } = useTranslation();
  const [progress, setProgress] = useState(0.72);
  const [isHover, setIsHover] = useState(false);
  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!isHover) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0.72);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % PREVIEW_CYCLE_MS;
      const t = elapsed / PREVIEW_CYCLE_MS;
      // Ping-pong so the effect intensifies then relaxes
      const eased = t < 0.5 ? t * 2 : (1 - t) * 2;
      setProgress(eased);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isHover]);

  const previewStyle = def.previewStyle(progress);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "copy";
      const payload = serializeEditorEffectDropPayload({
        effectType: def.type,
        effectParams: def.params,
      });
      e.dataTransfer.setData(EFFECT_DRAG_MIME, payload);
      // Fallback for browsers that don't surface custom MIME types
      e.dataTransfer.setData("text/plain", `effect:${def.type}`);
    },
    [def.params, def.type],
  );

  return (
    <ClickableCard
      label={`${def.label}. Drag onto a clip to apply, or double-click to apply to selected clip.`}
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onApply}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      padding={0}
      variant="default"
      className="group relative flex flex-col items-stretch border border-border bg-bg-2 overflow-hidden text-left cursor-grab active:cursor-grabbing hover:border-accent transition-colors"
    >
      <div
        data-effect-preview={def.id ?? def.type}
        data-preview-progress={progress.toFixed(2)}
        className="relative aspect-video bg-bg-3 overflow-hidden"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={previewStyle}
            draggable={false}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.55 0.14 295), oklch(0.72 0.16 162))",
              ...previewStyle,
            }}
          />
        )}
        <Text className="absolute bottom-1 right-1 text-[8.5px] uppercase px-1.5 py-0.5 rounded bg-black/55 text-white/85 backdrop-blur-sm">
          {def.category}
        </Text>
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <Text type="supporting" weight="bold" display="block" maxLines={1} className="text-[10.5px] text-fg leading-tight">
          {tr(def.label)}
        </Text>
        <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9.5px] text-fg-muted leading-tight mt-0.5">
          {def.description}
        </Text>
      </div>
    </ClickableCard>
  );
};

const TransitionCard: React.FC<{
  def: TransitionDef;
  thumbUrl: string | null;
  onApply: () => void;
}> = ({ def, thumbUrl, onApply }) => {
  const { t: tr } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [isHover, setIsHover] = useState(false);
  const rafRef = React.useRef<number | null>(null);
  const startRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!isHover) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % PREVIEW_CYCLE_MS;
      setProgress(elapsed / PREVIEW_CYCLE_MS);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isHover]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "copy";
      const payload = JSON.stringify({
        transitionType: def.type,
        transitionParams: def.params,
      });
      e.dataTransfer.setData(TRANSITION_DRAG_MIME, payload);
      e.dataTransfer.setData("text/plain", `transition:${def.type}`);
    },
    [def.params, def.type],
  );

  return (
    <ClickableCard
      label={`${def.label}. Drag onto a clip edge, or double-click to apply to the selected cut.`}
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onApply}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      padding={0}
      variant="default"
      className="group relative flex flex-col items-stretch border border-border bg-bg-2 overflow-hidden text-left cursor-grab active:cursor-grabbing hover:border-accent transition-colors"
    >
      <div className="relative aspect-video bg-bg-3 overflow-hidden">
        {def.renderPreview(progress, thumbUrl)}
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <Text type="supporting" weight="bold" display="block" maxLines={1} className="text-[10.5px] text-fg leading-tight">
          {tr(def.label)}
        </Text>
        <Text type="supporting" color="secondary" display="block" maxLines={1} className="text-[9.5px] text-fg-muted leading-tight mt-0.5">
          {def.description}
        </Text>
      </div>
    </ClickableCard>
  );
};

// ─── Hook: thumbnail of the user's currently selected clip ────────

/**
 * Resolve the best available thumbnail URL from the user's current
 * selection. Falls back to the first video clip in the project, then
 * the first imported video, otherwise null (cards show gradients).
 */
const useCurrentClipThumbnail = (): string | null => {
  const project = useProjectStore((s) => s.project);
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);

  return useMemo(() => {
    const selectedIds = getSelectedClipIds();
    const tracks = project.timeline.tracks;
    const mediaItems = project.mediaLibrary.items;

    const findMediaForClipId = (clipId: string): string | null => {
      for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const item = mediaItems.find((m) => m.id === clip.mediaId);
          if (item?.thumbnailUrl) return item.thumbnailUrl;
        }
      }
      return null;
    };

    for (const id of selectedIds) {
      const thumb = findMediaForClipId(id);
      if (thumb) return thumb;
    }

    // Fallback 1: first clip with a thumbnail
    for (const track of tracks) {
      for (const clip of track.clips) {
        const item = mediaItems.find((m) => m.id === clip.mediaId);
        if (item?.thumbnailUrl) return item.thumbnailUrl;
      }
    }

    // Fallback 2: any media item with a thumbnail
    const firstWithThumb = mediaItems.find((m) => m.thumbnailUrl);
    return firstWithThumb?.thumbnailUrl ?? null;
  }, [project, getSelectedClipIds]);
};

// ─── Main panel ───────────────────────────────────────────────────

export const EffectsPanel: React.FC = () => {
  const { t: tr } = useTranslation();
  const thumbUrl = useCurrentClipThumbnail();
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);
  const addVideoEffect = useProjectStore((s) => s.addVideoEffect);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<EffectCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EDITOR_EFFECT_PREVIEWS.filter(
      (effect) =>
        (categoryFilter === "All" || effect.category === categoryFilter) &&
        (!q ||
          effect.label.toLowerCase().includes(q) ||
          effect.description.toLowerCase().includes(q) ||
          effect.category.toLowerCase().includes(q)),
    );
  }, [categoryFilter, query]);

  const applyToSelection = useCallback(
    async (def: EditorEffectPreviewDef) => {
      const selectedIds = getSelectedClipIds();
      if (selectedIds.length === 0) {
        toast.warning(
          "No clip selected",
          "Drag the effect onto a clip in the timeline, or select a clip and double-click.",
        );
        return;
      }
      let appliedCount = 0;
      for (const id of selectedIds) {
        if (await addVideoEffect(id, def.type, def.params)) appliedCount += 1;
      }
      if (appliedCount === 0) {
        toast.error(
          "Effect could not be applied",
          "The selected layers did not accept this effect.",
        );
        return;
      }
      toast.success(
        "Effect applied",
        `${def.label} added to ${appliedCount} clip${appliedCount > 1 ? "s" : ""}`,
      );
      if (appliedCount < selectedIds.length) {
        toast.warning(
          "Some layers were skipped",
          `${selectedIds.length - appliedCount} selected layer${selectedIds.length - appliedCount > 1 ? "s" : ""} could not accept the effect.`,
        );
      }
    },
    [getSelectedClipIds, addVideoEffect],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <ToolcraftTextInputControl
          label={tr("Search effects")}
          isLabelHidden
          type="text"
          value={query}
          onChange={setQuery}
          placeholder={tr("Search effects")}
          startIcon={<Search size={13} aria-hidden />}
          size="sm"
          width="100%"
        />
        <div
          className="mt-2 flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label={tr("Effect categories")}
        >
          {(["All", ...EDITOR_EFFECT_CATEGORIES] as const).map((category) => {
            const count =
              category === "All"
                ? EDITOR_EFFECT_PREVIEWS.length
                : EDITOR_EFFECT_PREVIEWS.filter(
                    (effect) => effect.category === category,
                  ).length;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                  categoryFilter === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
                }`}
              >
                {category} {count}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pb-3 space-y-3">
          {EDITOR_EFFECT_CATEGORIES.filter(
            (category) =>
              categoryFilter === "All" || category === categoryFilter,
          ).map((cat) => {
            const items = filtered.filter((e) => e.category === cat);
            if (items.length === 0) return null;
            return (
              <section key={cat}>
                <Text type="supporting" color="secondary" weight="bold" display="block" className="text-[9.5px] uppercase mb-1.5">
                  {cat}
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((def) => (
                    <EffectCard
                      key={def.id ?? def.type}
                      def={def}
                      thumbUrl={thumbUrl}
                      onApply={() => applyToSelection(def)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10.5px] py-6">
              {tr("No effects match \"")}{query}".
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};

export const TransitionsPanel: React.FC = () => {
  const { t: tr } = useTranslation();
  const thumbUrl = useCurrentClipThumbnail();
  const project = useProjectStore((state) => state.project);
  const addClipTransition = useProjectStore(
    (state) => state.addClipTransition,
  );
  const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<TransitionCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TRANSITIONS.filter(
      (transition) => {
        const category = transitionCategory(transition.type);
        if (categoryFilter !== "All" && category !== categoryFilter) {
          return false;
        }
        return (
          !q ||
          transition.label.toLowerCase().includes(q) ||
          transition.description.toLowerCase().includes(q) ||
          category.toLowerCase().includes(q)
        );
      },
    );
  }, [categoryFilter, query]);

  const applyToSelectedCut = useCallback(
    async (def: TransitionDef) => {
      const selectedIds = new Set(getSelectedClipIds());
      const selectedCount = selectedIds.size;
      if (selectedCount === 0) {
        toast.warning(
          "No clip selected",
          "Select a clip or two adjacent clips, then double-click the transition.",
        );
        return;
      }

      let clipA: Clip | undefined;
      let clipB: Clip | undefined;
      for (const track of project.timeline.tracks) {
        const sorted = [...track.clips].sort(
          (first, second) => first.startTime - second.startTime,
        );
        if (selectedCount > 1) {
          for (let index = 0; index < sorted.length - 1; index += 1) {
            if (
              selectedIds.has(sorted[index].id) &&
              selectedIds.has(sorted[index + 1].id)
            ) {
              clipA = sorted[index];
              clipB = sorted[index + 1];
              break;
            }
          }
        } else {
          const selectedIndex = sorted.findIndex((clip) =>
            selectedIds.has(clip.id),
          );
          if (selectedIndex >= 0) {
            const selected = sorted[selectedIndex];
            const next = sorted[selectedIndex + 1];
            const previous = sorted[selectedIndex - 1];
            if (next) {
              clipA = selected;
              clipB = next;
            } else if (previous) {
              clipA = previous;
              clipB = selected;
            } else {
              clipA = selected;
              clipB = undefined;
            }
          }
        }
        if (clipA) break;
      }

      if (!clipA) {
        toast.warning(
          "No compatible cut",
          "The selected clips must be adjacent on the same timeline track.",
        );
        return;
      }

      const bridge = getTransitionBridge();
      if (!bridge.isInitialized()) {
        bridge.initialize(project.settings.width, project.settings.height);
      }
      const params = {
        ...bridge.getDefaultParams(def.type),
        ...def.params,
      };
      const result = clipB
        ? bridge.createTransition(clipA, clipB, def.type, 1, params)
        : bridge.createClipEdgeTransition(clipA, "out", def.type, 1, params);
      if (!result.success || !result.transitionId) {
        toast.error(
          "Transition failed",
          result.error ?? "Could not create this transition at the selected cut.",
        );
        return;
      }
      const transition = bridge.getTransition(result.transitionId);
      if (!transition || !(await addClipTransition(transition))) {
        toast.error("Transition failed", "Could not save the transition.");
        return;
      }
      toast.success(
        "Transition applied",
        `${def.label} added to the selected cut.`,
      );
    },
    [addClipTransition, getSelectedClipIds, project],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <ToolcraftTextInputControl
          label={tr("Search transitions")}
          isLabelHidden
          type="text"
          value={query}
          onChange={setQuery}
          placeholder={tr("Search transitions")}
          startIcon={<Search size={13} aria-hidden />}
          size="sm"
          width="100%"
        />
        <div
          className="mt-2 flex gap-1 overflow-x-auto pb-0.5"
          role="group"
          aria-label={tr("Transition categories")}
        >
          {(["All", ...TRANSITION_CATEGORIES] as const).map((category) => {
            const count =
              category === "All"
                ? TRANSITIONS.length
                : TRANSITIONS.filter(
                    (transition) =>
                      transitionCategory(transition.type) === category,
                  ).length;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                  categoryFilter === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
                }`}
              >
                {category} {count}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3 px-3 pb-3">
          {TRANSITION_CATEGORIES.filter(
            (category) =>
              categoryFilter === "All" || category === categoryFilter,
          ).map((category) => {
            const items = filtered.filter(
              (transition) => transitionCategory(transition.type) === category,
            );
            if (items.length === 0) return null;
            return (
              <section key={category}>
                <div className="mb-1.5 flex items-center justify-between">
                  <Text type="supporting" color="secondary" weight="bold" className="text-[9.5px] uppercase">
                    {category}
                  </Text>
                  <Text type="supporting" color="secondary" className="font-mono text-[9px]">
                    {items.length}
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((def) => (
                    <TransitionCard
                      key={def.id ?? `${def.type}-${def.label}`}
                      def={def}
                      thumbUrl={thumbUrl}
                      onApply={() => void applyToSelectedCut(def)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text type="supporting" color="secondary" display="block" justify="center" className="text-[10.5px] py-6">
              {tr("No transitions match \"")}{query}".
            </Text>
          )}
        </div>
      </div>
    </div>
  );
};
