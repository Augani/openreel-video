import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, importInput, openEditor, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Spectral editing with brush and lasso selection and Heal, in real Chrome with real audio.
 *  - A 4 s fixture: a 440 Hz tone, a steady 1 kHz tone and a chirp sweeping 2 kHz -> 6 kHz between 1 s and 3 s.
 *  - Paint a brush stroke along the chirp and Heal it; draw a lasso round the 1 kHz tone and Heal it (real pointer input).
 *  - The region list: select, change mode, change gain, hide / show, move and resize a box, edit lasso points,
 *    delete. Every change is one undo step.
 *  - The export mixdown, the live preview path (RealtimeAudioGraph) and real playback (an AnalyserNode on the master bus)
 *    all lose the chirp and the 1 kHz tone while the 440 Hz tone is untouched; a real export decoded with ffmpeg agrees.
 *  - Undo restores the original mixdown exactly; save / reload (JSON) keeps the regions.
 */

const FFMPEG = E2E_FFMPEG;
const workDir = mkdtempSync(join(tmpdir(), "openreel-spectral-masks-"));
const SR = 48000;
const SECONDS = 4;
const CHIRP = { from: 1, to: 3, f0: 2000, f1: 6000, amplitude: 0.2 };
const chirpHz = (t: number): number => CHIRP.f0 * Math.pow(CHIRP.f1 / CHIRP.f0, (t - CHIRP.from) / (CHIRP.to - CHIRP.from));

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

/** The fixture's phase of the chirp at sample i (shared by the WAV writer and the measurement). */
function chirpPhase(i: number): number {
  const t = i / SR;
  const k = Math.log(CHIRP.f1 / CHIRP.f0) / (CHIRP.to - CHIRP.from);
  return (2 * Math.PI * CHIRP.f0 * (Math.exp(k * (t - CHIRP.from)) - 1)) / k;
}

function writeFixtureWav(path: string): void {
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
    let x = 0.2 * Math.sin(2 * Math.PI * 440 * t) + 0.15 * Math.sin(2 * Math.PI * 1000 * t + 1);
    if (t >= CHIRP.from && t < CHIRP.to) {
      const u = (t - CHIRP.from) / (CHIRP.to - CHIRP.from);
      x += CHIRP.amplitude * Math.min(1, u * 20, (1 - u) * 20) * Math.sin(chirpPhase(i));
    }
    pcm.writeInt16LE(Math.round(x * 32767), 44 + i * 2);
  }
  writeFileSync(path, pcm);
}

const toneAmp = (x: ArrayLike<number>, freq: number, from: number, to: number): number => {
  let re = 0;
  let im = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (Math.floor(to * SR) - Math.floor(from * SR));
};
/** Amplitude of the chirp in x over [from, to) seconds: the projection on the fixture's own chirp. */
const chirpAmp = (x: ArrayLike<number>, from: number, to: number): number => {
  let xr = 0;
  let rr = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) {
    const r = Math.sin(chirpPhase(i));
    xr += x[i] * r;
    rr += r * r;
  }
  return xr / rr;
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);

function decodeAudio(file: string): Float32Array {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

async function renderMix(page: Page, seconds: number): Promise<number[]> {
  return page.evaluate(async (len) => {
    const engine = E().audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(E().project.getState().getFullProject(), 0, len);
    return Array.from(out.buffer.getChannelData(0) as Float32Array);
  }, seconds);
}

const storedRegions = (page: Page, clipId: string) =>
  page.evaluate((id) => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const effects = clip.audioEffects.filter((e: any) => e.type === "spectralRepair");
    return { count: effects.length, version: effects[0]?.params.version as number | undefined, regions: (effects[0]?.params.regions ?? []) as any[] };
  }, clipId);

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

/** One pointer gesture through a list of points (pixels), with intermediate moves like a hand would make. */
async function gesture(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) await page.mouse.move(points[i].x, points[i].y, { steps: 8 });
  await page.mouse.up();
}

