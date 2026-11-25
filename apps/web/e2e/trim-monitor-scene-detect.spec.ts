import { expect, test, type Page } from "@playwright/test";
import {
  FRAME,
  clipLocator,
  clipsOf,
  openEditor,
  press,
  readState,
  redo,
  seek,
  setZoom,
  splitIntoThree,
  undo,
  type ClipState,
} from "./helpers";

/**
 * Trim Monitor and Scene Edit Detection. The fixture's scenes are testsrc2 (0-2 s), solid red (2-4 s) and
 * SMPTE bars (4-6 s), cut from one source, so the edit points sit at 2 s and 4 s.
 */
const isRed = ([r, g, b]: [number, number, number]) => r > 150 && g < 80 && b < 80;

async function threeClips(page: Page): Promise<ClipState[]> {
  await openEditor(page);
  await splitIntoThree(page);
  await setZoom(page, 100);
  return clipsOf(await readState(page), "Main");
}

async function half(page: Page, testId: "trim-monitor-outgoing" | "trim-monitor-incoming"): Promise<[number, number, number]> {
  return page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement | null;
    if (!c || c.width === 0) return [-1, -1, -1] as [number, number, number];
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const d = g.getImageData(c.width * 0.25, c.height * 0.25, c.width * 0.5, c.height * 0.5).data;
    let r = 0, gg = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [r / n, gg / n, b / n] as [number, number, number];
  }, testId);
}

const markers = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __openreelE2E: { project: { getState(): { project: { timeline: { markers: Array<{ time: number; label: string }> } } } } } })
      .__openreelE2E.project.getState().project.timeline.markers.map((m) => ({ time: m.time, label: m.label })),
  );

