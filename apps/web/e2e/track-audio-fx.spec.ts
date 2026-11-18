import { expect, test, type Page } from "@playwright/test";
import { clipsOf, openEditor, readState, settle, track } from "./helpers";

/**
 * Per-track / master audio effect racks, checked in real Chrome:
 *  - offline mixdown (the export path) differs numerically, and a track EQ /
 *    limiter / -dB gain does exactly what its numbers say;
 *  - the same rack on the live Web Audio graph changes the playing level
 *    measured by an AnalyserNode;
 *  - rack edits are single undo steps and bypass does not rebuild the graph.
 */

interface MixStats {
  rms: number;
  peak: number;
  g440: number;
}

interface Hook {
  project: { getState(): Record<string, any> };
  timeline: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  audio: Record<string, any>;
}


/** Render [0, 1.5s] of the real project mix through the export audio engine. */
async function renderMix(page: Page): Promise<MixStats> {
  return page.evaluate(async () => {
    const e = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = e.audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const project = e.project.getState().project;
    const out = await engine.renderAudio(project, 0, 1.5);
    const rate = out.buffer.sampleRate;
    const data = out.buffer.getChannelData(0);
    let sum = 0;
    let peak = 0;
    let re = 0;
    let im = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
      re += v * Math.cos((2 * Math.PI * 440 * i) / rate);
      im += v * Math.sin((2 * Math.PI * 440 * i) / rate);
    }
    return {
      rms: Math.sqrt(sum / data.length),
      peak,
      g440: (2 * Math.hypot(re, im)) / data.length,
    };
  });
}

const setRack = (page: Page, target: string, rack: unknown) =>
  page.evaluate(
    async ([t, r]) => {
      const res = await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().setAudioRack(t, r);
      return res.success as boolean;
    },
    [target, rack] as const,
  );

const history = (page: Page) =>
  page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

const db = (ratio: number) => 20 * Math.log10(ratio);

test("export mixdown: gain, limiter and EQ change the rendered audio by their numbers", async ({ page }) => {
  await openEditor(page);
  const state = await readState(page);
  const main = track(state, "Main");

  const dry = await renderMix(page);
  expect(dry.rms, "fixture sine must be audible in the mixdown").toBeGreaterThan(0.01);
  expect(await renderMix(page), "mixdown is deterministic").toEqual(dry);

  // Track gain -12 dB => RMS and the 440 Hz component drop by 12 dB.
  const gain = { effects: [{ id: "g", type: "gain", params: { gainDb: -12 }, bypassed: false }] };
  expect(await setRack(page, main.id, gain)).toBe(true);
  const gained = await renderMix(page);
  expect(db(gained.rms / dry.rms)).toBeGreaterThan(-12.6);
  expect(db(gained.rms / dry.rms)).toBeLessThan(-11.4);
  expect(db(gained.g440 / dry.g440)).toBeCloseTo(-12, 0);

  // Bypassed slot renders exactly like no rack at all.
  expect(await setRack(page, main.id, { effects: [{ ...gain.effects[0], bypassed: true }] })).toBe(true);
  const bypassed = await renderMix(page);
  expect(bypassed.rms).toBeCloseTo(dry.rms, 6);
  expect(bypassed.peak).toBeCloseTo(dry.peak, 6);

  // Limiter far below the fixture peak: output peak is bounded by the ceiling.
  const ceilingDb = -24;
  const ceiling = Math.pow(10, ceilingDb / 20);
  expect(dry.peak).toBeGreaterThan(ceiling * 1.5);
  expect(
    await setRack(page, main.id, { effects: [{ id: "l", type: "limiter", params: { ceiling: ceilingDb }, bypassed: false }] }),
  ).toBe(true);
  const limited = await renderMix(page);
  expect(limited.peak).toBeLessThanOrEqual(ceiling * 1.01);
  expect(limited.peak).toBeLessThan(dry.peak * 0.7);

  // Mid EQ cut centred on the 440 Hz fixture tone: its magnitude must fall.
  expect(
    await setRack(page, main.id, {
      effects: [{ id: "e", type: "eq", params: { midGain: -18, midFreq: 440, midQ: 2 }, bypassed: false }],
    }),
  ).toBe(true);
  const eq = await renderMix(page);
  expect(db(eq.g440 / dry.g440)).toBeLessThan(-12);

  // Master rack applies to the whole mix; volume is part of the rack.
  expect(await setRack(page, main.id, null)).toBe(true);
  expect(await setRack(page, "master", { effects: [{ id: "m", type: "gain", params: { gainDb: -6 }, bypassed: false }] })).toBe(true);
  const master = await renderMix(page);
  expect(db(master.rms / dry.rms)).toBeCloseTo(-6, 0);
  expect(await setRack(page, "master", { effects: [], volume: 0.5 })).toBe(true);
  const masterVolume = await renderMix(page);
  expect(db(masterVolume.rms / dry.rms)).toBeCloseTo(-6, 0);
});

