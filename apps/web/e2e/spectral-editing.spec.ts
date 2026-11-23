import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, importInput, openEditor, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Spectral editing, checked in real Chrome with real audio:
 *  - paint a box over the 1 kHz tone of a three-tone fixture in the spectral editor and Remove it, then drag a
 *    frequency band over the 3 kHz tone and Attenuate it by 12 dB (real pointer input on the canvas);
 *  - the export mixdown has the 1 kHz tone gone, the 3 kHz tone 12 dB down and the 440 Hz tone untouched;
 *  - the live preview path (RealtimeAudioGraph on the same cached repair) renders the same samples as the export;
 *  - every edit is one undo step, and undo restores the original mixdown exactly;
 *  - a real export from the export queue, decoded with ffmpeg, carries the edit.
 */

const FFMPEG = E2E_FFMPEG;
const workDir = mkdtempSync(join(tmpdir(), "openreel-spectral-"));
const SR = 48000;
const SECONDS = 4;

interface Hook {
  project: { getState(): Record<string, any> };
  audio: Record<string, any>;
  exportQueue: { getState(): Record<string, any> };
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

/** 4 s mono WAV: 440 Hz, 1 kHz and 3 kHz sines at 0.2 each (steady, so a region measures cleanly). */
function writeToneWav(path: string): void {
  const n = SR * SECONDS;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = 0.2 * Math.sin(2 * Math.PI * 440 * t) + 0.2 * Math.sin(2 * Math.PI * 1000 * t + 1) + 0.2 * Math.sin(2 * Math.PI * 3000 * t + 2);
    pcm.writeInt16LE(Math.round(x * 32767), 44 + i * 2);
  }
  writeFileSync(path, pcm);
}

const toneAmp = (x: Float32Array, freq: number, from: number, to: number): number => {
  const a = Math.floor(from * SR);
  const b = Math.floor(to * SR);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);

