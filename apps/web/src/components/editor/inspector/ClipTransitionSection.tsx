import type { JSX } from "react";
import React, { useCallback, useState, useMemo } from "react";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Eye,
  Circle,
  Square,
  Diamond,
  Star,
  Droplets,
} from "@/icons/lucide-compat";
import type {
  Clip as TimelineClip,
  Keyframe,
  EasingType,
  Transform,
  GraphicClip,
  Transition,
  TransitionEdge,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import { toast } from "../../../stores/notification-store";
import { TransitionInspector } from "./TransitionInspector";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

type MutableGraphicClip = {
  -readonly [K in keyof GraphicClip]: GraphicClip[K];
};

type TransitionPreset =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "zoom-in"
  | "zoom-out"
  | "rotate"
  | "blur"
  | "iris-circle"
  | "iris-rectangle"
  | "iris-diamond"
  | "iris-star";

interface TransitionConfig {
  preset: TransitionPreset;
  duration: number;
  easing: EasingType;
}

const PRESETS: {
  id: TransitionPreset;
  label: string;
  icon: JSX.Element | null;
}[] = [
  { id: "none", label: "None", icon: null },
  { id: "fade", label: "Fade", icon: <Eye size={12} /> },
  { id: "slide-left", label: "Slide Left", icon: <ArrowLeft size={12} /> },
  { id: "slide-right", label: "Slide Right", icon: <ArrowRight size={12} /> },
  { id: "slide-up", label: "Slide Up", icon: <ArrowUp size={12} /> },
  { id: "slide-down", label: "Slide Down", icon: <ArrowDown size={12} /> },
  { id: "zoom-in", label: "Zoom In", icon: <ZoomIn size={12} /> },
  { id: "zoom-out", label: "Zoom Out", icon: <ZoomOut size={12} /> },
  { id: "rotate", label: "Rotate", icon: <RotateCw size={12} /> },
  { id: "blur", label: "Blur", icon: <Droplets size={12} /> },
  { id: "iris-circle", label: "Iris Circle", icon: <Circle size={12} /> },
  { id: "iris-rectangle", label: "Iris Rect", icon: <Square size={12} /> },
  { id: "iris-diamond", label: "Iris Diamond", icon: <Diamond size={12} /> },
  { id: "iris-star", label: "Iris Star", icon: <Star size={12} /> },
];

const EASINGS: { id: EasingType; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "ease-in", label: "Ease In" },
  { id: "ease-out", label: "Ease Out" },
  { id: "ease-in-out", label: "Ease In Out" },
];

interface ClipTransitionSectionProps {
  clipId: string;
}

interface ClipLike {
  id: string;
  duration: number;
  transform: Transform;
  keyframes?: Keyframe[];
}

type ClipType = "regular" | "text";

interface CanvasDimensions {
  width: number;
  height: number;
}

interface AdjacentTransitionConfig {
  key: "incoming" | "outgoing";
  title: string;
  description: string;
  clipA: TimelineClip;
  clipB: TimelineClip;
  transition?: Transition;
}

interface EdgeTransitionConfig {
  key: "intro" | "outro";
  title: string;
  description: string;
  edge: TransitionEdge;
  transition?: Transition;
}

function calculateSlideOffsets(
  baseTransform: Transform,
  _canvas: CanvasDimensions,
): { left: number; right: number; up: number; down: number } {
  const posX = baseTransform.position.x;
  const posY = baseTransform.position.y;
  const buffer = 0.1;

  return {
    left: posX + 0.5 + buffer,
    right: 1 - posX + 0.5 + buffer,
    up: posY + 0.5 + buffer,
    down: 1 - posY + 0.5 + buffer,
  };
}

