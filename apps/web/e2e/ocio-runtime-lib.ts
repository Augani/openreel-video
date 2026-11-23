import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { ensureLumetriFixtures, openWithClips } from "./lumetri-basic-lib";
import { programMean, seek, settle, undo, redo, waitForPresentedPlayhead } from "./helpers";

export { ensureLumetriFixtures };

/** The OCIO runtime fixtures live next to the core tests (cwd of the e2e run is apps/web). */
export const OCIO_FIXTURES = join(process.cwd(), "..", "..", "packages", "core", "src", "color", "ocio", "fixtures");
export const HANDMADE = join(OCIO_FIXTURES, "handmade");
export const HANDMADE_LUTS = join(HANDMADE, "luts");

interface OcioHook {
  project: { getState(): any };
  video: { getVideoEngine(): any };
  ProjectSerializer: new (storage: unknown) => { exportToJson(project: unknown): string; importFromJson(json: string): any };
  core: { ocioGpuEval: { evalOcioTransformOnGpu(t: unknown, rgb: Float32Array): Float32Array }; loadOcioRuntime(): Promise<any> };
}

interface ReferenceCase {
  cfg: "handmade" | "studio" | "cg";
  kind: "cs" | "look" | "dv";
  a: string;
  b: string;
  c: string | null;
  in: "code" | "scene";
  out: number[];
}

export interface ParityResult {
  compared: number;
  unsupported: number;
  gpuUnsupported: string[];
  worstGpuVsCpu: { rel: number; at: string };
  worstGpuVsRef: { rel: number; at: string };
  worstCpuVsRef: { rel: number; at: string };
}

function readFiles(dir: string, base = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) Object.assign(out, readFiles(join(dir, entry.name), `${base}${entry.name}/`));
    else if (entry.name !== "config.ocio") out[`${base}${entry.name}`] = readFileSync(join(dir, entry.name), "utf8");
  }
  return out;
}

/**
 * The WebGL2 shader of every supported OpenColorIO reference case (scripts/ocio/make-reference.py) against the CPU reference
 * and against the values PyOpenColorIO produced, in full float (RGBA32F in and out).
 */
