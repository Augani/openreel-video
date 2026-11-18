import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, importInput, openEditor, settle } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";

/**
 * Audio repair, checked in real Chrome:
 *  - the AudioWorklet effects (rack bus on an OfflineAudioContext, i.e. the
 *    mixdown / export path) produce the same samples as the block-streaming
 *    reference the unit tests exercise (so realtime == offline), and the same
 *    node runs on the live AudioContext;
 *  - the Repair panel's auto-detect finds hum + clicks in a dialogue fixture,
 *    applies the fix as ONE undo step, and the exported file measurably improves;
 *  - a stems job queued from the export queue produces a zip of N valid WAVs.
 */

const FFPROBE = E2E_FFPROBE;
const FFMPEG = E2E_FFMPEG;
const workDir = mkdtempSync(join(tmpdir(), "openreel-repair-"));

interface Hook {
  project: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  audio: Record<string, any>;
  exportQueue: { getState(): Record<string, any> };
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

const SR = 48000;

/** 4 s of synthetic dialogue (voiced syllables) with 60 Hz hum and a few clicks, 16-bit mono WAV. */
function writeDialogueWav(path: string): void {
  const seconds = 4;
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
  let seed = 11;
  const clicks = new Set([30000, 70500, 110000, 150321, 181000]);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.sin(Math.PI * 2.5 * t) ** 2; // smooth syllables: no broadband leakage around 60 Hz
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 140 * h * t + h) / h;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    let x = 0.25 * env * v + (seed / 4294967296 - 0.5) * 0.002;
    x += 0.06 * Math.sin(2 * Math.PI * 60 * t) + 0.04 * Math.sin(2 * Math.PI * 120 * t) + 0.02 * Math.sin(2 * Math.PI * 180 * t);
    if (clicks.has(i)) x += 0.8;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2);
  }
  writeFileSync(path, pcm);
}

const toneAmp = (x: Float32Array, freq: number, from: number, to: number): number => {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
};
const peakOf = (x: Float32Array, from: number, to: number): number => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);
/** Largest sample-to-sample step: a click is a step several times larger than any voiced content. */
const maxStep = (x: Float32Array, from: number, to: number): number => {
  let m = 0;
  for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
};

/** Decode the audio of a finished export (mono f32 @ 48 kHz) with ffmpeg. */
function decodeAudio(file: string): Float32Array {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const history = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

async function addToLane(page: Page, mediaName: string, lane: string, start: number) {
  const result = await page.evaluate(
    async ([media, laneName, at]) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === media);
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      return st.addClip(target.id, item.id, at);
    },
    [mediaName, lane, start] as const,
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  await settle(page, 400);
}

const clipOnLane = (page: Page, lane: string) =>
  page.evaluate((name) => {
    const track = E().project.getState().project.timeline.tracks.find((t: any) => t.name === name);
    return track.clips[0].id as string;
  }, lane);

/** Mixdown of [0, seconds] exactly as the export engine renders it. */
async function renderMix(page: Page, seconds: number): Promise<{ hum60: number; peak: number; hum120: number }> {
  return page.evaluate(async (len) => {
    const engine = E().audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(E().project.getState().getFullProject(), 0, len);
    const d = out.buffer.getChannelData(0);
    const rate = out.buffer.sampleRate;
    // Hum is measured after the notch filters have settled (their start-up transient lasts ~0.3 s).
    const from = Math.floor(1.0 * rate);
    const amp = (f: number) => {
      let re = 0;
      let im = 0;
      for (let i = from; i < d.length; i++) {
        re += d[i] * Math.cos((2 * Math.PI * f * i) / rate);
        im -= d[i] * Math.sin((2 * Math.PI * f * i) / rate);
      }
      return (2 * Math.hypot(re, im)) / (d.length - from);
    };
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    return { hum60: amp(60), hum120: amp(120), peak };
  }, seconds);
}

