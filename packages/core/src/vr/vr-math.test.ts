import { describe, expect, it } from "vitest";
import {
  apply3,
  cameraRotation,
  contentRotation,
  dirFromEquirect,
  dirFromYawPitch,
  equirectFromDir,
  eyeOfPixel,
  eyeRect,
  fitRect,
  lerpAngleShortest,
  renderFlatView,
  sampleEquirect,
  sampleSpherePixel,
  verticalFov,
  wrapDegrees,
  yawPitchFromDir,
} from "./vr-math";
import { smoothSphereImage } from "./vr-test-images";

const close = (a: number, b: number, eps = 1e-9): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("equirect geometry", () => {
  it("maps the frame centre to straight ahead and the edges to the back", () => {
    const c = dirFromEquirect(0.5, 0.5);
    close(c[0], 0);
    close(c[1], 0);
    close(c[2], 1);
    const e = dirFromEquirect(0, 0.5);
    close(e[2], -1);
    const top = dirFromEquirect(0.3, 0);
    close(top[1], 1);
  });

  it("round trips directions through (u, v)", () => {
    for (const [yaw, pitch] of [[0, 0], [45, 30], [-120, -60], [170, 10], [-179, 80]]) {
      const d = dirFromYawPitch(yaw, pitch);
      const { u, v } = equirectFromDir(d);
      const back = dirFromEquirect(u, v);
      for (let i = 0; i < 3; i++) close(back[i], d[i], 1e-9);
      const yp = yawPitchFromDir(d);
      close(yp.yaw, yaw, 1e-9);
      close(yp.pitch, pitch, 1e-9);
    }
  });
});

describe("rotations", () => {
  it("pan moves content to the right, tilt moves it up, roll turns it clockwise", () => {
    const pan = yawPitchFromDir(apply3(contentRotation(40, 0, 0), dirFromYawPitch(10, 0)));
    close(pan.yaw, 50, 1e-9);
    close(pan.pitch, 0, 1e-9);
    const tilt = yawPitchFromDir(apply3(contentRotation(0, 25, 0), dirFromYawPitch(0, 0)));
    close(tilt.pitch, 25, 1e-9);
    // Something above the centre, rolled 90 degrees clockwise, ends up to the right of the centre.
    const roll = yawPitchFromDir(apply3(contentRotation(0, 0, 90), dirFromYawPitch(0, 30)));
    close(roll.yaw, 30, 1e-9);
    close(roll.pitch, 0, 1e-9);
  });

  it("a camera is the dual: pan looks right, tilt looks up", () => {
    const fwd = apply3(cameraRotation(35, 20, 0), [0, 0, 1]);
    const yp = yawPitchFromDir(fwd);
    close(yp.yaw, 35, 1e-9);
    close(yp.pitch, 20, 1e-9);
  });

  it("wraps and interpolates angles on the shorter arc", () => {
    close(wrapDegrees(350), -10);
    close(wrapDegrees(-190), 170);
    close(lerpAngleShortest(350, 10, 0.5), 360);
    close(lerpAngleShortest(10, 350, 0.25), 5);
    close(lerpAngleShortest(0, 90, 0.5), 45);
  });
});

describe("frame layouts", () => {
  it("splits stereo frames into two eye rectangles", () => {
    expect(eyeRect("over-under", 1, 100, 51)).toEqual({ x: 0, y: 25, w: 100, h: 26 });
    expect(eyeRect("side-by-side", 0, 101, 40)).toEqual({ x: 0, y: 0, w: 50, h: 40 });
    expect(eyeOfPixel("over-under", 3, 24, 100, 51)).toBe(0);
    expect(eyeOfPixel("over-under", 3, 25, 100, 51)).toBe(1);
    expect(eyeOfPixel("mono", 3, 25, 100, 51)).toBe(0);
  });
});

