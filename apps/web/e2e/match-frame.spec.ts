import { expect, test } from "@playwright/test";
import { clipsOf, openEditor, readSource, readState, seek, settle } from "./helpers";

async function sourceSeek(page: import("@playwright/test").Page, seconds: number) {
  await page.evaluate((t) => {
    const e = (window as unknown as { __openreelE2E: { source: { getState(): { setPosition(n: number): void; stop(): void } } } }).__openreelE2E;
    e.source.getState().stop();
    e.source.getState().setPosition(t);
  }, seconds);
  await settle(page, 300);
}

test("Reverse Match Frame finds the Source frame in the sequence; history lists the clip", async ({ page }) => {
  await openEditor(page);
  const clip = clipsOf(await readState(page), "Main")[0];
  await seek(page, 0);

  await page.getByLabel("Select media three-scenes.mp4").dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await expect.poll(async () => (await readSource(page)).tab).toBe("source");

  // History dropdown shows the loaded clip.
  await page.getByTestId("source-history").click();
  await expect(page.getByTestId("source-history-item")).toHaveCount(1);
  await expect(page.getByTestId("source-history-item").first()).toContainText("three-scenes.mp4");
  await page.keyboard.press("Escape");

  // Shift+F with the Source monitor focused moves the playhead to the matching frame.
  await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
  await sourceSeek(page, clip.inPoint + 1.5);
  await page.keyboard.press("Shift+F");
  await expect.poll(async () => (await readState(page)).playhead).toBeCloseTo(clip.start + 1.5, 1);

  // A frame outside the sequence leaves the playhead and warns.
  const before = (await readState(page)).playhead;
  await sourceSeek(page, clip.outPoint + 5);
  await page.getByTestId("reverse-match-frame").click();
  await expect(page.getByText(/not in the sequence/i).first()).toBeVisible();
  expect((await readState(page)).playhead).toBeCloseTo(before, 3);
});
