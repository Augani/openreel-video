import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { validateOtio, validateXmeml } from "@openreel/core/interchange/index";
import { chooseFileMenu, clipsOf, openEditor, readState, shape, splitIntoThree, undo } from "./helpers";

interface E2E {
  __openreelE2E: {
    project: { getState(): any };
    workspace: { getState(): any };
  };
}

async function exportFile(page: Page, label: string): Promise<{ name: string; text: string }> {
  const download = page.waitForEvent("download");
  await chooseFileMenu(page, ["Export timeline", label]);
  const d = await download;
  return { name: d.suggestedFilename(), text: readFileSync((await d.path())!, "utf8") };
}

/** Frame-rounded layout of the media tracks, in track order. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const e = (window as unknown as E2E).__openreelE2E;
    const p = e.project.getState().project;
    const fps = p.settings.frameRate;
    const f = (s: number) => Math.round(s * fps);
    return p.timeline.tracks
      .filter((t: any) => t.type === "video" || t.type === "audio")
      .map((t: any) => ({
        type: t.type,
        clips: [...t.clips]
          .sort((a: any, b: any) => a.startTime - b.startTime)
          .map((c: any) => [f(c.startTime), f(c.startTime + c.duration), f(c.inPoint), f(c.outPoint), c.speed ?? 1]),
      }));
  });
}

async function importFile(page: Page, name: string, mimeType: string, text: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await chooseFileMenu(page, ["Import timeline", "Timeline XML…"]);
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(text) });
  await page.getByTestId("timeline-import-report").waitFor();
}

async function commitImport(page: Page): Promise<void> {
  await page.getByRole("radio", { name: /Replace the timeline/ }).check();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("timeline-import-report")).toHaveCount(0);
}

function xmllintWellFormed(text: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "e2e-xmeml-")), "t.xml");
  writeFileSync(file, text);
  const r = spawnSync("xmllint", ["--noout", file], { encoding: "utf8" });
  // validation is mandatory: a missing xmllint fails the test, it is not skipped
  expect(r.error, "xmllint must be installed").toBeUndefined();
  expect(r.status, r.stderr).toBe(0);
}

async function closeReport(page: Page): Promise<void> {
  const dialog = page.getByTestId("interchange-export-report");
  await dialog.waitFor();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("Interchange hardening: OTIO + XMEML round trip with report", () => {
  test("export OTIO and XMEML from a real timeline, validate, re-import and compare; the report lists what was dropped", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    // A marker, an effect (cannot be carried -> must be reported), Sync Lock off and Main targeted.
    await page.evaluate(() => (window as unknown as E2E).__openreelE2E.project.getState().addMarker(1.5, "Cue", "#ff0000"));
    const firstClip = clipsOf(await readState(page), "Main")[0];
    await page.evaluate(
      (id) => (window as unknown as E2E).__openreelE2E.project.getState().addVideoEffect(id, "blur"),
      firstClip.id,
    );
    await page.getByRole("button", { name: "Sync lock Main", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sync lock Main", exact: true })).toHaveAttribute("data-sync-lock", "off");
    await page.evaluate(() => {
      const e = (window as unknown as E2E).__openreelE2E;
      const main = e.project.getState().project.timeline.tracks.find((t: any) => t.name === "Main");
      e.workspace.getState().setTrackTargeted(main.id, true);
    });
    const before = await layout(page);
    const beforeState = await readState(page);
    const mainBefore = shape(clipsOf(beforeState, "Main"));
    expect(mainBefore).toHaveLength(3);

    // ── OTIO ────────────────────────────────────────────────────────────
    const otio = await exportFile(page, "OpenTimelineIO");
    expect(otio.name).toMatch(/\.otio$/);
    expect(validateOtio(otio.text)).toEqual([]);
    const doc = JSON.parse(otio.text);
    const videoTracks = doc.tracks.children.filter((t: any) => t.kind === "Video");
    const v1 = videoTracks.find((t: any) => t.metadata.openreel.targeted === true);
    expect(v1, "targeted track is carried").toBeDefined();
    expect(v1.metadata.openreel.syncLock).toBe(false);
    expect(v1.children.filter((c: any) => c.OTIO_SCHEMA.startsWith("Clip"))).toHaveLength(3);
    expect(doc.tracks.markers.map((m: any) => m.name)).toEqual(["Cue"]);

    // Export report: the blur is listed per clip, with the track.
    const report = page.getByTestId("interchange-export-report");
    await report.waitFor();
    await expect(page.getByTestId("report-dropped-count")).toHaveText("1");
    const group = page.locator('[data-testid="interchange-report-group"][data-feature="Video effects"]');
    await expect(group).toHaveAttribute("data-severity", "dropped");
    await expect(group).toContainText("blur");
    await expect(group.getByTestId("interchange-report-item")).toContainText("Main");
    // the dialog must fit: no horizontal clipping at the real dialog width
    const box = await report.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(560 + 1);
    expect(await report.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await closeReport(page);

    // ── XMEML ───────────────────────────────────────────────────────────
    const xml = await exportFile(page, "Timeline XML (Premiere/Resolve)");
    xmllintWellFormed(xml.text);
    expect(validateXmeml(xml.text)).toEqual([]);
    expect(xml.text).toContain('MZ.TrackTargeted="1"');
    expect((xml.text.match(/<clipitem id="clipitem-v/g) ?? []).length).toBe(3);
    // xmeml cannot hold Sync Lock: the report says so, next to the blur
    await page.getByTestId("interchange-export-report").waitFor();
    await expect(page.locator('[data-testid="interchange-report-group"][data-feature="Sync lock"]')).toContainText("Main");
    await expect(page.locator('[data-testid="interchange-report-group"][data-feature="Video effects"]')).toHaveCount(1);
    await closeReport(page);

    // ── re-import OTIO: same layout, one undo step, flags restored ───────
    await importFile(page, otio.name, "application/json", otio.text);
    await expect(page.getByTestId("import-clip-count")).toHaveText("3");
    await expect(page.getByTestId("import-unmatched")).toHaveCount(0);
    await commitImport(page);
    const afterOtio = await readState(page);
    expect(afterOtio.historyLength - beforeState.historyLength).toBe(1);
    expect((await layout(page)).filter((t: { type: string }) => t.type === "video")).toEqual(
      before.filter((t: { type: string }) => t.type === "video"),
    );
    expect(shape(clipsOf(afterOtio, "V1"))).toEqual(mainBefore);
    const flags = await page.evaluate(() => {
      const e = (window as unknown as E2E).__openreelE2E;
      const st = e.project.getState().project.timeline;
      const v1 = st.tracks.find((t: any) => t.name === "V1");
      return {
        syncLock: v1.syncLock,
        targeted: e.workspace.getState().targetedTrackIds.includes(v1.id),
        markers: st.markers.map((m: any) => [m.label, m.time]),
      };
    });
    expect(flags).toEqual({ syncLock: false, targeted: true, markers: [["Cue", 1.5]] });
    await undo(page);
    expect((await readState(page)).historyLength).toBe(beforeState.historyLength);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(mainBefore);

    // ── re-import XMEML: same layout ──────────────────────────────────────
    await importFile(page, xml.name, "text/xml", xml.text);
    await expect(page.getByTestId("import-clip-count")).toHaveText("3");
    await commitImport(page);
    expect(shape(clipsOf(await readState(page), "V1"))).toEqual(mainBefore);
  });
});
