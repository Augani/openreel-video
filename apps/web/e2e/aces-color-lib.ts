import { expect, type Page } from "@playwright/test";
import { ensureLumetriFixtures, openWithClips } from "./lumetri-basic-lib";
import { programMean, seek, settle, undo, redo, waitForPresentedPlayhead } from "./helpers";

export { ensureLumetriFixtures };

interface AcesHook {
  project: { getState(): any };
  video: { getVideoEngine(): any };
  ProjectSerializer: new (storage: unknown) => { exportToJson(project: unknown): string; importFromJson(json: string): any };
  core: { aces: Record<string, any>; acesOutput: Record<string, any>; hdrWorking: Record<string, any>; colorOutput: Record<string, any> };
}

export interface AcesProductResult {
  /** Engine frame, display-referred vs ACES: mean absolute 8-bit difference (the pipeline really changed the pixels). */
  meanChange: number;
  /** ACES frame vs the CPU prediction (IDT -> OT of the display-referred frame's own pixels): max and mean 8-bit error. */
  predictionMax: number;
  predictionMean: number;
  /** Same with a warm grade: the grade runs in ACEScct (CPU prediction through `gradeHdrPixel`). */
  gradedMax: number;
  gradedMean: number;
  gradedRedShift: number;
  gradedBlueShift: number;
  /** Program monitor centre mean (live preview) in display-referred, in ACES, after undo, after redo, after save / load. */
  monitor: { base: number[]; aces: number[]; undone: number[]; redone: number[]; reloaded: number[] };
  /** Engine ACES frame centre mean, for the monitor comparison. */
  engineAcesMean: number[];
  settings: { afterMenu: unknown; afterUndo: unknown; afterRedo: unknown; savedJson: unknown; afterLoad: unknown };
  badge: { shown: boolean; hiddenAfterUndo: boolean };
  clipOverride: { before: number[]; after: number[]; undone: number[] };
}

/**
 * ACES colour management through the product: the Preview options menu switches the project (one undoable step), the
 * Program monitor and the engine (preview and export share it) render the ACES output transform, grading runs in ACEScct,
 * the setting survives a save / load round trip, and a per-clip input override changes the picture and undoes.
 */
