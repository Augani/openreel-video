import type { Layer } from '../types/project';
import type { SmartGuide, Guide } from '../stores/canvas-store';

export interface SnapConfig {
  snapToObjects: boolean;
  snapToGuides: boolean;
  snapToGrid: boolean;
  gridSize: number;
  threshold: number;
}

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapPoint {
  value: number;
  type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
}

export function calculateSnap(
  movingBounds: BoundsRect,
  otherLayers: Layer[],
  canvasBounds: BoundsRect,
  guides: Guide[],
  config: SnapConfig
): { x: number; y: number; guides: SmartGuide[] } {
  const threshold = config.threshold ?? 5;
  const resultGuides: SmartGuide[] = [];

  let snapX = movingBounds.x;
  let snapY = movingBounds.y;

  const movingLeft = movingBounds.x;
  const movingCenterX = movingBounds.x + movingBounds.width / 2;
  const movingRight = movingBounds.x + movingBounds.width;
  const movingTop = movingBounds.y;
  const movingCenterY = movingBounds.y + movingBounds.height / 2;
  const movingBottom = movingBounds.y + movingBounds.height;

  const horizontalSnapPoints: SnapPoint[] = [];
  const verticalSnapPoints: SnapPoint[] = [];

  if (config.snapToObjects) {
    horizontalSnapPoints.push(
      { value: canvasBounds.x, type: 'left' },
      { value: canvasBounds.x + canvasBounds.width / 2, type: 'center' },
      { value: canvasBounds.x + canvasBounds.width, type: 'right' }
    );
    verticalSnapPoints.push(
      { value: canvasBounds.y, type: 'top' },
      { value: canvasBounds.y + canvasBounds.height / 2, type: 'middle' },
      { value: canvasBounds.y + canvasBounds.height, type: 'bottom' }
    );

    otherLayers.forEach((layer) => {
      const { x, y, width, height } = layer.transform;
      horizontalSnapPoints.push(
        { value: x, type: 'left' },
        { value: x + width / 2, type: 'center' },
        { value: x + width, type: 'right' }
      );
      verticalSnapPoints.push(
        { value: y, type: 'top' },
        { value: y + height / 2, type: 'middle' },
        { value: y + height, type: 'bottom' }
      );
    });
  }

  if (config.snapToGuides) {
    guides.forEach((guide) => {
      if (guide.type === 'vertical') {
        horizontalSnapPoints.push({ value: guide.position, type: 'center' });
      } else {
        verticalSnapPoints.push({ value: guide.position, type: 'middle' });
      }
    });
  }

  if (config.snapToGrid && config.gridSize > 0) {
    const gridSize = config.gridSize;
    for (let gx = 0; gx <= canvasBounds.width; gx += gridSize) {
      horizontalSnapPoints.push({ value: gx, type: 'left' });
    }
    for (let gy = 0; gy <= canvasBounds.height; gy += gridSize) {
      verticalSnapPoints.push({ value: gy, type: 'top' });
    }
  }

  let minDistX = threshold + 1;
  let snappedX = false;

  const checkXSnap = (moving: number, movingType: 'left' | 'center' | 'right') => {
    for (const point of horizontalSnapPoints) {
      const dist = Math.abs(moving - point.value);
      if (dist < minDistX && dist <= threshold) {
        minDistX = dist;
        if (movingType === 'left') {
          snapX = point.value;
        } else if (movingType === 'center') {
          snapX = point.value - movingBounds.width / 2;
        } else {
          snapX = point.value - movingBounds.width;
        }
        snappedX = true;

        resultGuides.push({
          type: 'vertical',
          position: point.value,
          start: Math.min(movingTop, 0),
          end: Math.max(movingBottom, canvasBounds.height),
        });
      }
    }
  };

  checkXSnap(movingLeft, 'left');
  checkXSnap(movingCenterX, 'center');
  checkXSnap(movingRight, 'right');

  let minDistY = threshold + 1;
  let snappedY = false;

  const checkYSnap = (moving: number, movingType: 'top' | 'middle' | 'bottom') => {
    for (const point of verticalSnapPoints) {
      const dist = Math.abs(moving - point.value);
      if (dist < minDistY && dist <= threshold) {
        minDistY = dist;
        if (movingType === 'top') {
          snapY = point.value;
        } else if (movingType === 'middle') {
          snapY = point.value - movingBounds.height / 2;
        } else {
          snapY = point.value - movingBounds.height;
        }
        snappedY = true;

        resultGuides.push({
          type: 'horizontal',
          position: point.value,
          start: Math.min(movingLeft, 0),
          end: Math.max(movingRight, canvasBounds.width),
        });
      }
    }
  };

  checkYSnap(movingTop, 'top');
  checkYSnap(movingCenterY, 'middle');
  checkYSnap(movingBottom, 'bottom');

  const uniqueGuides = resultGuides.filter(
    (guide, index, self) =>
      index ===
      self.findIndex(
        (g) => g.type === guide.type && g.position === guide.position
      )
  );

  return {
    x: snappedX ? snapX : movingBounds.x,
    y: snappedY ? snapY : movingBounds.y,
    guides: uniqueGuides,
  };
}
