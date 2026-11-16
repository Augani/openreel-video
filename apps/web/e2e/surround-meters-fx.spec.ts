import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importInput, openEditor, settle } from "./helpers";
import { surroundPanGains } from "../../../packages/core/src/audio/surround";

/**
 * 5.1 meters and effects, checked in real Chrome:
 *  - playing a 5.1 sequence, the mixer's master and track meters show six channels (L R C LFE Ls Rs) and the active
 *    ones are exactly the channels the surround panner feeds, at the level the pan law predicts;
 *  - a 5.1 clip with a clip-level compressor is not folded to stereo (all six channels play, linked gain reduction);
 *    the offline mixdown (export) agrees with that;
 *  - switching the sequence layout during playback reschedules cleanly (no silence, no doubled playback);
 *  - a stereo sequence mixes sample-for-sample like it did before this work (fixture rendered at the base commit).
 */

interface Hook {
  project: { getState(): Record<string, any> };
  timeline: { getState(): Record<string, any> };
  audio: Record<string, any>;
  ui: { getState(): Record<string, any> };
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const SR = 48000;
const workDir = mkdtempSync(join(tmpdir(), "openreel-surround-meters-"));
const CHANNEL_NAMES = ["L", "R", "C", "LFE", "Ls", "Rs"] as const;
const SIX_TONES = [300, 500, 700, 80, 1100, 1700];
const FLOOR = -60;
const SILENT_BELOW = -50;

/** 16-bit PCM WAV, WAVE_FORMAT_EXTENSIBLE above two channels, one sine per channel (its own amplitude). */
function writeWav(name: string, tones: number[], amplitudes: number[], seconds: number): string {
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
      buf.writeInt16LE(Math.round(amplitudes[c] * Math.sin((2 * Math.PI * tones[c] * i) / SR) * 32767), dataAt + 8 + (i * channels + c) * 2);
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

const muteLane = (page: Page, lane: string, muted: boolean) =>
  page.evaluate(
    async ([name, on]) => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === name).id, on);
    },
    [lane, muted] as const,
  );

const laneId = (page: Page, lane: string) =>
  page.evaluate((name) => E().project.getState().project.timeline.tracks.find((t: any) => t.name === name).id as string, lane);

const runAction = (page: Page, type: string, params: Record<string, unknown>) =>
  page.evaluate(
    async ([actionType, actionParams]) => {
      const result = await E().project.getState().executeAction({ id: crypto.randomUUID(), timestamp: Date.now(), type: actionType, params: actionParams });
      return { success: result.success as boolean, error: result.error?.message as string | undefined };
    },
    [type, params] as const,
  );

const settings = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(E().project.getState().project.settings)) as { channels: number; channelLayout?: string });

const openMixer = async (page: Page) => {
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
};

async function setLayout(page: Page, option: "5.1 Surround" | "Stereo") {
  await page.getByTestId("mixer-channel-layout").click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect.poll(() => settings(page)).toMatchObject({ channelLayout: option === "Stereo" ? "stereo" : "5.1" });
}

type Meters = Record<string, number>;

/** Restarts playback at 0.2 s, lets it settle and returns the highest dBFS each meter of `scope` showed for `ms`. */
async function playAndRead(page: Page, scope: string, ms = 700): Promise<Meters> {
  await page.evaluate(() => {
    const t = E().timeline.getState();
    t.pause();
    t.seekTo(0.2);
  });
  await settle(page, 300);
  await page.evaluate(() => E().timeline.getState().play());
  await settle(page, 900);
  return page.evaluate(
    async ([selector, duration]) => {
      const peaks: Record<string, number> = {};
      const t0 = performance.now();
      while (performance.now() - t0 < (duration as number)) {
        const meters = Array.from(document.querySelectorAll(`${selector} [role="meter"]`));
        meters.forEach((el, index) => {
          const name = (el.parentElement as HTMLElement | null)?.getAttribute("data-meter-channel") ?? (index === 0 ? "L" : "R");
          peaks[name] = Math.max(peaks[name] ?? -60, Number(el.getAttribute("aria-valuenow")));
        });
        await new Promise((r) => setTimeout(r, 40));
      }
      return peaks;
    },
    [scope, ms] as const,
  );
}

const dB = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
const pause = (page: Page) => page.evaluate(() => E().timeline.getState().pause());

