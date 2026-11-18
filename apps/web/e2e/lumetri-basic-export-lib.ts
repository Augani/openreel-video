import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { seek, settle, snapStable } from "./helpers";
import { bandMeans, clipGrade, openColorGrading, openWithClips, setSliderValue } from "./lumetri-basic-lib";

export interface ExportParityResult {
  preview: Array<[number, number, number]>;
  exported: Array<[number, number, number]>;
  grade: Record<string, any> | undefined;
}

const PARITY_BANDS = 5;

/** Mean RGB of vertical bands (middle 60% of the height) of one decoded export frame. */
function bandsOfFrame(mp4: string, t: number, width: number, height: number): Array<[number, number, number]> {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", `scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  expect(buf.length, `frame decoded from ${mp4}`).toBe(width * height * 3);
  const out: Array<[number, number, number]> = [];
  for (let band = 0; band < PARITY_BANDS; band++) {
    const x0 = Math.floor((width * band) / PARITY_BANDS);
    const x1 = Math.floor((width * (band + 1)) / PARITY_BANDS);
    const sum: [number, number, number] = [0, 0, 0];
    let count = 0;
    for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 3;
        sum[0] += buf[i];
        sum[1] += buf[i + 1];
        sum[2] += buf[i + 2];
        count++;
      }
    out.push([sum[0] / count, sum[1] / count, sum[2] / count]);
  }
  return out;
}

/** Grade the gradient clip (tone + vignette through the UI), export it, and read both frames at t = 1s. */
export async function runExportParityFlow(page: Page, outPath: string): Promise<ExportParityResult> {
  const [clipId] = await openWithClips(page, ["lumetri-gradient.mp4"]);
  await seek(page, 1);
  await openColorGrading(page, clipId);
  await setSliderValue(page, "Shadows", 0.5);
  await setSliderValue(page, "Contrast", 0.25);
  await setSliderValue(page, "Highlights", -0.4);
  await page.getByRole("button", { name: "Vignette", exact: true }).click();
  await setSliderValue(page, "Vignette Amount", -0.5);
  await expect.poll(async () => (await clipGrade(page, clipId))?.vignette?.amount).toBe(-0.5);
  await seek(page, 1);
  await snapStable(page, "parity-preview");
  const preview = await bandMeans(page, "parity-preview", PARITY_BANDS);
  await seek(page, 0);
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 480_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  await (await download).saveAs(outPath);
  return {
    preview: preview.bands,
    exported: bandsOfFrame(outPath, 1, preview.width, preview.height),
    grade: await clipGrade(page, clipId),
  };
}
