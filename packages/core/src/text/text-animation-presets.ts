import type { EasingType } from "../types/timeline";
import type {
  TextAnimationPreset,
  TextAnimationParams,
  TextAnimation,
} from "./types";
import {
  EASING_FUNCTIONS,
  type EasingName,
} from "../animation/easing-functions";

export interface AnimatedUnit {
  text: string;
  index: number;
  totalUnits: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UnitAnimationState {
  opacity: number;
  scale: { x: number; y: number };
  rotation: number;
  offsetX: number;
  offsetY: number;
  blur: number;
  color?: string;
  skewX?: number;
  skewY?: number;
}

export interface TextAnimationContext {
  unit: AnimatedUnit;
  progress: number;
  isIn: boolean;
  animation: TextAnimation;
  totalDuration: number;
}

type AnimationFn = (ctx: TextAnimationContext) => UnitAnimationState;

const getEasing = (easing: EasingType | undefined): ((t: number) => number) => {
  if (!easing || easing === "linear") return (t) => t;
  if (easing === "ease-in") return EASING_FUNCTIONS.easeInQuad;
  if (easing === "ease-out") return EASING_FUNCTIONS.easeOutQuad;
  if (easing === "ease-in-out") return EASING_FUNCTIONS.easeInOutQuad;
  if (easing === "bezier") return EASING_FUNCTIONS.easeInOutCubic;
  const fn = EASING_FUNCTIONS[easing as EasingName];
  return fn || ((t) => t);
};

const DEFAULT_STATE: UnitAnimationState = {
  opacity: 1,
  scale: { x: 1, y: 1 },
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  blur: 0,
};

const typewriterAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn } = ctx;
  const stagger = ctx.animation.stagger || 0.05;
  const unitDelay = unit.index * stagger;
  const unitDuration =
    ctx.animation.inDuration - (unit.totalUnits - 1) * stagger;

  let unitProgress: number;
  if (isIn) {
    unitProgress = Math.max(
      0,
      Math.min(
        1,
        (progress * ctx.animation.inDuration - unitDelay) / unitDuration,
      ),
    );
  } else {
    unitProgress =
      1 -
      Math.max(
        0,
        Math.min(
          1,
          (progress * ctx.animation.outDuration - unitDelay) / unitDuration,
        ),
      );
  }

  return {
    ...DEFAULT_STATE,
    opacity: unitProgress >= 0.5 ? 1 : 0,
  };
};

const fadeAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.03;
  const easing = getEasing(params.easing || "easeOutQuad");

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);
  const startOpacity = params.fadeOpacity?.start ?? 0;
  const endOpacity = params.fadeOpacity?.end ?? 1;
  const opacity = startOpacity + (endOpacity - startOpacity) * easedProgress;

  return {
    ...DEFAULT_STATE,
    opacity,
  };
};

const slideAnimation = (
  direction: "left" | "right" | "up" | "down",
): AnimationFn => {
  return (ctx) => {
    const { unit, progress, isIn, animation } = ctx;
    const params = animation.params;
    const stagger = animation.stagger || 0.03;
    const easing = getEasing(params.easing || "easeOutCubic");
    const distance = params.slideDistance || 50;

    const unitDelay = unit.index * stagger;
    const duration = isIn ? animation.inDuration : animation.outDuration;
    const unitDuration = Math.max(
      0.1,
      duration - (unit.totalUnits - 1) * stagger,
    );

    let unitProgress = Math.max(
      0,
      Math.min(1, (progress * duration - unitDelay) / unitDuration),
    );
    if (!isIn) unitProgress = 1 - unitProgress;

    const easedProgress = easing(unitProgress);

    let offsetX = 0;
    let offsetY = 0;
    const offset = distance * (1 - easedProgress);

    switch (direction) {
      case "left":
        offsetX = -offset;
        break;
      case "right":
        offsetX = offset;
        break;
      case "up":
        offsetY = -offset;
        break;
      case "down":
        offsetY = offset;
        break;
    }

    return {
      ...DEFAULT_STATE,
      opacity: easedProgress,
      offsetX,
      offsetY,
    };
  };
};

const scaleAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.03;
  const easing = getEasing(params.easing || "easeOutBack");
  const scaleFrom = params.scaleFrom ?? 0;
  const scaleTo = params.scaleTo ?? 1;

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);
  const scale = scaleFrom + (scaleTo - scaleFrom) * easedProgress;

  return {
    ...DEFAULT_STATE,
    opacity: easedProgress,
    scale: { x: scale, y: scale },
  };
};

const blurAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.03;
  const easing = getEasing(params.easing || "easeOutQuad");
  const blurAmount = params.blurAmount ?? 10;

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);
  const blur = blurAmount * (1 - easedProgress);

  return {
    ...DEFAULT_STATE,
    opacity: easedProgress,
    blur,
  };
};

const bounceAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.05;
  const bounceHeight = params.bounceHeight ?? 30;

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = EASING_FUNCTIONS.easeOutBounce(unitProgress);
  const offsetY = -bounceHeight * (1 - easedProgress);

  return {
    ...DEFAULT_STATE,
    opacity: unitProgress > 0 ? 1 : 0,
    offsetY,
  };
};

const rotateAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.03;
  const easing = getEasing(params.easing || "easeOutBack");
  const rotateAngle = params.rotateAngle ?? 180;

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);
  const rotation = rotateAngle * (1 - easedProgress);

  return {
    ...DEFAULT_STATE,
    opacity: easedProgress,
    rotation,
    scale: { x: easedProgress, y: easedProgress },
  };
};

const waveAnimation: AnimationFn = (ctx) => {
  const { unit, progress, animation } = ctx;
  const params = animation.params;
  const amplitude = params.waveAmplitude ?? 10;
  const frequency = params.waveFrequency ?? 2;

  const phase = (unit.index / unit.totalUnits) * Math.PI * 2;
  const waveOffset =
    Math.sin(progress * Math.PI * 2 * frequency + phase) * amplitude;

  return {
    ...DEFAULT_STATE,
    offsetY: waveOffset,
  };
};

const shakeAnimation: AnimationFn = (ctx) => {
  const { progress, animation } = ctx;
  const params = animation.params;
  const intensity = params.shakeIntensity ?? 5;
  const speed = params.shakeSpeed ?? 20;

  const shakeX = Math.sin(progress * Math.PI * 2 * speed) * intensity;
  const shakeY =
    Math.cos(progress * Math.PI * 2 * speed * 1.3) * intensity * 0.5;

  return {
    ...DEFAULT_STATE,
    offsetX: shakeX,
    offsetY: shakeY,
  };
};

const popAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.05;
  const overshoot = params.popOvershoot ?? 1.2;

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = EASING_FUNCTIONS.easeOutBack(unitProgress);
  const scale =
    unitProgress > 0 ? easedProgress * (unitProgress < 0.5 ? overshoot : 1) : 0;

  return {
    ...DEFAULT_STATE,
    opacity: unitProgress > 0 ? 1 : 0,
    scale: { x: Math.max(0, scale), y: Math.max(0, scale) },
  };
};

const glitchAnimation: AnimationFn = (ctx) => {
  const { unit, progress, animation } = ctx;
  const params = animation.params;
  const intensity = params.glitchIntensity ?? 10;
  const speed = params.glitchSpeed ?? 10;

  const glitchTime = progress * speed;
  const glitchPhase = Math.floor(glitchTime) + unit.index * 0.3;
  const randomSeed = Math.sin(glitchPhase * 12.9898) * 43758.5453;
  const random = randomSeed - Math.floor(randomSeed);

  const shouldGlitch = random > 0.7;
  const offsetX = shouldGlitch ? (random - 0.5) * intensity * 2 : 0;
  const skewX = shouldGlitch ? (random - 0.5) * 5 : 0;

  return {
    ...DEFAULT_STATE,
    offsetX,
    skewX,
    color:
      shouldGlitch && random > 0.85
        ? `hsl(${random * 360}, 100%, 50%)`
        : undefined,
  };
};

const splitAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.03;
  const easing = getEasing(params.easing || "easeOutCubic");
  const direction = params.splitDirection || "horizontal";

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);
  const centerIndex = (unit.totalUnits - 1) / 2;
  const distanceFromCenter = unit.index - centerIndex;
  const maxDistance = 100;
  const offset =
    (maxDistance * distanceFromCenter * (1 - easedProgress)) / centerIndex;

  return {
    ...DEFAULT_STATE,
    opacity: easedProgress,
    offsetX: direction === "horizontal" ? offset : 0,
    offsetY: direction === "vertical" ? offset : 0,
  };
};

const flipAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const stagger = animation.stagger || 0.05;
  const easing = getEasing(params.easing || "easeOutBack");
  const axis = params.flipAxis || "y";

  const unitDelay = unit.index * stagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);
  const rotationAngle = 90 * (1 - easedProgress);
  const scaleAxis = Math.cos((rotationAngle * Math.PI) / 180);

  return {
    ...DEFAULT_STATE,
    opacity: easedProgress > 0.1 ? 1 : 0,
    scale: axis === "x" ? { x: scaleAxis, y: 1 } : { x: 1, y: scaleAxis },
    rotation: axis === "x" ? 0 : 0,
  };
};

const wordByWordAnimation: AnimationFn = (ctx) => {
  const { unit, progress, isIn, animation } = ctx;
  const params = animation.params;
  const wordDelay = params.wordDelay ?? 0.2;
  const easing = getEasing(params.easing || "easeOutQuad");

  const unitDelay = unit.index * wordDelay;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDuration = 0.3;

  let unitProgress = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) unitProgress = 1 - unitProgress;

  const easedProgress = easing(unitProgress);

  return {
    ...DEFAULT_STATE,
    opacity: easedProgress,
    offsetY: 20 * (1 - easedProgress),
    scale: { x: 0.8 + 0.2 * easedProgress, y: 0.8 + 0.2 * easedProgress },
  };
};

const rainbowAnimation: AnimationFn = (ctx) => {
  const { unit, progress, animation } = ctx;
  const params = animation.params;
  const speed = params.rainbowSpeed ?? 1;

  const hue =
    ((unit.index / unit.totalUnits) * 360 + progress * 360 * speed) % 360;

  return {
    ...DEFAULT_STATE,
    color: `hsl(${hue}, 80%, 60%)`,
  };
};

const entranceProgress = (
  ctx: TextAnimationContext,
  defaultStagger: number,
  defaultEasing: EasingName,
): { raw: number; eased: number } => {
  const { unit, animation, isIn, progress } = ctx;
  const stagger = animation.stagger ?? defaultStagger;
  const duration = isIn ? animation.inDuration : animation.outDuration;
  const unitDelay = unit.index * stagger;
  const unitDuration = Math.max(
    0.1,
    duration - (unit.totalUnits - 1) * stagger,
  );
  let raw = Math.max(
    0,
    Math.min(1, (progress * duration - unitDelay) / unitDuration),
  );
  if (!isIn) raw = 1 - raw;
  const easing = getEasing(ctx.animation.params.easing || defaultEasing);
  return { raw, eased: easing(raw) };
};

const riseAnimation: AnimationFn = (ctx) => {
  const { raw, eased } = entranceProgress(ctx, 0.08, "easeOutCubic");
  const distance = ctx.animation.params.slideDistance ?? 36;
  const blurAmount = ctx.animation.params.blurAmount ?? 8;
  return {
    ...DEFAULT_STATE,
    opacity: raw,
    offsetY: distance * (1 - eased),
    blur: Math.max(0, blurAmount * (1 - raw)),
    scale: { x: 0.88 + eased * 0.12, y: 0.88 + eased * 0.12 },
  };
};

const dropAnimation: AnimationFn = (ctx) => {
  const { raw } = entranceProgress(ctx, 0.045, "easeOutBounceSmall");
  const bounce = EASING_FUNCTIONS.easeOutBounceSmall(raw);
  const distance = ctx.animation.params.slideDistance ?? 60;
  const angle = ctx.animation.params.rotateAngle ?? 10;
  const direction = ctx.unit.index % 2 === 0 ? -1 : 1;
  return {
    ...DEFAULT_STATE,
    opacity: raw > 0 ? 1 : 0,
    offsetY: -distance * (1 - bounce),
    rotation: direction * angle * (1 - bounce),
  };
};

