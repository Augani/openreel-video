import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openEditor, settle } from "./helpers";

/**
 * The Proxies controls used to expand inline inside the Media panel, which left the media list a ~30 px sliver on
 * 700-720 px tall windows. They are now a one-line summary row with a popover for the full settings. At the three
 * window sizes people edit on, the media list keeps a usable height with the settings open, the popover stays on
 * screen, and every control in it is reachable.
 */
const VIEWPORTS = [
  { width: 1024, height: 700 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
] as const;

/** Height of the scrolling media list and of the first media card inside it, as drawn right now. */
const mediaListMetrics = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector('[aria-label="Select media three-scenes.mp4"]') as HTMLElement | null;
    if (!card) return null;
    let scroller: HTMLElement | null = card.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const rect = card.getBoundingClientRect();
    const clip = scroller?.getBoundingClientRect();
    const visibleHeight = clip ? Math.max(0, Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top)) : rect.height;
    return { list: scroller ? Math.round(scroller.clientHeight) : 0, card: Math.round(rect.height), cardVisible: Math.round(visibleHeight) };
  });

for (const viewport of VIEWPORTS) {
  test(`proxies: the media list keeps its height with the settings open at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    testInfo.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await openEditor(page);
    const outDir = process.env.OPENREEL_SWEEP_OUT ? join(process.env.OPENREEL_SWEEP_OUT, "proxies") : testInfo.outputDir;
    mkdirSync(outDir, { recursive: true });
    const closed = await mediaListMetrics(page);
    await page.getByTestId("proxy-panel").getByRole("button", { name: /^Proxies/ }).click();
    const body = page.getByTestId("proxy-panel-body");
    await body.waitFor();
    await settle(page, 500);
    const open = await mediaListMetrics(page);
    await page.screenshot({ path: join(outDir, `proxies-open-${viewport.width}x${viewport.height}.png`) });
    console.log(`[proxy-layout ${viewport.width}x${viewport.height}] media list ${closed?.list}px -> ${open?.list}px with the settings open; first card ${open?.cardVisible}/${open?.card}px visible`);
    expect(open, "media card is on screen").not.toBeNull();
    expect(open!.list, "media list is not squeezed by the settings").toBe(closed!.list);
    expect(open!.list, "room for at least one card row").toBeGreaterThanOrEqual(110);
    expect(open!.cardVisible).toBeGreaterThanOrEqual(open!.card - 1);

    // The popover is inside the window and every control in it can be reached.
    const box = (await body.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    for (const name of ["Create proxies", "Attach proxies", "Use proxies in preview"]) {
      await expect(body.getByRole("button", { name })).toBeVisible();
    }
    // Escape closes it and puts focus back on the summary row; the list is where it was.
    await page.keyboard.press("Escape");
    await expect(body).toBeHidden();
    await expect(page.getByTestId("proxy-panel").getByRole("button", { name: /^Proxies/ })).toBeFocused();
    expect(await mediaListMetrics(page)).toEqual(closed);
  });
}
