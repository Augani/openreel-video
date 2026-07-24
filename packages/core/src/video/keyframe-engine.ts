import type { Keyframe, EasingType } from "../types/timeline";
import {
  EASING_FUNCTIONS,
  type EasingName,
} from "../animation/easing-functions";
import { AnimationEngine, type BezierControlPoints } from "./animation-engine";

export type EasingPreset =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "bounce"
  | "elastic"
  | "spring";

export interface BezierCurve {
  type: "bezier";
  controlPoints: [number, number, number, number]; // [x1, y1, x2, y2]
}

export interface ExtendedKeyframe extends Keyframe {
  bezierHandles?: {
    in: { x: number; y: number };
    out: { x: number; y: number };
  };
}

export interface MotionPathPoint {
  time: number;
  x: number;
  y: number;
}

export interface MotionPath {
  clipId: string;
  points: MotionPathPoint[];
  visible: boolean;
}

export interface KeyframeClipboard {
  keyframes: ExtendedKeyframe[];
  sourceClipId: string;
  sourceProperty: string;
  copiedAt: number;
}

export interface KeyframeInterpolationResult {
  value: unknown;
  keyframeA: ExtendedKeyframe | null;
  keyframeB: ExtendedKeyframe | null;
  progress: number;
  easedProgress: number;
}

export class KeyframeEngine {
  private animationEngine: AnimationEngine;
  private motionPaths: Map<string, MotionPath> = new Map();
  private clipboard: KeyframeClipboard | null = null;

  constructor(animationEngine?: AnimationEngine) {
    this.animationEngine = animationEngine || new AnimationEngine();
  }
  // Keyframe CRUD Operations
  addKeyframe(
    _clipId: string,
    property: string,
    time: number,
    value: unknown,
    easing: EasingPreset = "linear",
  ): ExtendedKeyframe {
    const keyframe: ExtendedKeyframe = {
      id: this.generateKeyframeId(),
      time,
      property,
      value,
      easing: this.mapEasingPresetToType(easing),
      bezierHandles:
        easing === "linear" ? undefined : this.getDefaultBezierHandles(easing),
    };
    return keyframe;
  }

  removeKeyframe(
    keyframes: ExtendedKeyframe[],
    keyframeId: string,
  ): ExtendedKeyframe[] {
    return keyframes.filter((kf) => kf.id !== keyframeId);
  }

  updateKeyframe(
    keyframes: ExtendedKeyframe[],
    keyframeId: string,
    updates: Partial<Omit<ExtendedKeyframe, "id">>,
  ): ExtendedKeyframe[] {
    const result = keyframes.map((kf) => {
      if (kf.id === keyframeId) {
        return { ...kf, ...updates };
      }
      return kf;
    });
    if (updates.time !== undefined) {
      result.sort((a, b) => a.time - b.time);
    }

    return result;
  }

  getKeyframe(
    keyframes: ExtendedKeyframe[],
    keyframeId: string,
  ): ExtendedKeyframe | null {
    return keyframes.find((kf) => kf.id === keyframeId) || null;
  }

  getKeyframesForProperty(
    keyframes: ExtendedKeyframe[],
    property: string,
  ): ExtendedKeyframe[] {
    return keyframes
      .filter((kf) => kf.property === property)
      .sort((a, b) => a.time - b.time);
  }

