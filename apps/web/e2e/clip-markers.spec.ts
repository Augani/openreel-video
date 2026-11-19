import { expect, test, type Page } from "@playwright/test";
import { clipLocator, clipsOf, openEditor, readState, seek, setZoom, settle, splitIntoThree, undo } from "./helpers";

/**
 * Master-clip markers: a marker set in the Source monitor lives on the media and shows on every
 * timeline instance at the right offset (here: only on the split clip whose source range holds it).
 */

const MEDIA = "Select media three-scenes.mp4";

interface Hook {
  __openreelE2E: {
    project: { getState(): { project: { mediaLibrary: { items: { id: string; markers?: { time: number; label: string }[] }[] } } } };
  };
}

const masterMarkers = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Hook).__openreelE2E.project
      .getState()
      .project.mediaLibrary.items.flatMap((i) => i.markers ?? [])
      .map((m) => ({ time: m.time, label: m.label })),
  );

test("a Source monitor marker shows on the timeline instance that contains it, lists in the panel and undoes", async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await splitIntoThree(page);
  await setZoom(page, 100);

  await page.getByLabel(MEDIA).dblclick();
  await expect(page.getByTestId("source-monitor")).toBeVisible();
  await settle(page, 500);
  await page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { source: { getState(): { setPosition(n: number): void; stop(): void } } } }).__openreelE2E;
    e.source.getState().stop();
    e.source.getState().setPosition(3);
  });
  await settle(page, 300);
  await page.getByTestId("source-add-marker").click();
  await expect.poll(async () => (await masterMarkers(page)).length).toBe(1);
  expect((await masterMarkers(page))[0].time).toBeCloseTo(3, 2);
  await expect(page.getByTestId("source-marker-tick")).toHaveCount(1);

  // Back to the program: only the middle scene (source 2s..4s) shows the flag, 1s into the clip.
  await seek(page, 3);
  await expect(page.getByTestId("clip-marker-flag")).toHaveCount(1);
  const middle = clipsOf(await readState(page), "Main")[1];
  const flag = page.getByTestId("clip-marker-flag");
  const clipBox = await clipLocator(page, middle.id).boundingBox();
  const flagBox = await flag.boundingBox();
  if (clipBox && flagBox) expect(Math.abs(flagBox.x - clipBox.x - 100)).toBeLessThan(8);

  // Markers panel, Clips view.
  await page.getByRole("button", { name: "Markers", exact: true }).click();
  await page.getByTestId("markers-scope-clips").click();
  await expect(page.getByTestId("clip-marker-row")).toHaveCount(1);
  await expect(page.getByTestId("clip-marker-row")).toHaveAttribute("data-scope", "master");
  await expect(page.getByTestId("clip-marker-time")).not.toHaveText("");

  // One undo removes it everywhere.
  await undo(page);
  await expect.poll(async () => (await masterMarkers(page)).length).toBe(0);
  await expect(page.getByTestId("clip-marker-flag")).toHaveCount(0);
});
