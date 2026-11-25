import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { FIXTURE_DIR } from "./global-setup";
import { clickClip, press, seek, settle, snapStable } from "./helpers";

export const SOLIDS: Record<string, string> = { "ct-red.mp4": "0xdc2828", "ct-blue.mp4": "0x283cdc" };

/** Two 2 s solid-colour clips (idempotent), BT.709 tagged like the other synthetic fixtures. */
export function ensureTransitionFixtures(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, color] of Object.entries(SOLIDS)) {
    const path = join(FIXTURE_DIR, name);
    if (existsSync(path)) continue;
    execFileSync(
      "ffmpeg",
      [
        "-y", "-f", "lavfi", "-i", `color=c=${color}:size=640x360:rate=30:duration=2`,
        "-vf", "format=yuv420p", "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p",
        "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv", "-movflags", "+write_colr", path,
      ],
      { stdio: "ignore" },
    );
  }
}

export interface ParityRow {
  label: string;
  mad: number;
  max: number;
}

/**
 * Renders every mask transition (and the non-mask ones) through the real TransitionEngine in the browser (the
 * Canvas2D path preview and export both use) and compares each frame to the pure reference built from
 * rasterizeMaskTransition at progress 0, 0.5 and 1 (and 0.25 / 0.75), with and without feather, border, reverse
 * and a custom start / end percentage.
 */
