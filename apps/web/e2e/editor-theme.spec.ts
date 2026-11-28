import { expect, test, type Page } from "@playwright/test";

async function chooseTheme(page: Page, mode: "Light" | "Dark" | "System") {
  await page.getByRole("button", { name: "Project settings", exact: true }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name: "Media", exact: true }).click();
}

async function checkControls(page: Page, theme: "light" | "dark", selectors: string[]) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
  for (const selector of selectors) {
    const elements = page.locator(selector);
    await expect(elements.first()).toBeVisible();
    await expect(async () => {
      const styles = await elements.evaluateAll((nodes) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        function luminance(color: string) {
          // The browser may serialize a computed color as rgb() or color(srgb ...).
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          const channels = [r, g, b].map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        }
        return nodes.map(el => {
          const style = getComputedStyle(el);
          const input = el.matches(".workspace-search") ? el.querySelector("input") : null;
          const fg = luminance(input ? getComputedStyle(input, "::placeholder").color : style.color);
          const bg = luminance(style.backgroundColor);
          return { bg, inverse: el.hasAttribute("data-preview-main-play"), contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
        });
      });
      for (const { bg, inverse, contrast } of styles) {
        expect(bg > 0.5, selector).toBe(inverse ? theme === "dark" : theme === "light");
        expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
      }
    }).toPass({ timeout: 3000 });
  }
}

test("editor controls follow manual and system themes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("openreel-onboarding-complete", "true"));
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  const toolbarControls = [
    ".workspace-mode button[aria-pressed=true]",
    ".workspace-media-toolbar .workspace-search",
    ".workspace-media-toolbar > button",
    ".workspace-media-browser .workspace-chips button",
    '[data-testid="project-panel-bar"] button[aria-label="New bin"]',
    '[data-testid="project-panel-bar"] [role="group"] button',
    "[data-preview-main-play]",
    ".workspace-preview-options button.workspace-preview-choice",
  ];
  await chooseTheme(page, "Light");
  await checkControls(page, "light", toolbarControls);
  await page.getByRole("button", { name: "AI assist", exact: true }).click();
  await checkControls(page, "light", [".workspace-ai-connect", ".workspace-ai-providers button"]);
  await page.keyboard.press("Escape");
  await chooseTheme(page, "Dark");
  await checkControls(page, "dark", toolbarControls);
  await page.emulateMedia({ colorScheme: "dark" });
  await chooseTheme(page, "System");
  await page.emulateMedia({ colorScheme: "light" });
  await checkControls(page, "light", toolbarControls);
});
