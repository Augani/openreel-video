import type { Clip } from "@openreel/core";
import { DEFAULT_TRANSFORM } from "./types";

/**
 * A seek approximation is only drawn when the composition at that time is just
 * one untouched video layer: with effects, grading, keyframes, masks, overlays
 * or transitions the exact render is the only correct picture, so those frames
 * keep waiting for it.
 */
export function isPlainVideoClip(clip: Clip, hasMask = false): boolean {
  if (hasMask) return false;
  if (clip.effects.length > 0 || clip.keyframes.length > 0) return false;
  if (clip.colorGrading || clip.chromaKey) return false;
  if (clip.blendMode && clip.blendMode !== "normal") return false;
  if (clip.blendOpacity !== undefined && clip.blendOpacity !== 1) return false;
  if (clip.stabilization?.enabled) return false;
  if (clip.emphasisAnimation && clip.emphasisAnimation.type !== "none") return false;
  if (clip.reversed || clip.freezeFrames?.length || clip.speedKeyframes?.length) return false;
  if (clip.metadata?.motionClip || clip.metadata?.motionCompositionId) return false;
  const t = clip.transform;
  if (!t) return true;
  const d = DEFAULT_TRANSFORM;
  return (
    t.position.x === d.position.x &&
    t.position.y === d.position.y &&
    t.scale.x === d.scale.x &&
    t.scale.y === d.scale.y &&
    t.rotation === d.rotation &&
    t.anchor.x === d.anchor.x &&
    t.anchor.y === d.anchor.y &&
    (t.opacity ?? 1) === (d.opacity ?? 1) &&
    !t.borderRadius &&
    !t.crop &&
    !t.rotate3d &&
    !t.perspective &&
    (t.fitMode === undefined || t.fitMode === "contain")
  );
}

/** How far (seconds) an anchor may be from the target and still be shown. */
export const APPROXIMATION_MAX_DISTANCE = 2;
/** Exact decodes slower than this get an approximation painted first. */
export const APPROXIMATION_DELAY_MS = 20;

/**
 * Tracks what the paused canvas currently shows so a seek approximation can
 * never overwrite the exact frame for the same time, and so an approximation
 * painted for one time is never mistaken for the exact frame of another.
 */
export class PresentedFrameTracker {
  private exactTime: number | null = null;

  markExact(time: number): void {
    this.exactTime = time;
  }

  /** The canvas now holds an approximation: no exact frame is on screen. */
  markApproximate(): void {
    this.exactTime = null;
  }

  /** False when the exact frame for `time` is already on the canvas. */
  allowsApproximation(time: number): boolean {
    return this.exactTime === null || Math.abs(this.exactTime - time) >= 1e-7;
  }
}
