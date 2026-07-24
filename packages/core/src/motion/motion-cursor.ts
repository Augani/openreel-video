import { applyMotionAnimationPreset } from "./motion-animation-presets";
import { upsertMotionLayerKeyframe } from "./motion-keyframes";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type { MotionAsset, MotionComposition, MotionImageLayer } from "./types";

const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
  '<path d="M5 2.5 19 11l-6.2 1.4L9.7 19 5 2.5Z" fill="#ffffff" stroke="#0b0b10" ' +
  'stroke-width="1.4" stroke-linejoin="round"/></svg>';
const CURSOR_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(CURSOR_SVG)}`;
const CURSOR_ASSET_ID = "motion-cursor-pointer";
const CURSOR_SIZE = 40;

export interface CursorClickResult {
  readonly composition: MotionComposition;
  readonly cursorLayerId: string;
}

const cursorId = (): string =>
  `motion-cursor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Drops an animated cursor that travels to the target layer, click-presses, and
 * makes the target react (Click Press preset). The cursor is an image layer
 * backed by a baked SVG pointer asset. Returns null if the target is missing.
 */
export function createCursorClick(
  composition: MotionComposition,
  targetLayerId: string,
  options: {
    readonly time?: number;
    readonly travel?: number;
    readonly from?: { readonly x: number; readonly y: number };
  } = {},
): CursorClickResult | null {
  const target = composition.layers.find((layer) => layer.id === targetLayerId);
  if (!target) return null;

  const travel = options.travel ?? 0.8;
  const gestureEnd = travel + 0.3;
  // Keep the whole gesture (travel + click pulse) inside the composition so its
  // layer-local keyframes stay within the cursor layer's active window.
  const time = Math.max(0, Math.min(options.time ?? 0, composition.duration - gestureEnd));
  const targetPos = {
    x: target.transform.position.x,
    y: target.transform.position.y,
  };
  const from = options.from ?? { x: targetPos.x - 280, y: targetPos.y - 200 };

  let cursor: MotionImageLayer = {
    id: cursorId(),
    type: "image",
    name: "Cursor",
    startTime: time,
    duration: Math.max(gestureEnd, composition.duration - time),
    visible: true,
    locked: false,
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x: from.x, y: from.y } },
    keyframes: [],
    assetId: CURSOR_ASSET_ID,
    width: CURSOR_SIZE,
    height: CURSOR_SIZE,
  };

  // Travel (layer-local: 0 == `time`). Position lands on the target.
  cursor = upsertMotionLayerKeyframe(cursor, "transform.position.x", 0, {
    value: from.x,
    easing: "easeOutCubic",
  });
  cursor = upsertMotionLayerKeyframe(cursor, "transform.position.y", 0, {
    value: from.y,
    easing: "easeOutCubic",
  });
  cursor = upsertMotionLayerKeyframe(cursor, "transform.position.x", travel, {
    value: targetPos.x,
    easing: "easeOutCubic",
  });
  cursor = upsertMotionLayerKeyframe(cursor, "transform.position.y", travel, {
    value: targetPos.y,
    easing: "easeOutCubic",
  });
  // Click pulse on arrival.
  for (const axis of ["transform.scale.x", "transform.scale.y"] as const) {
    cursor = upsertMotionLayerKeyframe(cursor, axis, travel, { value: 1, easing: "ease-out" });
    cursor = upsertMotionLayerKeyframe(cursor, axis, travel + 0.08, {
      value: 0.8,
      easing: "ease-out",
    });
    cursor = upsertMotionLayerKeyframe(cursor, axis, travel + 0.22, {
      value: 1,
      easing: "ease-out",
    });
  }

  // Target reacts with the Click Press preset at arrival.
  const targetPressTime = Math.max(0, time + travel - target.startTime);
  const pressedTarget = applyMotionAnimationPreset(target, "click-press", {
    startTime: targetPressTime,
    duration: 0.24,
  });

  const cursorAsset: MotionAsset = {
    id: CURSOR_ASSET_ID,
    type: "image",
    name: "Cursor",
    url: CURSOR_DATA_URI,
    width: 24,
    height: 24,
  };
  const assets = composition.assets.some((asset) => asset.id === CURSOR_ASSET_ID)
    ? composition.assets
    : [...composition.assets, cursorAsset];

  return {
    composition: {
      ...composition,
      assets,
      layers: composition.layers
        .map((layer) => (layer.id === targetLayerId ? pressedTarget : layer))
        .concat(cursor),
      modifiedAt: Date.now(),
    },
    cursorLayerId: cursor.id,
  };
}
