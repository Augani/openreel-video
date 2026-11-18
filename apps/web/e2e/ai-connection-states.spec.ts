import { expect, test } from "@playwright/test";

/**
 * AI surfaces must tell the truth about their connection: with nothing connected the assistant
 * and the Generate panel say so, grey the status dot and disable what cannot work. A stale
 * "configured" list (key never stored in this browser) must not make Generate look ready.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
      // A stale list: claims a KieAI key exists although secure storage holds none.
      localStorage.setItem("openreel-settings", JSON.stringify({ state: { configuredServices: ["kie-ai"] }, version: 7 }));
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
});

test("assistant header and composer reflect that no model is connected", async ({ page }) => {
  await page.getByRole("button", { name: "AI Editor chat" }).first().click();
  const pill = page.getByRole("button", { name: "No model connected" });
  await expect(pill).toBeVisible();
  await expect(pill.locator(".workspace-status-dot")).not.toHaveClass(/is-ready/);
  await expect(page.getByRole("button", { name: "Add captions" })).toBeDisabled();
  await page.getByLabel("AI edit request").fill("Add captions");
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute("title", "Connect a model to send");
});

test("Generate does not trust a stale key list and explains the disabled button", async ({ page }) => {
  await page.getByRole("button", { name: "AI Generate" }).first().click();
  await page.getByLabel("Generation prompt").fill("Aerial shot of a market at golden hour");
  const trigger = page.getByRole("button", { name: "Generation model and settings" });
  await expect(trigger).toContainText("Add a key to generate");
  await expect(trigger.locator(".workspace-status-dot")).not.toHaveClass(/is-ready/);
  await expect(page.getByRole("button", { name: /^Generate \d variations?$/ })).toBeDisabled();
  await expect(page.getByText("Add your KieAI API key to generate.")).toBeVisible();
  for (const style of ["Cinematic", "Photo", "Documentary", "Illustration"]) {
    await expect(page.getByRole("button", { name: style, exact: true }).locator("svg")).toHaveCount(1);
  }
});
