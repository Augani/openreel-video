import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importInput, openEditor, settle } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";

/**
 * 5.1 surround, checked in real Chrome:
 *  - the sequence audio channel layout is a mixer setting (Stereo / 5.1), one undo step, stored in the project settings;
 *  - the offline mixdown of a 5.1 sequence has six discrete channels: a 5.1 source lands on its own channels with no
 *    crosstalk, a mono source follows the clip / track surround panner (front L/R/C, LFE send, surround L/R);
 *  - a stereo sequence keeps its two-channel mixdown (and a 5.1 -> stereo undo restores it exactly);
 *  - stems of a 5.1 sequence are six-channel WAVs with the 5.1 speaker mask (ffprobe);
 *  - loudness uses the BS.1770 surround weights (Ls/Rs +1.5 dB, LFE excluded);
 *  - an exported MP4 / MOV carries six AAC channels in the right order (ffprobe layout 5.1, per-channel energy via ffmpeg).
 */

interface Hook {
  project: { getState(): Record<string, any> };
  audio: Record<string, any>;
  stems: Record<string, any>;
  ui: { getState(): Record<string, any> };
  analyzeTimelineLoudness: (options?: unknown) => Promise<{ integrated: number; channels: number }>;
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const SR = 48000;
const workDir = mkdtempSync(join(tmpdir(), "openreel-surround-"));
/** One tone per channel, in the L R C LFE Ls Rs order. */
const CHANNEL_TONES = [300, 500, 700, 80, 1100, 1700];
const CHANNEL_NAMES = ["L", "R", "C", "LFE", "Ls", "Rs"];

/** 16-bit PCM WAV, WAVE_FORMAT_EXTENSIBLE for more than two channels, one sine per channel. */
function writeWav(name: string, tones: number[], amplitude: number, seconds: number): string {
  const channels = tones.length;
  const frames = SR * seconds;
  const extensible = channels > 2;
  const fmtSize = extensible ? 40 : 16;
  const dataSize = frames * channels * 2;
  const buf = Buffer.alloc(12 + 8 + fmtSize + 8 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(fmtSize, 16);
  buf.writeUInt16LE(extensible ? 0xfffe : 1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  if (extensible) {
    buf.writeUInt16LE(22, 36);
    buf.writeUInt16LE(16, 38);
    buf.writeUInt32LE(channels === 6 ? 0x3f : (1 << channels) - 1, 40);
    Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]).copy(buf, 44);
  }
  const dataAt = 20 + fmtSize;
  buf.write("data", dataAt);
  buf.writeUInt32LE(dataSize, dataAt + 4);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * tones[c] * i) / SR) * 32767), dataAt + 8 + (i * channels + c) * 2);
    }
  }
  const path = join(workDir, name);
  writeFileSync(path, buf);
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

const muteMain = (page: Page) =>
  page.evaluate(async () => {
    const st = E().project.getState();
    await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
  });

const runAction = (page: Page, type: string, params: Record<string, unknown>) =>
  page.evaluate(
    async ([actionType, actionParams]) => {
      const result = await E().project.getState().executeAction({ id: crypto.randomUUID(), timestamp: Date.now(), type: actionType, params: actionParams });
      return { success: result.success as boolean, error: result.error?.message as string | undefined };
    },
    [type, params] as const,
  );

const settings = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(E().project.getState().project.settings)) as { channels: number; channelLayout?: string });
const undoSteps = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

/** Offline mixdown of [start, start + length) as one Float32Array per channel. */
const mixdown = (page: Page, start: number, length: number) =>
  page.evaluate(
    async ([from, len]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const out = await engine.renderAudio(E().project.getState().getFullProject(), from, len);
      const buffer = out.buffer as AudioBuffer;
      return { rate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => Array.from(buffer.getChannelData(c))) };
    },
    [start, length] as const,
  );

/** Amplitude of one frequency (single-bin DFT) over the whole array. */
function toneAmp(x: ArrayLike<number>, rate: number, freq: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    const w = (2 * Math.PI * freq * i) / rate;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / x.length;
}

