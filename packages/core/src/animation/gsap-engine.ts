import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import type { EasingType, Keyframe } from "../types/timeline";

gsap.registerPlugin(MotionPathPlugin);

export interface GSAPMotionPathPoint {
  x: number;
  y: number;
  time: number;
  controlPoints?: {
    cp1: { x: number; y: number };
    cp2: { x: number; y: number };
  };
}

export interface MotionPathConfig {
  clipId: string;
  enabled: boolean;
  pathType: "linear" | "bezier" | "catmull-rom";
  points: GSAPMotionPathPoint[];
  showPath: boolean;
  autoOrient: boolean;
  alignOrigin: [number, number];
}

export interface GSAPAnimationConfig {
  duration: number;
  ease: string;
  delay?: number;
  repeat?: number;
  yoyo?: boolean;
}

const GSAP_EASING_MAP: Record<EasingType, string> = {
  linear: "none",
  "ease-in": "power2.in",
  "ease-out": "power2.out",
  "ease-in-out": "power2.inOut",
  bezier: "power2.inOut",
  easeInQuad: "power1.in",
  easeOutQuad: "power1.out",
  easeInOutQuad: "power1.inOut",
  easeInCubic: "power2.in",
  easeOutCubic: "power2.out",
  easeInOutCubic: "power2.inOut",
  easeInQuart: "power3.in",
  easeOutQuart: "power3.out",
  easeInOutQuart: "power3.inOut",
  easeInQuint: "power4.in",
  easeOutQuint: "power4.out",
  easeInOutQuint: "power4.inOut",
  easeInSine: "sine.in",
  easeOutSine: "sine.out",
  easeInOutSine: "sine.inOut",
  easeInExpo: "expo.in",
  easeOutExpo: "expo.out",
  easeInOutExpo: "expo.inOut",
  easeInCirc: "circ.in",
  easeOutCirc: "circ.out",
  easeInOutCirc: "circ.inOut",
  easeInBack: "back.in",
  easeOutBack: "back.out",
  easeInOutBack: "back.inOut",
  easeInElastic: "elastic.in",
  easeOutElastic: "elastic.out",
  easeInOutElastic: "elastic.inOut",
  easeInBounce: "bounce.in",
  easeOutBounce: "bounce.out",
  easeInOutBounce: "bounce.inOut",
};

export function easingToGSAP(easing: EasingType): string {
  return GSAP_EASING_MAP[easing] || "none";
}

export function sampleMotionPath(
  points: GSAPMotionPathPoint[],
  time: number
): { x: number; y: number; rotation?: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };

  const sortedPoints = [...points].sort((a, b) => a.time - b.time);

  if (time <= sortedPoints[0].time) {
    return { x: sortedPoints[0].x, y: sortedPoints[0].y };
  }

  if (time >= sortedPoints[sortedPoints.length - 1].time) {
    const last = sortedPoints[sortedPoints.length - 1];
    return { x: last.x, y: last.y };
  }

  let startIdx = 0;
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    if (time >= sortedPoints[i].time && time <= sortedPoints[i + 1].time) {
      startIdx = i;
      break;
    }
  }

  const p0 = sortedPoints[startIdx];
  const p1 = sortedPoints[startIdx + 1];
  const segmentDuration = p1.time - p0.time;
  const t = segmentDuration > 0 ? (time - p0.time) / segmentDuration : 0;

  if (p0.controlPoints && p1.controlPoints) {
    return cubicBezierInterpolate(
      { x: p0.x, y: p0.y },
      p0.controlPoints.cp2,
      p1.controlPoints.cp1,
      { x: p1.x, y: p1.y },
      t
    );
  }

  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
  };
}

function cubicBezierInterpolate(
  p0: { x: number; y: number },
  cp1: { x: number; y: number },
  cp2: { x: number; y: number },
  p1: { x: number; y: number },
  t: number
): { x: number; y: number; rotation?: number } {
  const oneMinusT = 1 - t;
  const oneMinusT2 = oneMinusT * oneMinusT;
  const oneMinusT3 = oneMinusT2 * oneMinusT;
  const t2 = t * t;
  const t3 = t2 * t;

  const x =
    oneMinusT3 * p0.x +
    3 * oneMinusT2 * t * cp1.x +
    3 * oneMinusT * t2 * cp2.x +
    t3 * p1.x;

  const y =
    oneMinusT3 * p0.y +
    3 * oneMinusT2 * t * cp1.y +
    3 * oneMinusT * t2 * cp2.y +
    t3 * p1.y;

  const dt = 0.001;
  const tNext = Math.min(1, t + dt);
  const oneMinusTNext = 1 - tNext;
  const xNext =
    Math.pow(oneMinusTNext, 3) * p0.x +
    3 * Math.pow(oneMinusTNext, 2) * tNext * cp1.x +
    3 * oneMinusTNext * Math.pow(tNext, 2) * cp2.x +
    Math.pow(tNext, 3) * p1.x;
  const yNext =
    Math.pow(oneMinusTNext, 3) * p0.y +
    3 * Math.pow(oneMinusTNext, 2) * tNext * cp1.y +
    3 * oneMinusTNext * Math.pow(tNext, 2) * cp2.y +
    Math.pow(tNext, 3) * p1.y;

  const rotation = Math.atan2(yNext - y, xNext - x) * (180 / Math.PI);

  return { x, y, rotation };
}

