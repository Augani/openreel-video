import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverage, frameAt, graphicState, hideMain, meanDiff, openTemplatesTab, setExposedColor, setExposedText } from "./essential-graphics-lib";
import { afterEffectsMogrt, lowerThirdMogrt } from "../../../packages/core/src/graphic-templates/mogrt/__fixtures__/build-mogrt";
import { openEditor, seek, settle, undo } from "./helpers";

/**
 * Premiere Motion Graphics Template (.mogrt) import through the UI: the template is imported from the Templates
 * tab, the report lists what was mapped / dropped, the template is inserted, an exposed control is edited in the
 * Inspector and the rendered frame changes (and returns on undo). After Effects templates are refused clearly.
 */

const dir = mkdtempSync(join(tmpdir(), "openreel-mogrt-"));

test("imports a Premiere .mogrt, edits an exposed control and the rendered frame changes", async ({ page }) => {
  test.setTimeout(240_000);
  const file = join(dir, "Broadcast Lower Third.mogrt");
  writeFileSync(file, lowerThirdMogrt());

  await openEditor(page);
  await hideMain(page);
  await seek(page, 0);
  const empty = await frameAt(page, 0.25);

  await openTemplatesTab(page);
  await page.getByTestId("graphic-template-import").setInputFiles(file);
  const report = page.getByTestId("mogrt-import-report");
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mogrt-import-summary")).toContainText('Imported "Broadcast Lower Third": 6 of 7 layers, 7 of 10 controls');
  await expect(page.getByTestId("mogrt-import-counts")).toHaveText("6/7 layers · 7/10 controls");
  await expect(report).toContainText("Path layer");
  await expect(report).toContainText("media-replacement");

  await page.getByRole("button", { name: "Insert Broadcast Lower Third" }).click();
  await expect.poll(async () => (await graphicState(page)).instances.length, { timeout: 15_000 }).toBe(1);
  await settle(page, 800);
  const inserted = await graphicState(page);
  const instance = inserted.instances[0];
  expect(instance.duration).toBe(6);

  // The template's controls appear in the Essential Graphics inspector.
  await expect(page.getByTestId("graphic-inspector")).toBeVisible();
  const template = await page.evaluate((id) => {
    const p = (window as any).__openreelE2E.project.getState().getFullProject();
    const t = p.graphicInstances.find((i: any) => i.id === id).template;
    return t.parameters.map((q: any) => ({ id: q.id, label: q.label, type: q.type }));
  }, instance.id);
  expect(template.map((q: { label: string }) => q.label)).toEqual(
    expect.arrayContaining(["Name", "Name Colour", "Name font", "Name size", "Title", "Accent Colour", "Plate Colour", "Plate Opacity", "Show Dot"]),
  );
  await expect(page.getByTestId("graphic-controls").locator("[data-graphic-control]")).toHaveCount(template.length);

  const hold = instance.startTime + 3;
  const before = await frameAt(page, hold, { differFrom: empty });
  expect(coverage(before, empty), "the imported graphic is on screen").toBeGreaterThan(0.002);

  // Edit the plate colour: the plate is 780x150 px of the 1920x1080 frame, so the render must change visibly.
  const plate = template.find((q: { label: string }) => q.label === "Plate Colour");
  await setExposedColor(page, plate.id, "Plate Colour", "#d11a2a");
  const afterColor = await graphicState(page);
  expect(afterColor.shapes.some((s) => s.fill?.toLowerCase() === "#d11a2a")).toBe(true);
  const colored = await frameAt(page, hold, { differFrom: empty });
  expect(colored.hash).not.toBe(before.hash);
  expect(meanDiff(colored.small, before.small), "plate colour change is visible").toBeGreaterThan(0.5);

  // Edit the name text: the rendered frame changes again, and the text clip carries the new text.
  const name = template.find((q: { label: string }) => q.label === "Name");
  await setExposedText(page, name.id, "JORDAN LEE");
  expect((await graphicState(page)).texts.some((t) => t.text === "JORDAN LEE")).toBe(true);
  const renamed = await frameAt(page, hold, { differFrom: empty });
  expect(renamed.hash).not.toBe(colored.hash);

  // Undo returns the exact earlier frames.
  await seek(page, 0);
  await undo(page);
  const undoneName = await frameAt(page, hold, { differFrom: empty });
  expect(undoneName.hash).toBe(colored.hash);
  await seek(page, 0);
  await undo(page);
  const undoneColor = await frameAt(page, hold, { differFrom: empty });
  expect(undoneColor.hash).toBe(before.hash);
});

test("an After Effects .mogrt is refused with a clear report and adds no template", async ({ page }) => {
  test.setTimeout(120_000);
  const file = join(dir, "Kinetic Title.mogrt");
  writeFileSync(file, afterEffectsMogrt());
  await openEditor(page);
  await openTemplatesTab(page);
  const before = await page.evaluate(() => (window as any).__openreelE2E.graphics.templates.getState().userTemplates.length);
  await page.getByTestId("graphic-template-import").setInputFiles(file);
  await expect(page.getByTestId("mogrt-import-summary")).toContainText("authored in After Effects", { timeout: 15_000 });
  await expect(page.getByTestId("mogrt-import-report")).toContainText("Headline, Colour");
  const after = await page.evaluate(() => (window as any).__openreelE2E.graphics.templates.getState().userTemplates.length);
  expect(after).toBe(before);
});
