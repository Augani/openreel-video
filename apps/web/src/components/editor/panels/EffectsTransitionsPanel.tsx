import { TransitionDurationField } from "../inspector/TransitionInspector";
import { Button, Input, Switch, ScrollArea } from "@openreel/ui";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import React, { useCallback, useMemo, useState } from "react";
import { Search } from "@/icons/lucide-compat";


import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { AudioEffectsSection } from "../inspector/AudioEffectsSection";
import { EffectLivePreview, EffectPreviewProvider } from "./effect-previews/EffectLivePreview";
import type { PreviewEffectDef } from "./effect-previews/preview-engine";
import { toast } from "../../../stores/notification-store";
import type { VideoEffect, VideoEffectType } from "../../../bridges/effects-bridge";
import { getDefaultTransitionParams, getMotionShaderDef, getPluginRegistry, isPluginEffectType, pluginEffectType, pluginIdFromEffectType, type Clip, type Track, type TransitionType, type Project, type LoadedPlugin } from "@openreel/core";
import { useInstalledPlugins } from "../../../hooks/use-plugin-registry";
import { usePluginManagerStore } from "../../../stores/plugin-manager-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { serializeEditorEffectDropPayload } from "../timeline/effect-drop";
import {
  applyEditorEffectToClip,
  setClipLutEnabled,
} from "../../../services/editor-effect-application";
import { PRO_EFFECT_PREVIEWS } from "./proEffectPreviews";
import { BURN_IN_PREVIEWS } from "./burnInPreviews";

// ─── Effect & Transition catalogs ──────────────────────────────────
// Each item ships with a small CSS recipe used to animate the live
// preview thumbnail. The thumbnail itself comes from the user's
// currently-selected clip when available, falling back to a gradient.

export type EffectCategory =
  | "Basic"
  | "Color"
  | "Blur"
  | "Creative"
  | "Stylize"
  | "Keying"
  | "Distort"
  | "Generate"
  | "Time";
type EffectCategoryFilter =
  | "All"
  | "Adjust"
  | "Blur"
  | "Stylize"
  | "Distort"
  | "Generate"
  | "Keying"
  | "Time"
  | "Plugins"
  | "Audio";
const workspaceEffectCategories: EffectCategoryFilter[] = [
  "All",
  "Adjust",
  "Blur",
  "Stylize",
  "Distort",
  "Generate",
  "Keying",
  "Time",
  "Plugins",
  "Audio",
];
function matchesEffectCategory(
  effect: EditorEffectPreviewDef,
  category: EffectCategoryFilter,
) {
  return (
    category === "All" ||
    (category === "Plugins" && isPluginEffectType(effect.type)) ||
    (category === "Adjust" && ["Basic", "Color"].includes(effect.category)) ||
    (category === "Blur" && effect.category === "Blur") ||
    (category === "Stylize" &&
      ["Creative", "Stylize"].includes(effect.category)) ||
    (category === "Distort" && effect.category === "Distort") ||
    (category === "Generate" && effect.category === "Generate") ||
    (category === "Keying" && effect.category === "Keying") ||
    (category === "Time" && effect.category === "Time")
  );
}

export interface EditorEffectPreviewDef {
  id?: string;
  type: VideoEffectType | "lut" | "stabilize";
  /** Installed plugin this entry was generated from (Effects panel only). */
  pluginId?: string;
  label: string;
  description: string;
  category: EffectCategory;
  params?: Record<string, unknown>;
  /** Returns a CSS filter / transform / opacity string for the preview
   *  given an animation progress p in [0, 1] (or a paused 0.5 hover state). */
  previewStyle: (p: number) => React.CSSProperties;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const ALL_EFFECT_PREVIEWS: EditorEffectPreviewDef[] = [
  {
    id: "pixelate", type: "shader", label: "Pixelate",
    description: "Group pixels into adjustable square blocks", category: "Stylize",
    params: { shaderId: "pixelate", size: 8 },
    previewStyle: p => ({ filter: `contrast(${lerp(1, 1.3, p)})`, imageRendering: "pixelated" }),
  },
  {
    id: "mirror", type: "shader", label: "Mirror",
    description: "Reflect the image horizontally or vertically", category: "Stylize",
    params: { shaderId: "mirror", horizontal: 1, vertical: 0 },
    previewStyle: () => ({ transform: "scaleX(-1)" }),
  },
  {
    id: "lens-distort", type: "shader", label: "Lens distort",
    description: "Adjust barrel or pincushion lens distortion", category: "Stylize",
    params: { shaderId: "fisheye", strength: 0.35, radius: 0.8 },
    previewStyle: p => ({ transform: `scale(${lerp(1, 1.25, p)})`, borderRadius: "40%" }),
  },
  {
    id: "stabilize", type: "stabilize", label: "Stabilize",
    description: "Analyze camera shake and adjust stabilization", category: "Basic",
    previewStyle: p => ({ transform: `translateX(${Math.sin(p * Math.PI * 4) * 3 * (1 - p)}px)` }),
  },
  {
    type: "lut",
    label: "LUT · Warm",
    description:
      "A warm 3D lookup table with gentle saturation and golden highlights",
    category: "Color",
    params: { preset: "warm" },
    previewStyle: (p) => ({
      filter: `sepia(${lerp(0, 0.2, p)}) saturate(${lerp(1, 1.04, p)})`,
    }),
  },
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
    label: "Black & white",
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
    id: "blur",
    type: "blur",
    label: "Gaussian blur",
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
    label: "Film grain",
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
    label: "Chroma key",
    description: "Remove green or blue screen backgrounds",
    category: "Keying",
    previewStyle: (p) => ({
      filter: `hue-rotate(${lerp(0, 18, p)}deg) saturate(${lerp(1, 1.35, p)})`,
      boxShadow: `inset 0 0 0 ${lerp(0, 5, p)}px rgba(34,197,94,.75)`,
    }),
  },
  ...PRO_EFFECT_PREVIEWS,
  ...BURN_IN_PREVIEWS,
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
    params: { amount: 18, size: 0.7, roughness: 0.65, colored: false },
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
    params: {
      shaderId: "wave-warp",
      amplitude: 0.025,
      frequency: 5,
      speed: 1.5,
    },
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
    params: {
      shaderId: "edge-glow",
      strength: 4,
      radius: 1.5,
      color: "#4de8ff",
    },
    previewStyle: (p) => ({
      filter: `contrast(${lerp(1, 1.45, p)}) drop-shadow(0 0 ${lerp(0, 9, p)}px #4de8ff)`,
    }),
  },
];

