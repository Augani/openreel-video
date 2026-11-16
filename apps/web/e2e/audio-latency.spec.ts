import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEditor, settle } from "./helpers";

/**
 * Effect latency and plugin delay compensation, measured with impulses in real
 * Chrome (OfflineAudioContext, the same engine export uses):
 *  - the latency every effect REPORTS equals the delay Chrome really adds
 *    (compressor/limiter lookahead, DeReverb/DeClick/DeClip worklets);
 *  - a clip's effect chain renders onto the input's samples;
 *  - the offline mixdown (export path) keeps a click on one sample across
 *    tracks with and without latent effects, and across buses;
 *  - the realtime graph, driven through an OfflineAudioContext, does too.
 */

const SR = 48000;
const CLICK_AT = 24000; // 0.5 s
const work = mkdtempSync(join(tmpdir(), "openreel-latency-"));

interface Hook {
  project: { getState(): any };
  audio: Record<string, any>;
}
declare function E(): Hook;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
  });
});

/** 1 s mono 48 kHz WAV with a Hann-windowed 1 kHz burst (16 samples) centred on CLICK_AT. */
function writeClickWav(path: string): void {
  const n = SR;
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
  for (let i = 0; i < 16; i++) {
    const w = Math.sin((Math.PI * (i + 0.5)) / 16) ** 2;
    pcm.writeInt16LE(Math.round(0.8 * w * 32767 * (i % 2 === 0 ? 1 : 0.9)), 44 + (CLICK_AT + i) * 2);
  }
  writeFileSync(path, pcm);
}

test("every effect reports exactly the latency Chrome adds, and the chain compensation lands on the input samples", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const result = await page.evaluate(async (sr) => {
    const { AudioRackBus, createRackEffect, ensureRepairWorklet, effectLatencySamples, getAudioEffectsEngine } = E().audio;
    const burst = (length: number) => {
      const out = new Float32Array(length);
      for (let i = 0; i < 2048; i++) out[3000 + i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr) * Math.sin((Math.PI * i) / 2048) ** 2;
      return out;
    };
    const lagOf = (a: Float32Array, b: Float32Array): number | null => {
      let best = 1e-9;
      let bestLag: number | null = null;
      for (let lag = -128; lag <= 2000; lag++) {
        let sum = 0;
        for (let i = 2900; i < 5200; i++) if (i + lag >= 0 && i + lag < b.length) sum += a[i] * b[i + lag];
        if (sum > best) {
          best = sum;
          bestLag = lag;
        }
      }
      return bestLag;
    };
    const through = async (type: string) => {
      const ctx = new OfflineAudioContext(1, 16384, sr);
      if (type.startsWith("de") || type === "gate") await ensureRepairWorklet(ctx);
      const source = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, 16384, sr);
      buffer.getChannelData(0).set(burst(16384));
      source.buffer = buffer;
      const bus = new AudioRackBus(ctx, { effects: [createRackEffect(type)] }, { live: false });
      source.connect(bus.input);
      bus.output.connect(ctx.destination);
      source.start(0);
      const out = (await ctx.startRendering()).getChannelData(0);
      return lagOf(burst(16384), out);
    };
    const rows: Array<{ type: string; reported: number; measured: number | null }> = [];
    for (const type of ["compressor", "limiter", "deReverb", "deClick", "deClip", "deEss", "deHum", "gate"]) {
      rows.push({ type, reported: effectLatencySamples(type, undefined, sr), measured: await through(type) });
    }

    // Clip effect chain (AudioEffectsEngine.applyEffectChain, the offline per-clip path).
    const engine = getAudioEffectsEngine();
    await engine.initialize();
    const ctx = new OfflineAudioContext(1, 16384, sr);
    const buffer = ctx.createBuffer(1, 16384, sr);
    buffer.getChannelData(0).set(burst(16384));
    const effects = [
      { id: "c", type: "compressor", enabled: true, params: {} },
      { id: "r", type: "deReverb", enabled: true, params: {} },
    ];
    const { buffer: processed } = await engine.applyEffectChain(buffer, effects);
    return { rows, chainLag: lagOf(burst(16384), processed.getChannelData(0)), chainLength: processed.length, reportedChain: effectLatencySamples("compressor", {}, sr) + effectLatencySamples("deReverb", {}, sr) };
  }, SR);
  console.log("[latency] effect rows", JSON.stringify(result.rows), "chain lag after compensation", result.chainLag, "of reported", result.reportedChain);
  for (const row of result.rows) {
    // Lookahead effects are exact. Zero-latency IIR effects (the DeHum notches) shift a tone burst's
    // correlation peak by at most one sample through their phase response; that is not buffering latency.
    if (row.reported > 0) expect(row.measured, `${row.type} measured`).toBe(row.reported);
    else expect(Math.abs(row.measured ?? 0), `${row.type} measured`).toBeLessThanOrEqual(1);
  }
  expect(result.rows.find((r) => r.type === "limiter")!.reported).toBeGreaterThan(0);
  expect(result.rows.find((r) => r.type === "deReverb")!.reported).toBeGreaterThan(0);
  expect(result.chainLength).toBe(16384);
  expect(result.chainLag, "chain output vs input").toBe(0);
});