test.describe("Premiere-parity: Trim Monitor and Scene Edit Detection", () => {
  test("double-clicking the add-transition button on a cut opens the Trim Monitor on that cut, a single click still opens the menu", async ({ page }) => {
    const [, b] = await threeClips(page);
    const badge = page.locator("[data-timeline-transition]").first();
    await expect(badge).toBeVisible();
    // Single click: the transition menu (button stays usable).
    await badge.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    // Double-click on the button itself, in the middle of the cut.
    await badge.dblclick();
    await expect(page.getByTestId("trim-monitor")).toBeVisible();
    await expect(page.getByRole("menu")).toBeHidden();
    // The first cut of the lane is the one between the first and second clip: the incoming half is the red scene.
    await expect.poll(async () => isRed(await half(page, "trim-monitor-incoming")), "incoming half is red").toBe(true);
    expect(b.start).toBeGreaterThan(0);
  });

  test("double-click opens the Trim Monitor on a cut; keys trim it, JKL trims dynamically, Play Around loops, Up/Down navigate", async ({ page }) => {
    const [a, b] = await threeClips(page);
    const handle = clipLocator(page, b.id).locator('[data-timeline-trim="left"]');
    // The add-transition button sits over the middle of a cut; the top of the 8 px handle is clear of it.
    await handle.dblclick({ position: { x: 3, y: 4 } });
    const monitor = page.getByTestId("trim-monitor");
    await expect(monitor).toBeVisible();
    await expect(page.getByTestId("trim-monitor-mode-roll")).toHaveAttribute("aria-checked", "true");

    // Outgoing is the end of testsrc2, incoming is the red scene's first frame.
    await expect.poll(async () => isRed(await half(page, "trim-monitor-incoming")), "incoming half is red").toBe(true);
    await expect.poll(async () => isRed(await half(page, "trim-monitor-outgoing")), "outgoing half is not red").toBe(false);
    expect((await half(page, "trim-monitor-outgoing"))[0]).toBeGreaterThanOrEqual(0);

    // Keyboard: "." rolls the cut one frame later, as its own undo step.
    const start = await readState(page);
    await press(page, ".");
    const rolled = await readState(page);
    const [ra, rb] = clipsOf(rolled, "Main");
    expect(ra.start + ra.duration).toBeCloseTo(a.start + a.duration + FRAME, 3);
    expect(rb.start).toBeCloseTo(b.start + FRAME, 3);
    expect(rolled.historyLength - start.historyLength).toBe(1);
    await expect(page.getByTestId("trim-monitor-readout")).toContainText("Roll");

    // Buttons: -5 is one more undo step.
    await page.getByTestId("trim-monitor-step--5").click();
    const stepped = await readState(page);
    expect(clipsOf(stepped, "Main")[0].duration).toBeCloseTo(a.duration + FRAME - 5 * FRAME, 3);
    expect(stepped.historyLength - rolled.historyLength).toBe(1);

    // Numeric offset.
    await page.getByTestId("trim-monitor-offset").fill("+7");
    await page.getByTestId("trim-monitor-offset").press("Enter");
    const typed = await readState(page);
    expect(clipsOf(typed, "Main")[0].duration).toBeCloseTo(a.duration + FRAME - 5 * FRAME + 7 * FRAME, 3);
    expect(typed.historyLength - stepped.historyLength).toBe(1);

    // Undo steps back through exactly those three trims.
    await undo(page);
    await undo(page);
    await undo(page);
    expect(clipsOf(await readState(page), "Main").map((c) => [c.start, c.duration])).toEqual([[a.start, a.duration], [b.start, b.duration], [clipsOf(start, "Main")[2].start, clipsOf(start, "Main")[2].duration]]);
    await redo(page);
    await redo(page);
    await redo(page);

    // JKL dynamic trim inside the monitor: L moves the cut, K commits it as one step.
    const beforeJkl = await readState(page);
    await press(page, "l");
    await page.waitForTimeout(500);
    await press(page, "k");
    const jkl = await readState(page);
    expect(jkl.historyLength - beforeJkl.historyLength).toBe(1);
    expect(clipsOf(jkl, "Main")[0].duration).toBeGreaterThan(clipsOf(beforeJkl, "Main")[0].duration + 0.1);
    await expect(monitor).toBeVisible();

    // Play Around Edit loops around the cut: the playhead stays within pre-roll / post-roll and wraps.
    const cut = clipsOf(jkl, "Main")[0].start + clipsOf(jkl, "Main")[0].duration;
    await page.getByTestId("trim-monitor-play-around").click();
    const seen: number[] = [];
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      seen.push((await readState(page)).playhead);
      await page.waitForTimeout(120);
      if (seen.length > 10 && seen.some((v, i) => i > 0 && v < seen[i - 1] - 1)) break;
    }
    expect(seen.some((v, i) => i > 0 && v < seen[i - 1] - 1), "the playhead wrapped back to the pre-roll").toBe(true);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(cut - 2.1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(cut + 2.1);
    await press(page, "Space");
    await expect.poll(async () => (await readState(page)).playhead).toBeCloseTo(cut, 2);
    await expect(page.getByTestId("trim-monitor-play-around")).toHaveAttribute("aria-pressed", "false");

    // Down arrow moves to the next edit point and shows it.
    const readout = await page.getByTestId("trim-monitor-readout").innerText();
    await press(page, "ArrowDown");
    await expect(page.getByTestId("trim-monitor-readout")).not.toHaveText(readout);
    expect((await readState(page)).playhead).toBeGreaterThan(cut + 0.5);

    // Slip from the monitor keeps the clip in place.
    await page.getByTestId("trim-monitor-mode-slip").click();
    const beforeSlip = await readState(page);
    await page.getByTestId("trim-monitor-step-5").click();
    const slipped = await readState(page);
    expect(slipped.historyLength - beforeSlip.historyLength).toBe(1);
    expect(clipsOf(slipped, "Main").map((c) => [c.start, c.duration])).toEqual(clipsOf(beforeSlip, "Main").map((c) => [c.start, c.duration]));
    expect(clipsOf(slipped, "Main").map((c) => c.inPoint)).not.toEqual(clipsOf(beforeSlip, "Main").map((c) => c.inPoint));

    await press(page, "Escape");
    await expect(monitor).toHaveCount(0);
  });

  test("T opens the Trim Monitor on a selected edit point and closes it again", async ({ page }) => {
    const [, b] = await threeClips(page);
    await seek(page, 3);
    const handle = clipLocator(page, b.id).locator('[data-timeline-trim="right"]');
    await handle.click();
    await expect(handle).toHaveAttribute("data-edit-point-selected", /ripple|roll/);
    await press(page, "t");
    await expect(page.getByTestId("trim-monitor")).toBeVisible();
    await press(page, "t");
    await expect(page.getByTestId("trim-monitor")).toHaveCount(0);
  });

  test("Scene Edit Detection adds markers, then cuts and subclips, each as one undo step", async ({ page }) => {
    await openEditor(page);
    const initial = await readState(page);
    const [clip] = clipsOf(initial, "Main");
    await clipLocator(page, clip.id).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Detect Scene Edits/ }).click();
    const dialog = page.getByRole("dialog", { name: /Scene Edit Detection/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "Detect cross-dissolves" })).toBeChecked();
    await expect(dialog.getByRole("switch", { name: "Detect fades to and from black" })).toBeChecked();
    await dialog.getByRole("button", { name: "Analyse" }).click();
    await expect(dialog.getByText("2 cuts found")).toBeVisible({ timeout: 45_000 });

    // Markers only: the clip stays whole.
    await dialog.getByRole("switch", { name: "Apply a cut at each detected edit" }).click();
    await dialog.getByRole("switch", { name: "Add timeline markers" }).click();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    const marked = await readState(page);
    expect(clipsOf(marked, "Main")).toHaveLength(1);
    const found = await markers(page);
    expect(found.map((m) => Math.round(m.time))).toEqual([2, 4]);
    expect(marked.historyLength - initial.historyLength).toBe(1);

    // Cuts and subclips together, one more step.
    await clipLocator(page, clip.id).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Detect Scene Edits/ }).click();
    await dialog.getByRole("button", { name: "Analyse" }).click();
    await expect(dialog.getByText("2 cuts found")).toBeVisible({ timeout: 45_000 });
    await dialog.getByRole("switch", { name: "Create subclips for each scene" }).click();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    const cut = await readState(page);
    expect(clipsOf(cut, "Main")).toHaveLength(3);
    expect(cut.historyLength - marked.historyLength).toBe(1);

    await undo(page);
    expect(clipsOf(await readState(page), "Main")).toHaveLength(1);
    await undo(page);
    expect(await markers(page)).toHaveLength(0);
    await redo(page);
    expect(await markers(page)).toHaveLength(2);
  });
});