const elasticAnimation: AnimationFn = (ctx) => {
  const { raw } = entranceProgress(ctx, 0.08, "easeOutElasticSoft");
  const elastic = EASING_FUNCTIONS.easeOutElasticSoft(raw);
  const scaleFrom = ctx.animation.params.scaleFrom ?? 0.15;
  const scale = scaleFrom + (1 - scaleFrom) * elastic;
  return {
    ...DEFAULT_STATE,
    opacity: raw > 0 ? 1 : 0,
    scale: { x: Math.max(0, scale), y: Math.max(0, scale) },
  };
};

const swingAnimation: AnimationFn = (ctx) => {
  const { raw, eased } = entranceProgress(ctx, 0.09, "easeOutBack");
  const angle = ctx.animation.params.rotateAngle ?? 28;
  const distance = ctx.animation.params.slideDistance ?? 20;
  const direction = ctx.unit.index % 2 === 0 ? -1 : 1;
  return {
    ...DEFAULT_STATE,
    opacity: raw,
    offsetY: -distance * (1 - raw),
    rotation: direction * angle * (1 - eased),
  };
};

const zoomBlurAnimation: AnimationFn = (ctx) => {
  const { raw, eased } = entranceProgress(ctx, 0.06, "easeOutExpo");
  const scaleFrom = ctx.animation.params.scaleFrom ?? 1.65;
  const blurAmount = ctx.animation.params.blurAmount ?? 14;
  const scale = scaleFrom + (1 - scaleFrom) * eased;
  return {
    ...DEFAULT_STATE,
    opacity: raw,
    scale: { x: scale, y: scale },
    blur: Math.max(0, blurAmount * (1 - raw)),
  };
};

const cascadeAnimation: AnimationFn = (ctx) => {
  const { raw, eased } = entranceProgress(ctx, 0.035, "easeOutCubic");
  const distance = ctx.animation.params.slideDistance ?? 48;
  const angle = ctx.animation.params.rotateAngle ?? 8;
  const direction = ctx.unit.index % 2 === 0 ? -1 : 1;
  return {
    ...DEFAULT_STATE,
    opacity: raw,
    offsetX: direction * distance * 0.35 * (1 - eased),
    offsetY: distance * (1 - eased),
    rotation: direction * angle * (1 - eased),
    scale: { x: 0.9 + eased * 0.1, y: 0.9 + eased * 0.1 },
  };
};

const ANIMATION_MAP: Record<TextAnimationPreset, AnimationFn> = {
  none: () => DEFAULT_STATE,
  typewriter: typewriterAnimation,
  fade: fadeAnimation,
  "slide-left": slideAnimation("left"),
  "slide-right": slideAnimation("right"),
  "slide-up": slideAnimation("up"),
  "slide-down": slideAnimation("down"),
  scale: scaleAnimation,
  blur: blurAnimation,
  bounce: bounceAnimation,
  rotate: rotateAnimation,
  wave: waveAnimation,
  shake: shakeAnimation,
  pop: popAnimation,
  glitch: glitchAnimation,
  split: splitAnimation,
  flip: flipAnimation,
  "word-by-word": wordByWordAnimation,
  rainbow: rainbowAnimation,
  rise: riseAnimation,
  drop: dropAnimation,
  elastic: elasticAnimation,
  swing: swingAnimation,
  "zoom-blur": zoomBlurAnimation,
  cascade: cascadeAnimation,
};

export function calculateUnitAnimationState(
  ctx: TextAnimationContext,
): UnitAnimationState {
  const animationFn = ANIMATION_MAP[ctx.animation.preset];
  if (!animationFn) return DEFAULT_STATE;
  return animationFn(ctx);
}

export interface TextAnimationPresetInfo {
  id: TextAnimationPreset;
  name: string;
  description: string;
  category: "entrance" | "emphasis" | "exit" | "continuous";
  defaultParams: Partial<TextAnimationParams>;
  defaultUnit: "character" | "word" | "line";
  defaultStagger: number;
  defaultInDuration: number;
  defaultOutDuration: number;
}

