import { expect, test } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { openEditor } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";
import type { useProjectStore } from "../src/stores/project-store";

test("X preset exports audible stereo AAC-LC without a native AAC encoder or decoder", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const decodeProbe = AudioDecoder.isConfigSupported.bind(AudioDecoder);
    AudioDecoder.isConfigSupported = async (config) =>
      config.codec.startsWith("mp4a") ? { supported: false, config } : decodeProbe(config);
    const probe = AudioEncoder.isConfigSupported.bind(AudioEncoder);
    AudioEncoder.isConfigSupported = async (config) =>
      config.codec.startsWith("mp4a") ? { supported: false, config } : probe(config);
  });
  await openEditor(page);
  await page.evaluate(async () => {
    const { project } = (window as unknown as { __openreelE2E: { project: typeof useProjectStore } }).__openreelE2E;
    await project.getState().updateSettings({ channelLayout: "5.1", channels: 6 });
  });
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('label[for="export-platform-Twitter"]').click();
  await dialog.locator('label[for="export-preset-twitter"]').click();
  const download = page.waitForEvent("download", { timeout: 150_000 });
  await dialog.getByRole("button", { name: "Export Video", exact: true }).last().click();
  const file = testInfo.outputPath("twitter.mp4");
  await (await download).saveAs(file);
  const streams = JSON.parse(execFileSync(E2E_FFPROBE, ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" })).streams;
  expect(streams).toEqual(expect.arrayContaining([
    expect.objectContaining({ codec_name: "h264", pix_fmt: "yuv420p" }),
    expect.objectContaining({ codec_name: "aac", profile: "LC", channels: 2 }),
  ]));
  const { packets } = JSON.parse(execFileSync(E2E_FFPROBE, [
    "-v", "error", "-select_streams", "a:0", "-show_packets", "-read_intervals", "%+#1", "-of", "json", file,
  ], { encoding: "utf8" }));
  expect(packets[0].side_data_list).toContainEqual(expect.objectContaining({ skip_samples: 1024 }));
  const decode = spawnSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8" });
  expect(decode.status, decode.stderr).toBe(0);
  expect(decode.stderr).toBe("");
  const pcm = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", file, "-map", "0:a", "-t", "3", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
  expect(Math.sqrt(energy / (pcm.length / 2))).toBeGreaterThan(0.005);
});
