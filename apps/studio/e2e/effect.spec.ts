import { test, expect } from "@playwright/test";

test("hub → new Effect → add Face → add Sparkles → tune Amount", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Effect" }).click();

  await expect(page.getByText(/No subjects yet/i)).toBeVisible();

  await page.getByRole("button", { name: "+ Subject" }).click();

  await page.getByRole("button", { name: "Face" }).click();

  await expect(page.getByRole("button", { name: /\+ Add behavior to Face/i })).toBeVisible();

  await page.getByRole("button", { name: /\+ Add behavior to Face/i }).click();

  await page.getByRole("button", { name: "Sparkles" }).click();

  await expect(page.locator('input[value="Sparkles"]')).toBeVisible();

  const slider = page.getByLabel("Amount");
  await slider.evaluate((el: HTMLInputElement) => {
    el.value = "0.9";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(slider).toHaveValue("0.9");
});
