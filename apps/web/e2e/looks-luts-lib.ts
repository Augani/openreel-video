import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { clickClip, clipsOf, importInput, openEditor, programMean, readState, seek, settle } from "./helpers";

/**
 * Looks and LUTs (Color tab): every built-in look, imported LUT, saved look and white balance preset shows its
 * real result on the footage under the playhead, rendered by the engines "apply" uses. Shared by the gpu project
 * (looks-luts.spec.ts) and the fallback projects (fallback-looks-luts.spec.ts).
 *
 * The real-footage tests always run: they use a committed 3 s cut of stock footage (fixtures/real-interview.mp4,
 * see its CREDITS file). OPENREEL_LOOKS_FOOTAGE=<video file> swaps in other footage for the screenshot pass.
 */
const REAL_FOOTAGE = process.env.OPENREEL_LOOKS_FOOTAGE ?? join(dirname(fileURLToPath(import.meta.url)), "fixtures", "real-interview.mp4");

const SHOTS = process.env.OPENREEL_LOOKS_SHOTS ?? join(tmpdir(), "polish-b", "looks-luts");

interface CardRead {
  state: string | undefined;
  source: string | undefined;
  frame: string | undefined;
  /** Source time (s) of the frame the poster shows; set once the poster for the current footage is drawn. */
  time: number | undefined;
  width: number;
  height: number;
  mean: [number, number, number];
  saturation: number;
  signature: number[];
}

const cardSelector = (ariaLabel: string) => `button[aria-label="${ariaLabel}"] canvas`;

async function readCard(page: Page, ariaLabel: string, selector = cardSelector(ariaLabel)): Promise<CardRead> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
    if (!canvas) throw new Error(`no preview canvas for ${selector}`);
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let sat = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      sat += max === 0 ? 0 : (max - min) / max;
    }
    const sig = document.createElement("canvas");
    sig.width = 32;
    sig.height = 18;
    const sctx = sig.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    sctx.drawImage(probe, 0, 0, 32, 18);
    const small = sctx.getImageData(0, 0, 32, 18).data;
    const signature: number[] = [];
    for (let i = 0; i < small.length; i += 4) signature.push(small[i], small[i + 1], small[i + 2]);
    return {
      state: canvas.dataset.previewState,
      source: canvas.dataset.previewSource,
      frame: canvas.dataset.previewFrame,
      time: canvas.dataset.previewTime === undefined ? undefined : Number(canvas.dataset.previewTime),
      width: canvas.width,
      height: canvas.height,
      mean: [r / n, g / n, b / n] as [number, number, number],
      saturation: sat / n,
      signature,
    };
  }, selector);
}

const signatureDiff = (a: number[], b: number[]): number => {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
};

/**
 * Waits for the card's poster to be drawn for the current def and footage: the card marks itself "loading" while a
 * poster is pending and stamps the source time of the frame it drew. `atTime` (source seconds) additionally waits
 * for the preview footage to have retargeted to the playhead after a seek, which is debounced.
 */
async function waitForPoster(page: Page, ariaLabel: string, atTime?: number): Promise<CardRead> {
  const canvas = page.locator(cardSelector(ariaLabel)).first();
  await canvas.scrollIntoViewIfNeeded();
  // A card under the pointer loops its footage window on hover: a read taken then is some frame of the loop, not the
  // poster at the playhead the monitor shows. A card slides under the pointer whenever the list re-lays out (an
  // imported LUT, a click that leaves the pointer on a card), which is common on a slow runner where playback
  // starts before the read. Park the pointer and only accept a resting poster.
  await page.mouse.move(5, 5);
  await expect
    .poll(
      async () => {
        const read = await readCard(page, ariaLabel);
        if (read.state !== "poster") return false;
        return atTime === undefined || (read.time !== undefined && Math.abs(read.time - atTime) < 0.15);
      },
      { timeout: 45_000, message: `poster for ${ariaLabel}${atTime === undefined ? "" : ` at ${atTime}s`}` },
    )
    .toBe(true);
  return readCard(page, ariaLabel);
}

const rgbSaturation = ([r, g, b]: [number, number, number]): number => {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};