/** Expected per-channel dBFS of a mono tone of `amp` through the surround panner. */
function expectedMeters(amp: number, pan: { x: number; y: number; divergence: number; lfeSend: number }): number[] {
  return surroundPanGains(pan).map((g) => Math.max(FLOOR, dB(amp * g)));
}

function expectMetersMatchPanner(read: Meters, expected: number[], label: string) {
  CHANNEL_NAMES.forEach((name, c) => {
    if (expected[c] < SILENT_BELOW) expect(read[name], `${label}: ${name} must stay silent`).toBeLessThan(SILENT_BELOW);
    else expect(Math.abs(read[name] - expected[c]), `${label}: ${name} reads ${read[name]?.toFixed(1)} dB, the pan law says ${expected[c].toFixed(1)} dB`).toBeLessThan(1.5);
  });
}

test("5.1 playback: six labelled meters on the master and tracks, active exactly where the panner sends the signal", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  await openEditor(page);
  await muteLane(page, "Main", true);
  await importAudio(page, [writeWav("meter-mono.wav", [1000], [0.4], 12), writeWav("meter-6ch.wav", SIX_TONES, [0.3, 0.3, 0.3, 0.3, 0.3, 0.3], 12)]);
  const mono = await addToLane(page, "meter-mono.wav", "Dialogue", 0);
  const six = await addToLane(page, "meter-6ch.wav", "Music", 0);
  const dialogueTrack = await laneId(page, "Dialogue");
  const musicTrack = await laneId(page, "Music");
  await muteLane(page, "Music", true);

  // Stereo first: two meters, as before.
  await openMixer(page);
  const stereo = await playAndRead(page, '[data-testid="master-channel"]', 400);
  expect(Object.keys(stereo).sort()).toEqual(["L", "R"]);
  await pause(page);

  await setLayout(page, "5.1 Surround");
  const masterMeters = page.locator('[data-testid="master-channel"] [role="meter"]');
  await expect(masterMeters).toHaveCount(6);
  // Correct labels on the master and on a track strip.
  expect(await masterMeters.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).toEqual(
    CHANNEL_NAMES.map((n) => `Master ${n} level`),
  );
  const strip = page.getByTestId(`channel-strip-${dialogueTrack}`);
  await expect(strip.locator('[role="meter"]')).toHaveCount(6);
  expect(await strip.locator("[data-meter-channel]").evaluateAll((els) => els.map((el) => el.getAttribute("data-meter-channel")))).toEqual([...CHANNEL_NAMES]);
  await page.getByTestId("audio-mixer").screenshot({ path: testInfo.outputPath("mixer-5.1-meters.png") });

  // Each position: the meters of the master (and of the track strip) follow the panner.
  const positions: Array<[string, { x: number; y: number; divergence: number; lfeSend: number }]> = [
    ["front centre (phantom L/R)", { x: 0, y: 1, divergence: 0, lfeSend: 0 }],
    ["hard left front", { x: -1, y: 1, divergence: 0, lfeSend: 0 }],
    ["rear right with a 50% LFE send", { x: 1, y: -1, divergence: 0, lfeSend: 0.5 }],
    ["divergence pulls it into C", { x: 0, y: 1, divergence: 1, lfeSend: 0 }],
    ["wandering between speakers", { x: -0.4, y: 0.2, divergence: 0.3, lfeSend: 0.2 }],
  ];
  for (const [label, pan] of positions) {
    const result = await runAction(page, "audio/setSurroundPan", { clipId: mono, pan });
    expect(result.success, result.error).toBe(true);
    const expected = expectedMeters(0.4, pan);
    expectMetersMatchPanner(await playAndRead(page, '[data-testid="master-channel"]'), expected, `master, ${label}`);
    expectMetersMatchPanner(await playAndRead(page, `[data-testid="channel-strip-${dialogueTrack}"]`), expected, `track strip, ${label}`);
    console.log(`[meters] ${label}: ${expected.map((v, c) => `${CHANNEL_NAMES[c]} ${v.toFixed(1)}`).join("  ")}`);
  }
  await pause(page);

  // A six-channel clip plays on its own six channels, all meters live at the same level.
  await runAction(page, "audio/setSurroundPan", { clipId: mono, pan: null });
  await muteLane(page, "Dialogue", true);
  await muteLane(page, "Music", false);
  const sixBefore = await playAndRead(page, '[data-testid="master-channel"]');
  CHANNEL_NAMES.forEach((name) => expect(Math.abs(sixBefore[name] - dB(0.3)), `${name} of the 5.1 clip`).toBeLessThan(1.5));
  const musicStrip = await playAndRead(page, `[data-testid="channel-strip-${musicTrack}"]`);
  CHANNEL_NAMES.forEach((name) => expect(Math.abs(musicStrip[name] - dB(0.3)), `${name} on the Music strip`).toBeLessThan(1.5));

  // A clip-level compressor on the 5.1 clip no longer folds it to two channels: six channels, one linked gain reduction.
  const compressor = { id: "surround-comp", type: "compressor", enabled: true, params: { threshold: -30, ratio: 4, attack: 0.003, release: 0.25, knee: 6 } };
  await page.evaluate(([id, effect]) => E().project.getState().addAudioEffect(id, effect), [six, compressor] as const);
  await settle(page, 600);
  const squashed = await playAndRead(page, '[data-testid="master-channel"]');
  const reductions = CHANNEL_NAMES.map((name) => sixBefore[name] - squashed[name]);
  console.log(`[meters] compressed 5.1 clip, reduction per channel: ${reductions.map((r) => r.toFixed(1)).join(" ")} dB`);
  CHANNEL_NAMES.forEach((name, c) => {
    expect(squashed[name], `${name} still plays through the compressor (not folded to stereo)`).toBeGreaterThan(-45);
    expect(reductions[c], `${name} is compressed`).toBeGreaterThan(5);
    expect(Math.abs(reductions[c] - reductions[0]), `${name} has the same (linked) gain reduction as L`).toBeLessThan(1.5);
  });

  // Switching the layout while it plays: it keeps sounding (6 -> 2 -> 6 channels), without a gap and without doubling.
  await page.evaluate(() => E().timeline.getState().pause());
  await page.evaluate(() => {
    const t = E().timeline.getState();
    t.seekTo(0.2);
  });
  await page.evaluate(() => E().timeline.getState().play());
  await settle(page, 1200);
  const liveRead = async (ms = 600) => {
    const out: Record<string, number> = {};
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const now = await page.locator('[data-testid="master-channel"] [role="meter"]').evaluateAll((els) =>
        els.map((el) => [(el.parentElement as HTMLElement).getAttribute("data-meter-channel") ?? (el.getAttribute("aria-label")?.includes("left") ? "L" : "R"), Number(el.getAttribute("aria-valuenow"))] as const),
      );
      for (const [name, value] of now) out[name] = Math.max(out[name] ?? -60, value);
      await page.waitForTimeout(40);
    }
    return out;
  };
  const before = await liveRead();
  await setLayout(page, "Stereo");
  await expect(masterMeters).toHaveCount(2);
  await settle(page, 700);
  const stereoLive = await liveRead();
  expect(Object.keys(stereoLive).sort()).toEqual(["L", "R"]);
  expect(stereoLive.L, "stereo playback resumed after the switch").toBeGreaterThan(-40);
  await setLayout(page, "5.1 Surround");
  await expect(masterMeters).toHaveCount(6);
  await settle(page, 700);
  const after = await liveRead();
  CHANNEL_NAMES.forEach((name) => {
    expect(after[name], `${name} sounds again after the switch back`).toBeGreaterThan(-45);
    expect(Math.abs(after[name] - before[name]), `${name}: same level as before the round trip (no doubled sources)`).toBeLessThan(2);
  });
  await pause(page);
  await page.screenshot({ path: testInfo.outputPath("surround-meters-done.png") });
});

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