function decodeAudio(file: string): Float32Array {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

/** The export mixdown of [0, seconds], mono, as the export engine renders it. */
async function renderMix(page: Page, seconds: number): Promise<number[]> {
  return page.evaluate(async (len) => {
    const engine = E().audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(E().project.getState().getFullProject(), 0, len);
    return Array.from(out.buffer.getChannelData(0) as Float32Array);
  }, seconds);
}

interface Stage {
  box: { x: number; y: number; width: number; height: number };
  start: number;
  end: number;
  minHz: number;
  maxHz: number;
}

async function readStage(page: Page): Promise<Stage> {
  const stage = page.getByTestId("spectral-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("spectral stage is not visible");
  const num = async (name: string) => Number(await stage.getAttribute(name));
  return { box, start: await num("data-start"), end: await num("data-end"), minHz: await num("data-min-hz"), maxHz: await num("data-max-hz") };
}
const px = (s: Stage, t: number) => s.box.x + ((t - s.start) / (s.end - s.start)) * s.box.width;
const py = (s: Stage, hz: number) => s.box.y + (1 - Math.log(hz / s.minHz) / Math.log(s.maxHz / s.minHz)) * s.box.height;

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test("paint a region over a test tone: the exported and previewed audio lose it, undo restores it", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  const wavPath = join(workDir, "three-tones.wav");
  writeToneWav(wavPath);
  await openEditor(page);
  await importInput(page).setInputFiles(wavPath);
  await page.getByLabel("Select media three-tones.wav").waitFor({ timeout: 30_000 });
  const added = await page.evaluate(async () => {
    const st = E().project.getState();
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "three-tones.wav");
    const target = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue");
    const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    return st.addClip(target.id, item.id, 0);
  });
  expect(added.success, JSON.stringify(added)).toBe(true);
  await settle(page, 400);
  const clipId = await page.evaluate(() => E().project.getState().project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0].id as string);

  const before = Float32Array.from(await renderMix(page, 3.8));
  const beforeAmps = { a440: toneAmp(before, 440, 1, 3), a1k: toneAmp(before, 1000, 1, 3), a3k: toneAmp(before, 3000, 1, 3) };
  console.log("[spectral] mix before", JSON.stringify(beforeAmps));
  expect(beforeAmps.a1k, "fixture tone is audible").toBeGreaterThan(0.05);

  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  await page.getByRole("button", { name: "Expand Spectral editing section" }).click();
  const editor = page.getByTestId("spectral-editor");
  await editor.waitFor({ timeout: 30_000 });
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  // The spectrogram really shows the three tones: bright pixels at 440 Hz, 1 kHz and 3 kHz, dark in between.
  await editor.getByTestId("spectral-range").selectOption("voice");
  await expect(page.getByTestId("spectral-stage")).toHaveAttribute("data-min-hz", "80");
  await page.waitForTimeout(500); // the canvas repaints in an effect after the range changes
  const lines = await editor.getByTestId("spectral-canvas").evaluate(async (canvas: HTMLCanvasElement, hzList: number[]) => {
    const stage = canvas.parentElement!;
    const minHz = Number(stage.dataset.minHz);
    const maxHz = Number(stage.dataset.maxHz);
    const ctx = canvas.getContext("2d")!;
    const luma = (hz: number) => {
      const y = Math.round((1 - Math.log(hz / minHz) / Math.log(maxHz / minHz)) * (canvas.height - 1));
      const x = Math.round(canvas.width / 2);
      // A tone is a thin line (sub-pixel to a few px wide on a log axis), so take the brightest pixel within +-3 rows.
      let best = 0;
      for (let dy = -3; dy <= 3; dy++) {
        const d = ctx.getImageData(x, Math.max(0, Math.min(canvas.height - 1, y + dy)), 1, 1).data;
        best = Math.max(best, d[0] + d[1] + d[2]);
      }
      return best;
    };
    return hzList.map(luma);
  }, [440, 700, 1000, 1700, 3000]);
  await editor.screenshot({ path: join(workDir, "spectral-before.png") });
  console.log("[spectral] spectrogram luma at 440/700/1000/1700/3000", JSON.stringify(lines));
  expect(lines[0], "440 Hz line").toBeGreaterThan(lines[1] * 2);
  expect(lines[2], "1 kHz line").toBeGreaterThan(lines[3] * 2);
  expect(lines[4], "3 kHz line").toBeGreaterThan(lines[3] * 2);

  // 1) Rectangle over the 1 kHz tone, 0.5 s to 3.5 s, then Remove.
  const start = await history(page);
  let stage = await readStage(page);
  await drag(page, { x: px(stage, 0.5), y: py(stage, 1250) }, { x: px(stage, 3.5), y: py(stage, 800) });
  await expect(editor.getByTestId("spectral-selection")).toBeVisible();
  await expect(editor.getByTestId("spectral-readout")).toContainText("Selection");
  await editor.getByTestId("spectral-remove").click();
  await expect(editor.getByTestId("spectral-region-row")).toHaveCount(1, { timeout: 15_000 });
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  expect(await history(page), "Remove is one undo step").toBe(start + 1);

  // 2) Frequency-band marquee over the 3 kHz tone (whole source), attenuate 12 dB.
  await editor.getByTestId("spectral-tool-band").click();
  stage = await readStage(page);
  await drag(page, { x: px(stage, 1), y: py(stage, 3800) }, { x: px(stage, 2), y: py(stage, 2400) });
  await expect(editor.getByTestId("spectral-selection")).toBeVisible();
  await editor.getByTestId("spectral-db").fill("12");
  await editor.getByTestId("spectral-attenuate").click();
  await expect(editor.getByTestId("spectral-region-row")).toHaveCount(2, { timeout: 15_000 });
  expect(await history(page), "Attenuate is one more undo step").toBe(start + 2);
  const regions = await page.evaluate((id) => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    return clip.audioEffects.filter((e: any) => e.type === "spectralRepair").map((e: any) => e.params.regions);
  }, clipId);
  console.log("[spectral] stored regions", JSON.stringify(regions));
  expect(regions).toHaveLength(1);
  expect(regions[0].map((r: any) => r.mode)).toEqual(["remove", "attenuate"]);
  expect(regions[0][1].startTime, "band marquee covers the whole source").toBe(0);
  expect(regions[0][1].endTime).toBeGreaterThan(SECONDS - 0.05);
  expect(regions[0][1].gainDb).toBe(-12);
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await editor.screenshot({ path: join(workDir, "spectral-after.png") });
  console.log(`[spectral] screenshots: ${join(workDir, "spectral-before.png")} ${join(workDir, "spectral-after.png")}`);

  // Zoom keeps the region boxes on the sound they were painted on.
  const regionBox = async () => editor.getByTestId(/^spectral-region-sr-/).first().boundingBox();
  const unzoomed = await regionBox();
  await editor.getByTestId("spectral-zoom-in").click();
  await editor.getByTestId("spectral-zoom-in").click();
  await expect(editor.getByTestId("spectral-pan")).toBeVisible();
  const zoomedStage = await readStage(page);
  expect(zoomedStage.end - zoomedStage.start).toBeLessThan(SECONDS * 0.3);
  const zoomedBox = await regionBox();
  expect(zoomedBox && unzoomed && zoomedBox.width > unzoomed.width * 0.9, "zoomed region stays visible and aligned").toBeTruthy();
  await editor.getByTestId("spectral-zoom-fit").click();

  // Export mixdown: 1 kHz gone, 3 kHz down 12 dB, 440 Hz untouched.
  const after = Float32Array.from(await renderMix(page, 3.8));
  const afterAmps = { a440: toneAmp(after, 440, 1, 3), a1k: toneAmp(after, 1000, 1, 3), a3k: toneAmp(after, 3000, 1, 3) };
  console.log("[spectral] mix after", JSON.stringify(afterAmps));
  expect(db(beforeAmps.a1k, afterAmps.a1k), "1 kHz removed by >= 25 dB").toBeGreaterThan(25);
  expect(db(beforeAmps.a3k, afterAmps.a3k), "3 kHz attenuated by 12 dB").toBeGreaterThan(11.7);
  expect(db(beforeAmps.a3k, afterAmps.a3k), "3 kHz attenuated by 12 dB").toBeLessThan(12.3);
  expect(Math.abs(db(afterAmps.a440, beforeAmps.a440)), "440 Hz untouched").toBeLessThan(0.1);
  // Outside the removal span the 1 kHz tone is still there (the region covered 0.5 s to 3.5 s).
  expect(db(toneAmp(before, 1000, 0.05, 0.3), toneAmp(after, 1000, 0.05, 0.3)), "1 kHz before the region").toBeLessThan(0.5);

  // The live-preview path plays the SAME samples: a RealtimeAudioGraph on an OfflineAudioContext fed the cached repair.
  const parity = await page.evaluate(
    async ({ id, exported }) => {
      const { RealtimeAudioGraph, getAudioEngine } = E().audio;
      const st = E().project.getState();
      const clip = st.project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      const media = st.project.mediaLibrary.items.find((m: any) => m.id === clip.mediaId);
      const decodeCtx = new OfflineAudioContext(2, 1, 48000);
      const source: AudioBuffer = await decodeCtx.decodeAudioData(await media.blob.arrayBuffer());
      const ctx = new OfflineAudioContext(2, Math.floor(48000 * 3.8), 48000);
      const clock = { getAudioContext: () => ctx, currentTime: 0, isPlaying: true };
      const graph = new RealtimeAudioGraph(clock as any);
      const prepared = await graph.prepareSpectralRepair(source, clip.audioEffects);
      graph.scheduleClip({ clipId: id, trackId: "t", audioBuffer: prepared.buffer, startTime: 0, endTime: 3.8, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects: prepared.effects, speed: 1 });
      const played = (await ctx.startRendering()).getChannelData(0) as Float32Array;
      const reference = exported as number[];
      void getAudioEngine;
      // Best scalar between the two paths (they may differ by a fixed bus gain), then the residual.
      let ab = 0;
      let bb = 0;
      const from = 4800;
      const to = Math.min(played.length, reference.length) - 4800;
      for (let i = from; i < to; i++) {
        ab += played[i] * reference[i];
        bb += reference[i] * reference[i];
      }
      const gain = ab / bb;
      let residual = 0;
      for (let i = from; i < to; i++) residual += (played[i] - gain * reference[i]) ** 2;
      return { gain, residualDb: 10 * Math.log10(residual / (gain * gain * bb)), appliedKey: prepared.key.length > 0, strippedEffect: !prepared.effects.some((e: any) => e.type === "spectralRepair") };
    },
    { id: clipId, exported: Array.from(after) },
  );
  console.log("[spectral] preview vs export", JSON.stringify(parity));
  expect(parity.appliedKey, "the preview path applied the regions").toBe(true);
  expect(parity.strippedEffect).toBe(true);
  expect(parity.residualDb, "preview and export samples agree (residual below -80 dB)").toBeLessThan(-80);

  // One undo restores the original mixdown exactly (the band marquee first, then the removal); redo reapplies.
  await page.evaluate(async () => {
    await E().project.getState().undo();
    await E().project.getState().undo();
  });
  await settle(page, 500);
  expect(await history(page)).toBe(start);
  const undone = Float32Array.from(await renderMix(page, 3.8));
  expect(toneAmp(undone, 1000, 1, 3)).toBeCloseTo(beforeAmps.a1k, 6);
  expect(toneAmp(undone, 3000, 1, 3)).toBeCloseTo(beforeAmps.a3k, 6);
  await page.evaluate(async () => {
    await E().project.getState().redo();
    await E().project.getState().redo();
  });
  await settle(page, 500);
  expect(db(beforeAmps.a1k, toneAmp(Float32Array.from(await renderMix(page, 3.8)), 1000, 1, 3))).toBeGreaterThan(25);

  // Real export through the queue, decoded with ffmpeg: the edit is in the delivered file.
  const job = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "spectral", outputName: "spectral-edit" }).id as string,
    { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 },
  );
  await page.evaluate(() => E().exportQueue.getState().start());
  await expect
    .poll(() => page.evaluate((id) => E().exportQueue.getState().queue.jobs.find((j: any) => j.id === id)?.status as string, job), { timeout: 180_000, intervals: [500] })
    .toMatch(/completed|failed/);
  const status = await page.evaluate((id) => E().exportQueue.getState().queue.jobs.find((j: any) => j.id === id), job);
  expect(status.status, status.error).toBe("completed");
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  await panel.waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download spectral-edit.mp4" }).click()]);
  const file = join(workDir, "spectral-edit.mp4");
  await download.saveAs(file);
  const exported = decodeAudio(file);
  const e440 = toneAmp(exported, 440, 1, 3);
  const e1k = toneAmp(exported, 1000, 1, 3);
  const e3k = toneAmp(exported, 3000, 1, 3);
  console.log("[spectral] exported file", JSON.stringify({ e440, e1k, e3k }));
  expect(db(e440, e1k), "exported file: the 1 kHz tone is gone (>= 20 dB under the 440 Hz tone)").toBeGreaterThan(20);
  expect(db(e440, e3k), "exported file: the 3 kHz tone is 12 dB under the 440 Hz tone").toBeGreaterThan(11);
  expect(db(e440, e3k)).toBeLessThan(13);
});