test("worklet repair effects match the streaming reference sample for sample", async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const audio = E().audio;
    const rate = 48000;
    const length = rate;
    const input = new Float32Array(length);
    let seed = 99;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      input[i] =
        0.3 * Math.sin((2 * Math.PI * 1000 * i) / rate) +
        0.2 * Math.sin((2 * Math.PI * 60 * i) / rate) +
        0.02 * (seed / 4294967296 - 0.5) +
        (i % 9000 === 4000 ? 0.7 : 0);
    }
    const cases: Array<[string, Record<string, number>]> = [
      ["deHum", { frequency: 60, harmonics: 4, q: 30 }],
      ["deClick", { sensitivity: 0.6, maxWidth: 24 }],
      ["deEss", { frequency: 6500, threshold: -40, ratio: 6 }],
      ["deClip", { threshold: -6, maxRun: 64 }],
      ["gate", { threshold: -3, range: -30 }],
      ["deReverb", { amount: 0.6, rt60: 0.8, floor: -18 }],
    ];
    const out: Record<string, { maxDiff: number; latency: number; changed: number }> = {};
    for (const [type, params] of cases) {
      const ctx = new OfflineAudioContext(2, length + 4096, rate);
      await audio.ensureRepairWorklet(ctx);
      const buffer = ctx.createBuffer(2, length + 4096, rate);
      buffer.getChannelData(0).set(input);
      buffer.getChannelData(1).set(input);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const bus = new audio.AudioRackBus(ctx, { effects: [audio.createRackEffect(type, { params })] }, { live: false });
      src.connect(bus.input);
      bus.output.connect(ctx.destination);
      src.start(0);
      const rendered = (await ctx.startRendering()).getChannelData(0);
      const sanitized = bus["rack"].effects[0].params;
      const reference = audio.processChannels(type, [Float32Array.from([...input, ...new Float32Array(4096)])], rate, sanitized, 128)[0];
      let best = Infinity;
      let bestLatency = 0;
      for (const latency of [0, 30, 64, 68, 70, 1024]) {
        let diff = 0;
        for (let i = 2000; i < length - 2000; i++) diff = Math.max(diff, Math.abs(rendered[i + latency] - reference[i]));
        if (diff < best) {
          best = diff;
          bestLatency = latency;
        }
      }
      let changed = 0;
      for (let i = 2000; i < length - 2000; i++) if (Math.abs(reference[i] - input[i]) > 1e-4) changed++;
      out[type] = { maxDiff: best, latency: bestLatency, changed };
    }
    return out;
  });
  console.log("[repair] worklet vs reference", JSON.stringify(result));
  for (const [type, r] of Object.entries(result)) {
    expect(r.maxDiff, `${type} worklet vs reference`).toBeLessThan(1e-5);
  }
  expect(result.deHum.changed, "the hum notch actually processes the signal").toBeGreaterThan(1000);
});

test("the same effect node runs on the live AudioContext and reports gain reduction", async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const audio = E().audio;
    const graph = audio.getRealtimeAudioGraph();
    const ctx: AudioContext = graph.getAudioContext();
    await ctx.resume();
    const ready = await audio.ensureRepairWorklet(ctx);
    const measure = async (withEffect: boolean) => {
      const osc1 = ctx.createOscillator();
      osc1.frequency.value = 7000;
      const osc2 = ctx.createOscillator();
      osc2.frequency.value = 300;
      const g1 = ctx.createGain();
      g1.gain.value = 0.5;
      const g2 = ctx.createGain();
      g2.gain.value = 0.3;
      const sum = ctx.createGain();
      osc1.connect(g1).connect(sum);
      osc2.connect(g2).connect(sum);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      let meterId = "";
      let node: { dispose(): void } | null = null;
      if (withEffect) {
        meterId = `live-meter-${Math.random()}`;
        const rack = new audio.AudioRackBus(ctx, { effects: [audio.createRackEffect("deEss", { id: meterId, params: { frequency: 7000, threshold: -20, ratio: 10 } })] }, { live: true });
        sum.connect(rack.input);
        rack.output.connect(analyser);
        node = rack;
      } else {
        sum.connect(analyser);
      }
      analyser.connect(silent).connect(ctx.destination);
      osc1.start();
      osc2.start();
      await new Promise((r) => setTimeout(r, 1500));
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      const amp = (f: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < data.length; i++) {
          re += data[i] * Math.cos((2 * Math.PI * f * i) / ctx.sampleRate);
          im -= data[i] * Math.sin((2 * Math.PI * f * i) / ctx.sampleRate);
        }
        return (2 * Math.hypot(re, im)) / data.length;
      };
      const out = { a7k: amp(7000), a300: amp(300), meter: meterId ? audio.getRepairMeter(meterId) : 0 };
      osc1.stop();
      osc2.stop();
      node?.dispose();
      return out;
    };
    const dry = await measure(false);
    const wet = await measure(true);
    return { ready, dry, wet };
  });
  console.log("[repair] live context", JSON.stringify(result));
  expect(result.ready).toBe(true);
  expect(result.dry.a7k).toBeGreaterThan(0.3);
  expect(db(result.dry.a7k, result.wet.a7k), "live DeEss reduces the 7 kHz band").toBeGreaterThan(6);
  expect(Math.abs(db(result.wet.a300, result.dry.a300)), "the 300 Hz body is untouched").toBeLessThan(0.5);
  expect(result.wet.meter, "the gain-reduction meter reports").toBeGreaterThan(3);
});

