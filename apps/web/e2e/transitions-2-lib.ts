import { expect, type Page } from "@playwright/test";
import { clickClip, clipsOf, importInput, press, readState, seek, settle, snapStable } from "./helpers";
import { fixturePath } from "./lumetri-basic-lib";
import { execFileSync } from "node:child_process";
import { programGrid, selectTransition, transitionsOf } from "./custom-transitions-lib";

export interface ParityRow {
  label: string;
  mad: number;
  max: number;
}

const PROGRESS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Every new transition, every direction / orientation / corner, at progress 0, 0.25, 0.5, 0.75 and 1: the frame the real
 * Canvas2D TransitionEngine draws (the renderer preview and export share) against the software reference. The mask
 * transitions are compared with the pure raster, the geometric ones (cube spin, flip over, split, cross zoom, page peel)
 * with their draw plan executed by the software rasteriser.
 */
export async function runNewTransitionParity(page: Page): Promise<ParityRow[]> {
  return page.evaluate(async (progressValues) => {
    const hook = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E.core;
    const t = await hook.loadTransitions();
    const A = [220, 40, 40];
    const B = [40, 60, 220];
    const W = 320;
    const H = 180;
    const solid = (c: number[]) => {
      const canvas = new OffscreenCanvas(W, H);
      const g = canvas.getContext("2d")!;
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(0, 0, W, H);
      return canvas;
    };
    // The engine draws on the GPU when it can, and a WebGPU canvas has no 2D context: copy it to a 2D canvas to read it.
    const readBack = (canvas: OffscreenCanvas, w: number, h: number) => {
      const copy = new OffscreenCanvas(w, h);
      const g = copy.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, w, h).data;
    };
    const engine = t.engine.createTransitionEngine(W, H);
    const draw = async (type: string, params: Record<string, unknown>, p: number) => {
      const transition = { id: "t", clipAId: "a", clipBId: "b", type, duration: 1, params: { ...t.engine.getDefaultTransitionParams(type), ...params } };
      const canvas: OffscreenCanvas = await engine.renderTransitionToCanvas(solid(A), solid(B), transition, p);
      return readBack(canvas, W, H);
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
    const maskReference = (type: string, params: Record<string, unknown>, p: number) => {
      const merged = { ...t.engine.getDefaultTransitionParams(type), ...params };
      const raster = t.masks.rasterizeMaskTransition(type, merged, W, H, p);
      const hex = String(merged.borderColor ?? "#ffffff");
      const ring = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      const out = new Float64Array(W * H * 3);
      for (let i = 0; i < W * H; i++) {
        const c = raster.incoming[i] / 255;
        const r = raster.border[i] / 255;
        for (let k = 0; k < 3; k++) out[i * 3 + k] = (A[k] * (1 - r) + ring[k] * r) * (1 - c) + B[k] * c;
      }
      return out;
    };
    const planReference = (type: string, params: Record<string, unknown>, p: number) => {
      const merged = { ...t.engine.getDefaultTransitionParams(type), ...params } as Record<string, any>;
      const base = { width: W, height: H, progress: p };
      const border = { borderWidth: merged.borderWidth ?? 0, borderColor: merged.borderColor ?? "#ffffff" };
      const plan =
        type === "cubeSpin"
          ? t.plans.cubeSpinPlan({ ...base, ...border, direction: merged.direction })
          : type === "flipOver"
            ? t.plans.flipOverPlan({ ...base, ...border, direction: merged.direction })
            : type === "split"
              ? t.plans.splitPlan({ ...base, ...border, orientation: merged.orientation, reverse: merged.reverse })
              : type === "crossZoom"
                ? t.plans.crossZoomPlan({ ...base, center: merged.center, intensity: merged.intensity })
                : t.plans.pagePeelPlan({ ...base, corner: merged.corner, shadow: merged.shadow });
      return t.plans.rasterizePlan(plan, W, H, { A, B });
    };

    const rows: { label: string; mad: number; max: number; kind: string }[] = [];
    const masks: [string, Record<string, unknown>][] = [
      ["checkerboard", { tiles: 6 }],
      ...["left", "right", "up", "down"].map((direction): [string, Record<string, unknown>] => ["checkerWipe", { direction, tiles: 6 }]),
      ...["topLeft", "topRight", "bottomLeft", "bottomRight"].map((corner): [string, Record<string, unknown>] => ["inset", { corner }]),
      ["wedgeWipe", {}],
      ["wedgeWipe", { startAngle: 90, center: { x: 0.3, y: 0.6 }, feather: 0.2 }],
      ["randomBlocks", { seed: 1 }],
      ["randomBlocks", { seed: 99, tiles: 20, borderWidth: 4, borderColor: "#00c800" }],
      ...["left", "right", "up", "down"].map((direction): [string, Record<string, unknown>] => ["randomWipe", { direction, seed: 5 }]),
    ];
    for (const [type, params] of masks) {
      for (const p of progressValues) {
        const actual = await draw(type, params, p);
        rows.push({ label: `${type} ${JSON.stringify(params)} p=${p}`, kind: "mask", ...compare(actual, maskReference(type, params, p)) });
      }
    }
    const plans: [string, Record<string, unknown>][] = [
      ...["left", "right", "up", "down"].map((direction): [string, Record<string, unknown>] => ["cubeSpin", { direction }]),
      ["cubeSpin", { direction: "left", borderWidth: 6, borderColor: "#00c800" }],
      ["cubeSpin", { direction: "down", borderWidth: 6, borderColor: "#00c800" }],
      ...["left", "right", "up", "down"].map((direction): [string, Record<string, unknown>] => ["flipOver", { direction }]),
      ["flipOver", { direction: "up", borderWidth: 6, borderColor: "#00c800" }],
      ["split", {}],
      ["split", { orientation: "vertical" }],
      ["split", { reverse: true, borderWidth: 6, borderColor: "#00c800" }],
      ["crossZoom", {}],
      ["crossZoom", { center: { x: 0.25, y: 0.75 }, intensity: 2 }],
      ...["topLeft", "topRight", "bottomLeft", "bottomRight"].map((corner): [string, Record<string, unknown>] => ["pagePeel", { corner, shadow: 0 }]),
    ];
    for (const [type, params] of plans) {
      for (const p of progressValues) {
        const actual = await draw(type, params, p);
        rows.push({ label: `${type} ${JSON.stringify(params)} p=${p}`, kind: "plan", ...compare(actual, planReference(type, params, p)) });
      }
    }
    return rows;
  }, PROGRESS);
}

