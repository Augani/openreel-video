import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, clipLocator, importInput, openEditor, settle, undo } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Essential Sound panel, checked in real Chrome:
 *  - a quiet and a loud tone, both tagged Dialogue and Auto-Matched, land within 1 LU of -16 LUFS in the
 *    export mixdown (measured by the editor's meter AND by ffmpeg's ebur128);
 *  - a Music clip over Dialogue with Duck on sits at least the chosen number of dB lower while the dialogue
 *    speaks than outside it;
 *  - one undo removes everything the panel added, and the timeline chip + context menu work.
 */

interface Hook {
  project: { getState(): Record<string, any> };
  audio: Record<string, any>;
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const SR = 48000;
const workDir = mkdtempSync(join(tmpdir(), "openreel-essential-"));

/** Mono 16-bit WAV of a steady sine. */
function writeTone(name: string, frequency: number, amplitude: number, seconds: number): string {
  const n = SR * seconds;
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
    pcm.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / SR) * 32767), 44 + i * 2);
  }
  const path = join(workDir, name);
  writeFileSync(path, pcm);
  return path;
}

async function importAudio(page: Page, files: string[]) {
  for (const path of files) {
    const name = path.split("/").pop()!;
    await importInput(page).setInputFiles(path);
    await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
  }
}

async function addToLane(page: Page, mediaName: string, lane: string, start: number): Promise<string> {
  const result = await page.evaluate(
    async ([media, laneName, at]) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === media);
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      const added = await st.addClip(target.id, item.id, at);
      const clips = E().project.getState().project.timeline.tracks.find((t: any) => t.name === laneName).clips;
      return { success: added.success, id: clips.find((c: any) => c.mediaId === item.id && Math.abs(c.startTime - at) < 0.01)?.id as string | undefined };
    },
    [mediaName, lane, start] as const,
  );
  expect(result.success && result.id, JSON.stringify(result)).toBeTruthy();
  await settle(page, 300);
  return result.id!;
}

async function muteMain(page: Page) {
  await page.evaluate(async () => {
    const st = E().project.getState();
    await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
  });
}

const clipState = (page: Page, id: string) =>
  page.evaluate((clipId) => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === clipId);
    return JSON.parse(JSON.stringify(clip));
  }, id);

const historyLength = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

async function openEssential(page: Page, clipId: string) {
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  await page.getByTestId("essential-sound").waitFor({ timeout: 15_000 });
}

