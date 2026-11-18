import { expect, test, type Page } from "@playwright/test";
import { AUDIO_FIXTURE_PATH } from "./global-setup";
import { clipsOf, openEditor, press, readSource, readState, seek, settle, undo, importInput } from "./helpers";

/**
 * Premiere-style Project panel: bins, labels, list view columns, subclips.
 * Real Chrome, real imports, real drag and drop; assertions read the live stores.
 */

const MAIN = "Select media three-scenes.mp4";
const TONE = "Select media tone-4s.wav";

interface E2EStores {
  __openreelE2E: {
    project: { getState(): any; setState(v: unknown): void };
    projectPanel: { getState(): any };
  };
}

const media = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as E2EStores).__openreelE2E.project
      .getState()
      .project.mediaLibrary.items.map((m: any) => ({
        id: m.id,
        name: m.name,
        binId: m.binId ?? null,
        label: m.label ?? null,
        comment: m.comment ?? null,
        subclip: m.subclip ?? null,
      })),
  );
const bins = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as E2EStores).__openreelE2E.project.getState().project.bins ?? []).map((b: any) => ({
      id: b.id,
      name: b.name,
      parentId: b.parentId ?? null,
    })),
  );
const historyLength = async (page: Page) => (await readState(page)).historyLength;

async function newBin(page: Page, name: string) {
  await page.getByRole("button", { name: "New bin", exact: true }).click();
  const input = page.getByTestId("bin-name-input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(page.getByTestId("bin-name-input")).toHaveCount(0);
}

const tile = (page: Page, name: string) => page.locator('[data-testid="bin-tile"]', { hasText: name });

async function importTone(page: Page) {
  await importInput(page).setInputFiles(AUDIO_FIXTURE_PATH);
  await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
}

test.describe("Project panel", () => {
  test("bins, drag between bins, labels, list sort, subclip from Source marks, reveal, delete bin", async ({ page }) => {
    await openEditor(page);
    await importTone(page);
    const base = await historyLength(page);

    // ---- (a) bins: create (one undo step each), nested, rename ----
    await newBin(page, "Interviews");
    await newBin(page, "Music");
    expect((await bins(page)).map((b) => b.name).sort()).toEqual(["Interviews", "Music"]);
    expect(await historyLength(page)).toBe(base + 2);
    // Old-project shape: nothing was in a bin until now.
    expect((await media(page)).every((m) => m.binId === null)).toBe(true);

    // New bin from selection: select the tone, then the toolbar button.
    await page.getByLabel(TONE).click();
    await page.getByRole("button", { name: "New bin from selection" }).click();
    const rename = page.getByTestId("bin-name-input");
    await expect(rename).toBeVisible();
    await rename.fill("Audio");
    await rename.press("Enter");
    expect(await historyLength(page)).toBe(base + 3);
    const audioBin = (await bins(page)).find((b) => b.name === "Audio")!;
    expect((await media(page)).find((m) => m.name === "tone-4s.wav")!.binId).toBe(audioBin.id);
    // Inside the root view the tone is gone from the grid; the bin tile shows it.
    await expect(page.getByLabel(TONE)).toHaveCount(0);
    await expect(tile(page, "Audio")).toContainText("1 item");

    // Drag the video onto the Interviews bin tile (real HTML5 drag and drop).
    await page.getByLabel(MAIN).dragTo(tile(page, "Interviews"));
    const interviews = (await bins(page)).find((b) => b.name === "Interviews")!;
    await expect.poll(async () => (await media(page)).find((m) => m.name === "three-scenes.mp4")!.binId).toBe(interviews.id);
    expect(await historyLength(page)).toBe(base + 4);

    // Breadcrumb navigation, including a nested bin.
    await tile(page, "Interviews").dblclick();
    await expect(page.getByLabel(MAIN)).toBeVisible();
    await newBin(page, "Day 1");
    const day1 = (await bins(page)).find((b) => b.name === "Day 1")!;
    expect(day1.parentId).toBe(interviews.id);
    await tile(page, "Day 1").dblclick();
    await expect(page.getByTestId("breadcrumb")).toHaveText(["Project", "Interviews", "Day 1"]);
    await page.getByTestId("breadcrumb").filter({ hasText: "Interviews" }).click();
    await expect(page.getByTestId("breadcrumb")).toHaveText(["Project", "Interviews"]);
    await expect(page.getByLabel(MAIN)).toBeVisible();

    // Dropping on a breadcrumb segment moves it up a level (here: back to the root and in again).
    await page.getByLabel(MAIN).dragTo(page.getByTestId("breadcrumb").filter({ hasText: "Project" }));
    await expect.poll(async () => (await media(page)).find((m) => m.name === "three-scenes.mp4")!.binId).toBe(null);
    await undo(page);
    await expect.poll(async () => (await media(page)).find((m) => m.name === "three-scenes.mp4")!.binId).toBe(interviews.id);

    // ---- (b) label colours ----
    await page.getByLabel(MAIN).click({ button: "right" });
    await page.getByTestId("menu-label").click();
    await page.getByTestId("label-mango").click();
    await expect.poll(async () => (await media(page)).find((m) => m.name === "three-scenes.mp4")!.label).toBe("mango");
    // The media menu plays an exit animation; opening the clip menu before it unmounts duplicates the label testids.
    await expect(page.getByTestId("media-context-menu")).toHaveCount(0);
    // chip in the bin and (clip defaults to its media's label) colour on the timeline clip.
    await expect(page.getByTestId("media-badges").getByTestId("label-chip")).toHaveAttribute("data-label", "mango");
    const timelineClip = page.locator('[data-timeline-item-id]').first();
    await expect(timelineClip).toHaveAttribute("data-clip-label", "mango");
    await expect(timelineClip.getByTestId("clip-label-bar")).toBeVisible();
    const barColor = await timelineClip.getByTestId("clip-label-bar").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(barColor).toBe("rgb(240, 145, 44)");

    // Per-clip label override via the timeline context menu (one undo step).
    const beforeClipLabel = await historyLength(page);
    await timelineClip.click({ button: "right" });
    await page.getByTestId("clip-label-menu").click();
    await page.getByTestId("label-rose").click();
    await expect(timelineClip).toHaveAttribute("data-clip-label", "rose");
    expect(await historyLength(page)).toBe(beforeClipLabel + 1);
    await undo(page);
    await expect(timelineClip).toHaveAttribute("data-clip-label", "mango");

    // ---- (d) subclip from Source monitor marks, then (c) list view ----
    await page.getByLabel(MAIN).dblclick();
    await expect(page.getByTestId("source-monitor")).toBeVisible();
    await expect.poll(async () => (await readSource(page)).tab).toBe("source");
    await settle(page, 500);
    await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
    const sourceSeek = (t: number) =>
      page.evaluate((s) => {
        const store = (window as unknown as { __openreelE2E: { source: { getState(): { setPosition(n: number): void; stop(): void } } } }).__openreelE2E.source.getState();
        store.stop();
        store.setPosition(s);
      }, t);
    await sourceSeek(1);
    await page.keyboard.press("i");
    await sourceSeek(3);
    await page.keyboard.press("o");
    await settle(page, 200);
    expect((await readSource(page)).marks).toEqual({ in: 1, out: 3 });

    const beforeSubclip = await historyLength(page);
    await page.getByTestId("subclip-restrict").click();
    await page.getByTestId("make-subclip").click();
    await expect.poll(async () => (await media(page)).filter((m) => m.subclip).length).toBe(1);
    expect(await historyLength(page)).toBe(beforeSubclip + 1);
    const sub = (await media(page)).find((m) => m.subclip)!;
    expect(sub.subclip).toMatchObject({ inPoint: 1, outPoint: 3, restrictTrims: true });
    expect(sub.binId).toBe(interviews.id);

    // List view: sortable columns; sort by duration both ways.
    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByTestId("media-list")).toBeVisible();
    const order = () =>
      page.getByTestId("media-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-label")));
    const durationHeader = page.getByRole("columnheader", { name: /Duration/ });
    await durationHeader.click();
    await expect(durationHeader).toHaveAttribute("aria-sort", "ascending");
    const asc = await order();
    expect(asc[0]).toContain(sub.name); // the 2s subclip is shorter than the 6s clip
    expect(asc[1]).toContain("three-scenes.mp4");
    await durationHeader.click();
    await expect(durationHeader).toHaveAttribute("aria-sort", "descending");
    expect((await order())[0]).toContain("three-scenes.mp4");
    // The duration cell shows the subclip window (2s), not the parent file.
    await expect(page.locator(`[data-testid="media-row"][data-media-id="${sub.id}"] [data-col="duration"]`)).toHaveText("00:00:02:00");

    // Column show / hide.
    await expect(page.getByRole("columnheader", { name: /Codec/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByTestId("column-toggle-codec").click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /Codec/ })).toBeVisible();
    await expect(page.locator(`[data-testid="media-row"][data-media-id="${sub.id}"] [data-col="codec"]`)).not.toHaveText("");
    // Usage count column (hidden by default since the compact list): turn it on, the placed clip uses three-scenes once.
    await expect(page.getByRole("columnheader", { name: /Usage/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByTestId("column-toggle-usage").click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /Usage/ })).toBeVisible();
    await expect(page.locator('[data-testid="media-row"]', { hasText: "three-scenes.mp4" }).locator('[data-col="usage"]')).toHaveText("1");

    // Comment field (inline edit, one undo step).
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByTestId("column-toggle-comment").click();
    await page.keyboard.press("Escape");
    const beforeComment = await historyLength(page);
    await page.locator(`[data-testid="media-row"][data-media-id="${sub.id}"] [data-col="comment"] span`).dblclick();
    await page.getByTestId("edit-comment").fill("pull quote");
    await page.getByTestId("edit-comment").press("Enter");
    await expect.poll(async () => (await media(page)).find((m) => m.id === sub.id)!.comment).toBe("pull quote");
    expect(await historyLength(page)).toBe(beforeComment + 1);

    // ---- (e) search by any column / a chosen column ----
    const search = page.getByLabel("Search media");
    await search.fill("pull quote");
    await expect(page.getByTestId("media-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Search in column" }).click();
    await page.getByTestId("search-in-name").click();
    await expect(page.getByTestId("media-row")).toHaveCount(0); // "pull quote" is not in any name
    await page.getByRole("button", { name: "Search in column" }).click();
    await page.getByTestId("search-in-comment").click();
    await expect(page.getByTestId("media-row")).toHaveCount(1);
    await search.fill("mango");
    await page.getByRole("button", { name: "Search in column" }).click();
    await page.getByTestId("search-in-label").click();
    // The subclip inherits its parent's label, so both rows match "mango".
    await expect(page.getByTestId("media-row")).toHaveCount(2);
    await search.fill("rose");
    await expect(page.getByTestId("media-row")).toHaveCount(0);
    await page.getByRole("button", { name: "Search in column" }).click();
    await page.getByTestId("search-in-all").click();
    await search.fill("");

    // ---- (d) insert the subclip: Source monitor opens with its window marked ----
    await page.locator(`[data-testid="media-row"][data-media-id="${sub.id}"]`).dblclick();
    await expect.poll(async () => (await readSource(page)).mediaId).toBe(sub.id);
    await expect.poll(async () => (await readSource(page)).marks).toEqual({ in: 1, out: 3 });
    await seek(page, 8);
    const preInsert = await readState(page);
    await page.getByRole("button", { name: "Insert (,)" }).click();
    await settle(page, 500);
    const afterInsert = await readState(page);
    const placed = afterInsert.tracks.flatMap((t) => t.clips).filter((c) => c.start >= 7.99);
    expect(placed.map((c) => [c.start, c.duration, c.inPoint, c.outPoint])).toEqual([[8, 2, 1, 3]]);
    expect(afterInsert.historyLength).toBe(preInsert.historyLength + 1);
    const insertedMediaId = await page.evaluate(() =>
      (window as unknown as E2EStores).__openreelE2E.project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.startTime >= 7.99)?.mediaId,
    );
    expect(insertedMediaId).toBe(sub.id);
    // The restriction is enforced: trimming the subclip's clip outside [1, 3] is refused.
    const refused = await page.evaluate(async ([mediaClip]) => {
      const store = (window as unknown as E2EStores).__openreelE2E.project.getState();
      const clip = store.project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.mediaId === mediaClip);
      const result = await store.executeAction({ type: "clip/trim", id: "trim-test", timestamp: Date.now(), params: { clipId: clip.id, inPoint: 0.5, outPoint: 3 } });
      return result.success;
    }, [sub.id]);
    expect(refused).toBe(false);
    await undo(page);
    expect(clipsOf(await readState(page), "Main").filter((c) => c.start >= 7.99)).toHaveLength(0);

    // ---- (e) Reveal in project from a timeline clip ----
    await page.getByRole("button", { name: "Grid view" }).click();
    await page.getByTestId("breadcrumb").filter({ hasText: "Project" }).click();
    await expect(page.getByLabel(MAIN)).toHaveCount(0); // lives in Interviews
    await page.locator('[data-timeline-item-id]').first().click({ button: "right" });
    await page.getByTestId("clip-reveal-in-project").click();
    await expect(page.getByTestId("breadcrumb")).toHaveText(["Project", "Interviews"]);
    await expect(page.getByLabel(MAIN)).toBeVisible();
    await expect(page.getByLabel(MAIN)).toHaveAttribute("aria-pressed", "true");

    // ---- (a) delete a bin with contents: confirmation, one undo restores everything ----
    await page.getByTestId("breadcrumb").filter({ hasText: "Project" }).click();
    const beforeDelete = await historyLength(page);
    await tile(page, "Audio").click({ button: "right" });
    await page.getByTestId("bin-delete").click();
    await expect(page.getByTestId("delete-bin-dialog")).toContainText("1 media item");
    await page.getByTestId("confirm-delete-bin").click();
    await expect.poll(async () => (await media(page)).some((m) => m.name === "tone-4s.wav")).toBe(false);
    expect((await bins(page)).some((b) => b.name === "Audio")).toBe(false);
    expect(await historyLength(page)).toBe(beforeDelete + 1);
    await press(page, "Meta+z");
    await expect.poll(async () => (await media(page)).some((m) => m.name === "tone-4s.wav")).toBe(true);
    expect((await bins(page)).some((b) => b.name === "Audio")).toBe(true);
    expect((await media(page)).find((m) => m.name === "tone-4s.wav")!.binId).toBe(audioBin.id);
  });

  test("2,000 items: virtualised list renders a window of rows; sort / filter / render times", async ({ page }, testInfo) => {
    await openEditor(page);
    const N = 2000;
    // Synthetic library: varied durations / codecs / labels, spread over 20 bins.
    await page.evaluate((count) => {
      const store = (window as unknown as E2EStores).__openreelE2E.project;
      const state = store.getState();
      const codecs = ["h264", "hevc", "prores", "vp9", "av1"];
      const labels = ["violet", "iris", "caribbean", "mango", "rose", "forest", undefined, undefined];
      const binsList = Array.from({ length: 20 }, (_, i) => ({ id: `bin-${i}`, name: `Bin ${i + 1}` }));
      const items = Array.from({ length: count }, (_, i) => ({
        id: `perf-${i}`,
        name: `Clip ${String(i).padStart(4, "0")} ${["interview", "broll", "drone", "cutaway"][i % 4]}`,
        type: i % 7 === 0 ? "audio" : "video",
        fileHandle: null,
        blob: null,
        metadata: {
          duration: 1 + ((i * 37) % 600) / 3,
          width: i % 3 ? 1920 : 3840,
          height: i % 3 ? 1080 : 2160,
          frameRate: [24, 25, 29.97, 30, 60][i % 5],
          codec: codecs[i % 5],
          sampleRate: 48000,
          channels: i % 2 ? 2 : 1,
          fileSize: 1_000_000 + i * 12345,
        },
        thumbnailUrl: null,
        waveformData: null,
        importedAt: 1_700_000_000_000 + i * 60_000,
        ...(labels[i % labels.length] ? { label: labels[i % labels.length] } : {}),
        ...(i % 10 === 0 ? { comment: `take ${i}` } : {}),
        ...(i % 2 === 0 ? { binId: `bin-${i % 20}` } : {}),
      }));
      const project = { ...state.project, bins: binsList, mediaLibrary: { ...state.project.mediaLibrary, items: [...state.project.mediaLibrary.items, ...items] } };
      store.setState({ project });
    }, N);

    // Whole-library search so the list holds all 2,000+ rows at once.
    const frames = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const timed = async (action: () => Promise<void>) => {
      const t0 = Date.now();
      await action();
      await frames();
      return Date.now() - t0;
    };

    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByTestId("media-list")).toBeVisible();
    // Show every row: search for a term every synthetic row matches ("clip").
    const search = page.getByLabel("Search media");
    const filterAll = await timed(async () => {
      await search.fill("clip");
      await expect(page.getByTestId("search-scope")).toContainText(`${N} results`);
    });
    const rendered = await page.getByTestId("media-row").count();
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(80); // windowed, not 2,000 DOM rows
    const domNodes = await page.getByTestId("media-list").evaluate((el) => el.querySelectorAll("*").length);

    const sortDuration = await timed(async () => {
      await page.getByRole("columnheader", { name: /Duration/ }).click();
      await expect(page.getByRole("columnheader", { name: /Duration/ })).toHaveAttribute("aria-sort", "ascending");
    });
    const firstDurations = await page.locator('[data-testid="media-row"] [data-col="duration"]').evaluateAll((els) => els.slice(0, 4).map((e) => e.textContent));
    expect(firstDurations.every((d, i, a) => i === 0 || (a[i - 1] ?? "") <= (d ?? ""))).toBe(true);
    const sortName = await timed(async () => {
      await page.getByRole("columnheader", { name: /^Name/ }).click();
      await expect(page.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute("aria-sort", "ascending");
    });
    const filterNarrow = await timed(async () => {
      await search.fill("clip 19 drone");
      await expect(page.getByTestId("search-scope")).toContainText("results");
    });
    const narrowCount = await page.getByTestId("media-row").count();
    expect(narrowCount).toBeGreaterThan(0);

    // Scrolling windows different rows in.
    await search.fill("clip");
    await expect(page.getByTestId("search-scope")).toContainText(`${N} results`);
    const firstBefore = await page.getByTestId("media-row").first().getAttribute("data-media-id");
    await page.getByTestId("media-list").evaluate((el) => { el.scrollTop = 26 * 1000; });
    await expect.poll(() => page.getByTestId("media-row").first().getAttribute("data-media-id")).not.toBe(firstBefore);

    const timings = await page.evaluate(() => (window as unknown as E2EStores).__openreelE2E.projectPanel.getState().timings);
    await page.screenshot({ path: testInfo.outputPath("list-2000.png") });

    // Grid view is windowed too (see project-grid-smart-bins.spec.ts): the root holds 20 bin tiles
    // plus ~1,000 media tiles but only the rows near the top are mounted.
    await search.fill("");
    await page.getByRole("button", { name: "Grid view" }).click();
    const gridRoot = await timed(async () => {
      await expect(page.getByTestId("media-grid")).toBeVisible();
      await expect(page.getByTestId("bin-tile").first()).toBeVisible();
    });
    const gridTiles = await page.locator('[data-testid="media-grid"] [data-grid-row] > *').count();
    expect(gridTiles).toBeLessThan(80);

    const report = { items: N + 1, listRowsInDom: rendered, listDomNodes: domNodes, filterAllMs: filterAll, sortDurationMs: sortDuration, sortNameMs: sortName, filterNarrowMs: filterNarrow, hookTimings: timings, gridRootTilesInDom: gridTiles, gridRootRenderMs: gridRoot };
    console.log("PERF-2000 " + JSON.stringify(report));
    testInfo.annotations.push({ type: "perf", description: JSON.stringify(report) });
    expect(sortDuration).toBeLessThan(2000);
    expect(filterAll).toBeLessThan(2000);
  });
});
