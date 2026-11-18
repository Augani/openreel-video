import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, readState, seek, settle } from "./helpers";

/** Library chrome for titles, captions, graphics and stickers: nothing clipped, nothing placeholder. */

async function tabsAreWhole(page: Page, label: string): Promise<void> {
  const geometry = await page.evaluate((name) => {
    const list = document.querySelector<HTMLElement>(`[role="tablist"][aria-label="${name}"]`);
    if (!list) return null;
    const box = list.getBoundingClientRect();
    return {
      scrolls: list.scrollWidth > list.clientWidth + 1,
      tabs: [...list.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => {
        const r = tab.getBoundingClientRect();
        return { text: tab.textContent, left: r.left - box.left, right: box.right - r.right };
      }),
    };
  }, label);
  expect(geometry, `${label} tab list`).not.toBeNull();
  // Either every tab sits fully inside the strip, or the strip scrolls and fades (never a silently cut label).
  if (!geometry!.scrolls) for (const tab of geometry!.tabs) expect(tab.left, tab.text ?? "").toBeGreaterThanOrEqual(-0.5);
  if (!geometry!.scrolls) for (const tab of geometry!.tabs) expect(tab.right, tab.text ?? "").toBeGreaterThanOrEqual(-0.5);
}

test("graphics, text and sticker libraries show real, unclipped content", async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);

  // Graphics: the sub-tab strip fits at the default width and templates read as "category · duration".
  await page.getByRole("button", { name: "Graphics", exact: true }).first().click();
  await settle(page, 500);
  await tabsAreWhole(page, "Graphics sections");
  await page.getByRole("tab", { name: "Templates", exact: true }).click();
  await settle(page, 600);
  const panel = page.locator("#editor-panel-media");
  await expect(panel).not.toContainText(/\d+ controls/);
  await expect(panel).toContainText(/Lower thirds · \d+s/);
  // Lower-third cards span the panel so their name and subtitle render large enough to read.
  const lowerThird = await panel.locator('[data-graphic-template]').first().evaluate((el) => {
    const card = el.getBoundingClientRect();
    const canvas = el.querySelector("canvas")!.getBoundingClientRect();
    return { card: card.width, canvas: canvas.width, panel: el.parentElement!.getBoundingClientRect().width };
  });
  expect(lowerThird.canvas).toBeGreaterThan(lowerThird.panel * 0.85);

  // Shapes no longer repeats Overlays or the brand card; a new shape is white (no brand kit yet), not stock blue.
  await page.getByRole("tab", { name: "Shapes", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "OVERLAYS" })).toHaveCount(0);
  await expect(panel.getByText("Apply your brand")).toHaveCount(0);
  await panel.getByRole("button", { name: "Star", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => {
      const shapes = (window as any).__openreelE2E.project.getState().project.shapeClips ?? [];
      return shapes[shapes.length - 1]?.style.fill.color ?? null;
    }))
    .toBe("#FFFFFF");

  // Overlays: every card is a canvas drawn from the template's own recipe over the playhead frame.
  await page.getByRole("tab", { name: "Overlays", exact: true }).click();
  await settle(page, 1200);
  await expect(panel.getByText("Letterbox 2.39")).toHaveCount(1);
  const sample = (id: string, fx: number, fy: number) =>
    page.evaluate(([cardId, x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`[data-overlay-card="${cardId}"] canvas`);
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return null;
      const px = ctx.getImageData(Math.floor(canvas.width * (x as number)), Math.floor(canvas.height * (y as number)), 1, 1).data;
      return [px[0], px[1], px[2]];
    }, [id, fx, fy] as const);
  // Letterbox: black bars top and bottom, footage between them.
  const barTop = await sample("cinema-letterbox", 0.5, 0.04);
  const barBottom = await sample("cinema-letterbox", 0.5, 0.97);
  const between = await sample("cinema-letterbox", 0.5, 0.5);
  expect(Math.max(...barTop!)).toBeLessThan(24);
  expect(Math.max(...barBottom!)).toBeLessThan(24);
  expect(Math.max(...between!)).toBeGreaterThan(40);
  // Progress bar: a thin accent strip along the bottom edge, footage above it.
  const stripFill = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-overlay-card="overlay-progress-bar"] canvas')!;
      if (canvas.dataset.previewState !== "poster") return 0;
      const ctx = canvas.getContext("2d")!;
      const row = (y: number) => ctx.getImageData(0, y, canvas.width / 2, 1).data;
      const green = (data: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 120 && data[i + 1] > data[i] + 25 && data[i + 2] > 60 && data[i + 2] < 200) n++; return n / (data.length / 4); };
      let best = 0;
      for (let y = canvas.height - 4; y < canvas.height; y++) best = Math.max(best, green(row(y)));
      return best;
    });
  await expect.poll(stripFill, { message: "progress fill drawn along the bottom edge (left half)" }).toBeGreaterThan(0.3);
  // The callout shows its default label, not a template token.
  await expect(panel.locator('[data-overlay-card="overlay-follow-callout"] canvas')).toBeVisible();
  // Applying one puts real, correctly sized shapes on the timeline (width x height are honoured, not a default tile).
  const [main] = clipsOf(await readState(page), "Main");
  await clickClip(page, main.id);
  await panel.getByRole("button", { name: /Letterbox 2\.39/ }).click();
  await settle(page, 800);
  await expect
    .poll(() => page.evaluate(() => {
      const shapes = (window as any).__openreelE2E.project.getState().getFullProject().shapeClips ?? [];
      return shapes.filter((s: any) => s.extent?.width === 1920 && s.extent?.height === 120).length;
    }))
    .toBe(2);
  // ...and the Program monitor draws them: black bars across the top of the frame, footage below.
  await seek(page, 1);
  await settle(page, 1200);
  const programTop = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label^="Program frame"]')!;
    const px = canvas.getContext("2d")!.getImageData(Math.floor(canvas.width * 0.3), Math.floor(canvas.height * 0.03), 1, 1).data;
    return Math.max(px[0], px[1], px[2]);
  });
  expect(programTop, "letterbox bar visible in Program").toBeLessThan(24);

  // Brand has a real empty state, and nothing to apply until a kit exists.
  await page.getByRole("tab", { name: "Brand", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("No brand kit yet");
  await expect(panel.getByText("Apply your brand")).toHaveCount(0);
  await expect(panel.getByText(/Fonts \u00b7/)).toHaveCount(0);
  await panel.getByPlaceholder("Your brand").fill("Northwind");
  await expect(panel.getByText("Apply your brand")).toBeVisible();
  // The four swatches appear once (the editable row), not again inside the apply card.
  await expect(panel.locator(".workspace-brand-colors")).toHaveCount(1);
  await expect(panel.getByRole("status")).toHaveCount(0);

  // Stickers: a populated pack, icon chips with names, a proper empty-search message.
  await page.getByRole("tab", { name: "Stickers", exact: true }).click();
  await panel.getByRole("button", { name: "Stickers", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Add Starburst" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Arrows", exact: true })).toHaveAttribute("title", "Arrows");
  // The sticker grid does not scroll inside the panel's own scroll, and no banner spends space above it.
  await expect(panel.getByText("Add fun elements to your video")).toHaveCount(0);
  const nested = await panel.locator("button[aria-label^='Add ']").first().evaluate((button) => {
    for (let el = button.parentElement; el && el.id !== "editor-panel-media"; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1 && !el.closest("[data-radix-scroll-area-viewport]") ) return el.className;
    }
    return null;
  });
  expect(nested).toBeNull();
  // Sticker names are never ellipsised.
  const clipped = await panel.locator("button[aria-label^='Add '] span").evaluateAll((spans) =>
    spans.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(clipped).toEqual([]);
  await panel.getByLabel("Search stickers").fill("zzzz");
  await expect(panel.getByText("No stickers found")).toBeVisible();
  // Emoji come from the bundled Twemoji set, not the OS font.
  await panel.getByLabel("Search stickers").fill("");
  await panel.getByRole("button", { name: "Emojis", exact: true }).click();
  const emojiSrc = await panel.getByRole("button", { name: /^Add / }).first().locator("img").getAttribute("src");
  expect(emojiSrc).toMatch(/emoji\/[0-9a-f-]+\.svg$/);

  // Text: preset cards are canvases (real renderer), lower thirds use neutral sample names.
  await page.getByRole("button", { name: "Text & captions" }).first().click();
  await settle(page, 600);
  await tabsAreWhole(page, "Text sections");
  await expect(panel.locator(".workspace-title-preset canvas").first()).toBeVisible();
  await expect(panel).not.toContainText(/Ama Mensah|Kofi/i);
  await expect(panel.getByRole("radiogroup", { name: "Caption style" })).toBeVisible();

  // Captions: model download is collapsed, style cards replace the dropdown, no dead single-line button.
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await settle(page, 600);
  await expect(panel.getByRole("button", { name: /Speech model/ })).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("radio", { name: "Pop words caption style" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /single-line/ })).toHaveCount(0);
});
