import { expect, type Page, type TestInfo } from "@playwright/test";
import { hideMain } from "./essential-graphics-lib";
import { clipsOf, openEditor, readState, seek, settle } from "./helpers";

/**
 * Real-pixel checks for the two sequence-PAR geometry gaps, shared by the WebGPU project (`gpu`) and the
 * fallback projects (Canvas2D renderer):
 *  1. a ROTATED layer in a non-square-PAR sequence stays a rigid square where it is looked at (display space),
 *     not a parallelogram: the monitor (WebGPU compositor or Canvas2D) and export (VideoEngine.renderFrame) agree;
 *  2. a BLURRED dot spreads isotropically in display space, monitor and export agreeing.
 * Nothing is mocked: pixels are read from the Program canvas and from VideoEngine.renderFrame.
 */
export const PROGRAM = 'canvas[aria-label^="Program frame"]';

export const PAR_CASES = [
  { name: "DV NTSC 0.9091", par: 10 / 11 },
  { name: "HDV 1.3333", par: 4 / 3 },
  { name: "anamorphic 2.0", par: 2 },
  { name: "square 1.0", par: 1 },
];

interface Moments {
  count: number;
  /** centroid in display pixels (x already multiplied by the PAR) divided by the frame height */
  cx: number;
  cy: number;
  /** central second moments in display pixels squared, divided by frame height squared */
  xx: number;
  yy: number;
  xy: number;
  width: number;
  height: number;
}

export interface Measured {
  monitor: Moments;
  exported: Moments;
  par: number;
  gpuSubmits: number;
  gpuAdapter: boolean;
  renderer: string;
}

/** Install a counter on WebGPU queue submits so a test can tell the compositor ran. */
async function countGpuSubmits(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gpuSubmits?: number };
    w.__gpuSubmits = 0;
    const proto = (globalThis as unknown as { GPUQueue?: { prototype: { submit: (...a: unknown[]) => unknown } } }).GPUQueue?.prototype;
    if (!proto || (proto as { __wrapped?: boolean }).__wrapped) return;
    const original = proto.submit;
    proto.submit = function (this: unknown, ...args: unknown[]) {
      w.__gpuSubmits = (w.__gpuSubmits ?? 0) + 1;
      return original.apply(this, args);
    };
    (proto as { __wrapped?: boolean }).__wrapped = true;
  });
}

/**
 * Measure `weight` pixels (a function of r, g, b, a returning 0..1) on the Program canvas and in the export render
 * at `time`. Moments are taken in DISPLAY space: x is multiplied by the sequence PAR.
 */
async function measure(page: Page, time: number, weightSource: string, playFrom?: number): Promise<Measured> {
  return page.evaluate(
    async ([sel, t, src, play]) => {
      const e = (window as any).__openreelE2E;
      const weight = new Function("r", "g", "b", `return (${src});`) as (r: number, g: number, b: number) => number;
      const project = e.project.getState().getFullProject();
      const par = project.settings.pixelAspectRatio ?? 1;
      const read = (source: HTMLCanvasElement | ImageBitmap | OffscreenCanvas, w: number, h: number) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, w, h);
        g.drawImage(source, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const moments = (data: Uint8ClampedArray, w: number, h: number) => {
        let sum = 0;
        let sx = 0;
        let sy = 0;
        let minX = w;
        let maxX = -1;
        let minY = h;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const wt = weight(data[i], data[i + 1], data[i + 2]);
            if (wt <= 0) continue;
            sum += wt;
            sx += wt * (x + 0.5) * par;
            sy += wt * (y + 0.5);
            if (wt > 0.5) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (sum === 0) return { count: 0, cx: 0, cy: 0, xx: 0, yy: 0, xy: 0, width: 0, height: 0 };
        const cx = sx / sum;
        const cy = sy / sum;
        let xx = 0;
        let yy = 0;
        let xy = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const wt = weight(data[i], data[i + 1], data[i + 2]);
            if (wt <= 0) continue;
            const dx = (x + 0.5) * par - cx;
            const dy = y + 0.5 - cy;
            xx += wt * dx * dx;
            yy += wt * dy * dy;
            xy += wt * dx * dy;
          }
        }
        const n = h * h;
        return {
          count: sum,
          cx: cx / h,
          cy: cy / h,
          xx: xx / sum / n,
          yy: yy / sum / n,
          xy: xy / sum / n,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        };
      };
      const canvas = document.querySelector(sel as string) as HTMLCanvasElement;
      // A paused monitor frame is always painted by Canvas2D; the WebGPU compositor only draws while playing, so
      // `play` samples the monitor mid-playback (the scene is static, so any frame of it will do).
      let monitor: ReturnType<typeof moments>;
      if (typeof play === "number") {
        const tl = e.timeline.getState();
        tl.seekTo(play);
        await new Promise((r) => setTimeout(r, 400));
        tl.play();
        await new Promise((r) => setTimeout(r, 1200));
        monitor = moments(read(canvas, canvas.width, canvas.height), canvas.width, canvas.height);
        e.timeline.getState().pause();
      } else {
        monitor = moments(read(canvas, canvas.width, canvas.height), canvas.width, canvas.height);
      }
      const { width, height } = project.settings;
      const engine = e.engine.getState().videoEngine;
      const frame = await engine.renderFrame(project, t as number, width, height);
      const exported = moments(read(frame.image, width, height), width, height);
      // requestAdapter can return null for a moment while many GPU clients start at once: ask a few times before concluding there is none.
      let adapter = false;
      for (let attempt = 0; attempt < 6 && !adapter; attempt++) {
        adapter = Boolean(await (navigator as any).gpu?.requestAdapter?.().catch(() => null));
        if (!adapter) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return {
        monitor,
        exported,
        par,
        gpuSubmits: (window as any).__gpuSubmits ?? 0,
        gpuAdapter: adapter,
        renderer: String(document.querySelector(sel as string)?.getAttribute("data-renderer") ?? ""),
      };
    },
    [PROGRAM, time, weightSource, playFrom ?? null] as const,
  );
}

