import { expect, test, type Page } from "@playwright/test";
import { readState, settle, undo } from "./helpers";
import { SOFTWARE_GPU } from "./env";

/**
 * Project panel: virtualised grid with 2,000 items, log metadata columns,
 * Cmd/Ctrl+F find, and live smart bins. Real Chrome; assertions read the live stores.
 */

interface E2EStores {
  __openreelE2E: {
    project: { getState(): any; setState(v: unknown): void };
    projectPanel: { getState(): any };
  };
}

async function openBlankEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable; the tour just shows */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await settle(page);
}

/** Replace the media library with synthetic items (no files needed). */
async function seedLibrary(page: Page, count: number, withMetadata = false): Promise<void> {
  await page.evaluate(
    ({ count, withExtra }) => {
      const store = (window as unknown as E2EStores).__openreelE2E.project;
      const state = store.getState();
      const extraFor = withExtra
        ? (i: number): Record<string, unknown> => ({
            ...(i % 3 === 0 ? { scene: "12" } : { scene: "14" }),
            ...(i % 2 === 0 ? { goodTake: true } : {}),
            take: String(1 + (i % 4)),
          })
        : () => ({});
      const items = Array.from({ length: count }, (_, i) => ({
        id: `g-${i}`,
        name: `Clip ${String(i).padStart(4, "0")}`,
        type: "video",
        fileHandle: null,
        blob: null,
        metadata: { duration: 1 + (i % 50), width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1_000_000 + i },
        thumbnailUrl: null,
        waveformData: null,
        importedAt: 1_700_000_000_000 + i * 60_000,
        ...extraFor(i),
      }));
      store.setState({ project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items } } });
    },
    { count, withExtra: withMetadata },
  );
}

const frames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const historyLength = async (page: Page) => (await readState(page)).historyLength;

