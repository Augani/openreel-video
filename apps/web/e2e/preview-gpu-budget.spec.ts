import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, programMean, readState, seek, settle } from "./helpers";

/**
 * GPU budget of the effect-preview pipeline (root cause of "GPU device lost ... Program goes black"): the previews used to
 * build engines (a WebGL2 context each) per panel mount and never give the contexts back, so a few panel switches passed
 * Chrome's ~16 live WebGL contexts and the browser force-lost the oldest. Now every preview engine leases one bounded
 * shared set, and a Program-monitor device loss recovers.
 */

/** Console messages that mean a GPU resource was lost (the repro's symptoms). */
const LOSS_PATTERN = /context lost|device lost|CONTEXT_LOST|Too many active WebGL|Failed to create WebGPU Context Provider|No GPU adapter|Failed to recover GPU/i;

interface Probe {
  lost: string[];
  /** WebGL contexts the page created / lost (counted at the getContext boundary, independent of the app's own counters). */
  gl: () => Promise<{ created: number; lostEvents: number; live: number }>;
}

async function installProbe(page: Page): Promise<Probe> {
  const lost: string[] = [];
  page.on("console", (message) => {
    if (LOSS_PATTERN.test(message.text())) lost.push(`[${message.type()}] ${message.text().slice(0, 200)}`);
  });
  await page.addInitScript(() => {
    const stats = { created: 0, lostEvents: 0 };
    (window as unknown as { __glProbe: typeof stats }).__glProbe = stats;
    const wrap = (proto: { getContext: (...args: unknown[]) => unknown }) => {
      const original = proto.getContext;
      proto.getContext = function (this: { addEventListener?: (type: string, cb: () => void) => void }, type: unknown, ...rest: unknown[]) {
        const ctx = original.call(this, type, ...rest);
        if (ctx && typeof type === "string" && type.startsWith("webgl") && !(ctx as { __probed?: boolean }).__probed) {
          (ctx as { __probed?: boolean }).__probed = true;
          stats.created++;
          this.addEventListener?.("webglcontextlost", () => {
            stats.lostEvents++;
          });
        }
        return ctx;
      } as typeof proto.getContext;
    };
    wrap(HTMLCanvasElement.prototype as never);
    wrap(OffscreenCanvas.prototype as never);
  });
  return {
    lost,
    gl: () =>
      page.evaluate(() => {
        const s = (window as unknown as { __glProbe: { created: number; lostEvents: number } }).__glProbe;
        return { created: s.created, lostEvents: s.lostEvents, live: s.created - s.lostEvents };
      }),
  };
}

const previewGpu = (page: Page) =>
  page.evaluate(() => {
    const hook = (window as unknown as { __openreelE2E: { previewGpu: () => { live: boolean; leases: number; lanes: number; shaderRenderers: number; builds: number; disposals: number; gl: { live: number } } } }).__openreelE2E;
    return hook.previewGpu();
  });

/** Mean colour of the Program canvas must be clearly not black (three-scenes at 2.5 s is solid red). */
async function expectProgramLit(page: Page, what: string): Promise<void> {
  await expect
    .poll(async () => {
      const [r, g, b] = await programMean(page);
      return r + g + b;
    }, { message: `Program is non-black ${what}`, timeout: 15_000 })
    .toBeGreaterThan(60);
}

const requestSection = (page: Page, section: string, clipId: string) =>
  page.evaluate(([s, id]) => (window as unknown as { __openreelE2E: { inspectorNav: { getState: () => { requestSection: (a: string, b: string) => void } } } }).__openreelE2E.inspectorNav.getState().requestSection(s, id), [section, clipId]);