test("Repair panel: auto-detect finds hum + clicks, applies one undo step, the exported file improves", async ({ page }, testInfo) => {
  testInfo.setTimeout(300_000);
  const wavPath = join(workDir, "dialogue-hum.wav");
  writeDialogueWav(wavPath);
  await openEditor(page);
  await importInput(page).setInputFiles(wavPath);
  await page.getByLabel("Select media dialogue-hum.wav").waitFor({ timeout: 30_000 });
  await addToLane(page, "dialogue-hum.wav", "Dialogue", 0);
  await page.evaluate(async () => {
    const st = E().project.getState();
    const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
  });
  const clipId = await clipOnLane(page, "Dialogue");

  const before = await renderMix(page, 3.8);
  console.log("[repair] mix before", JSON.stringify(before));
  expect(before.hum60, "fixture hum is audible").toBeGreaterThan(0.03);
  expect(before.peak, "fixture clicks are the peak").toBeGreaterThan(0.5);

  // Queue the "before" export now (the queue snapshots the project), start it after the repair.
  const beforeJob = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "before repair", outputName: "before-repair" }).id as string,
    { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 },
  );

  // Select the dialogue clip and open the Audio tab of the inspector.
  await clickClip(page, clipId);
  await page.getByRole("tab", { name: /^Audio$/ }).click();
  const repair = page.getByTestId("repair-section");
  await repair.waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(workDir, "repair-before.png") });

  await repair.getByTestId("repair-analyze").click();
  await expect(repair.getByTestId("repair-findings")).toBeVisible({ timeout: 60_000 });
  await expect(repair.getByTestId("repair-issue-deHum")).toHaveAttribute("data-present", "true");
  await expect(repair.getByTestId("repair-issue-deClick")).toHaveAttribute("data-present", "true");
  await expect(repair.getByTestId("repair-issue-deClip")).toHaveAttribute("data-present", "false");
  await expect(repair.getByTestId("repair-issue-deEss")).toHaveAttribute("data-present", "false");
  await expect(repair.getByTestId("spectrogram")).toHaveAttribute("data-ready", "true");

  const startHistory = await history(page);
  await repair.getByTestId("repair-apply").click();
  await expect(repair.getByTestId("repair-applied")).toBeVisible();
  expect(await history(page), "Apply is exactly one undo step").toBe(startHistory + 1);
  const effects = await page.evaluate((id) => {
    const clip = E().project.getState().project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    return clip.audioEffects.map((e: any) => ({ type: e.type, enabled: e.enabled, params: e.params }));
  }, clipId);
  console.log("[repair] applied", JSON.stringify(effects));
  expect(effects.map((e: any) => e.type).sort()).toEqual(["deClick", "deHum"]);
  expect(effects.find((e: any) => e.type === "deHum").params.frequency).toBe(60);

  // The processed spectrogram renders and differs from the source one.
  await repair.getByRole("button", { name: "With repairs" }).click();
  await expect(repair.getByRole("button", { name: "With repairs" })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(repair.getByRole("button", { name: "Rendering…" })).toHaveCount(0, { timeout: 60_000 });
  await repair.getByTestId("spectrogram").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(workDir, "repair-after.png") });
  console.log(`[repair] screenshots: ${join(workDir, "repair-before.png")} ${join(workDir, "repair-after.png")}`);

  // Layout at the real inspector width: expand an effect (presets + sliders), nothing overflows or is clipped.
  await repair.getByRole("button", { name: "Edit DeHum parameters" }).click();
  await expect(repair.getByTestId(/^repair-params-/)).toBeVisible();
  await expect(repair.getByTestId(/^repair-presets-/)).toBeVisible();
  const overflow = await repair.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const bad: string[] = [];
    node.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)) bad.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
    });
    return { scroll: node.scrollWidth - node.clientWidth, bad: bad.slice(0, 5), width: box.width };
  });
  console.log("[repair] inspector section layout", JSON.stringify(overflow));
  expect(overflow.scroll, "repair section does not scroll horizontally").toBeLessThanOrEqual(1);
  expect(overflow.bad, "no repair control sticks out of the section").toEqual([]);
  await repair.screenshot({ path: join(workDir, "repair-section-expanded.png") });
  console.log(`[repair] section screenshot: ${join(workDir, "repair-section-expanded.png")}`);

  const after = await renderMix(page, 3.8);
  console.log("[repair] mix after", JSON.stringify(after));
  expect(db(before.hum60, after.hum60), "60 Hz hum drops by >= 30 dB in the mixdown").toBeGreaterThan(30);
  expect(db(before.hum120, after.hum120), "120 Hz harmonic drops by >= 20 dB").toBeGreaterThan(20);
  expect(after.peak, "clicks removed: peak falls well below the click level").toBeLessThan(before.peak * 0.65);

  // One undo restores the original mixdown exactly; redo reapplies both repairs.
  await page.evaluate(async () => {
    await E().project.getState().undo();
  });
  await settle(page, 500);
  const undone = await renderMix(page, 3.8);
  expect(undone.hum60).toBeCloseTo(before.hum60, 6);
  expect(undone.peak).toBeCloseTo(before.peak, 6);
  await page.evaluate(async () => {
    await E().project.getState().redo();
  });
  await settle(page, 500);
  expect((await renderMix(page, 3.8)).hum60).toBeCloseTo(after.hum60, 6);

  // Real exports through the queue: before (snapshot taken pre-repair) and after.
  const afterJob = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "after repair", outputName: "after-repair" }).id as string,
    { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 },
  );
  await page.evaluate(() => E().exportQueue.getState().start());
  for (const id of [beforeJob, afterJob]) {
    await expect
      .poll(() => page.evaluate((jobId) => E().exportQueue.getState().queue.jobs.find((j: any) => j.id === jobId)?.status as string, id), {
        timeout: 180_000,
        intervals: [500],
      })
      .toMatch(/completed|failed/);
    const status = await page.evaluate((jobId) => E().exportQueue.getState().queue.jobs.find((j: any) => j.id === jobId), id);
    expect(status.status, status.error).toBe("completed");
  }
  const fetchFile = async (jobId: string, name: string): Promise<string> => {
    const panel = page.getByTestId("export-queue-panel");
    if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
    await panel.waitFor();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: `Download ${name}.mp4` }).click(),
    ]);
    const path = join(workDir, `${jobId}.mp4`);
    await download.saveAs(path);
    return path;
  };
  const beforeFile = await fetchFile(beforeJob, "before-repair");
  const afterFile = await fetchFile(afterJob, "after-repair");
  const exportedBefore = decodeAudio(beforeFile);
  const exportedAfter = decodeAudio(afterFile);
  const win: [number, number] = [Math.floor(1.0 * SR), Math.floor(3.6 * SR)]; // after the notch filters settle
  const humBefore = toneAmp(exportedBefore, 60, ...win);
  const humAfter = toneAmp(exportedAfter, 60, ...win);
  const stepBefore = maxStep(exportedBefore, ...win);
  const stepAfter = maxStep(exportedAfter, ...win);
  console.log(
    `[repair] exported file: 60 Hz ${humBefore.toFixed(4)} -> ${humAfter.toFixed(5)} (${db(humBefore, humAfter).toFixed(1)} dB), largest sample step ${stepBefore.toFixed(3)} -> ${stepAfter.toFixed(3)} (${(stepBefore / stepAfter).toFixed(1)}x)`,
  );
  expect(humBefore).toBeGreaterThan(0.03);
  expect(db(humBefore, humAfter), "exported file: hum reduced by >= 30 dB").toBeGreaterThan(30);
  expect(stepBefore, "the clicks are in the exported 'before' file").toBeGreaterThan(0.25);
  expect(stepAfter, "exported file: clicks removed (largest step falls by >= 3x)").toBeLessThan(stepBefore / 3);
  // The voiced content survives: the 140 Hz fundamental of the dialogue keeps its level (within 1.5 dB).
  const fundBefore = toneAmp(exportedBefore, 140, ...win);
  const fundAfter = toneAmp(exportedAfter, 140, ...win);
  expect(Math.abs(db(fundAfter, fundBefore))).toBeLessThan(1.5);
});

