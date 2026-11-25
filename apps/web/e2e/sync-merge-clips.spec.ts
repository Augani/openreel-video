import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { E2E_FFMPEG } from "./env";
import { clipLocator, importInput, press, settle } from "./helpers";
import { generateCameras, openMulticamEditor, type Hook } from "./multicam-lib";

/**
 * Timeline > Synchronize > By Audio: a camera clip (cam-red, scratch audio) and a
 * separate recorder file that started 0.8 s after the camera. The recorder is a
 * different microphone (lowpassed mono WAV cut from the same master sound), so
 * only the waveform can line them up. The recorder clip must land 0.8 s after
 * the camera clip's media start, within one frame, and undo must restore it.
 */
const LEAD = 0.8;
const FRAME = 1 / 30;

test("sync-merge synchronize by audio aligns a camera clip with a separate recorder file (undoable)", async ({ page }) => {
  await openMulticamEditor(page);
  const recorder = join(generateCameras(), "recorder.wav");
  execFileSync(
    E2E_FFMPEG,
    ["-y", "-ss", String(LEAD), "-t", "11", "-i", join(generateCameras(), "master.wav"), "-af", "lowpass=f=2500,volume=0.7", "-ac", "1", "-ar", "44100", recorder],
    { stdio: "ignore" },
  );
  await importInput(page).setInputFiles(recorder);
  await page.getByLabel("Select media recorder.wav").waitFor({ timeout: 60_000 });

  const ids = await page.evaluate(async () => {
    const h = (window as unknown as { __openreelE2E: Hook & { project: { getState(): any } } }).__openreelE2E;
    const st = () => h.project.getState();
    const items = st().project.mediaLibrary.items;
    const cam = items.find((m: any) => m.name === "cam-red.mp4");
    const rec = items.find((m: any) => m.name === "recorder.wav");
    const tracks = st().project.timeline.tracks;
    const video = tracks.find((t: any) => t.type === "video");
    const audio = tracks.find((t: any) => t.type === "audio");
    const a = await st().addClip(video.id, cam.id, 2);
    const b = await st().addClip(audio.id, rec.id, 6);
    const clips = st().project.timeline.tracks.flatMap((t: any) => t.clips);
    return {
      cam: clips.find((c: any) => c.mediaId === cam.id && c.trackId === video.id)?.id as string,
      rec: clips.find((c: any) => c.mediaId === rec.id && c.trackId === audio.id)?.id as string,
      ok: [a.success, b.success],
    };
  });
  expect(ids.ok).toEqual([true, true]);

  const startOf = (id: string) =>
    page.evaluate((clipId) => {
      const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
      const clips = (h.project.getState().project.timeline.tracks as Array<{ clips: Array<{ id: string; startTime: number; inPoint: number }> }>).flatMap((t) => t.clips);
      const c = clips.find((x) => x.id === clipId);
      return c ? c.startTime - c.inPoint : NaN;
    }, id);

  expect(await startOf(ids.rec)).toBeCloseTo(6, 3);
  await page.evaluate(({ cam, rec }) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    (h.ui.getState().selectMultiple as (items: unknown[]) => void)([{ type: "clip", id: cam }, { type: "clip", id: rec }]);
  }, ids);
  await settle(page, 300);
  await clipLocator(page, ids.cam).click({ button: "right" });
  await page.getByTestId("clip-synchronize").click();
  await page.getByTestId("sync-by-audio").click();

  // Camera stays; the recorder's media 0 lands LEAD seconds after the camera's media 0.
  await expect.poll(async () => Math.abs((await startOf(ids.rec)) - (await startOf(ids.cam)) - LEAD), { timeout: 60_000 }).toBeLessThan(FRAME);
  expect(await startOf(ids.cam)).toBeCloseTo(2, 3);

  await press(page, "Meta+z");
  await expect.poll(() => startOf(ids.rec), { timeout: 10_000 }).toBeCloseTo(6, 3);
  await press(page, "Meta+Shift+z");
  await expect.poll(async () => Math.abs((await startOf(ids.rec)) - (await startOf(ids.cam)) - LEAD), { timeout: 10_000 }).toBeLessThan(FRAME);
});
