import { expect, test, type Page } from "@playwright/test";
import { openEditor, press, seek } from "./helpers";

/**
 * Caption translation in real Chrome. A test double stands in for the browser's on-device
 * Translator API (headless Chrome ships without language packs); everything else is the real
 * editor: the Transcript panel, the translation command, the action system and undo.
 */

const TRANSCRIPT = {
  language: "en",
  segments: [
    { speaker: "Ann", words: [{ word: "Welcome", start: 0.5, end: 0.9 }, { word: "home.", start: 0.9, end: 1.5 }] },
    { speaker: "Bob", words: [{ word: "Thanks", start: 2.0, end: 2.5 }, { word: "all.", start: 2.5, end: 3.0 }] },
  ],
};

const mockTranslator = (ms: number) => {
  (window as any).Translator = {
    availability: async () => "available",
    create: async () => ({
      translate: (text: string, o?: { signal?: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => resolve(`[es] ${text}`), ms);
          o?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      destroy: () => {},
    }),
  };
};

const cues = (page: Page, track: string) =>
  page.evaluate((t) => {
    const subs = (window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[];
    return subs
      .filter((s) => (s.captionTrackId ?? "") === t)
      .map((s) => ({ text: s.text, start: s.startTime, end: s.endTime, speaker: s.speaker, language: s.language }))
      .sort((a, b) => a.start - b.start);
  }, track);

async function importAndOpenTranslate(page: Page) {
  await openEditor(page);
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
  await page.getByTestId("transcript-import-input").setInputFiles({
    name: "interview.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(TRANSCRIPT)),
  });
  await expect.poll(async () => (await cues(page, "")).length).toBe(2);
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await page.getByLabel("Source language").fill("en");
}

test("translates a caption track into a new track with the same timing, and undo removes it", async ({ page }) => {
  await page.addInitScript(mockTranslator, 5);
  await importAndOpenTranslate(page);
  await expect(page.getByTestId("translate-engine")).toContainText("Browser");
  await page.getByRole("button", { name: /^Translate to/ }).click();
  await expect.poll(async () => (await cues(page, "es")).length).toBe(2);

  const original = await cues(page, "");
  const translated = await cues(page, "es");
  expect(translated.map((c) => c.text)).toEqual(original.map((c) => `[es] ${c.text}`));
  expect(translated.map((c) => [c.start, c.end])).toEqual(original.map((c) => [c.start, c.end]));
  expect(translated.map((c) => c.speaker)).toEqual(original.map((c) => c.speaker));
  expect(translated.every((c) => c.language === "es")).toBe(true);
  expect(original.map((c) => c.text)).toEqual(["Welcome home.", "Thanks all."]);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await press(page, "Meta+z");
  await expect.poll(async () => (await cues(page, "es")).length).toBe(0);
  expect((await cues(page, "")).length).toBe(2);
});

test("cancelling a translation adds nothing", async ({ page }) => {
  await page.addInitScript(mockTranslator, 2000);
  await importAndOpenTranslate(page);
  await page.getByRole("button", { name: /^Translate to/ }).click();
  await expect(page.getByTestId("translate-progress")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Translate to/ })).toBeVisible();
  expect((await cues(page, "es")).length).toBe(0);
  expect((await cues(page, "")).length).toBe(2);
});

test("shows a clear unavailable state when no translator exists", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).Translator;
  });
  await importAndOpenTranslate(page);
  await expect(page.getByTestId("translate-unavailable")).toContainText("No translator is available");
  await expect(page.getByRole("button", { name: /^Translate to/ })).toBeDisabled();
});

const spyDrawnText = () => {
  const drawn: string[] = [];
  (window as any).__drawnText = drawn;
  const patch = (proto: { fillText: (...a: any[]) => void } | undefined) => {
    if (!proto) return;
    const original = proto.fillText;
    proto.fillText = function (this: unknown, text: string, ...rest: number[]) {
      drawn.push(String(text));
      return (original as any).call(this, text, ...rest);
    };
  };
  patch(CanvasRenderingContext2D.prototype);
  patch(typeof OffscreenCanvasRenderingContext2D === "undefined" ? undefined : OffscreenCanvasRenderingContext2D.prototype);
};

const drawnAt = async (page: Page, time: number) => {
  await page.evaluate(() => ((window as any).__drawnText.length = 0));
  // Move off and back so the preview redraws this frame.
  await seek(page, time + 0.4);
  await page.evaluate(() => ((window as any).__drawnText.length = 0));
  await seek(page, time);
  return page.evaluate(() => ((window as any).__drawnText as string[]).join(" | "));
};

test("the preview draws one language at a time; Show in picture switches it, and export follows", async ({ page }) => {
  await page.addInitScript(mockTranslator, 5);
  await page.addInitScript(spyDrawnText);
  await importAndOpenTranslate(page);
  await page.getByRole("button", { name: /^Translate to/ }).click();
  await expect.poll(async () => (await cues(page, "es")).length).toBe(2);

  // The translation is kept out of the picture: only the original is drawn, never both stacked.
  const hidden = await page.evaluate(() => {
    const subs = (window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[];
    return subs.filter((s) => s.captionTrackId === "es").every((s) => s.hidden === true) && subs.filter((s) => !s.captionTrackId).every((s) => !s.hidden);
  });
  expect(hidden).toBe(true);
  const original = await drawnAt(page, 1.0);
  expect(original.split(" | ")).toContain("Welcome home.");
  expect(original).not.toContain("[es]");

  // Show the translation: the original leaves the picture.
  await page.getByRole("switch", { name: "Show this caption track in the picture" }).click();
  await expect.poll(() => drawnAt(page, 1.0)).toContain("[es] Welcome home.");
  expect((await drawnAt(page, 1.0)).split(" | ")).not.toContain("Welcome home.");

  // Burned-in export uses the same selection.
  const burned = await page.evaluate(async () => {
    const subs = (window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[];
    return subs.filter((s) => !s.hidden).map((s) => s.captionTrackId ?? "");
  });
  expect(new Set(burned)).toEqual(new Set(["es"]));
});

test("export frames and cached segments draw only the visible track, never the hidden translation", async ({ page }) => {
  await page.addInitScript(mockTranslator, 5);
  await page.addInitScript(spyDrawnText);
  await importAndOpenTranslate(page);
  await page.getByRole("button", { name: /^Translate to/ }).click();
  await expect.poll(async () => (await cues(page, "es")).length).toBe(2);

  // The engine path that exportFrame / image / GIF / render-bridge / render-cache all go through.
  const drawn = await page.evaluate(async () => {
    const e2e = (window as any).__openreelE2E;
    const project = e2e.project.getState().project;
    (window as any).__drawnText.length = 0;
    const frame = await e2e.video.getVideoEngine().renderFrame(project, 1.0, 640, 360);
    frame.image?.close?.();
    return ((window as any).__drawnText as string[]).join(" | ");
  });
  expect(drawn.split(" | ")).toContain("Welcome home.");
  expect(drawn).not.toContain("[es]");
});
