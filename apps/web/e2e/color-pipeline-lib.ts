import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FIXTURE_DIR } from "./global-setup";
import { seek, settle, snapStable } from "./helpers";
import { clipGrade, openColorGrading, openWithClips } from "./lumetri-basic-lib";

const FIXTURE = "pipeline-hues.mp4";

/** Hue sweep: chroma planes rotate once around the wheel left to right at a fixed luma. */
export function ensurePipelineFixtures(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, FIXTURE);
  if (existsSync(path)) return;
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", "nullsrc=size=640x360:rate=30:duration=2",
      "-vf", "format=yuv420p,geq=lum='110+30*Y/H':cb='128-70*cos(2*PI*X/W)':cr='128+70*sin(2*PI*X/W)'",
      "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p",
      "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
      "-movflags", "+write_colr",
      path,
    ],
    { stdio: "ignore" },
  );
}

interface CoreHook {
  colorGradingEngine: { ColorGradingEngine: new (w: number, h: number) => any };
  hueCurves: Record<string, any>;
  lumetriPipeline: Record<string, any>;
}

export interface EngineParity {
  gpuAvailable: boolean;
  gpuError: string | null;
  /** Largest per-channel difference between the float GPU pass and the float CPU pass (8-bit levels). */
  maxDiff: number;
  meanDiff: number;
  /** Pixels differing by more than 1 level. */
  over1: number;
  pixels: number;
  /** Largest difference between the engine's CPU pass and the pure reference function. */
  cpuVsReferenceMax: number;
  /** Mean per-channel change the grade made to the source (proves the curves did something). */
  meanChange: number;
  /** The same change measured on the GPU output (proves the shader really ran). */
  gpuMeanChange: number;
}

/**
 * Renders a hue x saturation x lightness test card through the fused float pass on the GPU (WebGL2
 * fragment shader) and on the CPU reference with the same stages (Basic Correction, colour wheels and all
 * four hue curves) and compares them.
 */
export async function runEngineParity(page: Page): Promise<EngineParity> {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __openreelE2E?: unknown }).__openreelE2E, undefined, { timeout: 60_000 });
  return page.evaluate(async () => {
    const core = (window as unknown as { __openreelE2E: { core: CoreHook } }).__openreelE2E.core;
    const { ColorGradingEngine } = core.colorGradingEngine;
    const hue = core.hueCurves;
    const width = 360;
    const height = 120;
    const card = new OffscreenCanvas(width, height);
    const cardCtx = card.getContext("2d", { willReadFrequently: true })!;
    const cardData = cardCtx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = hue.hslToRgb(x / width, 0.15 + 0.85 * (y / (height - 1)), 0.1 + 0.8 * (1 - y / (height - 1)));
        const o = (y * width + x) * 4;
        cardData.data[o] = Math.round(r * 255);
        cardData.data[o + 1] = Math.round(g * 255);
        cardData.data[o + 2] = Math.round(b * 255);
        cardData.data[o + 3] = 255;
      }
    }
    cardCtx.putImageData(cardData, 0, 0);
    const bitmap = await createImageBitmap(card);

    const curves = hue.createDefaultHueCurves();
    curves.hueVsSat = [{ x: 0, y: 0.5 }, { x: 0.18, y: 0.15 }, { x: 0.45, y: 0.5 }, { x: 0.7, y: 0.9 }, { x: 1, y: 0.5 }];
    curves.hueVsHue = [{ x: 0, y: 0.5 }, { x: 0.33, y: 0.7 }, { x: 0.66, y: 0.35 }, { x: 1, y: 0.5 }];
    curves.hueVsLuma = [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.75 }, { x: 1, y: 0.5 }];
    curves.lumaVsSat = [{ x: 0, y: 0.2 }, { x: 0.4, y: 0.5 }, { x: 1, y: 0.7 }];
    const stages = {
      tone: { exposure: 0.15, contrast: 0.2, highlights: -0.3, shadows: 0.3, whites: 0.1, blacks: -0.1 },
      wheels: {
        shadows: { r: 0.02, g: 0, b: 0.03 },
        midtones: { r: 0.05, g: 0, b: -0.04 },
        highlights: { r: -0.02, g: 0.01, b: 0 },
        shadowsLift: 0.03,
        midtonesGamma: 1.15,
        highlightsGain: 1.1,
      },
      hueCurves: curves,
    };

    const read = (image: ImageBitmap): Uint8ClampedArray => {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data;
    };

    const engine = new ColorGradingEngine(width, height);
    const cpu = read((await engine.applyFusedGradingCpu(bitmap, stages)).image);
    let gpu: Uint8ClampedArray | null = null;
    let gpuError: string | null = null;
    try {
      gpu = read((await engine.applyFusedGradingGpu(bitmap, stages)).image);
    } catch (error) {
      gpuError = String(error);
    }

    const reference = new Uint8ClampedArray(cardData.data);
    core.lumetriPipeline.applyFusedGradeToData(reference, stages);
    let cpuVsReferenceMax = 0;
    let meanChange = 0;
    for (let i = 0; i < cpu.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        cpuVsReferenceMax = Math.max(cpuVsReferenceMax, Math.abs(cpu[i + c] - reference[i + c]));
        meanChange += Math.abs(cpu[i + c] - cardData.data[i + c]);
      }
    }
    meanChange /= (width * height * 3);

    let maxDiff = 0;
    let total = 0;
    let over1 = 0;
    let gpuMeanChange = 0;
    if (gpu) {
      for (let i = 0; i < cpu.length; i += 4) {
        let pixelOver = false;
        for (let c = 0; c < 3; c++) {
          gpuMeanChange += Math.abs(gpu[i + c] - cardData.data[i + c]);
          const d = Math.abs(cpu[i + c] - gpu[i + c]);
          maxDiff = Math.max(maxDiff, d);
          total += d;
          if (d > 1) pixelOver = true;
        }
        if (pixelOver) over1++;
      }
    }
    engine.dispose();
    return {
      gpuAvailable: gpu !== null,
      gpuError,
      maxDiff,
      meanDiff: total / (width * height * 3),
      over1,
      pixels: width * height,
      cpuVsReferenceMax,
      meanChange,
      gpuMeanChange: gpuMeanChange / (width * height * 3),
    };
  });
}

