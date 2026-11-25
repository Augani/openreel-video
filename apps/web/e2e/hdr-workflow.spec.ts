import { expect, test, type Page } from "@playwright/test";
import { ensureLumetriFixtures, openWithClips } from "./lumetri-basic-lib";
import { press, settle } from "./helpers";

// HDR workflow: the sequence colour space (Rec.709 / Rec.2100 PQ / Rec.2100 HLG) is an undoable Preview setting that
// defaults to Rec.709, switches the scopes to nits, and the tone-mapped SDR preview of a graded HDR frame equals the
// frame the HDR export encodes once that export is decoded and tone-mapped back to SDR.
//
// Runs in the "gpu" project (hardware WebGL2 with EXT_color_buffer_float).

test.beforeAll(() => ensureLumetriFixtures());

interface Hook {
  project: { getState(): { project: { settings: Record<string, unknown> }; undo(): Promise<unknown> } };
  core: { hdrWorking: Record<string, any>; hdrGpu: Record<string, any>; colorOutput: Record<string, any>; hdrScopeFeed: Record<string, any> };
}

const settings = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.settings);

async function pickSequenceSpace(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByRole("menuitem", { name: "Sequence color space" }).click();
  await page.getByRole("menuitemcheckbox", { name: label }).click();
}

test("sequence colour space: defaults to Rec.709, switches to Rec.2100 PQ and HLG, scopes read nits, undo restores SDR", async ({ page }) => {
  test.setTimeout(180_000);
  await openWithClips(page, ["lumetri-gradient.mp4"]);
  expect((await settings(page)).workingColorSpace).toBeUndefined();
  expect((await settings(page)).sequenceColorSpace).toBeUndefined();

  await pickSequenceSpace(page, "Rec.2100 PQ (HDR10)");
  await expect.poll(async () => (await settings(page)).sequenceColorSpace).toBe("rec2100pq");
  expect((await settings(page)).workingColorSpace).toBe("rec2020");

  // Scopes (Shift+S) switch from the IRE selector to a nit label and draw from the float image.
  await press(page, "Shift+S");
  const panel = page.getByTestId("scopes-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("scopes-hdr-scale")).toContainText("PQ sequence");
  await expect(panel.getByLabel("Waveform scale")).toHaveCount(0);
  // The engine publishes the PQ-encoded float image only while the scope asked for it (SDR sequences never do).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core.hdrScopeFeed.getHdrScopeFrame()?.width ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('[data-testid="scopes-panel"] canvas') as HTMLCanvasElement;
          const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
          let ink = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
          return ink / (d.length / 4);
        }),
      { message: "HDR scope drew nothing", timeout: 10_000 },
    )
    .toBeGreaterThan(0.001);

  await pickSequenceSpace(page, "Rec.2100 HLG");
  await expect.poll(async () => (await settings(page)).sequenceColorSpace).toBe("rec2100hlg");
  await expect(panel.getByTestId("scopes-hdr-scale")).toContainText("HLG sequence");

  // Export dialog: the Color / HDR control defaults to the sequence transfer when this browser can encode 10-bit HEVC.
  await press(page, "Shift+S");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  const control = page.getByTestId("export-hdr-control");
  await expect(control).toBeVisible();
  const unavailable = await page.getByTestId("export-hdr-unavailable").count();
  if (unavailable) {
    // No 10-bit HEVC encoder here: a clear message, and it says the file will be a tone-mapped SDR one.
    await expect(page.getByTestId("export-hdr-unavailable")).toContainText("tone-mapped SDR");
  } else {
    await expect(control.getByRole("combobox")).toContainText("HLG");
  }
  await page.keyboard.press("Escape");

  // Two undo steps (HLG, PQ) bring the sequence back to the default Rec.709.
  await page.evaluate(async () => {
    const store = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState();
    await store.undo();
    await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().undo();
  });
  await expect.poll(async () => (await settings(page)).workingColorSpace).not.toBe("rec2020");
  expect((await settings(page)).sequenceColorSpace).toBeUndefined();
});