export function catmullRomInterpolate(
  points: GSAPMotionPathPoint[],
  t: number,
  tension: number = 0.5
): { x: number; y: number } {
  if (points.length < 2) {
    return points[0] || { x: 0, y: 0 };
  }

  const numSegments = points.length - 1;
  const segment = Math.min(Math.floor(t * numSegments), numSegments - 1);
  const localT = (t * numSegments) % 1;

  const p0 = points[Math.max(0, segment - 1)];
  const p1 = points[segment];
  const p2 = points[Math.min(points.length - 1, segment + 1)];
  const p3 = points[Math.min(points.length - 1, segment + 2)];

  const t2 = localT * localT;
  const t3 = t2 * localT;

  const m1x = tension * (p2.x - p0.x);
  const m1y = tension * (p2.y - p0.y);
  const m2x = tension * (p3.x - p1.x);
  const m2y = tension * (p3.y - p1.y);

  const a = 2 * t3 - 3 * t2 + 1;
  const b = t3 - 2 * t2 + localT;
  const c = -2 * t3 + 3 * t2;
  const d = t3 - t2;

  return {
    x: a * p1.x + b * m1x + c * p2.x + d * m2x,
    y: a * p1.y + b * m1y + c * p2.y + d * m2y,
  };
}

export function generateBezierPath(points: GSAPMotionPathPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const sortedPoints = [...points].sort((a, b) => a.time - b.time);
  let path = `M ${sortedPoints[0].x} ${sortedPoints[0].y}`;

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p0 = sortedPoints[i];
    const p1 = sortedPoints[i + 1];

    if (p0.controlPoints && p1.controlPoints) {
      path += ` C ${p0.controlPoints.cp2.x} ${p0.controlPoints.cp2.y}, ${p1.controlPoints.cp1.x} ${p1.controlPoints.cp1.y}, ${p1.x} ${p1.y}`;
    } else {
      const cp1x = p0.x + (p1.x - p0.x) / 3;
      const cp1y = p0.y + (p1.y - p0.y) / 3;
      const cp2x = p0.x + (2 * (p1.x - p0.x)) / 3;
      const cp2y = p0.y + (2 * (p1.y - p0.y)) / 3;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
  }

  return path;
}

export function generateDefaultControlPoints(
  points: GSAPMotionPathPoint[]
): GSAPMotionPathPoint[] {
  if (points.length < 2) return points;

  const sortedPoints = [...points].sort((a, b) => a.time - b.time);

  return sortedPoints.map((point, i) => {
    if (point.controlPoints) return point;

    const prev = sortedPoints[i - 1];
    const next = sortedPoints[i + 1];

    let tangentX = 0;
    let tangentY = 0;

    if (prev && next) {
      tangentX = (next.x - prev.x) / 4;
      tangentY = (next.y - prev.y) / 4;
    } else if (next) {
      tangentX = (next.x - point.x) / 3;
      tangentY = (next.y - point.y) / 3;
    } else if (prev) {
      tangentX = (point.x - prev.x) / 3;
      tangentY = (point.y - prev.y) / 3;
    }

    return {
      ...point,
      controlPoints: {
        cp1: { x: point.x - tangentX, y: point.y - tangentY },
        cp2: { x: point.x + tangentX, y: point.y + tangentY },
      },
    };
  });
}

export function keyframesToMotionPath(
  keyframes: Keyframe[],
  clipDuration: number
): GSAPMotionPathPoint[] {
  const positionKeyframes = keyframes.filter(
    (kf) => kf.property === "position.x" || kf.property === "position.y"
  );

  const timeGroups = new Map<number, { x?: number; y?: number }>();

  for (const kf of positionKeyframes) {
    if (!timeGroups.has(kf.time)) {
      timeGroups.set(kf.time, {});
    }
    const group = timeGroups.get(kf.time)!;
    if (kf.property === "position.x") {
      group.x = kf.value as number;
    } else {
      group.y = kf.value as number;
    }
  }

  const points: GSAPMotionPathPoint[] = [];

  for (const [time, pos] of timeGroups) {
    if (pos.x !== undefined && pos.y !== undefined) {
      points.push({
        x: pos.x,
        y: pos.y,
        time: time / clipDuration,
      });
    }
  }

  return generateDefaultControlPoints(
    points.sort((a, b) => a.time - b.time)
  );
}

