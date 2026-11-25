import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./helpers";

/**
 * Media and audio browsers: no contradictory states.
 *  - Recordings is a real panel (not a modal) and stays the active tab.
 *  - Stock has no duplicate Music / Sound FX tabs (they live under Audio).
 *  - Sound library chips never lead to an empty list, and no duration reads 00:00.
 */
test("Recordings tab stays active and lists takes in a panel", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("tab", { name: "Recordings" }).click();
  await expect(page.getByRole("tab", { name: "Recordings" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("recordings-panel")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("No recordings yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record voice-over", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record screen or camera", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Stock offers footage and backgrounds only", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("tab", { name: "Stock" }).click();
  const tabs = page.getByRole("tablist", { name: "Stock sources" }).getByRole("tab");
  await expect(tabs).toHaveText(["Footage", "Backgrounds"]);
});

test("sound library chips are never empty and durations are real", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Audio", exact: true }).first().click();
  await expect(page.getByText(/Generated demo loops/)).toBeVisible();
  const chips = page.getByRole("group", { name: "Sound filters" }).getByRole("button");
  await expect(chips.first()).toBeVisible();
  for (const name of ["Afrobeats", "Nature", "Human", "Mechanical", "Horror"]) {
    await expect(chips.filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
  }
  // Loops are whole bars at their own tempo, so lengths differ instead of every loop reading 8.0s.
  await expect(page.locator(".workspace-sound-title time").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("sound-library-progress")).toHaveCount(0, { timeout: 90000 });
  const loopTimes = await page.locator(".workspace-sound-title time").allTextContents();
  expect(new Set(loopTimes).size).toBeGreaterThan(2);
  // One unit for the whole list: tenths of a second, never mm:ss mixed in.
  await expect(page.getByTestId("sound-library-progress")).toHaveCount(0, { timeout: 60000 });
  const allLoopTimes = await page.locator(".workspace-sound-title time").allTextContents();
  for (const t of allLoopTimes) expect(t).toMatch(/^\d+\.\ds$/);
  await page.getByRole("tab", { name: "Sound FX" }).click();
  await expect(page.getByText(/Generated sound effects/)).toBeVisible();
  await expect(page.locator(".workspace-sound-title time").first()).toBeVisible();
  const times = await page.locator(".workspace-sound-title time").allTextContents();
  expect(times.length).toBeGreaterThan(0);
  for (const t of times) expect(t).not.toBe("00:00");
});

const seedMedia = async (page: Page) =>
  page.evaluate(() => {
    const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(s: unknown): void } } }).__openreelE2E.project;
    const state = store.getState();
    const metadata = { duration: 6, width: 1280, height: 720, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 10 };
    const base = { fileHandle: null, thumbnailUrl: null, waveformData: null, sourceFile: { name: "x", size: 1, lastModified: 0 }, metadata };
    const items = [
      { ...base, id: "m-offline", name: "Offline.mp4", type: "video", blob: null, isPlaceholder: true },
      { ...base, id: "m-wave", name: "Song.mp3", type: "audio", blob: null, waveformData: [0.1, 0.9, 0.4, 0.7, 0.2, 0.8] },
      { ...base, id: "m-take", name: "Interview take 2.webm", type: "video", blob: null, metadata: { ...metadata, recordedTake: "screen" } },
    ];
    store.setState({ project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items } } });
  });

test("media bin shows offline and waveform tiles and keeps the grid clear of an empty Proxies strip", async ({ page }) => {
  await openEditor(page);
  await seedMedia(page);
  await expect(page.getByTestId("media-offline-tile").first()).toContainText("Media offline");
  await expect(page.getByTestId("media-audio-wave")).toBeVisible();
  await expect(page.getByText("No proxies yet")).toHaveCount(0);
  // Offline banners share one row instead of stacking above the grid.
  const bar = await page.getByTestId("missing-assets-bar").boundingBox();
  expect(bar?.height ?? 99).toBeLessThan(40);
});

test("Recordings lists a renamed take by provenance", async ({ page }) => {
  await openEditor(page);
  await seedMedia(page);
  await page.getByRole("tab", { name: "Recordings" }).click();
  await expect(page.getByTestId("recordings-panel").getByText("Interview take 2.webm")).toBeVisible();
});

test("music rows stream in with real progress and distinct waveforms", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Audio", exact: true }).first().click();
  // First row must appear well before the whole library is generated.
  const started = Date.now();
  await expect(page.locator(".workspace-sound-row").first()).toBeVisible({ timeout: 30000 });
  const firstRow = Date.now() - started;
  const progress = page.getByTestId("sound-library-progress");
  if (await progress.count()) await expect(progress).toContainText(/Generating demo loops \d+ of \d+/);
  await expect(progress).toHaveCount(0, { timeout: 60000 });
  console.log(`first music row after ${firstRow} ms`);
  // The waveform bars are the real loudness envelope, so two loops differ.
  const shapes = await page.locator(".workspace-sound-row").evaluateAll((rows) =>
    rows.slice(0, 8).map((row) => [...row.querySelectorAll(".workspace-sound-waveform span")].map((b) => (b as HTMLElement).style.height).join(",")),
  );
  expect(new Set(shapes).size).toBe(shapes.length);
  await page.screenshot({ path: test.info().outputPath("music-loaded.png") });
});

test("an offline item that still has a thumbnail shows the hatched offline tile", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(s: unknown): void } } }).__openreelE2E.project;
    const state = store.getState();
    const metadata = { duration: 6, width: 1280, height: 720, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 10 };
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 160, 90);
    gradient.addColorStop(0, "#f59e0b"); gradient.addColorStop(1, "#1d4ed8");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 160, 90);
    const items = [{ id: "m-gone", name: "Ocean_Gold.mp4", type: "video", blob: null, fileHandle: null, isPlaceholder: true, thumbnailUrl: canvas.toDataURL(), waveformData: null, sourceFile: { name: "x", size: 1, lastModified: 0 }, metadata }];
    store.setState({ project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items } } });
  });
  const tile = page.getByTestId("media-offline-tile");
  await expect(tile).toBeVisible();
  await expect(tile).toContainText("Media offline");
  await expect(tile).toHaveClass(/has-thumbnail/);
  await page.screenshot({ path: test.info().outputPath("offline-with-thumbnail.png") });
});

test("the media grid keeps most of the panel when an item is offline", async ({ page }) => {
  await openEditor(page);
  await seedMedia(page);
  const panel = await page.getByTestId("project-panel").boundingBox();
  const tile = await page.locator(".workspace-media-tile").first().boundingBox();
  const scroll = await page.locator(".workspace-media-scroll").first().boundingBox();
  expect(panel && tile && scroll).toBeTruthy();
  // The scrolling grid owns at least half of the Project panel (was ~44% with sequences + proxies + a separate missing bar).
  expect(scroll!.height / panel!.height).toBeGreaterThan(0.5);
  // Header controls are one row: nothing may be truncated.
  await expect(page.getByTestId("missing-assets-bar")).toContainText("Relink");
  await page.screenshot({ path: test.info().outputPath("media-offline-layout.png") });
});
