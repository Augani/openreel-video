import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipLocator, clipsOf, openEditor, readState, settle, setZoom, splitIntoThree, clickClip } from "./helpers";
import { AUDIO_FIXTURE_PATH } from "./global-setup";
import { E2E_FFPROBE } from "./env";

/**
 * Audio buses, sends and submix routing (Audio Track Mixer), real Chrome:
 *  - dialogue + music tracks routed to two buses through the mixer UI; a gain
 *    on one bus moves the measured mix level by exactly that many dB (offline
 *    mixdown and per-bus loudness), default routing is sample-identical;
 *  - pre/post-fader sends and send-level automation are audible in the mixdown;
 *  - the mixdown cache invalidates on routing/send changes;
 *  - stems export writes N valid WAVs (ffprobe) that re-sum to the master mix;
 *  - every routing edit is one undo step and undoes exactly; autosave + reload
 *    persists buses, outputs and sends;
 *  - the mixer works inside an opened nest and the parent mix honours it.
 */

const FFPROBE = E2E_FFPROBE;
const TONE = "Select media tone-4s.wav";

interface Hook {
  project: { getState(): any };
  ui: { getState(): any };
  audio: Record<string, any>;
  mixdownCache: { getStats(): { hits: number; misses: number } };
  stems: Record<string, any>;
  loudness: unknown;
  analyzeTimelineLoudness: (o?: unknown) => Promise<any>;
}
/** Browser-side handle (installed by beforeEach); only called inside page.evaluate callbacks. */
declare function E(): Hook;

const history = (page: Page) =>
  page.evaluate(() => E().project.getState().actionExecutor.getHistory().getUndoStackSize() as number);

/** Routing-relevant slice of the active timeline, as plain JSON. */
const routing = (page: Page) =>
  page.evaluate(() => {
    const t = E().project.getState().project.timeline;
    // Key order is irrelevant to "exact": compare canonical JSON.
    const canon = (v: any): any =>
      Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    return JSON.stringify(canon({
      buses: t.audioBuses ?? null,
      tracks: t.tracks.map((x: any) => [x.id, x.output ?? null, x.sends ?? null, x.audioRack ?? null]),
    }));
  });

/** RMS of the offline mixdown over [start, start+duration] through the export audio engine. */
async function rms(page: Page, start: number, duration: number): Promise<number> {
  return page.evaluate(
    async ([s, d]) => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const project = E().project.getState().getFullProject();
      const out = await engine.renderAudio(project, s, d);
      const left = out.buffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += left[i] * left[i];
      return Math.sqrt(sum / left.length);
    },
    [start, duration] as const,
  );
}

const db = (ratio: number) => 20 * Math.log10(ratio);

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

/** Dialogue + Music lanes both carry the 4 s 330 Hz tone; Main (picture + its own audio) is muted. */
async function buildDialogueAndMusic(page: Page) {
  await openEditor(page);
  await page.locator('input[type="file"]').first().setInputFiles(AUDIO_FIXTURE_PATH);
  await page.getByLabel(TONE).waitFor({ timeout: 30_000 });
  await addToLane(page, "tone-4s.wav", "Dialogue", 0);
  await addToLane(page, "tone-4s.wav", "Music", 0);
  const ids = await page.evaluate(async () => {
    const st = E().project.getState();
    const tracks = st.project.timeline.tracks;
    const main = tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    const id = (name: string) => tracks.find((t: any) => t.name === name).id as string;
    return { main: main.id as string, dialogue: id("Dialogue"), music: id("Music") };
  });
  return ids;
}