test("live playback: a clip-level DeHum removes the hum from the playing signal (AnalyserNode)", async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  const wavPath = join(workDir, "dialogue-hum-live.wav");
  writeDialogueWav(wavPath);
  await openEditor(page);
  await importInput(page).setInputFiles(wavPath);
  await page.getByLabel("Select media dialogue-hum-live.wav").waitFor({ timeout: 30_000 });
  await addToLane(page, "dialogue-hum-live.wav", "Dialogue", 0);
  await page.evaluate(async () => {
    const st = E().project.getState();
    await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Main").id, true);
  });
  const clipId = await clipOnLane(page, "Dialogue");
  await page.evaluate(() => {
    const graph = E().audio.getRealtimeAudioGraph();
    const ctx = graph.getAudioContext() as AudioContext;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32768;
    graph.getMasterGain().connect(analyser);
    (window as unknown as { __tap: AnalyserNode }).__tap = analyser;
  });
  const hum = (): Promise<number> =>
    page.evaluate(async () => {
      const analyser = (window as unknown as { __tap: AnalyserNode }).__tap;
      await new Promise((r) => setTimeout(r, 1200)); // let the 0.68 s window fill with playing audio
      const d = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(d);
      const rate = analyser.context.sampleRate;
      let re = 0;
      let im = 0;
      for (let i = 0; i < d.length; i++) {
        re += d[i] * Math.cos((2 * Math.PI * 60 * i) / rate);
        im -= d[i] * Math.sin((2 * Math.PI * 60 * i) / rate);
      }
      return (2 * Math.hypot(re, im)) / d.length;
    });
  const playFromStart = async () => {
    await page.evaluate(() => {
      const t = E().timeline?.getState?.() ?? (window as any).__openreelE2E.timeline.getState();
      t.pause();
      t.seekTo(0.1);
    });
    await settle(page, 300);
    await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().play());
  };
  await playFromStart();
  const dry = await hum();
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pause());
  console.log(`[repair] live 60 Hz before: ${dry.toFixed(4)}`);
  expect(dry, "hum is audible in live playback").toBeGreaterThan(0.02);

  await page.evaluate(async (id) => {
    await E().project.getState().addAudioEffect(id, { id: "live-hum", type: "deHum", enabled: true, params: { frequency: 60, harmonics: 4, q: 30, depth: 1 } });
  }, clipId);
  await settle(page, 400);
  await playFromStart();
  const wet = await hum();
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pause());
  console.log(`[repair] live 60 Hz after: ${wet.toFixed(5)} (${db(dry, wet).toFixed(1)} dB)`);
  expect(db(dry, wet), "live playback: hum reduced by >= 20 dB").toBeGreaterThan(20);
});

