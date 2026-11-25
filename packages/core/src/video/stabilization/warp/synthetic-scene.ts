import type { GrayFrame } from "./motion-estimate";

/**
 * Synthetic shaky footage with a known camera, for the stabilizer's tests and generated clips. The scene is an
 * analytic texture, so any camera transform renders exactly (no resampling error); a frame can also be rendered
 * with a different camera for every row (rolling shutter).
 */
export interface Camera {
  /** Content displacement in px, rotation in radians (about the frame centre) and log scale. */
  dx: number;
  dy: number;
  rotation: number;
  logScale: number;
}

export const STILL_CAMERA: Camera = { dx: 0, dy: 0, rotation: 0, logScale: 0 };

function scene(u: number, v: number): number {
  // smooth multi-scale texture plus a few blobs: every region has gradients in both directions
  let value = 0.5;
  value += 0.14 * Math.sin(u * 0.19 + 0.6 * Math.sin(v * 0.07));
  value += 0.12 * Math.sin(v * 0.23 + 1.1 + 0.5 * Math.sin(u * 0.05));
  value += 0.09 * Math.sin((u + v) * 0.11 + 2.0);
  value += 0.07 * Math.sin((u - 1.3 * v) * 0.31 + 0.4);
  value += 0.05 * Math.sin(u * 0.47 + v * 0.29 + 1.7);
  const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
    [40, 30, 9, 0.25], [110, 60, 12, -0.22], [70, 80, 7, 0.2], [130, 20, 10, 0.18], [25, 75, 8, -0.2],
  ];
  for (const [bx, by, r, a] of blobs) value += a * Math.exp(-((u - bx) ** 2 + (v - by) ** 2) / (2 * r * r));
  return Math.min(1, Math.max(0, value));
}

/** One frame; `cameraAt(row)` is the camera while that row was captured. */
export function renderScene(width: number, height: number, cameraAt: (row: number) => Camera): GrayFrame {
  const data = new Float32Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    const cam = cameraAt(y);
    const a = Math.exp(-cam.logScale);
    const cos = a * Math.cos(-cam.rotation);
    const sin = a * Math.sin(-cam.rotation);
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - cx - cam.dx;
      const py = y + 0.5 - cy - cam.dy;
      data[y * width + x] = scene(cos * px - sin * py + cx, sin * px + cos * py + cy);
    }
  }
  return { width, height, data };
}

/** A deterministic, high-frequency, zero-mean jitter (several incommensurate sinusoids). */
export function jitter(t: number, amplitude: number, phase: number): number {
  return (
    amplitude *
    (0.5 * Math.sin(t * 2.1 + phase) + 0.3 * Math.sin(t * 1.3 + 2 * phase + 0.7) + 0.25 * Math.sin(t * 3.1 + 3 * phase + 1.9))
  );
}
