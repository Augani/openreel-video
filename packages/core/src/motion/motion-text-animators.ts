import type {
  MotionLayer,
  MotionTextAnimator,
  MotionTextAnimatorEasing,
  MotionTextLayer,
  MotionTextShaderRef,
} from "./types";
import { getMotionShaderDef, getMotionShaderTextDefs } from "./shaders";

export interface MotionTextAnimatorPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly create: (id?: string) => MotionTextAnimator;
}

export interface MotionTextGlyphRun {
  readonly character: string;
  readonly characterIndex: number;
  readonly unitIndex: number;
  readonly opacity: number;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly scale: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
}

interface TextUnit {
  readonly index: number;
  readonly wordIndex: number;
  readonly character: string;
}

const createTextAnimatorId = (): string =>
  `motion-text-anim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const MOTION_TEXT_ANIMATOR_PRESETS: readonly MotionTextAnimatorPreset[] = [
  {
    id: "text-reveal-up",
    name: "Reveal Up",
    description: "Staggers characters upward from transparent to fully visible.",
    create: (id = createTextAnimatorId()) => ({
      id,
      name: "Reveal Up",
      enabled: true,
      selector: {
        basedOn: "characters",
        start: 0,
        end: 100,
        offset: 0,
      },
      timing: {
        startTime: 0,
        duration: 0.45,
        stagger: 0.035,
        direction: "forward",
        easing: "ease-out",
      },
      properties: {
        position: { x: 0, y: 36 },
        scale: { x: 0.96, y: 0.96 },
        rotation: 0,
        opacity: 0,
      },
    }),
  },
  {
    id: "text-type-on",
    name: "Type On",
    description: "Reveals text one unit at a time without spatial movement.",
    create: (id = createTextAnimatorId()) => ({
      id,
      name: "Type On",
      enabled: true,
      selector: {
        basedOn: "characters",
        start: 0,
        end: 100,
        offset: 0,
      },
      timing: {
        startTime: 0,
        duration: 0.18,
        stagger: 0.045,
        direction: "forward",
        easing: "linear",
      },
      properties: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 0,
      },
    }),
  },
  {
    id: "text-scale-in",
    name: "Scale In",
    description: "Pops each character up from zero scale with a springy reveal.",
    create: (id = createTextAnimatorId()) => ({
      id,
      name: "Scale In",
      enabled: true,
      selector: { basedOn: "characters", start: 0, end: 100, offset: 0 },
      timing: {
        startTime: 0,
        duration: 0.4,
        stagger: 0.04,
        direction: "forward",
        easing: "ease-out",
      },
      properties: {
        position: { x: 0, y: 0 },
        scale: { x: 0, y: 0 },
        rotation: 0,
        opacity: 0,
      },
    }),
  },
  {
    id: "text-reveal-down",
    name: "Reveal Down",
    description: "Drops characters in from above with a staggered fade.",
    create: (id = createTextAnimatorId()) => ({
      id,
      name: "Reveal Down",
      enabled: true,
      selector: { basedOn: "characters", start: 0, end: 100, offset: 0 },
      timing: {
        startTime: 0,
        duration: 0.45,
        stagger: 0.035,
        direction: "forward",
        easing: "ease-out",
      },
      properties: {
        position: { x: 0, y: -36 },
        scale: { x: 0.96, y: 0.96 },
        rotation: 0,
        opacity: 0,
      },
    }),
  },
  {
    id: "text-slide-left",
    name: "Slide In Left",
    description: "Slides characters in from the left edge in sequence.",
    create: (id = createTextAnimatorId()) => ({
      id,
      name: "Slide In Left",
      enabled: true,
      selector: { basedOn: "words", start: 0, end: 100, offset: 0 },
      timing: {
        startTime: 0,
        duration: 0.5,
        stagger: 0.06,
        direction: "forward",
        easing: "ease-out",
      },
      properties: {
        position: { x: -72, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 0,
      },
    }),
  },
  {
    id: "text-spin-in",
    name: "Spin In",
    description: "Tumbles each character in with rotation and scale for kinetic titles.",
    create: (id = createTextAnimatorId()) => ({
      id,
      name: "Spin In",
      enabled: true,
      selector: { basedOn: "characters", start: 0, end: 100, offset: 0 },
      timing: {
        startTime: 0,
        duration: 0.5,
        stagger: 0.05,
        direction: "forward",
        easing: "ease-out",
      },
      properties: {
        position: { x: 0, y: 18 },
        scale: { x: 0.7, y: 0.7 },
        rotation: -120,
        opacity: 0,
      },
    }),
  },
];

export function createMotionTextAnimator(
  presetId = "text-reveal-up",
  id?: string,
): MotionTextAnimator {
  const preset = MOTION_TEXT_ANIMATOR_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    throw new Error(`Unsupported motion text animator preset: ${presetId}`);
  }
  return preset.create(id);
}

export function addMotionTextAnimator<T extends MotionTextLayer>(
  layer: T,
  animator: MotionTextAnimator,
): T {
  return {
    ...layer,
    textAnimators: [
      ...(layer.textAnimators ?? []),
      sanitizeMotionTextAnimator(animator),
    ],
  } as T;
}

export function updateMotionTextAnimator<T extends MotionTextLayer>(
  layer: T,
  animatorId: string,
  updater: (animator: MotionTextAnimator) => MotionTextAnimator,
): T {
  return {
    ...layer,
    textAnimators: (layer.textAnimators ?? []).map((animator) =>
      animator.id === animatorId
        ? sanitizeMotionTextAnimator(updater(animator))
        : animator,
    ),
  } as T;
}

export function removeMotionTextAnimator<T extends MotionTextLayer>(
  layer: T,
  animatorId: string,
): T {
  return {
    ...layer,
    textAnimators: (layer.textAnimators ?? []).filter(
      (animator) => animator.id !== animatorId,
    ),
  } as T;
}

export function toggleMotionTextAnimator<T extends MotionTextLayer>(
  layer: T,
  animatorId: string,
  enabled: boolean,
): T {
  return updateMotionTextAnimator(layer, animatorId, (animator) => ({
    ...animator,
    enabled,
  }));
}

export function getMotionTextAnimatorRuns(
  layer: MotionTextLayer,
  localTime: number,
): MotionTextGlyphRun[] {
  const units = splitTextUnits(layer.text);
  if (units.length === 0) return [];
  const animators = (layer.textAnimators ?? [])
    .filter((animator) => animator.enabled)
    .map(sanitizeMotionTextAnimator);

  const maxCharacterUnit = Math.max(0, units.length - 1);
  const maxWordUnit = Math.max(
    0,
    ...units.map((unit) => unit.wordIndex).filter((index) => index >= 0),
  );

  return units.map((unit) => {
    let opacity = 1;
    let positionX = 0;
    let positionY = 0;
    let scaleX = 1;
    let scaleY = 1;
    let rotation = 0;

    for (const animator of animators) {
      const unitIndex =
        animator.selector.basedOn === "words" ? unit.wordIndex : unit.index;
      if (unitIndex < 0) continue;

      const unitCount =
        animator.selector.basedOn === "words" ? maxWordUnit + 1 : maxCharacterUnit + 1;
      if (!isUnitInsideSelector(unitIndex, unitCount, animator.selector)) {
        continue;
      }

      const progress = getAnimatorProgress(
        animator,
        unitIndex,
        unitCount,
        localTime,
      );
      const inverse = 1 - progress;

      positionX += animator.properties.position.x * inverse;
      positionY += animator.properties.position.y * inverse;
      scaleX *= interpolate(animator.properties.scale.x, 1, progress);
      scaleY *= interpolate(animator.properties.scale.y, 1, progress);
      rotation += animator.properties.rotation * inverse;
      opacity *= interpolate(animator.properties.opacity, 1, progress);
    }

    return {
      character: unit.character,
      characterIndex: unit.index,
      unitIndex: unit.wordIndex >= 0 ? unit.wordIndex : unit.index,
      opacity: clamp(opacity, 0, 1),
      position: { x: positionX, y: positionY },
      scale: { x: scaleX, y: scaleY },
      rotation,
    };
  });
}

export function hasEnabledMotionTextAnimators(layer: MotionTextLayer): boolean {
  return Boolean(layer.textAnimators?.some((animator) => animator.enabled));
}

function splitTextUnits(text: string): TextUnit[] {
  const characters = Array.from(text);
  let wordIndex = -1;
  let inWord = false;

  return characters.map((character, index) => {
    if (/\s/u.test(character)) {
      inWord = false;
      return { index, wordIndex: -1, character };
    }

    if (!inWord) {
      wordIndex += 1;
      inWord = true;
    }

    return { index, wordIndex, character };
  });
}

function getAnimatorProgress(
  animator: MotionTextAnimator,
  unitIndex: number,
  unitCount: number,
  localTime: number,
): number {
  const order = getDirectionalUnitOrder(unitIndex, unitCount, animator.timing.direction);
  const startTime = animator.timing.startTime + order * animator.timing.stagger;
  const duration = Math.max(0.001, animator.timing.duration);
  const raw = (Math.max(0, localTime) - startTime) / duration;
  return ease(clamp(raw, 0, 1), animator.timing.easing);
}

function getDirectionalUnitOrder(
  unitIndex: number,
  unitCount: number,
  direction: MotionTextAnimator["timing"]["direction"],
): number {
  if (direction === "reverse") return Math.max(0, unitCount - 1 - unitIndex);
  if (direction === "center") {
    const center = (Math.max(1, unitCount) - 1) / 2;
    return Math.abs(unitIndex - center);
  }
  return unitIndex;
}

function isUnitInsideSelector(
  unitIndex: number,
  unitCount: number,
  selector: MotionTextAnimator["selector"],
): boolean {
  if (unitCount <= 0) return false;
  const rawStart = clamp(selector.start, 0, 100);
  const rawEnd = clamp(selector.end, 0, 100);
  if (rawStart === 0 && rawEnd === 100) return true;

  const position = normalizePercent(((unitIndex + 0.5) / unitCount) * 100 - selector.offset);
  const start = normalizePercent(rawStart);
  const end = normalizePercent(rawEnd);
  if (start === end) return false;
  if (start < end) {
    return position >= start && position <= end;
  }
  return position >= start || position <= end;
}

function sanitizeMotionTextShaderRef(
  shader: MotionTextShaderRef,
): MotionTextShaderRef | undefined {
  const isTextShader = getMotionShaderTextDefs().some(
    (def) => def.id === shader.shaderId,
  );
  if (!isTextShader) return undefined;
  const def = getMotionShaderDef(shader.shaderId);
  if (!def) return undefined;

  const params: Record<string, number | string> = {};
  for (const param of def.params) {
    const supplied = shader.params?.[param.name];
    if (param.type === "color") {
      params[param.name] = supplied ?? param.default;
      continue;
    }
    if (typeof supplied === "number" && Number.isFinite(supplied)) {
      params[param.name] = clamp(supplied, param.min, param.max);
    } else if (typeof param.default === "number" && Number.isFinite(param.default)) {
      params[param.name] = param.default;
    } else {
      params[param.name] = 0;
    }
  }

  return { shaderId: shader.shaderId, params };
}

export function sanitizeMotionTextAnimator(
  animator: MotionTextAnimator,
): MotionTextAnimator {
  const shader = animator.shader
    ? sanitizeMotionTextShaderRef(animator.shader)
    : undefined;
  const { shader: _originalShader, ...rest } = animator;
  const base: MotionTextAnimator = {
    ...rest,
    selector: {
      basedOn: animator.selector.basedOn,
      start: clamp(animator.selector.start, 0, 100),
      end: clamp(animator.selector.end, 0, 100),
      offset: finite(animator.selector.offset, 0),
    },
    timing: {
      startTime: Math.max(0, finite(animator.timing.startTime, 0)),
      duration: Math.max(0.001, finite(animator.timing.duration, 0.45)),
      stagger: Math.max(0, finite(animator.timing.stagger, 0.035)),
      direction: animator.timing.direction,
      easing: animator.timing.easing,
    },
    properties: {
      position: {
        x: finite(animator.properties.position.x, 0),
        y: finite(animator.properties.position.y, 0),
      },
      scale: {
        x: Math.max(0.001, finite(animator.properties.scale.x, 1)),
        y: Math.max(0.001, finite(animator.properties.scale.y, 1)),
      },
      rotation: finite(animator.properties.rotation, 0),
      opacity: clamp(animator.properties.opacity, 0, 1),
    },
  };
  return shader ? { ...base, shader } : base;
}

export function getMotionTextShaderAnimator(
  layer: MotionTextLayer,
): MotionTextAnimator | undefined {
  return (layer.textAnimators ?? [])
    .filter((animator) => animator.enabled)
    .map(sanitizeMotionTextAnimator)
    .find((animator) => animator.shader !== undefined);
}

export function getMotionTextAnimatorGlyphProgress(
  animator: MotionTextAnimator,
  unitIndex: number,
  unitCount: number,
  localTime: number,
): number {
  return getAnimatorProgress(animator, unitIndex, unitCount, localTime);
}

export function getMotionTextAnimatorRunProgress(
  animator: MotionTextAnimator,
  runs: readonly MotionTextGlyphRun[],
  localTime: number,
): number[] {
  if (runs.length === 0) return [];
  const isWhitespace = (run: MotionTextGlyphRun): boolean =>
    run.character.trim() === "";

  if (animator.selector.basedOn === "words") {
    const wordRuns = runs.filter((run) => !isWhitespace(run));
    const unitCount = Math.max(
      1,
      ...wordRuns.map((run) => run.unitIndex + 1),
    );
    return runs.map((run) =>
      isWhitespace(run)
        ? 0
        : getMotionTextAnimatorGlyphProgress(
            animator,
            run.unitIndex,
            unitCount,
            localTime,
          ),
    );
  }

  const unitCount = Math.max(1, ...runs.map((run) => run.characterIndex + 1));
  return runs.map((run) =>
    getMotionTextAnimatorGlyphProgress(
      animator,
      run.characterIndex,
      unitCount,
      localTime,
    ),
  );
}

export function layerHasMotionShaderTextAnimator(layer: MotionLayer): boolean {
  return layer.type === "text" && getMotionTextShaderAnimator(layer) !== undefined;
}

function ease(value: number, easing: MotionTextAnimatorEasing): number {
  switch (easing) {
    case "ease-in":
      return value * value;
    case "ease-out":
      return 1 - (1 - value) * (1 - value);
    case "ease":
      return value < 0.5
        ? 2 * value * value
        : 1 - Math.pow(-2 * value + 2, 2) / 2;
    case "linear":
      return value;
  }
}

function interpolate(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function normalizePercent(value: number): number {
  return ((finite(value, 0) % 100) + 100) % 100;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}
