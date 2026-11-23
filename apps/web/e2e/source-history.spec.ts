import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, openEditor, press, readSource, readState, seek, settle, splitIntoThree } from "./helpers";

/**
 * Source monitor history keeps each clip's In/Out and playhead, and Reverse Match Frame (Shift+F)
 * cycles through every instance of the Source frame in the sequence.
 */

interface Hook {
  __openreelE2E: { source: { getState(): { setPosition(n: number): void; stop(): void; setMark(id: string, w: "in" | "out", s: number | null): void; mediaId: string | null } } };
}

async function sourceSeek(page: Page, seconds: number) {
  await page.evaluate((t) => {
    const s = (window as unknown as Hook).__openreelE2E.source.getState();
    s.stop();
    s.setPosition(t);
  }, seconds);
  await settle(page, 300);
}

test("history entry shows In/Out and playhead; Shift+F cycles instances and wraps", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await splitIntoThree(page);

  // Duplicate the first scene (source 0..2s) at 8s so that source frame 1s has two instances.
  const first = clipsOf(await readState(page), "Main")[0];
  await clickClip(page, first.id);
  await press(page, "Meta+c");
  await seek(page, 8);
  await press(page, "Meta+v");
  await expect.poll(async () => clipsOf(await readState(page), "Main").length).toBe(4);

  // Load the media in the Source monitor, mark it and park the playhead.
  await page.getByLabel("Select media three-scenes.mp4").dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await expect.poll(async () => (await readSource(page)).tab).toBe("source");
  const mediaId = (await readSource(page)).mediaId!;
  await page.evaluate((id) => {
    const s = (window as unknown as Hook).__openreelE2E.source.getState();
    s.setMark(id, "in", 0.5);
    s.setMark(id, "out", 1.5);
  }, mediaId);
  await sourceSeek(page, 1);

  // The history dropdown lists the clip with its marks and playhead.
  await page.getByTestId("source-history").click();
  await expect(page.getByTestId("source-history-item")).toHaveCount(1);
  await expect(page.getByTestId("source-history-detail").first()).toHaveText(/In 00:00:00:15 · Out 00:00:01:15 · at 00:00:01:00/);
  await page.keyboard.press("Escape");

  // Shift+F lands on an instance; pressing it again cycles to the other one, then wraps back.
  const positions: number[] = [];
  await page.getByTestId("source-monitor").click({ position: { x: 20, y: 60 } });
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Shift+F");
    await expect.poll(async () => {
      const p = (await readState(page)).playhead;
      return Math.abs(p - 1) < 0.05 || Math.abs(p - 9) < 0.05;
    }).toBe(true);
    positions.push(Math.round((await readState(page)).playhead));
    await settle(page, 200);
  }
  expect(new Set(positions.slice(0, 2)).size).toBe(2);
  expect(positions[2]).toBe(positions[0]);
});
