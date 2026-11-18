import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOAK, SOAK_MEDIA_DIR, installProbes, pct, writeOut } from "./soak-lib";
import { scrub } from "./session";
import { importInput, openEditor } from "../helpers";
import { E2E_FFMPEG } from "../env";

/**
 * Scrub latency on a long-GOP 4K H.264 source, with and without proxies (Toggle Proxies, Shift+P).
 * A 4-minute stream-copied cut of the 10-minute 4K soak source keeps the proxy build short while
 * the GOP structure (10 s keyframes) and bitrate are those of the long file.
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1 (pnpm --filter @openreel/web test:soak)");

test("4K long-GOP scrub latency: original vs proxy", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const dir = mkdtempSync(join(tmpdir(), "openreel-soak-4k-"));
  const clip = join(dir, "uhd-longgop-4min.mp4");
  execFileSync(E2E_FFMPEG, ["-v", "error", "-y", "-i", join(SOAK_MEDIA_DIR, "uhd-h264-longgop.mp4"), "-t", "240", "-c", "copy", clip]);
  await page.addInitScript(installProbes);
  // openEditor imports the small fixture clip: the Proxies section is part of the populated media list.
  await openEditor(page);

  // Ingest preset: create 540p proxies on import.
  const panel = page.getByTestId("proxy-panel");
  await panel.waitFor({ timeout: 30_000 });
  const header = panel.getByRole("button", { name: /^Proxies/ }).first();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  await page.getByRole("combobox", { name: "Ingest preset" }).click();
  await page.getByRole("option", { name: "Create proxies" }).click();
  await page.getByRole("combobox", { name: "Proxy size" }).click();
  await page.getByRole("option", { name: /540p/ }).click();

  const proxyStart = Date.now();
  await importInput(page).setInputFiles(clip);
  await expect
    .poll(() => page.evaluate(() => (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === "uhd-longgop-4min.mp4")?.proxy?.status ?? "none"), { timeout: 30 * 60_000, intervals: [2000] })
    .toBe("ready");
  const proxyBuildMs = Date.now() - proxyStart;

  await page.evaluate(async () => {
    const E = (window as any).__openreelE2E;
    const st = E.project.getState();
    await st.updateSettings({ width: 3840, height: 2160, frameRate: 30 });
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "uhd-longgop-4min.mp4");
    await st.addTrack("video", undefined, { name: "UHD" });
    const track = E.project.getState().project.timeline.tracks.filter((t: any) => t.type === "video").at(-1).id;
    await st.executeAction({ type: "clip/add", params: { trackId: track, mediaId: item.id, startTime: 0, clipId: crypto.randomUUID(), duration: 230, inPoint: 0, outPoint: 230 } });
  });
  // SOAK_4K_SETTLE_MS lets background work (seek-anchor sampling) finish so builds compare on steady state.
  await page.waitForTimeout(Number(process.env.SOAK_4K_SETTLE_MS ?? 3000));

  const rng = (() => {
    let s = 99;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const targets = (n: number) => Array.from({ length: n }, () => 5 + rng() * 215);
  const toggle = page.getByTestId("toggle-proxies");
  const results: Record<string, { n: number; p50: number; p95: number; max: number }> = {};
  for (const mode of ["proxy", "original"] as const) {
    const wantPressed = mode === "proxy" ? "true" : "false";
    if ((await toggle.getAttribute("aria-pressed")) !== wantPressed) await toggle.click();
    await page.waitForTimeout(1500);
    await scrub(page, targets(3)); // warm the decoders
    const r = await scrub(page, targets(20));
    const lat = r.latencyMs.filter((x) => x > 0);
    results[mode] = { n: lat.length, p50: pct(lat, 50), p95: pct(lat, 95), max: Math.max(0, ...lat) };
    console.log(`[scrub 4k] ${mode}: ${JSON.stringify(results[mode])}`);
  }
  writeOut("scrub-4k-proxy.json", { proxyBuildMs, results });
  console.log(`[scrub 4k] proxy build ${(proxyBuildMs / 1000).toFixed(0)} s for 4 min of 4K H.264`);
  expect(results.proxy.n).toBeGreaterThan(5);
});
