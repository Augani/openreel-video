import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { boxOf, clipsOf, diffSnaps, openEditor, readState, redo, seek, settle, setZoom, snap, splitIntoThree, undo } from "./helpers";

/**
 * FCPXML compound clips in real Chrome with real canvas pixels. A nest is created in the editor,
 * exported as FCPXML (media + sequence resource and a ref-clip, DTD-valid), imported back with
 * Replace: the file's compound clip becomes a real nested sequence, the parent renders the SAME
 * pixels, the whole import is ONE undo step and undo restores the sequences exactly.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DTD = join(here, "..", "..", "..", "packages", "core", "src", "interchange", "__fixtures__", "fcpxml-1.10.dtd");

interface Hook {
  __openreelE2E: { project: { getState(): any }; ui: { getState(): any } };
}

const TIMES = [0.5, 1.5, 2.5, 3.5, 5];

const sequencesOf = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as Hook).__openreelE2E.project.getState().getFullProject();
    return {
      active: p.activeSequenceId as string,
      nestClips: p.timeline.tracks
        .flatMap((t: any) => t.clips)
        .filter((c: any) => String(c.mediaId).startsWith("compound:"))
        .map((c: any) => ({ id: c.id as string, mediaId: c.mediaId as string, start: c.startTime as number, duration: c.duration as number })),
      sequenceIds: (p.sequences ?? []).map((s: any) => s.id as string),
    };
  });

async function chooseFileMenu(page: Page, path: string[]): Promise<void> {
  await page.getByRole("menubar", { name: "Application menu" }).getByText("File", { exact: true }).click();
  for (let i = 0; i < path.length; i++) {
    const item = page.getByRole("menuitem", { name: path[i] }).first();
    if (i < path.length - 1) await item.hover();
    else await item.click();
  }
}

test("FCPXML nest round trip: DTD-valid ref-clip export, import creates a nested sequence, same pixels, one undo", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await splitIntoThree(page);
  await setZoom(page, 100);
  const [a, b] = clipsOf(await readState(page), "Main");
  await page.evaluate((list) => (window as unknown as Hook).__openreelE2E.ui.getState().selectMultiple(list), [
    { type: "clip", id: a.id },
    { type: "clip", id: b.id },
  ]);
  const box = await boxOf(page, b.id);
  await page.mouse.click(box.left + 20, box.centerY, { button: "right" });
  await page.getByTestId("nest-clips").click();
  await settle(page, 1200);
  const nested = await sequencesOf(page);
  expect(nested.sequenceIds).toHaveLength(2);
  expect(nested.nestClips).toHaveLength(1);

  for (const t of TIMES) {
    await seek(page, t);
    await snap(page, `before-${t}`);
  }
  expect((await diffSnaps(page, "before-0.5", "before-3.5")).changed, "the scenes differ").toBeGreaterThan(1000);

  // ---- export FCPXML: compound clip, not flattened ----
  const download = page.waitForEvent("download");
  await chooseFileMenu(page, ["Export timeline", "FCPXML (Final Cut)"]);
  const d = await download;
  const xml = readFileSync((await d.path())!, "utf8");
  expect(d.suggestedFilename()).toMatch(/\.fcpxml$/);
  expect(xml).toMatch(/<media id="r\d+" name="Nested Sequence 1">\s*<sequence /);
  expect((xml.match(/<ref-clip /g) ?? []).length).toBe(1);
  expect((xml.match(/<asset-clip /g) ?? []).length, "the nest's two clips + the remaining main clip").toBe(3);
  const file = join(mkdtempSync(join(tmpdir(), "e2e-fcpxml-nest-")), "nest.fcpxml");
  writeFileSync(file, xml);
  const lint = spawnSync("xmllint", ["--noout", "--dtdvalid", DTD, file], { encoding: "utf8" });
  expect(lint.error, "xmllint must be installed").toBeUndefined();
  expect(`${lint.stdout}${lint.stderr}`, "DTD validation").toBe("");
  // The export report has no "flattened" nest entry: the format carries it.
  // (When nothing at all is dropped or approximated the report dialog does not open.)
  await settle(page, 800);
  await expect(page.getByTestId("interchange-report-group").filter({ hasText: "Nested sequence" })).toHaveCount(0);
  if (await page.getByTestId("interchange-export-report").count()) await page.getByRole("button", { name: "Done" }).click();

  // ---- import it back (Replace): the report names the compound clip ----
  const historyBefore = (await readState(page)).historyLength;
  const chooser = page.waitForEvent("filechooser");
  await chooseFileMenu(page, ["Import timeline", "Timeline XML…"]);
  await (await chooser).setFiles({ name: "nest.fcpxml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await page.getByTestId("timeline-import-report").waitFor();
  await expect(page.getByTestId("import-nest-count")).toContainText("1 compound clip");
  await expect(page.getByTestId("import-unmatched")).toHaveCount(0);
  await page.getByRole("radio", { name: /Replace the timeline/ }).check();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("timeline-import-report")).toHaveCount(0);
  await settle(page, 1200);

  const imported = await sequencesOf(page);
  expect(imported.sequenceIds, "one new sequence for the compound clip").toHaveLength(3);
  expect(imported.nestClips).toHaveLength(1);
  const newSequenceId = imported.sequenceIds.find((id) => !nested.sequenceIds.includes(id))!;
  expect(imported.nestClips[0].mediaId, "the nest clip resolves the NEW sequence").toBe(`compound:${newSequenceId}`);
  expect(imported.nestClips[0].duration).toBeCloseTo(nested.nestClips[0].duration, 2);
  expect((await readState(page)).historyLength - historyBefore, "the whole import is one undo step").toBe(1);

  // ---- the parent renders the same pixels as before the export ----
  for (const t of TIMES) {
    await seek(page, t);
    await snap(page, `after-${t}`);
    const diff = await diffSnaps(page, `before-${t}`, `after-${t}`);
    expect(diff.changed, `pixels at t=${t} (${diff.changed} of ${diff.total} differ)`).toBeLessThanOrEqual(25);
  }

  // ---- undo removes the imported sequence and restores the previous nest clip exactly ----
  await undo(page);
  await settle(page, 1200);
  const undone = await sequencesOf(page);
  expect(undone.sequenceIds.includes(newSequenceId)).toBe(false);
  expect(undone.sequenceIds).toEqual(nested.sequenceIds);
  expect(undone.nestClips[0]?.mediaId).toBe(nested.nestClips[0].mediaId);
  for (const t of TIMES.slice(0, 3)) {
    await seek(page, t);
    await snap(page, `undone-${t}`);
    expect((await diffSnaps(page, `before-${t}`, `undone-${t}`)).changed, `undo t=${t}`).toBeLessThanOrEqual(25);
  }
  await redo(page);
  await settle(page, 1000);
  const redone = await sequencesOf(page);
  expect(redone.sequenceIds).toEqual(imported.sequenceIds);

  // ---- the imported compound clip opens like any nest and holds the two clips ----
  const opened = await page.evaluate(async (clipId) => {
    const r = await (window as any).__openreelE2E.sequences.openNestClip(clipId);
    return r.ok ? null : (r.message as string);
  }, redone.nestClips[0].id);
  expect(opened).toBeNull();
  await settle(page, 800);
  const inside = await readState(page);
  const insideClips = inside.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips);
  expect(insideClips.map((c) => [Math.round(c.start * 30), Math.round(c.duration * 30)])).toEqual([[0, 60], [60, 60]]);
});
