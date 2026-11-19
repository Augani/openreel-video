import { expect, test } from "@playwright/test";
import { ensureLumetriFixtures, openColorGrading, openWithClips, bandMeans } from "./lumetri-basic-lib";
import { openHookPage, settle, snapStable, undo } from "./helpers";

/**
 * Camera log input presets. Two flows:
 *  1. the WebGL2 shader decode of every camera curve against the Float32 CPU reference (same GLSL source the unit
 *     tests hold to the TypeScript curve), on the "gpu" project;
 *  2. the Color tab "Camera input" picker: choosing S-Log3 changes the Program frame to exactly what the shared CPU
 *     input transform predicts for the ramp, one undo reverts it.
 */

interface CoreHook {
  hdrWorking: Record<string, any>;
  hdrGpu: Record<string, any>;
  cameraLog: Record<string, any>;
  inputTransform: Record<string, any>;
}

test.beforeAll(() => ensureLumetriFixtures());

test("the shader decodes every camera log curve like the CPU reference (ramp through all nine transfers)", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openHookPage(page);
  const result = await page.evaluate(() => {
    const core = (window as unknown as { __openreelE2E: { core: CoreHook } }).__openreelE2E.core;
    if (!core.hdrGpu.isGpuHdrAvailable()) return { skipped: "no WebGL2 with EXT_color_buffer_float" };
    const hw = core.hdrWorking;
    const W = 256;
    const H = 8;
    // 8-bit grey ramp: every code 0..255 once, left to right.
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        data[o] = x;
        data[o + 1] = x;
        data[o + 2] = x;
        data[o + 3] = 255;
      }
    const identity = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" };
    const geometry = hw.computeLayerGeometry(identity, W, H, W, H);
    const cpu = new hw.CpuHdrCompositor();
    const gpu = new core.hdrGpu.GpuHdrCompositor();
    const out: Array<{ id: string; maxRel: number; over: number; peak: number }> = [];
    for (const def of core.cameraLog.CAMERA_LOGS as Array<{ id: string; gamut: string }>) {
      const decode = hw.hdrSourceDecode({ primaries: def.gamut === "bt2020" ? "bt2020" : def.gamut, transfer: def.id, matrix: "rgb", fullRange: true });
      const run = (comp: any) => {
        comp.begin(W, H);
        comp.drawCodes({ depth: 8, width: W, height: H, data }, decode, { geometry, opacity: 1 });
        return comp.readFrame().data as Float32Array;
      };
      const a = run(cpu);
      const b = run(gpu);
      let maxRel = 0;
      let over = 0;
      let peak = 0;
      for (let i = 0; i < a.length; i++) {
        const rel = Math.abs(a[i] - b[i]) / Math.max(0.02, Math.abs(a[i]));
        if (rel > maxRel) maxRel = rel;
        if (rel > 0.02) over++;
        if (i % 4 === 0 && b[i] > peak) peak = b[i];
      }
      out.push({ id: def.id, maxRel, over: over / a.length, peak });
    }
    gpu.dispose();
    cpu.dispose();
    return { curves: out };
  });
  console.log(`[${testInfo.project.name}] camera log shader parity: ${JSON.stringify(result)}`);
  if ("skipped" in result) test.skip(true, String(result.skipped));
  const { curves } = result as { curves: Array<{ id: string; maxRel: number; over: number; peak: number }> };
  expect(curves).toHaveLength(9);
  for (const c of curves) {
    expect(c.over, `${c.id} fraction of samples off by more than 2%`).toBeLessThan(0.005);
    // A real log decode: signal 1.0 is far above SDR white.
    expect(c.peak, `${c.id} peak`).toBeGreaterThan(1.5);
  }
});

