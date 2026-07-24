import type { MotionAudioClip } from "./types";

export interface MotionAudioTimingOptions {
  readonly compositionDuration: number;
  readonly frameRate?: number;
}

const minimumDuration = (options: MotionAudioTimingOptions): number =>
  1 / Math.max(1, options.frameRate ?? 30);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function moveMotionAudioClipInTime(
  clip: MotionAudioClip,
  startTime: number,
  options: MotionAudioTimingOptions,
): MotionAudioClip {
  const maxStart = Math.max(0, options.compositionDuration - clip.duration);
  return { ...clip, startTime: clamp(startTime, 0, maxStart) };
}

export function trimMotionAudioClipInPoint(
  clip: MotionAudioClip,
  startTime: number,
  options: MotionAudioTimingOptions,
): MotionAudioClip {
  const clipEnd = clip.startTime + clip.duration;
  const nextStart = clamp(
    startTime,
    0,
    Math.max(clip.startTime, clipEnd - minimumDuration(options)),
  );
  const delta = nextStart - clip.startTime;
  return {
    ...clip,
    startTime: nextStart,
    duration: Math.max(minimumDuration(options), clip.duration - delta),
    trimStart: Math.max(0, (clip.trimStart ?? 0) + delta),
    fadeIn: Math.min(clip.fadeIn ?? 0, Math.max(0, clip.duration - delta)),
    fadeOut: Math.min(clip.fadeOut ?? 0, Math.max(0, clip.duration - delta)),
  };
}

export function trimMotionAudioClipOutPoint(
  clip: MotionAudioClip,
  endTime: number,
  options: MotionAudioTimingOptions,
): MotionAudioClip {
  const nextEnd = clamp(
    endTime,
    clip.startTime + minimumDuration(options),
    options.compositionDuration,
  );
  const duration = nextEnd - clip.startTime;
  return {
    ...clip,
    duration,
    fadeIn: Math.min(clip.fadeIn ?? 0, duration),
    fadeOut: Math.min(clip.fadeOut ?? 0, duration),
  };
}

export function splitMotionAudioClipAtTime(
  clip: MotionAudioClip,
  time: number,
  idFactory: () => string = () => `motion-audio-${crypto.randomUUID()}`,
): readonly [MotionAudioClip, MotionAudioClip] | null {
  const offset = time - clip.startTime;
  if (offset <= 0 || offset >= clip.duration) return null;
  const remainingDuration = clip.duration - offset;
  return [
    {
      ...clip,
      duration: offset,
      fadeIn: Math.min(clip.fadeIn ?? 0, offset),
      fadeOut: 0,
    },
    {
      ...clip,
      id: idFactory(),
      startTime: time,
      duration: remainingDuration,
      trimStart: Math.max(0, (clip.trimStart ?? 0) + offset),
      fadeIn: Math.min(
        remainingDuration,
        Math.max(0, (clip.fadeIn ?? 0) - offset),
      ),
      fadeOut: Math.min(clip.fadeOut ?? 0, remainingDuration),
    },
  ];
}

export function duplicateMotionAudioClip(
  clip: MotionAudioClip,
  options: MotionAudioTimingOptions & {
    readonly startTime?: number;
    readonly idFactory?: () => string;
  },
): MotionAudioClip {
  const duplicate = {
    ...structuredClone(clip),
    id:
      options.idFactory?.() ??
      `motion-audio-${crypto.randomUUID()}`,
  };
  return moveMotionAudioClipInTime(
    duplicate,
    options.startTime ?? clip.startTime,
    options,
  );
}
