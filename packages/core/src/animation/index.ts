export { EASING_FUNCTIONS, EASING_CATEGORIES } from "./easing-functions";

export type { EasingName } from "./easing-functions";

// getGSAPEngine (the gsap-backed engine) is deliberately not re-exported from the barrel: import it from
// "@openreel/core/animation/gsap-engine" so gsap (~280 KB) is only bundled by the code that needs it.
export { generateBezierPath, generateDefaultControlPoints } from "./motion-path-geometry";

export type { GSAPMotionPathPoint, MotionPathConfig } from "./motion-path-geometry";

export * from "./evaluate-keyframes";
export * from "./keyframe-properties";
export * from "./keyframe-bezier";
export * from "./keyframe-clipboard";
export * from "./keyframe-interpolation";
export * from "./spatial-path";
export * from "./keyframe-migration";
