import { expect, test } from "@playwright/test";
import {
  canvasInk,
  clipsOf,
  openEditor,
  press,
  readState,
  redo,
  seek,
  settle,
  shape,
  undo,
  clipLocator,
} from "./helpers";

test.describe("Premiere-parity: scopes and scene detection", () => {
  test("Shift+S opens video scopes and all four tabs draw a non-blank scope", async ({ page }) => {
    await openEditor(page);
    await seek(page, 0.5);
    const panel = page.getByTestId("scopes-panel");
    await expect(panel).toHaveCount(0);
    await press(page, "Shift+S");
    await expect(panel).toBeVisible();

    const dataCanvas = '[data-testid="scopes-panel"] canvas >> nth=0';
    const fingerprints: string[] = [];
    for (const label of ["Luma", "Parade", "Vector", "Histogram"]) {
      await panel.getByRole("tab", { name: `${label} scope` }).click();
      await expect(panel.getByRole("tab", { name: `${label} scope` })).toHaveAttribute(
        "data-state",
        "active",
      );
      // The scope renders off-thread; poll until it has drawn something.
      await expect
        .poll(() => canvasInk(page, '[data-testid="scopes-panel"] canvas'), {
          message: `${label} scope drew nothing`,
          timeout: 8_000,
        })
        .toBeGreaterThan(0.001);
      fingerprints.push(
        await page.evaluate((sel) => {
          const c = document.querySelector(sel) as HTMLCanvasElement;
          return c.toDataURL().length + ":" + c.width + "x" + c.height;
        }, '[data-testid="scopes-panel"] canvas'),
      );
    }
    expect(new Set(fingerprints).size, "tabs should render different scopes").toBeGreaterThan(1);
    void dataCanvas;

    // The scope follows the program: the red scene looks different from testsrc2.
    await panel.getByRole("tab", { name: "Parade scope" }).click();
    await settle(page, 600);
    const before = await page.evaluate(() =>
      (document.querySelector('[data-testid="scopes-panel"] canvas') as HTMLCanvasElement).toDataURL(),
    );
    await seek(page, 3);
    await settle(page, 1500);
    const after = await page.evaluate(() =>
      (document.querySelector('[data-testid="scopes-panel"] canvas') as HTMLCanvasElement).toDataURL(),
    );
    expect(after).not.toBe(before);

    await press(page, "Shift+S");
    await expect(panel).toHaveCount(0);
  });

  test("scene edit detection finds exactly 2 cuts, splits in one undo step", async ({ page }) => {
    await openEditor(page);
    const initial = await readState(page);
    const [clip] = clipsOf(initial, "Main");
    expect(shape([clip])).toEqual([[0, 6, 0, 6]]);

    await clipLocator(page, clip.id).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Detect Scene Edits/ }).click();
    const dialog = page.getByRole("dialog", { name: /Scene Edit Detection/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Analyse" }).click();
    await expect(dialog.getByText("2 cuts found")).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    const split = await readState(page);
    const parts = clipsOf(split, "Main");
    expect(parts).toHaveLength(3);
    for (const [i, p] of parts.entries()) {
      expect(p.start).toBeCloseTo(i * 2, 1);
      expect(p.duration).toBeCloseTo(2, 1);
      expect(p.inPoint).toBeCloseTo(i * 2, 1);
    }
    expect(split.historyLength - initial.historyLength, "scene split = one history entry").toBe(1);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual([[0, 6, 0, 6]]);

    await redo(page);
    expect(clipsOf(await readState(page), "Main")).toHaveLength(3);
  });
});
