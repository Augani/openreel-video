import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, press, readState, seek, settle, snap, undo } from "./helpers";
import { openColorGrading } from "./lumetri-basic-lib";

/** SMPTE bars (4s..6s): the first of seven bars is neutral grey. */
const BARS_TIME = 5;
const GREY_BAR = { x: 0.5 / 7, y: 0.3 };
const PROGRAM = 'canvas[aria-label^="Program frame"]';
const LAYER = "wb-eyedropper-layer";

interface E2EStores {
  project: { getState(): Record<string, any> };
}

async function grade(page: Page, clipId: string): Promise<{ temperature: number; tint: number }> {
  return page.evaluate((id) => {
    const g = (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project.getState().getClip(id)?.colorGrading ?? {};
    return { temperature: g.temperature ?? 0, tint: g.tint ?? 0 };
  }, clipId);
}

/** Mean RGB of a small window around a frame fraction of the stored snapshot. */
async function meanAt(page: Page, key: string, fx: number, fy: number): Promise<[number, number, number]> {
  return page.evaluate(
    ([k, x, y]) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k as string];
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const cx = Math.floor(c.width * (x as number));
      const cy = Math.floor(c.height * (y as number));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = cy - 4; yy <= cy + 4; yy++)
        for (let xx = cx - 4; xx <= cx + 4; xx++) {
          const i = (yy * c.width + xx) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n++;
        }
      return [r / n, g / n, b / n] as [number, number, number];
    },
    [key, fx, fy] as const,
  );
}

const spread = (rgb: number[]): number => Math.max(...rgb) - Math.min(...rgb);

export interface WbFlowResult {
  castSpread: number;
  pickedSpread: number;
  picked: { temperature: number; tint: number };
  historyDeltaForPick: number;
  undone: { temperature: number; tint: number };
  escHistoryDelta: number;
  layerGoneAfterEsc: boolean;
  layerGoneAfterPick: boolean;
  readoutSeen: boolean;
}

async function clickGreyBar(page: Page): Promise<void> {
  const box = await page.locator(PROGRAM).boundingBox();
  if (!box) throw new Error("no Program canvas box");
  await page.mouse.click(box.x + box.width * GREY_BAR.x, box.y + box.height * GREY_BAR.y);
}

/**
 * Cast the grey bar with Temperature / Tint, pick it with the eyedropper, check
 * the sliders neutralise it as ONE undo step, and that Esc cancels cleanly.
 */
