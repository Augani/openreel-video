import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickClip, importInput, openEditor, settle } from "./helpers";
import { E2E_FFMPEG } from "./env";

/**
 * Spectral editing with the magic wand, the harmonic tool and per-channel edits, in real Chrome with real audio.
 *  - A 4 s stereo fixture: a steady 3.2 kHz tone (the wand's target) and a steady 2.5 kHz tone (the control), both in both
 *    channels, and a gliding harmonic stack (f0 300 -> 450 Hz over 1 s .. 3 s with a 5 Hz vibrato, 4 partials).
 *  - The wand is clicked on the 3.2 kHz line with real pointer input, set to the Left channel, and removed.
 *    The harmonic tool is clicked on the stack's fundamental, set to 4 harmonics, and removed.
 *  - The region list changes the wand's channel (one undo step each); every edit is one undo step.
 *  - The export mixdown, the live preview path (RealtimeAudioGraph) and a real export decoded with ffmpeg agree, per channel.
 *  - Undo restores the original mixdown exactly; save / reload (JSON) keeps the stored cells and the stored track.
 */

const FFMPEG = E2E_FFMPEG;
const workDir = mkdtempSync(join(tmpdir(), "openreel-spectral-wand-"));
const SR = 48000;
const SECONDS = 4;
const STACK = { from: 1, to: 3, partials: 4, amplitude: 0.12 };
const A_HZ = 3200;
const B_HZ = 2500;
/** The stack's true fundamental (Hz): an exponential glide with a 5 Hz, +-30 cent vibrato. */
const f0At = (t: number): number => 300 * Math.pow(1.5, (t - STACK.from) / (STACK.to - STACK.from)) * Math.pow(2, (30 * Math.sin(2 * Math.PI * 5 * t)) / 1200);

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

/** Phase of the stack's fundamental at every sample (integrated, so the vibrato is exact). */
const phases = (() => {
  const out = new Float64Array(SR * SECONDS);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * f0At(i / SR)) / SR;
    out[i] = phase;
  }
  return out;
})();
const stackSample = (i: number, h: number): number => {
  const t = i / SR;
  if (t < STACK.from || t >= STACK.to) return 0;
  const u = (t - STACK.from) / (STACK.to - STACK.from);
  return Math.min(1, u * 20, (1 - u) * 20) * Math.sin(h * phases[i] + 0.3 * h);
};

function writeFixtureWav(path: string): void {
  const n = SR * SECONDS;
  const pcm = Buffer.alloc(44 + n * 4);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 4, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 4, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let x = 0.15 * Math.sin(2 * Math.PI * A_HZ * t) + 0.15 * Math.sin(2 * Math.PI * B_HZ * t + 1);
    for (let h = 1; h <= STACK.partials; h++) x += (STACK.amplitude / h) * stackSample(i, h);
    const v = Math.round(x * 32767);
    pcm.writeInt16LE(v, 44 + i * 4);
    pcm.writeInt16LE(v, 44 + i * 4 + 2);
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
/** Amplitude of partial h of the stack in x over [from, to): the projection on the fixture's own partial. */
const partialAmp = (x: ArrayLike<number>, h: number, from: number, to: number): number => {
  let xr = 0;
  let rr = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) {
    const r = stackSample(i, h);
    xr += x[i] * r;
    rr += r * r;
  }
  return xr / rr;
};
const db = (a: number, b: number) => 20 * Math.log10(a / b);

/** Both channels of a file, decoded with ffmpeg. */
function decodeStereo(file: string): [Float32Array, Float32Array] {
  const buf = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vn", "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  const all = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const left = new Float32Array(all.length / 2);
  const right = new Float32Array(all.length / 2);
  for (let i = 0; i < left.length; i++) {
    left[i] = all[2 * i];
    right[i] = all[2 * i + 1];
  }
  return [left, right];
}

const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getDisplayHistory().length as number);