/** Mixdown of [from, from+length] exactly as the export engine renders it, measured two ways. */
async function mixdown(page: Page, from: number, length: number) {
  const out = await page.evaluate(
    async ([start, len]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const rendered = await engine.renderAudio(E().project.getState().getFullProject(), start, len);
      const buffer = rendered.buffer as AudioBuffer;
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const snap = E().audio.measureLoudness(channels, buffer.sampleRate);
      const inter = new Float32Array(channels[0].length * 2);
      for (let i = 0; i < channels[0].length; i++) {
        inter[2 * i] = channels[0][i];
        inter[2 * i + 1] = channels[1][i];
      }
      let bin = "";
      const bytes = new Uint8Array(inter.buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { rate: buffer.sampleRate, integrated: snap.integrated as number, left: Array.from(channels[0]) as number[], pcm: btoa(bin) };
    },
    [from, length] as const,
  );
  return out;
}

/** ffmpeg's EBU R128 integrated loudness of raw interleaved f32le stereo. */
function ffmpegLufs(pcmBase64: string, rate: number): number {
  const run = spawnSync(E2E_FFMPEG, ["-nostats", "-f", "f32le", "-ar", String(rate), "-ac", "2", "-i", "pipe:0", "-af", "ebur128", "-f", "null", "-"], {
    input: Buffer.from(pcmBase64, "base64"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
  const match = summary.match(/I:\s+(-?[\d.]+) LUFS/);
  if (!match) throw new Error(`ffmpeg ebur128 summary missing:\n${summary}`);
  return Number(match[1]);
}

/** Amplitude of one frequency (single-bin DFT) over [from, to) seconds of mono samples. */
const toneAmp = (x: number[], rate: number, freq: number, from: number, to: number): number => {
  const a = Math.floor(from * rate);
  const b = Math.floor(to * rate);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = (2 * Math.PI * freq * (i - a)) / rate;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);

test("quiet and loud dialogue clips, tagged and Auto-Matched, both land within 1 LU of -16 LUFS in the mixdown", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeTone("quiet.wav", 440, 0.08, 4), writeTone("loud.wav", 440, 0.6, 4)]);
  const quiet = await addToLane(page, "quiet.wav", "Dialogue", 0);
  const loud = await addToLane(page, "loud.wav", "Dialogue", 5);

  const before = [await mixdown(page, 0, 4), await mixdown(page, 5, 4)].map((m) => m.integrated);
  console.log(`[essential] before: quiet ${before[0].toFixed(1)} LUFS, loud ${before[1].toFixed(1)} LUFS`);
  expect(before[1] - before[0], "the clips really differ in level").toBeGreaterThan(15);

  const readouts: string[] = [];
  for (const id of [quiet, loud]) {
    await openEssential(page, id);
    await page.getByTestId("essential-type-dialogue").click();
    await expect(page.getByTestId("essential-group-loudness")).toBeVisible();
    await expect(page.getByTestId("essential-type-dialogue")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("essential-auto-match").click();
    const readout = page.getByTestId("essential-loudness-readout");
    await expect(readout).toContainText("→", { timeout: 60_000 });
    readouts.push((await readout.textContent()) ?? "");
    expect((await clipState(page, id)).audioType).toBe("dialogue");
  }
  console.log(`[essential] panel readouts: ${readouts.join(" | ")}`);
  await page.screenshot({ path: testInfo.outputPath("essential-sound-panel.png") });

  for (const [index, start] of [0, 5].entries()) {
    const mix = await mixdown(page, start, 4);
    const reference = ffmpegLufs(mix.pcm, mix.rate);
    console.log(`[essential] clip ${index}: editor ${mix.integrated.toFixed(2)} LUFS, ffmpeg ${reference.toFixed(2)} LUFS`);
    testInfo.annotations.push({ type: `clip-${index}`, description: `editor ${mix.integrated.toFixed(2)} / ffmpeg ${reference.toFixed(2)}` });
    expect(Math.abs(mix.integrated - -16), `editor meter, clip ${index}`).toBeLessThanOrEqual(1);
    expect(Math.abs(reference - -16), `ffmpeg ebur128, clip ${index}`).toBeLessThanOrEqual(1);
  }
});

test("Duck against Dialogue: music sits at least the chosen dB below while the dialogue speaks", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeTone("music-bed.wav", 220, 0.3, 8), writeTone("speech.wav", 1000, 0.3, 2)]);
  const music = await addToLane(page, "music-bed.wav", "Music", 0);
  await addToLane(page, "speech.wav", "Dialogue", 3);

  const before = await mixdown(page, 0, 8);
  const level = (m: { left: number[]; rate: number }, from: number, to: number) => toneAmp(m.left, m.rate, 220, from, to);
  const outsideBefore = level(before, 0.5, 2.5);
  const insideBefore = level(before, 3.4, 4.6);
  expect(Math.abs(db(insideBefore, outsideBefore)), "the bed is steady before ducking").toBeLessThan(0.3);

  await openEssential(page, music);
  await page.getByTestId("essential-type-music").click();
  await expect(page.getByTestId("essential-group-ducking")).toBeVisible();

  // Pick the amount with the slider (keyboard), then turn the duck on.
  const slider = page.getByTestId("essential-group-ducking").getByRole("slider").first();
  await slider.focus();
  for (let i = 0; i < 6; i++) await slider.press("ArrowRight"); // 12 dB -> 18 dB
  await expect(page.getByTestId("essential-group-ducking")).toContainText("−18 dB");
  const startHistory = await historyLength(page);
  await page.getByRole("switch", { name: "Duck against Dialogue" }).click();
  await expect
    .poll(async () => (await clipState(page, music)).metadata?.liveDucking ? 1 : 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  expect(await historyLength(page), "turning the duck on is one undo step").toBe(startHistory + 1);
  const chosen = (await clipState(page, music)).metadata.essentialSound.options.duckAmountDb as number;
  expect(chosen).toBe(18);

  const after = await mixdown(page, 0, 8);
  const outside = (level(after, 0.5, 2.5) + level(after, 6, 7.5)) / 2;
  const inside = level(after, 3.4, 4.6);
  const drop = db(outside, inside);
  console.log(`[essential] music outside ${outside.toFixed(4)}, during dialogue ${inside.toFixed(4)}: ${drop.toFixed(2)} dB lower (chosen ${chosen} dB)`);
  testInfo.annotations.push({ type: "duck", description: `${drop.toFixed(2)} dB lower, chosen ${chosen} dB` });
  expect(drop).toBeGreaterThanOrEqual(chosen - 0.25);
  expect(Math.abs(db(outside, outsideBefore)), "the bed outside the dialogue is untouched").toBeLessThan(0.3);
  await page.screenshot({ path: testInfo.outputPath("essential-sound-duck.png") });
});