export async function runWbEyedropperFlow(page: Page): Promise<WbFlowResult> {
  await openEditor(page);
  await seek(page, BARS_TIME);
  const [clip] = clipsOf(await readState(page), "Main");
  await openColorGrading(page, clip.id);

  await page.evaluate(async (id) => {
    await (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project
      .getState()
      .updateColorGrading(id, { temperature: 45, tint: 18 });
  }, clip.id);
  await settle(page, 900);
  await snap(page, "cast");
  const castSpread = spread(await meanAt(page, "cast", GREY_BAR.x, GREY_BAR.y));

  // Esc cancels: layer disappears and nothing is written.
  const eyedropper = page.getByRole("button", { name: "White balance eyedropper", exact: true });
  await eyedropper.click();
  await page.getByTestId(LAYER).waitFor();
  const historyBeforeEsc = (await readState(page)).historyLength;
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(LAYER)).toHaveCount(0);
  const escHistoryDelta = (await readState(page)).historyLength - historyBeforeEsc;
  expect(await grade(page, clip.id)).toEqual({ temperature: 45, tint: 18 });

  // Arm again, hover for the live read-out, then click the grey bar.
  await eyedropper.click();
  await page.getByTestId(LAYER).waitFor();
  const box = await page.locator(PROGRAM).boundingBox();
  if (!box) throw new Error("no Program canvas box");
  await page.mouse.move(box.x + box.width * GREY_BAR.x, box.y + box.height * GREY_BAR.y, { steps: 4 });
  const readoutSeen = await page
    .getByTestId("wb-eyedropper-readout")
    .waitFor({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  const historyBefore = (await readState(page)).historyLength;
  await clickGreyBar(page);
  await expect(page.getByTestId(LAYER)).toHaveCount(0);
  await settle(page, 1000);
  const historyDeltaForPick = (await readState(page)).historyLength - historyBefore;
  const picked = await grade(page, clip.id);
  await snap(page, "picked");
  const pickedSpread = spread(await meanAt(page, "picked", GREY_BAR.x, GREY_BAR.y));

  await press(page, "Escape");
  await undo(page);
  await settle(page, 700);
  const undone = await grade(page, clip.id);

  return {
    castSpread,
    pickedSpread,
    picked,
    historyDeltaForPick,
    undone,
    escHistoryDelta,
    layerGoneAfterEsc: true,
    layerGoneAfterPick: true,
    readoutSeen,
  };
}

export function expectWbFlow(r: WbFlowResult): void {
  // The cast was visible, the pick removed the slider cast (the grey source needs 0/0) in one undo step.
  expect(r.castSpread).toBeGreaterThan(25);
  expect(Math.abs(r.picked.temperature)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.picked.tint)).toBeLessThanOrEqual(1);
  expect(r.pickedSpread).toBeLessThan(3);
  expect(r.historyDeltaForPick).toBe(1);
  expect(r.escHistoryDelta).toBe(0);
  expect(r.undone).toEqual({ temperature: 45, tint: 18 });
  expect(r.readoutSeen).toBe(true);
}

// ---------------------------------------------------------------------------------------------------------------
// Real footage with a real colour cast and later grade stages (the case the SMPTE grey bar cannot cover).
// ---------------------------------------------------------------------------------------------------------------

interface Patch {
  fx: number;
  fy: number;
  spread: number;
}

/** A flat, near-neutral mid-tone 9x9 patch with a slight tint of its own (the interview's wall), from the stored snapshot. */
async function findNeutralPatch(page: Page, key: string): Promise<Patch> {
  return page.evaluate((k) => {
    const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k];
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    let best: Patch | null = null;
    let bestScore = Infinity;
    for (let cy = Math.floor(c.height * 0.12); cy < c.height * 0.88; cy += 6) {
      for (let cx = Math.floor(c.width * 0.08); cx < c.width * 0.92; cx += 6) {
        let r = 0;
        let g = 0;
        let b = 0;
        let lumaSq = 0;
        let luma = 0;
        let n = 0;
        for (let yy = cy - 4; yy <= cy + 4; yy++)
          for (let xx = cx - 4; xx <= cx + 4; xx++) {
            const i = (yy * c.width + xx) * 4;
            r += d[i];
            g += d[i + 1];
            b += d[i + 2];
            const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            luma += l;
            lumaSq += l * l;
            n++;
          }
        const mean = luma / n;
        const std = Math.sqrt(Math.max(0, lumaSq / n - mean * mean));
        const rgb = [r / n, g / n, b / n];
        const spread = Math.max(...rgb) - Math.min(...rgb);
        // Mid-tones only (no clipped or near-black pixels) and flat enough to sample reliably.
        if (mean < 80 || mean > 190 || std > 5 || spread < 8 || spread > 40) continue;
        // Near-neutral but with a real tint of its own, so the pick has to find nonzero values.
        const score = Math.abs(spread - 16);
        if (score < bestScore) {
          bestScore = score;
          best = { fx: cx / c.width, fy: cy / c.height, spread };
        }
      }
    }
    if (!best) throw new Error("no flat mid-tone patch found in the footage");
    return best;
  }, key);
}

export interface RealFootageResult {
  pipeline: number;
  patchSpreadUngraded: number;
  castSpread: number;
  pickedSpread: number;
  picked: { temperature: number; tint: number };
  historyDelta: number;
  undone: { temperature: number; tint: number };
  inputFrameModeSeen: string | null;
}

/**
 * Real footage with a slider cast PLUS a later grade stage. On a version 2 clip white balance runs first and the
 * contrast stage after it, so the picked patch must come out neutral on the Program monitor only if the pick
 * sampled the white balance stage input, not the displayed (contrast-graded) pixel.
 */