export async function runAcesProductFlow(page: Page): Promise<AcesProductResult> {
  const [clipId] = await openWithClips(page, ["lumetri-gradient.mp4"]);
  await seek(page, 1);
  await settle(page, 900);
  await waitForPresentedPlayhead(page);

  const W = 640;
  const H = 360;
  const engineFrames = () =>
    page.evaluate(
      async ({ W, H, clipId }) => {
        const h = (window as unknown as { __openreelE2E: AcesHook }).__openreelE2E;
        const hw = h.core.hdrWorking;
        const aces = h.core.acesOutput;
        const out = h.core.colorOutput;
        const engine = h.video.getVideoEngine();
        const project = h.project.getState().project;
        const readRgba = async (bitmap: ImageBitmap) => {
          const c = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(bitmap, 0, 0);
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        };
        const render = async (p: unknown) => {
          for (let i = 0; i < 2; i++) await engine.renderFrame(p, 1, W, H);
          const f = await engine.renderFrame(p, 1, W, H);
          return readRgba(f.image);
        };
        const withSettings = (extra: Record<string, unknown>) => ({ ...project, settings: { ...project.settings, ...extra } });
        const base = await render(project);
        const acesPx = await render(withSettings({ colorManagement: "aces" }));
        const graded = {
          ...withSettings({ colorManagement: "aces" }),
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((t: any) => ({
              ...t,
              clips: t.clips.map((c: any) => (c.id === clipId ? { ...c, colorGrading: { temperature: 40 } } : c)),
            })),
          },
        };
        const gradedPx = await render(graded);

        // CPU prediction from the display-referred frame's own pixels.
        const pipeline = hw.acesPipeline("srgb");
        const idt = hw.hdrSourceDecode(null, pipeline).toBt2020 as number[][];
        const spec = hw.prepareHdrGrade({ temperature: 40 }, pipeline);
        const rgb = [0, 0, 0];
        const predict = (r: number, g: number, b: number, grade: boolean): number[] => {
          const lr = out.srgbToLinear(r / 255);
          const lg = out.srgbToLinear(g / 255);
          const lb = out.srgbToLinear(b / 255);
          let a = [
            idt[0][0] * lr + idt[0][1] * lg + idt[0][2] * lb,
            idt[1][0] * lr + idt[1][1] * lg + idt[1][2] * lb,
            idt[2][0] * lr + idt[2][1] * lg + idt[2][2] * lb,
          ];
          if (grade) a = hw.gradeHdrPixel(a[0], a[1], a[2], spec);
          aces.acesOutputTransform(Math.max(0, a[0]), Math.max(0, a[1]), Math.max(0, a[2]), "srgb", rgb);
          return rgb.map((v) => v * 255);
        };
        const compare = (px: Uint8ClampedArray, grade: boolean) => {
          let max = 0;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < base.length; i += 4 * 11) {
            const p = predict(base[i], base[i + 1], base[i + 2], grade);
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(px[i + c] - p[c]);
              if (d > max) max = d;
              sum += d;
              n++;
            }
          }
          return { max, mean: sum / n };
        };
        let change = 0;
        let redShift = 0;
        let blueShift = 0;
        for (let i = 0; i < base.length; i += 4) {
          change += Math.abs(base[i] - acesPx[i]) + Math.abs(base[i + 1] - acesPx[i + 1]) + Math.abs(base[i + 2] - acesPx[i + 2]);
          redShift += gradedPx[i] - acesPx[i];
          blueShift += gradedPx[i + 2] - acesPx[i + 2];
        }
        const n = base.length / 4;
        const centre = (px: Uint8ClampedArray) => {
          let r = 0, g = 0, b = 0, m = 0;
          for (let y = Math.floor(H * 0.25); y < Math.floor(H * 0.75); y++)
            for (let x = Math.floor(W * 0.25); x < Math.floor(W * 0.75); x++) {
              const o = (y * W + x) * 4;
              r += px[o]; g += px[o + 1]; b += px[o + 2]; m++;
            }
          return [r / m, g / m, b / m];
        };
        return {
          meanChange: change / (n * 3),
          plain: compare(acesPx, false),
          graded: compare(gradedPx, true),
          redShift: redShift / n,
          blueShift: blueShift / n,
          engineAcesMean: centre(acesPx),
        };
      },
      { W, H, clipId },
    );

  const frames = await engineFrames();

  // The Program monitor (live preview), display-referred baseline.
  const monitorBase = await programMean(page);

  // Preview options > Color management > ACES, the way a user does.
  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByTestId("color-management-trigger").click();
  await page.getByTestId("color-management-aces").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __openreelE2E: AcesHook }).__openreelE2E.project.getState().project.settings.colorManagement), { timeout: 10_000 })
    .toBe("aces");
  await seek(page, 1);
  await settle(page, 1200);
  await waitForPresentedPlayhead(page);
  const badgeShown = await page.getByTestId("aces-badge").isVisible();
  const settingsAfterMenu = await readSettings(page);
  await expect.poll(async () => Math.abs((await programMean(page))[0] - monitorBase[0]), { timeout: 20_000, intervals: [300] }).toBeGreaterThan(8);
  await settle(page, 600);
  const monitorAces = await programMean(page);

  // Undo is one step: the project returns to display-referred and the monitor to the baseline.
  await undo(page);
  await expect.poll(async () => (await readSettings(page)).colorManagement ?? null, { timeout: 10_000 }).toBeNull();
  await settle(page, 1200);
  await waitForPresentedPlayhead(page);
  const settingsAfterUndo = await readSettings(page);
  const badgeHiddenAfterUndo = !(await page.getByTestId("aces-badge").isVisible());
  const monitorUndone = await programMean(page);
  await redo(page);
  await expect.poll(async () => (await readSettings(page)).colorManagement ?? null, { timeout: 10_000 }).toBe("aces");
  await settle(page, 1200);
  await waitForPresentedPlayhead(page);
  const settingsAfterRedo = await readSettings(page);
  const monitorRedone = await programMean(page);

  // Save / load round trip through the project file.
  const persisted = await page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: AcesHook }).__openreelE2E;
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
    return { saved: saved.colorManagement as unknown, loaded: h.project.getState().project.settings.colorManagement as unknown };
  });
  await seek(page, 1);
  await settle(page, 1400);
  await waitForPresentedPlayhead(page);
  const monitorReloaded = await programMean(page);

  // Per-clip input override (Color tab > Camera input > This clip only) changes the picture; one undo reverts it.
  const clipBefore = await programMean(page);
  await page.evaluate(async (id) => {
    const h = (window as unknown as { __openreelE2E: AcesHook }).__openreelE2E;
    await (h.project.getState() as any).executeAction({ type: "clip/setColorInterpretation", id: `ov-${Date.now()}`, timestamp: Date.now(), params: { clipId: id, colorInterpretation: "log-logc3" } });
  }, clipId);
  await seek(page, 1);
  await settle(page, 1200);
  await waitForPresentedPlayhead(page);
  const clipAfter = await programMean(page);
  await undo(page);
  await settle(page, 1200);
  await seek(page, 1);
  await waitForPresentedPlayhead(page);
  const clipUndone = await programMean(page);

  return {
    meanChange: frames.meanChange,
    predictionMax: frames.plain.max,
    predictionMean: frames.plain.mean,
    gradedMax: frames.graded.max,
    gradedMean: frames.graded.mean,
    gradedRedShift: frames.redShift,
    gradedBlueShift: frames.blueShift,
    monitor: { base: monitorBase, aces: monitorAces, undone: monitorUndone, redone: monitorRedone, reloaded: monitorReloaded },
    engineAcesMean: frames.engineAcesMean,
    settings: { afterMenu: settingsAfterMenu.colorManagement, afterUndo: settingsAfterUndo.colorManagement ?? null, afterRedo: settingsAfterRedo.colorManagement, savedJson: persisted.saved, afterLoad: persisted.loaded },
    badge: { shown: badgeShown, hiddenAfterUndo: badgeHiddenAfterUndo },
    clipOverride: { before: clipBefore, after: clipAfter, undone: clipUndone },
  };
}

