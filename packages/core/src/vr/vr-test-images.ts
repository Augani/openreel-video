/** Synthetic equirectangular test images shared by the VR unit tests, the e2e specs and the benchmarks. */
import { dirFromEquirect } from "./vr-math";

/** Smooth image of the sphere: colour is a function of direction only, so it is continuous across the seam. */
export function smoothSphereImage(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = dirFromEquirect((x + 0.5) / w, (y + 0.5) / h);
      const o = (y * w + x) * 4;
      data[o] = 128 + 100 * d[0] * (0.7 + 0.3 * d[1]);
      data[o + 1] = 128 + 100 * d[1];
      data[o + 2] = 128 + 90 * d[2] * d[0] + 30 * Math.sin(3 * d[0]);
      data[o + 3] = 255;
    }
  }
  return data;
}

/**
 * A grid of the sphere: colour encodes the quadrant of longitude (red/green) and latitude (blue) with thin lines every
 * 30 degrees, so a rotation or a reframe is easy to read by eye and robust to check numerically.
 */
export function gridSphereImage(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360 - 180;
      const lat = 90 - ((y + 0.5) / h) * 180;
      const o = (y * w + x) * 4;
      const lonLine = Math.abs(((lon + 180) % 30) - 15) > 14;
      const latLine = Math.abs(((lat + 90) % 30) - 15) > 14;
      const line = lonLine || latLine;
      data[o] = line ? 255 : Math.round(((lon + 180) / 360) * 200 + 30);
      data[o + 1] = line ? 255 : Math.round(((lat + 90) / 180) * 200 + 30);
      data[o + 2] = line ? 255 : lon > 0 ? 200 : 60;
      data[o + 3] = 255;
    }
  }
  return data;
}