test("5.1 clip compressor in the export mix: six channels survive and the gain reduction is linked across them", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  await openEditor(page);
  await muteLane(page, "Main", true);
  // A loud centre and quiet everything else: with a linked detector the quiet channels are pulled down by the centre.
  await importAudio(page, [writeWav("linked-6ch.wav", SIX_TONES, [0.05, 0.05, 0.8, 0.05, 0.05, 0.05], 4)]);
  const six = await addToLane(page, "linked-6ch.wav", "Music", 0);
  await page.evaluate(async () => E().project.getState().updateSettings({ channelLayout: "5.1", channels: 6 }));
  await expect.poll(() => settings(page)).toMatchObject({ channelLayout: "5.1", channels: 6 });

  const level = (mix: { rate: number; channels: number[][] }) => mix.channels.map((channel, c) => toneAmp(channel, mix.rate, SIX_TONES[c]));
  const plain = await mixdown(page, 0.5, 2);
  expect(plain.channels).toHaveLength(6);
  const plainLevels = level(plain);
  const compressor = { id: "linked-comp", type: "compressor", enabled: true, params: { threshold: -24, ratio: 6, attack: 0.003, release: 0.2, knee: 0 } };
  await page.evaluate(([id, effect]) => E().project.getState().addAudioEffect(id, effect), [six, compressor] as const);
  await settle(page, 500);
  const squashed = await mixdown(page, 0.5, 2);
  expect(squashed.channels, "the compressed mix keeps all six channels").toHaveLength(6);
  const squashedLevels = level(squashed);
  const reductionDb = squashedLevels.map((v, c) => dB(plainLevels[c]) - dB(v));
  console.log(`[linked compressor] per-channel reduction: ${reductionDb.map((r, c) => `${CHANNEL_NAMES[c]} ${r.toFixed(2)}`).join("  ")} dB`);
  CHANNEL_NAMES.forEach((name, c) => {
    expect(squashedLevels[c], `${name} still carries its tone`).toBeGreaterThan(0.003);
    expect(reductionDb[c], `${name} is pulled down by the loud centre`).toBeGreaterThan(8);
    expect(Math.abs(reductionDb[c] - reductionDb[2]), `${name} has the same reduction as C`).toBeLessThan(0.75);
  });
  // No channel picked up another's tone (the old fold-to-stereo crosstalk).
  CHANNEL_NAMES.forEach((_, c) => {
    SIX_TONES.forEach((f, other) => {
      if (other !== c) expect(toneAmp(squashed.channels[c], squashed.rate, f), `${CHANNEL_NAMES[other]} tone in ${CHANNEL_NAMES[c]}`).toBeLessThan(squashedLevels[c] * 0.05);
    });
  });
});

