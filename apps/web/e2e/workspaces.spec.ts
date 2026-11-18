import { expect, test, type Page } from "@playwright/test";
import { openEditor, settle } from "./helpers";

/**
 * Dock workspaces, checked in real Chrome through the Window menu:
 *  - the built-in Color and Audio workspaces re-size the dock and switch the asset browser;
 *  - a layout the user saves comes back from the menu with the same sizes;
 *  - saved workspaces survive a reload (persisted to the profile) and can be deleted.
 */

const shell = (page: Page) => page.locator(".editor-shell");
const cssVar = (page: Page, name: string) => shell(page).evaluate((el, n) => (el as HTMLElement).style.getPropertyValue(n), name);

async function chooseWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Workspaces" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^(✓ )?${name}( \\(modified\\))?$`) }).click();
  await settle(page, 300);
}

async function dragInspectorEdge(page: Page, dx: number): Promise<void> {
  const handle = page.locator(".editor-resizer").nth(1);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + dx, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle(page, 200);
}

test("built-in, saved and persisted workspaces", async ({ page }) => {
  await openEditor(page);
  expect(await cssVar(page, "--inspector-w")).toBe("320px");

  await chooseWorkspace(page, "Color");
  expect(await cssVar(page, "--inspector-w")).toBe("480px");
  expect(await cssVar(page, "--media-w")).toBe("260px");

  await chooseWorkspace(page, "Audio");
  expect(parseFloat(await cssVar(page, "--tl-height"))).toBeCloseTo(46, 0);
  expect(await cssVar(page, "--inspector-w")).toBe("320px");

  // Make a layout of our own: Editing, then drag the inspector wider, then save it.
  await chooseWorkspace(page, "Editing");
  await dragInspectorEdge(page, -120);
  const widened = parseFloat(await cssVar(page, "--inspector-w"));
  expect(widened).toBeGreaterThan(400);

  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save as new workspace…" }).click();
  await page.getByLabel("Workspace name").fill("My cut");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await chooseWorkspace(page, "Editing");
  expect(await cssVar(page, "--inspector-w")).toBe("320px");
  await chooseWorkspace(page, "My cut");
  expect(parseFloat(await cssVar(page, "--inspector-w"))).toBeCloseTo(widened, 0);

  // Saved to the profile: still there after a reload.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("openreel-workspaces") ?? "{}"));
  expect(stored.state.userWorkspaces.map((w: { name: string }) => w.name)).toEqual(["My cut"]);
  await page.reload();
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await expect.poll(() => cssVar(page, "--inspector-w")).toBe(`${widened}px`);
  await chooseWorkspace(page, "Editing");
  await chooseWorkspace(page, "My cut");
  expect(parseFloat(await cssVar(page, "--inspector-w"))).toBeCloseTo(widened, 0);

  // Delete it again.
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete workspace" }).click();
  await page.getByRole("menuitem", { name: "My cut" }).click();
  await page.getByRole("menuitem", { name: "Window", exact: true }).click();
  await page.getByRole("menuitem", { name: "Workspaces" }).click();
  await expect(page.getByRole("menuitem", { name: "My cut" })).toHaveCount(0);
});