/** Shadows are drawn by the canvas only: the page peel's mean difference to the shadow-free reference stays small. */
export async function runPeelShadow(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const hook = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E.core;
    const t = await hook.loadTransitions();
    const solid = (c: number[]) => {
      const canvas = new OffscreenCanvas(320, 180);
      const g = canvas.getContext("2d")!;
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(0, 0, 320, 180);
      return canvas;
    };
    // The engine draws on the GPU when it can, and a WebGPU canvas has no 2D context: copy it to a 2D canvas to read it.
    const readBack = (canvas: OffscreenCanvas, w: number, h: number) => {
      const copy = new OffscreenCanvas(w, h);
      const g = copy.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, w, h).data;
    };
    const engine = t.engine.createTransitionEngine(320, 180);
    const render = async (shadow: number) => {
      const transition = { id: "t", clipAId: "a", clipBId: "b", type: "pagePeel", duration: 1, params: { corner: "bottomRight", shadow } };
      const canvas: OffscreenCanvas = await engine.renderTransitionToCanvas(solid([220, 40, 40]), solid([40, 60, 220]), transition, 0.4);
      return readBack(canvas, 320, 180);
    };
    const plain = await render(0);
    const shaded = await render(1);
    let darker = 0;
    for (let i = 0; i < plain.length; i += 4) if (shaded[i + 2] < plain[i + 2] - 3) darker++;
    return darker;
  });
}

