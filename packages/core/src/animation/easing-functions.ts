export type EasingName =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "hold"
  | "bezier"
  | "smoothstep"
  | "smootherstep"
  | "snappy"
  | "smooth"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInQuint"
  | "easeOutQuint"
  | "easeInOutQuint"
  | "easeInSine"
  | "easeOutSine"
  | "easeInOutSine"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInCirc"
  | "easeOutCirc"
  | "easeInOutCirc"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack"
  | "easeInBackStrong"
  | "easeOutBackStrong"
  | "easeInOutBackStrong"
  | "easeInElastic"
  | "easeOutElastic"
  | "easeInOutElastic"
  | "easeInElasticSoft"
  | "easeOutElasticSoft"
  | "easeInOutElasticSoft"
  | "easeInBounce"
  | "easeOutBounce"
  | "easeInOutBounce"
  | "easeInBounceSmall"
  | "easeOutBounceSmall"
  | "easeInOutBounceSmall";

export interface CubicBezierEasing {
  type: "cubicBezier";
  points: [number, number, number, number];
}

export interface SpringEasing {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

export type EasingFunction = EasingName | CubicBezierEasing | SpringEasing;

export type EasingFn = (t: number) => number;

const PI = Math.PI;
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * PI) / 3;
const c5 = (2 * PI) / 4.5;

// Bounce easing: starts slow and accelerates with bouncing at the end
// Uses quadratic approximations for 4 parabolic segments that model spring bounce
const bounceOut: EasingFn = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

const elasticIn: EasingFn = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);

const elasticOut: EasingFn = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;

const elasticInOut: EasingFn = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 +
          1;

export const EASING_FUNCTIONS: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - (1 - t) * (1 - t),
  "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  hold: (t) => (t >= 1 ? 1 : 0),
  bezier: cubicBezier(0.25, 0.1, 0.25, 1),
  smoothstep: (t) => t * t * (3 - 2 * t),
  smootherstep: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  snappy: cubicBezier(0.19, 1, 0.22, 1),
  smooth: cubicBezier(0.4, 0, 0.2, 1),

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutQuart: (t) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2,

  easeInQuint: (t) => t * t * t * t * t,
  easeOutQuint: (t) => 1 - Math.pow(1 - t, 5),
  easeInOutQuint: (t) =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2,

  easeInSine: (t) => 1 - Math.cos((t * PI) / 2),
  easeOutSine: (t) => Math.sin((t * PI) / 2),
  easeInOutSine: (t) => -(Math.cos(PI * t) - 1) / 2,

  easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,

  easeInCirc: (t) => 1 - Math.sqrt(1 - Math.pow(t, 2)),
  easeOutCirc: (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  easeInOutCirc: (t) =>
    t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,

  easeInBack: (t) => c3 * t * t * t - c1 * t * t,
  easeOutBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  easeInOutBack: (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  easeInBackStrong: (t) => {
    const overshoot = 2.70158;
    return (overshoot + 1) * t * t * t - overshoot * t * t;
  },
  easeOutBackStrong: (t) => {
    const overshoot = 2.70158;
    return 1 + (overshoot + 1) * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
  },
  easeInOutBackStrong: (t) => {
    const overshoot = 2.70158 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((overshoot + 1) * 2 * t - overshoot)) / 2
      : (Math.pow(2 * t - 2, 2) * ((overshoot + 1) * (t * 2 - 2) + overshoot) + 2) / 2;
  },

  easeInElastic: elasticIn,
  easeOutElastic: elasticOut,
  easeInOutElastic: elasticInOut,
  easeInElasticSoft: (t) => t + (elasticIn(t) - t) * 0.65,
  easeOutElasticSoft: (t) => t + (elasticOut(t) - t) * 0.65,
  easeInOutElasticSoft: (t) => t + (elasticInOut(t) - t) * 0.65,

  easeInBounce: (t) => 1 - bounceOut(1 - t),
  easeOutBounce: bounceOut,
  easeInOutBounce: (t) =>
    t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2,
  easeInBounceSmall: (t) => t + (1 - bounceOut(1 - t) - t) * 0.82,
  easeOutBounceSmall: (t) => t + (bounceOut(t) - t) * 0.82,
  easeInOutBounceSmall: (t) => {
    const bounced = t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2;
    return t + (bounced - t) * 0.82;
  },
};

