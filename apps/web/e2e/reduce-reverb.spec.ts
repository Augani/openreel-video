import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clickClip, importInput, openEditor, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";
import { resample } from "../../../packages/core/src/audio/enhance/resample";
import { readPcm16Wav, roomImpulseResponse, siSdr } from "../../../packages/core/src/audio/enhance/enhance-test-signals";
import { fftConvolve, tailLevelChangeDb } from "../../../packages/core/src/audio/reverb/reverb-metrics";

/**
 * Reduce Reverb and the Speech / Background balance, checked in real Chrome with real audio (10 s of public-domain read speech
 * convolved with a synthetic room, RT60 0.8 s, direct-to-reverberant ratio 0 dB):
 *  - the audio-tab section adds the "reduceReverb" effect as ONE undo step, shows progress and the blind room estimate;
 *  - the export mixdown is closer to the dry voice (SI-SDR) and its pauses are quieter;
 *  - the live preview path (RealtimeAudioGraph on the same cached job) renders the same samples as the export;
 *  - a real export from the export queue, decoded with ffmpeg, carries the dereverberation;
 *  - Speech / Background balance remixes the cached enhancement without another model run (speech + background = original);
 *  - the effect is in the saved project; undo restores the original mixdown exactly;
 *  - Cancel stops a running job on a long clip and removes the effect.
 */

const FFMPEG = E2E_FFMPEG;
const here = dirname(fileURLToPath(import.meta.url));
const SPEECH = join(here, "../../../packages/core/src/audio/enhance/fixtures/speech-16k.wav");
const workDir = mkdtempSync(join(tmpdir(), "openreel-reverb-"));
const SR = 48000;

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

