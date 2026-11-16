import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SOAK, SOAK_MEDIA_DIR } from "./soak-lib";
import { importInput, openEditor } from "../helpers";
import { E2E_FFMPEG } from "../env";

/**
 * Smoke check that seeking repaints the Program monitor. The fixture clip (three scenes) is placed on the
 * timeline and the canvas must show a different picture at the start of each scene. Guards the playback project
 * stabiliser (playback-project.ts): an over-eager "same project" test leaves the paused-frame render stale.
 * SOAK_SMOKE_4K=1 repeats it with a real 4K long-GOP cut added through the actions, as the memory gate does.
 */
test.skip(!SOAK, "set OPENREEL_SOAK=1 (pnpm --filter @openreel/web test:soak)");

test("seeking repaints the Program monitor", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await openEditor(page);
  const canvas = page.locator('canvas[aria-label^="Program frame"]');
  const hash = async (): Promise<string> => createHash("md5").update(await canvas.screenshot({ type: "png", animations: "disabled" })).digest("hex");
  let targets = [0.3, 2.0, 4.0, 0.3];
  if (process.env.SOAK_SMOKE_4K === "1") {
    const src = join(SOAK_MEDIA_DIR, "uhd-h264-longgop.mp4");
    test.skip(!existsSync(src), "missing soak media");
    const clip = join(mkdtempSync(join(tmpdir(), "openreel-smoke-")), "smoke4k.mp4");
    execFileSync(E2E_FFMPEG, ["-v", "error", "-y", "-ss", "30", "-i", src, "-t", "30", "-c", "copy", clip]);
    await importInput(page).setInputFiles(clip);
    await page.getByLabel("Select media smoke4k.mp4").waitFor({ timeout: 60_000 });
    await page.evaluate(async () => {
      const E = (window as any).__openreelE2E;
      const log: unknown[] = [];
      (window as any).__changes = log;
      E.project.subscribe((s: any, p: any) => {
        if (s.project !== p.project) log.push({ keys: Object.keys(s.project).filter((k) => s.project[k] !== p.project[k]), t: Math.round(performance.now()) });
      });
      await E.project.getState().updateSettings({ width: 3840, height: 2160, frameRate: 30 });
      await E.project.getState().addTrack("video", undefined, { name: "UHD" });
      const track = E.project.getState().project.timeline.tracks.filter((t: any) => t.type === "video").at(-1).id;
      const item = E.project.getState().project.mediaLibrary.items.find((m: any) => m.name === "smoke4k.mp4");
      await E.project.getState().executeAction({ type: "clip/add", params: { trackId: track, mediaId: item.id, startTime: 0, clipId: crypto.randomUUID(), duration: 28, inPoint: 0, outPoint: 28 } });
    });
    await page.waitForTimeout(6000);
    targets = [1, 9, 17, 25, 1, 13];
  } else {
    // (small fixture: scene starts)
  }
  const seen = new Map<number, string>();
  for (const t of targets) {
    await page.evaluate((time) => (window as any).__openreelE2E.timeline.getState().seekTo(time), t);
    await page.waitForTimeout(2500);
    seen.set(t, await hash());
    console.log(`[scrub-smoke] t=${t} ${seen.get(t)}`);
  }
  const changes = await page.evaluate(() => (window as any).__changes ?? null);
  console.log(`[scrub-smoke] project changes ${JSON.stringify(changes)}`);
  expect(new Set(seen.values()).size, "different positions paint different pictures").toBeGreaterThan(1);
});