export async function runEngineParity(page: Page): Promise<{ rows: ParityRow[]; extras: Record<string, unknown> }> {
  return page.evaluate(async () => {
    const hook = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E.core;
    const t = await hook.loadTransitions();
    const A = [220, 40, 40];
    const B = [40, 60, 220];
    const G = [0, 200, 0];
    const solid = (w: number, h: number, c: number[]) => {
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext("2d")!;
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(0, 0, w, h);
      return canvas;
    };
    const readBack = (canvas: OffscreenCanvas, w: number, h: number) => {
      const copy = new OffscreenCanvas(w, h);
      const g = copy.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, w, h).data;
    };
    const pixels = async (engine: any, w: number, h: number, type: string, params: Record<string, unknown>, p: number, a = A, b = B) => {
      const transition = { id: "t", clipAId: "a", clipBId: "b", type, duration: 1, params: { ...t.engine.getDefaultTransitionParams(type), ...params } };
      const canvas: OffscreenCanvas = await engine.renderTransitionToCanvas(solid(w, h, a), solid(w, h, b), transition, p);
      return { data: readBack(canvas, w, h), transition };
    };
    const compare = (actual: Uint8ClampedArray, expected: Float64Array) => {
      let sum = 0;
      let max = 0;
      for (let i = 0; i < actual.length; i += 4)
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(actual[i + c] - expected[(i / 4) * 3 + c]);
          sum += d;
          if (d > max) max = d;
        }
      return { mad: sum / ((actual.length / 4) * 3), max };
    };
    const expectedMask = (type: string, params: Record<string, unknown>, w: number, h: number, p: number) => {
      const merged = { ...t.engine.getDefaultTransitionParams(type), ...params };
      const lo = typeof params.startPct === "number" ? params.startPct / 100 : 0;
      const hi = typeof params.endPct === "number" ? params.endPct / 100 : 1;
      const raster = t.masks.rasterizeMaskTransition(type, merged, w, h, lo + (hi - lo) * p);
      const hex = String(merged.borderColor ?? "#ffffff");
      const ring = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      const out = new Float64Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const c = raster.incoming[i] / 255;
        const r = raster.border[i] / 255;
        for (let k = 0; k < 3; k++) {
          const base = A[k] * (1 - r) + ring[k] * r;
          out[i * 3 + k] = base * (1 - c) + B[k] * c;
        }
      }
      return out;
    };

    const W = 320;
    const H = 180;
    const engine = t.engine.createTransitionEngine(W, H);
    const luma = new Uint8Array(16 * 9);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) luma[y * 16 + x] = Math.round(((x + y) / 23) * 255);
    const lumaParams = { lumaData: t.masks.encodeLumaBase64(luma), lumaWidth: 16, lumaHeight: 9, feather: 0.1 };
    const rows: { label: string; mad: number; max: number }[] = [];
    const variants: Record<string, Record<string, unknown>> = {
      default: { borderColor: "#00c800" },
      "feather+border+reverse": { feather: 0.3, borderWidth: 6, borderColor: "#00c800", reverse: true },
      "start25 end75": { startPct: 25, endPct: 75, borderColor: "#00c800" },
    };
    for (const type of t.masks.MASK_TRANSITION_TYPES as string[]) {
      for (const [name, params] of Object.entries(variants)) {
        for (const p of name === "default" ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]) {
          const { data } = await pixels(engine, W, H, type, params, p);
          rows.push({ label: `${type} ${name} p=${p}`, ...compare(data, expectedMask(type, params, W, H, p)) });
        }
      }
    }
    for (const p of [0, 0.5, 1]) {
      const params = { ...lumaParams, borderWidth: 4, borderColor: "#00c800" };
      const { data } = await pixels(engine, W, H, "gradientWipe", params, p);
      rows.push({ label: `gradientWipe custom luma p=${p}`, ...compare(data, expectedMask("gradientWipe", params, W, H, p)) });
    }

    // Full HD: the engine builds the mask at 960 wide and scales it up; edges differ from a full-res raster by a pixel or two.
    const bigEngine = t.engine.createTransitionEngine(1920, 1080);
    for (const [type, params] of [["irisRound", { feather: 0.2, borderWidth: 12, borderColor: "#00c800" }], ["clockWipe", {}], ["bandWipe", { bands: 6 }]] as const) {
      const { data } = await pixels(bigEngine, 1920, 1080, type, params, 0.5);
      rows.push({ label: `${type} 1080p p=0.5`, ...compare(data, expectedMask(type, params, 1920, 1080, 0.5)) });
    }

    // Non-mask transitions.
    const px = (data: Uint8ClampedArray, x: number, y: number, w: number) => [data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]];
    const extras: Record<string, unknown> = {};
    const black = [0, 0, 0];
    const white = [255, 255, 255];
    extras.filmMid = px((await pixels(engine, W, H, "filmDissolve", {}, 0.5, black, white)).data, 10, 10, W);
    extras.filmStart = px((await pixels(engine, W, H, "filmDissolve", {}, 0, black, white)).data, 10, 10, W);
    extras.filmEnd = px((await pixels(engine, W, H, "filmDissolve", {}, 1, black, white)).data, 10, 10, W);
    extras.additiveMid = px((await pixels(engine, W, H, "additiveDissolve", {}, 0.5, [100, 0, 0], [0, 0, 100])).data, 10, 10, W);
    extras.additiveStart = px((await pixels(engine, W, H, "additiveDissolve", {}, 0, [100, 0, 0], [0, 0, 100])).data, 10, 10, W);
    extras.additiveEnd = px((await pixels(engine, W, H, "additiveDissolve", {}, 1, [100, 0, 0], [0, 0, 100])).data, 10, 10, W);
    extras.cubeStart = px((await pixels(engine, W, H, "cubeSpin", {}, 0)).data, 160, 90, W);
    extras.cubeEnd = px((await pixels(engine, W, H, "cubeSpin", {}, 1)).data, 160, 90, W);
    const cubeMid = (await pixels(engine, W, H, "cubeSpin", { direction: "left" }, 0.5)).data;
    extras.cubeMidCorner = px(cubeMid, 1, 1, W);
    extras.cubeMidLeft = px(cubeMid, 40, 90, W);
    extras.cubeMidRight = px(cubeMid, 280, 90, W);
    const cubeUp = (await pixels(engine, W, H, "cubeSpin", { direction: "up" }, 0.5)).data;
    extras.cubeUpTop = px(cubeUp, 160, 50, W);
    extras.cubeUpBottom = px(cubeUp, 160, 140, W);
    // A custom start percentage starts the dissolve half way; a custom end percentage stops it half way.
    extras.filmStart50 = px((await pixels(engine, W, H, "filmDissolve", { startPct: 50, endPct: 100 }, 0, black, white)).data, 10, 10, W);
    extras.filmEnd50 = px((await pixels(engine, W, H, "filmDissolve", { startPct: 0, endPct: 50 }, 1, black, white)).data, 10, 10, W);
    return { rows, extras };
  });
}

