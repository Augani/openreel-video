import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importInput, openEditor, settle } from "./helpers";
import { E2E_FFPROBE } from "./env";

/**
 * Pro audio, checked in real Chrome:
 *  - Export dialog > Audio stems: split by Essential Sound type (and by track), queue the job, download the zip;
 *    every WAV is valid (ffprobe) and the same length;
 *  - the Music stem carries the LIVE duck under the Dialogue clip, and the duck follows the dialogue when it is
 *    moved (nothing re-analysed, no keyframes stored); undo removes it;
 *  - the Brickwall Limiter never lets the exported mixdown's true peak past its ceiling, and the Low-Pass Filter
 *    removes what is above its cutoff, both as ordinary clip effects in the export mixdown.
 */

interface Hook {
  project: { getState(): Record<string, any> };
  audio: Record<string, any>;
  stems: Record<string, any>;
  exportQueue: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const SR = 48000;
const workDir = mkdtempSync(join(tmpdir(), "openreel-stems-"));

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

const runAction = (page: Page, type: string, params: Record<string, unknown>) =>
  page.evaluate(
    async ([actionType, actionParams]) => {
      const result = await E().project.getState().executeAction({ id: crypto.randomUUID(), timestamp: Date.now(), type: actionType, params: actionParams });
      return { success: result.success as boolean, error: result.error?.message as string | undefined };
    },
    [type, params] as const,
  );

/** Decoded mono-or-stereo PCM WAV (16 or 24 bit): left channel as floats. */
function readWav(path: string): { rate: number; channels: number; left: Float32Array } {
  const buf = readFileSync(path);
  let pos = 12;
  let fmt = { rate: 0, channels: 0, bits: 0 };
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === "data") {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - pos - 8) / (bytes * fmt.channels));
      const left = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const at = pos + 8 + i * bytes * fmt.channels;
        left[i] = bytes === 3 ? buf.readIntLE(at, 3) / 8388608 : buf.readInt16LE(at) / 32768;
      }
      return { rate: fmt.rate, channels: fmt.channels, left };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