describe("rectilinear view", () => {
  const W = 512;
  const H = 256;

  it("puts a known yaw / pitch at the analytic pixel", () => {
    const src = new Uint8ClampedArray(W * H * 4);
    // One bright 5x5 dot at yaw 25 degrees, pitch 0.
    const target = equirectFromDir(dirFromYawPitch(25, 0));
    const cx = Math.round(target.u * W - 0.5);
    const cy = Math.round(target.v * H - 0.5);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const o = ((cy + dy) * W + cx + dx) * 4;
        src[o] = src[o + 1] = src[o + 2] = src[o + 3] = 255;
      }
    }
    for (let i = 3; i < src.length; i += 4) if (src[i] === 0) src[i] = 255;
    const out = new Uint8ClampedArray(640 * 360 * 4);
    renderFlatView(src, W, { x: 0, y: 0, w: W, h: H }, out, 640, 360, {
      projection: "rectilinear", fov: 90, pan: 0, tilt: 0, roll: 0, aspect: 640 / 360,
    });
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let y = 0; y < 360; y++) {
      for (let x = 0; x < 640; x++) {
        const v = out[(y * 640 + x) * 4];
        if (v > 20) { sx += x * v; sy += y * v; sw += v; }
      }
    }
    // Analytic position of the dot centre (pixel centres at +0.5) in a 90 degree rectilinear view.
    const d = dirFromEquirect((cx + 0.5) / W, (cy + 0.5) / H);
    const expectedX = 640 * (0.5 + d[0] / d[2] / 2);
    const expectedY = 360 * (0.5 - d[1] / d[2] / (2 / (640 / 360)));
    expect(Math.abs(sx / sw + 0.5 - expectedX)).toBeLessThan(0.8);
    expect(Math.abs(sy / sw + 0.5 - expectedY)).toBeLessThan(0.8);
    // And the nominal yaw is where it should be: tan(25 deg) of the half width right of the centre.
    expect(Math.abs(expectedX - 640 * (0.5 + Math.tan((25 * Math.PI) / 180) / 2))).toBeLessThan(1);
  });

  it("centres the view on the pan / tilt it is aimed at", () => {
    const src = smoothSphereImage(W, H);
    const out = new Uint8ClampedArray(320 * 180 * 4);
    renderFlatView(src, W, { x: 0, y: 0, w: W, h: H }, out, 320, 180, {
      projection: "rectilinear", fov: 60, pan: 70, tilt: -20, roll: 0, aspect: 320 / 180,
    });
    const d = dirFromYawPitch(70, -20);
    const o = (90 * 320 + 160) * 4;
    expect(Math.abs(out[o] - (128 + 100 * d[0] * (0.7 + 0.3 * d[1])))).toBeLessThan(3);
    expect(Math.abs(out[o + 1] - (128 + 100 * d[1]))).toBeLessThan(3);
  });

  it("round trips equirect -> rectilinear -> equirect within tolerance", () => {
    const src = smoothSphereImage(W, H);
    const VW = 640;
    const VH = 360;
    const fov = 100;
    const view = new Uint8ClampedArray(VW * VH * 4);
    renderFlatView(src, W, { x: 0, y: 0, w: W, h: H }, view, VW, VH, {
      projection: "rectilinear", fov, pan: 0, tilt: 0, roll: 0, aspect: VW / VH,
    });
    const k = Math.tan((fov * Math.PI) / 360);
    let err = 0;
    let n = 0;
    let worst = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = dirFromEquirect((x + 0.5) / W, (y + 0.5) / H);
        if (d[2] <= 0.2) continue;
        const s = 0.5 + d[0] / d[2] / (2 * k);
        const t = 0.5 - d[1] / d[2] / (2 * (k / (VW / VH)));
        if (s < 0.03 || s > 0.97 || t < 0.03 || t > 0.97) continue;
        const px = [0, 0, 0, 0];
        sampleEquirect(view, VW, { x: 0, y: 0, w: VW, h: VH }, s, t, px);
        // sampleEquirect wraps horizontally, which is harmless inside the 3-97% window.
        for (let c = 0; c < 3; c++) {
          const e = Math.abs(px[c] - src[(y * W + x) * 4 + c]);
          err += e;
          worst = Math.max(worst, e);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20000);
    expect(err / n).toBeLessThan(0.8);
    expect(worst).toBeLessThan(6);
  });

  it("fits a view of another aspect into the buffer and derives the vertical field of view", () => {
    const r = fitRect(200, 100, 16 / 9);
    close(r.w, 100 * (16 / 9));
    expect(r.h).toBe(100);
    close(r.x, (200 - r.w) / 2);
    const tall = fitRect(100, 100, 0.5);
    expect(tall.w).toBe(50);
    close(verticalFov(90, 1), 90, 1e-9);
    expect(verticalFov(90, 16 / 9)).toBeCloseTo(58.7, 0);
  });
});

describe("sampling", () => {
  it("wraps across the seam and clamps vertically", () => {
    const w = 8;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; data[o] = x * 30; data[o + 3] = 255; }
    const out = [0, 0, 0, 0];
    // Exactly between the last and first column: the average of 210 and 0.
    sampleEquirect(data, w, { x: 0, y: 0, w, h }, 0, 0.5, out);
    expect(out[0]).toBeCloseTo(105, 6);
    sampleSpherePixel(data, w, { x: 0, y: 0, w, h }, 7.5, 1, out);
    expect(out[0]).toBeCloseTo(105, 6);
  });

  it("continues over a pole on the opposite meridian", () => {
    const w = 8;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; data[o] = x * 30; data[o + 3] = 255; }
    const out = [0, 0, 0, 0];
    // One row above the top edge, column 1 reflects to row 0 of column 5.
    sampleSpherePixel(data, w, { x: 0, y: 0, w, h }, 1, -1, out);
    expect(out[0]).toBeCloseTo(150, 6);
  });
});
