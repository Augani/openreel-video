import type {
  MotionComposition,
  MotionGuide,
  MotionGuideOrientation,
} from "./types";

export interface CreateMotionGuideOptions {
  readonly id?: string;
  readonly locked?: boolean;
  readonly color?: string;
}

export interface MoveMotionGuideOptions {
  readonly includeLocked?: boolean;
  readonly clampToComposition?: boolean;
  readonly snapGridSize?: number;
}

const createGuideId = (): string =>
  `motion-guide-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionGuide(
  orientation: MotionGuideOrientation,
  position: number,
  options: CreateMotionGuideOptions = {},
): MotionGuide {
  return sanitizeMotionGuide({
    id: options.id ?? createGuideId(),
    orientation,
    position,
    locked: options.locked,
    color: options.color,
  });
}

export function addMotionCompositionGuide(
  composition: MotionComposition,
  guide: MotionGuide,
): MotionComposition {
  return {
    ...composition,
    guides: [...(composition.guides ?? []), sanitizeMotionGuide(guide)],
    modifiedAt: Date.now(),
  };
}

export function updateMotionCompositionGuide(
  composition: MotionComposition,
  guideId: string,
  updater: (guide: MotionGuide) => MotionGuide,
): MotionComposition {
  let changed = false;
  const guides = (composition.guides ?? []).map((guide) => {
    if (guide.id !== guideId) return guide;
    changed = true;
    return sanitizeMotionGuide(updater(guide));
  });
  return changed ? { ...composition, guides, modifiedAt: Date.now() } : composition;
}

export function moveMotionCompositionGuide(
  composition: MotionComposition,
  guideId: string,
  position: number,
  options: MoveMotionGuideOptions = {},
): MotionComposition {
  return updateMotionCompositionGuide(composition, guideId, (guide) => {
    if (guide.locked && !options.includeLocked) {
      return guide;
    }

    const axisLimit =
      guide.orientation === "vertical" ? composition.width : composition.height;
    const snappedPosition =
      options.snapGridSize && options.snapGridSize > 0
        ? Math.round(position / options.snapGridSize) * options.snapGridSize
        : position;
    return {
      ...guide,
      position:
        options.clampToComposition ?? true
          ? clamp(snappedPosition, 0, axisLimit)
          : snappedPosition,
    };
  });
}

export function removeMotionCompositionGuide(
  composition: MotionComposition,
  guideId: string,
): MotionComposition {
  const guides = (composition.guides ?? []).filter((guide) => guide.id !== guideId);
  if (guides.length === (composition.guides ?? []).length) return composition;
  return { ...composition, guides, modifiedAt: Date.now() };
}

export function clearMotionCompositionGuides(
  composition: MotionComposition,
): MotionComposition {
  if ((composition.guides ?? []).length === 0) return composition;
  return { ...composition, guides: [], modifiedAt: Date.now() };
}

export function getMotionGuideSnapPosition(guide: MotionGuide): {
  readonly axis: "x" | "y";
  readonly position: number;
} {
  return {
    axis: guide.orientation === "vertical" ? "x" : "y",
    position: guide.position,
  };
}

function sanitizeMotionGuide(guide: MotionGuide): MotionGuide {
  return {
    ...guide,
    orientation: guide.orientation === "vertical" ? "vertical" : "horizontal",
    position: finite(guide.position, 0),
    color: guide.color?.trim() || undefined,
  };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}