export const TEXT_ANIMATION_PRESETS: TextAnimationPresetInfo[] = [
  {
    id: "none",
    name: "None",
    description: "No animation",
    category: "entrance",
    defaultParams: {},
    defaultUnit: "character",
    defaultStagger: 0,
    defaultInDuration: 0,
    defaultOutDuration: 0,
  },
  {
    id: "typewriter",
    name: "Typewriter",
    description: "Characters appear one by one",
    category: "entrance",
    defaultParams: {},
    defaultUnit: "character",
    defaultStagger: 0.05,
    defaultInDuration: 1,
    defaultOutDuration: 0.5,
  },
  {
    id: "fade",
    name: "Fade In",
    description: "Smooth opacity transition",
    category: "entrance",
    defaultParams: { fadeOpacity: { start: 0, end: 1 }, easing: "easeOutQuad" },
    defaultUnit: "character",
    defaultStagger: 0.03,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "slide-up",
    name: "Slide Up",
    description: "Slides in from below",
    category: "entrance",
    defaultParams: { slideDistance: 50, easing: "easeOutCubic" },
    defaultUnit: "word",
    defaultStagger: 0.1,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "slide-down",
    name: "Slide Down",
    description: "Slides in from above",
    category: "entrance",
    defaultParams: { slideDistance: 50, easing: "easeOutCubic" },
    defaultUnit: "word",
    defaultStagger: 0.1,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "slide-left",
    name: "Slide Left",
    description: "Slides in from the right",
    category: "entrance",
    defaultParams: { slideDistance: 50, easing: "easeOutCubic" },
    defaultUnit: "character",
    defaultStagger: 0.02,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "slide-right",
    name: "Slide Right",
    description: "Slides in from the left",
    category: "entrance",
    defaultParams: { slideDistance: 50, easing: "easeOutCubic" },
    defaultUnit: "character",
    defaultStagger: 0.02,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "scale",
    name: "Scale In",
    description: "Grows from small to full size",
    category: "entrance",
    defaultParams: { scaleFrom: 0, scaleTo: 1, easing: "easeOutBack" },
    defaultUnit: "character",
    defaultStagger: 0.03,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "blur",
    name: "Blur In",
    description: "Fades in while unblurring",
    category: "entrance",
    defaultParams: { blurAmount: 10, easing: "easeOutQuad" },
    defaultUnit: "word",
    defaultStagger: 0.1,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "bounce",
    name: "Bounce",
    description: "Bounces into place",
    category: "entrance",
    defaultParams: { bounceHeight: 30 },
    defaultUnit: "character",
    defaultStagger: 0.05,
    defaultInDuration: 0.8,
    defaultOutDuration: 0.3,
  },
  {
    id: "rotate",
    name: "Rotate In",
    description: "Spins while appearing",
    category: "entrance",
    defaultParams: { rotateAngle: 180, easing: "easeOutBack" },
    defaultUnit: "character",
    defaultStagger: 0.05,
    defaultInDuration: 0.6,
    defaultOutDuration: 0.3,
  },
  {
    id: "pop",
    name: "Pop",
    description: "Pops in with overshoot",
    category: "entrance",
    defaultParams: { popOvershoot: 1.2 },
    defaultUnit: "character",
    defaultStagger: 0.05,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "flip",
    name: "Flip",
    description: "Flips into view",
    category: "entrance",
    defaultParams: { flipAxis: "y", easing: "easeOutBack" },
    defaultUnit: "character",
    defaultStagger: 0.05,
    defaultInDuration: 0.6,
    defaultOutDuration: 0.3,
  },
  {
    id: "split",
    name: "Split",
    description: "Characters split from center",
    category: "entrance",
    defaultParams: { splitDirection: "horizontal", easing: "easeOutCubic" },
    defaultUnit: "character",
    defaultStagger: 0,
    defaultInDuration: 0.5,
    defaultOutDuration: 0.3,
  },
  {
    id: "word-by-word",
    name: "Word by Word",
    description: "Words appear one at a time",
    category: "entrance",
    defaultParams: { wordDelay: 0.2, easing: "easeOutQuad" },
    defaultUnit: "word",
    defaultStagger: 0.2,
    defaultInDuration: 1,
    defaultOutDuration: 0.5,
  },
  {
    id: "rise",
    name: "Rise",
    description: "Soft blurred rise with a subtle scale settle",
    category: "entrance",
    defaultParams: { slideDistance: 36, blurAmount: 8, easing: "easeOutCubic" },
    defaultUnit: "word",
    defaultStagger: 0.08,
    defaultInDuration: 0.65,
    defaultOutDuration: 0.35,
  },
  {
    id: "drop",
    name: "Drop",
    description: "Characters drop in and land with a soft bounce",
    category: "entrance",
    defaultParams: { slideDistance: 60, rotateAngle: 10, easing: "easeOutBounceSmall" },
    defaultUnit: "character",
    defaultStagger: 0.045,
    defaultInDuration: 0.8,
    defaultOutDuration: 0.35,
  },
  {
    id: "elastic",
    name: "Elastic",
    description: "Springy scale entrance with a controlled overshoot",
    category: "entrance",
    defaultParams: { scaleFrom: 0.15, popOvershoot: 1.25, easing: "easeOutElasticSoft" },
    defaultUnit: "word",
    defaultStagger: 0.08,
    defaultInDuration: 0.9,
    defaultOutDuration: 0.4,
  },
  {
    id: "swing",
    name: "Swing",
    description: "Alternating hinged letters swing into place",
    category: "entrance",
    defaultParams: { rotateAngle: 28, slideDistance: 20, easing: "easeOutBack" },
    defaultUnit: "character",
    defaultStagger: 0.09,
    defaultInDuration: 0.75,
    defaultOutDuration: 0.4,
  },
  {
    id: "zoom-blur",
    name: "Zoom Blur",
    description: "Sharpens from a cinematic forward zoom",
    category: "entrance",
    defaultParams: { scaleFrom: 1.65, blurAmount: 14, easing: "easeOutExpo" },
    defaultUnit: "word",
    defaultStagger: 0.06,
    defaultInDuration: 0.65,
    defaultOutDuration: 0.35,
  },
  {
    id: "cascade",
    name: "Cascade",
    description: "Staggered diagonal character entrance",
    category: "entrance",
    defaultParams: { slideDistance: 48, rotateAngle: 8, easing: "easeOutCubic" },
    defaultUnit: "character",
    defaultStagger: 0.035,
    defaultInDuration: 0.85,
    defaultOutDuration: 0.4,
  },
  {
    id: "wave",
    name: "Wave",
    description: "Continuous wave motion",
    category: "continuous",
    defaultParams: { waveAmplitude: 10, waveFrequency: 2 },
    defaultUnit: "character",
    defaultStagger: 0,
    defaultInDuration: 0,
    defaultOutDuration: 0,
  },
  {
    id: "shake",
    name: "Shake",
    description: "Continuous shaking",
    category: "continuous",
    defaultParams: { shakeIntensity: 5, shakeSpeed: 20 },
    defaultUnit: "character",
    defaultStagger: 0,
    defaultInDuration: 0,
    defaultOutDuration: 0,
  },
  {
    id: "glitch",
    name: "Glitch",
    description: "Digital glitch effect",
    category: "emphasis",
    defaultParams: { glitchIntensity: 10, glitchSpeed: 10 },
    defaultUnit: "character",
    defaultStagger: 0,
    defaultInDuration: 0,
    defaultOutDuration: 0,
  },
  {
    id: "rainbow",
    name: "Rainbow",
    description: "Cycling rainbow colors",
    category: "continuous",
    defaultParams: { rainbowSpeed: 1 },
    defaultUnit: "character",
    defaultStagger: 0,
    defaultInDuration: 0,
    defaultOutDuration: 0,
  },
];

export function getPresetInfo(
  preset: TextAnimationPreset,
): TextAnimationPresetInfo | undefined {
  return TEXT_ANIMATION_PRESETS.find((p) => p.id === preset);
}

export function createDefaultAnimation(
  preset: TextAnimationPreset,
): TextAnimation {
  const info = getPresetInfo(preset);
  if (!info) {
    return {
      preset: "none",
      params: {},
      inDuration: 0,
      outDuration: 0,
    };
  }

  return {
    preset,
    params: { ...info.defaultParams },
    inDuration: info.defaultInDuration,
    outDuration: info.defaultOutDuration,
    stagger: info.defaultStagger,
    unit: info.defaultUnit,
  };
}