test("the spectral editor warns on Heal when a steady tone continues on both sides of the selection, and Use Remove adds a remove region", async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  const wavPath = join(workDir, "three-tones-warn.wav");
  writeToneWav(wavPath);
  await openEditor(page);
  await importInput(page).setInputFiles(wavPath);
  await page.getByLabel("Select media three-tones-warn.wav").waitFor({ timeout: 30_000 });
  await page.evaluate(async () => {
    const st = E().project.getState();
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "three-tones-warn.wav");
    const target = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue");
    return st.addClip(target.id, item.id, 0);
  });
  await settle(page, 400);
  const clipId = await page.evaluate(() => E().project.getState().project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0].id as string);
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  await page.getByRole("button", { name: "Expand Spectral editing section" }).click();
  const editor = page.getByTestId("spectral-editor");
  await editor.waitFor({ timeout: 30_000 });
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await editor.getByTestId("spectral-range").selectOption("voice");
  await page.waitForTimeout(500);

  // A long slice of the 1 kHz tone (1.2 s to 2.4 s of 4 s): Heal only carries a tone across a short gap, so it would take this one
  // out and there is nothing to warn about.
  await page.getByTestId("spectral-stage").scrollIntoViewIfNeeded();
  let stage = await readStage(page);
  await drag(page, { x: px(stage, 1.2), y: py(stage, 1250) }, { x: px(stage, 2.4), y: py(stage, 800) });
  await expect(editor.getByTestId("spectral-heal")).toBeEnabled();
  await expect(editor.getByTestId("spectral-heal-warning")).toHaveCount(0);

  // A short slice (0.15 s): the tone carries on both sides and Heal would carry it through, so it stays: warn.
  stage = await readStage(page);
  await drag(page, { x: px(stage, 1.2), y: py(stage, 1250) }, { x: px(stage, 1.35), y: py(stage, 800) });
  await expect(editor.getByTestId("spectral-heal-warning")).toBeVisible();
  await editor.getByTestId("spectral-heal-use-remove").click();
  await expect.poll(() => page.evaluate((id) => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const effect = (clip.audioEffects ?? []).find((e: any) => e.type === "spectralRepair");
    return (effect?.params.regions ?? []).map((r: any) => r.mode);
  }, clipId)).toEqual(["remove"]);

  // The same band over the whole length has nothing on either side to carry: no warning.
  await page.getByTestId("spectral-stage").scrollIntoViewIfNeeded();
  stage = await readStage(page);
  await drag(page, { x: px(stage, stage.start + 0.01), y: py(stage, 3600) }, { x: px(stage, stage.end - 0.01), y: py(stage, 2600) });
  await expect(editor.getByTestId("spectral-heal")).toBeEnabled();
  await expect(editor.getByTestId("spectral-heal-warning")).toHaveCount(0);
});