test("one undo removes everything the panel added; the clip chip and Set Audio Type menu work", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeTone("bed.wav", 220, 0.1, 6), writeTone("talk.wav", 1000, 0.3, 2)]);
  const bed = await addToLane(page, "bed.wav", "Music", 0);
  await addToLane(page, "talk.wav", "Dialogue", 2);

  // Context menu: Set Audio Type > SFX shows the chip; Music is what we want to process.
  await clipLocator(page, bed).click({ button: "right" });
  await page.getByTestId("clip-audio-type-menu").click();
  await page.getByTestId("clip-audio-type-music").click();
  await expect(clipLocator(page, bed).getByTestId("clip-audio-type-chip")).toHaveAttribute("data-audio-type", "music");
  expect((await clipState(page, bed)).audioType).toBe("music");

  const original = await clipState(page, bed);
  const stepsBefore = await historyLength(page);
  await openEssential(page, bed);
  await page.getByTestId("essential-apply-all").click();
  await expect(page.getByTestId("essential-loudness-readout")).toContainText("→", { timeout: 60_000 });
  await expect
    .poll(async () => (await clipState(page, bed)).metadata?.liveDucking ? 1 : 0, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const applied = await clipState(page, bed);
  expect(applied.audioEffects.length, "clarity chain added").toBeGreaterThan(0);
  expect(applied.volume).not.toBe(original.volume);
  expect(applied.metadata.liveDucking, "the duck is live, not baked keyframes").toBeTruthy();
  expect(applied.automation?.volume).toBeUndefined();
  expect(await historyLength(page), "Apply all presets is exactly one undo step").toBe(stepsBefore + 1);

  await undo(page);
  await settle(page, 500);
  expect(await clipState(page, bed)).toEqual(original);

  // Clear Audio Type after a second apply returns the pre-panel chain too.
  await page.getByTestId("essential-apply-all").click();
  await expect(page.getByTestId("essential-loudness-readout")).toContainText("→", { timeout: 60_000 });
  await page.getByTestId("essential-clear").click();
  await expect.poll(async () => (await clipState(page, bed)).audioType, { timeout: 15_000 }).toBeUndefined();
  const cleared = await clipState(page, bed);
  expect(cleared.audioEffects).toEqual([]);
  expect(cleared.volume).toBe(original.volume);
  expect(cleared.automation).toBeUndefined();
  expect(cleared.metadata?.essentialSound).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath("essential-sound-cleared.png") });
});
