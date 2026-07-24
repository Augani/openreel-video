import type { MotionComposition, MotionLayer, MotionVector2 } from "./types";
import { getMotionLayerLayoutBounds, type MotionLayerLayoutBounds } from "./motion-layout";
import { getMotionGuideSnapPosition } from "./motion-guides";

export type MotionSnapAxis = "x" | "y";
export type MotionSnapGuideKind = "composition" | "guide" | "layer" | "grid";

export interface MotionSnapGuide {
  readonly axis: MotionSnapAxis;
  readonly position: number;
  readonly kind: MotionSnapGuideKind;
  readonly sourceLayerId?: string;
  readonly sourceGuideId?: string;
}

export interface MotionSnapOptions {
  readonly threshold?: number;
  readonly gridSize?: number;
  readonly snapToComposition?: boolean;
  readonly snapToGuides?: boolean;
  readonly snapToLayers?: boolean;
  readonly snapToGrid?: boolean;
  /** Layer targets to omit, such as the other members of a moving selection. */
  readonly ignoredLayerIds?: readonly string[];
}

export interface MotionSnapResult {
  readonly position: MotionVector2;
  readonly guides: MotionSnapGuide[];
  readonly snapped: boolean;
}

interface SnapCandidate {
  readonly delta: number;
  readonly guide: MotionSnapGuide;
  readonly priority: number;
}

const DEFAULT_SNAP_THRESHOLD = 8;
const DEFAULT_GRID_SIZE = 40;

export function snapMotionLayerPosition(
  composition: MotionComposition,
  layerId: string,
  proposedPosition: MotionVector2,
  options: MotionSnapOptions = {},
): MotionSnapResult {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    return { position: proposedPosition, guides: [], snapped: false };
  }

  const proposedLayer = {
    ...layer,
    transform: {
      ...layer.transform,
      position: proposedPosition,
    },
  } as MotionLayer;
  const movingBounds = getMotionLayerLayoutBounds(proposedLayer);
  const threshold = Math.max(
    0,
    Number.isFinite(options.threshold)
      ? (options.threshold as number)
      : DEFAULT_SNAP_THRESHOLD,
  );

  const snapToComposition = options.snapToComposition ?? true;
  const snapToGuides = options.snapToGuides ?? true;
  const snapToLayers = options.snapToLayers ?? true;
  const snapToGrid = options.snapToGrid ?? false;
  const gridSize = Math.max(
    1,
    Number.isFinite(options.gridSize) ? (options.gridSize as number) : DEFAULT_GRID_SIZE,
  );

  const xCandidates: SnapCandidate[] = [];
  const yCandidates: SnapCandidate[] = [];

  if (snapToComposition) {
    appendBoundsCandidates(
      xCandidates,
      yCandidates,
      movingBounds,
      createCompositionBounds(composition),
      "composition",
      0,
    );
  }

  if (snapToGuides) {
    appendGuideCandidates(xCandidates, yCandidates, movingBounds, composition);
  }

  if (snapToLayers) {
    const ignoredLayerIds = new Set(options.ignoredLayerIds ?? []);
    for (const candidateLayer of composition.layers) {
      if (
        candidateLayer.id === layerId ||
        ignoredLayerIds.has(candidateLayer.id) ||
        !candidateLayer.visible
      ) {
        continue;
      }
      appendBoundsCandidates(
        xCandidates,
        yCandidates,
        movingBounds,
        getMotionLayerLayoutBounds(candidateLayer),
        "layer",
        1,
      );
    }
  }

  if (snapToGrid) {
    appendGridCandidates(xCandidates, yCandidates, movingBounds, gridSize);
  }

  const bestX = findBestSnapCandidate(xCandidates, threshold);
  const bestY = findBestSnapCandidate(yCandidates, threshold);
  const guides = [bestX?.guide, bestY?.guide].filter(Boolean) as MotionSnapGuide[];
  return {
    position: {
      x: roundSnapValue(proposedPosition.x + (bestX?.delta ?? 0)),
      y: roundSnapValue(proposedPosition.y + (bestY?.delta ?? 0)),
    },
    guides,
    snapped: guides.length > 0,
  };
}

