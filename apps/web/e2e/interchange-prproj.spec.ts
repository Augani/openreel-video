import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { chooseFileMenu, openEditor, readState, undo } from "./helpers";

interface E2E {
  __openreelE2E: { project: { getState(): any } };
}

const here = dirname(fileURLToPath(import.meta.url));
// Hand-authored gzip XML following the .prproj object graph (see packages/core/scripts/gen-prproj-fixture.py).
const FIXTURE = join(here, "..", "..", "..", "packages", "core", "src", "interchange", "__fixtures__", "main-cut.prproj");

async function timeline(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as E2E).__openreelE2E.project.getState().project;
    return {
      tracks: p.timeline.tracks
        .filter((t: any) => t.type === "video" || t.type === "audio")
        .map((t: any) => ({
          type: t.type,
          name: t.name,
          clips: [...t.clips]
            .sort((a: any, b: any) => a.startTime - b.startTime)
            .map((c: any) => ({
              start: Math.round(c.startTime * 25),
              end: Math.round((c.startTime + c.duration) * 25),
              speed: c.speed ?? 1,
              reversed: !!c.reversed,
              opacity: c.transform.opacity,
              scale: c.transform.scale.x,
              disabled: !!c.metadata?.importedDisabled,
              nested: typeof c.metadata?.compoundClipId === "string",
            })),
          transitions: t.transitions.length,
        })),
      markers: p.timeline.markers.map((m: any) => [m.label, m.time, m.duration ?? 0]),
      placeholders: p.mediaLibrary.items.filter((m: any) => m.isPlaceholder).map((m: any) => m.name).sort(),
      bins: (p.bins ?? []).map((b: any) => b.name).sort(),
      sequences: (p.sequences ?? []).length,
    };
  });
}

test.describe("Premiere project (.prproj) import", () => {
  test("imports a gzip .prproj as one undoable action: tracks, speed, motion, markers, dissolve, placeholders and report", async ({ page }) => {
    await openEditor(page);
    const before = await readState(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseFileMenu(page, ["Import timeline", "Premiere project (.prproj)…"]);
    await (await chooser).setFiles({ name: "main-cut.prproj", mimeType: "application/octet-stream", buffer: readFileSync(FIXTURE) });
    await page.getByTestId("timeline-import-report").waitFor();

    // dialog: format, the sequence picker, the report and the offline media list
    await expect(page.getByText(/Premiere Pro project · Main Cut/)).toBeVisible();
    await expect(page.getByTestId("prproj-sequence-picker")).toBeVisible();
    await expect(page.getByTestId("import-clip-count")).toHaveText("8");
    await expect(page.getByTestId("import-report-summary")).toHaveText("1 dropped, 2 approximated");
    await expect(page.getByTestId("import-report")).toContainText("Effect: Gaussian Blur");
    await expect(page.getByTestId("import-report")).toContainText("Disabled clip");
    const unmatched = page.getByTestId("import-unmatched");
    for (const name of ["interview.mp4", "broll.mov", "overlay.png", "theme song.wav"]) await expect(unmatched).toContainText(name);

    await page.getByRole("radio", { name: /Replace the timeline/ }).check();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByTestId("timeline-import-report")).toHaveCount(0);

    const after = await readState(page);
    expect(after.historyLength - before.historyLength).toBe(1);

    const t = await timeline(page);
    const v1 = t.tracks.find((x: any) => x.name === "V1");
    const v2 = t.tracks.find((x: any) => x.name === "V2");
    const a1 = t.tracks.find((x: any) => x.type === "audio");
    expect(v1.clips.map((c: any) => [c.start, c.end])).toEqual([[0, 125], [125, 225], [225, 275]]);
    expect(v1.clips[1]).toMatchObject({ speed: 2, scale: 0.5 });
    expect(v1.clips[2].disabled).toBe(true);
    expect(v1.transitions).toBe(1);
    expect(v2.clips[0].opacity).toBe(0.5);
    expect(v2.clips[1].nested).toBe(true);
    expect(a1.clips.map((c: any) => [c.start, c.end, c.reversed])).toEqual([[0, 200, false], [200, 250, true]]);
    expect(t.markers).toEqual([["Intro", 1, 0], ["Chapter 2", 6, 2]]);
    // offline placeholders the relink flow can reconnect, in the bins of the Premiere project
    expect(t.placeholders).toEqual(["broll.mov", "interview.mp4", "overlay.png", "theme song.wav"]);
    expect(t.bins).toEqual(["Audio", "Footage", "Graphics"]);
    expect(t.sequences).toBeGreaterThanOrEqual(2);

    // one Undo reverts everything, bins and the nested sequence included
    await undo(page);
    expect((await readState(page)).historyLength).toBe(before.historyLength);
    const reverted = await timeline(page);
    expect(reverted.placeholders).toEqual([]);
    expect(reverted.bins).toEqual([]);
    expect(reverted.markers).toEqual([]);
  });

  test("choosing another sequence re-reads it", async ({ page }) => {
    await openEditor(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseFileMenu(page, ["Import timeline", "Premiere project (.prproj)…"]);
    await (await chooser).setFiles({ name: "main-cut.prproj", mimeType: "application/octet-stream", buffer: readFileSync(FIXTURE) });
    await page.getByTestId("timeline-import-report").waitFor();
    await page.getByTestId("prproj-sequence-picker").locator("select").selectOption({ label: "Alt Cut (1920x1080 · 29.97 fps · 1 clips)" });
    await expect(page.getByText(/Premiere Pro project · Alt Cut/)).toBeVisible();
    await expect(page.getByTestId("import-clip-count")).toHaveText("1");
  });
});