test("graded HDR preview (tone-mapped SDR) equals the PQ export decoded and tone-mapped back to SDR", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __openreelE2E?: unknown }).__openreelE2E, undefined, { timeout: 60_000 });
  const result = await page.evaluate(async () => {
    const core = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.core;
    const hw = core.hdrWorking;
    if (!core.hdrGpu.isGpuHdrAvailable()) return { skipped: "no WebGL2 with EXT_color_buffer_float" };
    const W = 192;
    const H = 108;
    const pq = core.colorOutput.pqEncodeNits as (n: number) => number;
    const pqDecode = core.colorOutput.pqDecodeToNits as (s: number) => number;
    const SW = 160;
    const SH = 90;
    // HDR source: PQ luma ramp 10..2000 nits, with a hue variation, 16-bit.
    const codes = new Uint16Array(SW * SH * 4);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const nits = 10 + (1990 * x) / (SW - 1);
        const o = (y * SW + x) * 4;
        codes[o] = Math.round(pq(nits * (0.7 + 0.3 * (y / (SH - 1)))) * 65535);
        codes[o + 1] = Math.round(pq(nits * 0.85) * 65535);
        codes[o + 2] = Math.round(pq(nits * (1 - 0.5 * (y / (SH - 1)))) * 65535);
        codes[o + 3] = 65535;
      }
    }
    const decode = hw.hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false });
    const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "contain", crop: { x: 0, y: 0, width: 1, height: 1 } };
    const geometry = hw.computeLayerGeometry(transform, SW, SH, W, H);
    const grade = hw.prepareHdrGrade({
      temperature: 15,
      tint: -6,
      tone: { exposure: 0.3, contrast: 0.15, highlights: -0.25, shadows: 0.2, whites: 0.1, blacks: -0.05 },
      colorWheels: {
        shadows: { r: 0.02, g: 0, b: 0.05 },
        midtones: { r: 0, g: 0.02, b: 0 },
        highlights: { r: 0.03, g: 0, b: -0.02 },
        shadowsLift: 0,
        midtonesGamma: 1,
        highlightsGain: 1,
      },
    });
    if (!grade) return { error: "grade was neutral" };

    const gpu = new core.hdrGpu.GpuHdrCompositor();
    gpu.begin(W, H);
    gpu.drawCodes({ depth: 16, width: SW, height: SH, data: codes }, decode, { geometry, opacity: 1, grade });
    // Preview: the tone-mapped SDR view the Program monitor shows.
    const preview: Uint8ClampedArray = gpu.readSdrView();
    // Export: the PQ-encoded frame the HDR export sends to the encoder, quantised to the 10-bit codes the file holds.
    const spec = core.colorOutput.resolveOutputColorSpec("rec2020", "pq");
    const encoded: Float32Array = gpu.readEncodedRgb(spec);
    const frame = { width: W, height: H, data: new Float32Array(W * H * 4) };
    let peakNits = 0;
    for (let p = 0; p < W * H; p++) {
      for (let c = 0; c < 3; c++) {
        const code10 = Math.round(Math.max(0, Math.min(1, encoded[p * 3 + c])) * 1023) / 1023;
        const nits = pqDecode(code10);
        if (nits > peakNits) peakNits = nits;
        frame.data[p * 4 + c] = nits / 203;
      }
      frame.data[p * 4 + 3] = 1;
    }
    // "Export tone-mapped back to SDR": the same output transform the SDR export of this project uses.
    const exportedSdr: Uint8ClampedArray = hw.hdrFrameToSdrRgba(frame);
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < preview.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(preview[i + c] - exportedSdr[i + c]);
        sum += d;
        n++;
        if (d > max) max = d;
      }
    }
    return { max, mean: sum / n, peakNits };
  });
  testInfo.annotations.push({ type: "hdr-parity", description: JSON.stringify(result) });
  console.log(`[hdr-workflow] ${JSON.stringify(result)}`);
  if ("skipped" in result) test.skip(true, String(result.skipped));
  expect("error" in result ? result.error : undefined).toBeUndefined();
  // The graded frame really holds HDR highlights, and the two paths agree to within a few 8-bit codes.
  expect((result as { peakNits: number }).peakNits).toBeGreaterThan(600);
  expect((result as { mean: number }).mean).toBeLessThan(1.5);
  expect((result as { max: number }).max).toBeLessThanOrEqual(8);
});
