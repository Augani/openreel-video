import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clipsOf, importInput, openEditor, readState, seek, settle } from "./helpers";

const REAL_FOOTAGE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "real-interview.mp4");

/** SBV and TTML / DFXP caption import and export in real Chrome, including skipped-cue notes. */

const workDir = mkdtempSync(join(tmpdir(), "openreel-capfmt-"));

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="en">
  <head>
    <styling><style xml:id="y" tts:color="#FFFF00"/><style xml:id="rs" tts:color="#FF0000" tts:textAlign="right" tts:displayAlign="before"/></styling>
    <layout><region xml:id="top" tts:origin="10% 5%" tts:extent="80% 15%" tts:displayAlign="before"/>
      <region xml:id="viaStyle" style="rs" tts:origin="10% 5%" tts:extent="80% 15%"/></layout>
  </head>
  <body><div>
    <p begin="00:00:01.000" end="00:00:02.500" region="top" style="y">Top yellow</p>
    <p begin="00:00:02.600" end="00:00:02.900" region="viaStyle">Region via style</p>
    <p begin="00:00:03.000" end="00:00:04.000">Plain<br/>two lines</p>
    <p>Missing timing</p>
  </div></body>
</tt>`;

interface Cue { text: string; start: number; end: number; track: string; color?: string; position?: string }

const cues = (page: Page, track?: string): Promise<Cue[]> =>
  page.evaluate((t) => {
    const subs = (window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[];
    return subs
      .filter((s) => t === undefined || (s.captionTrackId ?? "") === t)
      .map((s) => ({ text: s.text, start: s.startTime, end: s.endTime, track: s.captionTrackId ?? "", color: s.style?.color, position: s.style?.position }))
      .sort((a, b) => a.start - b.start);
  }, track);

async function openTranscript(page: Page) {
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
}

const importAs = async (page: Page, name: string, buffer: Buffer, lang: string) => {
  await page.getByLabel("Language of the imported captions").fill(lang);
  await page.getByTestId("transcript-import-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
};

async function exportAs(page: Page, format: string, file: string): Promise<string> {
  await page.getByRole("combobox", { name: "Caption export format" }).click();
  await page.getByRole("option", { name: format }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export captions" }).click()]);
  const path = join(workDir, file);
  await download.saveAs(path);
  return path;
}

test("TTML import maps style and region, skips a bad paragraph with a visible note; SBV and TTML export re-import", async ({ page }) => {
  await openEditor(page);
  await openTranscript(page);

  await importAs(page, "sample.ttml", Buffer.from(TTML), "en");
  await expect.poll(async () => (await cues(page, "en")).length).toBe(3);
  const first = (await cues(page, "en"))[0];
  expect(first).toMatchObject({ text: "Top yellow", start: 1, end: 2.5, color: "#FFFF00", position: "top" });
  expect((await cues(page, "en"))[1]).toMatchObject({ text: "Region via style", color: "#FF0000", position: "top" });
  await expect(page.getByTestId("caption-export-report")).toContainText("Skipped");
  await expect(page.getByTestId("caption-export-report")).toContainText("no timing");

  // Not a caption file at all: a clear failure, nothing added.
  await importAs(page, "notes.xml", Buffer.from("<html><body>hi</body></html>"), "bad");
  await expect(page.getByTestId("caption-export-report")).toContainText("Not a TTML");
  expect((await cues(page, "bad")).length).toBe(0);

  const sbv = await exportAs(page, "SBV (YouTube)", "out.sbv");
  expect(readFileSync(sbv, "utf8")).toContain("0:00:01.000,0:00:02.500\nTop yellow");
  const ttml = await exportAs(page, "TTML (IMSC1)", "out.ttml");
  expect(readFileSync(ttml, "utf8")).toContain("<tt ");

  await importAs(page, "out.sbv", readFileSync(sbv), "sbv");
  await expect.poll(async () => (await cues(page, "sbv")).length).toBeGreaterThan(0);
  await importAs(page, "out.ttml", readFileSync(ttml), "ttml");
  await expect.poll(async () => (await cues(page, "ttml")).length).toBeGreaterThan(0);
  const all = await cues(page);
  for (const track of ["sbv", "ttml"]) {
    const back = all.filter((c) => c.track === track);
    expect(back.map((c) => c.text)).toContain("Top yellow");
  }
});

test("imported TTML colour renders over real footage in the program monitor", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch { /* storage unavailable */ }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  const canvas = page.locator('canvas[aria-label^="Program frame"]');
  await canvas.waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(REAL_FOOTAGE);
  await page.getByLabel("Select media real-interview.mp4").waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Media actions for real-interview.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 30_000 }).toBe(1);

  await openTranscript(page);
  await importAs(page, "sample.ttml", Buffer.from(TTML), "en");
  await expect.poll(async () => (await cues(page, "en")).length).toBe(3);

  const countYellow = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const copy = document.createElement("canvas");
      copy.width = c.width;
      copy.height = c.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      let top = c.height;
      let bottom = -1;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] < 60) {
          n++;
          const y = Math.floor(i / 4 / c.width);
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      return { n, heightFraction: bottom >= top ? (bottom - top + 1) / c.height : 0 };
    });
  await seek(page, 1.7);
  await settle(page, 800);
  const duringStats = await countYellow();
  const during = duringStats.n;
  await page.screenshot({ path: join(workDir, "real-footage-caption.png") });
  await seek(page, 2.9);
  await settle(page, 800);
  const outside = (await countYellow()).n;
  expect(during, "yellow caption pixels while the cue is active").toBeGreaterThan(200);
  expect(during).toBeGreaterThan(outside + 150);
  // The imported cue uses the normal caption size: it must not balloon over the frame.
  expect(duringStats.heightFraction, "yellow caption occupies a modest band of the frame").toBeLessThan(0.25);
});
