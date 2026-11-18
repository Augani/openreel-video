import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { parseAafSequence } from "@openreel/core/interchange/index";
import { chooseFileMenu, clipsOf, openEditor, readState, shape, splitIntoThree, undo } from "./helpers";

interface E2E {
  __openreelE2E: {
    project: { getState(): any };
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "..", "..", "packages", "core", "src", "interchange", "__fixtures__", "pyaaf2-cut.aaf.gz");
const AAF_READER = join(here, "..", "..", "..", "packages", "core", "scripts", "aaf-read.py");

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
          .map((c: any) => [f(c.startTime), f(c.startTime + c.duration), f(c.inPoint), f(c.outPoint)]),
      }));
  });
}

async function exportAaf(page: Page): Promise<{ name: string; bytes: Buffer; path: string }> {
  const download = page.waitForEvent("download");
  await chooseFileMenu(page, ["Export timeline", "AAF (Avid/Premiere/Resolve)"]);
  const d = await download;
  const path = (await d.path())!;
  return { name: d.suggestedFilename(), bytes: readFileSync(path), path };
}

async function importAaf(page: Page, name: string, bytes: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await chooseFileMenu(page, ["Import timeline", "AAF…"]);
  await (await chooser).setFiles({ name, mimeType: "application/octet-stream", buffer: bytes });
  await page.getByTestId("timeline-import-report").waitFor();
}

async function commitImport(page: Page, mode: RegExp): Promise<void> {
  await page.getByRole("radio", { name: mode }).check();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("timeline-import-report")).toHaveCount(0);
}

async function dismissReport(page: Page): Promise<void> {
  const dialog = page.getByTestId("interchange-export-report");
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  }
}

test.describe("AAF interchange", () => {
  test("export a real timeline to .aaf, re-import it with relink, undo in one step; import a pyaaf2-written file", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await page.evaluate(() => (window as unknown as E2E).__openreelE2E.project.getState().addMarker(1.5, "Cue", "#ff0000"));
    const beforeState = await readState(page);
    const mainBefore = shape(clipsOf(beforeState, "Main"));
    expect(mainBefore).toHaveLength(3);
    const before = await layout(page);

    // ── export: a binary compound file the core reader (and pyaaf2, when installed) can open ──
    const file = await exportAaf(page);
    expect(file.name).toMatch(/\.aaf$/);
    expect(Array.from(file.bytes.subarray(0, 8))).toEqual([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const parsed = parseAafSequence(new Uint8Array(file.bytes)).sequence;
    expect(parsed.tracks.find((t) => t.kind === "video")?.clips).toHaveLength(3);
    expect(parsed.markers.map((m) => m.name)).toEqual(["Cue"]);
    expect(parsed.media.length).toBeGreaterThan(0);
    await dismissReport(page);

    const python = process.env.OPENREEL_PYAAF2_PYTHON ?? "python3";
    const probe = spawnSync(python, ["-I", "-c", "import aaf2"], { encoding: "utf8" });
    if (probe.status === 0) {
      const r = spawnSync(python, ["-I", AAF_READER, file.path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      expect(r.status, r.stderr).toBe(0);
      const summary = JSON.parse(r.stdout);
      const comp = summary.compositions[0];
      const v1 = comp.slots.find((s: any) => s.name === "V1");
      expect(v1.segment.components.filter((c: any) => c.type === "SourceClip")).toHaveLength(3);
      expect(comp.slots.some((s: any) => s.class === "EventMobSlot")).toBe(true);
    } else {
      test.info().annotations.push({ type: "pyaaf2", description: "not installed: independent pyaaf2 read skipped" });
    }

    // ── re-import: same layout, one undo step ──
    await importAaf(page, file.name, file.bytes);
    await expect(page.getByTestId("import-clip-count")).toHaveText(String(parsed.tracks.reduce((n, t) => n + t.clips.length, 0)));
    await expect(page.getByTestId("import-unmatched")).toHaveCount(0);
    await commitImport(page, /Replace the timeline/);
    const after = await readState(page);
    expect(after.historyLength - beforeState.historyLength).toBe(1);
    expect((await layout(page)).filter((t: { type: string }) => t.type === "video")).toEqual(
      before.filter((t: { type: string }) => t.type === "video"),
    );
    expect(shape(clipsOf(after, "V1"))).toEqual(mainBefore);
    const markers = await page.evaluate(() =>
      (window as unknown as E2E).__openreelE2E.project.getState().project.timeline.markers.map((m: any) => [m.label, m.time]),
    );
    expect(markers).toEqual([["Cue", 1.5]]);
    await undo(page);
    expect((await readState(page)).historyLength).toBe(beforeState.historyLength);
    expect(shape(clipsOf(await readState(page), "Main"))).toEqual(mainBefore);

    // ── a file from another AAF writer: media not in the bin becomes relinkable placeholders ──
    const foreign = Buffer.from(gunzipSync(readFileSync(FIXTURE)));
    await importAaf(page, "fixture.aaf", foreign);
    await expect(page.getByTestId("import-clip-count")).toHaveText("4");
    const unmatched = page.getByTestId("import-unmatched");
    await expect(unmatched).toContainText("clipA.mov");
    await expect(unmatched).toContainText("clipB.mov");
    await commitImport(page, /Add as new tracks/);
    const withForeign = await readState(page);
    expect(withForeign.historyLength - beforeState.historyLength).toBe(1);
    const placeholders = await page.evaluate(() =>
      (window as unknown as E2E).__openreelE2E.project
        .getState()
        .project.mediaLibrary.items.filter((m: any) => m.isPlaceholder)
        .map((m: any) => m.name)
        .sort(),
    );
    expect(placeholders).toEqual(["clipA.mov", "clipB.mov"]);
    await undo(page);
    expect((await readState(page)).historyLength).toBe(beforeState.historyLength);
  });
});