async function importClick(page: Page): Promise<void> {
  mkdirSync(work, { recursive: true });
  const file = join(work, "click-48k.wav");
  writeClickWav(file);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.getByLabel("Select media click-48k.wav").waitFor({ timeout: 30_000 });
  await settle(page, 400);
}

test("offline mixdown keeps a click on one sample across tracks with different effect latency", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await importClick(page);
  const out = await page.evaluate(async ({ sr, at }) => {
    const st = E().project.getState();
    const media = st.project.mediaLibrary.items.find((m: any) => m.name === "click-48k.wav");
    const lanes = st.project.timeline.tracks;
    const main = lanes.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    const dialogue = lanes.find((t: any) => t.name === "Dialogue").id as string;
    const music = lanes.find((t: any) => t.name === "Music").id as string;
    for (const id of [dialogue, music]) {
      const r = await st.addClip(id, media.id, 0);
      if (!r.success) throw new Error(JSON.stringify(r));
    }
    const { createRackEffect, getAudioEngine, planTimelineDelayCompensation } = E().audio;
    const engine = getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const render = async () => {
      const project = E().project.getState().getFullProject();
      const audio = await engine.renderAudio(project, 0, 1);
      return Array.from(audio.buffer.getChannelData(0) as Float32Array);
    };
    const peaks = (x: number[]) => {
      const loud = Math.max(...x.map(Math.abs));
      const idx: number[] = [];
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > loud * 0.5) idx.push(i);
      return { loud, first: idx[0], last: idx[idx.length - 1], count: idx.length };
    };
    const baseline = peaks(await render());
    // Dialogue gets a compressor + limiter (2 x 6 ms); Music stays bare.
    const rack = { effects: [createRackEffect("compressor", { params: { threshold: 0 } }), createRackEffect("limiter", { params: { ceiling: 0 } })] };
    await st.setAudioRack(dialogue, rack);
    const withRack = peaks(await render());
    const plan = planTimelineDelayCompensation(E().project.getState().getFullProject().timeline, sr);
    // And a master rack on top.
    await st.setAudioRack("master", { effects: [createRackEffect("limiter", { params: { ceiling: 0 } })] });
    const withMaster = peaks(await render());
    return { baseline, withRack, withMaster, masterLatency: plan.masterLatency, at };
  }, { sr: SR, at: CLICK_AT });
  console.log("[latency] mixdown", JSON.stringify(out));
  // 16-sample burst: its first >50 % sample sits at the same index with and without latent racks, on every track.
  expect(out.baseline.first).toBeGreaterThanOrEqual(CLICK_AT);
  expect(out.baseline.first).toBeLessThanOrEqual(CLICK_AT + 4);
  expect(out.masterLatency).toBeGreaterThan(0.01);
  expect(out.withRack.first, "dialogue with compressor+limiter vs bare music").toBe(out.baseline.first);
  expect(out.withRack.last).toBe(out.baseline.last);
  expect(out.withMaster.first, "with a master limiter on top").toBe(out.baseline.first);
  expect(out.withMaster.last).toBe(out.baseline.last);
});