function appendBoundsCandidates(
  xCandidates: SnapCandidate[],
  yCandidates: SnapCandidate[],
  movingBounds: MotionLayerLayoutBounds,
  targetBounds: MotionLayerLayoutBounds,
  kind: MotionSnapGuideKind,
  priority: number,
): void {
  for (const movingAnchor of [movingBounds.left, movingBounds.centerX, movingBounds.right]) {
    for (const target of [targetBounds.left, targetBounds.centerX, targetBounds.right]) {
      xCandidates.push({
        delta: roundSnapValue(target - movingAnchor),
        guide: {
          axis: "x",
          position: target,
          kind,
          sourceLayerId: kind === "layer" ? targetBounds.layerId : undefined,
        },
        priority,
      });
    }
  }

  for (const movingAnchor of [movingBounds.top, movingBounds.centerY, movingBounds.bottom]) {
    for (const target of [targetBounds.top, targetBounds.centerY, targetBounds.bottom]) {
      yCandidates.push({
        delta: roundSnapValue(target - movingAnchor),
        guide: {
          axis: "y",
          position: target,
          kind,
          sourceLayerId: kind === "layer" ? targetBounds.layerId : undefined,
        },
        priority,
      });
    }
  }
}

function appendGuideCandidates(
  xCandidates: SnapCandidate[],
  yCandidates: SnapCandidate[],
  movingBounds: MotionLayerLayoutBounds,
  composition: MotionComposition,
): void {
  for (const guide of composition.guides ?? []) {
    const snap = getMotionGuideSnapPosition(guide);
    const targets =
      snap.axis === "x"
        ? [movingBounds.left, movingBounds.centerX, movingBounds.right]
        : [movingBounds.top, movingBounds.centerY, movingBounds.bottom];
    const candidates = snap.axis === "x" ? xCandidates : yCandidates;

    for (const movingAnchor of targets) {
      candidates.push({
        delta: roundSnapValue(snap.position - movingAnchor),
        guide: {
          axis: snap.axis,
          position: snap.position,
          kind: "guide",
          sourceGuideId: guide.id,
        },
        priority: 0,
      });
    }
  }
}

function appendGridCandidates(
  xCandidates: SnapCandidate[],
  yCandidates: SnapCandidate[],
  movingBounds: MotionLayerLayoutBounds,
  gridSize: number,
): void {
  for (const movingAnchor of [movingBounds.left, movingBounds.centerX, movingBounds.right]) {
    const target = Math.round(movingAnchor / gridSize) * gridSize;
    xCandidates.push({
      delta: roundSnapValue(target - movingAnchor),
      guide: { axis: "x", position: target, kind: "grid" },
      priority: 2,
    });
  }

  for (const movingAnchor of [movingBounds.top, movingBounds.centerY, movingBounds.bottom]) {
    const target = Math.round(movingAnchor / gridSize) * gridSize;
    yCandidates.push({
      delta: roundSnapValue(target - movingAnchor),
      guide: { axis: "y", position: target, kind: "grid" },
      priority: 2,
    });
  }
}

function findBestSnapCandidate(
  candidates: readonly SnapCandidate[],
  threshold: number,
): SnapCandidate | null {
  return (
    candidates
      .filter((candidate) => Math.abs(candidate.delta) <= threshold)
      .sort((a, b) => {
        const delta = Math.abs(a.delta) - Math.abs(b.delta);
        return delta === 0 ? a.priority - b.priority : delta;
      })[0] ?? null
  );
}

function createCompositionBounds(
  composition: MotionComposition,
): MotionLayerLayoutBounds {
  return {
    layerId: composition.id,
    left: 0,
    centerX: roundSnapValue(composition.width / 2),
    right: composition.width,
    top: 0,
    centerY: roundSnapValue(composition.height / 2),
    bottom: composition.height,
    width: composition.width,
    height: composition.height,
  };
}

function roundSnapValue(value: number): number {
  return Number(value.toFixed(4));
}