async function openLooksAndLuts(page: Page, clipId: string): Promise<void> {
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: "Color", exact: true }).click();
  await settle(page, 400);
  const group = page.getByRole("tabpanel", { name: "Cinematic" });
  const section = page.getByRole("button", { name: "Looks and LUTs", exact: true }).first();
  if (!(await section.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Expand Color Grading section" }).first().click();
    await settle(page, 300);
  }
  if (!(await group.isVisible().catch(() => false))) await section.click();
  await group.waitFor({ timeout: 15_000 });
}

/** A 2-point .cube that swaps the red and blue channels. */
function writeSwapLut(): string {
  const rows: string[] = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
  const dir = join(tmpdir(), "openreel-looks-e2e");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "swap-rb.cube");
  writeFileSync(path, `TITLE "swap-rb"\nLUT_3D_SIZE 2\n${rows.join("\n")}\n`);
  return path;
}

/** A 2-point .cube that inverts every channel: a strong LUT, so its strength is easy to see on any footage. */
function writeInvertLut(): string {
  const rows: string[] = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${1 - r} ${1 - g} ${1 - b}`);
  const dir = join(tmpdir(), "openreel-looks-e2e");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "invert-rgb.cube");
  writeFileSync(path, `TITLE "invert-rgb"\nLUT_3D_SIZE 2\n${rows.join("\n")}\n`);
  return path;
}

/** Waits until no toast is on screen, so a screenshot shows the panel and not a notification over it. */
async function waitForToastsGone(page: Page): Promise<void> {
  await expect(page.getByRole("region", { name: "Notifications" }).locator('[role="status"], [role="alert"]')).toHaveCount(0, { timeout: 15_000 });
}

const programSaturation = async (page: Page): Promise<number> => rgbSaturation(await programMean(page));

const PROGRAM_CANVAS = 'canvas[aria-label^="Program frame"]';

/** 32x18 RGB thumbnail of the program monitor, comparable with a card's `signature`. */
async function programSignature(page: Page): Promise<number[]> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    const sig = document.createElement("canvas");
    sig.width = 32;
    sig.height = 18;
    const ctx = sig.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0, 32, 18);
    const small = ctx.getImageData(0, 0, 32, 18).data;
    const out: number[] = [];
    for (let i = 0; i < small.length; i += 4) out.push(small[i], small[i + 1], small[i + 2]);
    return out;
  }, PROGRAM_CANVAS);
}

/** Opens the editor with real footage (a person, skin tones, shallow depth of field) as the only clip. */
export async function openRealFootage(page: Page, file = REAL_FOOTAGE): Promise<{ id: string }> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator(PROGRAM_CANVAS).waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(file);
  await page.getByLabel(`Select media ${basename(file)}`).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: `Media actions for ${basename(file)}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
  const [clip] = clipsOf(await readState(page), "Main");
  return clip;
}