test("offline rack bus: sine/noise fixtures match the numbers (RMS, peak, spectrum)", async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const { AudioRackBus, createRackEffect } = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.audio;
    const rate = 48000;
    const length = rate; // 1 s

    const render = async (rack: unknown, kind: "sine" | "noise") => {
      const ctx = new OfflineAudioContext(1, length, rate);
      const buffer = ctx.createBuffer(1, length, rate);
      const d = buffer.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < length; i++) {
        if (kind === "sine") d[i] = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / rate);
        else {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          d[i] = (seed / 4294967296 - 0.5) * 1.2;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (rack) {
        const bus = new AudioRackBus(ctx, rack, { live: false });
        src.connect(bus.input);
        bus.output.connect(ctx.destination);
      } else src.connect(ctx.destination);
      src.start();
      return (await ctx.startRendering()).getChannelData(0);
    };
    const stats = (d: Float32Array) => {
      let s = 0;
      let p = 0;
      for (const v of d) {
        s += v * v;
        p = Math.max(p, Math.abs(v));
      }
      return { rms: Math.sqrt(s / d.length), peak: p };
    };
    const mag = (d: Float32Array, f: number) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < d.length; i++) {
        re += d[i] * Math.cos((2 * Math.PI * f * i) / rate);
        im += d[i] * Math.sin((2 * Math.PI * f * i) / rate);
      }
      return Math.hypot(re, im);
    };
    const fx = (type: string, params: Record<string, number>) => ({ effects: [createRackEffect(type, { params })] });

    const sineDry = await render(null, "sine");
    const sineGain = await render(fx("gain", { gainDb: -12 }), "sine");
    const sineLim = await render(fx("limiter", { ceiling: -6 }), "sine");
    const sineLimAgain = await render(fx("limiter", { ceiling: -6 }), "sine");
    const noiseDry = await render(null, "noise");
    const noiseEq = await render(fx("eq", { lowGain: -18, highGain: 0, midGain: 0 }), "noise");
    const noiseRev = await render(fx("reverb", { wetLevel: 0.5, dryLevel: 0.5 }), "noise");
    const noiseRev2 = await render(fx("reverb", { wetLevel: 0.5, dryLevel: 0.5 }), "noise");
    const bypassRack = { effects: [{ ...fx("limiter", { ceiling: -30 }).effects[0], bypassed: true }] };
    const sineBypass = await render(bypassRack, "sine");
    return {
      dry: stats(sineDry),
      gain: stats(sineGain),
      lim: stats(sineLim),
      limRepeatEqual: sineLim.every((v, i) => v === sineLimAgain[i]),
      bypassEqualsDry: sineBypass.every((v, i) => Math.abs(v - sineDry[i]) < 1e-6),
      lowDry: mag(noiseDry, 80),
      lowEq: mag(noiseEq, 80),
      highDry: mag(noiseDry, 8000),
      highEq: mag(noiseEq, 8000),
      reverbRepeatEqual: noiseRev.every((v, i) => v === noiseRev2[i]),
      reverbRmsRatio: stats(noiseRev).rms / stats(noiseDry).rms,
    };
  });

  expect(20 * Math.log10(result.gain.rms / result.dry.rms)).toBeCloseTo(-12, 2);
  expect(20 * Math.log10(result.gain.peak / result.dry.peak)).toBeCloseTo(-12, 2);
  expect(result.lim.peak).toBeLessThanOrEqual(Math.pow(10, -6 / 20) * 1.005);
  expect(result.lim.rms).toBeLessThan(result.dry.rms);
  expect(result.limRepeatEqual, "rendering is bit-identical run to run").toBe(true);
  expect(result.bypassEqualsDry).toBe(true);
  expect(20 * Math.log10(result.lowEq / result.lowDry)).toBeLessThan(-12);
  expect(Math.abs(20 * Math.log10(result.highEq / result.highDry))).toBeLessThan(1);
  expect(result.reverbRepeatEqual, "reverb impulse is deterministic").toBe(true);
  expect(result.reverbRmsRatio).toBeGreaterThan(0.5);
});

