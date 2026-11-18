import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEditor, settle } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";

/**
 * CEA-608 captions inside the H.264 stream, in real Chrome: File > Embed CEA-608 captions...
 * writes the project's captions into an exported MP4. The picture and audio of the result are
 * bit-identical to the input (ffmpeg stream hashes), ffprobe reports ATSC A53 closed-caption
 * side data on the captioned frames, and ffmpeg's independent CEA-608 decoder reads the same
 * text at the cue times from the video stream itself (no subtitle track involved).
 */

const FFMPEG = E2E_FFMPEG;
const FFPROBE = E2E_FFPROBE;
const workDir = mkdtempSync(join(tmpdir(), "openreel-cea608-"));

const TRANSCRIPT = {
  language: "en",
  segments: [
    { speaker: "Ann", words: [{ word: "Welcome", start: 0.5, end: 0.9 }, { word: "to", start: 0.9, end: 1.0 }, { word: "the", start: 1.0, end: 1.1 }, { word: "show.", start: 1.1, end: 1.5 }] },
    { speaker: "Bob", words: [{ word: "Second", start: 3.0, end: 3.5 }, { word: "caption.", start: 3.5, end: 4.2 }] },
  ],
};

async function chooseFileMenu(page: Page, path: string[]): Promise<void> {
  await page.getByRole("menubar", { name: "Application menu" }).getByText("File", { exact: true }).click();
  for (let i = 0; i < path.length; i++) {
    const item = page.getByRole("menuitem", { name: path[i] }).first();
    if (i < path.length - 1) await item.hover();
    else await item.click();
  }
}

const hash = (file: string, map: string): string =>
  execFileSync(FFMPEG, ["-v", "error", "-i", file, "-map", map, "-f", "hash", "-hash", "md5", "-"], { encoding: "utf8" }).trim();

test("Embed CEA-608 captions writes them into the H.264 stream: bit-identical picture/audio, decodable from the video", async ({ page }) => {
  test.setTimeout(180_000);
  // An exported-looking file: 30 fps H.264 with B-frames, AAC audio, moov at the front.
  const input = join(workDir, "export.mp4");
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "2", "-g", "30", "-preset", "ultrafast",
    "-c:a", "aac", "-shortest", "-movflags", "+faststart", input,
  ]);

  await openEditor(page);
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "t.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(TRANSCRIPT)) });
  await expect.poll(() => page.evaluate(() => (window as any).__openreelE2E.project.getState().project.timeline.subtitles.length)).toBe(2);
  await settle(page, 400);

  const chooser = page.waitForEvent("filechooser");
  await chooseFileMenu(page, ["Embed CEA-608 captions…"]);
  const download = page.waitForEvent("download");
  await (await chooser).setFiles(input);
  const d = await download;
  expect(d.suggestedFilename()).toBe("export-cc608.mp4");
  const output = join(workDir, "out.mp4");
  await d.saveAs(output);

  // The success toast says how many frames carry captions.
  await expect(page.getByText("CEA-608 captions embedded")).toBeVisible();

  // Picture and audio are bit-identical to the input.
  expect(hash(output, "0:v:0")).toBe(hash(input, "0:v:0"));
  expect(hash(output, "0:a:0")).toBe(hash(input, "0:a:0"));

  // ffprobe: closed-caption side data in the video stream, and only there.
  const side = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=pts_time:frame_side_data_list", output], { encoding: "utf8" });
  const a53 = (side.match(/ATSC A53 Part 4 Closed Captions/g) ?? []).length;
  expect(a53).toBeGreaterThan(30);
  const streams = execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", output], { encoding: "utf8" }).trim().split("\n");
  expect(streams.sort()).toEqual(["audio", "video"]); // no subtitle track was added

  // Independent decoder: ffmpeg's CEA-608 decoder reads the captions out of the video stream.
  const srt = execFileSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", `movie=${output}[out0+subcc]`, "-map", "0:s:0", "-f", "srt", "-"], { encoding: "utf8" });
  const blocks = srt.trim().split(/\n\n/).map((b) => {
    const lines = b.split("\n");
    const m = /(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/.exec(lines[1]);
    const t = (h: string, mi: string, s: string, ms: string) => Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000;
    return { text: lines.slice(2).join(" ").replace(/<[^>]+>|\{\\[^}]*\}/g, "").trim(), start: t(m![1], m![2], m![3], m![4]), end: t(m![5], m![6], m![7], m![8]) };
  });
  console.log(`[cea608] ${a53} frames carry cc_data; decoded from the video stream: ${JSON.stringify(blocks)}`);
  expect(blocks.map((b) => b.text)).toEqual(["Welcome to the show.", "Second caption."]);
  const cues = await page.evaluate(() => ((window as any).__openreelE2E.project.getState().project.timeline.subtitles as any[]).map((s) => [s.startTime as number, s.endTime as number]).sort((a, b) => a[0] - b[0]));
  blocks.forEach((b, i) => {
    expect(Math.abs(b.start - cues[i][0]), `caption ${i} appears within 3 frames of its cue start`).toBeLessThan(0.1);
  });
  writeFileSync(join(workDir, "ok.txt"), "ok");
});
