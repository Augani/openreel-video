import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, press, readState, redo, seek, shape, undo } from "./helpers";

const palette = (page: Page) => page.getByRole("dialog", { name: /Search Effects/ });

async function choosePreset(page: Page, name: string) {
  await press(page, "Shift+?");
  const overlay = page.getByRole("dialog").filter({ hasText: "choose a preset" });
  await expect(overlay).toBeVisible();
  await overlay.getByRole("button", { name: "Keyboard shortcut preset" }).click();
  await page.getByRole("menuitemradio", { name }).click();
  await expect(overlay.getByRole("button", { name: "Keyboard shortcut preset" })).toContainText(name);
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
}

test.describe("Premiere-parity: keyboard presets", () => {
  test("default preset: Cmd+K opens the command palette and does not split", async ({ page }) => {
    await openEditor(page);
    await seek(page, 3);
    await press(page, "Meta+k");
    await expect(palette(page)).toBeVisible();
    expect(clipsOf(await readState(page), "Main")).toHaveLength(1);
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
  });

  test("Premiere preset: Cmd+K adds an edit (single undo step) and the palette moves to Cmd+Shift+P", async ({
    page,
  }) => {
    await openEditor(page);
    await choosePreset(page, "Adobe Premiere");
    await seek(page, 3);
    await clickClip(page, clipsOf(await readState(page), "Main")[0].id);
    const before = await readState(page);
    expect(clipsOf(before, "Main")).toHaveLength(1);

    await press(page, "Meta+k");
    await expect(palette(page), "Cmd+K must not open the palette in the Premiere preset").toHaveCount(0);
    const after = await readState(page);
    expect(shape(clipsOf(after, "Main"))).toEqual([
      [0, 3, 0, 3],
      [3, 3, 3, 6],
    ]);
    expect(after.historyLength - before.historyLength).toBe(1);

    await undo(page);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(shape(clipsOf(before, "Main")));
    await redo(page);
    expect(clipsOf(await readState(page), "Main")).toHaveLength(2);

    await press(page, "Meta+Shift+p");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);

    // Switching back restores the default Cmd+K palette.
    await choosePreset(page, "OpenReel Default");
    await press(page, "Meta+k");
    await expect(palette(page)).toBeVisible();
  });
});
