import type { MotionVideoLayer } from "./types";

const finite = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? (value as number) : fallback;

const wrap = (value: number, duration: number): number => {
  const result = value % duration;
  return result < 0 ? result + duration : result;
};

/** Resolves the media-source time shared by stage preview and final export. */
export function getMotionVideoLayerSourceTime(
  layer: MotionVideoLayer,
  localTime: number,
  sourceDuration?: number,
): number {
  const duration = finite(sourceDuration, 0);
  const freezeFrame = layer.freezeFrame;
  if (Number.isFinite(freezeFrame)) {
    const frozen = Math.max(0, freezeFrame as number);
    return duration > 0 ? Math.min(duration, frozen) : frozen;
  }

  const rate = Math.max(0.01, Math.abs(finite(layer.playbackRate, 1)));
  const trimStart = Math.max(0, finite(layer.trimStart ?? layer.timeOffset, 0));
  const elapsed = Math.max(0, finite(localTime, 0)) * rate;
  const sourceTime = layer.reverse
    ? (duration > 0 ? duration - trimStart : trimStart) - elapsed
    : trimStart + elapsed;

  if (layer.loop && duration > 0) return wrap(sourceTime, duration);
  if (duration > 0) return Math.max(0, Math.min(duration, sourceTime));
  return Math.max(0, sourceTime);
}