const openMixer = async (page: Page) => {
  await page.evaluate(() => E().ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
};

const pickOutput = async (page: Page, trackTestId: string, busName: string) => {
  await page.getByTestId(trackTestId).click();
  await page.getByRole("option", { name: busName, exact: true }).click();
};

const busIds = (page: Page) =>
  page.evaluate(() => (E().project.getState().project.timeline.audioBuses ?? []).map((b: any) => [b.id, b.name]) as [string, string][]);

const lufs = (page: Page, busId: string) =>
  page.evaluate(async (id) => (await E().stems.analyzeBusLoudnessNow(id)).integrated as number, busId);

test.describe("Audio buses, sends and submix routing", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { E: () => unknown }).E = () => (window as unknown as { __openreelE2E: unknown }).__openreelE2E;
    });
  });

  test("two buses via the mixer UI: a gain on one bus moves the measured level by its dB; one undo step per edit, exact", async ({ page }) => {
    const ids = await buildDialogueAndMusic(page);
    const base = await rms(page, 0, 3);
    expect(base, "both tones are audible").toBeGreaterThan(0.01);
    await openMixer(page);

    const steps: string[] = [await routing(page)];
    const startDepth = await history(page);
    const step = async (action: () => Promise<void>) => {
      const before = await history(page);
      await action();
      await expect.poll(() => history(page)).toBe(before + 1);
      steps.push(await routing(page));
    };

    // Add two buses and name them.
    await step(() => page.getByTestId("add-bus").click());
    await step(() => page.getByTestId("add-bus").click());
    const buses = await busIds(page);
    expect(buses).toHaveLength(2);
    const [dlg, mus] = buses;
    await step(async () => {
      await page.getByTestId(`bus-name-${dlg[0]}`).fill("Dialogue Bus");
      await page.getByTestId(`bus-name-${dlg[0]}`).press("Enter");
    });
    await step(async () => {
      await page.getByTestId(`bus-name-${mus[0]}`).fill("Music Bus");
      await page.getByTestId(`bus-name-${mus[0]}`).press("Enter");
    });

    // Route Dialogue -> Dialogue Bus, Music -> Music Bus. The track header shows it.
    await step(() => pickOutput(page, `track-output-${ids.dialogue}`, "Dialogue Bus"));
    await step(() => pickOutput(page, `track-output-${ids.music}`, "Music Bus"));
    await expect(page.getByTestId(`track-output-badge-${ids.dialogue}`)).toContainText("Dialogue Bus");
    await expect(page.getByTestId(`track-output-badge-${ids.music}`)).toContainText("Music Bus");

    // Unity buses leave the mix unchanged (float-exact sums of the same signals).
    const routed = await rms(page, 0, 3);
    expect(Math.abs(routed - base) / base).toBeLessThan(1e-6);

    // -12 dB on the Music bus (gain effect in its rack).
    const gain = { effects: [{ id: "g", type: "gain", params: { gainDb: -12 }, bypassed: false }] };
    await step(async () => {
      await page.evaluate(([id, rack]) => E().project.getState().setAudioRack(id, rack), [mus[0], gain] as const);
    });
    const lowered = await rms(page, 0, 3);
    const g = 10 ** (-12 / 20);
    // Identical tones: (1 + g) / 2 of the unity mix.
    expect(db(lowered / base)).toBeCloseTo(db((1 + g) / 2), 1);
    // Per-bus loudness differs by exactly the gain.
    const l1 = await lufs(page, dlg[0]);
    const l2 = await lufs(page, mus[0]);
    expect(l1 - l2).toBeGreaterThan(11.7);
    expect(l1 - l2).toBeLessThan(12.3);

    // Fader on the bus through the UI-visible model (volume 0.5 = -6.02 dB) and bus mute.
    await step(async () => {
      await page.evaluate((id) => E().project.getState().setAudioRack(id, { effects: [], volume: 0.5 }), dlg[0]);
    });
    await step(() => page.getByTestId(`bus-mute-${dlg[0]}`).click());
    const muted = await rms(page, 0, 3);
    // Only the (-12 dB) Music bus is left: g of one tone, i.e. g/2 of the unity mix.
    expect(db(muted / base)).toBeCloseTo(db(g / 2), 1);
    await step(() => page.getByTestId(`bus-mute-${dlg[0]}`).click());
    await step(() => page.getByTestId(`bus-solo-${mus[0]}`).click());
    const soloed = await rms(page, 0, 3);
    expect(db(soloed / base)).toBeCloseTo(db(g / 2), 1);
    await step(() => page.getByTestId(`bus-solo-${mus[0]}`).click());

    // A routing loop is refused with a clear message and does not touch history.
    const depth = await history(page);
    const loop = await page.evaluate(
      async ([a, b]) => {
        const st = E().project.getState();
        const r = (E() as any).routing;
        const first = await st.applyAudioRouting(r.planSetBusOutput(st.project.timeline, a, b));
        const second = await st.applyAudioRouting(r.planSetBusOutput(st.project.timeline, b, a));
        return { first: first.success, second: second.success, message: second.error?.message as string };
      },
      [dlg[0], mus[0]] as const,
    );
    expect(loop.first).toBe(true);
    expect(loop.second).toBe(false);
    expect(loop.message).toMatch(/routing loop/);
    expect(await history(page)).toBe(depth + 1);
    steps.push(await routing(page));

    // Undo walks back one step at a time to the exact earlier state.
    for (let i = steps.length - 2; i >= 0; i--) {
      await page.evaluate(() => E().project.getState().undo());
      expect(await routing(page), `undo to step ${i}`).toBe(steps[i]);
    }
    expect(await history(page)).toBe(startDepth);
    // The mix is back to the unrouted original, bit for bit.
    expect(await rms(page, 0, 3)).toBe(base);
    // Redo replays forward exactly.
    for (let i = 1; i < steps.length; i++) {
      await page.evaluate(() => E().project.getState().redo());
      expect(await routing(page), `redo to step ${i}`).toBe(steps[i]);
    }
  });

  test("live playback honours buses and sends (AnalyserNode on the master and on a bus), edits apply while playing", async ({ page }) => {
    const ids = await buildDialogueAndMusic(page);
    await openMixer(page);
    await page.getByTestId("add-bus").click();
    await page.getByTestId("add-bus").click();
    const [mus, fx] = await busIds(page);
    await pickOutput(page, `track-output-${ids.music}`, mus[1]);

    await page.evaluate(
      ([musBus]) => {
        const graph = E().audio.getRealtimeAudioGraph();
        const ctx = graph.getAudioContext() as AudioContext;
        const tap = (node: AudioNode) => {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          node.connect(analyser);
          return analyser;
        };
        const w = window as unknown as { __taps: Record<string, AnalyserNode> };
        w.__ctx = ctx; w.__taps = { master: tap(graph.getMasterGain()), bus: tap(graph.getBusOutputGain(musBus)) };
      },
      [mus[0]] as const,
    );
    // Samples the named taps over the same window and returns each one's 75th-percentile RMS. Measuring the
    // master and the Music bus in one window halves the time spent inside the 4 s tones, which matters on
    // a starved machine where the page can stall for seconds between phases.
    const measureAll = <K extends "master" | "bus">(names: readonly K[], ms: number) =>
      page.evaluate(
        async ([taps, duration]) => {
          const all = (window as unknown as { __taps: Record<string, AnalyserNode> }).__taps;
          const buf = new Float32Array(2048);
          const frames: Record<string, number[]> = Object.fromEntries((taps as string[]).map((n) => [n, []]));
          const t0 = performance.now();
          while (performance.now() - t0 < (duration as number)) {
            for (const name of taps as string[]) {
              all[name].getFloatTimeDomainData(buf);
              let s = 0;
              for (const v of buf) s += v * v;
              frames[name].push(Math.sqrt(s / buf.length));
            }
            await new Promise((r) => setTimeout(r, 30));
          }
          // The tones are steady, so a high-ish percentile equals the median on a quiet machine. On a
          // starved one the page can stall past the 4 s tone's end and the tail frames are silence;
          // the 75th percentile still reads the live tone.
          return Object.fromEntries(
            Object.entries(frames).map(([name, list]) => {
              list.sort((a, b) => a - b);
              return [name, list[Math.floor(list.length * 0.75)]];
            }),
          );
        },
        [names, ms] as const,
      ) as Promise<Record<K, number>>;
    const measure = async (which: "master" | "bus", ms: number) => (await measureAll([which], ms))[which];
    const play = async (opts: { musicBus?: boolean } = { musicBus: true }) => {
      await page.evaluate(() => {
        const t = E().timeline.getState();
        t.pause();
        t.seekTo(0.2);
      });
      await settle(page, 300);
      await page.evaluate(() => {
        // The tones end 3.8 s after play starts (they are 4 s long and playback starts at 0.2 s); remember a
        // conservative end on the audio clock so a measurement can tell it ran off the end of the tone.
        const w = window as unknown as { __ctx: AudioContext; __toneEnd: number };
        w.__toneEnd = w.__ctx.currentTime + 3.7;
        E().timeline.getState().play();
      });
      // Wait for the taps to carry signal rather than assuming a fixed start latency: the first play
      // builds the live graph and schedules the clips on the main thread, which a starved CPU (software
      // GPU, shared CI runner) can delay past a second. The master always carries the Dialogue track, so
      // it is audible in every phase; while the Music bus tap is still wired in (before the send edit rebuilds
      // the bus nodes) it must carry the Music clip too, otherwise a measurement could span the moment Music joins in.
      await page.evaluate(
        async (needBus) => {
          const taps = (window as unknown as { __taps: Record<string, AnalyserNode> }).__taps;
          const buf = new Float32Array(2048);
          const peakOf = (analyser: AnalyserNode) => {
            analyser.getFloatTimeDomainData(buf);
            let peak = 0;
            for (const v of buf) peak = Math.max(peak, Math.abs(v));
            return peak;
          };
          const t0 = performance.now();
          while (performance.now() - t0 < 20_000) {
            if (peakOf(taps.master) > 0.01 && (!needBus || peakOf(taps.bus) > 0.004)) return;
            await new Promise((r) => setTimeout(r, 20));
          }
        },
        opts.musicBus === true,
      );
      await settle(page, 250); // the gate already proved signal; keep the measured window inside the 4 s tones
    };

    // Plays and measures one phase. A starved machine can stall the page for seconds, which pushes the
    // measurement window past the end of the 4 s tones and reads silence; such a window says nothing about
    // routing, so it is discarded and the phase is replayed (the assertions on the values never relax).
    const phase = async <K extends "master" | "bus">(names: readonly K[], opts?: { musicBus?: boolean }) => {
      let result: Record<K, number> | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        await play(opts);
        result = await measureAll(names, 800);
        const inTone = await page.evaluate(() => {
          const w = window as unknown as { __ctx: AudioContext; __toneEnd: number };
          return w.__ctx.currentTime < w.__toneEnd;
        });
        if (inTone) break;
      }
      return result as Record<K, number>;
    };

    const { master: unity, bus: busUnity } = await phase(["master", "bus"]);
    expect(unity, "both tones are audible live").toBeGreaterThan(0.01);
    expect(busUnity, "the Music bus carries the music track").toBeGreaterThan(0.004);

    // Edits apply to the playing graph: -12 dB on the Music bus.
    await page.evaluate((id) => E().project.getState().setAudioRack(id, { effects: [], volume: 0.25 }), mus[0]);
    // The tones are 4 s long: every phase restarts them so it measures live audio.
    const { master: lowered, bus: busLowered } = await phase(["master", "bus"]);
    expect(db(busLowered / busUnity)).toBeGreaterThan(-12.8);
    expect(db(busLowered / busUnity)).toBeLessThan(-11.2);
    expect(db(lowered / unity)).toBeCloseTo(db((1 + 0.25) / 2), 0);

    // A post-fader send from Dialogue into the FX bus (-> master) adds the same signal again.
    await page.evaluate(
      async ([track, bus]) => {
        const st = E().project.getState();
        const r = (E() as any).routing;
        await st.applyAudioRouting(r.planAddSend(st.project.timeline, track, bus, { level: 1 }));
      },
      [ids.dialogue, fx[0]] as const,
    );
    // The routing edit rebuilds the live bus nodes, so the Music bus tap made above no longer carries signal.
    const { master: withSend } = await phase(["master"], { musicBus: false });
    expect(db(withSend / lowered)).toBeGreaterThan(3.2); // dialogue doubles: (2 + 0.25) / (1 + 0.25) = 5.1 dB
    expect(db(withSend / lowered)).toBeLessThan(6.5);

    // Muting the Music bus mid-playback silences its bus meter and drops the master to dialogue x2.
    await page.getByTestId(`bus-mute-${mus[0]}`).click();
    await play({ musicBus: false });
    expect(await measure("bus", 500)).toBeLessThan(1e-4);
    await page.evaluate(() => E().timeline.getState().pause());
  });

  test("a project without routing mixes sample-identically to one with empty routing structures", async ({ page }) => {
    const ids = await buildDialogueAndMusic(page);
    const plain = await page.evaluate(async () => {
      const engine = E().audio.getAudioEngine();
      if (!engine.isInitialized()) await engine.initialize();
      const project = E().project.getState().getFullProject();
      const out = await engine.renderAudio(project, 0, 2);
      return Array.from(out.buffer.getChannelData(0));
    });
    const withEmptyBus = await page.evaluate(async (trackId) => {
      const engine = E().audio.getAudioEngine();
      const project = structuredClone(E().project.getState().getFullProject());
      // A bus that nothing feeds changes nothing about the mix.
      project.timeline.audioBuses = [{ id: "unused", name: "Unused", muted: false, solo: false }];
      void trackId;
      const out = await engine.renderAudio(project, 0, 2);
      return Array.from(out.buffer.getChannelData(0));
    }, ids.dialogue);
    expect(withEmptyBus.length).toBe(plain.length);
    let maxDiff = 0;
    for (let i = 0; i < plain.length; i++) maxDiff = Math.max(maxDiff, Math.abs(plain[i] - (withEmptyBus[i] as number)));
    expect(maxDiff).toBe(0);
  });

  test("sends: pre/post fader and send-level automation are audible; the mixdown cache invalidates on routing edits", async ({ page }) => {
    const ids = await buildDialogueAndMusic(page);
    await openMixer(page);
    // Music stays out of the way; Dialogue plays into a muted "Dry" bus and sends to "Verb" -> master.
    await page.evaluate(async (musicId) => E().project.getState().muteTrack(musicId, true), ids.music);
    await page.getByTestId("add-bus").click();
    await page.getByTestId("add-bus").click();
    const [dry, verb] = await busIds(page);
    await pickOutput(page, `track-output-${ids.dialogue}`, dry[1]);
    await page.getByTestId(`bus-mute-${dry[0]}`).click();
    expect(await rms(page, 0, 1), "main output is muted and there is no send yet").toBeLessThan(1e-6);

    // Add the send from the UI.
    await page.getByTestId(`add-send-${ids.dialogue}`).click();
    await page.getByTestId(`add-send-${ids.dialogue}-${verb[0]}`).click();
    const sendId = await page.evaluate((id) => E().project.getState().project.timeline.tracks.find((t: any) => t.id === id).sends[0].id as string, ids.dialogue);
    const unity = await rms(page, 0, 1);
    expect(unity).toBeGreaterThan(0.01);

    // Mixdown cache: same project, same window -> hit; a send-level edit -> miss with a different result.
    const stats = () => page.evaluate(() => E().mixdownCache.getStats());
    await page.evaluate(async () => { await E().analyzeTimelineLoudness(); });
    const s1 = await stats();
    await page.evaluate(async () => { await E().analyzeTimelineLoudness(); });
    const s2 = await stats();
    expect(s2.misses, "identical project re-uses the cached mixdown").toBe(s1.misses);
    expect(s2.hits).toBeGreaterThan(s1.hits);
    await page.evaluate(
      async ([track, send]) => {
        const st = E().project.getState();
        const r = (E() as any).routing;
        await st.applyAudioRouting(r.planSetSend(st.project.timeline, track, send, { level: 0.5 }));
      },
      [ids.dialogue, sendId] as const,
    );
    const half = await rms(page, 0, 1);
    expect(db(half / unity)).toBeCloseTo(-6.02, 1);
    await page.evaluate(async () => { await E().analyzeTimelineLoudness(); });
    const s3 = await stats();
    expect(s3.misses, "a send edit must not be served from the cache").toBeGreaterThan(s2.misses);

    // Post-fader send follows the track fader; pre-fader ignores it.
    await page.evaluate(async (track) => E().project.getState().setAudioRack(track, { effects: [], volume: 0 }), ids.dialogue);
    expect(await rms(page, 0, 1), "post-fader send is silent with the fader down").toBeLessThan(1e-6);
    await page.getByRole("button", { name: /^Post-fader send from Dialogue/ }).click();
    expect(await rms(page, 0, 1), "pre-fader send ignores the fader").toBeGreaterThan(half * 0.99);
    expect(await rms(page, 0, 1)).toBeLessThan(half * 1.01);

    // Send-level automation 0 -> 1 over 0..2 s is audible in the mixdown (set through the editor UI).
    await page.getByTestId(`send-auto-${ids.dialogue}-${sendId}`).click();
    const editor = (suffix: string) => page.getByTestId(`send-auto-editor-${sendId}${suffix}`);
    const field = async (point: number, label: RegExp, value: number) => {
      const input = editor(`-point-${point}`).getByLabel(label);
      await input.fill(String(value));
      await input.press("Tab"); // commit on blur, keeping focus inside the popover
    };
    await editor("-add").click(); // point at the playhead (0 s) at the send's level
    await field(0, /level$/, 0);
    await editor("-add").click(); // second point continues from the last value
    await field(1, /time \(s\)$/, 2);
    await field(1, /level$/, 1);
    await page.keyboard.press("Escape");
    const points = await page.evaluate(
      ([track, send]) => E().project.getState().project.timeline.tracks.find((t: any) => t.id === track).sends.find((s: any) => s.id === send).automation,
      [ids.dialogue, sendId] as const,
    );
    expect(points).toEqual([{ time: 0, value: 0 }, { time: 2, value: 1 }]);
    const early = await rms(page, 0.1, 0.3); // mean level 0.15
    const late = await rms(page, 1.6, 0.3); // mean level 0.9
    expect(late / early).toBeGreaterThan(5);
    expect(late / early).toBeLessThan(7);
    // The send level is also exactly the ramp at a point: level at 1 s is 0.5 of unity.
    const mid = await rms(page, 0.95, 0.1);
    expect(mid / unity).toBeGreaterThan(0.45);
    expect(mid / unity).toBeLessThan(0.55);
  });

  test("stems export: N valid WAVs (ffprobe) that re-sum to the master mix; the button downloads them too", async ({ page }, testInfo) => {
    const ids = await buildDialogueAndMusic(page);
    await openMixer(page);
    await page.getByTestId("add-stem-buses").click();
    const buses = await busIds(page);
    expect(buses.map((b) => b[1])).toEqual(["Dialogue", "Music", "FX"]);
    // Dialogue / Music lanes were routed by role/name; FX carries nothing and is not exported by default.
    const tracks = await page.evaluate(() => E().project.getState().project.timeline.tracks.map((t: any) => [t.name, t.output ?? null]));
    expect(tracks.find((t: any) => t[0] === "Dialogue")?.[1]).toBe(buses[0][0]);
    expect(tracks.find((t: any) => t[0] === "Music")?.[1]).toBe(buses[1][0]);
    expect(ids.dialogue).toBeTruthy();

    // Render via the service, write each stem to disk, ffprobe it.
    const rendered = await page.evaluate(async () => {
      const stems = await E().stems.renderProjectStems({ bitDepth: 24 });
      let binary = "";
      const out = stems.map((s: any) => {
        let text = "";
        for (let i = 0; i < s.wav.length; i += 0x8000) text += String.fromCharCode(...s.wav.subarray(i, i + 0x8000));
        binary += "";
        return { name: s.name, fileName: s.fileName, base64: btoa(text), frames: s.frames, rate: s.sampleRate };
      });
      void binary;
      return out;
    });
    expect(rendered.map((s: any) => s.name)).toEqual(["Dialogue", "Music"]);
    const dir = join(testInfo.outputDir, "stems");
    mkdirSync(dir, { recursive: true });
    for (const stem of rendered as Array<{ fileName: string; base64: string; frames: number; rate: number }>) {
      const file = join(dir, stem.fileName);
      writeFileSync(file, Buffer.from(stem.base64, "base64"));
      const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
      const audio = probe.streams.find((s: any) => s.codec_type === "audio");
      expect(audio.codec_name).toBe("pcm_s24le");
      expect(Number(audio.sample_rate)).toBe(48000);
      expect(audio.channels).toBe(2);
      // The whole timeline (Main's muted 6 s clip still defines the length).
      expect(Number(probe.format.duration)).toBeGreaterThan(5.9);
      expect(Number(probe.format.duration)).toBeLessThan(6.1);
      expect(probe.format.format_name).toBe("wav");
    }

    // The stems re-sum to the master mix (no master rack): decode the 24-bit PCM and compare.
    const maxErr = await page.evaluate(async () => {
      const stems = await E().stems.renderProjectStems({ bitDepth: 24 });
      const decode = (wav: Uint8Array, channel: number) => {
        const frames = (wav.length - 44) / 6;
        const out = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          const o = 44 + (i * 2 + channel) * 3;
          let v = wav[o] | (wav[o + 1] << 8) | (wav[o + 2] << 16);
          if (v & 0x800000) v -= 0x1000000;
          out[i] = v / 8388607;
        }
        return out;
      };
      const engine = E().audio.getAudioEngine();
      const project = E().project.getState().getFullProject();
      const master = (await engine.renderAudio(project, 1, 2)).buffer.getChannelData(0);
      const parts = stems.map((s: any) => decode(s.wav, 0));
      const from = 48000;
      let worst = 0;
      for (let i = 0; i < master.length; i++) {
        let sum = 0;
        for (const p of parts) sum += p[from + i];
        worst = Math.max(worst, Math.abs(sum - master[i]));
      }
      return worst;
    });
    expect(maxErr).toBeLessThan(1e-5);

    // The button: every stem arrives as its own download.
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await page.getByTestId("export-stems").click();
    await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(2);
    expect(downloads.sort()).toEqual(rendered.map((s: any) => s.fileName).sort());
  });

  test("a stem holds only its bus: a track that reaches it through a send does not leak its dry signal", async ({ page }) => {
    const ids = await buildDialogueAndMusic(page);
    await openMixer(page);
    await page.getByTestId("add-stem-buses").click();
    const buses = await busIds(page);
    const dialogueBus = buses.find((b) => b[1] === "Dialogue")![0];
    const render = () =>
      page.evaluate(async () => {
        const decode = (wav: Uint8Array) => {
          const frames = (wav.length - 44) / 6;
          const out = new Float32Array(frames);
          for (let i = 0; i < frames; i++) {
            const o = 44 + i * 2 * 3;
            let v = wav[o] | (wav[o + 1] << 8) | (wav[o + 2] << 16);
            if (v & 0x800000) v -= 0x1000000;
            out[i] = v / 8388607;
          }
          return out;
        };
        const stems = await E().stems.renderProjectStems({ bitDepth: 24 });
        return Object.fromEntries(stems.map((s: any) => [s.name, Array.from(decode(s.wav).subarray(48000, 48000 + 4800))])) as Record<string, number[]>;
      });
    const before = await render();
    // The Music lane (output: Music bus) now also sends, at unity, into the Dialogue bus.
    await page.getByTestId(`add-send-${ids.music}`).click();
    await page.getByTestId(`add-send-${ids.music}-${dialogueBus}`).click();
    const after = await render();
    let worst = 0;
    for (let i = 0; i < before.Dialogue.length; i++) {
      worst = Math.max(worst, Math.abs(after.Dialogue[i] - (before.Dialogue[i] + before.Music[i])));
    }
    expect(worst, "Dialogue stem = Dialogue + the Music send (no dry Music)").toBeLessThan(1e-5);
    expect(Math.max(...before.Music.map(Math.abs))).toBeGreaterThan(0.01);
  });

  test("autosave + reload persists buses, outputs, sends and bus racks", async ({ page }) => {
    const ids = await buildDialogueAndMusic(page);
    await openMixer(page);
    await page.getByTestId("add-bus").click();
    await page.getByTestId("add-bus").click();
    const [a, b] = await busIds(page);
    await pickOutput(page, `track-output-${ids.dialogue}`, a[1]);
    await page.getByTestId(`add-send-${ids.dialogue}`).click();
    await page.getByTestId(`add-send-${ids.dialogue}-${b[0]}`).click();
    await page.evaluate(async (id) => {
      const st = E().project.getState();
      const r = (E() as any).routing;
      await st.setAudioRack(id, { effects: [{ id: "x", type: "gain", params: { gainDb: -6 }, bypassed: false }], volume: 0.75 });
      await st.applyAudioRouting(r.planSetBusOutput(st.project.timeline, id, null));
    }, b[0]);
    const before = await routing(page);
    const projectId = await page.evaluate(() => E().project.getState().project.id as string);
    await page.evaluate(() => E().project.getState().forceSave());
    await page.reload();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
    const recovered = await page.evaluate(async (savedProjectId) => {
      const store = (window as unknown as { __openreelE2E: { project: { getState(): any; setState(v: unknown): void } } }).__openreelE2E.project;
      store.setState({ project: { ...store.getState().project, id: savedProjectId } });
      const saves = await store.getState().checkForRecovery();
      if (!saves.length) return false;
      return store.getState().recoverFromAutoSave(saves[0].id);
    }, projectId);
    expect(recovered).toBe(true);
    expect(await routing(page)).toBe(before);
    // And the restored routing is audible: the dry bus carries Dialogue (the send into the second bus adds to it).
    const after = JSON.parse(await routing(page));
    expect(after.buses.map((x: any) => x.name)).toEqual(["Bus", "Bus 2"]);
  });

  test("the mixer works inside an opened nest and the parent mix honours the nest's buses", async ({ page }) => {
    await openEditor(page);
    await splitIntoThree(page);
    await setZoom(page, 100);
    const [one, two] = clipsOf(await readState(page), "Main");
    await clickClip(page, one.id);
    await page.keyboard.down("Shift");
    await clickClip(page, two.id);
    await page.keyboard.up("Shift");
    const box = await clipLocator(page, two.id).boundingBox();
    if (!box) throw new Error("clip not visible");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page.getByTestId("nest-clips").click();
    await settle(page, 900);
    const parentBase = await rms(page, 0.2, 1.5);
    expect(parentBase, "the nest's audio is audible in the parent").toBeGreaterThan(0.01);

    // Open the nest (double-click) and use the mixer there.
    const nestId = await page.evaluate(() => E().project.getState().project.compoundClips[0].id as string);
    const nestClip = clipsOf(await readState(page), "Main").find((c) => Math.abs(c.start) < 1e-6)!;
    const nestBox = await clipLocator(page, nestClip.id).boundingBox();
    if (!nestBox) throw new Error("nest clip not visible");
    await page.mouse.dblclick(nestBox.x + nestBox.width / 2, nestBox.y + nestBox.height / 2);
    await expect.poll(() => page.evaluate(() => E().project.getState().project.activeSequenceId as string)).toBe(nestId);
    await openMixer(page);
    await page.getByTestId("add-bus").click();
    const [bus] = await busIds(page);
    const innerTrack = await page.evaluate(() => E().project.getState().project.timeline.tracks.find((t: any) => t.clips.length > 0).id as string);
    await pickOutput(page, `track-output-${innerTrack}`, bus[1]);
    await page.evaluate(([id]) => E().project.getState().setAudioRack(id, { effects: [], volume: 0.25 }), [bus[0]] as const);
    // The nest's mixer state lives on the nest's sequence: -12.04 dB for the parent too.
    await page.getByRole("button", { name: "Close mixer" }).click();
    await page.getByTestId("sequence-tab").first().click();
    await expect.poll(() => page.evaluate(() => E().project.getState().project.activeSequenceId !== undefined && E().project.getState().project.timeline.audioBuses === undefined)).toBe(true);
    const parentRouted = await rms(page, 0.2, 1.5);
    expect(db(parentRouted / parentBase)).toBeCloseTo(db(0.25), 0);
  });
});