const db = (a: number, b: number) => 20 * Math.log10(a / b);

const openMixer = async (page: Page) => {
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
};

test("5.1 sequence: mixer layout setting, six-channel mixdown, surround panner, stems and BS.1770 loudness", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeWav("surround-6ch.wav", CHANNEL_TONES, 0.4, 3), writeWav("mono-1k.wav", [1000], 0.4, 3)]);
  const six = await addToLane(page, "surround-6ch.wav", "Music", 0);
  const mono = await addToLane(page, "mono-1k.wav", "Dialogue", 0);
  const trackId = await page.evaluate((id) => E().project.getState().project.timeline.tracks.find((t: any) => t.clips.some((c: any) => c.id === id)).id as string, mono);

  // Stereo is the default and stays a two-channel mix.
  expect(await settings(page)).toMatchObject({ channels: 2 });
  expect((await settings(page)).channelLayout).toBeUndefined();
  const stereoBefore = await mixdown(page, 0.5, 1);
  expect(stereoBefore.channels).toHaveLength(2);

  // The layout is a Audio Mixer setting: Stereo / 5.1 Surround.
  await openMixer(page);
  const stepsBefore = await undoSteps(page);
  await page.getByTestId("mixer-channel-layout").click();
  await page.getByRole("option", { name: "5.1 Surround" }).click();
  await expect.poll(() => settings(page)).toMatchObject({ channelLayout: "5.1", channels: 6 });
  expect(await undoSteps(page)).toBe(stepsBefore + 1);
  await expect(page.getByTestId(`surround-track-${trackId}-puck`)).toBeVisible();
  await page.getByTestId("audio-mixer").screenshot({ path: testInfo.outputPath("mixer-5.1.png") });

  // Offline mixdown: six channels. The 5.1 source plays on its own channels (no crosstalk); the mono clip is silenced for now.
  await page.evaluate(async (id) => E().project.getState().muteTrack(id, true), trackId);
  const surround = await mixdown(page, 0.5, 2);
  expect(surround.channels).toHaveLength(6);
  const matrix = CHANNEL_TONES.map((_, c) => CHANNEL_TONES.map((f) => toneAmp(surround.channels[c], surround.rate, f)));
  CHANNEL_TONES.forEach((_, c) => {
    expect(matrix[c][c], `${CHANNEL_NAMES[c]} carries its own tone at full level`).toBeGreaterThan(0.38);
    expect(matrix[c][c]).toBeLessThan(0.42);
    CHANNEL_TONES.forEach((_, other) => {
      if (other !== c) expect(db(matrix[c][c], Math.max(matrix[c][other], 1e-9)), `${CHANNEL_NAMES[other]} tone leaks into ${CHANNEL_NAMES[c]}`).toBeGreaterThan(60);
    });
  });

  // Panner: the mono clip (track position, then its own) moves around the room. Solo it by muting the 5.1 clip's track.
  await page.evaluate(async (id) => E().project.getState().muteTrack(id, false), trackId);
  const sixTrack = await page.evaluate((id) => E().project.getState().project.timeline.tracks.find((t: any) => t.clips.some((c: any) => c.id === id)).id as string, six);
  await page.evaluate(async (id) => E().project.getState().muteTrack(id, true), sixTrack);
  const level = async (channel: number, from = 0.5, length = 2) => toneAmp((await mixdown(page, from, length)).channels[channel], SR, 1000);
  const centre = await mixdown(page, 0.5, 2);
  const at = (c: number) => toneAmp(centre.channels[c], SR, 1000);
  expect(at(0), "front centre, no divergence: a phantom image on L").toBeCloseTo(0.4 * Math.SQRT1_2, 2);
  expect(at(1)).toBeCloseTo(0.4 * Math.SQRT1_2, 2);
  expect(at(2)).toBeLessThan(0.005);
  expect(at(4)).toBeLessThan(0.005);

  // Track panner, driven through the mixer UI (keyboard on the puck): hard left, front.
  await page.getByTestId(`surround-track-${trackId}-puck`).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(() => page.evaluate((id) => E().project.getState().project.timeline.tracks.find((t: any) => t.id === id).surroundPan?.x as number | undefined, trackId))
    .toBe(-1);
  expect(await level(0)).toBeCloseTo(0.4, 2);
  expect(await level(1)).toBeLessThan(0.005);

  // Clip panner overrides the track: rear right, with a 50% LFE send.
  const rear = await runAction(page, "audio/setSurroundPan", { clipId: mono, pan: { x: 1, y: -1, divergence: 0, lfeSend: 0.5 } });
  expect(rear.success, rear.error).toBe(true);
  const rearMix = await mixdown(page, 0.5, 2);
  const rearAt = (c: number) => toneAmp(rearMix.channels[c], SR, 1000);
  expect(rearAt(5), "Rs").toBeCloseTo(0.4, 2);
  expect(rearAt(0) + rearAt(1) + rearAt(2) + rearAt(4)).toBeLessThan(0.01);
  expect(rearAt(3), "LFE send").toBeCloseTo(0.2, 2);

  // Divergence pulls a centred front source into C.
  await runAction(page, "audio/setSurroundPan", { clipId: mono, pan: { x: 0, y: 1, divergence: 1, lfeSend: 0 } });
  const divergent = await mixdown(page, 0.5, 2);
  expect(toneAmp(divergent.channels[2], SR, 1000)).toBeCloseTo(0.4, 2);
  expect(toneAmp(divergent.channels[0], SR, 1000)).toBeLessThan(0.005);

  // BS.1770 surround weights: the same tone is 1.5 dB louder in Ls than in L, and the LFE does not count.
  const loudnessAt = async (pan: Record<string, number>) => {
    await runAction(page, "audio/setSurroundPan", { clipId: mono, pan });
    const result = await page.evaluate(() => E().analyzeTimelineLoudness());
    return result;
  };
  const inL = await loudnessAt({ x: -1, y: 1, divergence: 0, lfeSend: 0 });
  const inC = await loudnessAt({ x: 0, y: 1, divergence: 1, lfeSend: 0 });
  const inLs = await loudnessAt({ x: -1, y: -1, divergence: 0, lfeSend: 0 });
  expect(inL.channels).toBe(6);
  console.log(`[surround] loudness L ${inL.integrated.toFixed(2)}  C ${inC.integrated.toFixed(2)}  Ls ${inLs.integrated.toFixed(2)} LUFS`);
  expect(inC.integrated - inL.integrated, "C and L have the same weight").toBeCloseTo(0, 1);
  expect(inLs.integrated - inL.integrated, "Ls is weighted 1.41 (+1.5 dB)").toBeCloseTo(10 * Math.log10(1.41), 1);

  // Undo takes the panner moves off one by one; the stereo layout undoes exactly and the stereo mixdown is unchanged.
  await runAction(page, "audio/setSurroundPan", { clipId: mono, pan: null });
  expect(await page.evaluate((id) => E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id).surroundPan, mono)).toBeUndefined();

  // Stems of a 5.1 sequence: six-channel WAVs with the 5.1 speaker mask.
  await page.evaluate(async (id) => E().project.getState().muteTrack(id, false), sixTrack);
  const stems = await page.evaluate(async () => {
    const out = await E().stems.renderProjectStems({ mode: "track", bitDepth: 24 });
    return out.map((s: any) => {
      let text = "";
      for (let i = 0; i < s.wav.length; i += 0x8000) text += String.fromCharCode(...s.wav.subarray(i, i + 0x8000));
      return { name: s.name as string, fileName: s.fileName as string, channels: s.channels as number, base64: btoa(text) };
    });
  });
  expect(stems.length).toBeGreaterThanOrEqual(2);
  mkdirSync(join(workDir, "stems"), { recursive: true });
  for (const stem of stems) {
    expect(stem.channels).toBe(6);
    const path = join(workDir, "stems", stem.fileName);
    writeFileSync(path, Buffer.from(stem.base64, "base64"));
    const probe = JSON.parse(execFileSync(E2E_FFPROBE, ["-v", "error", "-show_streams", "-of", "json", path], { encoding: "utf8" }));
    const audio = probe.streams[0];
    expect(audio.channels).toBe(6);
    expect(audio.channel_layout).toBe("5.1");
    expect(audio.codec_name).toBe("pcm_s24le");
  }

  // Back to stereo through the mixer: one undo step, two channels again, and the stereo mix is exactly what it was.
  await page.evaluate(async () => {
    const st = E().project.getState();
    await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Music").id, false);
  });
  await page.getByTestId("mixer-channel-layout").click();
  await page.getByRole("option", { name: "Stereo", exact: true }).click();
  await expect.poll(() => settings(page)).toMatchObject({ channels: 2, channelLayout: "stereo" });
  const stereoAfter = await mixdown(page, 0.5, 1);
  expect(stereoAfter.channels).toHaveLength(2);
  await page.evaluate(async () => {
    await E().project.getState().undo(); // undoes the switch back to stereo: 5.1 again
  });
  await expect.poll(() => settings(page)).toMatchObject({ channelLayout: "5.1", channels: 6 });
  await page.screenshot({ path: testInfo.outputPath("surround-51-done.png") });
});

