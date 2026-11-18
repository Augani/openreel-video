import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./helpers";

/**
 * Audio Mixer layout in real Chrome: the Master strip is pinned on the right and always fully
 * on screen, however many bus strips exist; the track + bus strips scroll horizontally instead.
 * Checked at 1180 px and 1440 px wide viewports with 0, 3 and 12 buses, and at 768 px and 900 px
 * viewport HEIGHTS: the dialog must fit the window, every strip (tracks, buses, Master) must be fully
 * inside it (no clipped fader/button rows at the bottom), with Master pinned and unobstructed.
 */

/** Browser-side handle (installed by beforeEach); only called inside page.evaluate callbacks. */
declare function E(): { ui: { getState(): any }; project: { getState(): any } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

async function openMixer(page: Page) {
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
}

async function addBuses(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const before = await page.evaluate(() => (E().project.getState().project.timeline.audioBuses ?? []).length as number);
    await page.getByTestId("add-bus").click();
    await expect.poll(() => page.evaluate(() => (E().project.getState().project.timeline.audioBuses ?? []).length as number)).toBe(before + 1);
  }
}

for (const [width, height] of [[1180, 900], [1440, 900], [1180, 768], [1440, 768]] as const) {
  test(`mixer keeps the Master strip on screen at ${width}x${height} with buses`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openEditor(page);
    await openMixer(page);

    const master = page.getByTestId("master-channel");
    const scroller = page.getByTestId("mixer-strips-scroll");
    const fullyVisible = async (label: string) => {
      const box = await master.boundingBox();
      expect(box, `${label}: master has a box`).not.toBeNull();
      expect(box!.x, `${label}: master left edge on screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label}: master right edge inside the ${width}px viewport`).toBeLessThanOrEqual(width + 0.5);
      expect(box!.y, `${label}: master top inside the ${height}px viewport`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${label}: master bottom inside the ${height}px viewport (not clipped)`).toBeLessThanOrEqual(height + 0.5);
      // Not covered by anything: the element at the master's centre is inside the master strip.
      const covered = await master.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 80));
        return !(hit && el.contains(hit));
      });
      expect(covered, `${label}: master is not occluded`).toBe(false);
      // The master strip never overlaps the scrolling strips.
      const sbox = await scroller.boundingBox();
      expect(sbox!.x + sbox!.width, `${label}: scroller ends before the master`).toBeLessThanOrEqual(box!.x + 0.5);
    };

    /** Every track and bus strip is entirely inside the dialog AND the viewport: no clipped bottoms. */
    const stripsUnclipped = async (label: string) => {
      const rows = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
        const scrollerEl = document.querySelector('[data-testid="mixer-strips-scroll"] [data-radix-scroll-area-viewport]') as HTMLElement;
        const visible = scrollerEl.getBoundingClientRect();
        return [...document.querySelectorAll('[data-testid^="channel-strip-"], [data-testid^="bus-strip-"], [data-testid="master-channel"]')].map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute("data-testid"), top: r.top, bottom: r.bottom, dialogTop: dialog.top, dialogBottom: dialog.bottom, viewBottom: window.innerHeight, scrollBottom: visible.bottom, master: el.getAttribute("data-testid") === "master-channel" };
        });
      });
      expect(rows.length, `${label}: strips exist`).toBeGreaterThan(1);
      for (const row of rows) {
        expect(row.top, `${label}: ${row.id} top inside the dialog`).toBeGreaterThanOrEqual(row.dialogTop - 0.5);
        expect(row.bottom, `${label}: ${row.id} bottom inside the dialog`).toBeLessThanOrEqual(row.dialogBottom + 0.5);
        expect(row.bottom, `${label}: ${row.id} bottom inside the ${height}px viewport`).toBeLessThanOrEqual(row.viewBottom + 0.5);
        if (!row.master) expect(row.bottom, `${label}: ${row.id} not cut off by its scroller`).toBeLessThanOrEqual(row.scrollBottom + 0.5);
      }
    };

    await fullyVisible("no buses");
    await stripsUnclipped("no buses");
    for (const [count, label] of [[3, "3 buses"], [9, "12 buses"]] as const) {
      await addBuses(page, count);
      await fullyVisible(label);
      await stripsUnclipped(label);
    }

    // Twelve buses overflow the scroll area, which scrolls on its own while the master stays put.
    const viewport = scroller.locator("[data-radix-scroll-area-viewport]");
    const dims = await viewport.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(dims.sw, "bus strips overflow their scroller").toBeGreaterThan(dims.cw);
    const masterBefore = await master.boundingBox();
    await viewport.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const masterAfter = await master.boundingBox();
    expect(masterAfter!.x, "master does not move when the strips scroll").toBeCloseTo(masterBefore!.x, 0);
    await fullyVisible("scrolled");
    await stripsUnclipped("scrolled");
    const lastBus = page.locator('[data-testid^="bus-name-"]').last();
    await expect(lastBus).toBeInViewport();

    await page.getByTestId("audio-mixer").screenshot({ path: testInfo.outputPath(`mixer-${width}x${height}.png`) });
    await testInfo.attach(`mixer-${width}x${height}`, { path: testInfo.outputPath(`mixer-${width}x${height}.png`), contentType: "image/png" });
  });
}
