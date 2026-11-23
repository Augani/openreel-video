import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickClip, importInput, openEditor, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Enhance Speech, checked in real Chrome with real audio (10 s of public-domain read speech mixed with pink noise at 5 dB SNR):
 *  - Clip menu > Enhance Speech is ONE undo step and adds the "enhanceSpeech" effect at Mix 100;
 *  - the export mixdown's noise floor in a pause drops by at least 15 dB and the speech level stays put;
 *  - the live preview path (RealtimeAudioGraph on the same cached enhancement) renders the same samples as the export;
 *  - Mix 50 blends from the cached result (the model files are fetched once in the whole test);
 *  - "Hear Original" is preview-only: the preview plays the unprocessed audio, the export still has the enhancement;
 *  - undo restores the original mixdown exactly;
 *  - a real export from the export queue, decoded with ffmpeg, carries the enhancement;
 *  - Cancel stops a running job, removes the effect and leaves nothing half-applied.
 */

const FFMPEG = E2E_FFMPEG;
const here = dirname(fileURLToPath(import.meta.url));
const SPEECH = join(here, "../../../packages/core/src/audio/enhance/fixtures/speech-16k.wav");
const workDir = mkdtempSync(join(tmpdir(), "openreel-enhance-"));
const SR = 48000;
const SNR_DB = 5;

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