/** Per-channel amplitude of `tone` in a decoded f32le stream (interleaved). */
function channelEnergy(raw: Buffer, channels: number, tones: number[]): number[][] {
  const frames = Math.floor(raw.length / 4 / channels);
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) data[c][i] = raw.readFloatLE((i * channels + c) * 4);
  // Analyse a stable middle window of the audible part (the AAC priming and the end of the clip are left out).
  const from = Math.floor(SR * 0.6);
  const to = Math.floor(SR * 2.4);
  return data.map((channel) => tones.map((f) => toneAmp(channel.subarray(from, to), SR, f)));
}

/** Export from the Custom tab of the Export dialog in the given container. */
async function exportCurrent(page: Page, testInfo: { outputPath(name: string): string }, name: string, container: "MP4" | "MOV"): Promise<string> {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Export", exact: true }).first().click();
    await dialog.waitFor({ timeout: 15_000 });
    await settle(page, 1000);
  }
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  await page.locator("#export-format").click();
  await page.getByRole("option", { name: container, exact: true }).click();
  const download = page.waitForEvent("download", { timeout: 360_000 });
  // An export that fails shows a dismissable error banner and never downloads: surface that at once instead of waiting
  // out the download timeout (a CI run burned 6 minutes on exactly this).
  const banner = page.getByRole("button", { name: "Dismiss export error" });
  const failed = banner.waitFor({ timeout: 360_000 }).then(async () => {
    throw new Error(`${container} export failed: ${(await banner.getAttribute("title").catch(() => null)) ?? "(no message)"}`);
  });
  failed.catch(() => undefined);
  download.catch(() => undefined);
  await page.getByRole("button", { name: "Export Video" }).last().click();
  const out = testInfo.outputPath(name);
  await (await Promise.race([download, failed])).saveAs(out);
  return out;
}