/**
 * Creates a cubic bezier easing function from 4 control points.
 * Converts 2D bezier curve into 1D easing function by solving for t.x = input,
 * then evaluating t.y at that t value.
 *
 * Uses hybrid root-finding: first Newton-Raphson for speed, then bisection fallback
 * for robustness when Newton-Raphson fails (flat curves with low derivative).
 * @param x1 First control point X (0-1)
 * @param y1 First control point Y (can be 0-1 range for valid easing)
 * @param x2 Second control point X (0-1)
 * @param y2 Second control point Y
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): EasingFn {
  // Convert bezier coefficients to cubic polynomial: at^3 + bt^2 + ct + d
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  // Horner's form for efficient polynomial evaluation
  const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;
  // Derivative for Newton-Raphson root finding
  const sampleCurveDerivativeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveCurveX = (x: number) => {
    let t2 = x;
    // Newton-Raphson iteration: t_new = t - f(t)/f'(t) for fast convergence
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t2) - x;
      if (Math.abs(x2) < 1e-6) return t2;
      const d2 = sampleCurveDerivativeX(t2);
      if (Math.abs(d2) < 1e-6) break; // Derivative too small, switch to bisection
      t2 = t2 - x2 / d2;
    }

    let t0 = 0;
    let t1 = 1;
    t2 = x;

    // Bisection method: binary search for root (guaranteed to converge)
    while (t0 < t1) {
      const x2 = sampleCurveX(t2);
      if (Math.abs(x2 - x) < 1e-6) return t2;
      if (x > x2)
        t0 = t2; // Root is in upper half
      else t1 = t2; // Root is in lower half
      t2 = (t1 - t0) * 0.5 + t0;
    }

    return t2;
  };

  return (t: number) => sampleCurveY(solveCurveX(t));
}

/**
 * Spring easing using damped harmonic oscillator physics.
 * Simulates a mass-spring-damper system: stiffness controls oscillation speed,
 * damping controls how quickly oscillations decay.
 * zeta < 1: underdamped (bouncy), zeta = 1: critically damped (no overshoot),
 * zeta > 1: overdamped (sluggish)
 */
export function springEasing(
  stiffness: number = 100,
  damping: number = 10,
  mass: number = 1,
): EasingFn {
  // Natural frequency of oscillation
  const w0 = Math.sqrt(stiffness / mass);
  // Damping ratio: determines response behavior
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // Damped oscillation frequency (only when underdamped)
  const wd = zeta < 1 ? w0 * Math.sqrt(1 - zeta * zeta) : 0;
  const a = 1;
  // Coefficient for sine component of oscillation
  const b = zeta < 1 ? (zeta * w0) / wd : 0;

  return (t: number) => {
    let progress: number;
    if (zeta < 1) {
      // Underdamped: oscillation with exponential decay envelope
      progress =
        1 -
        Math.exp(-zeta * w0 * t) *
          (a * Math.cos(wd * t) + b * Math.sin(wd * t));
    } else {
      // Critically damped or overdamped: exponential approach without oscillation
      progress = 1 - (1 + w0 * t) * Math.exp(-w0 * t);
    }
    return progress;
  };
}

export function getEasingFunction(easing: EasingFunction): EasingFn {
  if (typeof easing === "string") {
    return EASING_FUNCTIONS[easing] || EASING_FUNCTIONS.linear;
  }

  if (easing.type === "cubicBezier") {
    const [x1, y1, x2, y2] = easing.points;
    return cubicBezier(x1, y1, x2, y2);
  }

  if (easing.type === "spring") {
    return springEasing(easing.stiffness, easing.damping, easing.mass);
  }

  return EASING_FUNCTIONS.linear;
}

