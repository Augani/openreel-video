import { expect, test, type Page } from "@playwright/test";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIO_FIXTURE_PATH, FIXTURE_DIR, FIXTURE_PATH } from "./global-setup";
import { boxOf, clipsOf, clickClip, drag, importInput, openEditor, press, readState, seek, setZoom, settle } from "./helpers";

// 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const projectState = (page: Page) =>
  page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    const project = e.project.getState().project;
    return {
      clips: project.timeline.tracks.flatMap((t: any) => t.clips.map((c: any) => ({ id: c.id, track: t.name, media: c.mediaId, start: c.startTime, duration: c.duration, group: c.groupId ?? null }))),
      transitions: project.timeline.tracks.flatMap((t: any) => t.transitions.map((x: any) => ({ track: t.name, type: x.type, a: x.clipAId, b: x.clipBId ?? null }))),
    };
  });

test.describe("Automate to Sequence and clip groups", () => {
  test("five assets -> sequence with a transition -> group two clips -> they move together", async ({ page }) => {
    await openEditor(page);
    const names = ["scene-b.mp4", "scene-c.mp4", "still.png"];
    copyFileSync(FIXTURE_PATH, join(FIXTURE_DIR, "scene-b.mp4"));
    copyFileSync(FIXTURE_PATH, join(FIXTURE_DIR, "scene-c.mp4"));
    writeFileSync(join(FIXTURE_DIR, "still.png"), PNG);
    for (const name of names) {
      await importInput(page).setInputFiles(join(FIXTURE_DIR, name));
      await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 90_000 });
    }
    await importInput(page).setInputFiles(AUDIO_FIXTURE_PATH);
    await page.getByLabel("Select media tone-4s.wav").waitFor({ timeout: 90_000 });

    const before = await readState(page);
    const mainBefore = clipsOf(before, "Main");
    expect(mainBefore).toHaveLength(1);

    // Select five assets in a chosen order, with the playhead at the end of the existing clip.
    await seek(page, 6);
    const order = ["scene-c.mp4", "three-scenes.mp4", "still.png", "scene-b.mp4", "tone-4s.wav"];
    for (const [index, name] of order.entries()) {
      await page.getByLabel(`Select media ${name}`).click({ modifiers: index === 0 ? [] : ["ControlOrMeta"] });
    }
    await page.getByTestId("automate-to-sequence").click();
    const dialog = page.getByTestId("automate-to-sequence-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("assembly-still").fill("2");
    await dialog.getByTestId("assembly-video-transition").check();
    await expect(dialog.getByTestId("assembly-summary")).toContainText("5 clips");
    await dialog.getByTestId("assembly-apply").click();
    await expect(dialog).toBeHidden();

    const placed = await projectState(page);
    const main = placed.clips.filter((c: any) => c.track === "Main").sort((a: any, b: any) => a.start - b.start);
    // The original clip, then the selection in click order, each starting where the last ended.
    expect(main.map((c: any) => [c.start, c.duration])).toEqual([[0, 6], [6, 6], [12, 6], [18, 2], [20, 6]]);
    expect(placed.transitions.filter((t: any) => t.track === "Main")).toHaveLength(3);
    expect(placed.clips.some((c: any) => c.track !== "Main" && c.media === main[1].media)).toBe(true);
    expect((await readState(page)).historyLength).toBe(before.historyLength + 1);

    // Group the two clips that follow the still, by selecting the first and extending with the second.
    await setZoom(page, 30);
    const [first, second] = [main[1], main[2]];
    await clickClip(page, first.id);
    await page.keyboard.down("Shift");
    await clickClip(page, second.id);
    await page.keyboard.up("Shift");
    await press(page, "Meta+g");
    await expect.poll(async () => (await projectState(page)).clips.filter((c: any) => c.group).length).toBeGreaterThanOrEqual(2);
    const grouped = (await projectState(page)).clips.filter((c: any) => c.group);
    expect(new Set(grouped.map((c: any) => c.group)).size).toBe(1);
    await expect(page.getByTestId("clip-group-indicator").first()).toBeVisible();

    // Clicking one member selects the other; dragging moves both by the same distance.
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await clickClip(page, second.id);
    const selected = (await readState(page)).selected.map((s) => s.id);
    expect(selected).toEqual(expect.arrayContaining([first.id, second.id]));
    const stillClip = main[3];
    const startState = await projectState(page);
    const startOf = (id: string) => startState.clips.find((c: any) => c.id === id).start as number;
    // Move the whole group past the end of the sequence so nothing collides.
    const firstBox = await boxOf(page, first.id);
    await drag(page, { x: (firstBox.left + firstBox.right) / 2, y: firstBox.centerY }, 30 * 40);
    await settle(page, 500);
    const moved = await projectState(page);
    const shift = (id: string) => (moved.clips.find((c: any) => c.id === id).start as number) - startOf(id);
    expect(shift(first.id)).toBeGreaterThan(5);
    expect(shift(second.id)).toBeCloseTo(shift(first.id), 2);
    expect(shift(stillClip.id)).toBe(0);
    expect(moved.clips.find((c: any) => c.id === first.id).group).toBe(grouped[0].group);

    // One undo puts both back; ungroup dissolves the group and the clips stay put.
    await press(page, "Meta+z");
    const undone = await projectState(page);
    expect(undone.clips.find((c: any) => c.id === first.id).start).toBe(startOf(first.id));
    expect(undone.clips.find((c: any) => c.id === second.id).start).toBe(startOf(second.id));
    await press(page, "Meta+Shift+g");
    await expect.poll(async () => (await projectState(page)).clips.filter((c: any) => c.group).length).toBe(0);
    await expect(page.getByTestId("clip-group-indicator")).toHaveCount(0);
  });
});
