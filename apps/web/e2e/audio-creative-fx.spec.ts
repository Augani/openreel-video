import { expect, test, type Page } from "@playwright/test";
import { openEditor, readState, track } from "./helpers";

/**
 * Creative / utility audio effects and the compressor sidechain, checked in real Chrome:
 *  - an effect chain added to a track rack renders the same samples through the export engine as the streaming
 *    reference DSP applies to the dry mix (so preview, which runs that worklet, == export), on a short region;
 *  - the sidechain key input of the compressor attenuates the programme by the static curve when the key is present
 *    and not at all when it is absent (worklet on an OfflineAudioContext, the export path).
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

const setRack = (page: Page, target: string, rack: unknown) =>
  page.evaluate(
    async ([t, r]) => {
      const res = await E().project.getState().setAudioRack(t, r);
      return res.success as boolean;
    },
    [target, rack] as const,
  );

test("a creative effect chain on a track rack: export mixdown == the worklet's reference DSP on a short region, in one undo step", async ({ page }) => {
  await openEditor(page);
  const main = track(await readState(page), "Main");
  const start = 0.4;
  const length = 0.5;

  const render = (from = start, len = length): Promise<number[][]> =>
    page.evaluate(
      async ([from, len]) => {
        const engine = E().audio.getAudioEngine();
        if (!engine.isInitialized()) await engine.initialize();
        const out = await engine.renderAudio(E().project.getState().getFullProject(), from, len);
        return [0, 1].map((c) => Array.from(out.buffer.getChannelData(Math.min(c, out.buffer.numberOfChannels - 1))));
      },
      [from, len] as const,
    );

  // The dry mix also from 0.3 s earlier: the reference runs warm and on the same timeline positions as the export.
  const lead = 0.3;
  const dry = await render(start - lead, length + lead);
  expect(Math.max(...dry[0].map(Math.abs)), "fixture must be audible").toBeGreaterThan(0.01);
  const undoBefore = await page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

  const chain = [
    { id: "ch", type: "chorus", params: { rate: 1.2, depth: 0.6, delay: 14, feedback: 0.2, spread: 0.7, mix: 0.6 }, bypassed: false },
    { id: "ds", type: "distortion", params: { mode: 2, drive: 9, tone: 9000, level: -4, mix: 0.7 }, bypassed: false },
    { id: "sw", type: "stereoWidth", params: { width: 1.5, midGain: 1 }, bypassed: false },
  ];
  expect(await setRack(page, main.id, { effects: chain })).toBe(true);
  expect(await page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number)).toBe(undoBefore + 1);

  const wet = await render();
  const result = await page.evaluate(
    async ([dryL, dryR, wetL, wetR, fx, timelineStart, leadSeconds]) => {
      const audio = E().audio;
      const rate = 48000;
      let channels: Float32Array[] = [Float32Array.from(dryL), Float32Array.from(dryR)];
      for (const effect of fx as Array<{ type: string; params: Record<string, number> }>) {
        // The LFO of chorus / flanger / phaser follows the timeline, so the reference starts at the dry mix's timeline position.
        channels = audio.renderCreativeFx(effect.type, channels, rate, effect.params, 128, timelineStart);
      }
      const lead = Math.round((leadSeconds as number) * rate);
      let maxDiff = 0;
      let changed = 0;
      for (let i = 0; i < wetL.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(wetL[i] - channels[0][lead + i]), Math.abs(wetR[i] - channels[1][lead + i]));
        if (Math.abs(wetL[i] - dryL[lead + i]) > 1e-3) changed += 1;
      }
      return { maxDiff, changed, samples: wetL.length };
    },
    [dry[0], dry[1], wet[0], wet[1], chain, start - lead, lead] as const,
  );
  console.log("[creative-fx] export vs reference", JSON.stringify(result));
  expect(result.changed, "the rack really processes the mix").toBeGreaterThan(result.samples / 10);
  expect(result.maxDiff, "export == reference DSP").toBeLessThan(2e-4);

  // The same worklet loads into a live AudioContext and the live rack bus builds the same three slots from it.
  const live = await page.evaluate(async (fx) => {
    const audio = E().audio;
    const ctx = new AudioContext();
    try {
      const loaded = await audio.ensureCreativeFxWorklet(ctx);
      const bus = new audio.AudioRackBus(ctx, { effects: (fx as Array<{ type: string; params: Record<string, number> }>).map((e) => audio.createRackEffect(e.type, { params: e.params })) }, { live: true });
      const slots = bus.getSlotCount();
      bus.dispose();
      return { loaded, slots };
    } finally {
      await ctx.close();
    }
  }, chain);
  expect(live).toEqual({ loaded: true, slots: 3 });

  // One undo removes the whole edit.
  await page.evaluate(() => E().project.getState().undo());
  const afterUndo = await render();
  const leadFrames = Math.round(lead * 48000);
  expect(afterUndo[0].every((v, i) => Math.abs(v - dry[0][leadFrames + i]) < 1e-6)).toBe(true);
});

test("compressor sidechain: a key over the threshold ducks the programme by the static curve; no key leaves it alone", async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const audio = E().audio;
    const rate = 48000;
    const length = rate * 2;
    const programme = (ctx: OfflineAudioContext) => {
      const buffer = ctx.createBuffer(1, length, rate);
      const d = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) d[i] = 0.0316 * Math.sin((2 * Math.PI * 220 * i) / rate); // -30 dBFS
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      return src;
    };
    const keyTone = (ctx: OfflineAudioContext, freq: number, amp: number) => {
      const buffer = ctx.createBuffer(1, length, rate);
      const d = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) d[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      return src;
    };
    const amp = (d: Float32Array, f: number) => {
      let re = 0;
      let im = 0;
      const from = rate; // settled second
      for (let i = from; i < d.length; i++) {
        re += d[i] * Math.cos((2 * Math.PI * f * i) / rate);
        im += d[i] * Math.sin((2 * Math.PI * f * i) / rate);
      }
      return (2 * Math.hypot(re, im)) / (d.length - from);
    };
    const run = async (key: { freq: number; amp: number } | null, keyed: boolean, keyHpf = 20) => {
      const ctx = new OfflineAudioContext(1, length, rate);
      await audio.ensureRepairWorklet(ctx);
      const hub = new audio.SidechainKeyHub(ctx);
      const timeline = {
        tracks: [
          {
            id: "m",
            audioRack: { effects: [audio.createRackEffect("compressor", { params: { keySource: keyed ? "track:v" : undefined } })] },
          },
          { id: "v" },
        ],
      };
      hub.setTimeline(timeline);
      const effect = audio.createRackEffect("compressor", {
        params: { threshold: -20, ratio: 4, knee: 0, attack: 0.001, release: 0.05, keySource: keyed ? "track:v" : undefined, keyHpf },
      });
      const bus = new audio.AudioRackBus(ctx, { effects: [effect] }, { live: false, sidechain: { hub, ownerId: audio.trackOwnerId("m") } });
      const src = programme(ctx);
      src.connect(bus.input);
      bus.output.connect(ctx.destination);
      src.start(0);
      if (key) {
        const k = keyTone(ctx, key.freq, key.amp);
        const gain = ctx.createGain(); // stands in for the key track's post-fader output
        k.connect(gain);
        hub.publish("track:v", gain);
        // the key is audible only to the detector: it is not part of the programme path
        k.start(0);
      }
      const out = (await ctx.startRendering()).getChannelData(0);
      return { dry: amp(out, 220), out };
    };
    const reference = amp(await (async () => {
      const ctx = new OfflineAudioContext(1, length, rate);
      const src = programme(ctx);
      src.connect(ctx.destination);
      src.start(0);
      return (await ctx.startRendering()).getChannelData(0);
    })(), 220);
    const keyedLoud = await run({ freq: 1000, amp: 0.398 }, true); // -8 dBFS
    const keyedAbsent = await run(null, true);
    const keyedQuiet = await run({ freq: 1000, amp: 0.01 }, true); // -40 dBFS
    const rumbleOpen = await run({ freq: 50, amp: 0.398 }, true, 20);
    const rumbleFiltered = await run({ freq: 50, amp: 0.398 }, true, 1000);
    const db = (v: number) => 20 * Math.log10(v / reference);
    return {
      loud: db(keyedLoud.dry),
      absent: db(keyedAbsent.dry),
      quiet: db(keyedQuiet.dry),
      rumbleOpen: db(rumbleOpen.dry),
      rumbleFiltered: db(rumbleFiltered.dry),
      finite: [keyedLoud, keyedAbsent].every((r) => r.out.every((v) => Number.isFinite(v))),
    };
  });
  console.log("[creative-fx] sidechain", JSON.stringify(result));
  expect(result.finite).toBe(true);
  // 12 dB over the threshold at 4:1 is 9 dB of reduction
  expect(result.loud).toBeLessThan(-8);
  expect(result.loud).toBeGreaterThan(-9.5);
  expect(Math.abs(result.absent)).toBeLessThan(0.1);
  expect(Math.abs(result.quiet)).toBeLessThan(0.1);
  expect(result.rumbleOpen).toBeLessThan(-6);
  expect(Math.abs(result.rumbleFiltered)).toBeLessThan(1);
});