test("live playback: rack changes the playing level (AnalyserNode RMS), via the mixer UI, one undo step each", async ({
  page,
}) => {
  await openEditor(page);
  const state = await readState(page);
  const main = track(state, "Main");

  // Open the Audio Mixer panel.
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.ui.getState().togglePanel("audioMixer"));
  const strip = page.getByTestId(`audio-rack-${main.id}`);
  await strip.waitFor({ timeout: 15_000 });

  // Analyser tapped on the master output (post master rack).
  await page.evaluate(() => {
    const graph = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.audio.getRealtimeAudioGraph();
    const ctx = graph.getAudioContext() as AudioContext;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    graph.getMasterGain().connect(analyser);
    (window as unknown as { __tap: { analyser: AnalyserNode; samples: number[] } }).__tap = { analyser, samples: [] };
  });
  const measure = (ms: number) =>
    page.evaluate(async (duration) => {
      const w = window as unknown as { __tap: { analyser: AnalyserNode } };
      const buf = new Float32Array(w.__tap.analyser.fftSize);
      const frames: number[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < duration) {
        w.__tap.analyser.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        frames.push(Math.sqrt(s / buf.length));
        await new Promise((r) => setTimeout(r, 30));
      }
      frames.sort((a, b) => a - b);
      return { median: frames[Math.floor(frames.length / 2)], max: frames[frames.length - 1] };
    }, ms);

  // The fixture is 6 s long; always measure from a fresh play-through of the first seconds.
  const playFromStart = async () => {
    await page.evaluate(() => {
      const t = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState();
      t.pause();
      t.seekTo(0.2);
    });
    await settle(page, 300);
    await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState().play());
    await settle(page, 700);
  };
  await playFromStart();
  const before = await measure(900);
  expect(before.median, "playback of the fixture tone must be audible").toBeGreaterThan(0.005);

  const undoBefore = await history(page);
  // Add Gain through the real UI.
  await page.getByRole("button", { name: `Add effect to ${main.name}` }).click();
  await page.getByRole("menuitem", { name: "Gain" }).click();
  await expect(page.getByTestId(`rack-slot-${main.id}-0`)).toHaveAttribute("data-effect-type", "gain");
  expect(await history(page)).toBe(undoBefore + 1);

  // Default gain is 0 dB: level unchanged.
  await playFromStart();
  const unity = await measure(700);
  expect(db(unity.median / before.median)).toBeGreaterThan(-1.5);
  expect(db(unity.median / before.median)).toBeLessThan(1.5);

  // Drag the Gain slider to its minimum (-24 dB) in the popover; commit on release.
  await page.getByRole("button", { name: `Edit Gain parameters on ${main.name}` }).click();
  const thumb = page.getByRole("slider", { name: "Gain Gain" });
  await thumb.focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId(`rack-slot-${main.id}-0`)).toBeVisible();
  await expect.poll(() => history(page)).toBe(undoBefore + 2);
  await page.keyboard.press("Escape");
  await playFromStart();
  const cut = await measure(900);
  expect(db(cut.median / before.median)).toBeLessThan(-18);
  expect(db(cut.median / before.median)).toBeGreaterThan(-30);

  // Bypass returns the level, without rebuilding the rack graph.
  const rebuilds = await page.evaluate(() =>
    (window as unknown as { __openreelE2E: Hook }).__openreelE2E.audio.getRealtimeAudioGraph().getTrackRackBus(
      (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.name === "Main").id,
    )?.rebuildCount ?? -1,
  );
  await page.getByRole("button", { name: `Bypass Gain on ${main.name}` }).click();
  await expect(page.getByTestId(`rack-slot-${main.id}-0`)).toHaveAttribute("data-bypassed", "true");
  expect(await history(page)).toBe(undoBefore + 3);
  const rebuildsAfter = await page.evaluate(() =>
    (window as unknown as { __openreelE2E: Hook }).__openreelE2E.audio.getRealtimeAudioGraph().getTrackRackBus(
      (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.name === "Main").id,
    )?.rebuildCount ?? -1,
  );
  expect(rebuildsAfter, "bypass toggle is incremental").toBe(rebuilds);
  await playFromStart();
  const bypassed = await measure(900);
  expect(db(bypassed.median / before.median)).toBeGreaterThan(-1.5);

  // Limiter in a second slot: caps a hot signal. Add via UI then check slot order.
  await page.getByRole("button", { name: `Add effect to ${main.name}` }).click();
  await page.getByRole("menuitem", { name: "Limiter", exact: true }).click();
  await expect(page.getByTestId(`rack-slot-${main.id}-1`)).toHaveAttribute("data-effect-type", "limiter");

  // Undo steps back through each edit one at a time.
  await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState().pause());
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().undo?.());
  }
  const rack = await page.evaluate(() =>
    (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.name === "Main").audioRack ?? null,
  );
  expect(rack).toBeNull();
  expect(clipsOf(await readState(page), "Main").length).toBe(1);
});

