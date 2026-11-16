import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEditor, readState, settle } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";

/**
 * Broadcast captions in real Chrome:
 *  - an imported transcript exports as SCC (CEA-608) and EBU-STL, both re-import, and the cues
 *    match the original (text exact, times within one frame); ffmpeg's own 608 decoder reads the
 *    SCC we wrote;
 *  - the Caption QC panel lists reading-speed / duration / gap problems and clicking one jumps;
 *  - the Export dialog's caption options embed a subtitle track in an MP4 export, which ffprobe
 *    sees and ffmpeg can extract.
 */

const FFMPEG = E2E_FFMPEG;
const FFPROBE = E2E_FFPROBE;
const workDir = mkdtempSync(join(tmpdir(), "openreel-captions-"));
const FPS = 30;

const TRANSCRIPT = {
  language: "en",
  segments: [
    {
      speaker: "Ann",
      words: [
        { word: "Welcome", start: 0.5, end: 0.9 },
        { word: "to", start: 0.9, end: 1.0 },
        { word: "the", start: 1.0, end: 1.1 },
        { word: "show.", start: 1.1, end: 1.5 },
      ],
    },
    {
      speaker: "Ann",
      words: [
        { word: "Caf\u00e9", start: 2.0, end: 2.3 },
        { word: "\u00bfqu\u00e9", start: 2.5, end: 2.8 },
        { word: "tal?", start: 2.8, end: 3.0 },
        { word: "ni\u00f1o", start: 3.0, end: 3.2 },
        { word: "great.", start: 3.2, end: 3.8 },
      ],
    },
    {
      speaker: "Bob",
      words: [
        { word: "Thanks", start: 4.5, end: 5.0 },
        { word: "all.", start: 5.0, end: 5.5 },
      ],
    },
  ],
};

interface Cue {
  text: string;
  start: number;
  end: number;
  track: string;
}