function readWavF32(path: string): { samples: Float32Array; rate: number } {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let rate = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") rate = view.getUint32(offset + 12, true);
    if (id === "data") {
      const count = size / 2;
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
      return { samples, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

function writePcm16(path: string, samples: Float32Array, rate: number): void {
  const pcm = Buffer.alloc(44 + samples.length * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + samples.length * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  writeFileSync(path, pcm);
}

/** Pink noise (Paul Kellet) from a fixed seed, so every run sees the same fixture. */
function pinkNoise(length: number): Float32Array {
  let s = 2;
  const uniform = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = gauss();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

const rms = (x: ArrayLike<number>, from = 0, to = x.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
const dbOf = (v: number) => 20 * Math.log10(v + 1e-12);
const peakOf = (x: Float32Array): number => {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  return peak;
};

/** The noisy fixture (48 kHz mono WAV) and the quietest and loudest 250 ms windows of the clean speech, in seconds. */
function makeFixture(name: string, repeat = 1): { path: string; seconds: number; pause: [number, number]; speech: [number, number] } {
  const clean = readWavF32(SPEECH);
  const noise = pinkNoise(clean.samples.length);
  const gain = rms(clean.samples) / rms(noise) / 10 ** (SNR_DB / 20);
  const noisy = Float32Array.from(clean.samples, (v, i) => v + gain * noise[i]);
  const win = Math.round(clean.rate * 0.25);
  let quiet = { at: 0, level: Infinity };
  let loud = { at: 0, level: -Infinity };
  for (let at = Math.round(clean.rate * 0.3); at + win <= clean.samples.length - win; at += win) {
    const level = rms(clean.samples, at, at + win);
    if (level < quiet.level) quiet = { at, level };
    if (level > loud.level) loud = { at, level };
  }
  const narrow = join(workDir, `${name}-16k.wav`);
  writePcm16(narrow, noisy, clean.rate);
  const path = join(workDir, `${name}.wav`);
  execFileSync(FFMPEG, ["-v", "error", "-y", ...(repeat > 1 ? ["-stream_loop", String(repeat - 1)] : []), "-i", narrow, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", path]);
  const toSec = (n: number) => n / clean.rate;
  return {
    path,
    seconds: (clean.samples.length / clean.rate) * repeat,
    pause: [toSec(quiet.at), toSec(quiet.at + win)],
    speech: [toSec(loud.at), toSec(loud.at + win)],
  };
}

function decodeAudio(file: string): Float32Array {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

/** The export mixdown of [0, seconds], mono, as the export engine renders it. */
async function renderMix(page: Page, seconds: number): Promise<Float32Array> {
  const data = await page.evaluate(async (len) => {
    const engine = E().audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(E().project.getState().getFullProject(), 0, len);
    return Array.from(out.buffer.getChannelData(0) as Float32Array);
  }, seconds);
  return Float32Array.from(data);
}

async function addToDialogue(page: Page, file: string, name: string): Promise<string> {
  await importInput(page).setInputFiles(file);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
  const added = await page.evaluate(async (mediaName) => {
    const st = E().project.getState();
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === mediaName);
    const target = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue");
    const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    return st.addClip(target.id, item.id, 0);
  }, name);
  expect(added.success, JSON.stringify(added)).toBe(true);
  await settle(page, 400);
  return page.evaluate(() => E().project.getState().project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0].id as string);
}

const effectOf = (page: Page, clipId: string) =>
  page.evaluate(
    (id) => {
      const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      return (clip.audioEffects ?? []).find((e: any) => e.type === "enhanceSpeech") ?? null;
    },
    clipId,
  );

test("Enhance Speech on a noisy clip: preview and export match, the noise floor drops, undo restores", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  const fixture = makeFixture("noisy-speech");
  const modelRequests: string[] = [];
  const workers: string[] = [];
  const t0 = Date.now();
  page.on("request", (request) => {
    if (request.url().includes("/models/deepfilternet3/")) modelRequests.push(`${request.url().split("/").pop()}@${Date.now() - t0}ms`);
  });
  page.on("worker", (worker) => workers.push(`${worker.url().split("/").pop()}@${Date.now() - t0}ms`));
  await openEditor(page);
  const clipId = await addToDialogue(page, fixture.path, "noisy-speech.wav");
  const length = Math.min(fixture.seconds - 0.1, 9.9);

  const before = await renderMix(page, length);
  const at = (t: number) => Math.round(t * SR);
  const floorBefore = dbOf(rms(before, at(fixture.pause[0]), at(fixture.pause[1])));
  const speechBefore = dbOf(rms(before, at(fixture.speech[0]), at(fixture.speech[1])));
  console.log(`[enhance] before: pause ${floorBefore.toFixed(1)} dBFS, speech ${speechBefore.toFixed(1)} dBFS (window ${fixture.pause.map((v) => v.toFixed(2))} / ${fixture.speech.map((v) => v.toFixed(2))} s)`);
  expect(floorBefore, "fixture noise is audible in the pause").toBeGreaterThan(-60);

  // One click: Clip menu > Enhance Speech (right-click context menu on the clip).
  const start = await history(page);
  await clickClip(page, clipId);
  await page.locator(`[data-timeline-item-id="${clipId}"]`).first().click({ button: "right" });
  const clicked = Date.now();
  await page.getByTestId("clip-enhance-speech").click();
  await expect.poll(() => effectOf(page, clipId), { timeout: 15_000 }).not.toBeNull();
  expect((await effectOf(page, clipId)).params.mix).toBe(100);
  expect(await history(page), "Enhance Speech is one undo step").toBe(start + 1);

  // The inspector shows the job: progress while it runs, then it is gone and nothing failed.
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const section = page.getByTestId("enhance-speech-section");
  await section.waitFor({ timeout: 15_000 });
  await expect(section.getByTestId("enhance-speech-progress")).toBeHidden({ timeout: 240_000 });
  await expect(section.getByTestId("enhance-speech-failed")).toHaveCount(0);
  await expect(section.getByTestId("enhance-speech-hear-original")).toBeVisible();
  console.log(`[enhance] click to ready (model download, wasm start, ${fixture.seconds.toFixed(0)} s of audio in a worker): ${Date.now() - clicked} ms`);

  // Export mixdown: the noise floor in the pause drops by >= 15 dB, the speech level stays.
  const timer = Date.now();
  const after = await renderMix(page, length);
  const floorAfter = dbOf(rms(after, at(fixture.pause[0]), at(fixture.pause[1])));
  const speechAfter = dbOf(rms(after, at(fixture.speech[0]), at(fixture.speech[1])));
  console.log(`[enhance] after: pause ${floorAfter.toFixed(1)} dBFS (-${(floorBefore - floorAfter).toFixed(1)} dB), speech ${speechAfter.toFixed(1)} dBFS, cached render ${Date.now() - timer} ms`);
  expect(floorBefore - floorAfter, "noise floor in the pause drops by >= 15 dB").toBeGreaterThanOrEqual(15);
  expect(Math.abs(speechAfter - speechBefore), "speech level is kept").toBeLessThan(3);
  expect(peakOf(after), "no clipping").toBeLessThan(1);

  // The live-preview path plays the SAME samples: a RealtimeAudioGraph on an OfflineAudioContext fed the cached enhancement.
  const parity = await page.evaluate(
    async ({ id, exported, seconds }) => {
      const { RealtimeAudioGraph } = E().audio;
      const st = E().project.getState();
      const clip = st.project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      const media = st.project.mediaLibrary.items.find((m: any) => m.id === clip.mediaId);
      const source: AudioBuffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await media.blob.arrayBuffer());
      const render = async (apply: (graph: any) => Promise<void> | void) => {
        const ctx = new OfflineAudioContext(2, Math.floor(48000 * seconds), 48000);
        const graph = new RealtimeAudioGraph({ getAudioContext: () => ctx, currentTime: 0, isPlaying: true } as any);
        await apply(graph);
        return (await ctx.startRendering()).getChannelData(0) as Float32Array;
      };
      const schedule = (graph: any, buffer: AudioBuffer, effects: any[]) =>
        graph.scheduleClip({ clipId: id, trackId: "t", audioBuffer: buffer, startTime: 0, endTime: seconds, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects, speed: 1 });
      let prepared: any;
      const viaPrepare = await render(async (graph) => {
        prepared = await graph.prepareEnhanceSpeech(source, clip.audioEffects);
        schedule(graph, prepared.buffer, prepared.effects);
      });
      // The scheduler's own path (effect left in the chain): the cache is warm, so the first source is already the enhanced one.
      const viaSchedule = await render(async (graph) => {
        graph.getEnhanceSpeechCache().peek({ buffer: source, mix: 100 }) ?? (await graph.prepareEnhanceSpeech(source, clip.audioEffects));
        schedule(graph, source, clip.audioEffects);
      });
      const compare = (played: Float32Array) => {
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
        return { gain, residualDb: 10 * Math.log10(residual / (gain * gain * bb)) };
      };
      return {
        prepare: compare(viaPrepare),
        schedule: compare(viaSchedule),
        key: prepared.key as string,
        stripped: !prepared.effects.some((e: any) => e.type === "enhanceSpeech"),
      };
    },
    { id: clipId, exported: Array.from(after), seconds: length },
  );
  console.log("[enhance] preview vs export", JSON.stringify(parity));
  expect(parity.key).toBe("enhance:100");
  expect(parity.stripped).toBe(true);
  expect(parity.prepare.residualDb, "preview (prepared) and export samples agree (residual below -80 dB)").toBeLessThan(-80);
  expect(parity.schedule.residualDb, "preview (scheduler path) and export samples agree (residual below -80 dB)").toBeLessThan(-80);

  // Mix 50 blends the cached enhancement with the original: the floor lands between the two, without another model run.
  const effectId = (await effectOf(page, clipId)).id as string;
  await page.evaluate(([id, fx]) => E().project.getState().updateAudioEffect(id, fx, { mix: 50 }), [clipId, effectId]);
  await settle(page, 300);
  const half = await renderMix(page, length);
  const floorHalf = dbOf(rms(half, at(fixture.pause[0]), at(fixture.pause[1])));
  console.log(`[enhance] mix 50: pause ${floorHalf.toFixed(1)} dBFS`);
  expect(floorBefore - floorHalf, "Mix 50 cuts about half-way in amplitude").toBeGreaterThan(3);
  expect(floorBefore - floorHalf).toBeLessThan(floorBefore - floorAfter - 3);
  await page.evaluate(([id, fx]) => E().project.getState().updateAudioEffect(id, fx, { mix: 100 }), [clipId, effectId]);

  // Before / after: Hear Original is preview-only.
  await section.getByTestId("enhance-speech-hear-original").click();
  await expect.poll(async () => (await effectOf(page, clipId)).metadata?.previewBypass === true, { timeout: 10_000 }).toBe(true);
  const bypassed = await page.evaluate(() => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips)[0];
    return (clip.audioEffects as any[]).filter((e) => e.enabled && e.metadata?.previewBypass !== true).some((e) => e.type === "enhanceSpeech");
  });
  expect(bypassed, "the preview chain no longer contains Enhance Speech").toBe(false);
  const stillEnhanced = await renderMix(page, length);
  expect(floorBefore - dbOf(rms(stillEnhanced, at(fixture.pause[0]), at(fixture.pause[1]))), "export ignores the preview switch").toBeGreaterThanOrEqual(15);
  await section.getByTestId("enhance-speech-hear-enhanced").click();
  await expect.poll(async () => (await effectOf(page, clipId)).metadata?.previewBypass === true, { timeout: 10_000 }).toBe(false);

  // Real export through the queue, decoded with ffmpeg: the enhancement is in the delivered file.
  const job = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "enhance", outputName: "enhance-speech" }).id as string,
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
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download enhance-speech.mp4" }).click()]);
  const file = join(workDir, "enhance-speech.mp4");
  await download.saveAs(file);
  const exported = decodeAudio(file);
  const fileFloor = dbOf(rms(exported, at(fixture.pause[0]), at(fixture.pause[1])));
  const fileSpeech = dbOf(rms(exported, at(fixture.speech[0]), at(fixture.speech[1])));
  console.log(`[enhance] exported file: pause ${fileFloor.toFixed(1)} dBFS, speech ${fileSpeech.toFixed(1)} dBFS`);
  expect(floorBefore - fileFloor, "exported file: noise floor in the pause drops by >= 15 dB").toBeGreaterThanOrEqual(15);
  expect(Math.abs(fileSpeech - speechBefore)).toBeLessThan(3);

  // Undoing every step since the click (the Mix edits are undoable too) takes the effect off and the mixdown is the original again.
  await page.evaluate(async (steps) => {
    const st = E().project.getState();
    while (st.actionExecutor.getHistory().getDisplayHistory().length > steps) await E().project.getState().undo();
  }, start);
  await settle(page, 500);
  const undone = await renderMix(page, length);
  expect(rms(undone, at(fixture.pause[0]), at(fixture.pause[1]))).toBeCloseTo(rms(before, at(fixture.pause[0]), at(fixture.pause[1])), 6);
  console.log(`[enhance] model files fetched: ${JSON.stringify(modelRequests)}; workers: ${JSON.stringify(workers)}`);
  expect(modelRequests.filter((name) => name.startsWith("enc.onnx")), "the model is fetched once for preview, export and mix changes").toHaveLength(1);
});

test("Cancel stops a running enhancement and removes the effect", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  const fixture = makeFixture("noisy-speech-long", 8);
  await openEditor(page);
  const clipId = await addToDialogue(page, fixture.path, "noisy-speech-long.wav");
  const start = await history(page);
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const section = page.getByTestId("enhance-speech-section");
  await section.getByTestId("enhance-speech-apply").click();
  await expect(section.getByTestId("enhance-speech-progress")).toBeVisible({ timeout: 60_000 });
  expect((await effectOf(page, clipId))?.params.mix).toBe(100);
  await section.getByTestId("enhance-speech-cancel").click();
  await expect(section.getByTestId("enhance-speech-progress")).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => effectOf(page, clipId), { timeout: 10_000 }).toBeNull();
  await expect(section.getByTestId("enhance-speech-failed")).toHaveCount(0);
  await expect(section.getByTestId("enhance-speech-apply")).toBeVisible();
  // Apply + Remove are two undo steps; undoing both leaves the history where it started.
  await page.evaluate(async () => {
    await E().project.getState().undo();
    await E().project.getState().undo();
  });
  expect(await history(page)).toBe(start);
});