/**
 * Catalog entries replaced by a more capable implementation of the same
 * concept. They stay defined so projects that already contain those effect
 * types keep their label and still render, but the browser shows one entry
 * per concept:
 *   Pixelate -> Mosaic, Mirror -> Mirror (H/V/Quad), Lens distort -> Lens
 *   Distortion (also Fisheye), Gaussian blur -> Gaussian Blur (H/V), Posterize -> Posterize
 *   (levels), VHS -> VHS / Glitch.
 */
export const SUPERSEDED_EFFECT_PREVIEW_IDS: ReadonlySet<string> = new Set([
  "blur",
  "pixelate",
  "mirror",
  "lens-distort",
  "shader-vhs",
  "shader-posterize",
  // Same fisheye shader as "Lens distort", just a stronger preset.
  "shader-fisheye",
]);

export const EDITOR_EFFECT_PREVIEWS: EditorEffectPreviewDef[] =
  ALL_EFFECT_PREVIEWS.filter(
    (effect) => !SUPERSEDED_EFFECT_PREVIEW_IDS.has(effect.id ?? effect.type),
  );

export const EDITOR_EFFECT_CATEGORIES: EffectCategory[] = [
  "Basic",
  "Color",
  "Blur",
  "Creative",
  "Stylize",
  "Keying",
  "Distort",
  "Generate",
  "Time",
];

interface TransitionDef {
  id?: string;
  type: TransitionType;
  label: string;
  description: string;
  params?: Record<string, unknown>;
}

function matchesPresetParams(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([key, value]) =>
      matchesPresetParams((actual as Record<string, unknown>)[key], value));
  }
  return Object.is(actual, expected);
}

type TransitionCategory = "Dissolve" | "Wipe" | "Slide" | "Zoom" | "Glitch";
type TransitionCategoryFilter = "All" | TransitionCategory;

const TRANSITION_CATEGORIES: TransitionCategory[] = [
  "Dissolve",
  "Wipe",
  "Slide",
  "Zoom",
  "Glitch",
];

const transitionCategory = (type: TransitionType): TransitionCategory => {
  if (type === "crossfade" || type === "dipToBlack" || type === "dipToWhite") {
    return "Dissolve";
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
    return "Wipe";
  }
  if (
    type === "slide" ||
    type === "push" ||
    type === "whipPan" ||
    type === "spin" ||
    type === "flip" ||
    type === "pageTurn"
  ) {
    return "Slide";
  }
  return type === "zoom" ? "Zoom" : "Glitch";
};