function generateKeyframes(
  clip: ClipLike,
  entryConfig: TransitionConfig,
  exitConfig: TransitionConfig,
  _clipType: ClipType,
  canvas: CanvasDimensions,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  const baseTransform = clip.transform;
  const duration = clip.duration;

  const entryEnd = entryConfig.duration;
  const exitStart = duration - exitConfig.duration;

  const offsets = calculateSlideOffsets(baseTransform, canvas);

  if (entryConfig.preset !== "none") {
    switch (entryConfig.preset) {
      case "fade":
        keyframes.push(
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-left":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.x",
            value: baseTransform.position.x - offsets.left,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.x",
            value: baseTransform.position.x,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-right":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.x",
            value: baseTransform.position.x + offsets.right,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.x",
            value: baseTransform.position.x,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-up":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.y",
            value: baseTransform.position.y - offsets.up,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.y",
            value: baseTransform.position.y,
            easing: entryConfig.easing,
          },
        );
        break;
      case "slide-down":
        keyframes.push(
          {
            id: `kf-entry-pos-0`,
            time: 0,
            property: "position.y",
            value: baseTransform.position.y + offsets.down,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-pos-1`,
            time: entryEnd,
            property: "position.y",
            value: baseTransform.position.y,
            easing: entryConfig.easing,
          },
        );
        break;
      case "zoom-in":
        keyframes.push(
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 0.3,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 0.3,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "zoom-out":
        keyframes.push(
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 1.8,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 1.8,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "rotate":
        keyframes.push(
          {
            id: `kf-entry-rot-0`,
            time: 0,
            property: "rotation",
            value: baseTransform.rotation - 90,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-rot-1`,
            time: entryEnd,
            property: "rotation",
            value: baseTransform.rotation,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 0.5,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 0.5,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "blur":
        keyframes.push(
          {
            id: `kf-entry-blur-0`,
            time: 0,
            property: "blur",
            value: 30,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-blur-1`,
            time: entryEnd,
            property: "blur",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
      case "iris-circle":
      case "iris-rectangle":
      case "iris-diamond":
      case "iris-star":
        keyframes.push(
          {
            id: `kf-entry-scale-0`,
            time: 0,
            property: "scale.x",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-1`,
            time: 0,
            property: "scale.y",
            value: 0,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-2`,
            time: entryEnd,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-scale-3`,
            time: entryEnd,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-0`,
            time: 0,
            property: "opacity",
            value: 0.5,
            easing: entryConfig.easing,
          },
          {
            id: `kf-entry-opacity-1`,
            time: entryEnd,
            property: "opacity",
            value: baseTransform.opacity,
            easing: entryConfig.easing,
          },
        );
        break;
    }
  }

  if (exitConfig.preset !== "none") {
    switch (exitConfig.preset) {
      case "fade":
        keyframes.push(
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-left":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.x",
            value: baseTransform.position.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.x",
            value: baseTransform.position.x - offsets.left,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-right":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.x",
            value: baseTransform.position.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.x",
            value: baseTransform.position.x + offsets.right,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-up":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.y",
            value: baseTransform.position.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.y",
            value: baseTransform.position.y - offsets.up,
            easing: exitConfig.easing,
          },
        );
        break;
      case "slide-down":
        keyframes.push(
          {
            id: `kf-exit-pos-0`,
            time: exitStart,
            property: "position.y",
            value: baseTransform.position.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-pos-1`,
            time: duration,
            property: "position.y",
            value: baseTransform.position.y + offsets.down,
            easing: exitConfig.easing,
          },
        );
        break;
      case "zoom-in":
        keyframes.push(
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 1.8,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 1.8,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "zoom-out":
        keyframes.push(
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 0.3,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 0.3,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "rotate":
        keyframes.push(
          {
            id: `kf-exit-rot-0`,
            time: exitStart,
            property: "rotation",
            value: baseTransform.rotation,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-rot-1`,
            time: duration,
            property: "rotation",
            value: baseTransform.rotation + 90,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 0.5,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 0.5,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "blur":
        keyframes.push(
          {
            id: `kf-exit-blur-0`,
            time: exitStart,
            property: "blur",
            value: 0,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-blur-1`,
            time: duration,
            property: "blur",
            value: 30,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0,
            easing: exitConfig.easing,
          },
        );
        break;
      case "iris-circle":
      case "iris-rectangle":
      case "iris-diamond":
      case "iris-star":
        keyframes.push(
          {
            id: `kf-exit-scale-0`,
            time: exitStart,
            property: "scale.x",
            value: baseTransform.scale.x,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-1`,
            time: exitStart,
            property: "scale.y",
            value: baseTransform.scale.y,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-2`,
            time: duration,
            property: "scale.x",
            value: 0,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-scale-3`,
            time: duration,
            property: "scale.y",
            value: 0,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-0`,
            time: exitStart,
            property: "opacity",
            value: baseTransform.opacity,
            easing: exitConfig.easing,
          },
          {
            id: `kf-exit-opacity-1`,
            time: duration,
            property: "opacity",
            value: 0.5,
            easing: exitConfig.easing,
          },
        );
        break;
    }
  }

  return keyframes;
}

function detectCurrentTransitions(clip: ClipLike): {
  entry: TransitionConfig;
  exit: TransitionConfig;
} {
  const entry: TransitionConfig = {
    preset: "none",
    duration: 0.5,
    easing: "ease-out",
  };
  const exit: TransitionConfig = {
    preset: "none",
    duration: 0.5,
    easing: "ease-in",
  };

  const keyframes = clip.keyframes || [];
  const entryKfs = keyframes.filter((kf) => kf.id.startsWith("kf-entry-"));
  const exitKfs = keyframes.filter((kf) => kf.id.startsWith("kf-exit-"));

  if (entryKfs.length > 0) {
    const opacityKf = entryKfs.find((kf) => kf.property === "opacity");
    const posXKf = entryKfs.find((kf) => kf.property === "position.x");
    const posYKf = entryKfs.find((kf) => kf.property === "position.y");
    const scaleKf = entryKfs.find((kf) => kf.property === "scale.x");
    const rotKf = entryKfs.find((kf) => kf.property === "rotation");
    const blurKf = entryKfs.find((kf) => kf.property === "blur");

    if (blurKf) entry.preset = "blur";
    else if (rotKf) entry.preset = "rotate";
    else if (scaleKf && Number(scaleKf.value) === 0)
      entry.preset = "iris-circle";
    else if (scaleKf && Number(scaleKf.value) < 1) entry.preset = "zoom-in";
    else if (scaleKf && Number(scaleKf.value) > 1) entry.preset = "zoom-out";
    else if (posXKf && Number(posXKf.value) < clip.transform.position.x)
      entry.preset = "slide-left";
    else if (posXKf && Number(posXKf.value) > clip.transform.position.x)
      entry.preset = "slide-right";
    else if (posYKf && Number(posYKf.value) < clip.transform.position.y)
      entry.preset = "slide-up";
    else if (posYKf && Number(posYKf.value) > clip.transform.position.y)
      entry.preset = "slide-down";
    else if (opacityKf) entry.preset = "fade";

    const maxTime = Math.max(...entryKfs.map((kf) => kf.time));
    if (maxTime > 0) entry.duration = maxTime;
    const firstKf = entryKfs[0];
    if (firstKf) entry.easing = firstKf.easing;
  }

  if (exitKfs.length > 0) {
    const opacityKf = exitKfs.find(
      (kf) => kf.property === "opacity" && kf.time === clip.duration,
    );
    const posXKf = exitKfs.find(
      (kf) => kf.property === "position.x" && kf.time === clip.duration,
    );
    const posYKf = exitKfs.find(
      (kf) => kf.property === "position.y" && kf.time === clip.duration,
    );
    const scaleKf = exitKfs.find(
      (kf) => kf.property === "scale.x" && kf.time === clip.duration,
    );
    const rotKf = exitKfs.find(
      (kf) => kf.property === "rotation" && kf.time === clip.duration,
    );
    const blurKf = exitKfs.find(
      (kf) => kf.property === "blur" && kf.time === clip.duration,
    );

    if (blurKf) exit.preset = "blur";
    else if (rotKf) exit.preset = "rotate";
    else if (scaleKf && Number(scaleKf.value) === 0)
      exit.preset = "iris-circle";
    else if (scaleKf && Number(scaleKf.value) > 1) exit.preset = "zoom-in";
    else if (scaleKf && Number(scaleKf.value) < 1) exit.preset = "zoom-out";
    else if (posXKf && Number(posXKf.value) < clip.transform.position.x)
      exit.preset = "slide-left";
    else if (posXKf && Number(posXKf.value) > clip.transform.position.x)
      exit.preset = "slide-right";
    else if (posYKf && Number(posYKf.value) < clip.transform.position.y)
      exit.preset = "slide-up";
    else if (posYKf && Number(posYKf.value) > clip.transform.position.y)
      exit.preset = "slide-down";
    else if (opacityKf) exit.preset = "fade";

    const minTime = Math.min(
      ...exitKfs.filter((kf) => kf.id.includes("-0")).map((kf) => kf.time),
    );
    if (minTime < clip.duration) exit.duration = clip.duration - minTime;
    const firstKf = exitKfs[0];
    if (firstKf) exit.easing = firstKf.easing;
  }

  return { entry, exit };
}

export const ClipTransitionSection: React.FC<ClipTransitionSectionProps> = ({
  clipId,
}) => {
  const {
    project,
    updateClipKeyframes,
    updateTextClipKeyframes,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    addClipTransition,
    updateClipTransition,
    removeClipTransition,
  } = useProjectStore();
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);
  const { settings } = project;

  const timelineClipContext = useMemo(() => {
    for (const track of project.timeline.tracks) {
      const sortedClips = [...track.clips].sort((clipA, clipB) => {
        if (clipA.startTime !== clipB.startTime) {
          return clipA.startTime - clipB.startTime;
        }

        return clipA.id.localeCompare(clipB.id);
      });
      const clipIndex = sortedClips.findIndex((candidate) => candidate.id === clipId);

      if (clipIndex === -1) {
        continue;
      }

      const currentClip = sortedClips[clipIndex];
      const previousClip = clipIndex > 0 ? sortedClips[clipIndex - 1] : undefined;
      const nextClip =
        clipIndex < sortedClips.length - 1 ? sortedClips[clipIndex + 1] : undefined;

      return {
        currentClip,
        previousClip,
        nextClip,
        trackType: track.type,
        introTransition: track.transitions.find(
          (transition) =>
            transition.clipAId === currentClip.id &&
            !transition.clipBId &&
            (transition.edge ?? "out") === "in",
        ),
        outroTransition: track.transitions.find(
          (transition) =>
            transition.clipAId === currentClip.id &&
            !transition.clipBId &&
            (transition.edge ?? "out") === "out",
        ),
        incomingTransition: previousClip
          ? track.transitions.find(
              (transition) =>
                transition.clipAId === previousClip.id &&
                transition.clipBId === currentClip.id,
            )
          : undefined,
        outgoingTransition: nextClip
          ? track.transitions.find(
              (transition) =>
                transition.clipAId === currentClip.id &&
                transition.clipBId === nextClip.id,
            )
          : undefined,
      };
    }

    return null;
  }, [project.timeline.tracks, clipId]);

  const clip = useMemo(() => {
    const regularClip = timelineClipContext?.currentClip;
    if (regularClip)
      return { type: "regular" as const, data: regularClip as ClipLike };

    const textClip = getTextClip(clipId);
    if (textClip) return { type: "text" as const, data: textClip as ClipLike };

    const shapeClip = getShapeClip(clipId);
    if (shapeClip)
      return { type: "shape" as const, data: shapeClip as ClipLike };

    const svgClip = getSVGClip(clipId);
    if (svgClip) return { type: "svg" as const, data: svgClip as ClipLike };

    const stickerClip = getStickerClip(clipId);
    if (stickerClip)
      return { type: "sticker" as const, data: stickerClip as ClipLike };

    return null;
  }, [
    timelineClipContext,
    clipId,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    getTitleEngine,
    project.modifiedAt,
  ]);

  const adjacentTransitions = useMemo<AdjacentTransitionConfig[]>(() => {
    if (!timelineClipContext) {
      return [];
    }

    const transitions: AdjacentTransitionConfig[] = [];

    if (timelineClipContext.previousClip) {
      transitions.push({
        key: "incoming",
        title: "Incoming Transition",
        description: "From the previous clip into this clip",
        clipA: timelineClipContext.previousClip,
        clipB: timelineClipContext.currentClip,
        transition: timelineClipContext.incomingTransition,
      });
    }

    if (timelineClipContext.nextClip) {
      transitions.push({
        key: "outgoing",
        title: "Outgoing Transition",
        description: "From this clip into the next clip",
        clipA: timelineClipContext.currentClip,
        clipB: timelineClipContext.nextClip,
        transition: timelineClipContext.outgoingTransition,
      });
    }

    return transitions;
  }, [timelineClipContext]);

  const edgeTransitions = useMemo<EdgeTransitionConfig[]>(() => {
    if (
      !timelineClipContext ||
      (timelineClipContext.trackType !== "video" &&
        timelineClipContext.trackType !== "image")
    ) {
      return [];
    }

    return [
      {
        key: "intro",
        title: "Intro Transition",
        description: "From the project background into this clip",
        edge: "in",
        transition: timelineClipContext.introTransition,
      },
      {
        key: "outro",
        title: "Outro Transition",
        description: "From this clip into the project background",
        edge: "out",
        transition: timelineClipContext.outroTransition,
      },
    ];
  }, [timelineClipContext]);

  const handleTransitionCreate = useCallback(
    (transition: Transition) => {
      addClipTransition(transition);
    },
    [addClipTransition],
  );

  const handleTransitionUpdate = useCallback(
    (transitionId: string, updates: Partial<Transition>) => {
      updateClipTransition(transitionId, updates);
    },
    [updateClipTransition],
  );

  const handleTransitionRemove = useCallback(
    (transitionId: string) => {
      removeClipTransition(transitionId);
    },
    [removeClipTransition],
  );

  const detected = clip
    ? detectCurrentTransitions(clip.data)
    : {
        entry: {
          preset: "none" as TransitionPreset,
          duration: 0.5,
          easing: "ease-out" as EasingType,
        },
        exit: {
          preset: "none" as TransitionPreset,
          duration: 0.5,
          easing: "ease-in" as EasingType,
        },
      };

  const [entryPreset, setEntryPreset] = useState<TransitionPreset>(
    detected.entry.preset,
  );
  const [entryDuration, setEntryDuration] = useState(detected.entry.duration);
  const [entryEasing, setEntryEasing] = useState<EasingType>(
    detected.entry.easing,
  );

  const [exitPreset, setExitPreset] = useState<TransitionPreset>(
    detected.exit.preset,
  );
  const [exitDuration, setExitDuration] = useState(detected.exit.duration);
  const [exitEasing, setExitEasing] = useState<EasingType>(
    detected.exit.easing,
  );

  const applyTransitions = useCallback(() => {
    if (!clip) {
      return;
    }

    const existingKeyframes = (clip.data.keyframes || []).filter(
      (kf) => !kf.id.startsWith("kf-entry-") && !kf.id.startsWith("kf-exit-"),
    );

    const canvas = { width: settings.width, height: settings.height };
    const clipTypeForKeyframes: ClipType =
      clip.type === "regular" || clip.type === "text" ? clip.type : "regular";
    const newKeyframes = generateKeyframes(
      clip.data,
      { preset: entryPreset, duration: entryDuration, easing: entryEasing },
      { preset: exitPreset, duration: exitDuration, easing: exitEasing },
      clipTypeForKeyframes,
      canvas,
    );

    const allKeyframes = [...existingKeyframes, ...newKeyframes];

    if (clip.type === "text") {
      updateTextClipKeyframes(clipId, allKeyframes);
    } else if (
      clip.type === "shape" ||
      clip.type === "svg" ||
      clip.type === "sticker"
    ) {
      const graphicsEngine = getGraphicsEngine();
      if (graphicsEngine) {
        const graphicsClip =
          clip.type === "shape"
            ? graphicsEngine.getShapeClip(clipId)
            : clip.type === "svg"
              ? graphicsEngine.getSVGClip(clipId)
              : graphicsEngine.getStickerClip(clipId);

        if (graphicsClip) {
          (graphicsClip as MutableGraphicClip).keyframes = allKeyframes;
          useProjectStore.setState((state) => ({
            project: { ...state.project, modifiedAt: Date.now() },
          }));
        }
      }
    } else {
      updateClipKeyframes(clipId, allKeyframes);
    }

    const parts: string[] = [];
    if (entryPreset !== "none") {
      parts.push(`Entry: ${entryPreset}`);
    }
    if (exitPreset !== "none") {
      parts.push(`Exit: ${exitPreset}`);
    }
    if (parts.length > 0) {
      toast.success("Clip Animation Applied", parts.join(", "));
    } else {
      toast.info("Animations Cleared");
    }
  }, [
    clip,
    clipId,
    entryPreset,
    entryDuration,
    entryEasing,
    exitPreset,
    exitDuration,
    exitEasing,
    updateClipKeyframes,
    updateTextClipKeyframes,
    settings,
  ]);

  if (!clip) return null;

  return (
    <div className="space-y-4">
      {/* Entry Transition */}
      <div className="space-y-2">
        <Text
          type="supporting"
          color="secondary"
          className="text-[10px] font-medium uppercase tracking-wider"
        >
          Entry Animation
        </Text>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((preset) => (
            <ClickableCard
              key={`entry-${preset.id}`}
              label={`Set entry animation to ${preset.label}`}
              onClick={() => setEntryPreset(preset.id)}
              padding={2}
              variant={entryPreset === preset.id ? "green" : "muted"}
              className={`flex items-center justify-center gap-1 border ${
                entryPreset === preset.id
                  ? "border-primary bg-primary text-white font-medium"
                  : "bg-bg-2 border border-border text-fg-2 hover:text-fg hover:border-text-muted"
              }`}
            >
              {preset.icon}
              <Text
                type="supporting"
                color="inherit"
                className="text-[9px]"
              >
                {preset.label}
              </Text>
            </ClickableCard>
          ))}
        </div>
        {entryPreset !== "none" && (
          <div className="flex gap-2 mt-2">
            <ToolcraftNumberInputControl
              label="Duration"
              size="sm"
              width="100%"
              step={0.1}
              min={0.1}
              max={clip.data.duration / 2}
              value={entryDuration}
              onChange={(value) => setEntryDuration(value || 0.5)}
              units="s"
            />
            <Selector
              label="Easing"
              size="sm"
              width="100%"
              value={entryEasing}
              onChange={(value) => setEntryEasing(value as EasingType)}
              options={EASINGS.map((e) => ({
                label: e.label,
                value: e.id,
              }))}
            />
          </div>
        )}
      </div>

      {/* Exit Transition */}
      <div className="space-y-2">
        <Text
          type="supporting"
          color="secondary"
          className="text-[10px] font-medium uppercase tracking-wider"
        >
          Exit Animation
        </Text>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((preset) => (
            <ClickableCard
              key={`exit-${preset.id}`}
              label={`Set exit animation to ${preset.label}`}
              onClick={() => setExitPreset(preset.id)}
              padding={2}
              variant={exitPreset === preset.id ? "green" : "muted"}
              className={`flex items-center justify-center gap-1 border ${
                exitPreset === preset.id
                  ? "border-primary bg-primary text-white font-medium"
                  : "bg-bg-2 border border-border text-fg-2 hover:text-fg hover:border-text-muted"
              }`}
            >
              {preset.icon}
              <Text
                type="supporting"
                color="inherit"
                className="text-[9px]"
              >
                {preset.label}
              </Text>
            </ClickableCard>
          ))}
        </div>
        {exitPreset !== "none" && (
          <div className="flex gap-2 mt-2">
            <ToolcraftNumberInputControl
              label="Duration"
              size="sm"
              width="100%"
              step={0.1}
              min={0.1}
              max={clip.data.duration / 2}
              value={exitDuration}
              onChange={(value) => setExitDuration(value || 0.5)}
              units="s"
            />
            <Selector
              label="Easing"
              size="sm"
              width="100%"
              value={exitEasing}
              onChange={(value) => setExitEasing(value as EasingType)}
              options={EASINGS.map((e) => ({
                label: e.label,
                value: e.id,
              }))}
            />
          </div>
        )}
      </div>

      {/* Apply Button */}
      <Button
        label="Apply Entry/Exit Animations"
        onClick={applyTransitions}
        variant="primary"
        size="sm"
        className="w-full justify-center"
      />

      <div className="space-y-3 border-t border-border pt-3">
        <Text
          type="supporting"
          color="secondary"
          className="text-[10px] font-medium uppercase tracking-wider"
        >
          Single-Clip Transitions
        </Text>

        {edgeTransitions.length > 0 ? (
          edgeTransitions.map((edgeTransition) => (
            <Card
              key={edgeTransition.key}
              variant="muted"
              padding={3}
              className="space-y-2 border border-border bg-bg-1"
            >
              <div className="space-y-1">
                <Text
                  type="supporting"
                  color="primary"
                  className="text-[10px] font-medium"
                >
                  {edgeTransition.title}
                </Text>
                <Text
                  type="supporting"
                  color="secondary"
                  className="text-[9px]"
                >
                  {edgeTransition.description}
                </Text>
              </div>

              {timelineClipContext && (
                <TransitionInspector
                  clipA={timelineClipContext.currentClip}
                  edge={edgeTransition.edge}
                  transition={edgeTransition.transition}
                  onTransitionCreate={handleTransitionCreate}
                  onTransitionUpdate={handleTransitionUpdate}
                  onTransitionRemove={handleTransitionRemove}
                />
              )}
            </Card>
          ))
        ) : (
          <Text type="supporting" color="secondary" className="text-[10px]">
            Single-clip transitions are available for video and image clips.
          </Text>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <Text
          type="supporting"
          color="secondary"
          className="text-[10px] font-medium uppercase tracking-wider"
        >
          Clip-to-Clip Transitions
        </Text>

        {timelineClipContext ? (
          adjacentTransitions.length > 0 ? (
            adjacentTransitions.map((adjacentTransition) => (
              <Card
                key={adjacentTransition.key}
                variant="muted"
                padding={3}
                className="space-y-2 border border-border bg-bg-1"
              >
                <div className="space-y-1">
                  <Text
                    type="supporting"
                    color="primary"
                    className="text-[10px] font-medium"
                  >
                    {adjacentTransition.title}
                  </Text>
                  <Text
                    type="supporting"
                    color="secondary"
                    className="text-[9px]"
                  >
                    {adjacentTransition.description}
                  </Text>
                </div>

                <TransitionInspector
                  clipA={adjacentTransition.clipA}
                  clipB={adjacentTransition.clipB}
                  transition={adjacentTransition.transition}
                  onTransitionCreate={handleTransitionCreate}
                  onTransitionUpdate={handleTransitionUpdate}
                  onTransitionRemove={handleTransitionRemove}
                />
              </Card>
            ))
          ) : (
            <Text type="supporting" color="secondary" className="text-[10px]">
              No adjacent clips are available on this track.
            </Text>
          )
        ) : (
          <Text type="supporting" color="secondary" className="text-[10px]">
            Clip-to-clip transitions are available for timeline media clips.
          </Text>
        )}
      </div>
    </div>
  );
};

export default ClipTransitionSection;
