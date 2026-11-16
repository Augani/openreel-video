import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importInput, openEditor, seek, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * ProRes on the WEB build. Browsers cannot decode ProRes, and the web editor has no ffmpeg sidecar, so
 * it keeps the proxy/transcode path. The point of this spec is that the user is always told why:
 * importing a ProRes file either makes it playable (browser-side conversion) or says, in a toast and
 * on the monitor, that this browser cannot decode it and what to do. Never a silent blank monitor.
 */

const workDir = mkdtempSync(join(tmpdir(), "openreel-prores-web-"));
const PRORES = join(workDir, "web-prores.mov");

test.beforeAll(() => {
  execFileSync(E2E_FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=2",
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", PRORES,
  ]);
});

test("a ProRes file on the web is converted or explained, never silently blank", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await importInput(page).setInputFiles(PRORES);
  await page.getByLabel("Select media web-prores.mov").waitFor({ timeout: 120_000 });
  await settle(page, 1500);

  const native = await page.evaluate(() => Boolean((window as any).openreel?.media?.nativeFrame));
  expect(native, "the web build has no native decoder").toBe(false);

  // Converted in the browser (ffmpeg.wasm) means the stored blob is no longer the ProRes .mov.
  const stored = await page.evaluate(() => {
    const item = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.name.startsWith("web-prores"));
    return { type: (item?.blob?.type ?? "") as string, size: (item?.blob?.size ?? 0) as number };
  });
  const converted = stored.type === "video/mp4";
  console.log(`[prores-web] stored blob: ${stored.type} ${stored.size} bytes; ${converted ? "converted for the browser" : "left as ProRes"}`);

  if (!converted) {
    // Not convertible in this browser: the reason must be on screen.
    await page.getByRole("button", { name: "Media actions for web-prores.mov" }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
    await seek(page, 0.5);
    const reason = page.getByTestId("preview-failure-reason");
    await expect(reason).toContainText(/cannot decode/i, { timeout: 20_000 });
    await expect(reason).toContainText(/proxy|desktop app/i);
  }
});