type E2EProject = { __openreelE2E: { project: { getState(): Record<string, (...args: unknown[]) => Promise<unknown>> } } };
const storeCall = (page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(([name, rest]) => (window as unknown as E2EProject).__openreelE2E.project.getState()[name as string](...(rest as unknown[])), [method, args] as const);

export function registerLooksLutsTests(): void {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  test("Looks, LUTs, saved looks and white balance show their real result on the footage", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const project = testInfo.project.name;
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    // three-scenes.mp4: 0-2 s testsrc2 (colour bars, moving), 2-4 s solid red, 4-6 s SMPTE bars.
    await seek(page, 2.5);
    await openLooksAndLuts(page, clip.id);
    const source = await programMean(page);
    expect(source[0], "the red scene is on the monitor").toBeGreaterThan(150);

    // ── tabs and cards: labelled, no raw effect ids, nothing selected before anything is applied ───────────
    for (const name of ["Cinematic", "Vintage", "Mood", "Color", "Stylized"]) {
      await expect(page.getByTestId("filter-looks-panel").getByRole("tab", { name, exact: true })).toBeVisible();
    }
    // The category row never clips a tab: every tab sits inside the row, which does not scroll sideways.
    const row = await page.getByRole("tablist", { name: "Look categories" }).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((tab) => {
        const r = tab.getBoundingClientRect();
        return { left: r.left - box.left, right: box.right - r.right };
      });
      return { overflow: el.scrollWidth - el.clientWidth, tabs };
    });
    expect(row.overflow, "the tab row has nothing hidden to scroll to").toBeLessThanOrEqual(0);
    for (const tab of row.tabs) {
      expect(tab.left).toBeGreaterThanOrEqual(-0.5);
      expect(tab.right).toBeGreaterThanOrEqual(-0.5);
    }
    const group = page.getByRole("tabpanel", { name: "Cinematic" });
    const groupText = (await group.textContent()) ?? "";
    expect(groupText).not.toMatch(/\b(vignette|color-grade|saturation|brightness|grain)\b/);
    expect(groupText).toContain("Contrast, Saturation, Vignette");
    await expect(page.locator('[data-testid="looks-and-luts"] button[aria-pressed="true"]')).toHaveCount(0);

    // ── a look card is the footage graded by the look, not a decoration ────────────────────────────────────
    const noir = await waitForPoster(page, "Apply Film Noir filter preset");
    expect(noir.source, "poster comes from the decoded footage").toBe("footage");
    expect(noir.width).toBeGreaterThanOrEqual(192);
    expect(noir.saturation, "Film Noir is black and white").toBeLessThan(0.15);
    const teal = await waitForPoster(page, "Apply Teal & Orange filter preset");
    expect(teal.saturation, "Teal & Orange keeps the red footage saturated").toBeGreaterThan(0.6);
    expect(signatureDiff(noir.signature, teal.signature), "different looks render differently").toBeGreaterThan(20);
    await page.getByRole("tab", { name: "Stylized", exact: true }).click();
    const matrix = await waitForPoster(page, "Apply Matrix filter preset");
    expect(matrix.mean[1], "Matrix shifts the red footage towards green").toBeGreaterThan(matrix.mean[0]);
    await page.screenshot({ path: `${SHOTS}/${project}-looks-stylized.png` });
    await page.getByRole("tab", { name: "Cinematic", exact: true }).click();

    // ── apply: exactly the clicked look is marked, and the program monitor shows what the card showed ──────
    await waitForPoster(page, "Apply Film Noir filter preset");
    await page.getByRole("button", { name: "Apply Film Noir filter preset" }).click();
    await expect(page.locator('[data-testid="looks-and-luts"] button[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Apply Film Noir filter preset" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => programSaturation(page), { timeout: 15_000 }).toBeLessThan(0.2);
    await page.getByRole("button", { name: "Remove All Effects" }).click();
    await expect.poll(() => programSaturation(page), { timeout: 15_000 }).toBeGreaterThan(0.8);
    await expect(page.locator('[data-testid="looks-and-luts"] button[aria-pressed="true"]')).toHaveCount(0);

    // ── imported LUT: the card is the footage through the LUT; applying it gives the same on the monitor ───
    await page.locator('input[aria-label="Import LUT files"]').setInputFiles(writeSwapLut());
    const lutLabel = "Apply swap-rb as creative LUT";
    const lut = await waitForPoster(page, lutLabel);
    expect(lut.source).toBe("footage");
    expect(lut.mean[2], "swap-rb turns the red footage blue").toBeGreaterThan(150);
    expect(lut.mean[0]).toBeLessThan(60);
    await page.screenshot({ path: `${SHOTS}/${project}-luts.png` });
    await page.getByRole("button", { name: lutLabel }).click();
    await expect.poll(async () => (await programMean(page))[2], { timeout: 15_000 }).toBeGreaterThan(150);
    await expect(page.getByRole("button", { name: lutLabel })).toHaveAttribute("aria-pressed", "true");

    // ── saved look: store the grade, its card shows the stored grade on the footage ─────────────────────────
    await page.evaluate((id) => {
      const w = window as unknown as { __openreelE2E: { project: { getState(): { updateColorGrading(id: string, g: unknown): Promise<unknown> } } } };
      return w.__openreelE2E.project.getState().updateColorGrading(id, {
        pipelineVersion: 2,
        tone: { exposure: -1.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
      });
    }, clip.id);
    await page.getByLabel("Look name").fill("Dim test");
    await page.getByRole("button", { name: "Save grade as look" }).click();
    const saved = await waitForPoster(page, "Apply look Dim test to selected clips");
    expect(saved.source).toBe("footage");
    // The stored grade is the swap LUT plus -1.5 EV: blue footage, much darker than the plain LUT card.
    expect(saved.mean[2], "saved look darkens the graded footage").toBeLessThan(lut.mean[2] * 0.7);
    expect(saved.mean[2]).toBeGreaterThan(20);
    await page.screenshot({ path: `${SHOTS}/${project}-saved-looks.png` });

    // ── white balance presets are footage previews: cool vs warm differ on colourful footage ───────────────
    // Start from an ungraded clip (the grade above is the swap LUT, which would flip warm and cool).
    await page.evaluate((id) => {
      const w = window as unknown as { __openreelE2E: { project: { getState(): { resetColorGrading(id: string): Promise<unknown> } } } };
      return w.__openreelE2E.project.getState().resetColorGrading(id);
    }, clip.id);
    await seek(page, 0.5);
    // The previews retarget to the new playhead after a debounce: wait for posters drawn from 0.5 s, not the 2.5 s red scene.
    const tungsten = await waitForPoster(page, "Apply Tungsten white balance", 0.5);
    const shade = await waitForPoster(page, "Apply Shade white balance", 0.5);
    expect(tungsten.mean[2] - tungsten.mean[0], "Tungsten is cooler than Shade").toBeGreaterThan(shade.mean[2] - shade.mean[0] + 8);
    await page.getByRole("button", { name: "Apply Tungsten white balance" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${project}-white-balance.png` });

    // ── hover plays the look on the moving footage, leaving returns to the poster ──────────────────────────
    await page.getByRole("button", { name: "Looks and LUTs", exact: true }).first().scrollIntoViewIfNeeded();
    const noirLabel = "Apply Film Noir filter preset";
    await waitForPoster(page, noirLabel);
    await page.getByRole("button", { name: noirLabel }).hover();
    await expect
      .poll(async () => (await readCard(page, noirLabel)).state, { timeout: 30_000, message: "hover starts playback" })
      .toBe("playing");
    const frames = new Set<string | undefined>();
    for (let i = 0; i < 12; i++) {
      const read = await readCard(page, noirLabel);
      frames.add(read.frame);
      expect(read.saturation, "every played frame is graded").toBeLessThan(0.2);
      await page.waitForTimeout(120);
    }
    expect(frames.size, "hover shows successive frames").toBeGreaterThanOrEqual(3);
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await readCard(page, noirLabel)).state, { timeout: 5_000 }).toBe("poster");
  });

  test("keyboard focus plays a look and drag/apply semantics are unchanged", async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await seek(page, 0.5);
    await openLooksAndLuts(page, clip.id);
    const label = "Apply Film Noir filter preset";
    await waitForPoster(page, label);
    await page.getByRole("button", { name: label }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect
      .poll(async () => (await readCard(page, label)).state, { timeout: 30_000, message: "keyboard focus starts playback" })
      .toBe("playing");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    // ARIA tabs: arrow keys move between categories (roving tabindex), the panel follows.
    const cinematicTab = page.getByRole("tab", { name: "Cinematic", exact: true });
    await cinematicTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Vintage", exact: true })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Vintage" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tabpanel", { name: "Cinematic" })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Apply Blockbuster filter preset" }).hover();
    await page.waitForTimeout(900);
    expect((await readCard(page, "Apply Blockbuster filter preset")).state, "reduced motion keeps the poster").toBe("poster");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("white balance and LUT cards render on top of the clip's current grade", async ({ page }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    const [clip] = clipsOf(await readState(page), "Main");
    await seek(page, 0.5);
    await openLooksAndLuts(page, clip.id);
    const label = "Apply Tungsten white balance";
    const plain = await waitForPoster(page, label);
    const plainLevel = plain.mean[0] + plain.mean[1] + plain.mean[2];
    // The clip already carries a -1.5 EV grade: the card must show applying the preset on top of it.
    await page.evaluate((id) => {
      const w = window as unknown as { __openreelE2E: { project: { getState(): { updateColorGrading(id: string, g: unknown): Promise<unknown> } } } };
      return w.__openreelE2E.project.getState().updateColorGrading(id, {
        tone: { exposure: -1.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
      });
    }, clip.id);
    await expect
      .poll(
        async () => {
          // The inspector re-lays out when the grade changes: keep the card in view so its poster is requested.
          await page.locator(cardSelector(label)).first().scrollIntoViewIfNeeded();
          const read = await readCard(page, label);
          return (read.mean[0] + read.mean[1] + read.mean[2]) / plainLevel;
        },
        { timeout: 30_000, message: "the card follows the clip's current grade" },
      )
      .toBeLessThan(0.75);
    await expect(page.getByTestId("lut-preview-note")).toHaveCount(0);
  });


  test("cards are pixel-identical to what apply renders, on real footage, over the clip's own effects and grade", async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    mkdirSync(SHOTS, { recursive: true });
    const project = testInfo.project.name;
    const clip = await openRealFootage(page);
    await seek(page, 1);
    await openLooksAndLuts(page, clip.id);
    await page.locator('input[aria-label="Import LUT files"]').setInputFiles(writeSwapLut());
    const PARITY = 7;

    // Waits for the program monitor to show the card's picture (apply is async), then returns how far apart they are.
    const parity = async (card: CardRead): Promise<number> => {
      let diff = Infinity;
      await expect
        .poll(
          async () => {
            diff = signatureDiff(card.signature, await programSignature(page));
            return diff;
          },
          { timeout: 20_000, message: "the program monitor shows what the card showed" },
        )
        .toBeLessThan(PARITY);
      return diff;
    };
    const applyAndCompare = async (label: string, name: string, differsFromMonitor = true): Promise<{ card: CardRead; raw: number[] }> => {
      const raw = await programSignature(page);
      const card = await waitForPoster(page, label);
      expect(card.source, `${name}: the card is the decoded footage`).toBe("footage");
      // The monitor is the reference only while it shows the clip as the card started from (the graded case is checked against the ungraded card).
      if (differsFromMonitor) expect(signatureDiff(card.signature, raw), `${name}: the card differs from the frame on the monitor`).toBeGreaterThan(PARITY * 1.5);
      await page.getByRole("button", { name: label }).click();
      await parity(card);
      return { card, raw };
    };

    // 1) a preset on an ungraded clip
    const tealLabel = "Apply Teal & Orange filter preset";
    await applyAndCompare(tealLabel, "Teal & Orange");
    await page.screenshot({ path: `${SHOTS}/${project}-parity-preset.png` });
    await page.getByRole("button", { name: "Remove All Effects" }).click();

    // 2) the same preset on a clip that already has a grade: the card includes the grade, the apply keeps it
    const plainTeal = await waitForPoster(page, tealLabel);
    await storeCall(page, "updateColorGrading", clip.id, {
      tone: { exposure: -1.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    });
    await expect
      .poll(async () => {
        await page.locator(cardSelector(tealLabel)).first().scrollIntoViewIfNeeded();
        const read = await readCard(page, tealLabel);
        return (read.mean[0] + read.mean[1] + read.mean[2]) / (plainTeal.mean[0] + plainTeal.mean[1] + plainTeal.mean[2]);
      }, { timeout: 30_000, message: "the preset card follows the clip's grade" })
      .toBeLessThan(0.7);
    const graded = await applyAndCompare(tealLabel, "Teal & Orange on a graded clip", false);
    await page.screenshot({ path: `${SHOTS}/${project}-parity-preset-on-grade.png` });
    await page.getByRole("button", { name: "Remove All Effects" }).click();
    await storeCall(page, "resetColorGrading", clip.id);
    expect(graded.card.mean[0]).toBeLessThan(plainTeal.mean[0] * 0.7);

    // 3) a LUT on a clip that already has an effect (a desaturation): the effect renders first, the LUT after it
    await storeCall(page, "replaceVideoEffects", clip.id, [
      { id: "effect-existing-desat", type: "saturation", enabled: true, params: { value: 0 }, order: 0 },
    ]);
    const lutLabel = "Apply swap-rb as creative LUT";
    await expect
      .poll(async () => {
        await page.locator(cardSelector(lutLabel)).first().scrollIntoViewIfNeeded();
        return (await readCard(page, lutLabel)).saturation;
      }, { timeout: 30_000, message: "the LUT card renders over the clip's existing desaturation" })
      .toBeLessThan(0.15);
    await expect(page.getByTestId("lut-preview-note")).toContainText("effects and grade");
    await page.screenshot({ path: `${SHOTS}/${project}-lut-on-effects.png` });
    await page.getByRole("button", { name: lutLabel }).click();
    await parity(await waitForPoster(page, lutLabel));
    expect((await programSaturation(page)), "the monitor kept the existing effect").toBeLessThan(0.15);
    await storeCall(page, "replaceVideoEffects", clip.id, []);
    await storeCall(page, "resetColorGrading", clip.id);

    // 3b) A second existing effect whose order against the LUT is visible: brightness then invert is not invert then
    // brightness (the effect adds light before the table flips it; the other way round it adds light to the flipped picture).
    await page.locator('input[aria-label="Import LUT files"]').setInputFiles(writeInvertLut());
    const invertLabel = "Apply invert-rgb as creative LUT";
    const invertPlain = await waitForPoster(page, invertLabel);
    await storeCall(page, "replaceVideoEffects", clip.id, [
      { id: "effect-existing-brightness", type: "brightness", enabled: true, params: { value: 40 }, order: 0 },
    ]);
    await expect
      .poll(async () => {
        await page.locator(cardSelector(invertLabel)).first().scrollIntoViewIfNeeded();
        return signatureDiff((await readCard(page, invertLabel)).signature, invertPlain.signature);
      }, { timeout: 30_000, message: "the invert card renders over the clip's existing brightness effect" })
      .toBeGreaterThan(15);
    const onBrightness = await waitForPoster(page, invertLabel);
    await page.getByRole("button", { name: invertLabel }).click();
    const brightDiff = await parity(onBrightness);
    expect(brightDiff, "card and monitor agree with a brightness effect under the LUT").toBeLessThan(PARITY);
    await storeCall(page, "replaceVideoEffects", clip.id, []);
    await storeCall(page, "resetColorGrading", clip.id);

    // 4) LUT strength: the card and the apply use the same strength
    await waitForPoster(page, invertLabel);
    await waitForPoster(page, invertLabel);
    await page.getByRole("button", { name: "Edit LUT strength value" }).click();
    const strength = page.getByLabel("LUT strength value");
    await strength.fill("40");
    await strength.press("Enter");
    await expect(page.getByTestId("lut-strength")).toContainText("40%");
    const half = await applyAndCompare(invertLabel, "invert-rgb at 40%");
    await waitForToastsGone(page);
    await page.getByRole("button", { name: invertLabel }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${project}-lut-strength.png` });
    await storeCall(page, "resetColorGrading", clip.id);
    await page.getByRole("button", { name: "Edit LUT strength value" }).click();
    await page.getByLabel("LUT strength value").fill("100");
    await page.getByLabel("LUT strength value").press("Enter");
    await expect
      .poll(async () => signatureDiff((await readCard(page, invertLabel)).signature, half.card.signature), { timeout: 30_000, message: "full strength differs from 40% strength" })
      .toBeGreaterThan(20);
  });

  test("before / after splits each card into the clip as it is and with the look applied", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    const project = testInfo.project.name;
    const clip = await openRealFootage(page);
    await seek(page, 1);
    await openLooksAndLuts(page, clip.id);
    const label = "Apply Film Noir filter preset";
    await waitForPoster(page, label);
    await expect(page.locator("[data-look-before]")).toHaveCount(0);
    await page.getByTestId("looks-compare").click();
    await expect(page.getByTestId("looks-compare")).toHaveAttribute("aria-pressed", "true");
    const beforeSelector = `button[aria-label="${label}"] [data-look-before] canvas`;
    await expect.poll(async () => ["poster", "playing"].includes((await readCard(page, label, beforeSelector).catch(() => ({ state: "" }) as CardRead)).state ?? ""), { timeout: 45_000 }).toBe(true);
    const beforeRead = await readCard(page, label, beforeSelector);
    const afterRead = await readCard(page, label);
    expect(signatureDiff(beforeRead.signature, await programSignature(page)), "left half is the clip as it is on the monitor").toBeLessThan(7);
    expect(afterRead.saturation, "right half is the look").toBeLessThan(0.08);
    expect(beforeRead.saturation, "left half keeps the footage colour").toBeGreaterThan(afterRead.saturation + 0.08);
    expect(signatureDiff(beforeRead.signature, afterRead.signature), "the halves differ").toBeGreaterThan(10);
    await page.getByRole("button", { name: label }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${project}-before-after.png` });

    // One switch for the whole Color tab: LUT, saved-look and white-balance cards split too, and every toggle follows.
    for (const id of ["lut-compare", "saved-compare", "wb-compare"]) await expect(page.getByTestId(id)).toHaveAttribute("aria-pressed", "true");
    await page.locator('input[aria-label="Import LUT files"]').setInputFiles(writeSwapLut());
    const lutLabel = "Apply swap-rb as creative LUT";
    await waitForPoster(page, lutLabel);
    const lutBeforeSel = `button[aria-label="${lutLabel}"] [data-look-before] canvas`;
    await expect.poll(async () => ["poster", "playing"].includes((await readCard(page, lutLabel, lutBeforeSel).catch(() => ({ state: "" }) as CardRead)).state ?? ""), { timeout: 45_000 }).toBe(true);
    const lutBefore = await readCard(page, lutLabel, lutBeforeSel);
    const lutAfter = await readCard(page, lutLabel);
    expect(signatureDiff(lutBefore.signature, await programSignature(page)), "LUT card: left half is the clip as it is").toBeLessThan(7);
    expect(signatureDiff(lutBefore.signature, lutAfter.signature), "LUT card: the halves differ").toBeGreaterThan(10);
    expect(lutAfter.mean[2] - lutAfter.mean[0], "LUT card: right half has the red and blue channels swapped").toBeGreaterThan(lutBefore.mean[2] - lutBefore.mean[0] + 10);
    await page.screenshot({ path: `${SHOTS}/${project}-before-after-lut.png` });

    const wbLabel = "Apply Tungsten white balance";
    await page.getByRole("button", { name: wbLabel }).scrollIntoViewIfNeeded();
    await waitForPoster(page, wbLabel);
    const wbBeforeSel = `button[aria-label="${wbLabel}"] [data-look-before] canvas`;
    await expect.poll(async () => ["poster", "playing"].includes((await readCard(page, wbLabel, wbBeforeSel).catch(() => ({ state: "" }) as CardRead)).state ?? ""), { timeout: 45_000 }).toBe(true);
    const wbBefore = await readCard(page, wbLabel, wbBeforeSel);
    const wbAfter = await readCard(page, wbLabel);
    expect(signatureDiff(wbBefore.signature, await programSignature(page)), "white balance card: left half is the clip as it is").toBeLessThan(7);
    expect(signatureDiff(wbBefore.signature, wbAfter.signature), "white balance card: the halves differ").toBeGreaterThan(4);
    await page.screenshot({ path: `${SHOTS}/${project}-before-after-wb.png` });

    await storeCall(page, "updateColorGrading", clip.id, { tone: { exposure: -1.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } });
    await page.getByLabel("Look name").fill("Dim test");
    await page.getByRole("button", { name: "Save grade as look" }).click();
    const savedLabel = "Apply look Dim test to selected clips";
    await waitForPoster(page, savedLabel);
    await expect(page.locator(`button[aria-label="${savedLabel}"] [data-look-before]`)).toHaveCount(1);
    await waitForToastsGone(page);
    await page.getByRole("button", { name: savedLabel }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${project}-before-after-saved.png` });

    // Any of the toggles turns every split off.
    await page.getByTestId("wb-compare").scrollIntoViewIfNeeded();
    await page.getByTestId("wb-compare").click();
    await expect(page.locator("[data-look-before]")).toHaveCount(0);
    await expect(page.getByTestId("looks-compare")).toHaveAttribute("aria-pressed", "false");
    expect(await page.locator('[data-preview-badge="sample"]').count(), "real footage never shows the Sample badge").toBe(0);
  });

  test("a clip whose footage cannot be decoded previews on the honest sample scene; an empty project shows no cards", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    const project = testInfo.project.name;
    // Empty project: the Color tab has nothing to grade and offers no look cards (nothing to preview them on).
    await page.addInitScript(() => {
      try {
        localStorage.setItem("openreel-onboarding-complete", "true");
        localStorage.setItem("openreel-mograph-tour-complete", "true");
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Horizontal/ }).click();
    await page.locator(PROGRAM_CANVAS).waitFor({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Nothing selected" })).toBeVisible();
    await expect(page.locator("[data-look-card]")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/${project}-empty-project.png` });

    // A clip whose media has lost its bytes and thumbnail: cards fall back to the bundled sample scene, labelled as such.
    const clip = await openRealFootage(page);
    await page.evaluate(() => {
      const w = window as unknown as { __openreelE2E: { project: { setState(fn: (s: { project: { mediaLibrary: { items: Array<Record<string, unknown>> } } }) => unknown): void } } };
      w.__openreelE2E.project.setState((s) => ({
        project: { ...s.project, mediaLibrary: { ...s.project.mediaLibrary, items: s.project.mediaLibrary.items.map((item) => ({ ...item, blob: undefined, thumbnailUrl: undefined })) } },
      }));
    });
    await openLooksAndLuts(page, clip.id);
    const noir = await waitForPoster(page, "Apply Film Noir filter preset");
    expect(noir.source, "no decodable footage: the sample scene, never a blank card").toBe("sample");
    expect(noir.saturation, "the look is still rendered on the sample").toBeLessThan(0.15);
    const teal = await waitForPoster(page, "Apply Teal & Orange filter preset");
    expect(teal.source).toBe("sample");
    expect(teal.saturation).toBeGreaterThan(0.2);
    // Every card that shows the sample scene says so; a card on real footage never does.
    await expect(page.getByRole("button", { name: "Apply Film Noir filter preset" }).locator('[data-preview-badge="sample"]')).toHaveText("Sample");
    await page.locator('input[aria-label="Import LUT files"]').setInputFiles(writeSwapLut());
    const sampleLut = await waitForPoster(page, "Apply swap-rb as creative LUT");
    expect(sampleLut.source).toBe("sample");
    await expect(page.getByRole("button", { name: "Apply swap-rb as creative LUT" }).locator('[data-preview-badge="sample"]')).toHaveText("Sample");
    await page.getByRole("button", { name: "Apply Tungsten white balance" }).scrollIntoViewIfNeeded();
    await waitForPoster(page, "Apply Tungsten white balance");
    await expect(page.getByRole("button", { name: "Apply Tungsten white balance" }).locator('[data-preview-badge="sample"]')).toHaveText("Sample");
    for (const name of ["Fluorescent", "Daylight", "Cloudy", "Shade"]) await waitForPoster(page, `Apply ${name} white balance`);
    await page.screenshot({ path: `${SHOTS}/${project}-sample-fallback-wb.png` });
    await page.getByRole("button", { name: "Apply Film Noir filter preset" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${project}-sample-fallback.png` });
  });

  test("real footage screenshot pass", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const project = testInfo.project.name;
    const clip = await openRealFootage(page);
    await seek(page, 2);
    await openLooksAndLuts(page, clip.id);
    for (const label of ["Apply Teal & Orange filter preset", "Apply Film Noir filter preset", "Apply Blockbuster filter preset"]) {
      await waitForPoster(page, label);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${project}-real-looks.png` });
    await page.getByRole("button", { name: "Apply Blockbuster filter preset" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${project}-real-looks-scrolled.png` });
    await page.getByRole("tab", { name: "Vintage", exact: true }).click();
    await waitForPoster(page, "Apply Polaroid filter preset");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${project}-real-looks-vintage.png` });
    await page.locator('input[aria-label="Import LUT files"]').setInputFiles(writeSwapLut());
    await waitForPoster(page, "Apply swap-rb as creative LUT");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Apply swap-rb as creative LUT" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${project}-real-luts.png` });
    await page.getByRole("button", { name: "Apply Tungsten white balance" }).scrollIntoViewIfNeeded();
    await waitForPoster(page, "Apply Tungsten white balance");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/${project}-real-white-balance.png` });
    const noirLabel = "Apply Film Noir filter preset";
    await page.getByRole("tab", { name: "Cinematic", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("tab", { name: "Cinematic", exact: true }).click();
    await waitForPoster(page, noirLabel);
    await page.getByRole("button", { name: noirLabel }).hover();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${project}-real-hover.png` });
  });
}
