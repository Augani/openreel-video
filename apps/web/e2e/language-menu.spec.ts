import { expect, test } from "@playwright/test";

test("switching to Simplified Chinese translates the editor menus", async ({ page }) => {
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
  await expect(page.getByRole("menuitem", { name: /新建项目…/ })).toBeVisible();
});
