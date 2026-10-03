export const DEFAULT_EDITING_FRAME_RATE = 30;

export const EDITING_FRAME_RATE_OPTIONS: ReadonlyArray<{
  value: number;
  label: string;
}> = [
  { value: 23.976, label: "23.976 fps" },
  { value: 24, label: "24 fps" },
  { value: 25, label: "25 fps" },
  { value: 29.97, label: "29.97 fps" },
  { value: 30, label: "30 fps" },
  { value: 50, label: "50 fps" },
  { value: 59.94, label: "59.94 fps" },
  { value: 60, label: "60 fps" },
];

export function normalizeEditingFrameRate(frameRate: number): number {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    return DEFAULT_EDITING_FRAME_RATE;
  }
  return Math.min(240, frameRate);
}

export function editingFrameDurationMs(frameRate: number): number {
  return 1000 / normalizeEditingFrameRate(frameRate);
}

export function editingFrameStepSeconds(frameRate: number): number {
  return 1 / normalizeEditingFrameRate(frameRate);
}

/** Move to an adjacent frame boundary, including after a fractional-time seek. */
export function stepEditingFrame(
  position: number,
  direction: -1 | 1,
  frameRate: number,
): number {
  const rate = normalizeEditingFrameRate(frameRate);
  const frame = Math.max(0, Number.isFinite(position) ? position : 0) * rate;
  // Tolerate floating point error when an existing seek is exactly on a frame.
  const next = direction === 1
    ? Math.floor(frame + 1e-7) + 1
    : Math.ceil(frame - 1e-7) - 1;
  return Math.max(0, next / rate);
}
