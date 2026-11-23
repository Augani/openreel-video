import { expect, test, type Page } from "@playwright/test";
import { openEditor, settle } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";

/**
 * Hosted audio plugins on the MASTER bus rack, real Chrome, real offline mixdown and real RealtimeAudioGraph. The plugin host
 * is the same deterministic in-page stand-in as track-plugin-racks.spec.ts (a clipper with a gain and a keyframable parameter);
 * the real Audio Units and the real VST3 are exercised against the real helper by the Electron e2e
 * (apps/desktop/test/vst3-racks-electron.test.ts, plughost-track-racks-electron.test.ts).
 *
 *  - the master plugin processes the SUM of every track (and of the track plugins' output), before the master fader;
 *  - the master chain is rendered once for the whole mix, served to every export window, re-rendered by any audio edit;
 *  - automation is master keyframes baked into a lane in timeline seconds;
 *  - the loudness analysis that drives export normalisation measures the mix AFTER the master plugins;
 *  - the live preview (one master stem schedule + the graph's routing timeline) plays the same samples as the export;
 *  - a missing plugin / no host is bypassed (dry, sample-identical, upstream track plugins too) and reported against "Master";
 *  - the mixer's master strip opens the lazily loaded plugin panel; every edit is one undo step.
 */

interface Hook {
  project: { getState(): any };
  ui: { getState(): any };
  audio: Record<string, any>;
  routing: Record<string, any>;
  nativePlugins: Record<string, any>;
}
declare function E(): Hook;

const TONE = "Select media tone-4s.wav";
const DELAY = { id: "au:aufx:dely:appl", format: "au", name: "AUDelay", vendor: "Apple", status: "ok" };

const history = (page: Page) => page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

/** Installs the stand-in host: out = clamp(in * gain(t), +-clip), gain/clip from values "0"/"1", lane "0" overriding gain. Counts renders. */
async function installHost(page: Page, mode: "ok" | "fail" | "none" = "ok") {
  await page.evaluate((m) => {
    const w = window as unknown as { __hostCalls: Array<{ values: Record<string, number>; automation: Record<string, Array<[number, number]>>; frames: number }> };
    w.__hostCalls = [];
    if (m === "none") {
      E().nativePlugins.setBackend(undefined);
      return;
    }
    const lane = (points: Array<[number, number]>, t: number): number => {
      if (t <= points[0][0]) return points[0][1];
      if (t >= points[points.length - 1][0]) return points[points.length - 1][1];
      for (let i = 1; i < points.length; i++) if (t <= points[i][0]) return points[i - 1][1] + ((points[i][1] - points[i - 1][1]) * (t - points[i - 1][0])) / (points[i][0] - points[i - 1][0]);
      return points[points.length - 1][1];
    };
    E().nativePlugins.setBackend({
      async render(request: { values: Record<string, number>; automation: Record<string, Array<[number, number]>>; channels: Float32Array[]; sampleRate: number }) {
        w.__hostCalls.push({ values: request.values, automation: request.automation, frames: request.channels[0].length });
        if (m === "fail") throw Object.assign(new Error("helper crashed"), { name: "NativePluginRenderError" });
        const gain = request.values["0"] ?? 1;
        const clip = request.values["1"] ?? 1e9;
        const points = request.automation["0"];
        return {
          latencySamples: 0,
          channels: request.channels.map((channel) => {
            const out = new Float32Array(channel.length);
            for (let i = 0; i < channel.length; i++) {
              const g = points && points.length > 0 ? lane(points, i / request.sampleRate) : gain;
              out[i] = Math.max(-clip, Math.min(clip, channel[i] * g));
            }
            return out;
          }),
        };
      },
    });
  }, mode);
}

const hostCalls = (page: Page) => page.evaluate(() => (window as unknown as { __hostCalls: unknown[] }).__hostCalls.length);

async function mixdown(page: Page, start: number, duration: number): Promise<Float32Array> {
  const data = await page.evaluate(
    async ([s, d]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const out = await engine.renderAudio(E().project.getState().getFullProject(), s, d);
      return Array.from(out.buffer.getChannelData(0) as Float32Array);
    },
    [start, duration] as const,
  );
  return Float32Array.from(data);
}