export async function runGpuParity(page: Page): Promise<ParityResult> {
  const reference = JSON.parse(readFileSync(join(OCIO_FIXTURES, "ocio-reference.json"), "utf8")) as {
    inputs: { code: number[]; scene: number[] };
    cases: ReferenceCase[];
  };
  const configs = {
    handmade: { text: readFileSync(join(HANDMADE, "config.ocio"), "utf8"), files: readFiles(HANDMADE) },
    studio: { text: readFileSync(join(OCIO_FIXTURES, "studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio"), "utf8"), files: {} },
    cg: { text: readFileSync(join(OCIO_FIXTURES, "cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio"), "utf8"), files: {} },
  };
  return page.evaluate(
    async ({ reference, configs }) => {
      const h = (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E;
      const rt = await h.core.loadOcioRuntime();
      const sessions: Record<string, any> = {};
      for (const [name, cfg] of Object.entries(configs)) sessions[name] = rt.createOcioSession(cfg.text, cfg.files);
      const result = {
        compared: 0,
        unsupported: 0,
        gpuUnsupported: [] as string[],
        worstGpuVsCpu: { rel: 0, at: "" },
        worstGpuVsRef: { rel: 0, at: "" },
        worstCpuVsRef: { rel: 0, at: "" },
      };
      const relErr = (a: number, b: number): number => {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return String(a) === String(b) ? 0 : Infinity;
        return Math.abs(a - b) / Math.max(Math.abs(b), 1);
      };
      for (const k of reference.cases) {
        const session = sessions[k.cfg];
        let compiled: any;
        try {
          compiled = k.kind === "cs" ? session.colorSpace(k.a, k.b) : k.kind === "look" ? session.look(k.a, k.b, k.c) : session.displayView(k.a, k.b, k.c);
          compiled.apply(0.1, 0.2, 0.3, [0, 0, 0]);
        } catch {
          result.unsupported++;
          continue;
        }
        const input = Float32Array.from(reference.inputs[k.in]);
        const label = `${k.cfg} ${k.kind} ${k.a} -> ${k.b}${k.c ? ` [${k.c}]` : ""}`;
        let gpu: Float32Array;
        try {
          gpu = h.core.ocioGpuEval.evalOcioTransformOnGpu(compiled, input);
        } catch (error) {
          result.gpuUnsupported.push(`${label}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
          continue;
        }
        const out = [0, 0, 0];
        for (let i = 0; i < input.length / 3; i++) {
          compiled.apply(input[i * 3], input[i * 3 + 1], input[i * 3 + 2], out);
          for (let ch = 0; ch < 3; ch++) {
            const want = k.out[i * 3 + ch];
            const g = gpu[i * 3 + ch];
            const c = out[ch];
            const a = relErr(g, c);
            const b = relErr(g, want);
            const d = relErr(c, want);
            if (a > result.worstGpuVsCpu.rel) result.worstGpuVsCpu = { rel: a, at: `${label} sample ${i}.${ch}: gpu ${g} cpu ${c}` };
            if (b > result.worstGpuVsRef.rel) result.worstGpuVsRef = { rel: b, at: `${label} sample ${i}.${ch}: gpu ${g} ocio ${want}` };
            if (d > result.worstCpuVsRef.rel) result.worstCpuVsRef = { rel: d, at: `${label} sample ${i}.${ch}: cpu ${c} ocio ${want}` };
          }
        }
        result.compared++;
      }
      return result;
    },
    { reference, configs },
  );
}

export interface OcioProductResult {
  /** Engine frame in OCIO mode (no look) vs the CPU prediction (sRGB Curve -> Linear -> Standard view) from the frame's own pixels. */
  plain: { max: number; mean: number };
  /** With the Film Print look (3D LUT in a log process space). */
  look: { max: number; mean: number };
  lookMeanChange: number;
  monitor: { base: number[]; plain: number[]; look: number[]; undone: number[]; redone: number[]; reloaded: number[] };
  engineMean: { plain: number[]; look: number[] };
  settings: { afterPlain: any; afterLook: any; afterUndo: any; afterRedo: any; saved: any; loaded: any };
  badge: string | null;
  clipOverride: { before: number[]; after: number[]; undone: number[]; spaceAfter: unknown; spaceUndone: unknown };
  unsupportedListed: string[];
}

async function openOcioDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByTestId("color-management-trigger").click();
  await page.getByTestId("ocio-open-dialog").click();
  await expect(page.getByTestId("ocio-dialog")).toBeVisible();
}

async function readSettings(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E.project.getState().project.settings);
}

/**
 * OCIO through the product: Preview options > Color management > OpenColorIO configuration loads the hand-made config and
 * its LUT files, the choices apply as one undoable step, the engine and the Program monitor render what the CPU reference
 * predicts, a config look backed by a 3D LUT changes the pixels as predicted, and everything (config text, LUT data, choices,
 * the per-clip input space) survives a save / load round trip.
 */
export async function runOcioProductFlow(page: Page): Promise<OcioProductResult> {
  const [clipId] = await openWithClips(page, ["lumetri-gradient.mp4"]);
  await seek(page, 1);
  await settle(page, 900);
  await waitForPresentedPlayhead(page);
  const W = 640;
  const H = 360;

  const frames = (extra: Record<string, unknown> | null) =>
    page.evaluate(
      async ({ W, H, extra }) => {
        const h = (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E;
        const engine = h.video.getVideoEngine();
        const project = h.project.getState().project;
        const render = async (p: unknown) => {
          for (let i = 0; i < 2; i++) await engine.renderFrame(p, 1, W, H);
          const f = await engine.renderFrame(p, 1, W, H);
          const c = new OffscreenCanvas(f.image.width, f.image.height);
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(f.image, 0, 0);
          return ctx.getImageData(0, 0, f.image.width, f.image.height).data;
        };
        // The display-referred frame of the same project: the codes the OCIO input transform reads.
        const baseProject = { ...project, settings: { ...project.settings, colorManagement: undefined, ocio: undefined } };
        const base = await render(baseProject);
        const ocioFrame = await render(extra ? { ...project, settings: { ...project.settings, ...extra } } : project);
        const rt = await h.core.loadOcioRuntime();
        const settings = (extra ? { ...project.settings, ...extra } : project.settings).ocio;
        const built = rt.buildOcioPipeline(settings);
        if (!built.ok) return { error: built.error };
        const input = built.parts.input(settings.defaultInputSpace);
        const rgb = [0, 0, 0];
        const mid = [0, 0, 0];
        let max = 0;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < base.length; i += 4 * 11) {
          input.apply(base[i] / 255, base[i + 1] / 255, base[i + 2] / 255, mid);
          built.parts.output.apply(mid[0], mid[1], mid[2], rgb);
          for (let c = 0; c < 3; c++) {
            const predicted = Math.round(Math.min(1, Math.max(0, rgb[c])) * 255);
            const d = Math.abs(ocioFrame[i + c] - predicted);
            if (d > max) max = d;
            sum += d;
            n++;
          }
        }
        const centre = (px: Uint8ClampedArray) => {
          let r = 0, g = 0, b = 0, m = 0;
          for (let y = Math.floor(H * 0.25); y < Math.floor(H * 0.75); y++)
            for (let x = Math.floor(W * 0.25); x < Math.floor(W * 0.75); x++) {
              const o = (y * W + x) * 4;
              r += px[o]; g += px[o + 1]; b += px[o + 2]; m++;
            }
          return [r / m, g / m, b / m];
        };
        let change = 0;
        for (let i = 0; i < base.length; i += 4) change += Math.abs(base[i] - ocioFrame[i]) + Math.abs(base[i + 1] - ocioFrame[i + 1]) + Math.abs(base[i + 2] - ocioFrame[i + 2]);
        return { max, mean: sum / n, centre: centre(ocioFrame), change: change / ((base.length / 4) * 3), pixels: Array.from(ocioFrame.slice(0, 0)) };
      },
      { W, H, extra },
    );

  const monitorBase = await programMean(page);

  // -- load the config and its LUTs through the dialog ---------------------------------------------------------------------
  await openOcioDialog(page);
  await page.getByTestId("ocio-config-input").setInputFiles(join(HANDMADE, "config.ocio"));
  await page.getByTestId("ocio-lut-input").setInputFiles(readdirSync(HANDMADE_LUTS).map((name) => join(HANDMADE_LUTS, name)));
  await expect(page.getByTestId("ocio-summary")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ocio-missing")).toBeVisible();
  await page.getByTestId("ocio-input-select").selectOption("sRGB Curve");
  await page.getByTestId("ocio-working-select").selectOption("Linear");
  await page.getByTestId("ocio-display-select").selectOption("Test Display");
  await page.getByTestId("ocio-view-select").selectOption("Standard");
  const unsupportedListed = await page.getByTestId("ocio-unsupported").evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
    return Array.from(el.querySelectorAll("li")).map((li) => li.textContent ?? "");
  });
  await expect(page.getByTestId("ocio-apply")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("ocio-apply").click();
  await expect.poll(async () => (await readSettings(page)).colorManagement, { timeout: 10_000 }).toBe("ocio");
  await seek(page, 1);
  await settle(page, 1500);
  await waitForPresentedPlayhead(page);
  const settingsPlain = await readSettings(page);
  const badge = await page.getByTestId("ocio-badge").textContent();
  const plain: any = await frames(null);
  expect(plain.error).toBeUndefined();
  await expect.poll(async () => Math.abs((await programMean(page))[0] - monitorBase[0]), { timeout: 20_000, intervals: [300] }).toBeGreaterThan(2);
  await settle(page, 600);
  const monitorPlain = await programMean(page);

  // -- turn on the Film Print look (a 3D LUT in the Log Camera process space) ------------------------------------------------
  await openOcioDialog(page);
  await expect(page.getByTestId("ocio-summary")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ocio-look-Film Print").check();
  await expect(page.getByTestId("ocio-apply")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("ocio-apply").click();
  await expect.poll(async () => (await readSettings(page)).ocio?.looks ?? null, { timeout: 10_000 }).toEqual(["Film Print"]);
  await seek(page, 1);
  await settle(page, 1500);
  await waitForPresentedPlayhead(page);
  const settingsLook = await readSettings(page);
  const look: any = await frames(null);
  expect(look.error).toBeUndefined();
  await expect.poll(async () => Math.abs((await programMean(page))[1] - monitorPlain[1]), { timeout: 20_000, intervals: [300] }).toBeGreaterThan(1);
  await settle(page, 600);
  const monitorLook = await programMean(page);

  // -- undo / redo ----------------------------------------------------------------------------------------------------------
  await undo(page);
  await expect.poll(async () => (await readSettings(page)).ocio?.looks ?? null, { timeout: 10_000 }).toBeNull();
  await settle(page, 1200);
  await seek(page, 1);
  await waitForPresentedPlayhead(page);
  const settingsUndone = await readSettings(page);
  const monitorUndone = await programMean(page);
  await redo(page);
  await expect.poll(async () => (await readSettings(page)).ocio?.looks ?? null, { timeout: 10_000 }).toEqual(["Film Print"]);
  await settle(page, 1200);
  await seek(page, 1);
  await waitForPresentedPlayhead(page);
  const settingsRedone = await readSettings(page);
  const monitorRedone = await programMean(page);

  // -- save / load -------------------------------------------------------------------------------------------------------------
  const persisted = await page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E;
    const serializer = new h.ProjectSerializer({});
    const state = h.project.getState().project;
    const json = serializer.exportToJson(state);
    const saved = JSON.parse(json).project.settings;
    const imported = serializer.importFromJson(json);
    const live = state.mediaLibrary.items;
    h.project.getState().loadProject({
      ...imported,
      mediaLibrary: { ...imported.mediaLibrary, items: imported.mediaLibrary.items.map((item: any) => live.find((l: any) => l.id === item.id) ?? item) },
    });
    const loaded = h.project.getState().project.settings;
    const same = (x: any) => ({ mode: x.colorManagement, name: x.ocio?.configName, textLength: x.ocio?.configText?.length, files: Object.keys(x.ocio?.files ?? {}).sort(), cubeLength: x.ocio?.files?.["film_twist.cube"]?.length, working: x.ocio?.workingSpace, input: x.ocio?.defaultInputSpace, display: x.ocio?.display, view: x.ocio?.view, looks: x.ocio?.looks });
    return { saved: same(saved), loaded: same(loaded) };
  });
  await seek(page, 1);
  await settle(page, 1500);
  await waitForPresentedPlayhead(page);
  const monitorReloaded = await programMean(page);

  // -- per-clip input colour space ------------------------------------------------------------------------------------------------
  const clipBefore = await programMean(page);
  await page.evaluate(async (id) => {
    const h = (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E;
    await (h.project.getState() as any).executeAction({ type: "clip/setOcioInputSpace", id: `ocio-clip-${Date.now()}`, timestamp: Date.now(), params: { clipId: id, ocioInputSpace: "Log Camera" } });
  }, clipId);
  await seek(page, 1);
  await settle(page, 1500);
  await waitForPresentedPlayhead(page);
  const clipAfter = await programMean(page);
  const spaceAfter = await page.evaluate((id) => (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E.project.getState().getClip(id)?.ocioInputSpace, clipId);
  await undo(page);
  await settle(page, 1200);
  await seek(page, 1);
  await waitForPresentedPlayhead(page);
  const clipUndone = await programMean(page);
  const spaceUndone = await page.evaluate((id) => (window as unknown as { __openreelE2E: OcioHook }).__openreelE2E.project.getState().getClip(id)?.ocioInputSpace, clipId);

  return {
    plain: { max: plain.max, mean: plain.mean },
    look: { max: look.max, mean: look.mean },
    lookMeanChange: Math.abs(look.centre[1] - plain.centre[1]) + Math.abs(look.centre[0] - plain.centre[0]) + Math.abs(look.centre[2] - plain.centre[2]),
    monitor: { base: monitorBase, plain: monitorPlain, look: monitorLook, undone: monitorUndone, redone: monitorRedone, reloaded: monitorReloaded },
    engineMean: { plain: plain.centre, look: look.centre },
    settings: { afterPlain: settingsPlain.ocio, afterLook: settingsLook.ocio, afterUndo: settingsUndone.ocio, afterRedo: settingsRedone.ocio, saved: persisted.saved, loaded: persisted.loaded },
    badge,
    clipOverride: { before: clipBefore, after: clipAfter, undone: clipUndone, spaceAfter, spaceUndone },
    unsupportedListed,
  };
}

const maxDelta = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

export function assertOcioProductResult(r: OcioProductResult, tolerance: { max: number; mean: number; monitor: number }): void {
  // 1. Unsupported items are listed with their reasons, never skipped silently.
  expect(r.unsupportedListed.some((t) => /Needs Missing LUT/.test(t) && /not_provided\.cube/.test(t))).toBe(true);
  expect(r.unsupportedListed.some((t) => /Uses Grading/.test(t) && /ExposureContrastTransform/.test(t))).toBe(true);
  expect(r.unsupportedListed.some((t) => /Cinespace Curved Prelut/.test(t) && /pre-LUT/.test(t))).toBe(true);
  // 2. The OCIO engine frame is what the CPU reference predicts from the frame's own pixels (input space -> working -> view).
  expect(r.plain.mean, "OCIO frame vs prediction, mean 8-bit error").toBeLessThan(tolerance.mean);
  expect(r.plain.max, "OCIO frame vs prediction, max 8-bit error").toBeLessThanOrEqual(tolerance.max);
  // 3. The look (a 3D LUT in a log process space) changes the pixels, by what the reference predicts.
  expect(r.lookMeanChange, "Film Print look changes the frame centre").toBeGreaterThan(2);
  expect(r.look.mean, "OCIO frame with look vs prediction, mean 8-bit error").toBeLessThan(tolerance.mean);
  expect(r.look.max, "OCIO frame with look vs prediction, max 8-bit error").toBeLessThanOrEqual(tolerance.max);
  // 4. The Program monitor shows the engine's OCIO frame, and it moved when OCIO and the look were switched on.
  expect(maxDelta(r.monitor.plain, r.engineMean.plain), "Program monitor vs engine OCIO frame").toBeLessThan(tolerance.monitor);
  expect(maxDelta(r.monitor.look, r.engineMean.look), "Program monitor vs engine OCIO frame with look").toBeLessThan(tolerance.monitor);
  expect(maxDelta(r.monitor.plain, r.monitor.base), "monitor changed when OCIO was applied").toBeGreaterThan(2);
  expect(maxDelta(r.monitor.look, r.monitor.plain), "monitor changed when the look was applied").toBeGreaterThan(1);
  // 5. Settings, undo / redo.
  expect(r.badge).toContain("Test Display / Standard");
  expect(r.settings.afterPlain.looks).toBeUndefined();
  expect(r.settings.afterLook.looks).toEqual(["Film Print"]);
  expect(r.settings.afterUndo.looks).toBeUndefined();
  expect(r.settings.afterRedo.looks).toEqual(["Film Print"]);
  expect(maxDelta(r.monitor.undone, r.monitor.plain), "undo restores the previous monitor").toBeLessThan(2);
  expect(maxDelta(r.monitor.redone, r.monitor.look), "redo restores the look").toBeLessThan(2);
  // 6. Round trip: the saved file carries config text, LUT data and choices; the reloaded project renders the same.
  expect(r.settings.saved).toEqual(r.settings.loaded);
  expect(r.settings.saved.mode).toBe("ocio");
  expect(r.settings.saved.files).toContain("film_twist.cube");
  expect(r.settings.saved.cubeLength).toBeGreaterThan(100_000);
  expect(r.settings.saved.looks).toEqual(["Film Print"]);
  expect(r.settings.saved.input).toBe("sRGB Curve");
  expect(maxDelta(r.monitor.reloaded, r.monitor.look), "reloaded project renders like before").toBeLessThan(2);
  // 7. Per-clip input space: changes the picture, one undo reverts it.
  expect(r.clipOverride.spaceAfter).toBe("Log Camera");
  expect(maxDelta(r.clipOverride.after, r.clipOverride.before), "per-clip OCIO input space changes the frame").toBeGreaterThan(1);
  expect(r.clipOverride.spaceUndone).toBeUndefined();
  expect(maxDelta(r.clipOverride.undone, r.clipOverride.before), "undo restores the clip's input space").toBeLessThan(2);
}