export interface HueUiResult {
  grade: Record<string, any> | undefined;
  premiereChecked: boolean;
  /** Mean per-channel |preview - CPU reference| over the frame (8-bit levels). */
  meanDiffToReference: number;
  /** Mean per-channel |after - before| over the frame: the curve visibly did something. */
  meanChange: number;
  undoneGrade: Record<string, any> | undefined;
}

/**
 * Hue sweep clip; open the Hue Curves editor in the Color tab, click a point into Hue vs Sat that
 * crushes cyan saturation, then compare the Program frame with the CPU reference applied to the
 * ungraded frame. Finally undo through the project history.
 */
export async function runHueUiFlow(page: Page): Promise<HueUiResult> {
  const [clipId] = await openWithClips(page, [FIXTURE]);
  await seek(page, 1);
  await openColorGrading(page, clipId);
  await snapStable(page, "hue-before");

  await page.getByRole("button", { name: "Hue Curves", exact: true }).click();
  await settle(page, 300);
  const premiere = page.getByRole("radio", { name: "Premiere processing order" });
  await expect(premiere).toBeVisible();
  const premiereChecked = (await premiere.getAttribute("aria-checked")) === "true";
  await expect(page.getByRole("tab", { name: "Hue vs Sat", exact: true })).toBeVisible();

  const surface = page.getByTestId("hue-curve-surface");
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error("hue curve surface not visible");
  // viewBox 0..200 with an 8 unit pad: hue 0.5 (cyan) at y = 0.02 (near the floor = saturation x0).
  const px = box.x + box.width * ((8 + 0.5 * 184) / 200);
  const py = box.y + box.height * ((8 + (1 - 0.02) * 184) / 200);
  await page.mouse.click(px, py);
  await expect
    .poll(async () => (await clipGrade(page, clipId))?.hueCurves?.hueVsSat?.length ?? 0, { timeout: 15_000 })
    .toBe(3);
  await seek(page, 1);
  await snapStable(page, "hue-after");
  const grade = await clipGrade(page, clipId);

  const stats = await page.evaluate((storedGrade) => {
    const e = (window as unknown as { __openreelE2E: { core: CoreHook; project: any } }).__openreelE2E;
    const snaps = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps;
    const before = snaps["hue-before"];
    const after = snaps["hue-after"];
    const reference = new Uint8ClampedArray(before);
    e.core.lumetriPipeline.applyFusedGradeToData(reference, { hueCurves: storedGrade.hueCurves });
    let diff = 0;
    let change = 0;
    let n = 0;
    for (let i = 0; i < before.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        diff += Math.abs(after[i + c] - reference[i + c]);
        change += Math.abs(after[i + c] - before[i + c]);
        n++;
      }
    }
    return { diff: diff / n, change: change / n };
  }, grade);

  await page.evaluate(async () => {
    await (window as unknown as { __openreelE2E: { project: any } }).__openreelE2E.project.getState().undo();
  });
  await settle(page, 400);
  return {
    grade,
    premiereChecked,
    meanDiffToReference: stats.diff,
    meanChange: stats.change,
    undoneGrade: await clipGrade(page, clipId),
  };
}