const TRANSITIONS: TransitionDef[] = [
  {
    type: "crossfade",
    label: "Cross dissolve",
    description: "Smooth opacity blend",
  },
  {
    type: "dipToBlack",
    label: "Dip to black",
    description: "Fade through black",
  },
  {
    type: "dipToWhite",
    label: "Dip to white",
    description: "Fade through white",
  },
  {
    type: "wipe",
    label: "Wipe",
    description: "Hard edge sweeps across",
  },
  ...(
    [
      { id: "wipe-left", label: "Wipe left", direction: "left" },
      { id: "wipe-right", label: "Wipe Right", direction: "right" },
      { id: "wipe-up", label: "Wipe Up", direction: "up" },
      { id: "wipe-down", label: "Wipe Down", direction: "down" },
    ] as const
  ).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "wipe",
    label,
    description: `Directional ${direction} reveal`,
    params: { direction, softness: 0 },
  })),
  {
    type: "slide",
    label: "Slide",
    description: "New clip slides in",
  },
  ...(
    [
      { id: "slide-left", label: "Slide Left", direction: "left" },
      { id: "slide-right", label: "Slide Right", direction: "right" },
      { id: "slide-up", label: "Slide Up", direction: "up" },
      { id: "slide-down", label: "Slide Down", direction: "down" },
    ] as const
  ).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "slide",
    label,
    description: `Slide the next clip ${direction}`,
    params: { direction },
  })),
  {
    type: "push",
    label: "Push",
    description: "Outgoing clip is shoved off",
  },
  {
    type: "zoom",
    label: "Zoom in",
    description: "Scale up and dissolve",
  },
  {
    type: "circleReveal",
    label: "Iris",
    description: "Iris reveal from the center",
  },
  {
    type: "blur",
    label: "Blur",
    description: "Blur out and into the next clip",
  },
  {
    type: "whipPan",
    label: "Whip pan",
    description: "Fast motion-blurred pan",
  },
  {
    type: "radialWipe",
    label: "Radial Wipe",
    description: "Clock-style angular sweep",
  },
  {
    type: "pixelate",
    label: "Pixelate",
    description: "Break the cut into a chunky pixel mosaic",
    params: { maxPixelSize: 48 },
  },
  {
    type: "glitch",
    label: "Glitch",
    description: "Digital slice displacement at the cut",
    params: { intensity: 0.08, slices: 12 },
  },
  {
    type: "blinds",
    label: "Venetian Blinds",
    description: "Reveal the next shot through repeating slats",
    params: { count: 8, direction: "vertical" },
  },
  {
    type: "diamondReveal",
    label: "Diamond Reveal",
    description: "Geometric iris expanding from the center",
  },
  ...(
    [
      { id: "spin-clockwise", label: "Spin Clockwise", rotations: 1 },
      { id: "spin-counter", label: "Spin Counterclockwise", rotations: -1 },
    ] as const
  ).map<TransitionDef>(({ id, label, rotations }) => ({
    id,
    type: "spin",
    label,
    description: "Rotating scale transition with a smooth handoff",
    params: { rotations },
  })),
  ...(
    [
      { id: "flip-horizontal", label: "Flip Horizontal", axis: "horizontal" },
      { id: "flip-vertical", label: "Flip Vertical", axis: "vertical" },
    ] as const
  ).map<TransitionDef>(({ id, label, axis }) => ({
    id,
    type: "flip",
    label,
    description: `Card-style ${axis} flip between shots`,
    params: { axis },
  })),
  ...(
    [
      {
        id: "split-horizontal",
        label: "Split Horizontal",
        orientation: "horizontal",
      },
      {
        id: "split-vertical",
        label: "Split Vertical",
        orientation: "vertical",
      },
    ] as const
  ).map<TransitionDef>(({ id, label, orientation }) => ({
    id,
    type: "splitReveal",
    label,
    description: `Reveal the next shot outward from the ${orientation === "horizontal" ? "center line" : "middle"}`,
    params: { orientation },
  })),
  {
    id: "flash-cut",
    type: "flash",
    label: "Flash Cut",
    description: "High-energy white flash through the edit",
    params: { intensity: 1 },
  },
  ...(
    [
      {
        id: "film-burn",
        label: "Film Burn",
        description: "Warm analog light leak through the edit",
        intensity: 1,
        warmth: 0.75,
      },
      {
        id: "film-burn-red",
        label: "Red Film Burn",
        description: "Dense red-orange flare for dramatic cuts",
        intensity: 1.3,
        warmth: 1,
      },
      {
        id: "light-leak-cool",
        label: "Cool Light Leak",
        description: "Blue-white optical flare through the edit",
        intensity: 0.9,
        warmth: 0,
      },
    ] as const
  ).map<TransitionDef>(
    ({ id, label, description, intensity, warmth }) => ({
      id,
      type: "filmBurn",
      label,
      description,
      params: { intensity, warmth },
    }),
  ),
  {
    type: "mosaic",
    label: "Mosaic Reveal",
    description: "Tiles assemble the next shot in a shuffled pattern",
    params: { tiles: 8, randomness: 0.85 },
  },
  {
    type: "ripple",
    label: "Ripple",
    description: "A fluid wave distorts both shots through the cut",
    params: { amplitude: 0.04, waves: 3 },
  },
  ...(
    [
      { id: "page-turn-left", label: "Page Turn Left", direction: "left" },
      { id: "page-turn-right", label: "Page Turn Right", direction: "right" },
    ] as const
  ).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "pageTurn",
    label,
    description: `Fold the outgoing shot toward the ${direction}`,
    params: { direction, shadow: 0.55 },
  })),
  {
    type: "colorSplit",
    label: "Color Split",
    description: "Prismatic channel ghosts collide at the edit",
    params: { maxOffset: 18, angle: 0 },
  },
  ...(
    [
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
    ] as const
  ).map<TransitionDef>(({ id, label, description, curve }) => ({
    id,
    type: "crossfade",
    label,
    description,
    params: { curve },
  })),
  ...(
    [
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
        label: "Diagonal wipe",
        direction: "diagonal",
        softness: 0,
      },
    ] as const
  ).map<TransitionDef>(({ id, label, direction, softness }) => ({
    id,
    type: "wipe",
    label,
    description:
      direction === "diagonal"
        ? "Angular reveal from the corner"
        : "Feathered directional reveal",
    params: { direction, softness },
  })),
  ...(
    [
      { id: "push-left", label: "Push Left", direction: "left" },
      { id: "push-right", label: "Push Right", direction: "right" },
      { id: "push-up", label: "Push Up", direction: "up" },
      { id: "push-down", label: "Push Down", direction: "down" },
    ] as const
  ).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "push",
    label,
    description: `Both clips travel ${direction}`,
    params: { direction },
  })),
  ...(
    [
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
    ] as const
  ).map<TransitionDef>(({ id, label, center }) => ({
    id,
    type: "zoom",
    label,
    description: "Focused scale-and-dissolve transition",
    params: { scale: id === "zoom-punch" ? 3 : 2, center },
  })),
  ...(
    [
      { id: "whip-left", label: "Whip Left", direction: "left" },
      { id: "whip-right", label: "Whip Right", direction: "right" },
      { id: "whip-up", label: "Whip Up", direction: "up" },
      { id: "whip-down", label: "Whip Down", direction: "down" },
    ] as const
  ).map<TransitionDef>(({ id, label, direction }) => ({
    id,
    type: "whipPan",
    label,
    description: `Motion-blurred whip ${direction}`,
    params: { direction },
  })),
];