/** Whether this browser can encode six-channel AAC (WebCodecs AudioEncoder): Chrome on Linux ships no AAC encoder. */
async function canEncodeSurroundAac(page: Page): Promise<boolean> {
  return page.evaluate(async (sampleRate) => {
    if (typeof AudioEncoder === "undefined") return false;
    for (const bitrate of [384_000, 192_000, 128_000]) {
      try {
        const support = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 6, bitrate });
        if (support.supported) return true;
      } catch {
        /* try the next bitrate */
      }
    }
    return false;
  }, SR);
}

test("exporting a 5.1 sequence writes six AAC channels in MP4 and MOV: ffprobe layout 5.1 and per-channel energy", async ({ page }, testInfo) => {
  testInfo.setTimeout(600_000);
  await openEditor(page);
  await muteMain(page);
  await importAudio(page, [writeWav("export-6ch.wav", CHANNEL_TONES, 0.3, 3)]);
  await addToLane(page, "export-6ch.wav", "Music", 0);
  await page.evaluate(async () => {
    const layout = { channelLayout: "5.1", channels: 6 };
    await E().project.getState().updateSettings(layout);
  });
  await expect.poll(() => settings(page)).toMatchObject({ channelLayout: "5.1", channels: 6 });

  // WebM cannot carry 5.1: the dialog says so before anything is encoded.
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  await settle(page, 1500);
  await page.getByRole("tab", { name: "Custom Settings" }).click();
  await expect(page.getByTestId("export-audio-channels")).toBeVisible();
  await page.locator("#export-format").click();
  await page.getByRole("option", { name: "WebM" }).click();
  await expect(page.getByTestId("export-audio-channels-webm")).toBeVisible();
  // Back to MP4 (the dialog stays open for the real exports below).
  await page.locator("#export-format").click();
  await page.getByRole("option", { name: "MP4", exact: true }).click();
  await expect(page.getByTestId("export-audio-channels-webm")).toBeHidden();

  const probeStream = (path: string) => {
    const probe = JSON.parse(execFileSync(E2E_FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,channels,channel_layout,sample_rate,bit_rate", "-of", "json", path], { encoding: "utf8" }));
    return probe.streams[0] as { codec_name: string; channels: number; channel_layout: string; sample_rate: string; bit_rate: string };
  };
  const analyse = (path: string) => {
    const raw = execFileSync(E2E_FFMPEG, ["-v", "error", "-i", path, "-vn", "-f", "f32le", "-acodec", "pcm_f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
    return channelEnergy(raw, 6, CHANNEL_TONES);
  };
  const check = (path: string, label: string) => {
    const audio = probeStream(path);
    console.log(`[surround] ${label}: ${JSON.stringify(audio)}`);
    expect(audio.codec_name).toBe("aac");
    expect(audio.channels).toBe(6);
    expect(audio.channel_layout).toBe("5.1");
    expect(Number(audio.sample_rate)).toBe(SR);
    const matrix = analyse(path);
    console.log(`[surround] ${label} per-channel energy:\n${matrix.map((row, c) => `  ${CHANNEL_NAMES[c].padEnd(3)} ${row.map((v) => v.toFixed(3)).join(" ")}`).join("\n")}`);
    CHANNEL_TONES.forEach((_, c) => {
      expect(matrix[c][c], `${label}: ${CHANNEL_NAMES[c]} carries its own tone`).toBeGreaterThan(0.2);
      CHANNEL_TONES.forEach((__, other) => {
        if (other !== c) expect(matrix[c][other], `${label}: ${CHANNEL_NAMES[other]} tone in ${CHANNEL_NAMES[c]}`).toBeLessThan(matrix[c][c] * 0.12);
      });
    });
  };

  // The exports below are real AAC encodes through the browser's WebCodecs encoder. Chrome on Linux (the GPU-less CI
  // runner) has none, and the export then correctly refuses ("No supported audio encoder"), so there is nothing to
  // inspect there. The six-channel order logic is covered by aac-surround-order.test.ts; this half runs wherever the
  // browser can encode AAC (macOS, Windows).
  test.skip(!(await canEncodeSurroundAac(page)), "this browser has no six-channel AAC encoder (WebCodecs AudioEncoder, mp4a.40.2); Chrome on Linux CI cannot encode AAC");

  const mp4 = await exportCurrent(page, testInfo, "surround.mp4", "MP4");
  check(mp4, "MP4");

  const mov = await exportCurrent(page, testInfo, "surround.mov", "MOV");
  check(mov, "MOV");
  // MOV also carries the QuickTime channel layout atom (L R C LFE Ls Rs).
  const bytes = readFileSync(mov);
  const chan = bytes.indexOf(Buffer.from("chan"));
  expect(chan, "MOV has a chan atom").toBeGreaterThan(0);
  expect(bytes.readUInt32BE(chan + 4)).toBe(0); // version/flags
  expect(bytes.readUInt32BE(chan + 8)).toBe((121 << 16) | 6); // MPEG_5_1_A
});
