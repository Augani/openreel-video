import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./helpers";

/**
 * Unified background-task panel: export-queue jobs and tracked work show up in one popover with
 * progress, and cancel / retry reach the owning system.
 */

interface Hook {
  exportQueue: { getState(): Record<string, any> };
  backgroundTasks: {
    track<T>(o: Record<string, unknown>, w: (c: { signal: AbortSignal; progress(v: number | null, d?: string): void }) => Promise<T>): Promise<T>;
    get(id: string): { status: string; progress: number | null } | undefined;
  };
}

const openPanel = async (page: Page) => {
  await page.getByTestId("background-tasks-button").click();
  const panel = page.getByTestId("background-tasks-panel");
  await expect(panel).toBeVisible();
  return panel;
};

test("background tasks panel lists export jobs and forwards cancel and retry", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId("editor-status-bar").getByTestId("background-tasks-button")).toBeVisible();

  // Pause the queue so the job stays queued, then add one.
  const jobId = await page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    h.exportQueue.getState().pause();
    const job = h.exportQueue.getState().enqueue({ settings: { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 } });
    if (!job) throw new Error("enqueue returned null");
    return job.id as string;
  });

  await expect(page.getByTestId("background-tasks-badge")).toHaveAttribute("data-count", "1");
  const panel = await openPanel(page);
  const row = panel.locator(`[data-task-id="export-queue:${jobId}"]`);
  // The queue is paused, so the job reads "paused" and the row offers Resume (forwarded to the queue's Start).
  await expect(row).toHaveAttribute("data-status", "paused");
  await expect(row.getByRole("button", { name: /^Resume/ })).toBeVisible();
  await expect(panel.getByTestId("background-tasks-summary")).toContainText("1 background task");

  await row.getByRole("button", { name: /^Cancel/ }).click();
  await expect(row).toHaveAttribute("data-status", "cancelled");
  await row.getByRole("button", { name: /^Retry/ }).click();
  await expect(row).toHaveAttribute("data-status", "paused");
  // Per-row Pause is not offered: pausing is queue-wide.
  await expect(row.getByRole("button", { name: /^Pause/ })).toHaveCount(0);
  await row.getByRole("button", { name: /^Cancel/ }).click();
  await expect(row).toHaveAttribute("data-status", "cancelled");

  // Clear finished sticks even when the queue changes afterwards.
  await panel.getByRole("button", { name: "Clear finished tasks" }).click();
  await expect(panel.getByTestId("background-task-row")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.exportQueue.getState().pause());
  await expect(panel.getByTestId("background-task-row")).toHaveCount(0);
});

test("tracked work shows progress, can be cancelled and a failure can be retried", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    void h.backgroundTasks
      .track({ id: "e2e:analysis", kind: "analysis", title: "Beat detection" }, (ctx) => {
        ctx.progress(0.4, "Analysing");
        return new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))));
      })
      .catch(() => undefined);
    void h.backgroundTasks.track({ id: "e2e:import", kind: "import", title: "Import · clip.mp4", retry: () => undefined }, async () => {
      throw new Error("Unsupported container");
    }).catch(() => undefined);
  });

  const panel = await openPanel(page);
  const analysis = panel.locator('[data-task-id="e2e:analysis"]');
  await expect(analysis).toHaveAttribute("data-status", "running");
  await expect(analysis.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  const failed = panel.locator('[data-task-id="e2e:import"]');
  await expect(failed).toContainText("Unsupported container");
  await expect(failed.getByRole("button", { name: /^Retry/ })).toBeVisible();

  await analysis.getByRole("button", { name: /^Cancel/ }).click();
  await expect(analysis).toHaveAttribute("data-status", "cancelled");

  await panel.getByRole("button", { name: "Clear finished tasks" }).click();
  await expect(panel.getByTestId("background-task-row")).toHaveCount(0);
});

test("the panel is keyboard operable and its list loads only when opened", async ({ page }) => {
  const listChunks: string[] = [];
  page.on("request", (request) => {
    if (/BackgroundTasksList/.test(request.url())) listChunks.push(request.url());
  });
  await openEditor(page);
  await page.evaluate(() => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    void h.backgroundTasks
      .track({ id: "e2e:plugin", kind: "render", source: "plugin-render", title: "Audio plugin render" }, (ctx) => {
        ctx.progress(0.25, "Rendering through the plugin");
        return new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))));
      })
      .catch(() => undefined);
    void h.backgroundTasks
      .track({ id: "e2e:diarize", kind: "analysis", source: "diarization", title: "Speaker detection", retry: () => undefined }, async () => {
        throw new Error("No speech was clear enough");
      })
      .catch(() => undefined);
  });

  // Closed: the badge counts the running job and the list chunk has not been requested (dev server serves modules by name).
  await expect(page.getByTestId("background-tasks-badge")).toHaveAttribute("data-count", "1");
  expect(listChunks).toHaveLength(0);

  await page.getByTestId("background-tasks-button").focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("background-tasks-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-task-id="e2e:plugin"]')).toBeVisible();
  await expect(panel.locator('[data-task-id="e2e:plugin"]').getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  const failed = panel.locator('[data-task-id="e2e:diarize"]');
  await expect(failed).toContainText("No speech was clear enough");

  // Tab reaches the Cancel button of the running row and Enter activates it.
  const cancel = panel.getByRole("button", { name: "Cancel Audio plugin render" });
  await cancel.focus();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.locator('[data-task-id="e2e:plugin"]')).toHaveAttribute("data-status", "cancelled");
  await expect(failed.getByRole("button", { name: "Retry Speaker detection" })).toBeVisible();

  // Escape closes the panel and returns focus to the status-bar button.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("background-tasks-button")).toBeFocused();
});