export interface SavedPreset {
  id: string;
  name: string;
  type: string;
  params: Record<string, unknown>;
}

/** The presets stored in the app-wide IndexedDB library, read straight from the database. */
export async function storedLibraryPresets(page: Page): Promise<SavedPreset[]> {
  return page.evaluate(
    () =>
      new Promise<SavedPreset[]>((resolve, reject) => {
        const open = indexedDB.open("openreel-transition-presets", 1);
        open.onerror = () => reject(open.error);
        open.onupgradeneeded = () => open.result.createObjectStore("presets", { keyPath: "id" });
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction("presets", "readonly").objectStore("presets").getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result as SavedPreset[]);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

const GX = 16;
const GY = 9;
const EXPORT_W = 640;
const EXPORT_H = 360;

/**
 * Mean RGB of a gx by gy grid over decoded frame `frame` (0-based, in decode order) of an exported mp4. The frame is decoded
 * at its own size and averaged here: ffmpeg's own area scaler resamples chroma separately and smears a thin edge into the
 * neighbouring cell, which is more error than the one-frame differences this test has to tell apart.
 */
export function exportGridExact(mp4: string, frame: number, gx: number, gy: number): number[][] {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", mp4, "-vf", `select=eq(n\\,${frame})`, "-vsync", "0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  expect(buf.length, `frame ${frame} decoded from ${mp4} at ${EXPORT_W}x${EXPORT_H}`).toBe(EXPORT_W * EXPORT_H * 3);
  const out: number[][] = [];
  for (let cy = 0; cy < gy; cy++)
    for (let cx = 0; cx < gx; cx++) {
      const x0 = Math.floor((EXPORT_W * cx) / gx);
      const x1 = Math.floor((EXPORT_W * (cx + 1)) / gx);
      const y0 = Math.floor((EXPORT_H * cy) / gy);
      const y1 = Math.floor((EXPORT_H * (cy + 1)) / gy);
      const sum = [0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * EXPORT_W + x) * 3;
          sum[0] += buf[i];
          sum[1] += buf[i + 1];
          sum[2] += buf[i + 2];
          n++;
        }
      out.push(sum.map((v) => v / n));
    }
  return out;
}

/** Saves a tuned Split to the app-wide library through the inspector UI. Returns the project transition it was made from. */
export async function saveSplitToLibrary(page: Page, clipIds: string[]) {
  const [clipA] = clipIds;
  await clickClip(page, clipA);
  await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
  await settle(page, 600);
  const chip = (name: string) => page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name, exact: true });
  await chip("Slide").click();
  const card = page.locator('button[aria-label^="Split. Drag"]').first();
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await expect.poll(async () => (await transitionsOf(page)).length, { timeout: 15_000 }).toBe(1);
  const [first] = await transitionsOf(page);
  expect(first).toMatchObject({ type: "split", clipAId: clipA });
  await page.evaluate(
    async ([id]) => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
      await e.project.getState().updateClipTransition(id, { duration: 1, params: { orientation: "horizontal", reverse: false, borderWidth: 10, borderColor: "#ffffff", alignment: "center" } });
    },
    [first.id],
  );
  await selectTransition(page, first.id);
  await page.getByRole("button", { name: "Save as preset…" }).click();
  await page.getByLabel("Preset name").fill("White split");
  await page.getByRole("button", { name: "Save to library", exact: true }).click();
  await expect.poll(async () => (await storedLibraryPresets(page)).map((p) => p.name), { timeout: 10_000 }).toEqual(["White split"]);
  return first;
}

/**
 * After a reload: opens the project again, applies the library preset from the Presets filter, undoes and redoes it, then
 * compares the preview with the export at the same frames.
 */
