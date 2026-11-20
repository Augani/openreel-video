import { expect, test, type Page } from "@playwright/test";
import { clipsOf, openEditor, readState, seek, settle, shape, undo, redo } from "./helpers";

/**
 * Transcript-based editing against the generated three-scenes.mp4 (6 s, picture
 * and a 440 Hz tone). The fixture transcript has word timings; the picture's
 * audio is separated onto Dialogue (linked to the picture). Deleting a sentence
 * in the Transcript panel must ripple-cut that exact range from picture and
 * sound together as ONE undo step, and WebVTT export must be valid.
 */
const TRANSCRIPT = {
  language: "en",
  segments: [
    {
      speaker: "Ann",
      words: [
        { word: "Welcome", start: 0.5, end: 0.9 },
        { word: "to", start: 0.9, end: 1.0 },
        { word: "the", start: 1.0, end: 1.1 },
        { word: "show.", start: 1.1, end: 1.5 },
      ],
    },
    {
      speaker: "Ann",
      words: [
        { word: "Um,", start: 2.0, end: 2.3 },
        { word: "this", start: 2.5, end: 2.8 },
        { word: "is", start: 2.8, end: 3.0 },
        { word: "like", start: 3.0, end: 3.2 },
        { word: "great.", start: 3.2, end: 3.8 },
      ],
    },
    {
      speaker: "Bob",
      words: [
        { word: "Thanks", start: 4.5, end: 5.0 },
        { word: "all.", start: 5.0, end: 5.5 },
      ],
    },
  ],
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function openTranscript(page: Page) {
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
  await page.getByTestId("transcript-import-input").setInputFiles({
    name: "interview.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(TRANSCRIPT)),
  });
  await expect(page.locator("[data-word-index]")).toHaveCount(11);
}

async function layout(page: Page) {
  await openEditor(page);
  const state = await readState(page);
  const main = clipsOf(state, "Main")[0];
  const sep = await page.evaluate(
    (id) => (window as any).__openreelE2E.project.getState().separateAudio(id),
    main.id,
  );
  expect(sep.success, JSON.stringify(sep)).toBe(true);
  await settle(page, 500);
  const after = await readState(page);
  expect(shape(clipsOf(after, "Main"))).toEqual([[0, 6, 0, 6]]);
  expect(shape(clipsOf(after, "Dialogue"))).toEqual([[0, 6, 0, 6]]);
}

const sub = (page: Page) =>
  page.evaluate(() =>
    (window as any).__openreelE2E.project
      .getState()
      .project.timeline.subtitles.map((s: any) => ({
        id: s.id,
        text: s.text,
        start: s.startTime,
        end: s.endTime,
        speaker: s.speaker,
      })),
  );

const word = (page: Page, text: string) => page.locator("[data-word-index]", { hasText: text }).first();

test.describe("Transcript editing", () => {
  test("deleting a sentence ripple-cuts linked picture and sound at the exact times, one undo step", async ({ page }) => {
    await layout(page);
    await openTranscript(page);
    const before = await readState(page);

    // Click a word: the playhead seeks to its start.
    await word(page, "great.").click();
    await expect.poll(async () => (await readState(page)).playhead).toBeCloseTo(3.2, 3);

    // Highlight follows the playhead.
    await seek(page, 2.6);
    await expect(page.locator('[data-word-index][data-active="true"]')).toHaveText("this");

    // Double-click selects the whole sentence; Delete cuts it.
    await word(page, "great.").dblclick();
    await expect(page.locator('[data-word-index][data-selected="true"]')).toHaveCount(5);
    await page.keyboard.press("Delete");

    await expect
      .poll(async () => shape(clipsOf(await readState(page), "Main")).length, { timeout: 10_000 })
      .toBe(2);
    const after = await readState(page);
    // Sentence 2 is words 2.0 .. 3.8: the picture and the sound lose exactly 1.8 s.
    expect(shape(clipsOf(after, "Main")).map((c) => c.slice(0, 2))).toEqual([[0, 2], [2, 2.2]]);
    expect(shape(clipsOf(after, "Dialogue"))).toEqual(shape(clipsOf(after, "Main")));
    const main = clipsOf(after, "Main");
    const dialogue = clipsOf(after, "Dialogue");
    // Source in/out points: the second piece resumes at 3.8 s of the source.
    expect(round3(main[1].inPoint)).toBe(3.8);
    expect(round3(dialogue[1].inPoint)).toBe(3.8);
    expect(main.map((c) => round3(c.start))).toEqual(dialogue.map((c) => round3(c.start)));
    expect(after.historyLength).toBe(before.historyLength + 1);

    // Captions rippled with the cut; the deleted sentence is gone.
    const subs = await sub(page);
    expect(subs.map((s: any) => s.text)).toEqual(["Welcome to the show.", "Thanks all."]);
    expect(round3(subs[1].start)).toBe(2.7);
    await expect(page.locator("[data-word-index]")).toHaveCount(6);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(shape(clipsOf(undone, "Dialogue"))).toEqual(shape(clipsOf(before, "Dialogue")));
    expect(undone.historyLength).toBe(before.historyLength);
    expect((await sub(page)).map((s: any) => s.text)).toHaveLength(3);
    await redo(page);
    expect(shape(clipsOf(await readState(page), "Main")).map((c) => c.slice(0, 2))).toEqual([[0, 2], [2, 2.2]]);
  });

  test("filler words preview then remove in one undo step; pauses likewise", async ({ page }) => {
    await layout(page);
    await openTranscript(page);
    const before = await readState(page);

    await page.getByRole("button", { name: "Remove filler words" }).click();
    const preview = page.getByRole("region", { name: "Filler word preview" });
    await expect(preview.getByRole("checkbox")).toHaveCount(2);
    // Nothing changed yet.
    expect((await readState(page)).historyLength).toBe(before.historyLength);
    await preview.getByRole("button", { name: /Remove 2 fillers/ }).click();

    await expect.poll(async () => (await sub(page)).map((s: any) => s.text).join("|")).toBe(
      "Welcome to the show.|this is great.|Thanks all.",
    );
    const after = await readState(page);
    // "Um," (2.0-2.3) and "like" (3.0-3.2) removed: 0.5 s.
    const total = clipsOf(after, "Main").reduce((sum, c) => sum + c.duration, 0);
    expect(round3(total)).toBe(5.5);
    expect(shape(clipsOf(after, "Dialogue"))).toEqual(shape(clipsOf(after, "Main")));
    expect(after.historyLength).toBe(before.historyLength + 1);

    await page.getByRole("button", { name: "Remove pauses" }).click();
    await page.getByLabel("Minimum pause length in seconds").fill("0.5");
    await page.getByRole("button", { name: /Remove \d+ pauses?/ }).click();
    await expect.poll(async () => (await readState(page)).historyLength).toBe(before.historyLength + 2);
    const paused = await readState(page);
    expect(shape(clipsOf(paused, "Dialogue"))).toEqual(shape(clipsOf(paused, "Main")));
    expect(clipsOf(paused, "Main").reduce((sum, c) => sum + c.duration, 0)).toBeLessThan(5.5);

    await undo(page);
    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(shape(clipsOf(before, "Main")));
    expect(undone.historyLength).toBe(before.historyLength);
  });

  test("renaming a speaker updates every caption; WebVTT export is valid and carries the speakers", async ({ page }) => {
    await layout(page);
    await openTranscript(page);

    await page.getByRole("button", { name: "Speaker Ann. Click to rename" }).first().click();
    const input = page.getByLabel("Rename speaker Ann");
    await input.fill("Annabel");
    await input.press("Enter");
    await expect.poll(async () => (await sub(page)).map((s: any) => s.speaker)).toEqual(["Annabel", "Annabel", "Bob"]);

    await page.getByLabel("Caption export format").click();
    await page.getByRole("option", { name: "WebVTT" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export captions" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("captions.vtt");
    const stream = await download.createReadStream();
    let vtt = "";
    for await (const chunk of stream) vtt += chunk.toString("utf8");

    // Validate the WebVTT structure: header, numbered cues with HH:MM:SS.mmm
    // timings that increase, voice tags with a closing tag, no blank lines in cues.
    const lines = vtt.split("\n");
    expect(lines[0]).toBe("WEBVTT");
    expect(lines[1]).toBe("");
    // The caption style model may add a STYLE block before the cues.
    const blocks = vtt.trim().split(/\n\n/).slice(1).filter((block) => !block.startsWith("STYLE"));
    expect(blocks).toHaveLength(3);
    const timing = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
    let last = -1;
    const expected = [
      ["00:00:00.500", "00:00:01.500", "<v Annabel>Welcome to the show.</v>"],
      ["00:00:02.000", "00:00:03.800", "<v Annabel>Um, this is like great.</v>"],
      ["00:00:04.500", "00:00:05.500", "<v Bob>Thanks all.</v>"],
    ];
    blocks.forEach((block, i) => {
      const [id, time, ...text] = block.split("\n");
      expect(id).toBe(String(i + 1));
      const m = timing.exec(time);
      expect(m, time).not.toBeNull();
      const start = +m![1] * 3600 + +m![2] * 60 + +m![3] + +m![4] / 1000;
      const end = +m![5] * 3600 + +m![6] * 60 + +m![7] + +m![8] / 1000;
      expect(end).toBeGreaterThan(start);
      expect(start).toBeGreaterThanOrEqual(last);
      last = end;
      expect(time).toBe(`${expected[i][0]} --> ${expected[i][1]}`);
      expect(text.join("\n")).toBe(expected[i][2]);
    });
  });
});