export function motionPathToKeyframes(
  points: GSAPMotionPathPoint[],
  clipDuration: number,
  easing: EasingType = "easeInOutCubic"
): Keyframe[] {
  const keyframes: Keyframe[] = [];

  for (const point of points) {
    const time = point.time * clipDuration;

    keyframes.push({
      id: `kf-pos-x-${time}`,
      time,
      property: "position.x",
      value: point.x,
      easing,
    });

    keyframes.push({
      id: `kf-pos-y-${time}`,
      time,
      property: "position.y",
      value: point.y,
      easing,
    });
  }

  return keyframes;
}

class GSAPAnimationEngine {
  private timelines: Map<string, gsap.core.Timeline> = new Map();
  private motionPaths: Map<string, MotionPathConfig> = new Map();

  createTimeline(clipId: string, config?: GSAPAnimationConfig): gsap.core.Timeline {
    if (this.timelines.has(clipId)) {
      this.timelines.get(clipId)!.kill();
    }

    const timeline = gsap.timeline({
      paused: true,
      defaults: {
        duration: config?.duration || 1,
        ease: config?.ease || "none",
      },
    });

    this.timelines.set(clipId, timeline);
    return timeline;
  }

  getTimeline(clipId: string): gsap.core.Timeline | undefined {
    return this.timelines.get(clipId);
  }

  removeTimeline(clipId: string): void {
    const timeline = this.timelines.get(clipId);
    if (timeline) {
      timeline.kill();
      this.timelines.delete(clipId);
    }
  }

  setMotionPath(clipId: string, config: Omit<MotionPathConfig, "clipId">): void {
    this.motionPaths.set(clipId, { ...config, clipId });
  }

  getMotionPath(clipId: string): MotionPathConfig | undefined {
    return this.motionPaths.get(clipId);
  }

  removeMotionPath(clipId: string): void {
    this.motionPaths.delete(clipId);
  }

  updateGSAPMotionPathPoint(
    clipId: string,
    pointIndex: number,
    updates: Partial<GSAPMotionPathPoint>
  ): void {
    const config = this.motionPaths.get(clipId);
    if (!config || pointIndex < 0 || pointIndex >= config.points.length) return;

    config.points[pointIndex] = { ...config.points[pointIndex], ...updates };
    this.motionPaths.set(clipId, config);
  }

  addGSAPMotionPathPoint(clipId: string, point: GSAPMotionPathPoint): void {
    const config = this.motionPaths.get(clipId);
    if (!config) return;

    config.points.push(point);
    config.points.sort((a, b) => a.time - b.time);
    config.points = generateDefaultControlPoints(config.points);
    this.motionPaths.set(clipId, config);
  }

  removeGSAPMotionPathPoint(clipId: string, pointIndex: number): void {
    const config = this.motionPaths.get(clipId);
    if (!config || pointIndex < 0 || pointIndex >= config.points.length) return;
    if (config.points.length <= 2) return;

    config.points.splice(pointIndex, 1);
    config.points = generateDefaultControlPoints(config.points);
    this.motionPaths.set(clipId, config);
  }

  samplePositionAtTime(
    clipId: string,
    time: number,
    clipDuration: number
  ): { x: number; y: number; rotation?: number } | null {
    const config = this.motionPaths.get(clipId);
    if (!config || !config.enabled || config.points.length === 0) return null;

    const normalizedTime = clipDuration > 0 ? time / clipDuration : 0;
    const clampedTime = Math.max(0, Math.min(1, normalizedTime));

    if (config.pathType === "catmull-rom") {
      return catmullRomInterpolate(config.points, clampedTime);
    }

    return sampleMotionPath(config.points, clampedTime);
  }

  getSVGPath(clipId: string): string {
    const config = this.motionPaths.get(clipId);
    if (!config) return "";

    return generateBezierPath(config.points);
  }

  sampleFrameTransforms(
    clipId: string,
    startTime: number,
    endTime: number,
    frameRate: number
  ): Array<{ time: number; x: number; y: number; rotation?: number }> {
    const config = this.motionPaths.get(clipId);
    if (!config || !config.enabled) return [];

    const frames: Array<{ time: number; x: number; y: number; rotation?: number }> = [];
    const duration = endTime - startTime;
    const frameCount = Math.ceil(duration * frameRate);

    for (let i = 0; i <= frameCount; i++) {
      const time = startTime + (i / frameRate);
      const normalizedTime = duration > 0 ? (time - startTime) / duration : 0;
      const position = sampleMotionPath(config.points, normalizedTime);
      if (position) {
        frames.push({ time, ...position });
      }
    }

    return frames;
  }

  dispose(): void {
    for (const timeline of this.timelines.values()) {
      timeline.kill();
    }
    this.timelines.clear();
    this.motionPaths.clear();
  }
}

let gsapEngineInstance: GSAPAnimationEngine | null = null;

export function getGSAPEngine(): GSAPAnimationEngine {
  if (!gsapEngineInstance) {
    gsapEngineInstance = new GSAPAnimationEngine();
  }
  return gsapEngineInstance;
}

export function disposeGSAPEngine(): void {
  if (gsapEngineInstance) {
    gsapEngineInstance.dispose();
    gsapEngineInstance = null;
  }
}

export { GSAPAnimationEngine };
