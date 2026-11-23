import { expect, test, type Page } from "@playwright/test";
import { openEditor, settle } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";

/**
 * Hosted audio plugins on TRACKS and submix BUSES (the Audio Track Mixer's plugin slots), real Chrome, real offline mixdown
 * and real RealtimeAudioGraph. The plugin host itself is a deterministic in-page stand-in (a clipper with a gain and a
 * keyframable parameter) injected through the same NativePluginBackend the desktop app installs; the real Audio Units are
 * exercised against the real helper by the Electron e2e (apps/desktop/test/plughost-track-racks-electron.test.ts).
 *
 *  - a track rack plugin processes the track's mixdown BEFORE the built-in rack (order is measurable with a clipper);
 *  - a bus plugin processes the sum of what feeds the bus, and the bus's fader still applies after it;
 *  - automation is ordinary track keyframes baked into a lane in timeline seconds, sample-exact against the stand-in;
 *  - one cached render serves every export window, an edit that reaches the stem re-renders, nothing else does;
 *  - the live preview (stem schedules + the graph's routing timeline) plays the same samples as the export;
 *  - a missing plugin / no host is bypassed (dry, sample-identical) and reported, never dropped;
 *  - a plugin that fails while rendering fails the export loudly;
 *  - every edit is one undo step, and the lazy plugin panel opens from the mixer strip.
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

test.describe("Hosted plugins on tracks and buses", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
    });
  });

  test("a track plugin processes the track mixdown before its rack: exact samples, one cached render, edits invalidate", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    const dry = await mixdown(page, 0, 3);
    expect(peak(dry), "two tones (each 0.125 through the mono-to-stereo pan law = 0.0884)").toBeGreaterThan(0.17);
    expect(await hostCalls(page)).toBe(0);

    // Dialogue only (so the clipper sees one tone): the plugin clips at 0.05 after a x2 gain, then the rack fader halves it.
    await page.evaluate(async () => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Music").id, true);
    });
    const soloDry = await mixdown(page, 0, 3);
    const before = await history(page);
    const effectId = await addPlugin(page, ids.dialogue);
    expect(await history(page), "adding a plugin is one undo step").toBe(before + 1);
    await setValues(page, ids.dialogue, effectId, { "0": 2, "1": 0.05 });
    expect(await history(page)).toBe(before + 2);
    await page.evaluate(async (track) => E().project.getState().setAudioRack(track, { effects: [], volume: 0.5 }), ids.dialogue);

    const wet = await mixdown(page, 0, 3);
    expect(peak(soloDry), "the dry tone").toBeCloseTo(0.0884, 3);
    // Plugin first (x2 then clip at 0.05) and then the fader (x0.5) peaks at 0.025; a fader before the plugin would peak at 0.05.
    expect(peak(wet, 4800, wet.length - 4800)).toBeCloseTo(0.025, 3);
    for (let i = 4800; i < wet.length - 4800; i += 997) {
      const expected = Math.max(-0.05, Math.min(0.05, soloDry[i] * 2)) * 0.5;
      expect(Math.abs(wet[i] - expected), `sample ${i}`).toBeLessThan(1e-5);
    }
    expect(await hostCalls(page), "one render for the whole timeline").toBe(1);

    // Other export windows are served from the same cached stem.
    const window2 = await mixdown(page, 1, 1.5);
    expect(maxDiff(window2, wet.subarray(48000, 48000 + window2.length))).toBeLessThan(1e-6);
    await mixdown(page, 0, 3);
    expect(await hostCalls(page), "no new plugin render for another window or a repeat").toBe(1);

    // An edit of the plugin re-renders; an edit that reaches the track's signal re-renders; a fader edit does not.
    await setValues(page, ids.dialogue, effectId, { "0": 3 });
    await mixdown(page, 0, 3);
    expect(await hostCalls(page)).toBe(2);
    await page.evaluate(async (track) => E().project.getState().setAudioRack(track, { effects: [], volume: 0.25 }), ids.dialogue);
    await mixdown(page, 0, 3);
    expect(await hostCalls(page), "the fader sits after the plugin: no re-render").toBe(2);
    await page.evaluate(async () => {
      const st = E().project.getState();
      const clip = st.project.timeline.tracks.find((t: any) => t.name === "Dialogue").clips[0];
      const result = await st.executeAction({ type: "audio/setVolume", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: clip.id, volume: 0.5 } });
      if (!result.success) throw new Error(JSON.stringify(result));
    });
    await mixdown(page, 0, 3);
    expect(await hostCalls(page), "a clip volume edit reaches the stem").toBe(3);

    // Disabling the plugin returns the exact dry mix (through the cached state, no render needed).
    await page.evaluate(async ([t, e]) => E().nativePlugins.host.updateRackNativePlugin(t, e, { enabled: false }), [ids.dialogue, effectId] as const);
    const off = await mixdown(page, 0, 3);
    await page.evaluate(async (track) => E().project.getState().setAudioRack(track, null), ids.dialogue);
    expect(rms(off, 4800, off.length - 4800)).toBeGreaterThan(0.001);
  });

  test("automation is track keyframes baked into a lane; the render equals the stand-in sample for sample; one undo step per insert", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    await page.evaluate(async () => {
      const st = E().project.getState();
      await st.muteTrack(st.project.timeline.tracks.find((t: any) => t.name === "Music").id, true);
    });
    const dry = await mixdown(page, 0, 3);
    const effectId = await addPlugin(page, ids.dialogue);
    const before = await history(page);
    for (const [time, value] of [[1, 1], [2.5, 0]] as const) {
      await page.evaluate(async ([t, e, at, v]) => {
        (window as any).__openreelE2E.timeline.setState({ playheadPosition: at });
        return E().nativePlugins.host.keyframeRackNativeParameter(t, e, "0", v, at);
      }, [ids.dialogue, effectId, time, value] as const);
    }
    expect(await history(page), "each keyframe insert is one undo step").toBe(before + 2);
    const rack = await page.evaluate((t) => E().project.getState().project.timeline.tracks.find((x: any) => x.id === t).pluginRack, ids.dialogue);
    expect(rack.keyframes.map((k: any) => [k.property.endsWith(".0"), k.time, k.value])).toEqual([[true, 1, 1], [true, 2.5, 0]]);

    const wet = await mixdown(page, 0, 3);
    const calls = await page.evaluate(() => (window as unknown as { __hostCalls: any[] }).__hostCalls);
    expect(calls.at(-1).automation["0"], "the lane is in timeline seconds").toEqual([[1, 1], [2.5, 0]]);
    for (let i = 0; i < wet.length; i += 611) {
      const t = i / 48000;
      const gain = t <= 1 ? 1 : t >= 2.5 ? 0 : 1 - (t - 1) / 1.5;
      expect(Math.abs(wet[i] - dry[i] * gain), `sample ${i} (t=${t.toFixed(3)})`).toBeLessThan(1e-5);
    }
    expect(rms(wet, 57600, 62400)).toBeGreaterThan(rms(wet, 105600, 110400));
    expect(rms(wet, 124800, 139200)).toBeLessThan(1e-6);

    // Undo walks back one keyframe at a time.
    await page.evaluate(() => E().project.getState().undo());
    const afterUndo = await page.evaluate((t) => E().project.getState().project.timeline.tracks.find((x: any) => x.id === t).pluginRack.keyframes.length, ids.dialogue);
    expect(afterUndo).toBe(1);
  });

  test("a bus plugin processes the sum of what feeds it; the bus fader applies after; the feeders' own paths are not doubled", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    const bus = await addBus(page, "Submix");
    expect(await routeTrack(page, ids.dialogue, bus)).toBe(true);
    expect(await routeTrack(page, ids.music, bus)).toBe(true);
    const dry = await mixdown(page, 0, 3);
    expect(peak(dry), "dialogue + music").toBeGreaterThan(0.17);

    const effectId = await addPlugin(page, bus);
    await setValues(page, bus, effectId, { "0": 4, "1": 0.15 });
    await page.evaluate(async (b) => E().project.getState().setAudioRack(b, { effects: [], volume: 0.5 }), bus);
    const wet = await mixdown(page, 0, 3);
    for (let i = 4800; i < wet.length - 4800; i += 997) {
      const expected = Math.max(-0.15, Math.min(0.15, dry[i] * 4)) * 0.5;
      expect(Math.abs(wet[i] - expected), `sample ${i}`).toBeLessThan(1e-5);
    }
    expect(peak(wet, 4800, wet.length - 4800), "clipped to 0.15, then halved").toBeCloseTo(0.075, 3);
    expect(await hostCalls(page)).toBe(1);

    // A send from Dialogue to the bus is part of the bus input too (and the track's dry output still reaches the master once).
    const second = await addBus(page, "Parallel");
    await page.evaluate(async ([t, b]) => {
      const st = E().project.getState();
      await st.applyAudioRouting(E().routing.planAddSend(st.project.timeline, t, b, { level: 1 }));
    }, [ids.dialogue, second] as const);
    const pluginOnParallel = await addPlugin(page, second);
    await setValues(page, second, pluginOnParallel, { "0": 0 });
    const silencedSend = await mixdown(page, 0, 3);
    // The Parallel bus is silenced by its plugin (gain 0): only what the Submix bus carries remains.
    expect(maxDiff(silencedSend, wet, 4800, wet.length - 4800)).toBeLessThan(1e-5);
    // Undo restores exactly.
    for (let i = 0; i < 3; i++) await page.evaluate(() => E().project.getState().undo());
  });

  test("the live preview plays the same samples as the export, for a track and for a bus", async ({ page }) => {
    const ids = await build(page);
    await installHost(page);
    const bus = await addBus(page, "Submix");
    await routeTrack(page, ids.music, bus);
    const trackPlugin = await addPlugin(page, ids.dialogue);
    await setValues(page, ids.dialogue, trackPlugin, { "0": 3, "1": 0.2 });
    const busPlugin = await addPlugin(page, bus);
    await setValues(page, bus, busPlugin, { "0": 2, "1": 0.1 });
    const exported = await mixdown(page, 0, 3);

    // The preview service renders the stems in the background and publishes them.
    await page.evaluate(() => E().nativePlugins.rack.preview.update(E().project.getState().project, true));
    await expect.poll(() => page.evaluate(() => E().nativePlugins.rack.previewState.getState().status), { timeout: 30_000 }).toBe("ready");
    expect(await page.evaluate(() => [...E().nativePlugins.rack.previewState.getState().stemmed].sort())).toEqual([bus, ids.dialogue].sort());

    const previewed: number[] = await page.evaluate(async () => {
      const hook = E();
      const project = hook.project.getState().getFullProject();
      const preview = hook.nativePlugins.rack.preview;
      const ctx = new OfflineAudioContext(2, 48000 * 3, 48000);
      const graph = new hook.audio.RealtimeAudioGraph({ getAudioContext: () => ctx, currentTime: 0, isPlaying: true } as any);
      graph.setRouting(preview.timelineFor(project.timeline));
      graph.scheduleClips(preview.schedulesAt(project, 0));
      // The tracks without a plugin stem play their clips: render them the way the preview schedules them (tone source).
      const rendered = await ctx.startRendering();
      return Array.from(rendered.getChannelData(0) as Float32Array);
    });
    const stemOnly = Float32Array.from(previewed);
    // The stems carry everything that is plugin-processed: Dialogue (track stem) and Music's bus (bus stem). Nothing else is on the timeline.
    const from = 4800;
    const to = Math.min(stemOnly.length, exported.length) - 4800;
    let ab = 0;
    let bb = 0;
    for (let i = from; i < to; i++) {
      ab += stemOnly[i] * exported[i];
      bb += exported[i] * exported[i];
    }
    const gain = ab / bb;
    let err = 0;
    for (let i = from; i < to; i++) err += (stemOnly[i] - gain * exported[i]) ** 2;
    const residualDb = 10 * Math.log10(err / (gain * gain * bb) + 1e-30);
    expect(Math.abs(gain - 1), "same level").toBeLessThan(1e-3);
    expect(residualDb, "preview vs export residual").toBeLessThan(-80);
    expect(peak(stemOnly, from, to)).toBeGreaterThan(0.1);

    // An edit drops the stale stem at once; the edit re-renders and publishes a new one.
    const rendersBefore = await hostCalls(page);
    await setValues(page, ids.dialogue, trackPlugin, { "0": 1 });
    expect(await page.evaluate((t) => E().nativePlugins.rack.preview.stemmedTrackIds(E().project.getState().project).has(t), ids.dialogue)).toBe(false);
    await expect.poll(() => page.evaluate(() => E().nativePlugins.rack.previewState.getState().status), { timeout: 30_000 }).toBe("ready");
    expect(await hostCalls(page)).toBeGreaterThan(rendersBefore);
  });

  test("a plugin the host cannot run is bypassed and reported, sample-identical to dry; it stays in the project", async ({ page }) => {
    const ids = await build(page);
    await installHost(page, "none");
    const dry = await mixdown(page, 0, 3);
    const effectId = await addPlugin(page, ids.dialogue);
    await setValues(page, ids.dialogue, effectId, { "0": 0 });
    const bypassed = await mixdown(page, 0, 3);
    expect(maxDiff(bypassed, dry), "no host: the track plays dry, exactly").toBe(0);
    const report: Array<[string, Array<[string, string]>]> = await page.evaluate(() =>
      [...E().audio.getAudioEngine().getPluginRackReport()].map(([id, reasons]: [string, Map<string, string>]) => [id, [...reasons]] as [string, Array<[string, string]>]),
    );
    expect(report).toHaveLength(1);
    expect(report[0][0]).toBe(ids.dialogue);
    expect(report[0][1][0][0]).toBe(effectId);
    expect(report[0][1][0][1]).toMatch(/desktop app/);
    const missing = await page.evaluate(() => E().nativePlugins.findMissing(null));
    expect(missing.filter((m: any) => m.rackTarget).map((m: any) => [m.rackTargetName, m.name])).toEqual([["Dialogue", "AUDelay"]]);
    const kept = await page.evaluate((t) => E().project.getState().project.timeline.tracks.find((x: any) => x.id === t).pluginRack.plugins.map((p: any) => [p.params.pluginId, p.params.values["0"]]), ids.dialogue);
    expect(kept).toEqual([[DELAY.id, 0]]);
  });

  test("a plugin that fails while rendering fails the export loudly instead of changing the audio", async ({ page }) => {
    const ids = await build(page);
    await installHost(page, "fail");
    await addPlugin(page, ids.dialogue);
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

  test("the plugin panel opens lazily from the mixer strip and reports a plugin that cannot run", async ({ page }) => {
    const ids = await build(page);
    await installHost(page, "none");
    await addPlugin(page, ids.dialogue);
    await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
    await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
    const strip = page.getByTestId(`rack-plugins-${ids.dialogue}`);
    await expect(strip).toContainText("Plugins 1");
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await strip.click();
    const panel = page.getByTestId("rack-plugins-panel");
    await panel.waitFor({ timeout: 20_000 });
    expect(requested.some((url) => /RackPluginsPanel/.test(url)), "the panel is its own lazily loaded module").toBe(true);
    await expect(panel.getByTestId("rack-plugin-name")).toHaveText("AUDelay");
    await expect(panel.getByTestId("rack-plugin-missing")).toContainText(/desktop app/);
    // Removing it from the panel is one undo step and takes the rack away.
    const before = await history(page);
    await panel.getByTestId("rack-plugin-remove").click();
    await expect.poll(() => history(page)).toBe(before + 1);
    expect(await page.evaluate((t) => E().project.getState().project.timeline.tracks.find((x: any) => x.id === t).pluginRack ?? null, ids.dialogue)).toBeNull();
  });
});