// ─── Drag payload helpers ──────────────────────────────────────────
export const EFFECT_DRAG_MIME = "application/x-openreel-effect";
export const TRANSITION_DRAG_MIME = "application/x-openreel-transition";

/** Keyboard focus (not a mouse click's focus) starts a card's preview, like hover does. */
function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}
const referenceEffectOrder = new Map([
  "pro-gaussian-blur", "sharpen", "vignette", "grain", "grayscale", "lut",
  "chromaKey", "glow", "pro-mosaic", "pro-mirror", "pro-lens-distortion", "stabilize",
].map((id, index) => [id, index]));

function pluginEffectPreview(plugin: LoadedPlugin): EditorEffectPreviewDef {
  const { manifest } = plugin;
  return {
    id: `plugin-${manifest.id}`,
    type: pluginEffectType(manifest.id) as VideoEffectType,
    pluginId: manifest.id,
    label: manifest.name,
    description: manifest.description || `${manifest.name} plugin`,
    category: manifest.category,
    previewStyle: () => ({}),
  };
}

function appliedEffectName(effect: VideoEffect) {
  const pluginId = pluginIdFromEffectType(effect.type);
  if (pluginId) return getPluginRegistry().get(pluginId)?.manifest.name ?? `${pluginId} (plugin missing)`;
  if (effect.type === "shader") return getMotionShaderDef(String(effect.params.shaderId))?.name ?? "Shader";
  const typeLabel = (item: EditorEffectPreviewDef) => item.type === effect.type && (!item.id || item.id === effect.type || item.id === `pro-${effect.type}`);
  return ALL_EFFECT_PREVIEWS.find(typeLabel)?.label ?? effect.type.replaceAll("-", " ");
}

function appliedEffectValue(effect: VideoEffect) {
  if (effect.type === "grain" && typeof effect.params.amount === "number") return `${Math.round(effect.params.amount)}%`;
  if (effect.type === "blur" && typeof effect.params.radius === "number") return `${Number(effect.params.radius.toFixed(1))} px`;
  return "custom";
}

// ─── Cards ────────────────────────────────────────────────────────

const EffectCard: React.FC<{
  def: EditorEffectPreviewDef;
  onApply: () => void;
}> = ({ def, onApply }) => {
  const [isHover, setIsHover] = useState(false);
  const [isFocus, setIsFocus] = useState(false);

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
    <Button variant="ghost" draggable onDragStart={handleDragStart} onDoubleClick={onApply} onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onApply();
        }
      }} onMouseEnter={() => setIsHover(true)} onMouseLeave={() => setIsHover(false)} onFocus={(e) => setIsFocus(isKeyboardFocus(e.currentTarget))} onBlur={() => setIsFocus(false)} type="button" aria-label={`${def.label}. Drag onto a clip to apply, or double-click to apply to selected clip.`} className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] border transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-border bg-bg-1 hover:bg-bg-2 p-0 workspace-catalog-card group relative flex flex-col items-stretch text-left cursor-grab active:cursor-grabbing">
      <div
        data-effect-preview={def.id ?? def.type}
        className="relative aspect-video bg-bg-3 overflow-hidden"
      >
        <EffectLivePreview def={def} active={isHover || isFocus} />
        <span className="font-normal absolute bottom-1 right-1 text-[8.5px] uppercase px-1.5 py-0.5 rounded bg-black/55 text-white/85 backdrop-blur-sm">
          {def.category}
        </span>
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <span className="font-bold block overflow-hidden text-[10.5px] text-fg leading-tight" style={{ WebkitBoxOrient: "vertical", WebkitLineClamp: 1, display: "-webkit-box" }}
        >
          {def.label}
        </span>
        <span className="font-normal block overflow-hidden workspace-catalog-description text-[9.5px] text-fg-muted leading-tight mt-0.5" style={{ WebkitBoxOrient: "vertical", WebkitLineClamp: 1, display: "-webkit-box" }}
        >
          {def.description}
        </span>
      </div>
    </Button>
  );
};