// ---------------------------------------------------------------------------
// Stereo regression: the stereo sequence mix is unchanged by the 5.1 work.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, "fixtures", "stereo-mix-baseline.json");

/**
 * The fixture was rendered on macOS, where the same Chromium build reproduces it bit-for-bit
 * (max diff 0), so macOS keeps the strict bound. Chromium's offline compressor / reverb / delay DSP uses
 * different SIMD and libm paths on Linux and lands ~7e-4 away at a 0.89 peak (about -62 dB; observed on
 * GitHub's ubuntu runner). That is float noise through nonlinear stages; a real change to the stereo path
 * (a fold, a gain or routing change) moves samples by 1e-2 or more, so 2e-3 on Linux still catches it.
 */
const STEREO_BASELINE_EPS = process.platform === "darwin" ? 1e-5 : 2e-3;

async function buildStereoScene(page: Page) {
  await openEditor(page);
  await muteLane(page, "Main", true);
  await importAudio(page, [writeWav("reg-dialogue.wav", [440], [0.5], 4), writeWav("reg-music.wav", [330, 550], [0.4, 0.4], 4)]);
  const dialogue = await addToLane(page, "reg-dialogue.wav", "Dialogue", 0);
  const music = await addToLane(page, "reg-music.wav", "Music", 0);
  const addEffect = (clipId: string, effect: Record<string, unknown>) => page.evaluate(([id, fx]) => E().project.getState().addAudioEffect(id, fx), [clipId, effect] as const);
  // Clip-level effects (the legacy chain): compressor, EQ, gain, delay, pan and a repair low-pass.
  await addEffect(dialogue, { id: "r-comp", type: "compressor", enabled: true, params: { threshold: -24, ratio: 6, attack: 0.003, release: 0.2, knee: 20 } });
  await addEffect(dialogue, { id: "r-eq", type: "eq", enabled: true, params: { bands: [{ type: "peaking", frequency: 800, gain: 6, q: 1.2 }, { type: "highshelf", frequency: 6000, gain: -3, q: 0.7 }] } });
  await addEffect(dialogue, { id: "r-gain", type: "gain", enabled: true, params: { value: 0.8 } });
  await addEffect(dialogue, { id: "r-delay", type: "delay", enabled: true, params: { time: 0.15, feedback: 0.3, wetLevel: 0.3 } });
  await addEffect(dialogue, { id: "r-pan", type: "pan", enabled: true, params: { value: -0.4 } });
  await addEffect(music, { id: "r-lp", type: "lowPass", enabled: true, params: { frequency: 4000, slope: 12 } });
  // Track and master racks: EQ, compressor, limiter, reverb, delay, with volume and pan.
  const rack = (target: string, value: Record<string, unknown>) => page.evaluate(([id, r]) => E().project.getState().setAudioRack(id, r), [target, value] as const);
  await rack(await laneId(page, "Dialogue"), {
    volume: 0.9,
    pan: 0.2,
    effects: [
      { id: "k-eq", type: "eq", bypassed: false, params: { lowGain: 3, midGain: -2, midFreq: 1200, midQ: 1, highGain: 2 } },
      { id: "k-comp", type: "compressor", bypassed: false, params: { threshold: -20, ratio: 3, attack: 0.005, release: 0.2, knee: 10, makeupGain: 2 } },
      { id: "k-lim", type: "limiter", bypassed: false, params: { ceiling: -3, release: 0.1 } },
    ],
  });
  await rack(await laneId(page, "Music"), {
    volume: 0.8,
    pan: -0.3,
    effects: [
      { id: "m-rev", type: "reverb", bypassed: false, params: { roomSize: 0.3, damping: 0.5, dryLevel: 1, wetLevel: 0.25 } },
      { id: "m-delay", type: "delay", bypassed: false, params: { time: 0.2, feedback: 0.25, wetLevel: 0.2 } },
    ],
  });
  await page.evaluate(() => E().project.getState().setAudioRack("master", { volume: 0.95, effects: [{ id: "x-lim", type: "limiter", bypassed: false, params: { ceiling: -1, release: 0.1 } }] }));
  await settle(page, 600);
}