const rms = (x: ArrayLike<number>, from = 0, to = x.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
const dbOf = (v: number) => 20 * Math.log10(v + 1e-12);

/** The dry speech (48 kHz) and the roomy fixture file made from it; `repeat` loops the file for the long-clip test. */
function makeFixture(name: string, repeat = 1, withNoise = false): { path: string; dry: Float32Array; seconds: number } {
  const wav = readPcm16Wav(readFileSync(SPEECH));
  const dry = resample(wav.samples, wav.sampleRate, SR);
  let roomy = fftConvolve(dry, roomImpulseResponse(SR, 0.8, 0));
  if (withNoise) {
    // Steady low-level hiss at about 20 dB SNR so the enhancement has something to take out (background != 0).
    let s = 7;
    const noise = Float32Array.from(roomy, () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5) * 2);
    const gain = rms(roomy) / rms(noise) / 10 ** (20 / 20);
    roomy = Float32Array.from(roomy, (v, i) => v + gain * noise[i]);
  }
  const narrow = join(workDir, `${name}-once.wav`);
  writePcm16(narrow, roomy, SR);
  const path = join(workDir, `${name}.wav`);
  execFileSync(FFMPEG, ["-v", "error", "-y", ...(repeat > 1 ? ["-stream_loop", String(repeat - 1)] : []), "-i", narrow, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", path]);
  return { path, dry, seconds: (dry.length / SR) * repeat };
}

function decodeAudio(file: string): Float32Array {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

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

const effectOf = (page: Page, clipId: string, type: string) =>
  page.evaluate(
    ([id, wanted]) => {
      const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      return (clip.audioEffects ?? []).find((e: any) => e.type === wanted) ?? null;
    },
    [clipId, type],
  );

test("Reduce Reverb on a roomy clip: one undo step, preview and export match, the export file carries it, undo restores", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  const fixture = makeFixture("roomy-speech");
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url().split("/").pop() ?? ""));
  await openEditor(page);
  const clipId = await addToDialogue(page, fixture.path, "roomy-speech.wav");
  const length = Math.min(fixture.seconds - 0.1, 9.9);
  const dry = fixture.dry.subarray(0, Math.round(length * SR));

  const before = (await renderMix(page, length)).subarray(0, dry.length);
  const sdrBefore = siSdr(before, dry);
  console.log(`[reverb] before: SI-SDR vs dry ${sdrBefore.toFixed(1)} dB`);

  // Clip menu > Reduce Reverb (right-click context menu on the clip): ONE undo step.
  const start = await history(page);
  await clickClip(page, clipId);
  await page.locator(`[data-timeline-item-id="${clipId}"]`).first().click({ button: "right" });
  await page.getByTestId("clip-reduce-reverb").click();
  await expect.poll(() => effectOf(page, clipId, "reduceReverb"), { timeout: 15_000 }).not.toBeNull();
  expect((await effectOf(page, clipId, "reduceReverb")).params).toEqual({ amount: 60, sensitivity: 50 });
  expect(await history(page), "Reduce Reverb is one undo step").toBe(start + 1);

  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const section = page.getByTestId("reduce-reverb-section");
  await section.waitFor({ timeout: 15_000 });
  await expect(section.getByTestId("reduce-reverb-estimate")).toBeVisible({ timeout: 120_000 });
  await expect(section.getByTestId("reduce-reverb-failed")).toHaveCount(0);
  await expect(section.getByTestId("reduce-reverb-progress")).toBeHidden();
  const estimate = await section.getByTestId("reduce-reverb-estimate").innerText();
  console.log(`[reverb] inspector: ${estimate}`);
  expect(estimate).toMatch(/RT60|typical room/);
  expect(workers.some((w) => w.includes("reverb")), "the job ran in a worker").toBe(true);

  // Export mixdown: closer to the dry voice, quieter pauses, no clipping.
  const timer = Date.now();
  const after = (await renderMix(page, length)).subarray(0, dry.length);
  const sdrAfter = siSdr(after, dry);
  const tail = tailLevelChangeDb(dry, before, after, SR);
  console.log(`[reverb] after: SI-SDR ${sdrAfter.toFixed(1)} dB (+${(sdrAfter - sdrBefore).toFixed(1)}), pause tail ${tail.toFixed(1)} dB, cached render ${Date.now() - timer} ms`);
  expect(sdrAfter - sdrBefore, "closer to the dry voice").toBeGreaterThan(0.8);
  expect(tail, "the smeared tail in the pauses is quieter").toBeLessThan(-2);
  let peak = 0;
  for (let i = 0; i < after.length; i++) peak = Math.max(peak, Math.abs(after[i]));
  expect(peak).toBeLessThan(1);

  // The live-preview path plays the SAME samples: a RealtimeAudioGraph on an OfflineAudioContext fed the cached result.
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
        prepared = await graph.prepareReduceReverb(source, clip.audioEffects);
        schedule(graph, prepared.buffer, prepared.effects);
      });
      const viaSchedule = await render(async (graph) => {
        await graph.prepareReduceReverb(source, clip.audioEffects);
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
        stripped: !prepared.effects.some((e: any) => e.type === "reduceReverb"),
      };
    },
    { id: clipId, exported: Array.from(after), seconds: length },
  );
  console.log("[reverb] preview vs export", JSON.stringify(parity));
  expect(parity.key).toBe("reverb:60:50");
  expect(parity.stripped).toBe(true);
  expect(parity.prepare.residualDb, "preview (prepared) and export samples agree (residual below -80 dB)").toBeLessThan(-80);
  expect(parity.schedule.residualDb, "preview (scheduler path) and export samples agree (residual below -80 dB)").toBeLessThan(-80);

  // Amount 100 takes more of the tail than 60 (one more cached job for the new setting).
  const effectId = (await effectOf(page, clipId, "reduceReverb")).id as string;
  await page.evaluate(([id, fx]) => E().project.getState().updateAudioEffect(id, fx, { amount: 100 }), [clipId, effectId]);
  await settle(page, 300);
  const strong = (await renderMix(page, length)).subarray(0, dry.length);
  const strongTail = tailLevelChangeDb(dry, before, strong, SR);
  console.log(`[reverb] amount 100: pause tail ${strongTail.toFixed(1)} dB`);
  expect(strongTail).toBeLessThan(tail);
  await page.evaluate(([id, fx]) => E().project.getState().updateAudioEffect(id, fx, { amount: 60 }), [clipId, effectId]);

  // The effect is part of the saved project.
  const saved = await page.evaluate((id) => {
    const project = JSON.parse(JSON.stringify(E().project.getState().getFullProject()));
    const clip = project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    return (clip.audioEffects as any[]).find((e) => e.type === "reduceReverb") ?? null;
  }, clipId);
  expect(saved?.params).toEqual({ amount: 60, sensitivity: 50 });

  // Real export through the queue, decoded with ffmpeg: the dereverberation is in the delivered file.
  const job = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "reverb", outputName: "reduce-reverb" }).id as string,
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
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download reduce-reverb.mp4" }).click()]);
  const file = join(workDir, "reduce-reverb.mp4");
  await download.saveAs(file);
  const exported = decodeAudio(file).subarray(0, dry.length);
  const fileTail = tailLevelChangeDb(dry, before, exported, SR);
  console.log(`[reverb] exported file: pause tail ${fileTail.toFixed(1)} dB, level ${dbOf(rms(exported)).toFixed(1)} dBFS vs ${dbOf(rms(before)).toFixed(1)} before`);
  expect(fileTail, "exported file: the tail in the pauses is quieter").toBeLessThan(-2);
  expect(Math.abs(dbOf(rms(exported)) - dbOf(rms(before)))).toBeLessThan(4);

  // Undoing every step since the click takes the effect off and the mixdown is the original again.
  await page.evaluate(async (steps) => {
    const st = E().project.getState();
    while (st.actionExecutor.getHistory().getDisplayHistory().length > steps) await E().project.getState().undo();
  }, start);
  await settle(page, 500);
  const undone = (await renderMix(page, length)).subarray(0, dry.length);
  expect(rms(undone)).toBeCloseTo(rms(before), 6);
});