const rms = (a: ArrayLike<number>, from = 0, to = a.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
const peak = (a: ArrayLike<number>, from = 0, to = a.length): number => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(a[i]));
  return p;
};
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = Math.min(a.length, b.length)): number => {
  let worst = 0;
  for (let i = from; i < to; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

async function addToLane(page: Page, lane: string, start: number) {
  const result = await page.evaluate(
    async ([laneName, at]) => {
      const st = E().project.getState();
      const item = st.project.mediaLibrary.items.find((m: any) => m.name === "tone-4s.wav");
      const target = st.project.timeline.tracks.find((t: any) => t.name === laneName);
      return st.addClip(target.id, item.id, at);
    },
    [lane, start] as const,
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  await settle(page, 300);
}

/** Dialogue and Music both carry the 4 s 330 Hz tone (amplitude 0.125); Main (picture + its own audio) is muted. */
async function build(page: Page) {
  await openEditor(page);
  await page.locator('input[type="file"]').first().setInputFiles(AUDIO_FIXTURE_PATH);
  await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
  await addToLane(page, "Dialogue", 0);
  await addToLane(page, "Music", 0);
  return page.evaluate(async () => {
    const st = E().project.getState();
    const tracks = st.project.timeline.tracks;
    await st.muteTrack(tracks.find((t: any) => t.name === "Main").id, true);
    const id = (name: string) => tracks.find((t: any) => t.name === name).id as string;
    return { dialogue: id("Dialogue"), music: id("Music") };
  });
}

const addPlugin = (page: Page, target: string) =>
  page.evaluate(async ([t, plugin]) => E().nativePlugins.host.addNativePluginToRack(t, plugin) as Promise<string>, [target, DELAY] as const);
const setValues = (page: Page, target: string, effectId: string, values: Record<string, number>) =>
  page.evaluate(async ([t, e, v]) => E().nativePlugins.host.updateRackNativePlugin(t, e, { values: v }), [target, effectId, values] as const);

async function addBus(page: Page, name: string): Promise<string> {
  return page.evaluate(async (busName) => {
    const st = E().project.getState();
    await st.applyAudioRouting(E().routing.planAddBus(st.project.timeline, { name: busName }));
    const buses = E().project.getState().project.timeline.audioBuses;
    return buses[buses.length - 1].id as string;
  }, name);
}
const routeTrack = (page: Page, track: string, bus: string) =>
  page.evaluate(async ([t, b]) => {
    const st = E().project.getState();
    return (await st.applyAudioRouting(E().routing.planSetTrackOutput(st.project.timeline, t, b))).success as boolean;
  }, [track, bus] as const);


const MASTER = "__master__";

test.describe("Hosted plugins on the master bus", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
    });
  });

  test("the master plugin processes the whole mix before the master fader: exact samples, one cached render, edits invalidate", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    const dry = await mixdown(page, 0, 3);
    expect(peak(dry), "two tones").toBeGreaterThan(0.17);
    expect(await hostCalls(page)).toBe(0);

    const before = await history(page);
    const effectId = await addPlugin(page, MASTER);
    await setValues(page, MASTER, effectId, { "0": 2, "1": 0.2 });
    expect(await history(page), "insert and values are one undo step each").toBe(before + 2);
    await page.evaluate(async () => E().project.getState().setAudioRack("master", { effects: [], volume: 0.5 }));

    const wet = await mixdown(page, 0, 3);
    // Plugin first (x2, clip at 0.2) then the master fader (x0.5): a fader before the plugin would clip at 0.2 instead.
    for (let i = 4800; i < wet.length - 4800; i += 997) {
      const expected = Math.max(-0.2, Math.min(0.2, dry[i] * 2)) * 0.5;
      expect(Math.abs(wet[i] - expected), `sample ${i}`).toBeLessThan(1e-5);
    }
    expect(peak(wet, 4800, wet.length - 4800), "clipped to 0.2, then halved").toBeCloseTo(0.1, 3);
    expect(await hostCalls(page), "one render for the whole mix").toBe(1);

    const window2 = await mixdown(page, 1, 1.5);
    expect(maxDiff(window2, wet.subarray(48000, 48000 + window2.length))).toBeLessThan(1e-6);
    await mixdown(page, 0, 3);
    expect(await hostCalls(page), "other windows and repeats are cache hits").toBe(1);

    await page.evaluate(async () => E().project.getState().setAudioRack("master", { effects: [], volume: 0.25 }));
    await mixdown(page, 0, 3);
    expect(await hostCalls(page), "the master fader sits after the plugin: no re-render").toBe(1);

    await setValues(page, MASTER, effectId, { "0": 3 });
    await mixdown(page, 0, 3);
    expect(await hostCalls(page), "a plugin edit re-renders").toBe(2);
    await page.evaluate(async () => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Music").id, true);
    });
    const oneTrack = await mixdown(page, 0, 3);
    expect(await hostCalls(page), "any track edit reaches the master mix").toBe(3);
    expect(peak(oneTrack, 4800, oneTrack.length - 4800), "Dialogue only: 0.0884 x3 clipped at 0.2, x0.25").toBeCloseTo(0.05, 3);

    await page.evaluate(async (e) => E().nativePlugins.host.updateRackNativePlugin("__master__", e, { enabled: false }), effectId);
    const off = await mixdown(page, 0, 3);
    const dialogueDry = off;
    expect(peak(dialogueDry, 4800, dialogueDry.length - 4800), "disabled = the dry mix through the fader").toBeCloseTo(0.0884 * 0.25, 3);
  });

  test("a track plugin runs first and the master plugin sees its output: one master render containing both", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    await page.evaluate(async () => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Music").id, true);
    });
    const trackPlugin = await addPlugin(page, ids.dialogue);
    await setValues(page, ids.dialogue, trackPlugin, { "0": 4, "1": 0.1 });
    const masterPlugin = await addPlugin(page, MASTER);
    await setValues(page, MASTER, masterPlugin, { "0": 0.5, "1": 1 });
    const mixed = await mixdown(page, 0, 3);
    // Track plugin: x4 then clip at 0.1 -> peak 0.1. Master plugin: x0.5 -> 0.05.
    expect(peak(mixed, 4800, mixed.length - 4800)).toBeCloseTo(0.05, 3);
    expect(await hostCalls(page), "one render per rack: the track's and the master's").toBe(2);
    await mixdown(page, 0.5, 2);
    expect(await hostCalls(page), "cached").toBe(2);
    const labels = await page.evaluate(() => (window as unknown as { __hostCalls: any[] }).__hostCalls.length);
    expect(labels).toBe(2);
  });

  test("automation is master keyframes baked into a lane in timeline seconds, sample-exact; one undo step per insert", async ({ page }) => {
    await build(page);
    await installHost(page);
    const dry = await mixdown(page, 0, 3);
    const effectId = await addPlugin(page, MASTER);
    const before = await history(page);
    for (const [time, value] of [[1, 1], [2.5, 0]] as const) {
      await page.evaluate(async ([e, at, v]) => E().nativePlugins.host.keyframeRackNativeParameter("__master__", e, "0", v, at), [effectId, time, value] as const);
    }
    expect(await history(page)).toBe(before + 2);
    const wet = await mixdown(page, 0, 3);
    const calls = await page.evaluate(() => (window as unknown as { __hostCalls: any[] }).__hostCalls);
    expect(calls.at(-1).automation["0"]).toEqual([[1, 1], [2.5, 0]]);
    for (let i = 0; i < wet.length; i += 611) {
      const t = i / 48000;
      const gain = t <= 1 ? 1 : t >= 2.5 ? 0 : 1 - (t - 1) / 1.5;
      expect(Math.abs(wet[i] - dry[i] * gain), `sample ${i}`).toBeLessThan(1e-5);
    }
    await page.evaluate(() => E().project.getState().undo());
    expect(await page.evaluate(() => E().project.getState().project.timeline.masterPluginRack.keyframes.length)).toBe(1);
  });

  test("loudness analysis (what export normalisation is planned from) measures the mix after the master plugins", async ({ page }) => {
    await build(page);
    await installHost(page);
    const measure = () =>
      page.evaluate(async () => {
        const hook = E();
        const engine = hook.audio.getAudioEngine();
        if (!engine.isInitialized()) await engine.initialize();
        const project = hook.project.getState().getFullProject();
        const { buffer } = await engine.renderAudio(project, 0, 3);
        const l = buffer.getChannelData(0) as Float32Array;
        let sum = 0;
        for (let i = 0; i < l.length; i++) sum += l[i] * l[i];
        return 10 * Math.log10(sum / l.length);
      });
    const dryDb = await measure();
    const effectId = await addPlugin(page, MASTER);
    await setValues(page, MASTER, effectId, { "0": 2, "1": 1e9 });
    const wetDb = await measure();
    expect(wetDb - dryDb, "x2 gain = +6.02 dB in what the normaliser measures").toBeCloseTo(6.02, 1);
  });

  test("export order: master plugins come BEFORE loudness normalisation and the true-peak limiter (the report measures the mix after them)", async ({ page }) => {
    await build(page);
    await installHost(page);
    const effectId = await addPlugin(page, MASTER);
    const run = (gain: number) =>
      page.evaluate(
        async ([e, g]) => {
          const hook = E();
          await hook.nativePlugins.host.updateRackNativePlugin("__master__", e, { values: { "0": g, "1": 1e9 } });
          const engine = hook.audio.getExportEngine();
          await engine.initialize?.();
          const gen = engine.exportAudio(hook.project.getState().getFullProject(), { format: "wav", sampleRate: 48000, bitDepth: 16, channels: 2, loudness: { enabled: true, targetLufs: -23, truePeakCeilingDb: -1 } });
          let step = await gen.next();
          while (!step.done) step = await gen.next();
          const result = step.value;
          if (!result.success) return { error: result.error?.message as string };
          const wav = new Int16Array((await result.blob.arrayBuffer()).slice(44));
          const left: number[] = [];
          for (let i = 0; i < wav.length; i += 2) left.push(wav[i] / 32768);
          const snapshot = hook.audio.measureLoudness([left, left], 48000);
          return { report: result.stats.loudness, integrated: snapshot.integrated };
        },
        [effectId, gain] as const,
      );
    const quiet = await run(1);
    const loud = await run(2);
    if ("error" in quiet || "error" in loud) throw new Error(JSON.stringify([quiet, loud]));
    expect(loud.report.measuredLufs - quiet.report.measuredLufs, "the normaliser measured the mix after the plugin (+6.02 dB)").toBeCloseTo(6.02, 1);
    expect(loud.report.gainDb - quiet.report.gainDb, "so it compensates for it").toBeCloseTo(-6.02, 1);
    expect(Math.abs(quiet.integrated - -23)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(loud.integrated - -23)).toBeLessThanOrEqual(0.5);
  });

  test("the live preview plays the same samples as the export: one master stem replaces every track", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    const trackPlugin = await addPlugin(page, ids.dialogue);
    await setValues(page, ids.dialogue, trackPlugin, { "0": 3, "1": 0.2 });
    const masterPlugin = await addPlugin(page, MASTER);
    await setValues(page, MASTER, masterPlugin, { "0": 1.5, "1": 0.25 });
    await page.evaluate(async () => E().project.getState().setAudioRack("master", { effects: [], volume: 0.8 }));
    const exported = await mixdown(page, 0, 3);

    await page.evaluate(() => E().nativePlugins.rack.preview.update(E().project.getState().project, true));
    await expect.poll(() => page.evaluate(() => E().nativePlugins.rack.previewState.getState().status), { timeout: 30_000 }).toBe("ready");
    expect(await page.evaluate(() => [...E().nativePlugins.rack.previewState.getState().stemmed])).toEqual([MASTER]);
    expect(await page.evaluate(() => E().nativePlugins.rack.preview.stemmedTrackIds(E().project.getState().project).size), "every track is replaced by the master stem").toBeGreaterThanOrEqual(2);

    const previewed: number[] = await page.evaluate(async () => {
      const hook = E();
      const project = hook.project.getState().getFullProject();
      const preview = hook.nativePlugins.rack.preview;
      const ctx = new OfflineAudioContext(2, 48000 * 3, 48000);
      const graph = new hook.audio.RealtimeAudioGraph({ getAudioContext: () => ctx, currentTime: 0, isPlaying: true } as any);
      graph.setRouting(preview.timelineFor(project.timeline));
      graph.setMasterRack(project.timeline.masterAudioRack);
      graph.scheduleClips(preview.schedulesAt(project, 0));
      const rendered = await ctx.startRendering();
      return Array.from(rendered.getChannelData(0) as Float32Array);
    });
    const stem = Float32Array.from(previewed);
    const from = 4800;
    const to = Math.min(stem.length, exported.length) - 4800;
    let ab = 0;
    let bb = 0;
    for (let i = from; i < to; i++) {
      ab += stem[i] * exported[i];
      bb += exported[i] * exported[i];
    }
    const gain = ab / bb;
    let err = 0;
    for (let i = from; i < to; i++) err += (stem[i] - gain * exported[i]) ** 2;
    const residualDb = 10 * Math.log10(err / (gain * gain * bb) + 1e-30);
    expect(Math.abs(gain - 1), "same level").toBeLessThan(1e-3);
    expect(residualDb, "preview vs export residual").toBeLessThan(-80);
    expect(peak(stem, from, to)).toBeGreaterThan(0.05);

    const rendersBefore = await hostCalls(page);
    await setValues(page, MASTER, masterPlugin, { "0": 1 });
    expect(await page.evaluate(() => E().nativePlugins.rack.preview.stemmedTrackIds(E().project.getState().project).size), "the stale stem is dropped at once").toBe(0);
    await expect.poll(() => page.evaluate(() => E().nativePlugins.rack.previewState.getState().status), { timeout: 30_000 }).toBe("ready");
    expect(await hostCalls(page)).toBeGreaterThan(rendersBefore);
  });

  test("with no plugin host the master (and the track plugins under it) are bypassed: sample-identical to dry, reported against Master, kept in the project", async ({ page }) => {
    const ids = await build(page);
    await installHost(page, "none");
    const dry = await mixdown(page, 0, 3);
    await addPlugin(page, ids.dialogue);
    const effectId = await addPlugin(page, MASTER);
    await setValues(page, MASTER, effectId, { "0": 0 });
    const bypassed = await mixdown(page, 0, 3);
    expect(maxDiff(bypassed, dry), "no host: the mix plays dry, exactly").toBe(0);
    const report: Array<[string, Array<[string, string]>]> = await page.evaluate(() =>
      [...E().audio.getAudioEngine().getPluginRackReport()].map(([id, reasons]: [string, Map<string, string>]) => [id, [...reasons]] as [string, Array<[string, string]>]),
    );
    const master = report.find(([id]) => id === MASTER);
    expect(master?.[1][0][0]).toBe(effectId);
    expect(master?.[1][0][1]).toMatch(/desktop app/);
    const missing = await page.evaluate(() => E().nativePlugins.findMissing(null));
    expect(missing.filter((m: any) => m.rackTarget === "__master__").map((m: any) => [m.rackTargetName, m.name])).toEqual([["Master", "AUDelay"]]);
    expect(await page.evaluate(() => E().project.getState().project.timeline.masterPluginRack.plugins.map((p: any) => p.params.pluginId))).toEqual([DELAY.id]);
  });

  test("a plugin that fails while rendering fails the export loudly", async ({ page }) => {
    await build(page);
    await installHost(page, "fail");
    await addPlugin(page, MASTER);
    const message = await page.evaluate(async () => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      try {
        await engine.renderAudio(E().project.getState().getFullProject(), 0, 1);
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(message).toMatch(/hosted audio plugin could not run/);
    expect(message).toMatch(/helper crashed/);
  });

  test("the master strip opens the lazily loaded plugin panel; removing the plugin is one undo step", async ({ page }) => {
    await build(page);
    await installHost(page, "none");
    await addPlugin(page, MASTER);
    await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
    await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
    const strip = page.getByTestId("rack-plugins-master");
    await expect(strip).toContainText("Plugins 1");
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await strip.click();
    const panel = page.getByTestId("rack-plugins-panel");
    await panel.waitFor({ timeout: 20_000 });
    expect(requested.some((url) => /RackPluginsPanel/.test(url)), "the panel is its own lazily loaded module").toBe(true);
    await expect(panel).toContainText("whole mix");
    await expect(panel.getByTestId("rack-plugin-name")).toHaveText("AUDelay");
    await expect(panel.getByTestId("rack-plugin-missing")).toContainText(/desktop app/);
    const before = await history(page);
    await panel.getByTestId("rack-plugin-remove").click();
    await expect.poll(() => history(page)).toBe(before + 1);
    expect(await page.evaluate(() => E().project.getState().project.timeline.masterPluginRack ?? null)).toBeNull();
  });
});
