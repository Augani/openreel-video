import type { EasingType } from "../types/timeline";

export interface SpeedCurvePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly keyframes: ReadonlyArray<{
    readonly time: number;
    readonly speed: number;
    readonly easing: EasingType;
  }>;
}

export const SPEED_CURVE_PRESETS: readonly SpeedCurvePreset[] = [
  {
    id: "flash",
    name: "Flash",
    description: "Quick burst of speed in the middle",
    keyframes: [
      { time: 0, speed: 0.5, easing: "easeInQuad" },
      { time: 0.3, speed: 4, easing: "easeOutQuad" },
      { time: 0.7, speed: 4, easing: "easeInQuad" },
      { time: 1, speed: 0.5, easing: "linear" },
    ],
  },
  {
    id: "smooth-slow-mo",
    name: "Smooth Slow-Mo",
    description: "Gradual slow down and speed up",
    keyframes: [
      { time: 0, speed: 1, easing: "easeInOutCubic" },
      { time: 0.3, speed: 0.3, easing: "linear" },
      { time: 0.7, speed: 0.3, easing: "easeInOutCubic" },
      { time: 1, speed: 1, easing: "linear" },
    ],
  },
  {
    id: "jump-cut",
    name: "Jump Cut",
    description: "Alternating fast and normal speed",
    keyframes: [
      { time: 0, speed: 1, easing: "linear" },
      { time: 0.2, speed: 3, easing: "linear" },
      { time: 0.4, speed: 1, easing: "linear" },
      { time: 0.6, speed: 3, easing: "linear" },
      { time: 0.8, speed: 1, easing: "linear" },
      { time: 1, speed: 3, easing: "linear" },
    ],
  },
  {
    id: "montage",
    name: "Montage",
    description: "Gradual acceleration throughout",
    keyframes: [
      { time: 0, speed: 1, easing: "easeInQuart" },
      { time: 0.5, speed: 1.5, easing: "easeInQuart" },
      { time: 1, speed: 3, easing: "linear" },
    ],
  },
  {
    id: "hero-moment",
    name: "Hero Moment",
    description: "Dramatic slow-down at the peak",
    keyframes: [
      { time: 0, speed: 1.5, easing: "easeInCubic" },
      { time: 0.35, speed: 0.2, easing: "linear" },
      { time: 0.65, speed: 0.2, easing: "easeOutCubic" },
      { time: 1, speed: 1.5, easing: "linear" },
    ],
  },
  {
    id: "bullet-time",
    name: "Bullet Time",
    description: "Near freeze in the center",
    keyframes: [
      { time: 0, speed: 2, easing: "easeInExpo" },
      { time: 0.4, speed: 0.1, easing: "linear" },
      { time: 0.6, speed: 0.1, easing: "easeOutExpo" },
      { time: 1, speed: 2, easing: "linear" },
    ],
  },
];
