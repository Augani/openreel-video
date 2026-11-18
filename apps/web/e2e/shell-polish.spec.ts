import { expect, test, type Page } from "@playwright/test";
import { openEditor, readState, clipsOf, settle } from "./helpers";

/**
 * Shell polish, checked in real Chrome at 1440x900: nothing is clipped at the edges of the left rail,
 * the colour wheels or the inspector, Help has real documentation and About, and the Export dialog shows
 * the current frame cropped to each preset's aspect ratio with an estimated size.
 */

test.use({ viewport: { width: 1440, height: 900 } });

declare function E(): { ui: { getState(): { select(item: object): void } } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
  await openEditor(page);
});

async function selectMainClip(page: Page) {
  const id = clipsOf(await readState(page), "Main")[0].id;
  await page.evaluate((clipId) => E().ui.getState().select({ type: "clip", id: clipId }), id);
  await settle(page, 400);
}

test("every left-rail button, including the last, is fully visible", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Editor tools" });
  const railBox = (await rail.boundingBox())!;
  const buttons = rail.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(12);
  // The pinned Project settings button is always inside the rail.
  const settings = rail.getByRole("button", { name: "Project settings" });
  const sBox = (await settings.boundingBox())!;
  expect(sBox.y).toBeGreaterThanOrEqual(railBox.y);
  expect(sBox.y + sBox.height).toBeLessThanOrEqual(railBox.y + railBox.height + 0.5);
  // Every other button is either fully inside the scroll area or reachable by scrolling it.
  const scroll = page.getByTestId("workspace-rail-scroll");
  const overflow = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight);
  const last = rail.getByRole("button", { name: "Versions" });
  await last.scrollIntoViewIfNeeded();
  const lBox = (await last.boundingBox())!;
  const sc = (await scroll.boundingBox())!;
  expect(lBox.y + lBox.height).toBeLessThanOrEqual(sc.y + sc.height + 0.5);
  expect(overflow).toBeGreaterThanOrEqual(0);
});

test("the three colour wheels sit inside the inspector", async ({ page }) => {
  await selectMainClip(page);
  await page.getByRole("tab", { name: "Color" }).first().click();
  await page.getByText("Color Grading", { exact: true }).first().click();
  const row = page.getByTestId("color-wheels-row");
  if (!(await row.count())) await page.getByText(/^Color Wheels$/i).first().click();
  await row.scrollIntoViewIfNeeded();
  const rowBox = (await row.boundingBox())!;
  const panelBox = (await row.evaluate((el) => {
    const r = el.closest("[class*='overflow']")?.getBoundingClientRect() ?? el.parentElement!.getBoundingClientRect();
    return { x: r.x, width: r.width };
  }));
  const wheels = row.locator("> div");
  expect(await wheels.count()).toBe(3);
  for (let i = 0; i < 3; i++) {
    const b = (await wheels.nth(i).boundingBox())!;
    expect(b.width).toBeGreaterThan(50);
    expect(b.x).toBeGreaterThanOrEqual(rowBox.x - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
  }
});

test("Help offers Documentation, Report an issue and a real About dialog", async ({ page }) => {
  await page.getByRole("menuitem", { name: "Help" }).click();
  await expect(page.getByRole("menuitem", { name: "Documentation" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Report an issue" })).toBeVisible();
  await page.getByRole("menuitem", { name: "About OpenReel" }).click();
  const dialog = page.getByTestId("about-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("about-version")).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(dialog.getByRole("link", { name: "Documentation" })).toHaveAttribute("href", /github\.com\/Augani\/openreel-video/);
});

test("export presets show the cropped current frame, aspect ratios and estimated sizes", async ({ page }) => {
  await page.getByRole("button", { name: "Export", exact: true }).last().click();
  const frames = page.getByTestId("preset-aspect-frame");
  await expect(frames.first()).toBeVisible();
  await expect(page.getByTestId("preset-size").first()).toHaveText(/^~\d/);
  // The captured Program frame is cropped into the aspect frame.
  await expect(frames.first().locator("img")).toBeVisible({ timeout: 10_000 });
  await page.locator('label[for="export-platform-TikTok"]').click();
  const vertical = page.getByTestId("preset-aspect-frame").first();
  await expect(vertical).toBeVisible();
  expect(Number(await vertical.getAttribute("data-aspect"))).toBeLessThan(1);
  // Brand sidebar entries each get their own glyph (no shared share icon).
  const svgs = await page.locator('label[for^="export-platform-"] svg').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("class") ?? ""),
  );
  const classes = svgs.filter((c) => /lucide-(youtube|instagram|twitter|facebook|linkedin)/.test(c));
  expect(new Set(classes).size).toBe(5);
});

test("Saved styles starts with real starter styles instead of an empty panel", async ({ page }) => {
  await page.getByRole("button", { name: /Text & captions/ }).click();
  await page.getByRole("tab", { name: "Saved styles" }).click();
  const empty = page.getByTestId("saved-styles-empty");
  await expect(empty).toBeVisible();
  expect(await empty.getByRole("button").count()).toBeGreaterThan(0);
});