const TransitionCard: React.FC<{
  def: TransitionDef;
  selected: boolean;
  used: boolean;
  onSelect: () => void;
  onApply: () => void;
}> = ({ def, selected, used, onSelect, onApply }) => {
  const [isHover, setIsHover] = useState(false);
  const [isFocus, setIsFocus] = useState(false);
  // Real footage under the playhead, blended by the TransitionEngine (see effect-previews/).
  const previewDef = useMemo<PreviewEffectDef>(
    () => ({ kind: "transition", id: def.id, type: def.type, params: def.params }),
    [def.id, def.type, def.params],
  );

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
    <Button variant="ghost" draggable aria-pressed={selected} onClick={onSelect} onDragStart={handleDragStart} onDoubleClick={onApply} onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSelect();
          onApply();
        }
      }} onMouseEnter={() => setIsHover(true)} onMouseLeave={() => setIsHover(false)} onFocus={(e) => setIsFocus(isKeyboardFocus(e.currentTarget))} onBlur={() => setIsFocus(false)} type="button" aria-label={`${def.label}. Drag onto a clip edge, or double-click to apply to the selected cut.`} className="group/card h-auto min-w-0 whitespace-normal rounded-[7px] border transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-border bg-bg-1 hover:bg-bg-2 p-0 workspace-catalog-card group relative flex flex-col items-stretch text-left cursor-grab active:cursor-grabbing">
      <div className="workspace-transition-tile relative aspect-video overflow-hidden">
        <EffectLivePreview def={previewDef} active={isHover || isFocus} />
        {used && <span className="workspace-transition-used" aria-label="Used in timeline" />}
      </div>
      <div className="px-2 py-1.5 border-t border-border">
        <span className="font-bold block overflow-hidden text-[10.5px] text-fg leading-tight" style={{ WebkitBoxOrient: "vertical", WebkitLineClamp: 1, display: "-webkit-box" }}
        >
          {def.label}
        </span>
        <span className="font-normal block overflow-hidden workspace-catalog-description text-[9.5px] text-fg-muted leading-tight mt-0.5" style={{ WebkitBoxOrient: "vertical", WebkitLineClamp: 1, display: "-webkit-box" }}
        >
          {def.description}
        </span>
      </div>
    </Button>
  );
};

// ─── Main panel ───────────────────────────────────────────────────