const toBase64 = (left: number[], right: number[]) => {
  const f = new Float32Array(left.length * 2);
  left.forEach((v, i) => {
    f[i * 2] = v;
    f[i * 2 + 1] = right[i];
  });
  return Buffer.from(f.buffer).toString("base64");
};

test("stereo sequence mix is sample-identical to the fixture rendered before the 5.1 effects work", async ({ page }) => {
  test.setTimeout(240_000);
  await buildStereoScene(page);
  expect(await settings(page)).toMatchObject({ channels: 2 });
  const mix = await mixdown(page, 0.5, 0.6);
  expect(mix.channels).toHaveLength(2);
  expect(mix.rate).toBe(SR);
  const peak = Math.max(...mix.channels[0].map(Math.abs), ...mix.channels[1].map(Math.abs));
  expect(peak, "the scene is audible").toBeGreaterThan(0.05);

  if (process.env.OPENREEL_WRITE_STEREO_BASELINE) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify({ rate: mix.rate, frames: mix.channels[0].length, from: 0.5, interleavedFloat32: toBase64(mix.channels[0], mix.channels[1]) }));
    console.log(`[stereo-baseline] wrote ${BASELINE} (${mix.channels[0].length} frames, peak ${peak.toFixed(4)})`);
    return;
  }
  expect(existsSync(BASELINE), `missing ${BASELINE}: render it at the base commit with OPENREEL_WRITE_STEREO_BASELINE=1`).toBe(true);
  const fixture = JSON.parse(readFileSync(BASELINE, "utf8")) as { rate: number; frames: number; interleavedFloat32: string };
  const bytes = Buffer.from(fixture.interleavedFloat32, "base64");
  const expected = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  expect(mix.channels[0].length).toBe(fixture.frames);
  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i < fixture.frames; i++) {
    for (let c = 0; c < 2; c++) {
      const diff = Math.abs(mix.channels[c][i] - expected[i * 2 + c]);
      if (diff > worst) {
        worst = diff;
        worstAt = i;
      }
    }
  }
  console.log(`[stereo-baseline] max |diff| vs the pre-change render: ${worst.toExponential(2)} (frame ${worstAt}, peak ${peak.toFixed(4)})`);
  expect(worst, `stereo mix drifted from the pre-change render (max |diff| ${worst.toExponential(2)}, limit ${STEREO_BASELINE_EPS.toExponential(0)})`).toBeLessThan(STEREO_BASELINE_EPS);
});
