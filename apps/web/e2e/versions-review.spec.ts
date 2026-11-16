import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { clipsOf, openEditor, press, readState, seek, settle, splitIntoThree, undo } from "./helpers";

/**
 * Project versions and review comments.
 *  - Comments panel: timecoded comments with author and status, replies, ruler markers, navigation, CSV
 *    export, Frame.io-style CSV import (one undo step).
 *  - Versions panel: named snapshot, restore as an undoable replace, restore as a copy, delete.
 */

interface CommentState {
  id: string;
  time: number;
  author?: string;
  status?: string;
  comment?: string;
  replies?: { author: string; text: string }[];
}

interface ProjectHook {
  getState(): {
    project: { id: string; name: string; timeline: { markers: CommentState[] } };
  };
}
type Hook = { __openreelE2E: { project: ProjectHook } };

const readComments = (page: Page): Promise<CommentState[]> =>
  page.evaluate(() =>
    [...(window as unknown as Hook).__openreelE2E.project.getState().project.timeline.markers]
      .sort((a, b) => a.time - b.time)
      .map((m) => ({ id: m.id, time: m.time, author: m.author, status: m.status, comment: m.comment, replies: m.replies?.map((r) => ({ author: r.author, text: r.text })) })),
  );

const readProject = (page: Page): Promise<{ id: string; name: string }> =>
  page.evaluate(() => {
    const { project } = (window as unknown as Hook).__openreelE2E.project.getState();
    return { id: project.id, name: project.name };
  });

const openPanel = async (page: Page, name: "Comments" | "Versions") => {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByTestId(name === "Comments" ? "comments-panel" : "versions-panel")).toBeVisible();
};

const addComment = async (page: Page, seconds: number, text: string) => {
  await seek(page, seconds);
  await page.getByTestId("comment-text-input").fill(text);
  await page.getByTestId("comment-add").click();
  await settle(page, 300);
};