test("brush a chirp and lasso a tone, heal both: export, preview and live playback agree; list edits and undo", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  const wavPath = join(workDir, "chirp-and-tones.wav");
  writeFixtureWav(wavPath);
  await openEditor(page);
  await importInput(page).setInputFiles(wavPath);
  await page.getByLabel("Select media chirp-and-tones.wav").waitFor({ timeout: 30_000 });
  const added = await page.evaluate(async () => {
    const st = E().project.getState();
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "chirp-and-tones.wav");
    const target = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue");
    const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    return st.addClip(target.id, item.id, 0);
  });
  expect(added.success, JSON.stringify(added)).toBe(true);
  await settle(page, 400);
  const clipId = await page.evaluate(() => E().project.getState().project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0].id as string);

  const before = await renderMix(page, 3.9);
  const beforeAmps = { a440: toneAmp(before, 440, 1, 3), a1k: toneAmp(before, 1000, 1, 3), chirp: chirpAmp(before, 1.2, 2.8) };
  console.log("[masks] mix before", JSON.stringify(beforeAmps));
  expect(beforeAmps.a1k, "1 kHz is audible").toBeGreaterThan(0.08);
  expect(beforeAmps.chirp, "the chirp is audible").toBeGreaterThan(0.1);

  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  await page.getByRole("button", { name: "Expand Spectral editing section" }).click();
  const editor = page.getByTestId("spectral-editor");
  await editor.waitFor({ timeout: 30_000 });
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await editor.getByTestId("spectral-range").selectOption("voice");
  await editor.getByTestId("spectral-expand").click();
  await expect(editor).toHaveAttribute("data-expanded", "true");
  await page.waitForTimeout(700);
  await editor.screenshot({ path: join(workDir, "masks-before.png") });

  // 1) Brush along the chirp (a straight line on the log axis), then Heal.
  const start = await history(page);
  await editor.getByTestId("spectral-tool-brush").click();
  await editor.getByTestId("spectral-brush-size").fill("9");
  let stage = await readStage(page);
  await gesture(page, [
    { x: px(stage, 1.05), y: py(stage, chirpHz(1.05)) },
    { x: px(stage, 2.0), y: py(stage, chirpHz(2.0)) },
    { x: px(stage, 2.95), y: py(stage, chirpHz(2.95)) },
  ]);
  await expect(editor.getByTestId("spectral-selection")).toBeVisible();
  await expect(editor.getByTestId("spectral-readout")).toContainText("Brush");
  await editor.getByTestId("spectral-heal").click();
  await expect(editor.getByTestId("spectral-region-row")).toHaveCount(1, { timeout: 15_000 });
  expect(await history(page), "Heal is one undo step").toBe(start + 1);

  // 2) Lasso round the 1 kHz tone, 0.5 s to 3.5 s, then Heal.
  await editor.getByTestId("spectral-tool-lasso").click();
  stage = await readStage(page);
  const corner = (t: number, hz: number) => ({ x: px(stage, t), y: py(stage, hz) });
  await gesture(page, [corner(0.5, 1300), corner(3.5, 1300), corner(3.5, 780), corner(0.5, 780), corner(0.52, 1280)]);
  await expect(editor.getByTestId("spectral-selection")).toBeVisible();
  await expect(editor.getByTestId("spectral-readout")).toContainText("Lasso");
  await editor.getByTestId("spectral-heal").click();
  await expect(editor.getByTestId("spectral-region-row")).toHaveCount(2, { timeout: 15_000 });
  expect(await history(page)).toBe(start + 2);
  let stored = await storedRegions(page, clipId);
  console.log("[masks] stored", JSON.stringify(stored.regions.map((r) => ({ id: r.id, mode: r.mode, shape: r.shape, points: r.points?.length, feather: r.feather }))));
  expect(stored.count).toBe(1);
  expect(stored.version, "mask regions mark the effect as version 2").toBe(2);
  expect(stored.regions.map((r) => [r.shape, r.mode])).toEqual([["brush", "heal"], ["lasso", "heal"]]);
  expect(stored.regions[0].points.length).toBeGreaterThanOrEqual(2);
  expect(stored.regions[0].brushSeconds).toBeGreaterThan(0);
  expect(stored.regions[1].points.length).toBeGreaterThanOrEqual(4);
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 90_000 });
  await page.waitForTimeout(500);
  await editor.screenshot({ path: join(workDir, "masks-after-heal.png") });

  // 3) The region list: select the lasso, move one of its points, change mode, change gain, hide / show: each one undo step.
  const rows = editor.getByTestId("spectral-region-row");
  await expect(rows.nth(1), "a region is selected right after it is created").toHaveAttribute("data-selected", "true");
  await rows.nth(1).getByTestId("spectral-region-select").click();
  await expect(rows.nth(1)).toHaveAttribute("data-selected", "false");
  await expect(editor.getByTestId("spectral-vertex-0")).toHaveCount(0);
  await rows.nth(1).getByTestId("spectral-region-select").click();
  await expect(rows.nth(1)).toHaveAttribute("data-selected", "true");
  await expect(editor.getByTestId("spectral-vertex-0")).toBeVisible();
  let steps = await history(page);
  const vertex = await editor.getByTestId("spectral-vertex-0").boundingBox();
  const originalPoint = stored.regions[1].points[0];
  await gesture(page, [{ x: vertex!.x + vertex!.width / 2, y: vertex!.y + vertex!.height / 2 }, { x: vertex!.x + vertex!.width / 2 + 12, y: vertex!.y + vertex!.height / 2 - 10 }]);
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].points[0].t, { timeout: 15_000 }).not.toBe(originalPoint.t);
  expect(await history(page), "moving a lasso point is one undo step").toBe(steps + 1);

  steps = await history(page);
  await rows.nth(1).getByTestId("spectral-region-mode").selectOption("attenuate");
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].mode).toBe("attenuate");
  expect(await history(page), "changing the mode is one undo step").toBe(steps + 1);
  await rows.nth(1).getByTestId("spectral-region-gain").fill("20");
  await rows.nth(1).getByTestId("spectral-region-gain").blur();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].gainDb).toBe(-20);
  expect(await history(page), "changing the gain is one undo step").toBe(steps + 2);
  await rows.nth(1).getByTestId("spectral-region-mode").selectOption("heal");
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].mode).toBe("heal");
  await rows.nth(1).getByTestId("spectral-region-enabled").click();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].enabled).toBe(false);
  await expect(editor.getByTestId(`spectral-region-${stored.regions[1].id}`)).toHaveCSS("opacity", "0.3");
  await rows.nth(1).getByTestId("spectral-region-enabled").click();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].enabled).toBe(true);
  expect(await history(page)).toBe(steps + 5);

  // 4) A box in an empty corner: select it, resize with a handle, move it, delete it.
  await editor.getByTestId("spectral-tool-box").click();
  stage = await readStage(page);
  await gesture(page, [{ x: px(stage, 3.3), y: py(stage, 7200) }, { x: px(stage, 3.8), y: py(stage, 6200) }]);
  await editor.getByTestId("spectral-heal").click();
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
  const boxRow = rows.nth(2);
  await expect(boxRow).toHaveAttribute("data-selected", "true");
  const boxId = (await storedRegions(page, clipId)).regions[2].id as string;
  expect((await storedRegions(page, clipId)).regions[2].shape ?? "rect").toBe("rect");
  steps = await history(page);
  const initialEnd = (await storedRegions(page, clipId)).regions[2].endTime as number;
  const east = await editor.getByTestId("spectral-handle-e").boundingBox();
  await gesture(page, [{ x: east!.x + east!.width / 2, y: east!.y + east!.height / 2 }, { x: east!.x + east!.width / 2 - 20, y: east!.y + east!.height / 2 }]);
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[2].endTime).toBeLessThan(initialEnd - 0.03);
  expect(await history(page), "resizing a box is one undo step").toBe(steps + 1);
  const resized = (await storedRegions(page, clipId)).regions[2];
  const body = await editor.getByTestId(`spectral-region-${boxId}`).boundingBox();
  await gesture(page, [{ x: body!.x + body!.width / 2, y: body!.y + body!.height / 2 }, { x: body!.x + body!.width / 2 - 30, y: body!.y + body!.height / 2 + 6 }]);
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[2].startTime).toBeLessThan(resized.startTime - 0.05);
  expect(await history(page), "moving a box is one undo step").toBe(steps + 2);
  await boxRow.getByTestId("spectral-region-delete").click();
  await expect(rows).toHaveCount(2, { timeout: 15_000 });
  expect(await history(page), "deleting is one undo step").toBe(steps + 3);

  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 90_000 });
  await editor.screenshot({ path: join(workDir, "masks-after-edits.png") });
  console.log(`[masks] screenshots in ${workDir}`);

  // Export mixdown: the chirp and the 1 kHz tone are gone, 440 Hz untouched.
  const after = await renderMix(page, 3.9);
  const afterAmps = { a440: toneAmp(after, 440, 1, 3), a1k: toneAmp(after, 1000, 1, 3), chirp: chirpAmp(after, 1.2, 2.8) };
  console.log("[masks] mix after", JSON.stringify(afterAmps), "chirp", db(beforeAmps.chirp, Math.abs(afterAmps.chirp)).toFixed(1), "dB down; 1 kHz", db(beforeAmps.a1k, afterAmps.a1k).toFixed(1), "dB down");
  expect(db(beforeAmps.chirp, Math.abs(afterAmps.chirp)), "chirp removed by >= 20 dB").toBeGreaterThan(20);
  expect(db(beforeAmps.a1k, afterAmps.a1k), "1 kHz removed by >= 20 dB").toBeGreaterThan(20);
  expect(Math.abs(db(afterAmps.a440, beforeAmps.a440)), "440 Hz untouched (< 0.3 dB)").toBeLessThan(0.3);
  expect(Math.abs(db(toneAmp(after, 1000, 0.05, 0.3), toneAmp(before, 1000, 0.05, 0.3))), "1 kHz before the lasso is still there").toBeLessThan(0.5);

  // The live-preview path plays the SAME samples as the export.
  const parity = await page.evaluate(
    async ({ id, exported }) => {
      const { RealtimeAudioGraph } = E().audio;
      const st = E().project.getState();
      const clip = st.project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      const media = st.project.mediaLibrary.items.find((m: any) => m.id === clip.mediaId);
      const decodeCtx = new OfflineAudioContext(2, 1, 48000);
      const source: AudioBuffer = await decodeCtx.decodeAudioData(await media.blob.arrayBuffer());
      const ctx = new OfflineAudioContext(2, Math.floor(48000 * 3.9), 48000);
      const clock = { getAudioContext: () => ctx, currentTime: 0, isPlaying: true };
      const graph = new RealtimeAudioGraph(clock as any);
      const prepared = await graph.prepareSpectralRepair(source, clip.audioEffects);
      graph.scheduleClip({ clipId: id, trackId: "t", audioBuffer: prepared.buffer, startTime: 0, endTime: 3.9, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects: prepared.effects, speed: 1 });
      const played = (await ctx.startRendering()).getChannelData(0) as Float32Array;
      const reference = exported as number[];
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
      return { gain, residualDb: 10 * Math.log10(residual / (gain * gain * bb)), appliedKey: prepared.key.length > 0 };
    },
    { id: clipId, exported: after },
  );
  console.log("[masks] preview vs export", JSON.stringify(parity));
  expect(parity.appliedKey).toBe(true);
  // The two paths decode the file separately (the page's decodeAudioData here, the export engine's loader there), and a heal
  // iterates on the decoded samples, so an LSB-level decoder difference is amplified inside the healed cells: -60 dB, not the -90 dB
  // of a linear rectangle edit. Bit-identity for the SAME decoded buffer is asserted in the core unit tests.
  expect(parity.residualDb, "preview and export samples agree (residual below -60 dB)").toBeLessThan(-60);

  // Real playback: the master bus carries the healed audio (the repair is computed on the first play; the original plays until it is ready).
  const tap = () =>
    page.evaluate(async () => {
      const analyser = (window as unknown as { __tap: AnalyserNode }).__tap;
      await new Promise((r) => setTimeout(r, 1200));
      const d = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(d);
      const rate = analyser.context.sampleRate;
      const amp = (freq: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < d.length; i++) {
          re += d[i] * Math.cos((2 * Math.PI * freq * i) / rate);
          im -= d[i] * Math.sin((2 * Math.PI * freq * i) / rate);
        }
        return (2 * Math.hypot(re, im)) / d.length;
      };
      return { a440: amp(440), a1k: amp(1000) };
    });
  await page.evaluate(() => {
    const graph = E().audio.getRealtimeAudioGraph();
    const analyser = (graph.getAudioContext() as AudioContext).createAnalyser();
    analyser.fftSize = 16384;
    graph.getMasterGain().connect(analyser);
    (window as unknown as { __tap: AnalyserNode }).__tap = analyser;
  });
  const playFrom = async (t: number) => {
    await page.evaluate((at) => {
      const tl = (window as any).__openreelE2E.timeline.getState();
      tl.pause();
      tl.seekTo(at);
    }, t);
    await settle(page, 300);
    await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().play());
  };
  // The source is 3.9 s long, so playback must be sampled inside it: a first play warms the repair job (the original plays until it is
  // ready), then a second play from 1.0 s is sampled ~1.5 s in, well inside the 1 to 3 s window the tones occupy.
  await playFrom(0.2);
  await page.waitForTimeout(2500);
  await playFrom(1.0);
  await page.waitForTimeout(300);
  // Control first: the untouched 440 Hz tone must be audible on the master bus. Without this a silent bus (suspended context, no
  // playback) reads 0 for 1 kHz and "down >= 15 dB" would pass vacuously.
  const live = await tap();
  const liveControl = live.a440;
  const healedLive = live.a1k;
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pause());
  expect(liveControl, "live playback is audible: the untouched 440 Hz tone reaches the master bus").toBeGreaterThan(0.5 * beforeAmps.a440);
  expect(Number.isFinite(db(beforeAmps.a1k, healedLive)), "live 1 kHz level is a real measurement, not zero").toBe(true);
  console.log(`[masks] live playback 1 kHz amplitude with the heal: ${healedLive.toFixed(5)} (source ${beforeAmps.a1k.toFixed(4)})`);
  expect(db(beforeAmps.a1k, healedLive), "live playback: 1 kHz down >= 15 dB").toBeGreaterThan(15);

  // Save / reload: the project serialises with the regions intact.
  const reloaded = await page.evaluate((id) => {
    const project = JSON.parse(JSON.stringify(E().project.getState().getFullProject()));
    const clip = project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    return clip.audioEffects.find((e: any) => e.type === "spectralRepair").params;
  }, clipId);
  stored = await storedRegions(page, clipId);
  expect(reloaded.regions).toEqual(stored.regions);
  expect(reloaded.version).toBe(2);

  // Undo every edit: the original mixdown is back exactly.
  await page.evaluate(async (target) => {
    const st = E().project.getState();
    while (st.actionExecutor.getHistory().getDisplayHistory().length > target) await E().project.getState().undo();
  }, start);
  await settle(page, 500);
  expect(await history(page)).toBe(start);
  const undone = await renderMix(page, 3.9);
  expect(toneAmp(undone, 1000, 1, 3)).toBeCloseTo(beforeAmps.a1k, 6);
  expect(chirpAmp(undone, 1.2, 2.8)).toBeCloseTo(beforeAmps.chirp, 6);
  await page.evaluate(async (target) => {
    for (let i = 0; i < target; i++) await E().project.getState().redo();
  }, 2);
  await settle(page, 600);
  expect(db(beforeAmps.a1k, toneAmp(await renderMix(page, 3.9), 1000, 1, 3))).toBeGreaterThan(15);

  await editor.getByTestId("spectral-expand").click();
  await expect(editor).toHaveAttribute("data-expanded", "false");

  // Real export through the queue, decoded with ffmpeg: the heals are in the delivered file.
  const job = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "spectral masks", outputName: "spectral-masks" }).id as string,
    { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 },
  );
  await page.evaluate(() => E().exportQueue.getState().start());
  await expect
    .poll(() => page.evaluate((id) => E().exportQueue.getState().queue.jobs.find((j: any) => j.id === id)?.status as string, job), { timeout: 240_000, intervals: [500] })
    .toMatch(/completed|failed/);
  const status = await page.evaluate((id) => E().exportQueue.getState().queue.jobs.find((j: any) => j.id === id), job);
  expect(status.status, status.error).toBe("completed");
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  await panel.waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download spectral-masks.mp4" }).click()]);
  const file = join(workDir, "spectral-masks.mp4");
  await download.saveAs(file);
  const exported = decodeAudio(file);
  const e440 = toneAmp(exported, 440, 1, 3);
  const e1k = toneAmp(exported, 1000, 1, 3);
  const eChirp = Math.abs(chirpAmp(exported, 1.2, 2.8));
  console.log("[masks] exported file", JSON.stringify({ e440, e1k, eChirp }));
  expect(db(e440, e1k), "exported file: 1 kHz at least 15 dB under 440 Hz").toBeGreaterThan(15);
  expect(db(e440, eChirp), "exported file: the chirp at least 15 dB under 440 Hz").toBeGreaterThan(15);
});
