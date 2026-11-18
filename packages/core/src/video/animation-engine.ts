import type { Keyframe, EasingType } from "../types/timeline";
import {
  EASING_FUNCTIONS,
  type EasingName,
} from "../animation/easing-functions";
import { solveBezierEase } from "../animation/keyframe-bezier";

export interface BezierControlPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface InterpolationResult {
  value: unknown;
  keyframeA: Keyframe | null;
  keyframeB: Keyframe | null;
  progress: number;
}

export class AnimationEngine {
  getValueAtTime(keyframes: Keyframe[], time: number): InterpolationResult {
    if (keyframes.length === 0) {
      return {
        value: undefined,
        keyframeA: null,
        keyframeB: null,
        progress: 0,
      };
    }
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (time <= sorted[0].time) {
      return {
        value: sorted[0].value,
        keyframeA: sorted[0],
        keyframeB: null,
        progress: 0,
      };
    }
    if (time >= sorted[sorted.length - 1].time) {
      return {
        value: sorted[sorted.length - 1].value,
        keyframeA: sorted[sorted.length - 1],
        keyframeB: null,
        progress: 1,
      };
    }
    let keyframeA: Keyframe | null = null;
    let keyframeB: Keyframe | null = null;

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
      };
    }
    const duration = keyframeB.time - keyframeA.time;
    const elapsed = time - keyframeA.time;
    const linearProgress = duration > 0 ? elapsed / duration : 0;
    const easedProgress = this.applyKeyframeEasing(linearProgress, keyframeA);
    const value = this.interpolateValue(
      keyframeA.value,
      keyframeB.value,
      easedProgress,
    );

    return {
      value,
      keyframeA,
      keyframeB,
      progress: easedProgress,
    };
  }

  interpolate(kf1: Keyframe, kf2: Keyframe, time: number): unknown {
    const [keyframeA, keyframeB] =
      kf1.time <= kf2.time ? [kf1, kf2] : [kf2, kf1];
    const clampedTime = Math.max(
      keyframeA.time,
      Math.min(keyframeB.time, time),
    );
    const duration = keyframeB.time - keyframeA.time;
    const elapsed = clampedTime - keyframeA.time;
    const linearProgress = duration > 0 ? elapsed / duration : 0;
    const easedProgress = this.applyKeyframeEasing(linearProgress, keyframeA);
    return this.interpolateValue(
      keyframeA.value,
      keyframeB.value,
      easedProgress,
    );
  }

  /** Easing for the segment leaving `keyframe`, honouring its saved Bezier handles. */
  applyKeyframeEasing(t: number, keyframe: Keyframe): number {
    const handles = keyframe.bezierHandles;
    if (keyframe.easing === "bezier" && handles) {
      return this.applyEasing(t, "bezier", {
        x1: handles.in.x,
        y1: handles.in.y,
        x2: handles.out.x,
        y2: handles.out.y,
      });
    }
    return this.applyEasing(t, keyframe.easing);
  }

  applyEasing(
    t: number,
    easing: EasingType,
    bezierPoints?: BezierControlPoints,
  ): number {
    const clampedT = Math.max(0, Math.min(1, t));

    if (easing === "bezier") {
      if (bezierPoints) {
        return this.cubicBezier(
          clampedT,
          bezierPoints.x1,
          bezierPoints.y1,
          bezierPoints.x2,
          bezierPoints.y2,
        );
      }
      return this.cubicBezier(clampedT, 0.25, 0.1, 0.25, 1.0);
    }

    if (easing === "ease-in") {
      return EASING_FUNCTIONS.easeInQuad(clampedT);
    }

    if (easing === "ease-out") {
      return EASING_FUNCTIONS.easeOutQuad(clampedT);
    }

    if (easing === "ease-in-out") {
      return EASING_FUNCTIONS.easeInOutQuad(clampedT);
    }

    const easingFn = EASING_FUNCTIONS[easing as EasingName];
    if (easingFn) {
      return easingFn(clampedT);
    }

    return clampedT;
  }

  cubicBezier(
    t: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
    // Shared solver: handle time is clamped to [0,1] (monotonic), so preview,
    // export and the graph editor evaluate the same curve.
    return solveBezierEase(t, x1, y1, x2, y2);
  }

  interpolateValue(
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
  // Keyframe CRUD Operations
  addKeyframe(keyframes: Keyframe[], keyframe: Keyframe): Keyframe[] {
    const existingIndex = keyframes.findIndex(
      (kf) => kf.time === keyframe.time && kf.property === keyframe.property,
    );

    if (existingIndex >= 0) {
      const result = [...keyframes];
      result[existingIndex] = keyframe;
      return result;
    }
    return [...keyframes, keyframe].sort((a, b) => a.time - b.time);
  }

  removeKeyframe(keyframes: Keyframe[], keyframeId: string): Keyframe[] {
    return keyframes.filter((kf) => kf.id !== keyframeId);
  }

  updateKeyframe(
    keyframes: Keyframe[],
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id">>,
  ): Keyframe[] {
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

  getKeyframesForProperty(keyframes: Keyframe[], property: string): Keyframe[] {
    return keyframes
      .filter((kf) => kf.property === property)
      .sort((a, b) => a.time - b.time);
  }

  findKeyframeAtTime(
    keyframes: Keyframe[],
    property: string,
    time: number,
    tolerance: number = 0.001,
  ): Keyframe | null {
    return (
      keyframes.find(
        (kf) =>
          kf.property === property && Math.abs(kf.time - time) <= tolerance,
      ) || null
    );
  }

  clearCache(): void {
  }
}