const cues = (page: Page, track?: string): Promise<Cue[]> =>
  page.evaluate((t) => {
    const subs = (window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[];
    return subs
      .filter((s) => t === undefined || (s.captionTrackId ?? "") === t)
      .map((s) => ({ text: s.text as string, start: s.startTime as number, end: s.endTime as number, track: (s.captionTrackId ?? "") as string }))
      .sort((a, b) => a.start - b.start);
  }, track);

async function openTranscript(page: Page) {
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
}

async function importTranscript(page: Page) {
  await openTranscript(page);
  await page.getByTestId("transcript-import-input").setInputFiles({
    name: "interview.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(TRANSCRIPT)),
  });
  await expect.poll(async () => (await cues(page)).length).toBe(3);
}

async function pickSelect(page: Page, label: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

async function exportAs(page: Page, format: string | RegExp, file: string): Promise<string> {
  await pickSelect(page, "Caption export format", format);
  await pickSelect(page, "Programme start timecode", "01:00:00:00");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export captions" }).click()]);
  const path = join(workDir, file);
  await download.saveAs(path);
  return path;
}

async function importFile(page: Page, path: string, name: string, language: string) {
  await page.getByLabel("Language of the imported captions").fill(language);
  await page.getByTestId("transcript-import-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: readFileSync(path) });
}

test("a transcript exports as SCC and EBU-STL, and both re-import to the same cues (within one frame)", async ({ page }) => {
  await openEditor(page);
  await importTranscript(page);
  const original = await cues(page, "");
  expect(original.map((c) => c.text)).toEqual(["Welcome to the show.", "Caf\u00e9 \u00bfqu\u00e9 tal? ni\u00f1o great.", "Thanks all."]);

  // SCC: pop-on, EOC doubled, 01:00:00 programme start.
  const scc = await exportAs(page, "SCC (CEA-608)", "interview.scc");
  const sccText = readFileSync(scc, "utf8");
  expect(sccText.startsWith("Scenarist_SCC V1.0")).toBe(true);
  // The first caption is due at 01:00:00;15; its 20 loading pairs are pre-rolled, so the file
  // starts a few frames before the hour (and every line starts with RCL, ENM).
  // The project is exactly 30 fps, so timecode is non-drop (colons).
  expect(sccText).toMatch(/^00:59:59:\d\d\t9420 9420 94ae 94ae /m);
  expect(sccText).toMatch(/^\d\d:\d\d:\d\d:\d\d\t(.* )?9420 9420 94ae 94ae /m);
  expect(sccText).toMatch(/942f 942f/);
  expect(sccText).toMatch(/942c 942c/);
  // Independent decoder: ffmpeg's CEA-608 decoder reads the same text.
  const srt = execFileSync(FFMPEG, ["-v", "error", "-i", scc, "-f", "srt", "-"], { encoding: "utf8" });
  const decoded = srt
    .split(/\n\n/)
    .map((b) => b.split("\n").slice(2).join("\n").replace(/<[^>]+>|\{\\[^}]*\}|\\h/g, "").trim())
    .filter(Boolean);
  expect(decoded).toEqual(original.map((c) => c.text));

  // EBU-STL
  const stl = await exportAs(page, "EBU-STL", "interview.stl");
  const stlBytes = readFileSync(stl);
  expect(stlBytes.length).toBe(1024 + 128 * 3);
  expect(stlBytes.subarray(3, 11).toString("latin1")).toMatch(/^STL(25|30)\.01$/);
  expect(stlBytes.subarray(0, 3).toString("latin1")).toBe("850");

  // Re-import both onto their own caption tracks and compare.
  await importFile(page, scc, "interview.scc", "scc");
  await expect.poll(async () => (await cues(page, "scc")).length).toBe(3);
  await importFile(page, stl, "interview.stl", "stl");
  await expect.poll(async () => (await cues(page, "stl")).length).toBe(3);

  for (const track of ["scc", "stl"]) {
    const back = await cues(page, track);
    back.forEach((c, i) => {
      expect(c.text, `${track} cue ${i} text`).toBe(original[i].text);
      expect(Math.abs(c.start - original[i].start), `${track} cue ${i} start`).toBeLessThanOrEqual(1 / FPS + 1e-6);
      expect(Math.abs(c.end - original[i].end), `${track} cue ${i} end`).toBeLessThanOrEqual(1 / FPS + 1e-6);
    });
  }
  console.log(`[captions] SCC ${sccText.length} bytes, STL ${stlBytes.length} bytes; both re-imported 3/3 cues within 1 frame`);
});

test("Caption QC lists reading speed, duration and gap problems and clicking one jumps to the caption", async ({ page }) => {
  await openEditor(page);
  await openTranscript(page);
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:01,400",
    "This caption has far too many characters for a short time",
    "",
    "2",
    "00:00:01,420 --> 00:00:04,000",
    "Fine",
    "",
    "3",
    "00:00:03,500 --> 00:00:06,000",
    "Overlaps the one before",
    "",
  ].join("\n");
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "qc.srt", mimeType: "text/plain", buffer: Buffer.from(srt) });
  await expect.poll(async () => (await cues(page)).length).toBe(3);

  await page.getByRole("tab", { name: "QC", exact: true }).click();
  const panel = page.getByTestId("caption-qc-panel");
  await expect(panel).toBeVisible();
  const codes = async () => page.getByTestId("caption-qc-issue").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
  await expect.poll(codes).toEqual(expect.arrayContaining(["cps", "min-duration", "gap", "overlap"]));
  await expect(page.getByTestId("caption-qc-summary")).toContainText("error");

  // Click the reading-speed issue: playhead goes to that caption.
  await page.locator('[data-testid="caption-qc-issue"][data-code="cps"]').first().click();
  await expect.poll(async () => (await readState(page)).playhead).toBeCloseTo(1.0, 1);
  // And the overlap on caption 3.
  await page.locator('[data-testid="caption-qc-issue"][data-code="overlap"]').first().click();
  await expect.poll(async () => (await readState(page)).playhead).toBeCloseTo(3.5, 1);

  // Loosening the limits clears the reading-speed warning.
  await page.getByText("Limits", { exact: true }).click();
  await page.getByLabel("Max chars/sec").fill("200");
  await expect.poll(codes).not.toContain("cps");
});


