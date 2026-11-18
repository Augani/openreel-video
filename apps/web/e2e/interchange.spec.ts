import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { chooseFileMenu, clipsOf, openEditor, readState, shape, splitIntoThree, undo } from "./helpers";

async function exportFile(
  page: Page,
  label: string[],
  options: { report?: boolean } = {},
): Promise<{ name: string; text: string }> {
  const download = page.waitForEvent("download");
  await chooseFileMenu(page, label);
  const d = await download;
  const path = await d.path();
  if (options.report) {
    // The export report lists what the format cannot carry; dismiss it to continue.
    await page.getByTestId("interchange-export-report").waitFor();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("interchange-export-report")).toHaveCount(0);
  }
  return { name: d.suggestedFilename(), text: readFileSync(path, "utf8") };
}

/** Layout of every non-text track as frame-rounded tuples, in track order. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
    const p = e.project.getState().project;
    const fps = p.settings.frameRate;
    const f = (s: number) => Math.round(s * fps);
    return p.timeline.tracks.map((t: any) => ({
      type: t.type,
      clips: [...t.clips]
        .sort((a: any, b: any) => a.startTime - b.startTime)
        .map((c: any) => [f(c.startTime), f(c.startTime + c.duration), f(c.inPoint), f(c.outPoint), c.speed ?? 1]),
      markers: undefined,
    }));
  });
}

async function importXml(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await chooseFileMenu(page, ["Import timeline", "Timeline XML…"]);
  const fc = await chooser;
  await fc.setFiles({ name, mimeType: "text/xml", buffer: Buffer.from(text) });
  await page.getByTestId("timeline-import-report").waitFor();
}

test.describe("Timeline interchange", () => {
  test("export Timeline XML, import it back into the timeline: clip layout is equal and undo is one step", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await page.evaluate(() => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
      return e.project.getState().addMarker(1.5, "Cue", "#ff0000");
    });
    const before = await layout(page);
    const beforeState = await readState(page);
    const mainBefore = shape(clipsOf(beforeState, "Main"));
    expect(mainBefore).toHaveLength(3);

    const xml = await exportFile(page, ["Export timeline", "Timeline XML (Premiere/Resolve)"]);
    expect(xml.name).toMatch(/\.xml$/);
    expect(xml.text).toContain("<xmeml version=\"5\">");
    expect((xml.text.match(/<clipitem id="clipitem-v/g) ?? []).length).toBe(3);
    expect(xml.text).toContain("three-scenes.mp4");
    expect(xml.text).toContain("<name>Cue</name>");

    await importXml(page, xml.name, xml.text);
    await expect(page.getByTestId("import-clip-count")).toHaveText("3");
    // every file is in the bin: nothing unmatched
    await expect(page.getByTestId("import-unmatched")).toHaveCount(0);
    await page.getByRole("radio", { name: /Replace the timeline/ }).check();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByTestId("timeline-import-report")).toHaveCount(0);

    const afterState = await readState(page);
    // Imported video track is named V1 and carries the same three clips frame-for-frame.
    const imported = (await layout(page)).filter((t: { type: string }) => t.type === "video");
    const original = before.filter((t: { type: string }) => t.type === "video");
    expect(imported.map((t: { clips: unknown }) => t.clips)).toEqual(original.map((t: { clips: unknown }) => t.clips));
    expect(shape(clipsOf(afterState, "V1"))).toEqual(mainBefore);
    expect(afterState.historyLength - beforeState.historyLength).toBe(1);
    const markers = await page.evaluate(() => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
      return e.project.getState().project.timeline.markers.map((m: any) => [m.label, m.time]);
    });
    expect(markers).toEqual([["Cue", 1.5]]);

    await undo(page);
    const undone = await readState(page);
    expect(shape(clipsOf(undone, "Main"))).toEqual(mainBefore);
    expect(undone.historyLength).toBe(beforeState.historyLength);
  });

  test("Add as new tracks keeps the original and reports unmatched media as placeholders", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    const xml = await exportFile(page, ["Export timeline", "Timeline XML (Premiere/Resolve)"]);
    // Pretend the sequence came from a machine with a different file.
    const renamed = xml.text.replaceAll("three-scenes.mp4", "other-take.mp4");
    const tracksBefore = (await readState(page)).tracks.length;

    await importXml(page, "other.xml", renamed);
    const unmatched = page.getByTestId("import-unmatched");
    await expect(unmatched).toContainText("other-take.mp4");
    await expect(unmatched).toContainText("3 clips");
    await page.getByRole("radio", { name: /Add as new tracks/ }).check();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByTestId("timeline-import-report")).toHaveCount(0);

    const after = await readState(page);
    expect(after.tracks.length).toBeGreaterThan(tracksBefore);
    expect(shape(clipsOf(after, "Main"))).toHaveLength(3);
    expect(shape(clipsOf(after, "V1"))).toEqual(shape(clipsOf(after, "Main")));
    const placeholder = await page.evaluate(() => {
      const e = (window as unknown as { __openreelE2E: { project: { getState(): any } } }).__openreelE2E;
      return e.project
        .getState()
        .project.mediaLibrary.items.filter((m: any) => m.isPlaceholder)
        .map((m: any) => m.name);
    });
    expect(placeholder).toContain("other-take.mp4");
  });

  test("FCPXML and EDL exports download real files", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    const fcpxml = await exportFile(page, ["Export timeline", "FCPXML (Final Cut)"]);
    expect(fcpxml.name).toMatch(/\.fcpxml$/);
    expect(fcpxml.text).toContain('<fcpxml version="1.10">');
    expect((fcpxml.text.match(/<asset-clip /g) ?? []).length).toBe(3);

    const edl = await exportFile(page, ["Export timeline", "EDL"], { report: true });
    expect(edl.name).toMatch(/\.edl$/);
    expect(edl.text).toMatch(/^TITLE: /);
    expect((edl.text.match(/^\d{3} {2}\S+ +V {5}C /gm) ?? []).length).toBe(3);

    // the FCPXML we just wrote imports back too
    await importXml(page, fcpxml.name, fcpxml.text);
    await expect(page.getByTestId("import-clip-count")).toHaveText("3");
  });
});