test.describe("Project panel grid and smart bins", () => {
  test("grid with 2,000 items is windowed and scrolls without jank", async ({ page }, testInfo) => {
    await openBlankEditor(page);
    const N = 2000;
    const t0 = Date.now();
    await seedLibrary(page, N);
    await expect(page.getByTestId("media-grid")).toBeVisible();
    await expect(page.getByLabel("Select media Clip 0000")).toBeVisible();
    await frames(page);
    const renderMs = Date.now() - t0;

    const grid = page.getByTestId("media-grid");
    const tilesInDom = await page.getByLabel(/Select media Clip/).count();
    expect(tilesInDom).toBeGreaterThan(4);
    expect(tilesInDom).toBeLessThan(80); // windowed, not 2,000 tiles
    const domNodes = await grid.evaluate((el) => el.querySelectorAll("*").length);
    expect(domNodes).toBeLessThan(2500);
    const dims = await grid.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, columns: Number(el.getAttribute("data-columns")), rowHeight: Number(el.getAttribute("data-row-height")) }));
    // 2,000 items + the Add media tile over `columns` columns, at a fixed row height.
    expect(dims.scrollHeight).toBeGreaterThanOrEqual(Math.ceil(2001 / dims.columns) * dims.rowHeight);

    // Real wheel scrolling: sample frame deltas through a long scroll, then count slow frames.
    await page.evaluate(() => {
      const w = window as unknown as { __scrollMon: { deltas: number[]; on: boolean } };
      w.__scrollMon = { deltas: [], on: true };
      let last = 0;
      const tick = (now: number) => {
        if (!w.__scrollMon.on) return;
        if (last) w.__scrollMon.deltas.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const box = (await grid.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const firstBefore = await page.getByLabel(/Select media Clip/).first().getAttribute("aria-label");
    const scrollStart = Date.now();
    for (let i = 0; i < 90; i += 1) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(12);
    }
    const scrollMs = Date.now() - scrollStart;
    const scrolled = await grid.evaluate((el) => el.scrollTop);
    expect(scrolled).toBeGreaterThan(dims.rowHeight * 20);
    await expect.poll(() => page.getByLabel(/Select media Clip/).first().getAttribute("aria-label")).not.toBe(firstBefore);
    const deltas = await page.evaluate(() => {
      const w = window as unknown as { __scrollMon: { deltas: number[]; on: boolean } };
      w.__scrollMon.on = false;
      return w.__scrollMon.deltas;
    });
    const sorted = [...deltas].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const over50 = deltas.filter((d) => d > 50).length;
    const renderedDuring = await page.getByLabel(/Select media Clip/).count();

    // Jump to the bottom: the last clip and the Add media tile are reachable.
    await grid.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByLabel("Select media Clip 1999")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add media", exact: true })).toBeVisible();
    // And back to the top.
    await grid.evaluate((el) => { el.scrollTop = 0; });
    await expect(page.getByLabel("Select media Clip 0000")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("grid-2000.png") });

    const report = { items: N, renderMs, tilesInDom, domNodes, columns: dims.columns, rowHeight: dims.rowHeight, wheelEvents: 90, scrollMs, rafP95Ms: Math.round(p95 * 10) / 10, rafMaxMs: Math.round(max * 10) / 10, framesOver50ms: over50, tilesInDomWhileScrolled: renderedDuring };
    console.log("PERF-GRID-2000 " + JSON.stringify(report));
    testInfo.annotations.push({ type: "perf", description: JSON.stringify(report) });
    // Headless Chrome on a shared machine: allow a hitch, not sustained jank. Frame-time and
    // seed-render budgets measure hardware speed: a CPU-only (SwiftShader) runner rasterises
    // the whole page in software and cannot hold 60fps, so there they are reported (above)
    // but not asserted. The windowing assertions earlier in the test (bounded DOM, tiles
    // swapped while scrolling, last item reachable) are functional and always apply.
    if (!SOFTWARE_GPU) {
      expect(over50).toBeLessThanOrEqual(3);
      expect(p95).toBeLessThan(40);
      expect(renderMs).toBeLessThan(3000);
    } else {
      expect(renderMs, "seeding 2,000 items renders in bounded time even in software").toBeLessThan(30_000);
    }
  });

  test("log columns edit in place (one undo step), Cmd/Ctrl+F finds across fields, smart bins update live", async ({ page }) => {
    await openBlankEditor(page);
    await seedLibrary(page, 12);
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByTestId("media-list")).toBeVisible();
    // Show the logging columns.
    await page.evaluate(() => {
      const panel = (window as unknown as E2EStores).__openreelE2E.projectPanel.getState();
      for (const column of ["scene", "shot", "take", "goodTake", "description"]) if (!panel.columns.includes(column)) panel.toggleColumn(column);
    });
    await expect(page.getByRole("columnheader", { name: "Scene" })).toBeVisible();
    const items = () =>
      page.evaluate(() => (window as unknown as E2EStores).__openreelE2E.project.getState().project.mediaLibrary.items.map((m: any) => ({ id: m.id, scene: m.scene ?? null, shot: m.shot ?? null, take: m.take ?? null, goodTake: !!m.goodTake, description: m.description ?? null })));
    const row = (id: string) => page.locator(`[data-testid="media-row"][data-media-id="${id}"]`);

    // ---- editable scene / shot / take / description: one undo step per edit ----
    const base = await historyLength(page);
    for (const [id, field, value] of [["g-0", "scene", "12"], ["g-0", "take", "3"], ["g-3", "scene", "12"], ["g-3", "description", "Close on hands, rain"], ["g-5", "scene", "14"]] as const) {
      await row(id).locator(`[data-col="${field}"] span`).first().dblclick();
      const input = page.getByTestId(`edit-${field}`);
      await expect(input).toBeVisible();
      await input.fill(value);
      await input.press("Enter");
      await expect(page.getByTestId(`edit-${field}`)).toHaveCount(0);
    }
    await expect.poll(() => historyLength(page)).toBe(base + 5);
    expect((await items()).filter((m) => m.scene === "12").map((m) => m.id)).toEqual(["g-0", "g-3"]);
    expect((await items()).find((m) => m.id === "g-3")!.description).toBe("Close on hands, rain");

    // Good-take flag via the checkbox.
    await row("g-3").getByTestId("good-take-toggle").click();
    await expect.poll(async () => (await items()).find((m) => m.id === "g-3")!.goodTake).toBe(true);
    await expect.poll(() => historyLength(page)).toBe(base + 6);

    // ---- Find (Cmd/Ctrl+F in the panel) spans every metadata field ----
    await row("g-1").click(); // focus inside the panel
    await page.keyboard.press("ControlOrMeta+f");
    const search = page.getByLabel("Search media");
    await expect(search).toBeFocused();
    await search.fill("rain");
    await expect(page.getByTestId("search-scope")).toContainText("1 result");
    await expect(row("g-3")).toBeVisible();
    await search.fill("scene:12 good:yes");
    await expect(page.getByTestId("search-scope")).toContainText("1 result");
    await search.fill("scene:12");
    await expect(page.getByTestId("search-scope")).toContainText("2 results");

    // ---- smart bin: saved search that updates live ----
    await search.fill("scene:12 good:yes");
    await expect(page.getByTestId("search-scope")).toContainText("1 result");
    const beforeBin = await historyLength(page);
    await page.getByRole("button", { name: "Smart bins" }).click();
    await page.getByTestId("save-smart-bin").click();
    await expect(page.getByTestId("smart-bin-crumb")).toBeVisible();
    await expect(page.getByTestId("smart-bin-crumb-count")).toHaveText("1");
    await expect.poll(() => historyLength(page)).toBe(beforeBin + 1);
    const smartBins = () => page.evaluate(() => (window as unknown as E2EStores).__openreelE2E.project.getState().project.smartBins ?? []);
    expect(await smartBins()).toHaveLength(1);
    await expect(row("g-3")).toBeVisible();
    await expect(row("g-0")).toHaveCount(0);

    // Metadata change from elsewhere (an agent-style action) shows up without reopening the bin.
    await page.evaluate(() =>
      (window as unknown as E2EStores).__openreelE2E.project.getState().executeAction({
        type: "media/organize",
        id: "e2e-live-1",
        timestamp: Date.now(),
        params: { label: "Mark good take", itemPatches: { "g-0": { goodTake: true } } },
      }),
    );
    await expect(page.getByTestId("smart-bin-crumb-count")).toHaveText("2");
    await expect(row("g-0")).toBeVisible();

    // Unticking the flag in the bin itself removes the row live.
    await row("g-3").getByTestId("good-take-toggle").click();
    await expect(row("g-3")).toHaveCount(0);
    await expect(page.getByTestId("smart-bin-crumb-count")).toHaveText("1");

    // The menu count tracks it too; undo brings the row back.
    await page.getByRole("button", { name: "Smart bins" }).click();
    await expect(page.getByTestId("smart-bin-count")).toHaveText("1");
    await page.keyboard.press("Escape");
    await undo(page);
    await expect(row("g-3")).toBeVisible();
    await expect(page.getByTestId("smart-bin-crumb-count")).toHaveText("2");

    // Deleting the smart bin is one undo step and never touches media.
    const mediaBefore = (await items()).length;
    await page.getByRole("button", { name: "Smart bins" }).click();
    await page.getByTestId("delete-smart-bin").click();
    await expect(page.getByTestId("smart-bin-crumb")).toHaveCount(0);
    expect(await smartBins()).toHaveLength(0);
    expect((await items()).length).toBe(mediaBefore);
    await undo(page);
    await expect.poll(async () => (await smartBins()).length).toBe(1);

    // Saving a search typed INSIDE a smart bin saves the narrowed search (the bin's terms plus the
    // typed ones), not just the typed text: the saved bin matches what the view showed.
    await page.getByRole("button", { name: "Smart bins" }).click();
    await page.getByTestId("smart-bin-item").first().click();
    await expect(page.getByTestId("smart-bin-crumb")).toBeVisible();
    await search.fill("take:1");
    await page.getByRole("button", { name: "Smart bins" }).click();
    await page.getByTestId("save-smart-bin").click();
    await expect.poll(async () => (await smartBins()).length).toBe(2);
    const saved = (await smartBins()) as Array<{ query: string }>;
    expect(saved[1].query).toBe("scene:12 good:yes take:1");
  });
});