test("an MP4 export embeds the caption track: ffprobe sees it, ffmpeg extracts the cue payloads and times, and the sidecar WebVTT is written", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  await importTranscript(page);

  await page.evaluate(() => (window as any).__openreelE2E.ui.getState().openModal("export"));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Custom" }).click();
  const section = page.getByTestId("export-captions");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await expect(section).toContainText("3 captions");

  await section.getByRole("switch", { name: "Burn in Default captions" }).click();
  await section.getByRole("combobox", { name: "Embedded captions for Default captions" }).click();
  await page.getByRole("option", { name: "Subtitle track" }).click();
  await section.getByRole("combobox", { name: "Sidecar format for Default captions" }).click();
  await page.getByRole("option", { name: "WebVTT" }).click();

  const [sidecar] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Add to queue" }).click(),
  ]);
  expect(sidecar.suggestedFilename()).toMatch(/\.vtt$/);
  const sidecarPath = join(workDir, "sidecar.vtt");
  await sidecar.saveAs(sidecarPath);
  expect(readFileSync(sidecarPath, "utf8")).toContain("Welcome to the show.");

  const job = await page.evaluate(() => {
    const j = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.at(-1);
    return { id: j.id as string, captions: j.settings.captions, format: j.settings.format as string };
  });
  expect(job.captions).toEqual({ tracks: [{ captionTrackId: "", burnIn: false, sidecar: "vtt", embedded: "subtitle" }] });
  expect(job.format).toBe("mp4");

  await page.evaluate(() => (window as any).__openreelE2E.exportQueue.getState().start());
  const deadline = Date.now() + 240_000;
  let status = "";
  let outputName = "";
  while (Date.now() < deadline) {
    const j = await page.evaluate((id) => {
      const x = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((y: any) => y.id === id);
      return { status: x.status as string, outputName: x.outputName as string, error: x.error as string | undefined };
    }, job.id);
    status = j.status;
    outputName = j.outputName;
    if (status === "completed") break;
    if (status === "failed" || status === "cancelled") throw new Error(`export ${status}: ${j.error}`);
    await page.waitForTimeout(300);
  }
  expect(status).toBe("completed");

  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: `Download ${outputName}` }).click(),
  ]);
  const mp4 = join(workDir, "embedded.mp4");
  await file.saveAs(mp4);

  const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", mp4], { encoding: "utf8" }));
  console.log(`[captions] streams: ${JSON.stringify(probe.streams.map((s: any) => [s.index, s.codec_type, s.codec_name, s.codec_tag_string, s.tags?.language]))}`);
  // The browser muxer (MediaBunny) writes the cues as a WebVTT (wvtt) track. ffmpeg's MP4 demuxer
  // lists a wvtt track as an undecodable "data" stream, so it is identified by its sample-entry tag.
  const cc = probe.streams.filter((s: any) => s.codec_tag_string === "wvtt");
  expect(cc).toHaveLength(1);
  expect(cc[0].tags?.language).toBe("eng");
  expect(probe.streams.some((s: any) => s.codec_type === "video")).toBe(true);
  expect(probe.streams.some((s: any) => s.codec_type === "audio")).toBe(true);

  // Extract the track's raw samples with ffmpeg and read the WebVTT cue payloads ('payl' boxes).
  const raw = execFileSync(FFMPEG, ["-v", "error", "-i", mp4, "-map", `0:${cc[0].index}`, "-c", "copy", "-f", "data", "-"], { maxBuffer: 1 << 20 });
  const payloads = raw
    .toString("latin1")
    .split("payl")
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf("\u0000\u0000\u0000"); // the next box header (a 32-bit size below 256)
      return Buffer.from(end < 0 ? chunk : chunk.slice(0, end), "latin1").toString("utf8").replace(/<[^>]+>/g, "");
    });
  console.log(`[captions] cue payloads in the embedded track: ${JSON.stringify(payloads)}`);
  expect(payloads).toEqual(["Welcome to the show.", "Caf\u00e9 \u00bfqu\u00e9 tal? ni\u00f1o great.", "Thanks all."]);
  // Their times: one packet per cue, starting on the cue start (the gaps between are empty samples).
  const packets = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-select_streams", String(cc[0].index), "-show_packets", "-of", "json", mp4], { encoding: "utf8" })).packets as Array<{ pts_time: string; duration_time: string; size: string }>;
  const cueStarts = packets.filter((p) => Number(p.size) > 8).map((p) => Number(p.pts_time));
  console.log(`[captions] cue packet start times: ${cueStarts}`);
  expect(cueStarts).toHaveLength(3);
  [0.5, 2.0, 4.5].forEach((t, i) => expect(Math.abs(cueStarts[i] - t)).toBeLessThan(0.002));
  // The whole file decodes cleanly.
  const errors = execFileSync(FFMPEG, ["-v", "error", "-i", mp4, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  expect(errors.trim()).toBe("");
  await settle(page, 200);
  writeFileSync(testInfo.outputPath("embedded-captions-probe.json"), JSON.stringify(probe.streams, null, 2));
});

const SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 };

async function exportToFile(page: Page, settings: Record<string, unknown>, label: string, file: string): Promise<string> {
  const id = await page.evaluate((payload) => {
    const job = (window as any).__openreelE2E.exportQueue.getState().enqueue(payload);
    if (!job) throw new Error("enqueue returned null");
    return job.id as string;
  }, { settings, presetLabel: label });
  await page.evaluate(() => (window as any).__openreelE2E.exportQueue.getState().start());
  const deadline = Date.now() + 200_000;
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const x = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((y: any) => y.id === jobId);
      return { status: x.status as string, outputName: x.outputName as string, error: x.error as string | undefined };
    }, id);
    if (j.status === "completed") {
      const panel = page.getByTestId("export-queue-panel");
      if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
      const [dl] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${j.outputName}` }).click()]);
      const path = join(workDir, file);
      await dl.saveAs(path);
      return path;
    }
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`export ${j.status}: ${j.error}`);
    if (Date.now() > deadline) throw new Error(`export did not finish (${j.status})`);
    await page.waitForTimeout(300);
  }
}

/** Gray 640x360 frame at `t` seconds. */
const grayFrame = (file: string, t: number): Buffer =>
  execFileSync(FFMPEG, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=640:360", "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });

/** Pixels (outside `rows`) that differ by more than a small codec-noise threshold. */
function differing(a: Buffer, b: Buffer, rows: [number, number]): number {
  let n = 0;
  for (let y = rows[0]; y < rows[1]; y++) for (let x = 0; x < 640; x++) if (Math.abs(a[y * 640 + x] - b[y * 640 + x]) > 24) n++;
  return n;
}

test("burn-in off removes the caption from the picture; burn-in on draws it (frames compared in the exported files)", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  await openEditor(page);
  await importTranscript(page);
  const burned = await exportToFile(page, { ...SMALL }, "Burned in", "burned.mp4");
  const clean = await exportToFile(
    page,
    { ...SMALL, captions: { tracks: [{ captionTrackId: "", burnIn: false, sidecar: "none", embedded: "none" }] } },
    "No burn-in",
    "clean.mp4",
  );
  // While a caption is on screen (t = 0.9: "Welcome to the show.") the exports differ in the caption area
  // (the lower part of the frame) and are the same elsewhere; with no caption on screen (t = 5.8) they match.
  const withCap = [grayFrame(burned, 0.9), grayFrame(clean, 0.9)];
  const lower = differing(withCap[0], withCap[1], [180, 360]);
  const upper = differing(withCap[0], withCap[1], [0, 120]);
  const noCap = [grayFrame(burned, 5.8), grayFrame(clean, 5.8)];
  const quiet = differing(noCap[0], noCap[1], [0, 360]);
  console.log(`[captions] burn-in compare: caption-area differing px=${lower}, upper px=${upper}, no-caption frame px=${quiet}`);
  expect(lower).toBeGreaterThan(300);
  expect(upper).toBeLessThan(lower / 10 + 5);
  expect(quiet).toBeLessThan(50);
});