test("Speech / Background balance remixes the cached enhancement: speech + background = original, no second model run", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  const fixture = makeFixture("hissy-speech", 1, true);
  const modelRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/models/deepfilternet3/")) modelRequests.push(request.url().split("/").pop() ?? "");
  });
  await openEditor(page);
  const clipId = await addToDialogue(page, fixture.path, "hissy-speech.wav");
  const length = Math.min(fixture.seconds - 0.1, 9.9);
  const original = await renderMix(page, length);

  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const section = page.getByTestId("enhance-speech-section");
  await section.getByTestId("enhance-speech-apply").click();
  await expect.poll(() => effectOf(page, clipId, "enhanceSpeech"), { timeout: 15_000 }).not.toBeNull();
  expect((await effectOf(page, clipId, "enhanceSpeech")).params, "a new effect keeps exactly the params it always had").toEqual({ mix: 100 });
  await expect(section.getByTestId("enhance-speech-progress")).toBeHidden({ timeout: 240_000 });
  await expect(section.getByLabel("Speech and background balance").first()).toBeVisible();
  const speech = await renderMix(page, length);
  const fetched = modelRequests.filter((name) => name.startsWith("enc.onnx")).length;
  expect(fetched).toBe(1);

  const effectId = (await effectOf(page, clipId, "enhanceSpeech")).id as string;
  const setBalance = async (balance: number) => {
    await page.evaluate(([id, fx, value]) => E().project.getState().updateAudioEffect(id, fx, { balance: value }), [clipId, effectId, balance] as const);
    await settle(page, 200);
    return renderMix(page, length);
  };
  const background = await setBalance(0);
  const mixed = await setBalance(50);
  const half = await setBalance(75);
  expect(modelRequests.filter((name) => name.startsWith("enc.onnx")).length, "remixing never runs the model again").toBe(1);
  expect((await effectOf(page, clipId, "enhanceSpeech")).params).toMatchObject({ mix: 100, balance: 75 });

  const residualDb = (a: Float32Array, b: Float32Array) => {
    let num = 0;
    let den = 0;
    for (let i = 4800; i < Math.min(a.length, b.length) - 4800; i++) {
      num += (a[i] - b[i]) ** 2;
      den += b[i] ** 2;
    }
    return 10 * Math.log10(num / den + 1e-30);
  };
  // Balance 50 is the original mix; speech + background (balance 0) is the original.
  const sum = Float32Array.from(speech, (v, i) => v + background[i]);
  console.log(`[balance] speech+background vs original ${residualDb(sum, original).toFixed(1)} dB; balance 50 vs original ${residualDb(mixed, original).toFixed(1)} dB; speech level ${dbOf(rms(speech)).toFixed(1)}, background ${dbOf(rms(background)).toFixed(1)}, original ${dbOf(rms(original)).toFixed(1)} dBFS`);
  expect(residualDb(sum, original), "speech + background reconstruct the original").toBeLessThan(-50);
  expect(residualDb(mixed, original), "balance 50 is the original mix").toBeLessThan(-50);
  expect(dbOf(rms(background)), "the background is quieter than the whole recording").toBeLessThan(dbOf(rms(original)) - 3);
  const quarter = Float32Array.from(speech, (v, i) => v + 0.5 * (original[i] - v));
  expect(residualDb(half, quarter), "balance 75 puts the background back at half gain").toBeLessThan(-50);

  // Back at balance 100 the mixdown is the plain enhancement again.
  await page.evaluate(([id, fx]) => E().project.getState().updateAudioEffect(id, fx, { balance: 100 }), [clipId, effectId]);
  await settle(page, 200);
  const back = await renderMix(page, length);
  expect(residualDb(back, speech), "balance 100 is exactly the enhancement without the control").toBeLessThan(-120);
});

test("Cancel stops a running Reduce Reverb job on a long clip and removes the effect", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  const fixture = makeFixture("roomy-speech-long", 8);
  await openEditor(page);
  const clipId = await addToDialogue(page, fixture.path, "roomy-speech-long.wav");
  const start = await history(page);
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const section = page.getByTestId("reduce-reverb-section");
  await section.getByTestId("reduce-reverb-apply").click();
  await expect(section.getByTestId("reduce-reverb-progress")).toBeVisible({ timeout: 60_000 });
  expect((await effectOf(page, clipId, "reduceReverb"))?.params.amount).toBe(60);
  await section.getByTestId("reduce-reverb-cancel").click();
  await expect(section.getByTestId("reduce-reverb-progress")).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => effectOf(page, clipId, "reduceReverb"), { timeout: 10_000 }).toBeNull();
  await expect(section.getByTestId("reduce-reverb-failed")).toHaveCount(0);
  await expect(section.getByTestId("reduce-reverb-apply")).toBeVisible();
  await page.evaluate(async () => {
    await E().project.getState().undo();
    await E().project.getState().undo();
  });
  expect(await history(page)).toBe(start);
});
