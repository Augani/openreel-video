import { expect, test } from "@playwright/test";

test("Chinese UI covers the settings and export dialogs", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable; the tour just shows */
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.evaluate(() => {
    const store = (window as unknown as {
      __openreelI18n: { setPreference(p: string): void };
    }).__openreelI18n;
    store.setPreference("zh-CN");
  });

  await expect(page.getByText("文件", { exact: true }).first()).toBeVisible();
  await page.getByText("文件", { exact: true }).first().click();
  await page.getByRole("menuitem", { name: "设置与 API 密钥…" }).click();
  const settings = page.getByRole("dialog");
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("设置");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await page.getByText("文件", { exact: true }).first().click();
  await page.getByRole("menuitem", { name: "导出…" }).click();
  const exportDialog = page.getByRole("dialog");
  await expect(exportDialog).toBeVisible();
  await expect(exportDialog).toContainText("导出");
});