/** Variance ratio and shear of a measured blob: 0 / 0 for a perfectly isotropic, unsheared shape. */
export const anisotropy = (m: Moments): { aspect: number; shear: number } => ({
  aspect: Math.abs(m.xx - m.yy) / (m.xx + m.yy),
  shear: Math.abs(m.xy) / (m.xx + m.yy),
});

/**
 * Rotated layer: the fixture's solid red scene (source 2 s to 4 s) scaled so it is a SQUARE in display space, rotated 30
 * degrees. A rigid rotation of a square has isotropic second moments and no xy term in display space; a layer that
 * is rotated in stored space and then squeezed (the old GPU transform) has neither.
 */
export async function runRotatedSquare(page: Page, par: number, testInfo: TestInfo): Promise<Measured> {
  await openEditor(page);
  await page.evaluate(async (pixelAspectRatio) => {
    const e = (window as any).__openreelE2E;
    await e.project.getState().updateSettings({ pixelAspectRatio });
  }, par);
  const state = await readState(page);
  const clip = clipsOf(state, "Main")[0];
  await page.evaluate(
    async ([clipId, p]) => {
      const e = (window as any).__openreelE2E;
      // Half speed: a retimed clip is not eligible for the <video>-element playback shortcut, so playback goes through
      // the frame loop that composites with the WebGPU renderer (the red scene is then 4 s to 8 s on the timeline).
      await e.speed.editClipSpeed(e.project.getState().project.id, clipId, { speed: 0.5 }, true);
      const { width, height } = e.project.getState().project.settings;
      const L = Math.max(1, Math.round(width * (p as number)));
      const aspect = 640 / 360;
      // contain-fit size of the 16:9 fixture in the display frame
      const fit = aspect <= L / height ? { w: height * aspect, h: height } : { w: L, h: L / aspect };
      const s = 0.5;
      await e.project.getState().updateClipTransform(clipId, {
        scale: { x: (s * fit.h) / fit.w, y: s },
        rotation: 30,
        position: { x: 0, y: 0 },
      });
    },
    [clip.id, par] as const,
  );
  await countGpuSubmits(page);
  await seek(page, 5);
  await settle(page, 1500);
  const measured = await measure(page, 5, "r > 150 && g < 90 && b < 90 ? 1 : 0", 4.3);
  testInfo.annotations.push({ type: "renderer", description: `submits=${measured.gpuSubmits} adapter=${measured.gpuAdapter}` });
  return measured;
}

export function expectRotatedSquare(measured: Measured, par: number): void {
  const { monitor, exported } = measured;
  expect(measured.par).toBeCloseTo(par, 4);
  expect(exported.count, "the rotated square renders in export").toBeGreaterThan(2000);
  expect(monitor.count, "the rotated square renders in the monitor").toBeGreaterThan(2000);
  for (const [label, m] of [
    ["export", exported],
    ["monitor", monitor],
  ] as const) {
    const a = anisotropy(m);
    expect(a.aspect, `${label}: a rotated square has equal x and y variance in display space (got ${a.aspect.toFixed(3)})`).toBeLessThan(0.03);
    expect(a.shear, `${label}: and no x-y covariance, i.e. it is not a parallelogram (got ${a.shear.toFixed(3)})`).toBeLessThan(0.03);
  }
  // Monitor and export agree on where it is and how big it is (scale-free, as fractions of the frame height).
  expect(Math.abs(monitor.cx - exported.cx), "centroid x").toBeLessThan(0.012);
  expect(Math.abs(monitor.cy - exported.cy), "centroid y").toBeLessThan(0.012);
  const size = (m: Moments) => Math.sqrt(m.xx + m.yy);
  expect(Math.abs(size(monitor) - size(exported)) / size(exported), "size monitor vs export").toBeLessThan(0.04);
}

/**
 * Blurred dot: a small green circle on the Titles track, blurred by an adjustment layer on a track above it (the one
 * effects path that exists in both the Program monitor and export, on the composited stored frame). Its
 * green-minus-red energy is the weight, so the neutral background contributes nothing.
 */