async function visitPreviewSections(page: Page, clipId: string): Promise<string[]> {
  const visited: string[] = [];
  const mark = (name: string) => visited.push(name);

  await page.getByRole("button", { name: "Effects", exact: true }).first().click();
  await expect(page.locator('button[aria-label^="Black & white. Drag"] canvas')).toBeVisible();
  mark("effects");

  await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
  const push = page.locator('button[aria-label^="Push. Drag"]').first();
  await push.scrollIntoViewIfNeeded();
  await push.hover();
  await expect(push.locator("canvas")).toBeVisible();
  await page.mouse.move(5, 5);
  mark("transitions");

  await clickClip(page, clipId);
  await page.getByRole("tab", { name: "Color", exact: true }).click();
  const looks = page.getByRole("button", { name: "Looks and LUTs", exact: true }).first();
  await expect(page.getByRole("tabpanel", { name: "Color" })).toBeVisible();
  if (!(await looks.isVisible())) await page.getByRole("button", { name: "Expand Color Grading section" }).first().click();
  await expect(looks).toBeVisible();
  const cinematic = page.getByRole("tabpanel", { name: "Cinematic" });
  // The section opens by default and remembers its state between visits: it only needs a click when the category panel
  // still has not shown after its (lazy) content had time to mount.
  const alreadyOpen = await cinematic.waitFor({ state: "visible", timeout: 4_000 }).then(() => true, () => false);
  if (!alreadyOpen) {
    await looks.click();
    await expect(cinematic).toBeVisible({ timeout: 15_000 });
  }
  await page.getByTestId("looks-compare").click();
  await page.getByTestId("looks-compare").click();
  mark("color");

  for (const [section, probe] of [
    ["motion-presets", "[data-motion-preview]"],
    ["emphasis-animation", "[data-emphasis-preview]"],
    ["particle-effects", '[data-testid="particle-preset-preview"]'],
  ] as const) {
    await clickClip(page, clipId);
    await requestSection(page, section, clipId);
    await page.locator(probe).first().waitFor({ state: "visible", timeout: 15_000 });
    mark(section);
  }

  await page.getByRole("button", { name: /^Graphics/ }).first().click();
  await page.getByRole("tab", { name: "Overlays" }).click();
  await page.locator("[data-overlay-card] canvas").first().waitFor({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Templates" }).click();
  mark("graphics");
  return visited;
}

test.describe("preview GPU budget", () => {
  test.describe.configure({ mode: "serial" });

  test("opening every preview section, repeatedly, never loses a GPU resource and keeps live contexts bounded", async ({ page }) => {
    test.setTimeout(300_000);
    const probe = await installProbe(page);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await seek(page, 2.5);
    await clickClip(page, clip.id);
    await expectProgramLit(page, "before any preview opens");

    // Chrome force-loses the oldest context past ~16; the preview set must stay far below that however often it is opened.
    const BOUND = 8;
    let peakLive = 0;
    let peakEngineLive = 0;
    for (let round = 0; round < 4; round++) {
      const visited = await visitPreviewSections(page, clip.id);
      expect(visited, "every preview section opened").toEqual(["effects", "transitions", "color", "motion-presets", "emphasis-animation", "particle-effects", "graphics"]);
      const gl = await probe.gl();
      const gpu = await previewGpu(page);
      peakLive = Math.max(peakLive, gl.live);
      peakEngineLive = Math.max(peakEngineLive, gpu.gl.live);
      expect(gpu.lanes, "shared preview lanes are bounded").toBeLessThanOrEqual(2);
      expect(gpu.shaderRenderers, "shader renderers are bounded").toBeLessThanOrEqual(2);
      expect(gl.live, `live WebGL contexts after round ${round}`).toBeLessThanOrEqual(BOUND);
      expect(gpu.gl.live, `engine-owned live contexts after round ${round}`).toBeLessThanOrEqual(BOUND);
    }
    await expectProgramLit(page, "after every preview section was opened four times");

    // Panel churn: every switch used to leave its engines' contexts behind (two per cycle), so ~8 cycles passed Chrome's limit.
    for (let cycle = 0; cycle < 14; cycle++) {
      await page.getByRole("button", { name: "Effects", exact: true }).first().click();
      await expect(page.locator('button[aria-label^="Black & white. Drag"] canvas')).toBeVisible();
      await page.getByRole("button", { name: "Transitions", exact: true }).first().click();
      await expect(page.locator('button[aria-label^="Push. Drag"] canvas').first()).toBeVisible();
      await page.getByRole("button", { name: /^Graphics/ }).first().click();
      await page.getByRole("tab", { name: "Overlays" }).click();
      await page.locator("[data-overlay-card] canvas").first().waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Media", exact: true }).first().click();
      const gl = await probe.gl();
      peakLive = Math.max(peakLive, gl.live);
      expect(gl.live, `live WebGL contexts after panel cycle ${cycle}`).toBeLessThanOrEqual(BOUND);
    }

    // Leaving the previews hands every context back (the shared set disposes after its idle grace).
    // (The inspector's own previews live as long as a clip is selected, so deselect too.)
    await page.getByRole("button", { name: "Media", exact: true }).first().click();
    await page.evaluate(() => (window as unknown as { __openreelE2E: { ui: { getState: () => { clearSelection: () => void } } } }).__openreelE2E.ui.getState().clearSelection());
    await expect.poll(async () => (await previewGpu(page)).live, { timeout: 15_000 }).toBe(false);
    await expect.poll(async () => (await previewGpu(page)).gl.live, { timeout: 15_000 }).toBe(0);

    // ... and opening them again builds a fresh bounded set, not an extra one.
    const before = await probe.gl();
    await visitPreviewSections(page, clip.id);
    const after = await probe.gl();
    expect(after.live).toBeLessThanOrEqual(BOUND);
    expect(after.created - before.created, "a second cold open creates one set of contexts").toBeLessThanOrEqual(BOUND);

    await settle(page, 1000);
    await expectProgramLit(page, "after the cold re-open");
    expect(probe.lost, "no context / device lost messages in the console").toEqual([]);
    expect(peakLive).toBeLessThanOrEqual(BOUND);
    expect(peakEngineLive).toBeLessThanOrEqual(BOUND);
  });

  test("a Program GPU device loss recovers: the monitor repaints and the preview cards re-render", async ({ page }) => {
    test.setTimeout(180_000);
    const probe = await installProbe(page);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await seek(page, 2.5);
    await clickClip(page, clip.id);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await expect(page.locator('button[aria-label^="Black & white. Drag"] canvas')).toBeVisible();
    await expectProgramLit(page, "before the loss");

    const rendersBefore = await page.evaluate(() => (window as unknown as { __openreelE2E: { effectPreviews: () => { stats: { rendersStarted: number } } } }).__openreelE2E.effectPreviews().stats.rendersStarted);
    const type = await page.evaluate(() => (window as unknown as { __openreelE2E: { program: { rendererType: () => string | null } } }).__openreelE2E.program.rendererType());
    test.skip(type !== "webgpu", "needs a WebGPU Program renderer (the fallback projects have no device to lose)");

    // 1) the device is destroyed under the monitor; recovery rebuilds it on the same canvas.
    expect(await page.evaluate(() => (window as unknown as { __openreelE2E: { program: { loseDevice: () => boolean } } }).__openreelE2E.program.loseDevice())).toBe(true);
    await expectProgramLit(page, "after a recovered device loss");
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __openreelE2E: { effectPreviews: () => { stats: { rendersStarted: number } } } }).__openreelE2E.effectPreviews().stats.rendersStarted), { timeout: 20_000, message: "cards re-render after the loss" })
      .toBeGreaterThan(rendersBefore);
    await expect(page.locator('button[aria-label^="Black & white. Drag"] canvas')).toHaveAttribute("data-preview-state", /.+/);

    // 2) the device is lost AND cannot be recreated: the canvas element + renderer are replaced by a Canvas2D pair.
    const canvasBefore = await page.evaluate(() => {
      const c = document.querySelector('canvas[aria-label^="Program"]') as HTMLCanvasElement & { __e2eMark?: number };
      c.__e2eMark = 1;
      return true;
    });
    expect(canvasBefore).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __openreelE2E: { program: { loseDevice: (o: { failRecovery: boolean }) => boolean } } }).__openreelE2E.program.loseDevice({ failRecovery: true }))).toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __openreelE2E: { program: { rendererType: () => string | null } } }).__openreelE2E.program.rendererType()), { timeout: 20_000 })
      .toBe("canvas2d");
    expect(
      await page.evaluate(() => (document.querySelector('canvas[aria-label^="Program"]') as (HTMLCanvasElement & { __e2eMark?: number }) | null)?.__e2eMark ?? 0),
      "the Program canvas element was replaced",
    ).toBe(0);
    await expectProgramLit(page, "after falling back to Canvas2D");

    // The monitor keeps working afterwards: a seek paints the new frame.
    await seek(page, 0.5);
    await expectProgramLit(page, "after a seek on the fallback canvas");
    await settle(page, 500);
  });
});