/** Mean RGB of a gx by gy grid over the program canvas snapshot taken with snapStable(key). */
export async function programGrid(page: Page, key: string, gx: number, gy: number): Promise<number[][]> {
  return page.evaluate(
    ([k, cols, rows]) => {
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const data = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k as string];
      const out: number[][] = [];
      for (let gy = 0; gy < (rows as number); gy++)
        for (let gx = 0; gx < (cols as number); gx++) {
          const x0 = Math.floor((c.width * gx) / (cols as number));
          const x1 = Math.floor((c.width * (gx + 1)) / (cols as number));
          const y0 = Math.floor((c.height * gy) / (rows as number));
          const y1 = Math.floor((c.height * (gy + 1)) / (rows as number));
          const sum = [0, 0, 0];
          let n = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) {
              const i = (y * c.width + x) * 4;
              sum[0] += data[i];
              sum[1] += data[i + 1];
              sum[2] += data[i + 2];
              n++;
            }
          out.push(sum.map((v) => v / n));
        }
      return out;
    },
    [key, gx, gy],
  );
}

/**
 * Mean RGB grid of decoded frame number `frame` (0-based, in decode order) of an exported mp4. Selected by index: `-ss`
 * seeks to the first frame at or after the time, so seeking to `frame / fps + epsilon` returns the NEXT frame.
 */
export function exportGrid(mp4: string, frame: number, gx: number, gy: number): number[][] {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", mp4, "-vf", `select=eq(n\\,${frame}),scale=${gx}:${gy}:flags=area`, "-vsync", "0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  expect(buf.length, `frame ${frame} decoded from ${mp4}`).toBe(gx * gy * 3);
  const out: number[][] = [];
  for (let i = 0; i < gx * gy; i++) out.push([buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]]);
  return out;
}

export const transitionsOf = async (page: Page) =>
  page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
    return (e.project.getState().project.timeline.tracks as any[]).flatMap((t) => t.transitions as any[]).map((t) => ({ id: t.id, type: t.type, duration: t.duration, params: t.params, clipAId: t.clipAId, clipBId: t.clipBId, trackId: undefined as string | undefined }));
  });

export async function selectTransition(page: Page, transitionId: string): Promise<void> {
  await page.evaluate((id) => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> }; ui: { getState(): Record<string, any> } } }).__openreelE2E;
    const track = (e.project.getState().project.timeline.tracks as any[]).find((t) => t.transitions.some((x: any) => x.id === id));
    e.ui.getState().select({ type: "transition", id, trackId: track.id });
  }, transitionId);
  await settle(page, 400);
}

