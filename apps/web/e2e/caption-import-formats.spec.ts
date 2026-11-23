import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCC_HELLO, SCC_POSITIONED, STL_TELETEXT } from "../../../packages/core/src/captions/fixtures";
import { chooseFileMenu, importInput, openEditor, press, undo } from "./helpers";

/**
 * Caption files (SCC, EBU-STL, MCC) dropped on / picked in the Project panel and imported from
 * File > Import captions: cues land on the timeline with their timing, position and colour, the
 * notification lists what the format carried that OpenReel cannot show, and the import is one undo step.
 * The fixtures are hand-built byte for byte (packages/core/src/captions/fixtures.ts).
 */

interface Cue {
  text: string;
  start: number;
  end: number;
  track: string;
  color?: string;
  line?: number;
  align?: string;
}

const cues = (page: Page): Promise<Cue[]> =>
  page.evaluate(() => {
    const subs = (window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[];
    return subs
      .map((s) => ({
        text: s.text,
        start: s.startTime,
        end: s.endTime,
        track: s.captionTrackId ?? "",
        color: s.style?.color,
        line: s.cueSettings?.line,
        align: s.cueSettings?.align,
      }))
      .sort((a, b) => a.start - b.start);
  });

const NTSC = 30000 / 1001;

test("SCC and EBU-STL dropped on the Project panel become cues with timing, position and colour; each import undoes in one step", async ({ page }) => {
  await openEditor(page);

  await importInput(page).setInputFiles({ name: "positioned.scc", mimeType: "text/plain", buffer: Buffer.from(SCC_POSITIONED) });
  await expect.poll(async () => (await cues(page)).length).toBe(2);
  let all = await cues(page);
  expect(all.map((c) => c.text)).toEqual(["Left side", "Yellow"]);
  expect(all[0].start).toBeCloseTo(41 / NTSC, 2);
  expect(all[0].end).toBeCloseTo(90 / NTSC, 2);
  expect(all[0]).toMatchObject({ line: 15.3, align: "left" });
  expect(all[1].color).toBe("#ffff00");
  // The CC2 captions in the file are reported, not silently dropped.
  await expect(page.getByText(/data for CC2/).first()).toBeVisible();

  // A second file does not pile onto the first one's track.
  await importInput(page).setInputFiles({ name: "teletext.stl", mimeType: "application/octet-stream", buffer: Buffer.from(STL_TELETEXT) });
  await expect.poll(async () => (await cues(page)).length).toBe(6);
  all = await cues(page);
  const stl = all.filter((c) => c.track === "teletext");
  expect(stl.map((c) => c.text)).toEqual(["Top left", "Line one\nLine two", "Right aligned", "Red then green"]);
  expect(stl[0]).toMatchObject({ start: 1, end: 3, color: "#ffff00", line: 4.3, align: "left" });
  expect(stl[3].color).toBe("#ff0000");
  await expect(page.getByText(/teletext colour|changed teletext colour/).first()).toBeVisible();

  // One undo removes exactly the last import.
  await undo(page);
  await expect.poll(async () => (await cues(page)).length).toBe(2);
  await undo(page);
  await expect.poll(async () => (await cues(page)).length).toBe(0);
});

test("File > Import captions reads an MCC file and reports the CEA-708 / other-channel data it does not import", async ({ page }) => {
  await openEditor(page);
  const chooser = page.waitForEvent("filechooser");
  await chooseFileMenu(page, ["Import captions…"]);
  await (await chooser).setFiles({ name: "hello.mcc", mimeType: "text/plain", buffer: Buffer.from(MCC_HELLO) });
  await expect.poll(async () => (await cues(page)).length).toBe(1);
  const [hello] = await cues(page);
  expect(hello.text).toBe("Hello");
  expect(hello.start).toBeCloseTo(9 / NTSC, 2);
  expect(hello.end).toBeCloseTo(60 / NTSC, 2);
  await expect(page.getByText(/CC3/).first()).toBeVisible();
  await press(page, "Meta+z");
  await expect.poll(async () => (await cues(page)).length).toBe(0);
});

test("the Transcript panel exports MCC and imports it again, choosing the caption channel", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();

  const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello from MCC\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue\n";
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "in.srt", mimeType: "text/plain", buffer: Buffer.from(srt) });
  await expect.poll(async () => (await cues(page)).length).toBe(2);

  await page.getByRole("combobox", { name: "Caption export format" }).click();
  await page.getByRole("option", { name: "MCC (MacCaption)" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export captions" }).click()]);
  const path = join(mkdtempSync(join(tmpdir(), "openreel-mcc-")), "out.mcc");
  await download.saveAs(path);
  const mcc = readFileSync(path, "utf8");
  expect(mcc.startsWith("File Format=MacCaption_MCC V2.0")).toBe(true);
  expect(mcc).toMatch(/^Time Code Rate=(30DF|30|25|24)$/m);

  // Importing it with a language puts it on its own track; CC1 (the default channel) carries the captions.
  await page.getByLabel("Language of the imported captions").fill("mcc");
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "out.mcc", mimeType: "text/plain", buffer: readFileSync(path) });
  await expect.poll(async () => (await cues(page)).filter((c) => c.track === "mcc").length).toBe(2);
  const back = (await cues(page)).filter((c) => c.track === "mcc");
  expect(back.map((c) => c.text)).toEqual(["Hello from MCC", "Second cue"]);
  expect(back[0].start).toBeCloseTo(1, 1);

  // CC2 holds nothing: a clear message, nothing added.
  await page.getByRole("combobox", { name: "CEA-608 caption channel for SCC and MCC import" }).click();
  await page.getByRole("option", { name: "CC2" }).click();
  await page.getByLabel("Language of the imported captions").fill("cc2");
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "out.mcc", mimeType: "text/plain", buffer: readFileSync(path) });
  await expect(page.getByText(/Could not import out.mcc/).first()).toBeVisible();
  expect((await cues(page)).filter((c) => c.track === "cc2").length).toBe(0);
});