test("Color tab Camera input: picking S-Log3 converts the Program frame like the CPU input transform and undoes", async ({ page }) => {
  test.setTimeout(240_000);
  const [clipId] = await openWithClips(page, ["lumetri-gradient.mp4"]);
  await openColorGrading(page, clipId);

  const select = page.getByTestId("camera-input-select");
  await select.scrollIntoViewIfNeeded();
  await expect(select).toHaveValue("tagged");
  await settle(page, 400);
  await snapStable(page, "before");
  const before = await bandMeans(page, "before", 8);

  await select.selectOption("log-slog3");
  await expect(page.getByTestId("camera-input-status")).toContainText("Sony S-Log3 / S-Gamut3.Cine");
  await settle(page, 1200);
  await snapStable(page, "slog3");
  const after = await bandMeans(page, "slog3", 8);

  const media = await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    return e.project.getState().project.mediaLibrary.items.map((i: any) => i.colorInterpretation);
  });
  expect(media).toEqual(["log-slog3"]);

  // Predicted by the shared input transform from the decoded ramp (grey code = x / width).
  const expected = await page.evaluate(
    ([count]) => {
      const core = (window as unknown as { __openreelE2E: { core: CoreHook } }).__openreelE2E.core;
      const space = { primaries: "sgamut3cine", transfer: "slog3", matrix: "rgb", fullRange: true };
      const t = core.inputTransform.createInputTransform(space);
      const out: number[] = [];
      for (let b = 0; b < (count as number); b++) {
        let sum = 0;
        const N = 64;
        for (let k = 0; k < N; k++) {
          const code = Math.round(((b + (k + 0.5) / N) / (count as number)) * 255) / 255;
          sum += core.inputTransform.transformPixel(code, code, code, t)[1] * 255;
        }
        out.push(sum / N);
      }
      return out;
    },
    [8] as const,
  );
  const greens = after.bands.map((b) => b[1]);
  console.log(`[camera-log] bands before=${before.bands.map((b) => b[1].toFixed(0))} after=${greens.map((g) => g.toFixed(0))} expected=${expected.map((g) => g.toFixed(0))}`);
  // The frame really changed (a log ramp is a different image) ...
  expect(Math.max(...greens.map((g, i) => Math.abs(g - before.bands[i][1])))).toBeGreaterThan(20);
  // ... and matches the transform within the 8-bit decode / encode rounding.
  greens.forEach((g, i) => expect(Math.abs(g - expected[i]), `band ${i}`).toBeLessThan(8));

  await undo(page);
  await settle(page, 1200);
  const reverted = await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    return e.project.getState().project.mediaLibrary.items.map((i: any) => i.colorInterpretation ?? null);
  });
  expect(reverted).toEqual([null]);
  await expect(page.getByTestId("camera-input-select")).toHaveValue("tagged");
});

test("Interpret Footage dialog: camera select is labelled, fits a 1366x700 laptop viewport and applies one undoable step", async ({ page }) => {
  test.setTimeout(240_000);
  await openWithClips(page, ["lumetri-gradient.mp4"]);
  await page.setViewportSize({ width: 1366, height: 700 });
  await settle(page, 400);
  await page.getByRole("button", { name: "Media actions for lumetri-gradient.mp4" }).click();
  await page.getByTestId("menu-interpret-footage").click();
  const dialog = page.getByTestId("interpret-footage-dialog");
  await expect(dialog).toBeVisible();

  await settle(page, 600);
  const box = await dialog.boundingBox();
  console.log(`[camera-log] dialog box ${JSON.stringify(box)}`);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  const apply = dialog.getByTestId("interpret-apply");
  await expect(apply).toBeInViewport();
  // Nothing may be clipped sideways: the longest camera option once pushed the grid wider than the dialog.
  const fit = await dialog.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(fit.scroll, "dialog content overflows horizontally").toBeLessThanOrEqual(fit.client);
  const applyBox = await apply.boundingBox();
  expect(applyBox!.x + applyBox!.width).toBeLessThanOrEqual(fit.right);

  const select = dialog.getByLabel("Camera input (log)");
  await expect(select).toHaveValue("");
  await select.selectOption("log-logc3");
  await expect(page.getByTestId("media-color-effective")).toContainText("LogC3");
  await apply.click();
  await expect(dialog).toBeHidden();
  const media = await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    return e.project.getState().project.mediaLibrary.items.map((i: any) => i.colorInterpretation);
  });
  expect(media).toEqual(["log-logc3"]);
  await undo(page);
  await settle(page, 600);
  const reverted = await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    return e.project.getState().project.mediaLibrary.items.map((i: any) => i.colorInterpretation ?? null);
  });
  expect(reverted).toEqual([null]);
});