export function interpolate(
  startValue: number,
  endValue: number,
  progress: number,
  easing: EasingFunction = "linear",
): number {
  const easingFn = getEasingFunction(easing);
  const easedProgress = easingFn(Math.max(0, Math.min(1, progress)));
  return startValue + (endValue - startValue) * easedProgress;
}

export const EASING_PRESETS: Record<
  string,
  { name: string; easing: EasingFunction; description: string }
> = {
  linear: { name: "Linear", easing: "linear", description: "No acceleration" },
  ease: {
    name: "Ease",
    easing: { type: "cubicBezier", points: [0.25, 0.1, 0.25, 1] },
    description: "Smooth start and end",
  },
  easeIn: {
    name: "Ease In",
    easing: "easeInQuad",
    description: "Slow start, fast end",
  },
  easeOut: {
    name: "Ease Out",
    easing: "easeOutQuad",
    description: "Fast start, slow end",
  },
  easeInOut: {
    name: "Ease In Out",
    easing: "easeInOutQuad",
    description: "Slow start and end",
  },
  bounce: {
    name: "Bounce",
    easing: "easeOutBounce",
    description: "Bouncing effect",
  },
  elastic: {
    name: "Elastic",
    easing: "easeOutElastic",
    description: "Springy overshoot",
  },
  back: {
    name: "Back",
    easing: "easeOutBack",
    description: "Slight overshoot",
  },
  snappy: {
    name: "Snappy",
    easing: { type: "cubicBezier", points: [0.19, 1, 0.22, 1] },
    description: "Quick and responsive",
  },
  smooth: {
    name: "Smooth",
    easing: { type: "cubicBezier", points: [0.4, 0, 0.2, 1] },
    description: "Material design smooth",
  },
};

export const ALL_EASING_NAMES: EasingName[] = Object.keys(
  EASING_FUNCTIONS,
) as EasingName[];

export interface EasingCategory {
  name: string;
  easings: EasingName[];
}

export const EASING_CATEGORIES: EasingCategory[] = [
  {
    name: "Basic",
    easings: [
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "hold",
      "bezier",
      "smoothstep",
      "smootherstep",
      "snappy",
      "smooth",
    ],
  },
  { name: "Quad", easings: ["easeInQuad", "easeOutQuad", "easeInOutQuad"] },
  { name: "Cubic", easings: ["easeInCubic", "easeOutCubic", "easeInOutCubic"] },
  { name: "Quart", easings: ["easeInQuart", "easeOutQuart", "easeInOutQuart"] },
  { name: "Quint", easings: ["easeInQuint", "easeOutQuint", "easeInOutQuint"] },
  { name: "Sine", easings: ["easeInSine", "easeOutSine", "easeInOutSine"] },
  { name: "Expo", easings: ["easeInExpo", "easeOutExpo", "easeInOutExpo"] },
  { name: "Circ", easings: ["easeInCirc", "easeOutCirc", "easeInOutCirc"] },
  {
    name: "Back",
    easings: [
      "easeInBack",
      "easeOutBack",
      "easeInOutBack",
      "easeInBackStrong",
      "easeOutBackStrong",
      "easeInOutBackStrong",
    ],
  },
  {
    name: "Elastic",
    easings: [
      "easeInElastic",
      "easeOutElastic",
      "easeInOutElastic",
      "easeInElasticSoft",
      "easeOutElasticSoft",
      "easeInOutElasticSoft",
    ],
  },
  {
    name: "Bounce",
    easings: [
      "easeInBounce",
      "easeOutBounce",
      "easeInOutBounce",
      "easeInBounceSmall",
      "easeOutBounceSmall",
      "easeInOutBounceSmall",
    ],
  },
];