test("a stems job in the export queue produces a zip of N valid WAVs (ffprobe)", async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await openEditor(page);
  await importInput(page).setInputFiles(AUDIO_FIXTURE_PATH);
  await page.getByLabel("Select media tone-4s.wav").waitFor({ timeout: 30_000 });
  await addToLane(page, "tone-4s.wav", "Dialogue", 0);
  await addToLane(page, "tone-4s.wav", "Music", 0);
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
  await page.getByTestId("add-stem-buses").click();
  await expect.poll(() => page.evaluate(() => (E().project.getState().project.timeline.audioBuses ?? []).length)).toBe(3);
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer")); // back to the editor chrome

  await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const panel = page.getByTestId("export-queue-panel");
  await panel.waitFor();
  await panel.getByTestId("export-queue-add-stems").click();
  const form = page.getByTestId("export-queue-stems-form");
  await expect(form.getByRole("listitem")).toHaveCount(2); // FX carries no audio and is not offered
  await form.getByTestId("export-queue-add-stems-confirm").click();
  await expect(panel.getByTestId("export-queue-job")).toHaveCount(1);
  await panel.getByRole("button", { name: "Start queue" }).click();
  await expect(panel.locator('[data-testid="export-queue-job"][data-status="completed"]')).toHaveCount(1, { timeout: 180_000 });
  await expect(panel.getByTestId("export-queue-stem")).toHaveCount(2);
  await panel.screenshot({ path: join(workDir, "stems-queue.png") });
  console.log(`[stems] screenshot: ${join(workDir, "stems-queue.png")}`);

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: /^Download .*\.zip$/ }).click()]);
  const zipPath = join(workDir, download.suggestedFilename());
  await download.saveAs(zipPath);
  const outDir = join(workDir, "stems-unzipped");
  mkdirSync(outDir, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", outDir]);
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n");
  expect(listing.length).toBe(2);
  expect(listing.every((name) => name.endsWith(".wav"))).toBe(true);
  expect(execFileSync("unzip", ["-tq", zipPath], { encoding: "utf8" })).toMatch(/No errors/);
  for (const name of listing) {
    const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", join(outDir, name)], { encoding: "utf8" }));
    const audio = probe.streams.find((s: any) => s.codec_type === "audio");
    expect(audio.codec_name).toBe("pcm_s24le");
    expect(Number(audio.sample_rate)).toBe(48000);
    expect(Number(probe.format.duration)).toBeGreaterThan(5.9);
    expect(Number(probe.format.duration)).toBeLessThan(6.1);
    expect(probe.format.format_name).toBe("wav");
    // Decoded, the stems are not silent (the 330 Hz tone is in both).
    const pcm = execFileSync(FFMPEG, ["-v", "error", "-i", join(outDir, name), "-ac", "1", "-f", "f32le", "-"], { maxBuffer: 128 * 1024 * 1024 });
    const f = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    expect(peakOf(f, 0, Math.min(f.length, 4 * SR))).toBeGreaterThan(0.05);
  }
  console.log(`[stems] zip entries: ${listing.join(", ")}`);
  await expect(history(page)).resolves.toBeGreaterThan(0); // queueing is not an edit; the buses were
});

