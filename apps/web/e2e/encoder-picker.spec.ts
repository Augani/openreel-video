import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { settle } from "./helpers";
import { ensureLumetriFixtures, openWithClips } from "./lumetri-basic-lib";

// Export dialog > Encoder: Auto / Hardware / Software, enabled only where WebCodecs reports the encoder.
// An unavailable choice is shown disabled with the reason; a Software export is a real H.264 file.

test.beforeAll(() => ensureLumetriFixtures());

test("Encoder picker reflects this browser's WebCodecs support and a Software export is real H.264", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await openWithClips(page, ["lumetri-flat.mp4"]);
  const support = await page.evaluate(async () => {
    const probe = async (hardwareAcceleration: "prefer-hardware" | "prefer-software"): Promise<boolean> => {
      try {
        return (await VideoEncoder.isConfigSupported({ codec: "avc1.640028", width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30, hardwareAcceleration })).supported === true;
      } catch {
        return false;
      }
    };
    return typeof VideoEncoder === "undefined" ? { hardware: false, software: false } : { hardware: await probe("prefer-hardware"), software: await probe("prefer-software") };
  });
  console.log(`[encoder] webcodecs support: ${JSON.stringify(support)}`);

  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  const picker = page.getByTestId("encoder-picker");
  await picker.scrollIntoViewIfNeeded();
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("encoder-auto")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("encoder-hardware")).toHaveAttribute("data-available", String(support.hardware));
  await expect(page.getByTestId("encoder-software")).toHaveAttribute("data-available", String(support.software));
  if (!support.hardware) await expect(page.getByTestId("encoder-hardware")).toContainText(/no hardware encoder/i);
  if (support.hardware) {
    // Changing a setting that re-runs the probe must never change the user's encoder choice.
    await page.getByTestId("encoder-hardware").click();
    await expect(page.getByTestId("encoder-hardware")).toHaveAttribute("data-selected", "true");
    await page.locator("#export-frame-rate").click();
    await page.getByRole("option", { name: /^24/ }).first().click();
    await settle(page, 1500);
    await expect(page.getByTestId("encoder-hardware")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("encoder-auto")).not.toHaveAttribute("data-selected", "true");
  }
  if (!support.software) {
    testInfo.annotations.push({ type: "encoder", description: "no software WebCodecs encoder here: disabled state verified, export not exercised" });
    return;
  }

  await page.getByTestId("encoder-software").click();
  await expect(page.getByTestId("encoder-software")).toHaveAttribute("data-selected", "true");
  const download = page.waitForEvent("download", { timeout: 240_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const out = testInfo.outputPath("software.mp4");
  await (await download).saveAs(out);
  const codec = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", out]).toString().trim();
  expect(codec).toBe("h264");
});
