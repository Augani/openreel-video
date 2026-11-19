import { expect, test, type Page } from "@playwright/test";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clipsOf, importInput, openEditor, readState, seek, settle, shape, undo, redo } from "./helpers";

/**
 * Speaker diarization, reassign and per-speaker caption looks against the generated three-scenes.mp4 (6 s, picture
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

/**
 * fixtures/two-voices.mp4: six passages read alternately by two different synthetic voices (macOS Daniel / Samantha,
 * AAC 32 kbps), 0.5 s apart. Passage times in seconds.
 */
const TWO_VOICES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "two-voices.mp4");
const PASSAGES: Array<[number, number]> = [
  [0.5, 5.2],
  [5.7, 9.9],
  [10.4, 14.7],
  [15.2, 19.3],
  [19.9, 23.7],
  [24.2, 28.8],
];
const INTERVIEW = {
  language: "en",
  segments: PASSAGES.map(([start, end], i) => ({
    words: [
      { word: `Passage${i + 1}`, start, end: start + 1 },
      { word: "speaks", start: (start + end) / 2 - 0.5, end: (start + end) / 2 + 0.5 },
      { word: "here.", start: end - 1, end },
    ],
  })),
};

async function openTwoVoices(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(TWO_VOICES);
  await page.getByLabel(`Select media ${basename(TWO_VOICES)}`).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: `Media actions for ${basename(TWO_VOICES)}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
  await page.getByTestId("transcript-import-input").setInputFiles({
    name: "interview.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(INTERVIEW)),
  });
  await expect(page.locator("[data-word-index]")).toHaveCount(18);
}

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


test.describe("Speaker diarization", () => {
  test("recolour, reposition and reassign speakers; each is one undo step and styles the captions", async ({ page }) => {
    await layout(page);
    await openTranscript(page);
    const subs = () =>
      page.evaluate(() => {
        const s = (window as any).__openreelE2E.project.getState().project;
        return { cues: s.timeline.subtitles.map((c: any) => ({ speaker: c.speaker, color: c.style?.color, position: c.style?.position })), speakers: s.speakers };
      });
    const history = async () => (await readState(page)).historyLength;
    const base = await history();

    await page.getByRole("button", { name: /^Speakers/ }).click();
    const colour = page.getByLabel("Colour for Bob");
    // React tracks the instance value, so set it through the prototype setter like a real picker does.
    await colour.evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "#ff0000");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await subs()).cues[2].color).toBe("#ff0000");
    await page.getByLabel("Caption position for Bob").selectOption("top");
    await expect.poll(async () => (await subs()).cues[2].position).toBe("top");
    expect((await subs()).cues[0].color).toBe("#4F9DFF");

    // Reassign the last passage to Ann: the cue takes Ann's look.
    await page.getByLabel("Reassign speaker for this passage").last().selectOption("Ann");
    await expect.poll(async () => (await subs()).cues.map((c: any) => c.speaker)).toEqual(["Ann", "Ann", "Ann"]);
    expect(await history()).toBe(base + 3);

    await undo(page);
    await expect.poll(async () => (await subs()).cues[2].speaker).toBe("Bob");
    await undo(page);
    await undo(page);
    await expect.poll(async () => (await subs()).cues[2].color).toBeUndefined();
    await redo(page);
    await expect.poll(async () => (await subs()).cues[2].color).toBe("#ff0000");
  });

  test("Detect speakers (Auto) separates two real voices, and re-detecting keeps renames without stale profiles", async ({ page }) => {
    test.setTimeout(240_000);
    await openTwoVoices(page);
    const project = () =>
      page.evaluate(() => {
        const p = (window as any).__openreelE2E.project.getState().project;
        return {
          cues: p.timeline.subtitles.map((c: any) => ({ speaker: c.speaker, color: c.style?.color, position: c.style?.position, base: c.speakerBase })),
          speakers: (p.speakers ?? []).map((x: any) => ({ name: x.name, color: x.color, position: x.position })),
        };
      });
    const speakers = async () => (await project()).cues.map((c: any) => c.speaker);
    const history = async () => (await readState(page)).historyLength;
    const base = await history();

    // Default Auto detection, no hint about the number of voices.
    await expect(page.getByLabel("Number of speakers")).toHaveValue("auto");
    await page.getByRole("button", { name: "Detect speakers" }).click();
    const alternating = ["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2"];
    await expect.poll(speakers, { timeout: 120_000 }).toEqual(alternating);
    expect(await history()).toBe(base + 1);
    const detected = await project();
    expect(detected.speakers.map((s: any) => s.name)).toEqual(["Speaker 1", "Speaker 2"]);
    expect(detected.cues[0].color).toBe(detected.speakers[0].color);
    expect(detected.cues[1].color).toBe(detected.speakers[1].color);

    // The panel states the approximate nature of voice matching.
    await expect(page.getByTestId("speaker-limits-note")).toContainText(/approximate/i);

    // The speaker list stays one compact line and leaves the passages their room.
    const list = page.getByRole("region", { name: "Speakers" });
    expect((await list.boundingBox())!.height).toBeLessThan(40);
    await list.getByRole("button", { name: /^Speakers/ }).click();
    await expect(page.getByLabel("Colour for Speaker 1")).toBeVisible();

    // Rename + reposition one speaker, clear another passage's speaker.
    await page.getByRole("button", { name: "Speaker Speaker 1. Click to rename" }).first().click();
    await page.getByLabel("Rename speaker Speaker 1").fill("Host");
    await page.keyboard.press("Enter");
    await expect.poll(speakers).toEqual(["Host", "Speaker 2", "Host", "Speaker 2", "Host", "Speaker 2"]);
    await page.getByLabel("Caption position for Host").selectOption("top");
    await expect.poll(async () => (await project()).cues[0].position).toBe("top");
    await page.getByLabel("Reassign speaker for this passage").nth(3).selectOption("No speaker");
    await expect.poll(async () => (await project()).cues[3].speaker).toBeUndefined();
    // The speaker's look is taken off the cue again: nothing is left baked on a cue without a speaker.
    const cleared = (await project()).cues[3];
    expect(cleared.color).toBeUndefined();
    expect(cleared.base).toBeUndefined();

    // Detect again: Host stays Host with its look, nothing is orphaned, no duplicate Speaker 1.
    await page.getByRole("button", { name: "Detect speakers" }).click();
    await expect.poll(speakers, { timeout: 120_000 }).toEqual(["Host", "Speaker 2", "Host", "Speaker 2", "Host", "Speaker 2"]);
    const again = await project();
    expect(again.speakers.map((s: any) => s.name)).toEqual(["Host", "Speaker 2"]);
    expect(again.speakers[0]).toMatchObject({ color: detected.speakers[0].color, position: "top" });
    expect(again.cues[3].color).toBe(again.speakers[1].color);
  });
  test("with a hidden translated track present, detection finds the same speakers and the translation follows", async ({ page }) => {
    test.setTimeout(240_000);
    await openTwoVoices(page);
    // Add a hidden Spanish track with the same timings as the English cues.
    await page.evaluate(async () => {
      const e2e = (window as any).__openreelE2E.project.getState();
      const source = e2e.project.timeline.subtitles as any[];
      const translated = source.map((c) => ({
        ...c,
        id: `es-${c.id}`,
        text: `[es] ${c.text}`,
        language: "es",
        captionTrackId: "track-es",
        hidden: true,
        words: [],
      }));
      await e2e.executeAction({
        type: "subtitle/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { subtitles: [...source, ...translated] },
      });
    });
    const read = () =>
      page.evaluate(() => {
        const p = (window as any).__openreelE2E.project.getState().project;
        const subs = p.timeline.subtitles as any[];
        const pick = (hidden: boolean) =>
          subs.filter((c) => Boolean(c.hidden) === hidden).sort((a, b) => a.startTime - b.startTime).map((c) => ({ speaker: c.speaker, color: c.style?.color }));
        return { source: pick(false), translated: pick(true), profiles: (p.speakers ?? []).map((x: any) => x.name) };
      });
    await expect.poll(async () => (await read()).translated.length).toBe(6);
    await page.getByRole("button", { name: "Detect speakers" }).click();
    const alternating = ["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2"];
    await expect.poll(async () => (await read()).source.map((c: any) => c.speaker), { timeout: 120_000 }).toEqual(alternating);
    const detected = await read();
    // Same count as without translation, and the translated cues carry the same speakers and colours.
    expect(detected.profiles).toEqual(["Speaker 1", "Speaker 2"]);
    expect(detected.translated).toEqual(detected.source);
  });
});