export async function runPresetFlow(page: Page, clipIds: string[], outPath: string) {
  const [clipA] = clipIds;
  await clickClip(page, clipA);
  await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
  await settle(page, 600);
  // 1. Apply a built-in by double-clicking its card on the selected cut.
  const chip = (name: string) => page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name, exact: true });
  await chip("Wipe").click();
  const card = page.locator('button[aria-label^="Iris Box. Drag"]').first();
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await expect.poll(async () => (await transitionsOf(page)).length, { timeout: 15_000 }).toBe(1);
  let [first] = await transitionsOf(page);
  expect(first).toMatchObject({ type: "irisBox", clipAId: clipA, clipBId: clipIds[1] });

  // 2. Tune it through the Effect Controls style inspector (the store action the sliders call), then save a preset from the inspector UI.
  await page.evaluate(
    async ([id]) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      await e.project.getState().updateClipTransition(id, { duration: 1, params: { feather: 0.25, borderWidth: 10, borderColor: "#00ff00", alignment: "center" } });
    },
    [first.id],
  );
  await selectTransition(page, first.id);
  await page.getByRole("button", { name: "Save as preset…" }).click();
  await page.getByLabel("Preset name").fill("Green box");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).__openreelE2E.project.getState().project.transitionPresets?.length ?? 0), { timeout: 10_000 })
    .toBe(1);

  // 3. Remove it, then apply the saved preset by double-click: parameters and duration come back.
  await page.evaluate(async (id) => (window as any).__openreelE2E.project.getState().removeClipTransition(id), first.id);
  await expect.poll(async () => (await transitionsOf(page)).length).toBe(0);
  await clickClip(page, clipA);
  await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
  await chip("Presets").click();
  const presetCard = page.locator('button[aria-label^="Green box. Drag"]').first();
  await presetCard.scrollIntoViewIfNeeded();
  await presetCard.dblclick();
  await expect.poll(async () => (await transitionsOf(page)).length, { timeout: 15_000 }).toBe(1);
  [first] = await transitionsOf(page);
  expect(first.type).toBe("irisBox");
  expect(first.duration).toBeCloseTo(1, 2);
  expect(first.params).toMatchObject({ feather: 0.25, borderWidth: 10, borderColor: "#00ff00" });

  // 4. Set as default, remove, press the shortcut: the default is applied from the keyboard; undo / redo it.
  await page.getByRole("button", { name: "Set Green box as default transition" }).click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).__openreelE2E.project.getState().project.defaultTransition?.label))
    .toBe("Green box");
  await page.evaluate(async (id) => (window as any).__openreelE2E.project.getState().removeClipTransition(id), first.id);
  await expect.poll(async () => (await transitionsOf(page)).length).toBe(0);
  await clickClip(page, clipA);
  await press(page, "Meta+Shift+d");
  await expect.poll(async () => (await transitionsOf(page)).length, { timeout: 15_000 }).toBe(1);
  [first] = await transitionsOf(page);
  expect(first).toMatchObject({ type: "irisBox" });
  expect(first.duration).toBeCloseTo(1, 2);
  await press(page, "Meta+z");
  await expect.poll(async () => (await transitionsOf(page)).length).toBe(0);
  await press(page, "Meta+Shift+z");
  await expect.poll(async () => (await transitionsOf(page)).length).toBe(1);

  // 5. Preview the middle of the cut, export, and compare the same instant.
  // Half way into frame 60 (the transition's midpoint): the preview composites the frame under the playhead at the
  // instant the export renders it (frame 60 -> 2.0 s), so it must equal exported frame 60, not a neighbour.
  const instant = 60.5 / 30;
  await seek(page, instant);
  await snapStable(page, "ct-preview");
  const GX = 16;
  const GY = 9;
  const preview = await programGrid(page, "ct-preview", GX, GY);
  if (process.env.OPENREEL_E2E_SHOTS) await page.locator('canvas[aria-label^="Program frame"]').screenshot({ path: join(process.env.OPENREEL_E2E_SHOTS, "ct-preview.png") });
  // The preview at exact frame boundaries around the midpoint, to compare each with the exported frame of the same index.
  const previewFrames: { frame: number; grid: number[][] }[] = [];
  for (const frame of [58, 59, 60, 61, 62]) {
    await seek(page, frame / 30);
    await snapStable(page, `ct-preview-${frame}`);
    previewFrames.push({ frame, grid: await programGrid(page, `ct-preview-${frame}`, GX, GY) });
  }
  await seek(page, 0);
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 480_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  await (await download).saveAs(outPath);
  // The exported frame under that playhead, plus its neighbours so an off-by-one shows as a better match elsewhere
  // (the transition moves about 15 px per frame at 1080p here).
  const exported = exportGrid(outPath, 60, GX, GY);
  const neighbours = [58, 59, 60, 61, 62].map((frame) => ({ frame, grid: exportGrid(outPath, frame, GX, GY) }));
  return { preview, exported, GX, GY, transition: first, neighbours, previewFrames };
}