export const EffectsPanel: React.FC = () => {
  const getSelectedClipIds = useUIStore((s) => s.getSelectedClipIds);
  const project = useProjectStore((s) => s.project);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const selectedClip = project.timeline.tracks
    .flatMap((t) => t.clips)
    .find((c) => selectedItems.some((item) => item.id === c.id));
  const keyingClip = project.timeline.tracks.some(
    (track) =>
      (track.type === "video" || track.type === "image") &&
      track.clips.some((clip) => clip.id === selectedClip?.id),
  )
    ? selectedClip
    : undefined;
  const applied = selectedClip
    ? useProjectStore.getState().getVideoEffects(selectedClip.id)
    : [];
  const appliedLut = selectedClip?.colorGrading?.lut;

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState<EffectCategoryFilter>("All");
  const installedPlugins = useInstalledPlugins();
  const catalog = useMemo(
    () => [...EDITOR_EFFECT_PREVIEWS, ...installedPlugins.map(pluginEffectPreview)],
    [installedPlugins],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter(
      (effect) =>
        matchesEffectCategory(effect, categoryFilter) &&
        (!q ||
          effect.label.toLowerCase().includes(q) ||
          effect.description.toLowerCase().includes(q) ||
          effect.category.toLowerCase().includes(q)),
    ).sort((a, b) =>
      (referenceEffectOrder.get(a.id ?? a.type) ?? 99) -
      (referenceEffectOrder.get(b.id ?? b.type) ?? 99));
  }, [catalog, categoryFilter, query]);

  const searchPlaceholder =
    categoryFilter === "Audio"
      ? "Audio effects apply to the selected clip"
      : `Search ${catalog.filter((effect) => matchesEffectCategory(effect, categoryFilter)).length} ${
          categoryFilter === "All" ? "" : categoryFilter === "Plugins" ? "plugin " : `${categoryFilter.toLowerCase()} `
        }effects`;

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
      if (def.type === "stabilize") {
        const project = useProjectStore.getState().project;
        const target = selectedIds.find(id => project.timeline.tracks.some(track =>
          !track.locked && track.clips.some(clip => clip.id === id &&
            project.mediaLibrary.items.some(media => media.id === clip.mediaId && media.type === "video"))));
        if (!target || !(await applyEditorEffectToClip(target, { effectType: "stabilize" }))) {
          toast.warning("Select a video clip", "Choose an unlocked video clip to adjust stabilization.");
        }
        return;
      }
      let appliedCount = 0;
      for (const id of selectedIds) {
        if (
          await applyEditorEffectToClip(id, {
            effectType: def.type,
            effectParams: def.params,
          })
        )
          appliedCount += 1;
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
    [getSelectedClipIds],
  );

  return (
    <EffectPreviewProvider>
    <div className="workspace-effect-library flex flex-col h-full min-h-0">
      <div className="workspace-panel-heading">
        Effects<small>Drag onto a clip</small>
      </div>
      <div className="workspace-effects-filter shrink-0">
        <label className="workspace-effects-search">
          <Search size={14} aria-hidden />
          <Input
          aria-label="Search effects"
          value={query}
          onChange={event => setQuery(event.target.value)}
          disabled={categoryFilter === "Audio"}
          placeholder={searchPlaceholder}
          />
        </label>
        <div
          className="workspace-chips mt-2"
          role="group"
          aria-label="Effect categories"
        >
          {workspaceEffectCategories.map((category) => {
            return (
              <Button
                variant="ghost"
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
                {category}
              </Button>
            );
          })}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="workspace-effects-content">
          {categoryFilter === "Plugins" && !query.trim() && (
            <div className="workspace-recipes-note">
              <strong>Effect plugins</strong>
              <p>
                {installedPlugins.length === 0
                  ? "No plugins installed. Install a .orplugin file to add effects built with the OpenReel plugin SDK."
                  : "Plugins you installed. Drag one onto a clip or double-click it to apply."}
              </p>
              <Button
                variant="secondary"
                onClick={() => usePluginManagerStore.getState().setOpen(true)}
              >
                Manage plugins
              </Button>
            </div>
          )}
          {categoryFilter === "Audio" &&
            (selectedClip ? (
              <AudioEffectsSection
                key={selectedClip.id}
                clipId={selectedClip.id}
              />
            ) : (
              <p className="py-6 text-xs text-center text-fg-muted">
                Select a clip to adjust its equalizer, compression, reverb and
                delay.
              </p>
            ))}
          {selectedClip &&
            (applied.length > 0 || appliedLut) &&
            categoryFilter !== "Audio" && (
              <div className="workspace-applied-effects">
                <div>
                  <strong>
                    On{" "}
                    {project.mediaLibrary.items.find(
                      (m) => m.id === selectedClip.mediaId,
                    )?.name ?? "selected clip"}
                  </strong>
                  <small>{applied.length + (appliedLut ? 1 : 0)} applied</small>
                </div>
                {appliedLut && (
                  <label>
                    <Button
                      variant="ghost"
                      aria-label="Edit LUT"
                      className="h-6 flex-1 justify-start p-0 text-xs font-normal"
                      onClick={() =>
                        useInspectorNavigationStore
                          .getState()
                          .requestSection("color-grading", selectedClip.id)
                      }
                    >
                      <span aria-hidden="true" className="workspace-effect-grip">⋮⋮</span>LUT
                    </Button>
                    <small>{Math.round(appliedLut.intensity * 100)}%</small>
                    <Switch
                      aria-label="Enable LUT"
                      checked={appliedLut.intensity > 0}
                      onCheckedChange={async (enabled) => {
                        if (
                          !(await setClipLutEnabled(selectedClip.id, enabled))
                        )
                          toast.error(
                            "LUT could not be changed",
                            "Unlock the clip's track and try again.",
                          );
                      }}
                    />
                  </label>
                )}
                {applied.map((effect) => (
                  <label key={effect.id}>
                    <Button variant="ghost" aria-label={`Edit ${appliedEffectName(effect)}`} className="workspace-applied-effect-name"
                      onClick={() => useInspectorNavigationStore.getState().requestSection("video-effects", selectedClip.id)}>
                      <span aria-hidden="true" className="workspace-effect-grip">⋮⋮</span>
                      <span>{appliedEffectName(effect)}</span>
                    </Button>
                    <small>{appliedEffectValue(effect)}</small>
                    <Switch
                      aria-label={`Enable ${effect.type}`}
                      checked={effect.enabled}
                      onCheckedChange={(enabled) => {
                        void useProjectStore
                          .getState()
                          .toggleVideoEffect(
                            selectedClip.id,
                            effect.id,
                            enabled,
                          );
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          <div className="workspace-effect-grid">
            {filtered.map((def) => (
                <EffectCard
                  key={def.id ?? def.type}
                  def={def}
                  onApply={() => applyToSelection(def)}
                />
              ))}
          </div>
          {categoryFilter === "Keying" && !query.trim() && (
            <div className="workspace-recipes-note">
              <p>Remove a sampled background color from the selected video or image clip.</p>
              <Button
                variant="secondary"
                disabled={!keyingClip}
                onClick={() => {
                  if (keyingClip)
                    useInspectorNavigationStore
                      .getState()
                      .requestSection("chroma-key", keyingClip.id);
                }}
              >
                Configure chroma key
              </Button>
              {!keyingClip && <p>Select a video or image clip first.</p>}
            </div>
          )}
          {filtered.length === 0 &&
            categoryFilter !== "Audio" &&
            query.trim() !== "" && (
              <span className="text-fg-2 font-normal block text-center text-[10.5px] py-6"
              >
                No effects match "{query.trim()}".
              </span>
            )}
        </div>
      </ScrollArea>
    </div>
    </EffectPreviewProvider>
  );
};

function getLibraryTransitionCuts(tracks: readonly Track[], frameRate: number) {
  const frame = 1 / frameRate;
  const pairs: { clipA: Clip; clipB: Clip }[] = [];
  for (const track of tracks) {
    if (track.locked || (track.type !== "video" && track.type !== "image")) continue;
    const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    for (let index = 0; index < clips.length - 1; index++) {
      const clipA = clips[index], clipB = clips[index + 1];
      if (Math.abs(clipA.startTime + clipA.duration - clipB.startTime) <= frame)
        pairs.push({ clipA, clipB });
    }
  }
  return pairs;
}

/** Cache each published project, retaining the result when the visible library is unchanged. */
function createTransitionLibrarySelector() {
  let previousProject: Project | undefined;
  let summary: { frameRate: number; eligibleCutCount: number; usedTransitions: Set<TransitionDef> } | undefined;
  return ({ project }: { project: Project }) => {
    if (previousProject === project && summary) return summary;
    previousProject = project;
    const byType = new Map<TransitionType, Record<string, unknown>[]>();
    for (const track of project.timeline.tracks) for (const transition of track.transitions) {
      const params = { ...getDefaultTransitionParams(transition.type), ...transition.params };
      const group = byType.get(transition.type);
      if (group) group.push(params);
      else byType.set(transition.type, [params]);
    }
    const usedTransitions = new Set(TRANSITIONS.filter(def => byType.get(def.type)?.some(params =>
      matchesPresetParams(params, def.params ?? {}))));
    const frameRate = project.settings.frameRate;
    const eligibleCutCount = getLibraryTransitionCuts(project.timeline.tracks, frameRate).length;
    const previous = summary;
    if (previous && previous.frameRate === frameRate && previous.eligibleCutCount === eligibleCutCount
      && previous.usedTransitions.size === usedTransitions.size
      && [...usedTransitions].every(def => previous.usedTransitions.has(def))) return previous;
    return summary = { frameRate, eligibleCutCount, usedTransitions };
  };
}

export const TransitionsPanel: React.FC = () => {
  const selectLibrary = useMemo(createTransitionLibrarySelector, []);
  const { frameRate, eligibleCutCount, usedTransitions } = useProjectStore(selectLibrary);
  const exporting = useUIStore(state => state.exportState.isExporting);
  const playbackLocked = useTimelineStore(state => state.playbackLockedReason);
  const applyingAllRef = React.useRef(false);
  const addClipTransition = useProjectStore((state) => state.addClipTransition);
  const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTriggerRef = React.useRef<HTMLButtonElement>(null);
  const duration = useEditorWorkspaceStore((s) => s.transitionDuration);
  const [selectedTransition, setSelectedTransition] = useState<TransitionDef>(
    TRANSITIONS[0],
  );
  const [applyingAll, setApplyingAll] = useState(false);
  const [categoryFilter, setCategoryFilter] =
    useState<TransitionCategoryFilter>("All");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TRANSITIONS.filter((transition) => {
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
    });
  }, [categoryFilter, query]);

  const applyToSelectedCut = useCallback(
    async (def: TransitionDef) => {
      if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return;
      const project = useProjectStore.getState().project;
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
        ? bridge.createTransition(clipA, clipB, def.type, duration, params)
        : bridge.createClipEdgeTransition(
            clipA,
            "out",
            def.type,
            duration,
            params,
          );
      if (!result.success || !result.transitionId) {
        toast.error(
          "Transition failed",
          result.error ??
            "Could not create this transition at the selected cut.",
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
    [addClipTransition, getSelectedClipIds, duration],
  );

  return (
    <EffectPreviewProvider>
    <div className="workspace-transition-library flex flex-col h-full min-h-0">
      <div className="workspace-panel-heading">
        <Button
          ref={searchTriggerRef}
          variant="ghost"
          className="workspace-transition-search-trigger"
          aria-label="Search transitions"
          title="Search all transitions"
          aria-expanded={searchOpen}
          onClick={() => {
            if (searchOpen) setQuery("");
            setSearchOpen(!searchOpen);
          }}
        >
          Transitions
        </Button>
        <small>Drop on a cut</small>
      </div>
      <div className="workspace-transition-filters">
        {searchOpen && (
          <div className="workspace-effects-search">
            <Search size={13} aria-hidden="true" />
            <Input
              autoFocus
              aria-label="Search transitions"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search transitions"
              onKeyDown={event => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setQuery("");
                setSearchOpen(false);
                searchTriggerRef.current?.focus();
              }}
            />
          </div>
        )}
        <div
          className="workspace-chips"
          role="group"
          aria-label="Transition categories"
        >
          {(["All", ...TRANSITION_CATEGORIES] as const).map((category) => {
            return (
              <Button variant="ghost" size="sm"
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
                {category}
              </Button>
            );
          })}
        </div>
      <TransitionDurationField
        label="Default duration"
        ariaLabel="Default transition duration"
        className="workspace-transition-library-duration"
        value={duration}
        frameRate={frameRate}
        max={30}
        onChange={(value) =>
          useEditorWorkspaceStore.getState().setTransitionDuration(value)
        }
      />
      </div>
      <ScrollArea className="workspace-transition-library-scroll flex-1 min-h-0">
        <div className="workspace-transition-cards">
          <div className="workspace-transition-grid">
            {[...filtered]
              .sort((a, b) => {
                const order = [
                  "crossfade",
                  "dipToBlack",
                  "dipToWhite",
                  "wipe-left",
                  "wipe-diagonal",
                  "circleReveal",
                  "slide",
                  "push",
                  "zoom",
                  "blur",
                  "whipPan",
                  "glitch",
                ];
                const ai = order.indexOf(a.id ?? a.type),
                  bi = order.indexOf(b.id ?? b.type);
                return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
              })
              .filter(
                (_, index) =>
                  searchOpen || categoryFilter !== "All" || index < 12,
              )
              .map((def) => (
                <div
                  key={def.id ?? `${def.type}-${def.label}`}
                  data-selected={selectedTransition === def}
                >
                  <TransitionCard
                    def={def}
                    selected={selectedTransition === def}
                    used={usedTransitions.has(def)}
                    onSelect={() => setSelectedTransition(def)}
                    onApply={() => void applyToSelectedCut(def)}
                  />
                </div>
              ))}
          </div>
          {filtered.length === 0 && (
            <span className="text-fg-2 font-normal block text-center text-[10.5px] py-6"
            >
              No transitions match "{query}".
            </span>
          )}
        </div>
      </ScrollArea>{" "}
      <div className="workspace-transition-footer">
        <Button
          variant="secondary"
          className="w-full h-[34px] rounded-lg text-xs font-semibold"
          disabled={applyingAll || exporting || Boolean(playbackLocked)}
          onClick={async () => {
            if (applyingAllRef.current || useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return;
            const owner = useProjectStore.getState();
            const isCurrent = () => {
              const latest = useProjectStore.getState();
              return latest.project.id === owner.project.id && latest.actionExecutor === owner.actionExecutor
                && !useUIStore.getState().exportState.isExporting && !useTimelineStore.getState().playbackLockedReason;
            };
            applyingAllRef.current = true;
            setApplyingAll(true);
            let count = 0;
            owner.actionHistory.beginGroup("Apply transitions to all cuts");
            try {
              const bridge = getTransitionBridge();
              if (!bridge.isInitialized())
                bridge.initialize(
                  owner.project.settings.width,
                  owner.project.settings.height,
                );
              for (const candidate of getLibraryTransitionCuts(
                owner.project.timeline.tracks, owner.project.settings.frameRate,
              )) {
                if (!isCurrent()) return;
                const current = useProjectStore.getState().project;
                const track = current.timeline.tracks.find(track => track.id === candidate.clipA.trackId);
                if (!track || track.locked) continue;
                const clipA = track.clips.find(clip => clip.id === candidate.clipA.id);
                const clipB = track.clips.find(clip => clip.id === candidate.clipB.id);
                if (!clipA || !clipB || Math.abs(clipA.startTime + clipA.duration - clipB.startTime) > 1 / current.settings.frameRate) continue;
                const result = bridge.createTransition(
                  clipA,
                  clipB,
                  selectedTransition.type,
                  duration,
                  {
                    ...bridge.getDefaultParams(selectedTransition.type),
                    ...selectedTransition.params,
                  },
                );
                if (result.success && result.transitionId) {
                  const transition = bridge.getTransition(
                    result.transitionId,
                  );
                  if (transition && (await addClipTransition(transition)))
                    count++;
                }
              }
              if (!isCurrent()) return;
              if (count)
                toast.success(
                  "Transitions applied",
                  `${selectedTransition.label} added to ${count} cuts.`,
                );
              else
                toast.info(
                  "No compatible cuts",
                  "Place adjacent video or image clips on an unlocked track.",
                );
            } catch (e) {
              toast.error(
                "Could not apply transitions",
                e instanceof Error ? e.message : "Try again.",
              );
            } finally {
              owner.actionHistory.endGroup();
              applyingAllRef.current = false;
              setApplyingAll(false);
            }
          }}
        >
          {`Apply ${selectedTransition.label} to ${eligibleCutCount === 1 ? "the cut" : `all ${eligibleCutCount ? `${eligibleCutCount} ` : ""}cuts`}`}
        </Button>
      </div>
    </div>
    </EffectPreviewProvider>
  );
};