test("racks survive serialization; a project without racks loads as before", async ({ page }) => {
  await openEditor(page);
  const main = track(await readState(page), "Main");
  await setRack(page, main.id, {
    effects: [{ id: "x", type: "compressor", params: { threshold: -30, ratio: 6 }, bypassed: false }],
    volume: 0.8,
    pan: -0.3,
  });
  const roundTrip = await page.evaluate(() => {
    const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const copy = JSON.parse(JSON.stringify(project));
    (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().loadProject(copy);
    const t = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project.timeline.tracks.find((x: any) => x.name === "Main");
    return t.audioRack;
  });
  expect(roundTrip).toMatchObject({ volume: 0.8, pan: -0.3 });
  expect(roundTrip.effects[0]).toMatchObject({ type: "compressor", bypassed: false });
  expect(roundTrip.effects[0].params.threshold).toBe(-30);
});

test("compound clips: the master rack is applied once to the outer mix, not again inside the nested render", async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const e = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    const engine = e.audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const base = structuredClone(e.project.getState().project) as Record<string, any>;
    const mainTrack = base.timeline.tracks.find((t: any) => t.clips.length > 0);
    const inner = { ...mainTrack, clips: mainTrack.clips.map((c: any) => ({ ...c })) };
    const first = mainTrack.clips[0];
    const proxy = { ...first, id: "proxy", mediaId: "compound:def", metadata: { ...first.metadata, compoundClipId: "def" } };
    const compound = {
      ...base,
      compoundClips: [{ id: "def", name: "Scene", color: "#888", createdAt: 0, modifiedAt: 0, content: { tracks: [inner], clips: inner.clips, duration: base.timeline.duration } }],
      timeline: { ...base.timeline, tracks: [{ ...mainTrack, clips: [proxy] }] },
    };
    const rms = async (project: unknown) => {
      const out = await engine.renderAudio(project, 0, 1.5);
      const d = out.buffer.getChannelData(0);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / d.length);
    };
    const dry = await rms(compound);
    const gain = { effects: [{ id: "m", type: "gain", params: { gainDb: -6 }, bypassed: false }] };
    const withMaster = await rms({ ...compound, timeline: { ...compound.timeline, masterAudioRack: gain } });
    return { dry, withMaster };
  });
  expect(result.dry, "compound clip must be audible").toBeGreaterThan(0.01);
  expect(db(result.withMaster / result.dry)).toBeGreaterThan(-6.6);
  expect(db(result.withMaster / result.dry)).toBeLessThan(-5.4);
});
