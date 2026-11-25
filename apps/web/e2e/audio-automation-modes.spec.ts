import { expect, test, type Page } from "@playwright/test";
import { openEditor, settle } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";

/**
 * Track automation modes, real Chrome: a Touch pass over a short loop records a fader move into the volume
 * lane (thinned, one undo step for the whole pass), the lane plays back and exports, Off ignores it, and
 * undo / redo restore it.
 */

interface Hook {
  project: { getState(): any };
  timeline: { getState(): any };
  ui: { getState(): any };
  audio: Record<string, any>;
}
declare function E(): Hook;

const TONE = "Select media tone-4s.wav";
const LANE = "Dialogue";

const history = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

const lane = (page: Page) =>
  page.evaluate((name) => {
    const t = E().project.getState().project.timeline.tracks.find((x: any) => x.name === name);
    return { mode: (t.automationMode ?? "read") as string, volume: (t.automation?.volume ?? null) as { time: number; value: number }[] | null };
  }, LANE);

async function rms(page: Page, start: number, duration: number): Promise<number> {
  return page.evaluate(
    async ([s, d]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const project = E().project.getState().getFullProject();
      const out = await engine.renderAudio(project, s, d);
      const left = out.buffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += left[i] * left[i];
      return Math.sqrt(sum / left.length);
    },
    [start, duration] as const,
  );
}

test.describe("Track automation modes", () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
    });
  });

  test("touch pass over a loop records a thinned fader move as one undo step that plays and exports", async ({ page }) => {
    await openEditor(page);
    await page.locator('input[type="file"]').first().setInputFiles(AUDIO_FIXTURE_PATH);
    await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
    const added = await page.evaluate(async (name) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === "tone-4s.wav");
      const target = st.project.timeline.tracks.find((t: any) => t.name === name);
      return st.addClip(target.id, item.id, 0);
    }, LANE);
    expect(added.success, JSON.stringify(added)).toBe(true);
    await settle(page, 400);
    await page.evaluate(() => {
      const st = E().project.getState();
      return st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
    });
    const baseline = await rms(page, 0, 2);
    expect(baseline, "the tone is audible").toBeGreaterThan(0.01);

    await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
    await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
    const depth0 = await history(page);

    // Touch mode via the strip's dropdown: one undo step, saved on the track.
    const select = page.getByLabel(`Automation mode ${LANE}`);
    await expect(select).toHaveValue("read");
    await select.selectOption("touch");
    await expect.poll(() => history(page)).toBe(depth0 + 1);
    expect((await lane(page)).mode).toBe("touch");
    const depth1 = await history(page);

    // Loop 0..2 s and play; hold the fader down for part of the second lap.
    await page.evaluate(() => {
      const t = E().timeline.getState();
      t.setLoopRange(0, 2);
      t.setLoopEnabled(true);
      t.seekTo(0);
      t.play();
    });
    await settle(page, 600);
    const thumb = page.getByRole("slider", { name: `${LANE} volume fader` });
    const box = (await thumb.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x, y + i * 0.6);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(400);
    await page.mouse.up();
    await settle(page, 600);
    await page.evaluate(() => E().timeline.getState().pause());
    await expect.poll(() => history(page), { timeout: 10_000 }).toBeGreaterThan(depth1);

    // The whole pass is ONE undo step.
    expect(await history(page)).toBe(depth1 + 1);
    const recorded = await lane(page);
    expect(recorded.volume, "the move was written to the volume lane").not.toBeNull();
    const points = recorded.volume!;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length, "dense fader samples are thinned").toBeLessThan(40);
    expect(points.every((p, i) => i === 0 || p.time > points[i - 1].time)).toBe(true);
    const lowest = Math.min(...points.map((p) => p.value));
    expect(lowest, "the fader went down").toBeLessThan(0.9);
    expect(lowest, "and stopped well above the bottom").toBeGreaterThan(0.05);
    console.log(`[automation] ${points.length} points, lowest ${lowest.toFixed(3)}`);

    // Playback and export read the lane: a window past the last point holds the recorded value (touch released
    // there and there was no earlier curve to return to).
    const last = points[points.length - 1];
    await page.evaluate(() => E().timeline.getState().setLoopEnabled(false));
    const atLast = await rms(page, Math.min(3, last.time + 0.05), 0.5);
    expect(atLast / baseline).toBeCloseTo(last.value, 1);

    // Off ignores the lane; Read plays it again.
    await select.selectOption("off");
    expect(await rms(page, Math.min(3, last.time + 0.05), 0.5)).toBeCloseTo(baseline, 2);
    await select.selectOption("read");
    expect((await rms(page, Math.min(3, last.time + 0.05), 0.5)) / baseline).toBeCloseTo(last.value, 1);
    // Two undos take back the Off and Read mode changes, the third undoes the recorded pass.
    await page.evaluate(() => E().project.getState().undo());
    await page.evaluate(() => E().project.getState().undo());

    // Undo the pass in one step, redo brings it back.
    await page.evaluate(() => E().project.getState().undo());
    expect((await lane(page)).volume).toBeNull();
    expect(await rms(page, Math.min(3, last.time + 0.05), 0.5)).toBeCloseTo(baseline, 2);
    await page.evaluate(() => E().project.getState().redo());
    expect((await lane(page)).volume).toEqual(points);
  });
});