test("the Audio Mixer keeps the Master strip on screen when buses exist, and rack effects show their editors", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
  for (let i = 0; i < 6; i++) await page.getByTestId("add-bus").click();
  await expect.poll(() => page.evaluate(() => (E().project.getState().project.timeline.audioBuses ?? []).length)).toBe(6);
  const viewport = page.viewportSize()!;
  const master = await page.getByTestId("master-channel").boundingBox();
  expect(master, "master strip is rendered").not.toBeNull();
  expect(master!.x, "master strip starts on screen").toBeGreaterThanOrEqual(0);
  expect(master!.x + master!.width, "master strip ends inside the viewport").toBeLessThanOrEqual(viewport.width + 0.5);
  const row = await page.getByTestId("mixer-strips-row").boundingBox();
  expect(master!.x + master!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
  await page.getByTestId("audio-mixer").screenshot({ path: join(workDir, "mixer-master.png") });
  console.log(`[mixer] screenshot: ${join(workDir, "mixer-master.png")}`);

  // A DeEss on the master rack opens its editor with presets and a gain-reduction meter; EQ shows its curve.
  const slot = page.getByTestId("audio-rack-master");
  await slot.getByRole("button", { name: /Add effect to/ }).click();
  await page.getByRole("menuitem", { name: "DeEss" }).click();
  await expect(slot.locator('[data-effect-type="deEss"]')).toHaveCount(1);
  await slot.getByRole("button", { name: /Edit DeEss parameters/ }).click();
  const editor = page.locator('[data-testid^="repair-params-"]');
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-testid^="repair-presets-"]')).toBeVisible();
  await expect(editor.locator('[data-testid^="gr-meter-"]')).toBeVisible();
  await page.screenshot({ path: join(workDir, "rack-deess.png") });
  await page.keyboard.press("Escape");
  await slot.getByRole("button", { name: /Add effect to/ }).click();
  await page.getByRole("menuitem", { name: "Parametric EQ" }).click();
  await slot.getByRole("button", { name: /Edit Parametric EQ parameters/ }).click();
  await expect(page.getByTestId("eq-curve")).toBeVisible();
});