async function readSettings(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as unknown as { __openreelE2E: AcesHook }).__openreelE2E.project.getState().project.settings);
}

const maxDelta = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

export function assertAcesProductResult(r: AcesProductResult): void {
  // 1. ACES really changes the pixels, and by exactly what the analytic transform predicts.
  expect(r.meanChange, "display-referred vs ACES engine frame, mean 8-bit change").toBeGreaterThan(8);
  expect(r.predictionMean, "ACES engine frame vs IDT -> RRT/ODT prediction (mean 8-bit error)").toBeLessThan(0.8);
  expect(r.predictionMax, "ACES engine frame vs prediction (max 8-bit error)").toBeLessThanOrEqual(3);
  // 2. The grade runs in ACEScct: a warm grade raises red and lowers blue by the amount the ACEScct model predicts.
  expect(r.gradedRedShift).toBeGreaterThan(1);
  expect(r.gradedBlueShift).toBeLessThan(-1);
  expect(r.gradedMean, "graded ACES frame vs ACEScct grade prediction (mean 8-bit error)").toBeLessThan(1.2);
  expect(r.gradedMax, "graded ACES frame vs prediction (max 8-bit error)").toBeLessThanOrEqual(5);
  // 3. Setting, badge and undo / redo.
  expect(r.settings.afterMenu).toBe("aces");
  expect(r.badge.shown).toBe(true);
  expect(r.settings.afterUndo).toBeNull();
  expect(r.badge.hiddenAfterUndo).toBe(true);
  expect(r.settings.afterRedo).toBe("aces");
  // 4. The live Program monitor shows the engine's ACES frame (same output transform), not the display-referred one.
  expect(maxDelta(r.monitor.aces, r.engineAcesMean), "Program monitor vs engine ACES frame").toBeLessThan(4);
  expect(maxDelta(r.monitor.aces, r.monitor.base), "monitor changed when ACES was switched on").toBeGreaterThan(8);
  expect(maxDelta(r.monitor.undone, r.monitor.base), "undo restores the display-referred monitor").toBeLessThan(2);
  expect(maxDelta(r.monitor.redone, r.monitor.aces), "redo restores the ACES monitor").toBeLessThan(2);
  // 5. Persisted: the saved file carries it and the reloaded project renders ACES again.
  expect(r.settings.savedJson).toBe("aces");
  expect(r.settings.afterLoad).toBe("aces");
  expect(maxDelta(r.monitor.reloaded, r.monitor.aces), "reloaded project renders like before").toBeLessThan(2);
  // 6. Per-clip input override: changes the picture, one undo reverts it.
  expect(maxDelta(r.clipOverride.after, r.clipOverride.before), "LogC3 override on this clip changes the frame").toBeGreaterThan(8);
  expect(maxDelta(r.clipOverride.undone, r.clipOverride.before), "undo restores the clip's interpretation").toBeLessThan(2);
}