async function renderMix(page: Page, seconds: number): Promise<[number[], number[]]> {
  return page.evaluate(async (len) => {
    const engine = E().audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(E().project.getState().getFullProject(), 0, len);
    return [Array.from(out.buffer.getChannelData(0) as Float32Array), Array.from(out.buffer.getChannelData(1) as Float32Array)] as [number[], number[]];
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

test("magic wand, harmonic tool and per-channel edits: export, preview and a real export agree; list edits and undo", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  const wavPath = join(workDir, "tones-and-stack.wav");
  writeFixtureWav(wavPath);
  await openEditor(page);
  await importInput(page).setInputFiles(wavPath);
  await page.getByLabel("Select media tones-and-stack.wav").waitFor({ timeout: 30_000 });
  const added = await page.evaluate(async () => {
    const st = E().project.getState();
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "tones-and-stack.wav");
    const target = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue");
    const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    return st.addClip(target.id, item.id, 0);
  });
  expect(added.success, JSON.stringify(added)).toBe(true);
  await settle(page, 400);
  const clipId = await page.evaluate(() => E().project.getState().project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0].id as string);

  const measure = (mix: [number[], number[]]) => ({
    aL: toneAmp(mix[0], A_HZ, 1.2, 2.8),
    aR: toneAmp(mix[1], A_HZ, 1.2, 2.8),
    bL: toneAmp(mix[0], B_HZ, 1.2, 2.8),
    bR: toneAmp(mix[1], B_HZ, 1.2, 2.8),
    p1L: Math.abs(partialAmp(mix[0], 1, 1.2, 2.8)),
    p1R: Math.abs(partialAmp(mix[1], 1, 1.2, 2.8)),
    p3L: Math.abs(partialAmp(mix[0], 3, 1.2, 2.8)),
  });
  const before = measure(await renderMix(page, 3.9));
  console.log("[wand] mix before", JSON.stringify(before));
  expect(before.aL, "3.2 kHz tone is audible").toBeGreaterThan(0.1);
  expect(before.p1L, "the stack is audible").toBeGreaterThan(0.08);

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
  await editor.screenshot({ path: join(workDir, "wand-before.png") });

  // 1) Magic wand: one real click on the 3.2 kHz line, Left channel only, Remove.
  const start = await history(page);
  await editor.getByTestId("spectral-tool-wand").click();
  await expect(editor.getByTestId("spectral-wand-tolerance")).toBeVisible();
  let stage = await readStage(page);
  await page.mouse.click(px(stage, 2.0), py(stage, A_HZ));
  await expect(editor.getByTestId("spectral-selection")).toBeVisible({ timeout: 30_000 });
  await expect(editor.getByTestId("spectral-readout")).toContainText("Wand");
  await expect(editor.getByTestId("spectral-analysing")).toHaveCount(0);
  await editor.getByTestId("spectral-channel").selectOption("left");
  await editor.screenshot({ path: join(workDir, "wand-selection.png") });
  await editor.getByTestId("spectral-remove").click();
  await expect(editor.getByTestId("spectral-region-row")).toHaveCount(1, { timeout: 15_000 });
  expect(await history(page), "Remove is one undo step").toBe(start + 1);
  let stored = await storedRegions(page, clipId);
  expect(stored.version, "a wand region marks the effect as version 3").toBe(3);
  expect(stored.regions[0]).toMatchObject({ shape: "wand", mode: "remove", channel: "left" });
  expect(stored.regions[0].wand.runs.length).toBeGreaterThan(1);
  expect(stored.regions[0].wand.seed.hz).toBeGreaterThan(A_HZ * 0.97);
  expect(stored.regions[0].wand.seed.hz).toBeLessThan(A_HZ * 1.03);
  expect(stored.regions[0].startTime, "the selection follows the steady tone from the start").toBeLessThan(0.3);
  expect(stored.regions[0].endTime).toBeGreaterThan(3.7);
  expect(stored.regions[0].lowHz).toBeLessThan(A_HZ);
  expect(stored.regions[0].highHz).toBeGreaterThan(A_HZ);
  expect(stored.regions[0].highHz - stored.regions[0].lowHz, "a thin line, not the whole spectrum").toBeLessThan(400);
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 90_000 });

  // 2) Harmonic: set 4 harmonics, one real click on the fundamental at 2 s, Remove (both channels).
  await editor.getByTestId("spectral-tool-harmonic").click();
  await editor.getByTestId("spectral-channel").selectOption("both");
  await editor.getByTestId("spectral-harmonics").fill("4");
  stage = await readStage(page);
  await page.mouse.click(px(stage, 2.0), py(stage, f0At(2.0)));
  await expect(editor.getByTestId("spectral-selection")).toBeVisible({ timeout: 60_000 });
  await expect(editor.getByTestId("spectral-readout")).toContainText("Harmonic");
  await expect(editor.getByTestId("spectral-analysing")).toHaveCount(0);
  await editor.screenshot({ path: join(workDir, "harmonic-selection.png") });
  await editor.getByTestId("spectral-remove").click();
  await expect(editor.getByTestId("spectral-region-row")).toHaveCount(2, { timeout: 15_000 });
  expect(await history(page)).toBe(start + 2);
  stored = await storedRegions(page, clipId);
  const harmonic = stored.regions[1];
  expect(harmonic).toMatchObject({ shape: "harmonic", mode: "remove", harmonic: { harmonics: 4, bandCents: 50 } });
  expect(harmonic.channel).toBeUndefined();
  const errors = (harmonic.points as Array<{ t: number; hz: number }>).filter((p) => p.t >= STACK.from + 0.15 && p.t <= STACK.to - 0.15).map((p) => Math.abs(1200 * Math.log2(p.hz / f0At(p.t)))).sort((a, b) => a - b);
  console.log(`[wand] harmonic track: ${harmonic.points.length} points, ${harmonic.startTime.toFixed(3)}-${harmonic.endTime.toFixed(3)} s, f0 error median ${errors[errors.length >> 1].toFixed(2)} c, max ${errors[errors.length - 1].toFixed(2)} c`);
  expect(errors[errors.length >> 1], "tracked f0 within 10 cents (median)").toBeLessThan(10);
  expect(errors[errors.length - 1], "tracked f0 within 40 cents everywhere inside the sound").toBeLessThan(40);
  expect(Math.abs(harmonic.startTime - STACK.from)).toBeLessThan(0.12);
  expect(Math.abs(harmonic.endTime - STACK.to)).toBeLessThan(0.12);
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 90_000 });
  await page.waitForTimeout(500);
  await editor.screenshot({ path: join(workDir, "wand-harmonic-after.png") });

  // 3) The mixdown now: left loses the 3.2 kHz tone, right keeps it; both channels lose the stack; the 2.5 kHz control is untouched.
  const mixLeft = measure(await renderMix(page, 3.9));
  console.log("[wand] mix after wand(left) + harmonic", JSON.stringify(mixLeft), "A left", db(before.aL, mixLeft.aL).toFixed(1), "dB down, A right", db(before.aR, mixLeft.aR).toFixed(2), "dB, stack partial 1", db(before.p1L, mixLeft.p1L).toFixed(1), "dB down, partial 3", db(before.p3L, mixLeft.p3L).toFixed(1), "dB down");
  expect(db(before.aL, mixLeft.aL), "left 3.2 kHz down >= 20 dB").toBeGreaterThan(20);
  expect(Math.abs(db(mixLeft.aR, before.aR)), "right 3.2 kHz untouched (< 0.3 dB)").toBeLessThan(0.3);
  expect(db(before.p1L, mixLeft.p1L), "stack fundamental down >= 15 dB (left)").toBeGreaterThan(15);
  expect(db(before.p1R, mixLeft.p1R), "stack fundamental down >= 15 dB (right)").toBeGreaterThan(15);
  expect(db(before.p3L, mixLeft.p3L), "stack 3rd partial down >= 15 dB").toBeGreaterThan(15);
  expect(Math.abs(db(mixLeft.bL, before.bL)), "2.5 kHz control untouched (L)").toBeLessThan(0.3);
  expect(Math.abs(db(mixLeft.bR, before.bR)), "2.5 kHz control untouched (R)").toBeLessThan(0.3);

  // 4) The region list: select the wand, hide / show it, and move its channel to Right: one undo step each.
  const rows = editor.getByTestId("spectral-region-row");
  let steps = await history(page);
  await expect(rows.nth(0).getByTestId("spectral-region-channel")).toHaveValue("left");
  await rows.nth(0).getByTestId("spectral-region-select").click();
  await expect(rows.nth(0)).toHaveAttribute("data-selected", "true");
  await expect(editor.getByTestId(`spectral-region-${stored.regions[0].id}`)).toHaveAttribute("data-shape", "wand");
  await expect(editor.getByTestId(`spectral-region-${harmonic.id}`)).toHaveAttribute("data-shape", "harmonic");
  await rows.nth(0).getByTestId("spectral-region-enabled").click();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[0].enabled).toBe(false);
  await rows.nth(0).getByTestId("spectral-region-enabled").click();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[0].enabled).toBe(true);
  expect(await history(page)).toBe(steps + 2);
  await rows.nth(0).getByTestId("spectral-region-channel").selectOption("right");
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[0].channel).toBe("right");
  expect(await history(page), "changing the channel is one undo step").toBe(steps + 3);
  // The harmonic row: change the number of harmonics (one step) and the bandwidth (one step).
  await rows.nth(1).getByTestId("spectral-region-harmonics").fill("3");
  await rows.nth(1).getByTestId("spectral-region-harmonics").blur();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].harmonic.harmonics).toBe(3);
  await rows.nth(1).getByTestId("spectral-region-cents").fill("80");
  await rows.nth(1).getByTestId("spectral-region-cents").blur();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].harmonic.bandCents).toBe(80);
  expect(await history(page)).toBe(steps + 5);
  await rows.nth(1).getByTestId("spectral-region-harmonics").fill("4");
  await rows.nth(1).getByTestId("spectral-region-harmonics").blur();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].harmonic.harmonics).toBe(4);
  await rows.nth(1).getByTestId("spectral-region-cents").fill("50");
  await rows.nth(1).getByTestId("spectral-region-cents").blur();
  await expect.poll(async () => (await storedRegions(page, clipId)).regions[1].harmonic.bandCents).toBe(50);
  await expect(editor.getByTestId("spectral-canvas")).toHaveAttribute("data-ready", "true", { timeout: 90_000 });

  const after = await renderMix(page, 3.9);
  const mixRight = measure(after);
  console.log("[wand] mix with the wand on Right", JSON.stringify(mixRight));
  expect(db(before.aR, mixRight.aR), "right 3.2 kHz down >= 20 dB").toBeGreaterThan(20);
  expect(Math.abs(db(mixRight.aL, before.aL)), "left 3.2 kHz back to untouched (< 0.3 dB)").toBeLessThan(0.3);
  expect(db(before.p1L, mixRight.p1L)).toBeGreaterThan(15);

  // 5) The live-preview path plays the SAME samples as the export, per channel.
  const parity = await page.evaluate(
    async ({ id, exported }) => {
      const { RealtimeAudioGraph } = E().audio;
      const st = E().project.getState();
      const clip = st.project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      const media = st.project.mediaLibrary.items.find((m: any) => m.id === clip.mediaId);
      const decodeCtx = new OfflineAudioContext(2, 1, 48000);
      const source: AudioBuffer = await decodeCtx.decodeAudioData(await media.blob.arrayBuffer());
      const prepared = await new RealtimeAudioGraph({ getAudioContext: () => decodeCtx, currentTime: 0, isPlaying: true } as any).prepareSpectralRepair(source, clip.audioEffects);
      const result: Array<{ gain: number; residualDb: number }> = [];
      for (let c = 0; c < 2; c++) {
        const played = prepared.buffer.getChannelData(c) as Float32Array;
        const reference = (exported as number[][])[c];
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
        result.push({ gain, residualDb: 10 * Math.log10(residual / (gain * gain * bb)) });
      }
      return { result, appliedKey: prepared.key.length > 0 };
    },
    { id: clipId, exported: after },
  );
  console.log("[wand] preview vs export", JSON.stringify(parity));
  expect(parity.appliedKey).toBe(true);
  for (const channel of parity.result) expect(channel.residualDb, "preview and export samples agree (residual below -60 dB)").toBeLessThan(-60);

  // Real playback: the master bus carries the edited audio (the repair is computed on the first play).
  await page.evaluate(() => {
    const graph = E().audio.getRealtimeAudioGraph();
    const analyser = (graph.getAudioContext() as AudioContext).createAnalyser();
    analyser.fftSize = 16384;
    graph.getMasterGain().connect(analyser);
    (window as unknown as { __tap: AnalyserNode }).__tap = analyser;
  });
  await page.evaluate(() => {
    const tl = (window as any).__openreelE2E.timeline.getState();
    tl.pause();
    tl.seekTo(0.4);
  });
  await settle(page, 300);
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().play());
  await page.waitForTimeout(2000);
  const live = await page.evaluate(
    async ({ hz }) => {
      const analyser = (window as unknown as { __tap: AnalyserNode }).__tap;
      await new Promise((r) => setTimeout(r, 300));
      const d = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(d);
      const rate = analyser.context.sampleRate;
      const amp = (f: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < d.length; i++) {
          re += d[i] * Math.cos((2 * Math.PI * f * i) / rate);
          im -= d[i] * Math.sin((2 * Math.PI * f * i) / rate);
        }
        return (2 * Math.hypot(re, im)) / d.length;
      };
      return { a: amp(hz.a), b: amp(hz.b) };
    },
    { hz: { a: A_HZ, b: B_HZ } },
  );
  await page.evaluate(() => (window as any).__openreelE2E.timeline.getState().pause());
  // The master bus is the stereo sum: with the wand on the right channel one channel keeps the 3.2 kHz tone, so it falls by about 6 dB (half the amplitude).
  console.log(`[wand] live playback 3.2 kHz ${live.a.toFixed(5)} against 2.5 kHz ${live.b.toFixed(5)}`);
  expect(live.b, "live playback is audible (the 2.5 kHz control is playing)").toBeGreaterThan(0.05);
  expect(db(live.b, live.a), "live playback: 3.2 kHz at least 4 dB under the control with one channel edited").toBeGreaterThan(4);

  // Save / reload: the project serialises with the stored cells and the stored track intact.
  const reloaded = await page.evaluate((id) => {
    const project = JSON.parse(JSON.stringify(E().project.getState().getFullProject()));
    const clip = project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    return clip.audioEffects.find((e: any) => e.type === "spectralRepair").params;
  }, clipId);
  stored = await storedRegions(page, clipId);
  expect(reloaded.regions).toEqual(stored.regions);
  expect(reloaded.version).toBe(3);

  // Undo every edit: the original mixdown is back exactly; redo brings the edits back.
  await page.evaluate(async (target) => {
    const st = E().project.getState();
    while (st.actionExecutor.getHistory().getDisplayHistory().length > target) await E().project.getState().undo();
  }, start);
  await settle(page, 500);
  expect(await history(page)).toBe(start);
  const undone = measure(await renderMix(page, 3.9));
  expect(undone.aL).toBeCloseTo(before.aL, 6);
  expect(undone.aR).toBeCloseTo(before.aR, 6);
  expect(undone.p1L).toBeCloseTo(before.p1L, 6);
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await E().project.getState().redo();
  }, 9);
  await settle(page, 600);
  expect(db(before.aR, measure(await renderMix(page, 3.9)).aR)).toBeGreaterThan(20);

  await editor.getByTestId("spectral-expand").click();
  await expect(editor).toHaveAttribute("data-expanded", "false");

  // Real export through the queue, decoded with ffmpeg: the right channel lost the 3.2 kHz tone, the left kept it, both lost the stack.
  const job = await page.evaluate(
    (settings) => E().exportQueue.getState().enqueue({ settings, presetLabel: "spectral wand", outputName: "spectral-wand" }).id as string,
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
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download spectral-wand.mp4" }).click()]);
  const file = join(workDir, "spectral-wand.mp4");
  await download.saveAs(file);
  const [left, right] = decodeStereo(file);
  const exported = { aL: toneAmp(left, A_HZ, 1.2, 2.8), aR: toneAmp(right, A_HZ, 1.2, 2.8), bL: toneAmp(left, B_HZ, 1.2, 2.8), bR: toneAmp(right, B_HZ, 1.2, 2.8), p1L: Math.abs(partialAmp(left, 1, 1.2, 2.8)), p3R: Math.abs(partialAmp(right, 3, 1.2, 2.8)) };
  console.log("[wand] exported file", JSON.stringify(exported));
  expect(db(exported.aL, exported.aR), "exported file: right 3.2 kHz at least 15 dB under the left").toBeGreaterThan(15);
  expect(db(exported.bR, exported.aR), "exported file: right 3.2 kHz at least 15 dB under the control").toBeGreaterThan(15);
  expect(db(exported.bL, exported.p1L), "exported file: the stack fundamental at least 15 dB under the control (left)").toBeGreaterThan(15);
  expect(db(exported.bR, exported.p3R), "exported file: the stack's 3rd partial at least 15 dB under the control (right)").toBeGreaterThan(15);
  console.log(`[wand] screenshots in ${workDir}`);
});