export async function runBlurredDot(page: Page, par: number, via: "adjustment" | "overlay"): Promise<Measured> {
  await openEditor(page);
  await hideMain(page);
  await page.evaluate(
    async ([pixelAspectRatio, mode]) => {
      const e = (window as any).__openreelE2E;
      const state = e.project.getState();
      await state.updateSettings({ pixelAspectRatio });
      const titles = e.project.getState().project.timeline.tracks.find((t: any) => t.name === "Titles");
      const dot = e.project.getState().createShapeClip(titles.id, 0.5, "circle", 4);
      e.project.getState().updateShapeStyle(dot.id, {
        fill: { type: "solid", color: "#00ff00", opacity: 1 },
        stroke: { color: "#00ff00", width: 0, opacity: 0 },
      });
      e.project.getState().updateShapeTransform(dot.id, { scale: { x: 0.5, y: 0.5 } });
      if (mode === "overlay") {
        await e.project.getState().addVideoEffect(dot.id, "blur", { radius: 22 });
      } else {
        await e.project.getState().addTrack("video", 0, { name: "Adjustments" });
        const adj = e.project.getState().project.timeline.tracks.find((t: any) => t.name === "Adjustments");
        const layer = {
          id: "par-adjustment",
          trackId: adj.id,
          name: "Blur",
          startTime: 0,
          duration: 4,
          effects: [{ id: "par-blur", type: "blur", enabled: true, params: { radius: 22 } }],
          opacity: 1,
          blendMode: "normal",
          enabled: true,
          affectedTracks: "all",
          transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
        };
        e.project.setState((s: any) => ({ project: { ...s.project, adjustmentLayers: [layer] } }));
      }
    },
    [par, via] as const,
  );
  await countGpuSubmits(page);
  await seek(page, 1.5);
  await settle(page, 1500);
  return measure(page, 1.5, "g > r + 3 ? (g - r) / 255 : 0");
}

/**
 * Blurred VIDEO clip: the fixture's solid red scene (source 2 s to 4 s, so timeline 2 s to 4 s) scaled to a small
 * square in display space and blurred by the clip's own blur effect. In the Program monitor a CSS-filterable clip
 * is drawn through `drawFrameWithTransform` with `ctx.filter`, which used to blur stored pixels (anisotropic by the
 * PAR once displayed); export blurs the decoded frame before layout.
 */
export async function runBlurredVideo(page: Page, par: number): Promise<Measured> {
  await openEditor(page);
  await page.evaluate(async (pixelAspectRatio) => {
    const e = (window as any).__openreelE2E;
    await e.project.getState().updateSettings({ pixelAspectRatio });
  }, par);
  const clip = clipsOf(await readState(page), "Main")[0];
  await page.evaluate(
    async ([clipId, p]) => {
      const e = (window as any).__openreelE2E;
      const { width, height } = e.project.getState().project.settings;
      const L = Math.max(1, Math.round(width * (p as number)));
      const aspect = 640 / 360;
      const fit = aspect <= L / height ? { w: height * aspect, h: height } : { w: L, h: L / aspect };
      const s = 0.3;
      await e.project.getState().updateClipTransform(clipId, {
        scale: { x: (s * fit.h) / fit.w, y: s },
        position: { x: 0, y: 0 },
      });
      await e.project.getState().addVideoEffect(clipId, "blur", { radius: 22 });
    },
    [clip.id, par] as const,
  );
  await seek(page, 3);
  await settle(page, 1500);
  return measure(page, 3, "r > g + 3 ? (r - g) / 255 : 0");
}

export function expectIsotropicBlur(measured: Measured, par: number, opts: { monitor: boolean; spreadTolerance?: number }): void {
  const { monitor, exported } = measured;
  expect(measured.par).toBeCloseTo(par, 4);
  expect(exported.count, "the blurred dot renders in export").toBeGreaterThan(200);
  // A visible blur: the spread is wider than the unblurred dot.
  expect(Math.sqrt(exported.yy), "export is actually blurred").toBeGreaterThan(0.02);
  const sets: Array<[string, Moments]> = [["export", exported]];
  if (opts.monitor) sets.push(["monitor", monitor]);
  for (const [label, m] of sets) {
    expect(m.count, `${label}: the dot renders`).toBeGreaterThan(200);
    // sigma_x / sigma_y in display space: 1 when isotropic (the stored-pixel blur gives PAR).
    const ratio = Math.sqrt(m.xx / m.yy);
    expect(Math.abs(ratio - 1), `${label}: blur spread ratio x/y in display space ${ratio.toFixed(3)} at PAR ${par.toFixed(4)}`).toBeLessThan(0.04);
    expect(Math.abs(m.xy) / (m.xx + m.yy), `${label}: no x-y covariance`).toBeLessThan(0.03);
  }
  if (opts.monitor) {
    const sig = (m: Moments) => Math.sqrt(m.xx + m.yy);
    expect(Math.abs(sig(monitor) - sig(exported)) / sig(exported), "blur spread monitor vs export").toBeLessThan(opts.spreadTolerance ?? 0.12);
  }
}