/** Amplitude of one frequency over [from, to) seconds (single-bin DFT). */
function toneAmp(x: Float32Array, rate: number, freq: number, from: number, to: number): number {
  let re = 0;
  let im = 0;
  const a = Math.floor(from * rate);
  const b = Math.floor(to * rate);
  for (let i = a; i < b; i++) {
    const w = (2 * Math.PI * freq * i) / rate;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
}
const db = (a: number, b: number) => 20 * Math.log10(a / b);

interface StemFile {
  name: string;
  path: string;
}

/** Render stems through the service (same code path as the queued job) and write the WAVs to disk. */
async function renderStemsToDisk(page: Page, request: Record<string, unknown>, dir: string): Promise<StemFile[]> {
  const rendered = await page.evaluate(async (req) => {
    const stems = await E().stems.renderProjectStems(req);
    return stems.map((s: any) => {
      let text = "";
      for (let i = 0; i < s.wav.length; i += 0x8000) text += String.fromCharCode(...s.wav.subarray(i, i + 0x8000));
      return { name: s.name as string, fileName: s.fileName as string, base64: btoa(text) };
    });
  }, request);
  mkdirSync(dir, { recursive: true });
  return rendered.map((stem: { name: string; fileName: string; base64: string }) => {
    const path = join(dir, stem.fileName);
    writeFileSync(path, Buffer.from(stem.base64, "base64"));
    return { name: stem.name, path };
  });
}

test("Export dialog > Audio stems: a zip of equal-length WAVs per audio type; the Music stem carries the live duck, which follows the dialogue", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeTone("music-bed.wav", 220, 0.3, 8), writeTone("speech.wav", 1000, 0.3, 2)]);
  const music = await addToLane(page, "music-bed.wav", "Music", 0);
  const speech = await addToLane(page, "speech.wav", "Dialogue", 3);

  // Live duck on the music clip (the Essential Sound switch writes exactly this action).
  const duck = await runAction(page, "audio/setLiveDucking", {
    clipId: music,
    config: { enabled: true, amountDb: 12, attackMs: 100, releaseMs: 100, holdMs: 100 },
  });
  expect(duck.success, duck.error).toBe(true);
  const stored = await page.evaluate(
    (id) => JSON.parse(JSON.stringify(E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id))),
    music,
  );
  expect(stored.metadata.liveDucking.amountDb).toBe(12);
  expect(stored.automation?.volume, "no keyframes are baked").toBeUndefined();

  // The real Export dialog: Custom tab > Audio stems > split by audio type.
  await page.evaluate(() => E().ui.getState().openModal("export"));
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Custom Settings" }).click();
  const section = dialog.getByTestId("export-stems");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await expect(section.getByTestId("export-stems-list")).toContainText("Dialogue");
  await section.getByTestId("export-stems-mode-audioType").click();
  const list = section.getByTestId("export-stems-list");
  await expect(list).toContainText("Dialogue");
  await expect(list).toContainText("Music");
  await expect(section.getByTestId("export-stems-add")).toHaveText(/Add 2 stems to queue/);
  await section.screenshot({ path: testInfo.outputPath("export-stems-section.png") });
  await section.getByTestId("export-stems-add").click();
  await expect(dialog).toBeHidden();

  const panel = page.getByTestId("export-queue-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("export-queue-job")).toHaveCount(1);
  await panel.getByRole("button", { name: "Start queue" }).click();
  await expect
    .poll(async () => page.evaluate(() => E().exportQueue.getState().queue.jobs[0]?.status as string), { timeout: 180_000, intervals: [500] })
    .toBe("completed");
  const job = await page.evaluate(() => JSON.parse(JSON.stringify(E().exportQueue.getState().queue.jobs[0])));
  expect(job.kind).toBe("stems");
  expect(job.stems.mode).toBe("audioType");
  expect(job.stemOutputs.map((s: any) => s.name).sort()).toEqual(["Dialogue", "Music"]);

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${job.outputName}` }).click()]);
  const zipPath = join(workDir, download.suggestedFilename());
  await download.saveAs(zipPath);
  const outDir = join(workDir, "unzipped");
  mkdirSync(outDir, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", outDir]);
  const files = readdirSync(outDir).filter((f) => f.endsWith(".wav")).sort();
  expect(files).toHaveLength(2);
  const durations: number[] = [];
  for (const file of files) {
    const probe = JSON.parse(execFileSync(E2E_FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", join(outDir, file)], { encoding: "utf8" }));
    const audio = probe.streams.find((s: any) => s.codec_type === "audio");
    expect(audio.codec_name).toBe("pcm_s24le");
    expect(Number(audio.sample_rate)).toBe(SR);
    durations.push(Number(probe.format.duration));
  }
  expect(Math.abs(durations[0] - durations[1]), "stems are the same length").toBeLessThan(0.01);
  expect(durations[0]).toBeGreaterThan(7.9);

  const musicFile = files.find((f) => /Music/.test(f))!;
  const dialogueFile = files.find((f) => /Dialogue/.test(f))!;
  const musicWav = readWav(join(outDir, musicFile));
  const dialogueWav = readWav(join(outDir, dialogueFile));
  const level = (w: { left: Float32Array; rate: number }, f: number, a: number, b: number) => toneAmp(w.left, w.rate, f, a, b);
  // The dialogue stem has only the speech, and only where it plays.
  expect(level(dialogueWav, 1000, 3.4, 4.6)).toBeGreaterThan(0.2);
  expect(level(dialogueWav, 220, 0.5, 8)).toBeLessThan(0.01);
  expect(level(dialogueWav, 1000, 0.5, 2.5)).toBeLessThan(0.005);
  // The music stem is ducked >= 12 dB under the dialogue and steady elsewhere.
  const outside = (level(musicWav, 220, 0.5, 2.5) + level(musicWav, 220, 6, 7.5)) / 2;
  const inside = level(musicWav, 220, 3.4, 4.6);
  expect(level(musicWav, 1000, 0.5, 8), "no dialogue in the music stem").toBeLessThan(0.005);
  expect(db(outside, inside), "music is ducked 12 dB under the dialogue").toBeGreaterThanOrEqual(11.7);
  expect(db(outside, inside)).toBeLessThan(12.5);

  // Move the dialogue clip: the duck follows it, nothing is re-analysed or stored on the music clip.
  const moved = await runAction(page, "clip/move", { clipId: speech, startTime: 5 });
  expect(moved.success, moved.error).toBe(true);
  const afterMove = await renderStemsToDisk(page, { mode: "audioType", ids: ["music"], bitDepth: 24 }, join(workDir, "moved"));
  const movedWav = readWav(afterMove[0].path);
  const movedOutside = (level(movedWav, 220, 0.5, 2.5) + level(movedWav, 220, 7.7, 8)) / 2;
  expect(Math.abs(db(movedOutside, level(movedWav, 220, 3.4, 4.6))), "the old duck window is back at full level").toBeLessThan(0.3);
  expect(db(movedOutside, level(movedWav, 220, 5.4, 6.6)), "the duck now sits under the moved dialogue").toBeGreaterThanOrEqual(11.7);
  const after = await page.evaluate(
    (id) => JSON.parse(JSON.stringify(E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id))),
    music,
  );
  expect(after).toEqual(stored);

  // Per-track stems come from the same dialog source list.
  const byTrack = await renderStemsToDisk(page, { mode: "track", bitDepth: 16 }, join(workDir, "tracks"));
  expect(byTrack.map((s) => s.name).sort()).toEqual(["Dialogue", "Music"]);
  const trackMusic = readWav(byTrack.find((s) => s.name === "Music")!.path);
  expect(db(movedOutside, level(trackMusic, 220, 5.4, 6.6))).toBeGreaterThanOrEqual(11.7);

  // Undo: moving, then the duck, comes off one step at a time and the music is flat again.
  await page.evaluate(async () => {
    await E().project.getState().undo();
    await E().project.getState().undo();
  });
  const flat = readWav((await renderStemsToDisk(page, { mode: "audioType", ids: ["music"], bitDepth: 24 }, join(workDir, "undone")))[0].path);
  expect(Math.abs(db(level(flat, 220, 0.5, 2.5), level(flat, 220, 3.4, 4.6))), "after undo the music is not ducked").toBeLessThan(0.3);
  expect(await page.evaluate((id) => E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id).metadata?.liveDucking, music)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath("export-stems-done.png") });
});

test("Brickwall Limiter keeps the exported true peak under its ceiling and Low-Pass removes what is above its cutoff", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeTone("hot.wav", 9000, 0.98, 4), writeTone("bright.wav", 6000, 0.3, 4)]);
  const hot = await addToLane(page, "hot.wav", "Music", 0);
  const bright = await addToLane(page, "bright.wav", "Dialogue", 0);

  const mix = (from: number, length: number) =>
    page.evaluate(
      async ([start, len]) => {
        const engine = E().audio.getAudioEngine();
        if (!engine.isInitialized()) await engine.initialize();
        const rendered = await engine.renderAudio(E().project.getState().getFullProject(), start, len);
        const buffer = rendered.buffer as AudioBuffer;
        return { rate: buffer.sampleRate, left: Array.from(buffer.getChannelData(0)) as number[], right: Array.from(buffer.getChannelData(1)) as number[] };
      },
      [from, length] as const,
    );
  const peak = (x: number[]) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

  // Solo each lane so the two measurements do not mix.
  const mute = (name: string, muted: boolean) =>
    page.evaluate(async ([lane, on]) => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === lane).id, on);
    }, [name, muted] as const);

  await mute("Dialogue", true);
  const before = await mix(0.5, 3);
  expect(peak(before.left), "the source is hot (mono centre pan law included)").toBeGreaterThan(0.6);

  const limiter = { id: "lim-1", type: "brickwallLimiter", enabled: true, params: { ceiling: -12, release: 0.1 } };
  await page.evaluate(([id, effect]) => E().project.getState().addAudioEffect(id, effect), [hot, limiter] as const);
  await settle(page, 400);
  const limited = await mix(0.5, 3);
  const ceiling = Math.pow(10, -12 / 20);
  console.log(`[limiter] peak before ${peak(before.left).toFixed(4)} -> after ${peak(limited.left).toFixed(4)} (ceiling ${ceiling.toFixed(4)})`);
  expect(peak(limited.left), "left").toBeLessThanOrEqual(ceiling);
  expect(peak(limited.right), "right").toBeLessThanOrEqual(ceiling);
  expect(peak(limited.left), "it limits rather than mutes").toBeGreaterThan(ceiling * 0.8);

  await mute("Music", true);
  await mute("Dialogue", false);
  const brightBefore = await mix(0.5, 3);
  const lowPass = { id: "lp-1", type: "lowPass", enabled: true, params: { frequency: 1000, slope: 24 } };
  await page.evaluate(([id, effect]) => E().project.getState().addAudioEffect(id, effect), [bright, lowPass] as const);
  await settle(page, 400);
  const filtered = await mix(0.5, 3);
  const attenuation = db(toneAmpArr(brightBefore.left, brightBefore.rate, 6000), toneAmpArr(filtered.left, filtered.rate, 6000));
  console.log(`[lowpass] 6 kHz attenuated ${attenuation.toFixed(1)} dB by a 1 kHz / 24 dB/oct low-pass`);
  expect(attenuation).toBeGreaterThan(30);
  await page.screenshot({ path: testInfo.outputPath("limiter-lowpass.png") });
});

function toneAmpArr(x: number[], rate: number, freq: number): number {
  return toneAmp(Float32Array.from(x), rate, freq, 0, x.length / rate);
}
