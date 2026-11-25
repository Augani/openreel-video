import { expect, test } from "@playwright/test";
import { clipsOf, openEditor, readSource, readState, seek, settle, shape, undo } from "./helpers";

/**
 * Text-based editing on a SOURCE clip: the Transcript tab of the Source monitor. The speech model is too heavy for CI,
 * so the clip's transcript comes from the same cache a transcription writes to (imported word-timed JSON). The test
 * then finds a phrase across all transcribed clips, selects text, and Inserts it: the timeline gets a clip whose source
 * In/Out are exactly the first word's start and the last word's end, as one undo step.
 */
const TRANSCRIPT = {
  language: "en",
  segments: [
    { speaker: "Ann", words: [
      { word: "Welcome", start: 0.5, end: 0.9 },
      { word: "to", start: 0.9, end: 1.0 },
      { word: "the", start: 1.0, end: 1.1 },
      { word: "show.", start: 1.1, end: 1.5 },
    ] },
    { speaker: "Ann", words: [
      { word: "Um,", start: 2.0, end: 2.3 },
      { word: "this", start: 2.5, end: 2.8 },
      { word: "is", start: 2.8, end: 3.0 },
      { word: "like", start: 3.0, end: 3.2 },
      { word: "great.", start: 3.2, end: 3.8 },
    ] },
    { speaker: "Bob", words: [
      { word: "Thanks", start: 4.5, end: 5.0 },
      { word: "all.", start: 5.0, end: 5.5 },
    ] },
  ],
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

test("source transcript: find a phrase, select text, Insert puts exactly that range on the timeline", async ({ page }) => {
  await openEditor(page);
  await page.getByLabel("Select media three-scenes.mp4").dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await page.getByTestId("source-transcript-toggle").click();
  await page.getByTestId("source-transcript-pane").waitFor();

  // Not transcribed yet: the tab offers to transcribe or import.
  await expect(page.getByTestId("source-transcript-transcribe")).toBeVisible();
  await page.getByTestId("source-transcript-import-input").setInputFiles({
    name: "three-scenes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(TRANSCRIPT)),
  });
  await expect(page.locator("[data-word-index]")).toHaveCount(11);

  // The transcript is cached in IndexedDB by media hash.
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("openreel-source-transcripts", 1);
        open.onsuccess = () => {
          const count = open.result.transaction("transcripts").objectStore("transcripts").count();
          count.onsuccess = () => resolve(count.result);
        };
        open.onerror = () => resolve(-1);
      }),
  );
  expect(stored).toBe(1);

  // Project-wide Find: the phrase lists a result that jumps to the source time.
  await page.getByTestId("source-transcript-scope-all").click();
  await page.getByTestId("source-transcript-search").fill("this is like");
  const result = page.getByTestId("source-transcript-result");
  await expect(result).toHaveCount(1);
  await result.click();
  await expect.poll(async () => (await readSource(page)).position).toBeCloseTo(2.5, 2);
  await expect(page.locator('[data-word-index][data-selected="true"]')).toHaveCount(3);
  expect((await readSource(page)).marks).toEqual({ in: 2.5, out: 3.2 });

  // Extend the selection to the end of the sentence with shift-click: this is like great.
  await page.getByTestId("source-transcript-search").fill("");
  await page.locator("[data-word-index]", { hasText: "great." }).click({ modifiers: ["Shift"] });
  await expect(page.locator('[data-word-index][data-selected="true"]')).toHaveCount(4);
  const marks = (await readSource(page)).marks;
  expect([round3(marks.in!), round3(marks.out!)]).toEqual([2.5, 3.8]);

  // Insert at the end of the sequence: one new clip, in/out exactly the selected words.
  await seek(page, 6);
  const before = await readState(page);
  await page.getByTestId("source-transcript-insert").click();
  await expect
    .poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 10_000 })
    .toBe(2);
  const after = await readState(page);
  expect(shape(clipsOf(after, "Main"))[1]).toEqual([6, 1.3, 2.5, 3.8]);
  expect(after.historyLength).toBe(before.historyLength + 1);

  await undo(page);
  await settle(page, 400);
  expect(shape(clipsOf(await readState(page), "Main"))).toEqual([[0, 6, 0, 6]]);
});