export async function applyLibraryPresetAndExport(page: Page, clipIds: string[], outPath: string) {
  const [clipA] = clipIds;
  await clickClip(page, clipA);
  await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
  await settle(page, 600);
  await page.getByRole("group", { name: "Transition categories" }).getByRole("button", { name: "Presets", exact: true }).click();
  const presetCard = page.locator('button[aria-label^="White split. Drag"]').first();
  await presetCard.scrollIntoViewIfNeeded();
  await presetCard.dblclick();
  await expect.poll(async () => (await transitionsOf(page)).length, { timeout: 15_000 }).toBe(1);
  const [applied] = await transitionsOf(page);
  expect(applied.type).toBe("split");
  expect(applied.duration).toBeCloseTo(1, 2);
  expect(applied.params).toMatchObject({ orientation: "horizontal", borderWidth: 10, borderColor: "#ffffff" });
  await press(page, "Meta+z");
  await expect.poll(async () => (await transitionsOf(page)).length).toBe(0);
  await press(page, "Meta+Shift+z");
  await expect.poll(async () => (await transitionsOf(page)).length).toBe(1);

  const instant = 60.5 / 30;
  await seek(page, instant);
  await snapStable(page, "t2-preview");
  const preview = await programGrid(page, "t2-preview", GX, GY);
  const previewFrames: { frame: number; grid: number[][] }[] = [];
  for (const frame of [58, 59, 60, 61, 62]) {
    await seek(page, frame / 30);
    await snapStable(page, `t2-preview-${frame}`);
    previewFrames.push({ frame, grid: await programGrid(page, `t2-preview-${frame}`, GX, GY) });
  }
  await seek(page, 0);
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 480_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  await (await download).saveAs(outPath);
  const exported = exportGridExact(outPath, 60, GX, GY);
  const neighbours = [58, 59, 60, 61, 62].map((frame) => ({ frame, grid: exportGridExact(outPath, frame, GX, GY) }));
  // One fine row across the middle of the frame (64 cells, 10 px each), to find the border strips.
  const previewRow = await programGrid(page, "t2-preview", 64, 1);
  const exportedRow = exportGridExact(outPath, 60, 64, 1);
  return { preview, exported, GX, GY, transition: applied, neighbours, previewFrames, previewRow, exportedRow };
}


const CLIP_SECONDS = 2;

/**
 * openWithClips for a second session in the same browser profile: the editor offers the first session's unsaved project on
 * load, and a user starts fresh. The library is left alone, which is what this proves survives.
 */
