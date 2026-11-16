import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { clickClip, clipsOf, focusEditor, openEditor, press, readState, seek, setZoom, settle, splitIntoThree, track, undo } from "./helpers";

/**
 * Markers: M adds, the Markers panel lists and edits, Shift+Up/Down navigate, Alt-drag on the ruler makes a
 * range marker that survives autosave + reload, chapters export, and a ripple delete moves markers with the edit.
 */

interface MarkerState {
  id: string;
  time: number;
  label: string;
  duration?: number;
  comment?: string;
}

interface ProjectHook {
  getState(): {
    project: { id: string; timeline: { markers: MarkerState[] } };
    addMarker(time: number, label: string, color: string, extra: { kind: string }): Promise<unknown>;
    forceSave(): Promise<unknown>;
    checkForRecovery(): Promise<{ id: string }[]>;
    recoverFromAutoSave(id: string): Promise<boolean>;
  };
  setState(value: unknown): void;
}
type Hook = { __openreelE2E: { project: ProjectHook } };

const readMarkers = (page: Page): Promise<MarkerState[]> =>
  page.evaluate(() =>
    [...(window as unknown as Hook).__openreelE2E.project.getState().project.timeline.markers]
      .sort((a, b) => a.time - b.time)
      .map((m) => ({ id: m.id, time: m.time, label: m.label, duration: m.duration, comment: m.comment })),
  );

const addMarkerAt = async (page: Page, seconds: number) => {
  await seek(page, seconds);
  await press(page, "m");
};

const openMarkersPanel = async (page: Page) => {
  await page.getByRole("button", { name: "Markers", exact: true }).click();
  await expect(page.getByTestId("markers-panel")).toBeVisible();
};

test.describe("Markers panel, range markers, navigation and export", () => {
  test.setTimeout(180_000);

  test("M adds markers, the panel lists them, Shift+Down / Shift+Up jump between them", async ({ page }) => {
    await openEditor(page);
    await addMarkerAt(page, 1);
    await addMarkerAt(page, 3);
    await addMarkerAt(page, 5);
    expect((await readMarkers(page)).map((m) => Math.round(m.time * 100) / 100)).toEqual([1, 3, 5]);

    await openMarkersPanel(page);
    await expect(page.getByTestId("marker-row")).toHaveCount(3);
    await expect(page.getByTestId("marker-name")).toHaveText(["Marker 1", "Marker 2", "Marker 3"]);

    await seek(page, 0);
    await press(page, "Shift+ArrowDown");
    expect((await readState(page)).playhead).toBeCloseTo(1, 2);
    await press(page, "Shift+ArrowDown");
    expect((await readState(page)).playhead).toBeCloseTo(3, 2);
    await press(page, "Shift+ArrowDown");
    expect((await readState(page)).playhead).toBeCloseTo(5, 2);
    await press(page, "Shift+ArrowUp");
    expect((await readState(page)).playhead).toBeCloseTo(3, 2);
    await press(page, "Shift+ArrowUp");
    await press(page, "Shift+ArrowUp");
    expect((await readState(page)).playhead).toBeCloseTo(1, 2);

    // Clicking a row seeks to it.
    await page.getByTestId("marker-row").nth(2).click();
    await settle(page, 300);
    expect((await readState(page)).playhead).toBeCloseTo(5, 2);

    // M on a marker opens it for editing instead of stacking a second one.
    await focusEditor(page);
    await page.keyboard.press("m");
    await expect(page.getByRole("textbox", { name: "Marker name" })).toBeVisible();
    expect(await readMarkers(page)).toHaveLength(3);
  });

  test("Alt-drag on the ruler makes a range marker; its comment survives autosave and reload", async ({ page }) => {
    await openEditor(page);
    await setZoom(page, 100);
    await openMarkersPanel(page);

    const ruler = page.locator("[data-timeline-ruler]");
    const box = await ruler.boundingBox();
    if (!box) throw new Error("ruler not visible");
    const y = box.y + box.height / 2;
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + 150, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, y, { steps: 6 });
    await page.mouse.move(box.x + 300, y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await settle(page, 400);

    const [range] = await readMarkers(page);
    expect(range.time).toBeCloseTo(1.5, 1);
    expect(range.duration).toBeCloseTo(1.5, 1);
    await expect(page.getByTestId("ruler-marker-range")).toHaveCount(1);
    await expect(page.getByTestId("marker-duration")).not.toHaveText("—");

    await page.getByTestId("marker-row").dblclick();
    await page.getByRole("textbox", { name: "Marker comment" }).fill("Re-record the intro line");
    await page.getByRole("textbox", { name: "Marker comment" }).press("Enter");
    await expect.poll(async () => (await readMarkers(page))[0]?.comment).toBe("Re-record the intro line");

    // Autosave, reload, recover: the range and its comment persist.
    const projectId = await page.evaluate(() => (window as unknown as Hook).__openreelE2E.project.getState().project.id);
    await page.evaluate(() => (window as unknown as Hook).__openreelE2E.project.getState().forceSave());
    await page.reload();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
    const recovered = await page.evaluate(async (savedId) => {
      const store = (window as unknown as Hook).__openreelE2E.project;
      store.setState({ project: { ...store.getState().project, id: savedId } });
      const saves = await store.getState().checkForRecovery();
      if (!saves.length) return null;
      const ok = await store.getState().recoverFromAutoSave(saves[0].id);
      return { ok, markers: store.getState().project.timeline.markers };
    }, projectId);
    expect(recovered, "autosave must be recoverable after reload").not.toBeNull();
    expect(recovered!.ok).toBe(true);
    expect(recovered!.markers).toHaveLength(1);
    expect(recovered!.markers[0].comment).toBe("Re-record the intro line");
    expect(recovered!.markers[0].duration).toBeCloseTo(1.5, 1);
    expect(recovered!.markers[0].time).toBeCloseTo(1.5, 1);
  });

  test("exports YouTube chapters from the panel", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      const { project } = (window as unknown as Hook).__openreelE2E;
      for (const [time, label] of [[15, "Setup"], [40, "Build"], [95, "Wrap up"]] as const) {
        await project.getState().addMarker(time, label, "#3b82f6", { kind: "chapter" });
      }
    });
    await openMarkersPanel(page);
    await expect(page.getByTestId("marker-row")).toHaveCount(3);
    const download = page.waitForEvent("download");
    await page.getByTestId("markers-export-chapters").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/_chapters\.txt$/);
    expect(readFileSync((await file.path())!, "utf8")).toBe("0:00 Intro\n0:15 Setup\n0:40 Build\n1:35 Wrap up");
  });

  test("ripple delete before a marker shifts it by the removed length; undo restores it", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await addMarkerAt(page, 5);
    const before = await readMarkers(page);
    expect(before).toHaveLength(1);
    expect(before[0].time).toBeCloseTo(5, 2);

    const state = await readState(page);
    const first = clipsOf(state, "Main")[0];
    expect(first.duration).toBeCloseTo(2, 2);
    await clickClip(page, first.id);
    await press(page, "Shift+Backspace");
    expect(track(await readState(page), "Main").clips).toHaveLength(2);
    const after = await readMarkers(page);
    expect(after[0].time).toBeCloseTo(3, 2);

    await undo(page);
    expect((await readMarkers(page))[0].time).toBeCloseTo(5, 2);
  });
});