test("realtime graph (driven through an OfflineAudioContext) aligns parallel tracks, sends and buses", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const out = await page.evaluate(async ({ sr, at }) => {
    const { RealtimeAudioGraph, createRackEffect, ensureRepairWorklet } = E().audio;
    const run = async (setup: (graph: any) => void, expectedLatency?: (g: any) => number) => {
      const ctx = new OfflineAudioContext(2, sr, sr);
      await ensureRepairWorklet(ctx);
      const clock = { getAudioContext: () => ctx, currentTime: 0, isPlaying: true };
      (globalThis as any).window ??= globalThis;
      const graph = new RealtimeAudioGraph(clock as any);
      setup(graph);
      const clickBuffer = ctx.createBuffer(1, sr, sr);
      const data = clickBuffer.getChannelData(0);
      for (let i = 0; i < 16; i++) data[at - 24 + i] = 0.8 * Math.sin((Math.PI * (i + 0.5)) / 16) ** 2;
      for (const trackId of ["t", "u"]) {
        graph.scheduleClip({ clipId: `clip-${trackId}`, trackId, audioBuffer: clickBuffer, startTime: 0, endTime: 1, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects: [], speed: 1 });
      }
      const rendered = (await ctx.startRendering()).getChannelData(0);
      let loud = 0;
      for (let i = 0; i < rendered.length; i++) loud = Math.max(loud, Math.abs(rendered[i]));
      let first = -1;
      let last = -1;
      let count = 0;
      for (let i = 0; i < rendered.length; i++)
        if (Math.abs(rendered[i]) > loud * 0.5) {
          if (first < 0) first = i;
          last = i;
          count++;
        }
      return { first, last, count, loud, latency: graph.getPlaybackLatencySeconds() as number, expected: expectedLatency ? expectedLatency(graph) : null };
    };
    const lim = (id: string) => ({ effects: [createRackEffect("limiter", { id, params: { ceiling: 0 } })] });
    const cmp = (id: string) => ({ effects: [createRackEffect("compressor", { id, params: { threshold: 0 } })] });
    const plain = await run(() => {});
    const parallel = await run((g) => {
      g.createTrack({ trackId: "t", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
      g.createTrack({ trackId: "u", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
      g.setTrackRack("t", lim("a"));
    });
    const bus = await run((g) => {
      g.createTrack({ trackId: "t", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
      g.createTrack({ trackId: "u", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
      const track = (id: string, extra: object) => ({ id, type: "audio", name: id, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra });
      g.setRouting({
        tracks: [track("t", { output: "b1", audioRack: lim("a") }), track("u", {})],
        audioBuses: [{ id: "b1", name: "b1", muted: false, solo: false, rack: cmp("b") }],
      });
      g.setTrackRack("t", lim("a"));
      g.setBusRack("b1", cmp("b"));
    });
    return { plain, parallel, bus };
  }, { sr: SR, at: CLICK_AT });
  console.log("[latency] realtime", JSON.stringify(out));
  expect(out.parallel.latency).toBeCloseTo(0.006, 3);
  expect(out.bus.latency).toBeCloseTo(0.012, 3);
  // Without latent effects and with them the click leaves at the same samples on both tracks.
  expect(out.parallel.first, "tracks with and without a limiter").toBe(out.plain.first);
  expect(out.parallel.last).toBe(out.plain.last);
  expect(out.bus.first, "track through a limiter and a compressor bus vs a bare track").toBe(out.plain.first);
  expect(out.bus.last).toBe(out.plain.last);
});

for (const width of [1180, 1440]) {
  test(`the mixer rack shows each latent effect's latency without overflowing its slot at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    const dialogue = await page.evaluate(async () => {
      const st = E().project.getState();
      const id = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue").id as string;
      const { createRackEffect } = E().audio;
      await st.setAudioRack(id, { effects: [createRackEffect("limiter"), createRackEffect("deReverb"), createRackEffect("deHum")] });
      return id;
    });
    await page.evaluate(() => (window as unknown as { __openreelE2E: { ui: { getState(): any } } }).__openreelE2E.ui.getState().togglePanel("audioMixer"));
    await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
    // The rack header carries the summed latency (limiter 6.0 + DeReverb 21.3 ms); the slots keep their names.
    await expect(page.getByTestId(`rack-latency-${dialogue}`)).toHaveText("27 ms");
    for (const [index, name] of ["Limiter", "DeReverb", "DeHum"].entries()) {
      await expect(page.getByTestId(`rack-slot-${dialogue}-${index}`).getByRole("button", { name: /parameters on/ })).toContainText(name.slice(0, 3));
    }
    await page.getByTestId(`rack-slot-${dialogue}-0`).getByRole("button", { name: /parameters on/ }).click();
    await expect(page.getByTestId(`rack-latency-${dialogue}-0`)).toHaveText(/Latency 6\.0 ms/);
    await page.keyboard.press("Escape");
    for (const index of [0, 1, 2]) {
      const slotLocator = page.getByTestId(`rack-slot-${dialogue}-${index}`);
      const slot = await slotLocator.boundingBox();
      const label = await slotLocator.getByRole("button", { name: /parameters on/ }).boundingBox();
      expect(slot, `slot ${index}`).not.toBeNull();
      expect(label!.x + label!.width, `label ${index} inside its slot`).toBeLessThanOrEqual(slot!.x + slot!.width + 0.5);
      expect(slot!.x + slot!.width, `slot ${index} inside the viewport`).toBeLessThanOrEqual(width);
    }
    await page.getByTestId(`rack-slot-${dialogue}-0`).screenshot({ path: testInfo.outputPath(`rack-${width}.png`) });
    await page.getByTestId("audio-mixer").screenshot({ path: testInfo.outputPath(`mixer-latency-${width}.png`) });
  });
}