export async function reopenWithClips(page: Page, names: string[]): Promise<string[]> {
  await page.goto("/");
  await page.getByRole("button", { name: "Start Fresh" }).click({ timeout: 15_000 }).catch(() => undefined);
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  // Another offer can arrive once the new project starts saving.
  await page.getByRole("button", { name: "Start Fresh" }).click({ timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E;
    await h.project.getState().updateSettings({ width: 640, height: 360 });
  });
  const ids: string[] = [];
  for (const [index, name] of names.entries()) {
    await importInput(page).setInputFiles(fixturePath(name));
    await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
    await seek(page, index * CLIP_SECONDS);
    await page.getByRole("button", { name: `Media actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 4_000 }).catch(() => undefined);
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(index + 1);
    ids.push(clipsOf(await readState(page), "Main")[index].id);
  }
  await settle(page);
  return ids;
}

export interface GpuParityRow {
  label: string;
  type: string;
  p: number;
  mad: number;
  max: number;
  path: string;
  letterboxed: boolean;
}

/**
 * The WebGPU transition renderer against the Canvas2D engine it replaces (the reference), for every transition type
 * and its variants at progress 0, 0.25, 0.5, 0.75 and 1, on two textured shots (so a mis-sampled coordinate shows) and
 * once with shots of another aspect (the letterbox). Returns one row per frame with the mean and max absolute
 * 0-255 difference over RGB, and which renderer the engine used for it.
 */
export async function runGpuTransitionParity(page: Page): Promise<{ rows: GpuParityRow[]; gpuActive: boolean }> {
  return page.evaluate(async (progressValues) => {
    const hook = (window as unknown as { __openreelE2E: { core: Record<string, any> } }).__openreelE2E.core;
    const t = await hook.loadTransitions();
    const W = 320;
    const H = 180;
    const card = (w: number, h: number, hue: number): OffscreenCanvas => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${hue}, 85%, 50%)`);
      grad.addColorStop(0.5, `hsl(${hue + 120}, 70%, 45%)`);
      grad.addColorStop(1, `hsl(${hue + 240}, 80%, 55%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#101010";
      g.fillRect(w * 0.1, h * 0.12, w * 0.28, h * 0.4);
      g.fillStyle = "#f5f5f5";
      g.beginPath();
      g.arc(w * 0.68, h * 0.5, h * 0.28, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#202020";
      g.lineWidth = Math.max(2, h / 40);
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(0, (h / 6) * i);
        g.lineTo(w, (h / 6) * (i + 1) - h / 12);
        g.stroke();
      }
      return c;
    };
    const readBack = (canvas: OffscreenCanvas) => {
      const copy = new OffscreenCanvas(canvas.width, canvas.height);
      const g = copy.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const gpuEngine = t.engine.createTransitionEngine(W, H);
    const gpuActive: boolean = await gpuEngine.ensureGpu();
    const refEngine = new t.engine.TransitionEngine({ width: W, height: H, useGPU: false });
    const types: string[] = gpuEngine.getAvailableTransitionTypes().filter((type: string) => type !== "morphCut");
    const variants: Record<string, Record<string, unknown>[]> = {
      wipe: [{}, { direction: "right" }, { direction: "up" }, { direction: "down" }, { direction: "diagonal" }, { direction: "left", softness: 0.5 }, { direction: "down", softness: 0.4 }],
      slide: [{}, { direction: "right" }, { direction: "up", pushOut: true }, { direction: "down" }],
      push: [{}, { direction: "right" }, { direction: "up" }, { direction: "down" }],
      whipPan: [{}, { direction: "down" }],
      pageTurn: [{}, { direction: "right" }],
      blinds: [{}, { direction: "horizontal" }],
      flip: [{}, { axis: "vertical" }],
      splitReveal: [{}, { orientation: "vertical" }],
      radialWipe: [{}, { clockwise: false, startAngle: 30 }],
      dipToBlack: [{}, { holdDuration: 0.6 }],
    };
    const rows: any[] = [];
    const shots = [
      { w: W, h: H, letterboxed: false },
      { w: 180, h: 180, letterboxed: true },
    ];
    for (const shot of shots) {
      const A = card(shot.w, shot.h, 10);
      const B = card(shot.w, shot.h, 200);
      const runTypes = shot.letterboxed ? ["crossfade", "wipe", "zoom", "circleReveal", "cubeSpin", "pagePeel", "checkerboard"].filter((x) => types.includes(x)) : types;
      for (const type of runTypes) {
        for (const params of shot.letterboxed ? [{}] : variants[type] ?? [{}]) {
          for (const p of progressValues) {
            const transition = { id: "t", clipAId: "a", clipBId: "b", type, duration: 1, params: { ...t.engine.getDefaultTransitionParams(type), ...params } };
            const ref = readBack(await refEngine.renderTransitionToCanvas(A, B, transition, p));
            const actual = readBack(await gpuEngine.renderTransitionToCanvas(A, B, transition, p));
            let sum = 0;
            let max = 0;
            for (let i = 0; i < ref.length; i += 4) {
              for (let c = 0; c < 3; c++) {
                const d = Math.abs(actual[i + c] - ref[i + c]);
                sum += d;
                if (d > max) max = d;
              }
            }
            rows.push({
              label: `${type} ${JSON.stringify(params)}${shot.letterboxed ? " letterboxed" : ""} p=${p}`,
              type,
              p,
              mad: sum / ((ref.length / 4) * 3),
              max,
              path: gpuEngine.lastRenderPath,
              letterboxed: shot.letterboxed,
            });
          }
        }
      }
    }
    return { rows, gpuActive };
  }, PROGRESS);
}