export async function runWbRealFootageFlow(
  page: Page,
  pipelineVersion: 1 | 2,
  openFootage: (page: Page) => Promise<{ id: string }>,
): Promise<RealFootageResult> {
  const clip = await openFootage(page);
  await seek(page, 1);
  await settle(page, 1200);
  await openColorGrading(page, clip.id);
  const setGrade = (patch: Record<string, unknown>) =>
    page.evaluate(
      async ([id, p]) => {
        await (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project
          .getState()
          .updateColorGrading(id as string, p as Record<string, unknown>);
      },
      [clip.id, patch] as const,
    );

  await setGrade({ pipelineVersion, temperature: 0, tint: 0, tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } });
  await settle(page, 900);
  await snap(page, "raw");
  const patch = await findNeutralPatch(page, "raw");

  // A real cast (sliders) and a later stage that would fool a pick of the displayed pixel.
  await setGrade({ temperature: 40, tint: 10, tone: { exposure: 0, contrast: 60, highlights: 0, shadows: 0, whites: 0, blacks: 0 } });
  await settle(page, 1000);
  await snap(page, "cast");
  const castSpread = spread(await meanAt(page, "cast", patch.fx, patch.fy));

  await page.getByRole("button", { name: "White balance eyedropper", exact: true }).click();
  const layer = page.getByTestId(LAYER);
  await layer.waitFor();
  // Armed hint must not squeeze the sample-size control (the 5x5 label was clipped to "5x").
  const sizeGroup = page.getByRole("group", { name: "White balance sample size" });
  for (const label of ["Point", "5×5"]) {
    const clipped = await sizeGroup.getByRole("button", { name: new RegExp(label === "Point" ? "Point" : "5") }).evaluate((el) => el.scrollWidth > el.clientWidth + 0.5);
    expect(clipped, `${label} label is clipped`).toBe(false);
  }
  await expect(sizeGroup).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), "wb-armed.png") });
  const box = await page.locator(PROGRAM).boundingBox();
  if (!box) throw new Error("no Program canvas box");
  const x = box.x + box.width * patch.fx;
  const y = box.y + box.height * patch.fy;
  await page.mouse.move(x, y, { steps: 4 });
  // v2 with later stages renders the stage input once (transient) before the read-out can be exact.
  await expect(layer).toHaveAttribute("data-input-frame", /ready|live/, { timeout: 15_000 });
  await page.mouse.move(x + 1, y + 1, { steps: 2 });
  await page.getByTestId("wb-eyedropper-readout").waitFor({ timeout: 5000 });
  const inputFrameModeSeen = await layer.getAttribute("data-input-frame");

  const historyBefore = (await readState(page)).historyLength;
  await page.mouse.click(x, y);
  await expect(page.getByTestId(LAYER)).toHaveCount(0);
  await settle(page, 1200);
  const historyDelta = (await readState(page)).historyLength - historyBefore;
  const picked = await grade(page, clip.id);
  await snap(page, "picked");
  const pickedSpread = spread(await meanAt(page, "picked", patch.fx, patch.fy));

  // The transient render must never leak: the stored grade is intact and the monitor shows the full grade.
  const stored = await page.evaluate(
    (id) => (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project.getState().getClip(id)?.colorGrading?.tone?.contrast,
    clip.id,
  );
  expect(stored).toBe(60);

  await undo(page);
  await settle(page, 800);
  const undone = await grade(page, clip.id);
  return {
    pipeline: pipelineVersion,
    patchSpreadUngraded: patch.spread,
    castSpread,
    pickedSpread,
    picked,
    historyDelta,
    undone,
    inputFrameModeSeen,
  };
}

export function expectRealFootage(r: RealFootageResult): void {
  expect(r.castSpread).toBeGreaterThan(r.patchSpreadUngraded + 20);
  // Nonzero values: the footage's own cast has to be corrected, not just the slider cast removed.
  expect(Math.abs(r.picked.temperature) + Math.abs(r.picked.tint)).toBeGreaterThan(3);
  // Contrast 60 amplifies the 8-bit / 0.1-slider residue; sampling the displayed pixel leaves ~27 here.
  expect(r.pickedSpread).toBeLessThan(Math.min(9, r.patchSpreadUngraded * 0.6));
  expect(r.historyDelta).toBe(1);
  expect(r.undone).toEqual({ temperature: 40, tint: 10 });
  expect(r.inputFrameModeSeen).toBe("ready");
}