  getValueAtTime(
    keyframes: ExtendedKeyframe[],
    time: number,
  ): KeyframeInterpolationResult {
    if (keyframes.length === 0) {
      return {
        value: undefined,
        keyframeA: null,
        keyframeB: null,
        progress: 0,
        easedProgress: 0,
      };
    }
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (time <= sorted[0].time) {
      return {
        value: sorted[0].value,
        keyframeA: sorted[0],
        keyframeB: null,
        progress: 0,
        easedProgress: 0,
      };
    }
    if (time >= sorted[sorted.length - 1].time) {
      return {
        value: sorted[sorted.length - 1].value,
        keyframeA: sorted[sorted.length - 1],
        keyframeB: null,
        progress: 1,
        easedProgress: 1,
      };
    }
    let keyframeA: ExtendedKeyframe | null = null;
    let keyframeB: ExtendedKeyframe | null = null;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        keyframeA = sorted[i];
        keyframeB = sorted[i + 1];
        break;
      }
    }

    if (!keyframeA || !keyframeB) {
      return {
        value: sorted[sorted.length - 1].value,
        keyframeA: sorted[sorted.length - 1],
        keyframeB: null,
        progress: 1,
        easedProgress: 1,
      };
    }
    const duration = keyframeB.time - keyframeA.time;
    const elapsed = time - keyframeA.time;
    const linearProgress = duration > 0 ? elapsed / duration : 0;
    const easedProgress = this.applyEasing(linearProgress, keyframeA);
    const value = this.interpolateValue(
      keyframeA.value,
      keyframeB.value,
      easedProgress,
    );

    return {
      value,
      keyframeA,
      keyframeB,
      progress: linearProgress,
      easedProgress,
    };
  }
  // Easing Presets
  getEasingPresets(): EasingPreset[] {
    return [
      "linear",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "bounce",
      "elastic",
      "spring",
    ];
  }

  setEasing(
    keyframes: ExtendedKeyframe[],
    keyframeId: string,
    easing: EasingPreset | BezierCurve,
  ): ExtendedKeyframe[] {
    return keyframes.map((kf) => {
      if (kf.id === keyframeId) {
        if (typeof easing === "string") {
          return {
            ...kf,
            easing: this.mapEasingPresetToType(easing),
            bezierHandles: this.getDefaultBezierHandles(easing),
          };
        } else {
          // Custom bezier curve
          return {
            ...kf,
            easing: "bezier" as EasingType,
            bezierHandles: {
              in: { x: easing.controlPoints[0], y: easing.controlPoints[1] },
              out: { x: easing.controlPoints[2], y: easing.controlPoints[3] },
            },
          };
        }
      }
      return kf;
    });
  }

  private applyEasing(t: number, keyframe: ExtendedKeyframe): number {
    const clampedT = Math.max(0, Math.min(1, t));
    if (keyframe.bezierHandles && keyframe.easing === "bezier") {
      return this.animationEngine.cubicBezier(
        clampedT,
        keyframe.bezierHandles.in.x,
        keyframe.bezierHandles.in.y,
        keyframe.bezierHandles.out.x,
        keyframe.bezierHandles.out.y,
      );
    }
    switch (keyframe.easing) {
      case "linear":
        return clampedT;
      case "ease-in":
        return this.easeIn(clampedT);
      case "ease-out":
        return this.easeOut(clampedT);
      case "ease-in-out":
        return this.easeInOut(clampedT);
      case "bezier":
        // Default bezier if no handles specified
        return this.animationEngine.cubicBezier(clampedT, 0.25, 0.1, 0.25, 1.0);
      default:
        if (isNamedEasing(keyframe.easing)) {
          return EASING_FUNCTIONS[keyframe.easing](clampedT);
        }
        return clampedT;
    }
  }

  applyEasingPreset(t: number, preset: EasingPreset): number {
    const clampedT = Math.max(0, Math.min(1, t));

    switch (preset) {
      case "linear":
        return clampedT;
      case "ease-in":
        return this.easeIn(clampedT);
      case "ease-out":
        return this.easeOut(clampedT);
      case "ease-in-out":
        return this.easeInOut(clampedT);
      case "bounce":
        return this.bounce(clampedT);
      case "elastic":
        return this.elastic(clampedT);
      case "spring":
        return this.spring(clampedT);
      default:
        return clampedT;
    }
  }
  private easeIn(t: number): number {
    return t * t;
  }

  private easeOut(t: number): number {
    return t * (2 - t);
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private bounce(t: number): number {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      const t2 = t - 1.5 / 2.75;
      return 7.5625 * t2 * t2 + 0.75;
    } else if (t < 2.5 / 2.75) {
      const t2 = t - 2.25 / 2.75;
      return 7.5625 * t2 * t2 + 0.9375;
    } else {
      const t2 = t - 2.625 / 2.75;
      return 7.5625 * t2 * t2 + 0.984375;
    }
  }

  private elastic(t: number): number {
    if (t === 0 || t === 1) return t;
    const p = 0.3;
    const s = p / 4;
    return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
  }

  private spring(t: number): number {
    if (t === 0 || t === 1) return t;
    const factor = 0.4;
    return (
      1 -
      Math.pow(Math.cos(t * Math.PI * 4.5), 3) * Math.pow(1 - t, 2.2) * factor -
      (1 - t)
    );
  }
  // Bezier Curve Interpolation
  updateBezierHandles(
    keyframes: ExtendedKeyframe[],
    keyframeId: string,
    handles: { in: { x: number; y: number }; out: { x: number; y: number } },
  ): ExtendedKeyframe[] {
    return keyframes.map((kf) => {
      if (kf.id === keyframeId) {
        return {
          ...kf,
          easing: "bezier" as EasingType,
          bezierHandles: handles,
        };
      }
      return kf;
    });
  }

  getBezierControlPoints(
    keyframe: ExtendedKeyframe,
  ): BezierControlPoints | null {
    if (!keyframe.bezierHandles) return null;
    return {
      x1: keyframe.bezierHandles.in.x,
      y1: keyframe.bezierHandles.in.y,
      x2: keyframe.bezierHandles.out.x,
      y2: keyframe.bezierHandles.out.y,
    };
  }

  interpolateWithBezier(
    valueA: unknown,
    valueB: unknown,
    t: number,
    controlPoints: BezierControlPoints,
  ): unknown {
    const easedT = this.animationEngine.cubicBezier(
      t,
      controlPoints.x1,
      controlPoints.y1,
      controlPoints.x2,
      controlPoints.y2,
    );
    return this.interpolateValue(valueA, valueB, easedT);
  }
  copyKeyframes(
    keyframes: ExtendedKeyframe[],
    sourceClipId: string,
    sourceProperty: string,
  ): KeyframeClipboard {
    const clipboard: KeyframeClipboard = {
      keyframes: keyframes.map((kf) => ({ ...kf })),
      sourceClipId,
      sourceProperty,
      copiedAt: Date.now(),
    };
    this.clipboard = clipboard;
    return clipboard;
  }

  pasteKeyframes(
    clipboard: KeyframeClipboard,
    _targetClipId: string,
    targetProperty: string,
    timeOffset: number = 0,
  ): ExtendedKeyframe[] {
    const minTime = Math.min(...clipboard.keyframes.map((kf) => kf.time));

    return clipboard.keyframes.map((kf) => ({
      ...kf,
      id: this.generateKeyframeId(),
      property: targetProperty,
      time: kf.time - minTime + timeOffset, // Normalize to start at timeOffset
    }));
  }

  getClipboard(): KeyframeClipboard | null {
    return this.clipboard;
  }

  clearClipboard(): void {
    this.clipboard = null;
  }
  // Motion Path Visualization
  getMotionPath(
    clipId: string,
    keyframes: ExtendedKeyframe[],
    sampleCount: number = 100,
  ): MotionPath {
    const xKeyframes = this.getKeyframesForProperty(keyframes, "position.x");
    const yKeyframes = this.getKeyframesForProperty(keyframes, "position.y");

    if (xKeyframes.length === 0 && yKeyframes.length === 0) {
      return { clipId, points: [], visible: false };
    }
    const allTimes = [...xKeyframes, ...yKeyframes].map((kf) => kf.time);
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    const duration = maxTime - minTime;

    const points: MotionPathPoint[] = [];

    for (let i = 0; i <= sampleCount; i++) {
      const t = minTime + (duration * i) / sampleCount;
      const xResult = this.getValueAtTime(xKeyframes, t);
      const yResult = this.getValueAtTime(yKeyframes, t);

      points.push({
        time: t,
        x: typeof xResult.value === "number" ? xResult.value : 0,
        y: typeof yResult.value === "number" ? yResult.value : 0,
      });
    }

    const path: MotionPath = { clipId, points, visible: true };
    this.motionPaths.set(clipId, path);
    return path;
  }

  setMotionPathVisible(clipId: string, visible: boolean): void {
    const path = this.motionPaths.get(clipId);
    if (path) {
      path.visible = visible;
    }
  }
  private generateKeyframeId(): string {
    return `kf-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private mapEasingPresetToType(preset: EasingPreset): EasingType {
    switch (preset) {
      case "bounce":
      case "elastic":
      case "spring":
        return "bezier"; // These use custom bezier curves
      default:
        return preset as EasingType;
    }
  }

  private getDefaultBezierHandles(
    preset: EasingPreset,
  ):
    | { in: { x: number; y: number }; out: { x: number; y: number } }
    | undefined {
    switch (preset) {
      case "ease-in":
        return { in: { x: 0.42, y: 0 }, out: { x: 1, y: 1 } };
      case "ease-out":
        return { in: { x: 0, y: 0 }, out: { x: 0.58, y: 1 } };
      case "ease-in-out":
        return { in: { x: 0.42, y: 0 }, out: { x: 0.58, y: 1 } };
      case "bounce":
        return { in: { x: 0.34, y: 1.56 }, out: { x: 0.64, y: 1 } };
      case "elastic":
        return { in: { x: 0.68, y: -0.55 }, out: { x: 0.27, y: 1.55 } };
      case "spring":
        return { in: { x: 0.5, y: 1.5 }, out: { x: 0.5, y: 1 } };
      default:
        return undefined;
    }
  }

  private interpolateValue(
    valueA: unknown,
    valueB: unknown,
    progress: number,
  ): unknown {
    if (typeof valueA === "number" && typeof valueB === "number") {
      return valueA + (valueB - valueA) * progress;
    }
    if (
      typeof valueA === "object" &&
      typeof valueB === "object" &&
      valueA !== null &&
      valueB !== null
    ) {
      const result: Record<string, unknown> = {};
      const objA = valueA as Record<string, unknown>;
      const objB = valueB as Record<string, unknown>;

      for (const key of Object.keys(objA)) {
        if (key in objB) {
          result[key] = this.interpolateValue(objA[key], objB[key], progress);
        } else {
          result[key] = objA[key];
        }
      }

      return result;
    }
    return progress < 0.5 ? valueA : valueB;
  }
}

function isNamedEasing(easing: EasingType): easing is EasingName {
  return easing in EASING_FUNCTIONS;
}

export const keyframeEngine = new KeyframeEngine();
