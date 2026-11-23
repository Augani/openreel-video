/**
 * Real-Electron end-to-end test of hosted audio plugins on TRACKS and submix BUSES (Playwright _electron, the BUILT app, the
 * real Swift helper, Apple's own AUDelay and AULowpass):
 *
 *  - AUDelay is inserted on a track from the mixer strip's Plugins panel (one undo step), its parameters edited and Dry/Wet
 *    automated with track keyframes (one undo step per insert);
 *  - the export mixdown, the live-preview path (processed stems + the graph's routing timeline) and the helper's own command
 *    line offline render all carry the same samples, and differ from the bypassed track;
 *  - the same on a submix bus (AULowpass), and a track plugin chained into a bus plugin equals the helper's chained renders;
 *  - the plugin window of a rack plugin returns its state chunk as one undoable edit;
 *  - the project file keeps the racks (state chunk, values, keyframes); reopened without the plugin installed the plugin is
 *    reported, bypassed (the mix equals the dry one) and never dropped.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_TRACKRACK_E2E=1:  pnpm --filter @openreel/desktop test:trackrack-e2e
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? path.join(root, `apps/desktop/resources/bin/darwin-${process.arch}/ffmpeg`);
const HELPER = path.join(root, `apps/desktop/resources/plughost/darwin-${process.arch}/openreel-plughost`);
const enabled =
  process.env.OPENREEL_DESKTOP_TRACKRACK_E2E === "1" &&
  process.platform === "darwin" &&
  fs.existsSync(HELPER) &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

const require = createRequire(path.join(root, "package.json"));
function loadPlaywright(): { _electron: any } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const E = (page: any, expression: string): Promise<any> => page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);
const SAVE_KEY = "Meta+s";
const SR = 48000;
const SECONDS = 4;
const DELAY = "au:aufx:dely:appl";
const LOWPASS = "au:aufx:lpas:appl";

interface Session {
  app: any;
  page: any;
}
const sessions = new Set<Session>();
let work = "";
let wavPath = "";
let source: Float32Array[] = [];

async function launch(profile: string): Promise<Session> {
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_SKIP_ONBOARDING: "1" },
    timeout: 120_000,
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  const session = { app, page };
  sessions.add(session);
  return session;
}

async function createProject(page: any): Promise<void> {
  const close = page.getByRole("button", { name: "Close dialog" });
  if (await close.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    await close.click();
    await close.waitFor({ state: "detached", timeout: 10_000 });
  }
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.projectFile && (window as any).__openreelE2E?.nativePlugins), undefined, { timeout: 30_000 });
}

async function stubDialogs(session: Session, answers: { open?: string; save?: string }): Promise<void> {
  await session.app.evaluate(({ dialog }: any, a: typeof answers) => {
    dialog.showOpenDialog = async () => (a.open ? { canceled: false, filePaths: [a.open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => (a.save ? { canceled: false, filePath: a.save } : { canceled: true });
  }, answers);
}

async function quit(session: Session): Promise<void> {
  const proc = session.app.process();
  const exited = new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null) resolve(true);
    proc.once("exit", () => resolve(true));
  });
  await session.app.evaluate(({ dialog }: any) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => undefined);
  session.app.evaluate(({ app }: any) => app.quit()).catch(() => undefined);
  const ok = await Promise.race([exited, sleep(20_000).then(() => false)]);
  if (!ok) {
    proc.kill("SIGKILL");
    await exited;
  }
  sessions.delete(session);
}

/** 4 s of stereo 48 kHz 16-bit audio with a lot going on (a sweep on the left, pulsed tones on the right), written by hand: no ffmpeg involved. */
function writeFixture(file: string): Float32Array[] {
  const frames = SR * SECONDS;
  const pcm = Buffer.alloc(44 + frames * 4);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + frames * 4, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 4, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(frames * 4, 40);
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  for (let i = 0; i < frames; i += 1) {
    const t = i / SR;
    const sweep = 0.45 * Math.sin(2 * Math.PI * (200 * t + 450 * t * t)) * (t < 3 ? 1 : 0.2);
    const pulse = 0.4 * Math.sin(2 * Math.PI * 330 * t) * (Math.floor(t * 4) % 2 === 0 ? 1 : 0.15);
    const l = Math.round(sweep * 32767);
    const r = Math.round(pulse * 32767);
    pcm.writeInt16LE(l, 44 + i * 4);
    pcm.writeInt16LE(r, 44 + i * 4 + 2);
    channels[0][i] = l / 32768;
    channels[1][i] = r / 32768;
  }
  fs.writeFileSync(file, pcm);
  return channels;
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = Math.min(a.length, b.length)): number => {
  let worst = 0;
  for (let i = from; i < to; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};
/** Best-fit gain and residual (dB) of `played` against `reference` away from the clip edges (the scheduler adds click-free edge ramps). */
function residual(played: ArrayLike<number>, reference: ArrayLike<number>): { gain: number; residualDb: number } {
  const from = 4800;
  const to = Math.min(played.length, reference.length) - 4800;
  let ab = 0;
  let bb = 0;
  for (let i = from; i < to; i += 1) {
    ab += played[i] * reference[i];
    bb += reference[i] * reference[i];
  }
  const gain = ab / bb;
  let err = 0;
  for (let i = from; i < to; i += 1) err += (played[i] - gain * reference[i]) ** 2;
  return { gain, residualDb: 10 * Math.log10(err / (gain * gain * bb) + 1e-30) };
}
const rms = (a: ArrayLike<number>, from = 0, to = a.length): number => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += a[i] * a[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/** The helper's own command line offline render: what the editor's preview and export must equal. */
function helperReference(id: string, step: { state?: string; values: Record<string, number>; automation: Record<string, Array<[number, number]>> }): Float32Array[] {
  const tag = `${id.replace(/\W/g, "_")}-${Math.random().toString(36).slice(2)}`;
  const input = path.join(work, `${tag}.in`);
  const planar = new Float32Array(source.length * source[0].length);
  source.forEach((c, i) => planar.set(c, i * c.length));
  fs.writeFileSync(input, Buffer.from(planar.buffer));
  fs.writeFileSync(`${input}.json`, JSON.stringify({ base: step.values, lanes: step.automation }));
  const args = ["offline", "--id", id, "--in", input, "--out", `${input}.out`, "--channels", "2", "--rate", String(SR), "--automation", `${input}.json`];
  if (step.state) {
    fs.writeFileSync(`${input}.state`, step.state);
    args.push("--state", `${input}.state`);
  }
  execFileSync(HELPER, args, { stdio: ["ignore", "ignore", "ignore"] });
  const bytes = fs.readFileSync(`${input}.out`);
  const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = all.length / 2;
  return [all.slice(0, frames), all.slice(frames)];
}

/** The export mixdown of [0, seconds] (stereo), as the export engine renders it. */
async function renderMix(page: any, seconds: number): Promise<Float32Array[]> {
  const data: number[][] = await page.evaluate(async (len: number) => {
    const h = (window as any).__openreelE2E;
    const engine = h.audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const out = await engine.renderAudio(h.project.getState().getFullProject(), 0, len);
    return [Array.from(out.buffer.getChannelData(0) as Float32Array), Array.from(out.buffer.getChannelData(Math.min(1, out.buffer.numberOfChannels - 1)) as Float32Array)];
  }, seconds);
  return data.map((channel) => Float32Array.from(channel));
}


/** The live-preview path: the stems the preview service publishes, played by a RealtimeAudioGraph on an OfflineAudioContext with the graph's routing timeline. */
async function renderPreview(page: any, seconds: number): Promise<Float32Array[]> {
  // These checks are about the rendered (cached stem) preview. Live inserts are the default preview now and take their targets out of the
  // stems that are played, so switch every rack to the rendered preview first, as the rack panel's Live toggle does (the export is unaffected).
  await page.evaluate(async () => {
    const h = (window as any).__openreelE2E;
    const timeline = h.project.getState().getFullProject().timeline;
    const targets: string[] = [
      ...timeline.tracks.filter((t: any) => t.pluginRack).map((t: any) => t.id),
      ...(timeline.audioBuses ?? []).filter((b: any) => b.pluginRack).map((b: any) => b.id),
      ...(timeline.masterPluginRack ? ["__master__"] : []),
    ];
    for (const target of targets) await h.nativePlugins.host.setRackLivePreview(target, false);
  });
  await page.evaluate(() => (window as any).__openreelE2E.nativePlugins.rack.preview.update((window as any).__openreelE2E.project.getState().project, true));
  await vi.waitFor(async () => expect(await E(page, "h.nativePlugins.rack.previewState.getState().status")).toBe("ready"), { timeout: 60_000, interval: 250 });
  const data: number[][] = await page.evaluate(async (len: number) => {
    const h = (window as any).__openreelE2E;
    const project = h.project.getState().getFullProject();
    const preview = h.nativePlugins.rack.preview;
    const ctx = new OfflineAudioContext(2, Math.floor(48000 * len), 48000);
    const graph = new h.audio.RealtimeAudioGraph({ getAudioContext: () => ctx, currentTime: 0, isPlaying: true } as any);
    graph.setRouting(preview.timelineFor(project.timeline));
    graph.scheduleClips(preview.schedulesAt(project, 0));
    const rendered = await ctx.startRendering();
    return [Array.from(rendered.getChannelData(0) as Float32Array), Array.from(rendered.getChannelData(1) as Float32Array)];
  }, seconds);
  return data.map((channel) => Float32Array.from(channel));
}

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "plughost-rack-e2e-"));
  wavPath = path.join(work, "rack-test.wav");
  source = writeFixture(wavPath);
});
afterAll(() => {
  for (const s of [...sessions]) {
    try {
      s.app.process().kill("SIGKILL");
    } catch {
      /* closed */
    }
  }
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("hosted audio plugins on tracks and buses in the desktop app", () => {
  let trackId = "";
  let busId = "";
  let effectId = "";
  let projectFile = "";
  let savedProfile = "";

  it("a real Audio Unit on a track: UI insert, automation, and export, preview and the helper's offline render agree", async () => {
    savedProfile = path.join(work, "profile-main");
    projectFile = path.join(work, "rack-project.oreel");
    const s = await launch(savedProfile);
    const page = s.page;
    await createProject(page);
    await stubDialogs(s, { save: projectFile });

    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(wavPath);
    await page.getByLabel("Select media rack-test.wav").waitFor({ timeout: 60_000 });
    trackId = await E(page, `(async () => {
      const st = h.project.getState();
      const item = st.project.mediaLibrary.items.find((m) => m.name === "rack-test.wav");
      let track = st.project.timeline.tracks.find((t) => t.type === "audio" && !t.locked);
      if (!track) { await st.addTrack("audio"); track = h.project.getState().project.timeline.tracks.find((t) => t.type === "audio"); }
      const result = await st.addClip(track.id, item.id, 0);
      if (!result.success) throw new Error(JSON.stringify(result));
      return track.id;
    })()`);
    await sleep(500);

    await E(page, "h.nativePlugins.host.scanNativePlugins(true)");
    const plugins = await E(page, "h.nativePlugins.host.useNativePluginHost.getState().plugins");
    for (const id of [DELAY, LOWPASS]) expect(plugins.find((p: any) => p.id === id)?.status, id).toBe("ok");
    expect(await E(page, "h.nativePlugins.host.useNativePluginHost.getState().helperError")).toBeNull();

    const dryMix = await renderMix(page, SECONDS - 0.05);
    const n = dryMix[0].length;
    expect(maxDiff(dryMix[0], source[0], 0, n), "no plugin: the track is the source").toBeLessThan(1e-5);

    // Insert from the mixer strip: Plugins -> panel -> AUDelay -> Add.
    await E(page, 'h.ui.getState().togglePanel("audioMixer")');
    await page.getByTestId("audio-mixer").waitFor({ timeout: 20_000 });
    const history = () => E(page, "h.project.getState().actionHistory.getDisplayHistory().length");
    const before = await history();
    await page.getByTestId(`rack-plugins-${trackId}`).click();
    const panel = page.getByTestId("rack-plugins-panel");
    await panel.waitFor({ timeout: 30_000 });
    await vi.waitFor(async () => expect(await panel.getByTestId("rack-plugin-select").locator("option").count()).toBeGreaterThan(3), { timeout: 30_000, interval: 250 });
    await panel.getByTestId("rack-plugin-select").selectOption(DELAY);
    await panel.getByTestId("rack-plugin-add").click();
    await vi.waitFor(async () => expect(await E(page, `h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack?.plugins.length ?? 0`)).toBe(1), { timeout: 15_000, interval: 200 });
    expect(await history(), "adding a plugin is one undo step").toBe(before + 1);
    effectId = await E(page, `h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack.plugins[0].id`);
    await page.getByTestId(`rack-plugin-card-${effectId}`).getByTestId("rack-plugin-param-0").waitFor({ timeout: 30_000 });

    // Fully wet, 120 ms, some feedback; Dry/Wet automated 20 -> 100 by two track keyframes.
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${trackId}", "${effectId}", { values: { "0": 100, "1": 0.12, "2": 35 } })`);
    const afterValues = await history();
    await E(page, `h.nativePlugins.host.keyframeRackNativeParameter("${trackId}", "${effectId}", "0", 20, 0.5)`);
    await E(page, `h.nativePlugins.host.keyframeRackNativeParameter("${trackId}", "${effectId}", "0", 100, 2.5)`);
    expect(await history(), "one undo step per keyframe insert").toBe(afterValues + 2);
    await sleep(300);

    const step = await E(page, `h.nativePlugins.rack.steps(h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack)[0]`);
    expect(step.automation["0"]).toEqual([[0.5, 20], [2.5, 100]]);
    const reference = helperReference(DELAY, step);
    const exported = await renderMix(page, SECONDS - 0.05);
    const previewed = await renderPreview(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) {
      expect(maxDiff(exported[c], reference[c], 0, n), `export vs helper offline render, channel ${c}`).toBeLessThan(1e-5);
      const vsHelper = residual(previewed[c], reference[c]);
      const vsExport = residual(previewed[c], exported[c]);
      console.log(`[trackrack] preview channel ${c}: vs helper gain ${vsHelper.gain.toFixed(6)} residual ${vsHelper.residualDb.toFixed(1)} dB; vs export gain ${vsExport.gain.toFixed(6)} residual ${vsExport.residualDb.toFixed(1)} dB`);
      expect(vsHelper.residualDb, `preview vs helper offline render, channel ${c}`).toBeLessThan(-90);
      expect(vsExport.residualDb, `preview vs export, channel ${c}`).toBeLessThan(-90);
      expect(Math.abs(vsExport.gain - 1)).toBeLessThan(1e-4);
    }
    expect(maxDiff(exported[0], dryMix[0], 0, n), "the plugin changes the audio").toBeGreaterThan(0.1);

    // Disabling it returns the dry mix; enabling it again is a cache hit (identical samples).
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${trackId}", "${effectId}", { enabled: false })`);
    await sleep(200);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], source[0], 0, n), "a bypassed plugin leaves the track untouched").toBeLessThan(1e-5);
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${trackId}", "${effectId}", { enabled: true })`);
    await sleep(200);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], exported[0], 0, n), "enabling it again gives the same render").toBe(0);

    // The track's own fader still comes after the plugin.
    await E(page, `h.project.getState().setAudioRack("${trackId}", { effects: [], volume: 0.5 })`);
    await sleep(200);
    const faded = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(faded[0], exported[0].map((v) => v * 0.5), 0, n), "plugin first, then the fader").toBeLessThan(1e-5);
    await E(page, `h.project.getState().setAudioRack("${trackId}", null)`);

    // The plugin's own window returns its state chunk as ONE undoable edit.
    const stepsBefore = await history();
    const session = await E(page, `h.nativePlugins.host.openRackNativePluginWindow("${trackId}", "${effectId}")`);
    expect(typeof session).toBe("string");
    await sleep(1200);
    await E(page, `h.nativePlugins.host.closeNativePluginWindow("${session}")`);
    const readState = `h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack.plugins[0].params.state ?? null`;
    await vi.waitFor(async () => expect(await E(page, readState)).not.toBeNull(), { timeout: 15_000, interval: 200 });
    const state: string = await E(page, readState);
    expect(Buffer.from(state, "base64").subarray(0, 6).toString("latin1"), "the state chunk is the plugin's own property list").toBe("bplist");
    expect(await history(), "the window closing is one undo step").toBe(stepsBefore + 1);
    const stateStep = await E(page, `h.nativePlugins.rack.steps(h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack)[0]`);
    expect(stateStep.state).toBe(state);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], helperReference(DELAY, stateStep)[0], 0, n)).toBeLessThan(1e-5);

    // Save: the project file keeps the rack with its state chunk, values and keyframes.
    await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
    await page.keyboard.press(SAVE_KEY);
    await vi.waitFor(() => expect(fs.existsSync(projectFile)).toBe(true), { timeout: 20_000, interval: 200 });
    const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const savedTrack = saved.timeline.tracks.find((t: any) => t.id === trackId);
    expect(savedTrack.pluginRack.plugins[0].params).toMatchObject({ pluginId: DELAY, name: "AUDelay", vendor: "Apple", state });
    expect(savedTrack.pluginRack.plugins[0].params.values["1"]).toBeCloseTo(0.12, 6);
    expect(savedTrack.pluginRack.plugins[0].params).not.toHaveProperty("automation");
    expect(savedTrack.pluginRack.keyframes).toHaveLength(2);
    // Undo walks back through the plugin edits (one step each).
    const stepsAfter = await history();
    await E(page, "h.project.getState().undo()");
    expect(await history()).toBe(stepsAfter - 1);
    await quit(s);
  }, 420_000);

  it("a real Audio Unit on a submix bus, alone and chained after a track plugin", async () => {
    const s = await launch(path.join(work, "profile-bus"));
    const page = s.page;
    await createProject(page);
    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(wavPath);
    await page.getByLabel("Select media rack-test.wav").waitFor({ timeout: 60_000 });
    trackId = await E(page, `(async () => {
      const st = h.project.getState();
      const item = st.project.mediaLibrary.items.find((m) => m.name === "rack-test.wav");
      let track = st.project.timeline.tracks.find((t) => t.type === "audio" && !t.locked);
      if (!track) { await st.addTrack("audio"); track = h.project.getState().project.timeline.tracks.find((t) => t.type === "audio"); }
      const result = await st.addClip(track.id, item.id, 0);
      if (!result.success) throw new Error(JSON.stringify(result));
      return track.id;
    })()`);
    await sleep(500);
    await E(page, "h.nativePlugins.host.scanNativePlugins(true)");
    busId = await E(page, `(async () => {
      const st = h.project.getState();
      await st.applyAudioRouting(h.routing.planAddBus(st.project.timeline, { name: "Submix" }));
      const st2 = h.project.getState();
      const bus = st2.project.timeline.audioBuses.at(-1);
      const routed = await st2.applyAudioRouting(h.routing.planSetTrackOutput(st2.project.timeline, "${trackId}", bus.id));
      if (!routed.success) throw new Error(JSON.stringify(routed));
      return bus.id;
    })()`);
    const n = Math.round((SECONDS - 0.05) * SR);

    // AULowpass on the bus alone: the helper's offline render of the routed (unity) track signal.
    const history = () => E(page, "h.project.getState().actionHistory.getDisplayHistory().length");
    const before = await history();
    const lowpass = await E(page, `h.nativePlugins.host.addNativePluginToRack("${busId}", h.nativePlugins.host.useNativePluginHost.getState().plugins.find((p) => p.id === "${LOWPASS}"))`);
    expect(typeof lowpass).toBe("string");
    expect(await history(), "adding a bus plugin is one undo step").toBe(before + 1);
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${busId}", "${lowpass}", { values: { "0": 1200 } })`);
    const busStep = await E(page, `h.nativePlugins.rack.steps(h.project.getState().project.timeline.audioBuses[0].pluginRack)[0]`);
    const busReference = helperReference(LOWPASS, busStep);
    const busExport = await renderMix(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) expect(maxDiff(busExport[c], busReference[c], 0, n), `bus export vs helper, channel ${c}`).toBeLessThan(1e-5);
    expect(maxDiff(busExport[0], source[0], 0, n), "the low-pass audibly filters the bus").toBeGreaterThan(0.1);
    const busPreview = await renderPreview(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) {
      const vs = residual(busPreview[c], busExport[c]);
      console.log(`[trackrack] bus preview channel ${c}: vs export gain ${vs.gain.toFixed(6)} residual ${vs.residualDb.toFixed(1)} dB`);
      expect(vs.residualDb, `bus preview vs export, channel ${c}`).toBeLessThan(-90);
    }

    // A track plugin first, the bus plugin after it: the helper's chained renders.
    const delay = await E(page, `h.nativePlugins.host.addNativePluginToRack("${trackId}", h.nativePlugins.host.useNativePluginHost.getState().plugins.find((p) => p.id === "${DELAY}"))`);
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${trackId}", "${delay}", { values: { "0": 100, "1": 0.12, "2": 35 } })`);
    const trackStep = await E(page, `h.nativePlugins.rack.steps(h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack)[0]`);
    const afterTrack = helperReference(DELAY, trackStep);
    const saveSource = source;
    source = afterTrack;
    const chained = helperReference(LOWPASS, busStep);
    source = saveSource;
    const chainExport = await renderMix(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) expect(maxDiff(chainExport[c], chained[c], 0, n), `track plugin into bus plugin, channel ${c}`).toBeLessThan(1e-5);
    const chainPreview = await renderPreview(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) expect(residual(chainPreview[c], chainExport[c]).residualDb, `chained preview vs export, channel ${c}`).toBeLessThan(-90);

    // Removing the bus plugin leaves just the track plugin; one undo step each.
    const beforeRemove = await history();
    await E(page, `h.nativePlugins.host.removeRackNativePlugin("${busId}", "${lowpass}")`);
    expect(await history()).toBe(beforeRemove + 1);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], afterTrack[0], 0, n)).toBeLessThan(1e-5);

    // Save this project (with both racks) for the missing-plugin check.
    await stubDialogs(s, { save: projectFile });
    await E(page, `h.nativePlugins.host.addNativePluginToRack("${busId}", h.nativePlugins.host.useNativePluginHost.getState().plugins.find((p) => p.id === "${LOWPASS}"))`);
    await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
    await page.keyboard.press(SAVE_KEY);
    await vi.waitFor(() => expect(fs.existsSync(projectFile)).toBe(true), { timeout: 20_000, interval: 200 });
    await quit(s);
  }, 420_000);

  it("reopens a project whose plugins are not installed: reported, bypassed (the mix is the dry one), never dropped", async () => {
    const doc = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const rename = (rack: any) => { for (const fx of rack?.plugins ?? []) { fx.params.pluginId = "au:aufx:gone:none"; fx.params.name = "Gone Reverb"; } };
    for (const track of doc.timeline.tracks) rename(track.pluginRack);
    for (const bus of doc.timeline.audioBuses ?? []) rename(bus.pluginRack);
    const missingFile = path.join(work, "missing-rack-plugin.oreel");
    fs.writeFileSync(missingFile, JSON.stringify(doc));

    const s = await launch(path.join(work, "profile-missing"));
    await createProject(s.page);
    await stubDialogs(s, { open: missingFile, save: missingFile });
    expect(await E(s.page, "h.projectFile.openEditorProject()")).toBe(true);
    await s.page.getByText(/Plugin missing: Gone Reverb/).waitFor({ timeout: 30_000 });
    expect(await s.page.getByText(/Plugin missing: Gone Reverb/).first().innerText()).toMatch(/Gone Reverb/);
    const kept = await E(s.page, `[...h.project.getState().project.timeline.tracks, ...(h.project.getState().project.timeline.audioBuses ?? [])].flatMap((o) => o.pluginRack?.plugins ?? []).map((e) => ({ id: e.params.pluginId, hasState: typeof e.params.state === "string" || e.params.state === undefined, enabled: e.enabled }))`);
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(kept.every((k: any) => k.id === "au:aufx:gone:none" && k.enabled)).toBe(true);
    const missing = await E(s.page, `h.nativePlugins.findMissing(new Set()).filter((m) => m.rackTarget).map((m) => m.name)`);
    expect(missing.length).toBe(kept.length);
    // Bypassed: the export is exactly the dry mix of the same project (the tracks play their clips).
    await vi.waitFor(async () => {
      const mix = await renderMix(s.page, SECONDS - 0.05);
      const report = await E(s.page, `[...h.audio.getAudioEngine().getPluginRackReport()].length`);
      expect(report).toBeGreaterThan(0);
      expect(maxDiff(mix[0], source[0], 0, mix[0].length)).toBeLessThan(1e-5);
    }, { timeout: 60_000, interval: 1000 });
    await quit(s);
  }, 240_000);
});