test.describe("Review comments", () => {
  test.setTimeout(180_000);

  test("timecoded comments with replies and status, drawn on the ruler, navigable and exportable", async ({ page }) => {
    await openEditor(page);
    await openPanel(page, "Comments");
    await expect(page.getByTestId("comments-empty")).toBeVisible();

    await page.getByTestId("comment-author-input").fill("Ana");
    await addComment(page, 1, "Logo is too small");
    await addComment(page, 3, "Cut feels late");
    await expect(page.getByTestId("comment-row")).toHaveCount(2);
    await expect(page.getByTestId("comments-count")).toHaveText("2 open / 0 resolved");

    const comments = await readComments(page);
    expect(comments.map((c) => [Math.round(c.time * 100) / 100, c.author, c.status])).toEqual([
      [1, "Ana", "open"],
      [3, "Ana", "open"],
    ]);
    // Drawn on the ruler as markers carrying the review status.
    await expect(page.locator('[data-testid="ruler-marker"][data-review-status="open"]')).toHaveCount(2);

    // Reply to the first comment, then resolve it.
    const first = page.getByTestId("comment-row").first();
    await first.getByTestId("comment-reply-toggle").click();
    await first.getByTestId("comment-reply-input").fill("Will enlarge it");
    await first.getByTestId("comment-reply-send").click();
    await expect(first.getByTestId("comment-reply")).toHaveCount(1);
    await first.getByTestId("comment-resolve").click();
    await expect(first).toHaveAttribute("data-status", "resolved");
    await expect(page.getByTestId("comments-count")).toHaveText("1 open / 1 resolved");
    await expect(page.locator('[data-testid="ruler-marker"][data-review-status="resolved"]')).toHaveCount(1);

    // Undo steps the resolve back.
    await undo(page);
    await expect(first).toHaveAttribute("data-status", "open");

    // Next open comment jumps the playhead.
    await seek(page, 0);
    await page.getByTestId("comments-next").click();
    await settle(page, 300);
    expect((await readState(page)).playhead).toBeCloseTo(1, 1);
    await page.getByTestId("comments-next").click();
    await settle(page, 300);
    expect((await readState(page)).playhead).toBeCloseTo(3, 1);

    // CSV export: Frame.io-style columns, threads flattened.
    const download = page.waitForEvent("download");
    await page.getByTestId("comments-export-csv").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/_comments\.csv$/);
    const lines = readFileSync((await file.path())!, "utf8").split("\n");
    expect(lines[0]).toBe("Timecode,Author,Comment,Status,Created,Replies");
    expect(lines[1]).toMatch(/^00:00:01:00,Ana,Logo is too small,open,.+,Ana: Will enlarge it$/);
    expect(lines[2]).toMatch(/^00:00:03:00,Ana,Cut feels late,open,/);
  });

  test("imports a Frame.io-style CSV as one undo step", async ({ page }) => {
    await openEditor(page);
    await openPanel(page, "Comments");
    const csv = ["Timecode,Author,Comment", "00:00:02:15,Jo,Tighten this shot", "00:00:04:00,Kim,\"Color, please\"", "oops,Lee,Bad row"].join("\n");
    await page.getByTestId("comments-import-input").setInputFiles({ name: "frameio.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByTestId("comment-row")).toHaveCount(2);
    const imported = await readComments(page);
    expect(imported.map((c) => [c.time, c.author, c.comment])).toEqual([
      [2.5, "Jo", "Tighten this shot"],
      [4, "Kim", "Color, please"],
    ]);
    await undo(page);
    await expect(page.getByTestId("comments-empty")).toBeVisible();
    expect(await readComments(page)).toEqual([]);
  });
});

test.describe("Project versions", () => {
  test.setTimeout(180_000);

  test("saves a named version, restores it undoably, opens it as a copy and deletes it", async ({ page }) => {
    await openEditor(page);
    const original = await readProject(page);
    expect(clipsOf(await readState(page), "Main")).toHaveLength(1);

    await openPanel(page, "Versions");
    await expect(page.getByTestId("versions-empty")).toBeVisible();
    await page.getByTestId("version-name-input").fill("Before cuts");
    await page.getByTestId("version-save").click();
    const row = page.getByTestId("version-row");
    await expect(row).toHaveCount(1);
    await expect(page.getByTestId("version-name")).toHaveText("Before cuts");

    // Edit after the snapshot: three clips.
    await splitIntoThree(page);
    expect(clipsOf(await readState(page), "Main")).toHaveLength(3);

    // Preview metadata, then restore: the edit is replaced as one undo step.
    await row.locator("button").first().click();
    await expect(page.getByTestId("version-detail")).toContainText("Clips");
    await page.getByTestId("version-restore").click();
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(1);
    await undo(page);
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(3);

    // The restore stored a safety version of the replaced edit.
    await openPanel(page, "Versions");
    await expect(page.getByTestId("version-row")).toHaveCount(2);

    // Restore as a copy opens a new project and keeps the edit we were working on safe.
    // The row we previewed earlier is still expanded; expand it only when it is not.
    const target = page.getByTestId("version-row").filter({ has: page.getByText("Before cuts", { exact: true }) });
    if (!(await target.getByTestId("version-restore-copy").isVisible())) await target.locator("button").first().click();
    await page.getByTestId("version-restore-copy").click();
    await expect.poll(async () => (await readProject(page)).id, { timeout: 30_000 }).not.toBe(original.id);
    expect((await readProject(page)).name).toContain("(Before cuts)");
    await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(1);

    // Delete asks first.
    await openPanel(page, "Versions");
    await page.getByTestId("version-save").click();
    await expect(page.getByTestId("version-row")).toHaveCount(1);
    await page.getByTestId("version-row").first().locator("button").first().click();
    await page.getByTestId("version-delete").click();
    await expect(page.getByTestId("version-row")).toHaveCount(1);
    await page.getByTestId("version-delete-confirm").click();
    await expect(page.getByTestId("versions-empty")).toBeVisible();
    await press(page, "Escape");
  });
});
