import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FIXTURE_DIR } from "./global-setup";
import { settle } from "./helpers";
import { ensureLumetriFixtures, openWithClips } from "./lumetri-basic-lib";

// Sequence working colour space (Rec.709 / Rec.2020) and HDR export tagging. Where this browser has a
// 10-bit HEVC encoder the spec exports a real PQ file and reads its colour tags back with ffprobe; where it
// does not, it proves the export dialog says so instead of offering a broken option.

test.beforeAll(() => {
  ensureLumetriFixtures();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, "hdr-colour.mp4");
  if (!existsSync(path)) {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-f", "lavfi", "-i", "nullsrc=size=640x360:rate=30:duration=2",
        "-vf", "format=yuv420p,geq=lum='110+30*Y/H':cb='128-60*cos(2*PI*X/W)':cr='128+60*sin(2*PI*X/W)'",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
        path,
      ],
      { stdio: "ignore" },
    );
  }
});

interface Hook {
  project: { getState(): { project: { settings: Record<string, unknown> }; undo(): Promise<unknown> } };
}

const workingSpace = (page: import("@playwright/test").Page): Promise<unknown> =>
  page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.settings.workingColorSpace);

test("Working color space is a Preview menu setting, defaults to Rec.709, undoes", async ({ page }) => {
  test.setTimeout(180_000);
  await openWithClips(page, ["lumetri-gradient.mp4"]);
  expect(await workingSpace(page)).toBeUndefined();

  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByRole("menuitem", { name: "Working color space" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Rec.709 (default)" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Rec.2020" }).click();
  await expect.poll(() => workingSpace(page)).toBe("rec2020");

  await page.getByRole("button", { name: "Preview options" }).click();
  await page.getByRole("menuitem", { name: "Working color space" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Rec.2020" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().undo());
  await expect.poll(() => workingSpace(page)).not.toBe("rec2020");
});

test("HDR export: a real PQ BT.2020 10-bit file where the browser can encode it, an honest disabled option where it cannot", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await openWithClips(page, ["hdr-colour.mp4"]);
  const hevc10 = await page.evaluate(async () => {
    if (typeof VideoEncoder === "undefined") return false;
    try {
      return (await VideoEncoder.isConfigSupported({ codec: "hvc1.2.4.L153.B0", width: 1920, height: 1080, bitrate: 20_000_000, framerate: 30 })).supported === true;
    } catch {
      return false;
    }
  });
  console.log(`[hdr] 10-bit HEVC encoder available: ${hevc10}`);

  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  const control = page.getByTestId("export-hdr-control");
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await page.getByRole("combobox", { name: "Color and HDR" }).click();

  if (!hevc10) {
    await expect(page.getByRole("option", { name: /HDR10 \(PQ, BT\.2020\)/ })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("option", { name: /HLG/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-hdr-unavailable")).toContainText(/10-bit HEVC/);
    testInfo.annotations.push({ type: "hdr", description: "no 10-bit HEVC encoder here: disabled UI verified, encode not exercised" });
    return;
  }

  await page.getByRole("option", { name: /HDR10 \(PQ, BT\.2020\)/ }).click();
  await expect(page.getByText(/Writes 10-bit H\.265 tagged BT\.2020 with a PQ transfer/)).toBeVisible();
  const download = page.waitForEvent("download", { timeout: 360_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const out = testInfo.outputPath("hdr-pq.mp4");
  await (await download).saveAs(out);

  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,color_primaries,color_transfer,color_space,profile", "-of", "json", out]).toString(),
  ) as { streams: Array<Record<string, string>> };
  const stream = probe.streams[0];
  console.log(`[hdr] exported stream: ${JSON.stringify(stream)}`);
  expect(stream.codec_name).toBe("hevc");
  expect(stream.pix_fmt).toBe("yuv420p10le");
  expect(stream.color_primaries).toBe("bt2020");
  expect(stream.color_transfer).toBe("smpte2084");
  expect(stream.color_space).toBe("bt2020nc");
});

test("Rec.2020 sequence: the exported H.264 file is converted and tagged BT.2020 (ffprobe)", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await openWithClips(page, ["hdr-colour.mp4"]);

  await page.evaluate(async () => {
    await (window as unknown as { __openreelE2E: { project: { getState(): { updateSettings(s: Record<string, unknown>): Promise<unknown> } } } }).__openreelE2E.project.getState().updateSettings({ workingColorSpace: "rec2020" });
  });
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  const download = page.waitForEvent("download", { timeout: 360_000 });
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const out = testInfo.outputPath("rec2020.mp4");
  await (await download).saveAs(out);
  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,color_primaries,color_transfer,color_space", "-of", "json", out]).toString(),
  ) as { streams: Array<Record<string, string>> };
  const tagged = probe.streams[0];
  console.log(`[hdr] rec2020 export stream: ${JSON.stringify(tagged)}`);
  expect(tagged.codec_name).toBe("h264");
  expect(tagged.pix_fmt).toBe("yuv420p");
  expect(tagged.color_primaries).toBe("bt2020");
  expect(tagged.color_space).toBe("bt2020nc");
  expect(tagged.color_transfer).toBe("bt709");
});
