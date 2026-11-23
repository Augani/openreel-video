/**
 * Real-Electron end-to-end test of hosted VST3 plugins on a TRACK rack and on the MASTER rack (Playwright _electron, the BUILT
 * app, the real C++ helper openreel-vst3host, the Steinberg SDK's own "adelay" example built into a temp folder). The round-8
 * report only verified VST3 on racks at the stem level; this drives the whole app:
 *
 *  - the plugin is inserted from the mixer strip's Plugins panel (track strip, then the Master strip), one undo step per edit;
 *  - its Delay is set and automated with rack keyframes (one undo step per insert);
 *  - the export mixdown (AudioEngine.renderAudio), a real audio export through the ExportEngine (24-bit WAV), the live-preview
 *    path (the stems the preview service publishes, played by a RealtimeAudioGraph) and the helper's own command line offline
 *    render carry the same samples; a static delay is the source delayed by exactly trunc(delay x 48000) samples;
 *  - the master fader comes after the master plugin; a track plugin feeding a master plugin equals the helper's chained renders;
 *  - the plugin's own window returns its state chunk as one undoable edit; the project file keeps rack, values and keyframes;
 *  - reopened without the plugin installed the master plugin is reported, bypassed (the mix is the dry one) and never dropped.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_VST3_RACKS_E2E=1:  pnpm --filter @openreel/desktop test:vst3-racks-e2e
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs build script without types
import { buildTestPlugins } from "../scripts/build-vst3-testplugins.mjs";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? path.join(root, `apps/desktop/resources/bin/darwin-${process.arch}/ffmpeg`);
const HELPER = process.env.OPENREEL_VST3HOST_PATH ?? path.join(root, `apps/desktop/resources/vst3host/darwin-${process.arch}/openreel-vst3host`);
const enabled =
  process.env.OPENREEL_DESKTOP_VST3_RACKS_E2E === "1" &&
  process.platform === "darwin" &&
  fs.existsSync(HELPER) &&
  spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0 &&
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
const DELAY = "vst3:0CDBB66985D548A9BFD8371909D24BB3";
const MASTER = "__master__";

interface Session {
  app: any;
  page: any;
}
const sessions = new Set<Session>();
let work = "";
let wavPath = "";
let source: Float32Array[] = [];
let pluginFolder = "";
let emptyFolder = "";
const bundle = (name: string): string => path.join(pluginFolder, `${name}.vst3`);

async function launch(profile: string, vst3Folder = pluginFolder): Promise<Session> {
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_SKIP_ONBOARDING: "1", OPENREEL_VST3_PATH: vst3Folder, OPENREEL_VST3HOST_PATH: HELPER },
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


/** Runs `step` through the helper's own command line offline renderer over `input` (stereo, 48 kHz): what the editor's preview and export must equal. */
function helperRun(pluginPath: string, step: { state?: string; values: Record<string, number>; automation: Record<string, Array<[number, number]>> }, input: Float32Array[] = source): Float32Array[] {
  const tag = `${Math.random().toString(36).slice(2)}`;
  const file = path.join(work, `${tag}.in`);
  const planar = new Float32Array(input.length * input[0].length);
  input.forEach((c, i) => planar.set(c, i * c.length));
  fs.writeFileSync(file, Buffer.from(planar.buffer));
  fs.writeFileSync(`${file}.json`, JSON.stringify({ base: step.values, lanes: step.automation }));
  const args = ["offline", "--id", DELAY, "--path", pluginPath, "--in", file, "--out", `${file}.out`, "--channels", "2", "--rate", String(SR), "--automation", `${file}.json`];
  if (step.state) {
    fs.writeFileSync(`${file}.state`, step.state);
    args.push("--state", `${file}.state`);
  }
  execFileSync(HELPER, args, { stdio: ["ignore", "ignore", "ignore"] });
  const bytes = fs.readFileSync(`${file}.out`);
  const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = all.length / 2;
  return [all.slice(0, frames), all.slice(frames)];
}

/** The export mixdown of [0, seconds] (stereo), as the export engine's mixdown renders it. Also returns the wall time. */
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

/** A REAL export: ExportEngine.exportAudio to a 24-bit stereo WAV (the file a user gets), decoded back to floats. */
async function exportWav(page: any): Promise<{ channels: Float32Array[]; loudness?: any }> {
  const result: { left: number[]; right: number[]; loudness?: unknown; error?: string } = await page.evaluate(async () => {
    const h = (window as any).__openreelE2E;
    const engine = h.audio.getExportEngine();
    await engine.initialize?.();
    const gen = engine.exportAudio(h.project.getState().getFullProject(), { format: "wav", sampleRate: 48000, bitDepth: 24, channels: 2 });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    const out = step.value;
    if (!out.success) return { left: [], right: [], error: out.error?.message ?? "export failed" };
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let offset = 12;
    let dataStart = -1;
    while (offset + 8 <= bytes.length) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      const size = view.getUint32(offset + 4, true);
      if (id === "data") { dataStart = offset + 8; break; }
      offset += 8 + size + (size % 2);
    }
    const left: number[] = [];
    const right: number[] = [];
    for (let p = dataStart; p + 6 <= bytes.length; p += 6) {
      const sample = (at: number) => { let v = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16); if (v & 0x800000) v -= 0x1000000; return v / 8388608; };
      left.push(sample(p));
      right.push(sample(p + 3));
    }
    return { left, right };
  });
  if (result.error) throw new Error(result.error);
  return { channels: [Float32Array.from(result.left), Float32Array.from(result.right)] };
}

/** The live-preview path: the stems the preview service publishes, played by a RealtimeAudioGraph (with the project's master rack) on an OfflineAudioContext. */
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
  await vi.waitFor(async () => expect(await E(page, "h.nativePlugins.rack.previewState.getState().status")).toBe("ready"), { timeout: 90_000, interval: 250 });
  const data: number[][] = await page.evaluate(async (len: number) => {
    const h = (window as any).__openreelE2E;
    const project = h.project.getState().getFullProject();
    const preview = h.nativePlugins.rack.preview;
    const ctx = new OfflineAudioContext(2, Math.floor(48000 * len), 48000);
    const graph = new h.audio.RealtimeAudioGraph({ getAudioContext: () => ctx, currentTime: 0, isPlaying: true } as any);
    graph.setRouting(preview.timelineFor(project.timeline));
    graph.setMasterRack(project.timeline.masterAudioRack);
    graph.scheduleClips(preview.schedulesAt(project, 0));
    const rendered = await ctx.startRendering();
    return [Array.from(rendered.getChannelData(0) as Float32Array), Array.from(rendered.getChannelData(1) as Float32Array)];
  }, seconds);
  return data.map((channel) => Float32Array.from(channel));
}

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "vst3-racks-e2e-"));
  wavPath = path.join(work, "rack-test.wav");
  source = writeFixture(wavPath);
  pluginFolder = (await buildTestPlugins(path.join(work, "plugins"), { log: () => undefined })) ?? "";
  emptyFolder = path.join(work, "no-plugins");
  fs.mkdirSync(emptyFolder);
}, 300_000);
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

const delayed = (channels: Float32Array[], samples: number, n: number): Float32Array[] =>
  channels.map((channel) => Float32Array.from({ length: n }, (_, i) => (i >= samples ? channel[i - samples] : 0)));

async function addAudioClip(page: any): Promise<string> {
  await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(wavPath);
  await page.getByLabel("Select media rack-test.wav").waitFor({ timeout: 60_000 });
  const trackId = await E(page, `(async () => {
    const st = h.project.getState();
    const item = st.project.mediaLibrary.items.find((m) => m.name === "rack-test.wav");
    let track = st.project.timeline.tracks.find((t) => t.type === "audio" && !t.locked);
    if (!track) { await st.addTrack("audio"); track = h.project.getState().project.timeline.tracks.find((t) => t.type === "audio"); }
    const result = await st.addClip(track.id, item.id, 0);
    if (!result.success) throw new Error(JSON.stringify(result));
    return track.id;
  })()`);
  await sleep(500);
  return trackId;
}

/** Mixer strip > Plugins > choose the plugin > Add (the whole UI path). Returns the new effect id. */
async function insertFromMixer(page: any, testId: string, targetOf: () => Promise<string | null>): Promise<string> {
  await page.getByTestId(testId).click();
  const panel = page.getByTestId("rack-plugins-panel");
  await panel.waitFor({ timeout: 30_000 });
  await vi.waitFor(async () => expect(await panel.getByTestId("rack-plugin-select").locator(`option[value="${DELAY}"]`).count()).toBe(1), { timeout: 60_000, interval: 250 });
  await panel.getByTestId("rack-plugin-select").selectOption(DELAY);
  await panel.getByTestId("rack-plugin-add").click();
  let effectId: string | null = null;
  await vi.waitFor(async () => { effectId = await targetOf(); expect(effectId).not.toBeNull(); }, { timeout: 15_000, interval: 200 });
  await page.getByTestId(`rack-plugin-card-${effectId}`).getByTestId("rack-plugin-param-100").waitFor({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  return effectId as unknown as string;
}

const report = (label: string, cold: number, warm: number) => console.log(`[vst3-racks] ${label}: cold render ${cold.toFixed(0)} ms, cached ${warm.toFixed(0)} ms`);
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const value = await fn();
  return [value, Date.now() - t0];
}

d("hosted VST3 plugins on the track rack and the master rack, full app", () => {
  let projectFile = "";

  it("a real VST3 on a TRACK rack: mixer insert, automation, export file vs preview vs the helper's offline render", async () => {
    expect(pluginFolder, "the VST3 test plugins built").not.toBe("");
    const s = await launch(path.join(work, "profile-track"));
    const page = s.page;
    await createProject(page);
    const trackId = await addAudioClip(page);
    await E(page, "h.nativePlugins.host.scanNativePlugins(true)");
    const plugins = await E(page, "h.nativePlugins.host.useNativePluginHost.getState().plugins");
    expect(plugins.find((p: any) => p.id === DELAY)?.status, JSON.stringify(plugins.filter((p: any) => p.format === "vst3"))).toBe("ok");

    const n = SR * (SECONDS - 0.05);
    const dryMix = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(dryMix[0], source[0], 0, n), "no plugin: the track is the source").toBeLessThan(1e-5);

    await E(page, 'h.ui.getState().togglePanel("audioMixer")');
    await page.getByTestId("audio-mixer").waitFor({ timeout: 20_000 });
    const history = () => E(page, "h.project.getState().actionHistory.getDisplayHistory().length");
    const before = await history();
    const effectId = await insertFromMixer(page, `rack-plugins-${trackId}`, () => E(page, `h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack?.plugins[0]?.id ?? null`));
    expect(await history(), "adding a plugin from the mixer is one undo step").toBe(before + 1);

    // Static: Delay 0.01 s = exactly 480 samples. The exported file is the source delayed by 480 samples.
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${trackId}", "${effectId}", { values: { "100": 0.01 } })`);
    await sleep(300);
    const [staticMix, coldMs] = await timed(() => renderMix(page, SECONDS - 0.05));
    const [, warmMs] = await timed(() => renderMix(page, SECONDS - 0.05));
    report("track rack (4 s stereo)", coldMs, warmMs);
    const D = Math.trunc(0.01 * SR);
    for (let c = 0; c < 2; c += 1) expect(maxDiff(staticMix[c], delayed(source, D, n)[c], 0, n), `static delay: mixdown is the source delayed by ${D} samples, channel ${c}`).toBeLessThan(1e-5);
    const staticFile = await exportWav(page);
    for (let c = 0; c < 2; c += 1) expect(maxDiff(staticFile.channels[c], delayed(source, D, n)[c], 0, n), `static delay: exported WAV is the source delayed by ${D} samples, channel ${c}`).toBeLessThan(1e-5);

    // Automated 0.01 -> 0.04 by two rack keyframes (one undo step each).
    const afterValues = await history();
    await E(page, `h.nativePlugins.host.keyframeRackNativeParameter("${trackId}", "${effectId}", "100", 0.01, 0.5)`);
    await E(page, `h.nativePlugins.host.keyframeRackNativeParameter("${trackId}", "${effectId}", "100", 0.04, 2.5)`);
    expect(await history(), "one undo step per keyframe insert").toBe(afterValues + 2);
    await sleep(300);
    const step = await E(page, `h.nativePlugins.rack.steps(h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack)[0]`);
    expect(step.automation["100"]).toEqual([[0.5, 0.01], [2.5, 0.04]]);
    const reference = helperRun(bundle("adelay"), step);
    const exported = await renderMix(page, SECONDS - 0.05);
    const file = await exportWav(page);
    const previewed = await renderPreview(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) {
      const mixVsHelper = maxDiff(exported[c], reference[c], 0, n);
      const fileVsHelper = maxDiff(file.channels[c], reference[c], 0, n);
      const vsHelper = residual(previewed[c], reference[c]);
      const vsExport = residual(previewed[c], exported[c]);
      console.log(`[vst3-racks] TRACK ch${c}: mixdown vs helper max diff ${mixVsHelper.toExponential(2)}; export file vs helper ${fileVsHelper.toExponential(2)}; preview vs helper residual ${vsHelper.residualDb.toFixed(1)} dB (gain ${vsHelper.gain.toFixed(6)}); preview vs export ${vsExport.residualDb.toFixed(1)} dB`);
      expect(mixVsHelper, `mixdown vs helper offline render, channel ${c}`).toBeLessThan(1e-5);
      expect(fileVsHelper, `export file vs helper offline render, channel ${c}`).toBeLessThan(1e-5);
      expect(vsHelper.residualDb, `preview vs helper offline render, channel ${c}`).toBeLessThan(-90);
      expect(vsExport.residualDb, `preview vs export, channel ${c}`).toBeLessThan(-90);
      expect(Math.abs(vsExport.gain - 1)).toBeLessThan(1e-4);
    }
    expect(maxDiff(exported[0], dryMix[0], 0, n), "the plugin changes the audio").toBeGreaterThan(0.1);
    expect(maxDiff(exported[0], staticMix[0], 0, n), "the automation changes the sound compared with the static value").toBeGreaterThan(0.05);
    await quit(s);
  }, 420_000);

  it("a real VST3 on the MASTER rack: mixer insert, automation, fader order, export file vs preview vs the helper, chained after a track plugin, window, save", async () => {
    projectFile = path.join(work, "master-rack.oreel");
    const s = await launch(path.join(work, "profile-master"));
    const page = s.page;
    await createProject(page);
    await stubDialogs(s, { save: projectFile });
    const trackId = await addAudioClip(page);
    await E(page, "h.nativePlugins.host.scanNativePlugins(true)");
    const plugins = await E(page, "h.nativePlugins.host.useNativePluginHost.getState().plugins");
    expect(plugins.find((p: any) => p.id === DELAY)?.status).toBe("ok");

    const n = SR * (SECONDS - 0.05);
    const dryMix = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(dryMix[0], source[0], 0, n)).toBeLessThan(1e-5);
    const [, dryMs] = await timed(() => renderMix(page, SECONDS - 0.05));
    console.log(`[vst3-racks] no plugin (before): mixdown of the 4 s stereo project ${dryMs} ms`);

    await E(page, 'h.ui.getState().togglePanel("audioMixer")');
    await page.getByTestId("audio-mixer").waitFor({ timeout: 20_000 });
    const history = () => E(page, "h.project.getState().actionHistory.getDisplayHistory().length");
    const before = await history();
    const effectId = await insertFromMixer(page, "rack-plugins-master", () => E(page, "h.project.getState().project.timeline.masterPluginRack?.plugins[0]?.id ?? null"));
    expect(await history(), "adding a master plugin from the mixer is one undo step").toBe(before + 1);

    // Static first: the exported WAV is the source delayed by exactly 480 samples.
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${MASTER}", "${effectId}", { values: { "100": 0.01 } })`);
    await sleep(300);
    const D = Math.trunc(0.01 * SR);
    const [staticMix, coldMs] = await timed(() => renderMix(page, SECONDS - 0.05));
    const [, warmMs] = await timed(() => renderMix(page, SECONDS - 0.05));
    report("master rack (4 s stereo)", coldMs, warmMs);
    for (let c = 0; c < 2; c += 1) expect(maxDiff(staticMix[c], delayed(source, D, n)[c], 0, n), `static delay: mixdown is the source delayed by ${D} samples, channel ${c}`).toBeLessThan(1e-5);
    const staticFile = await exportWav(page);
    for (let c = 0; c < 2; c += 1) expect(maxDiff(staticFile.channels[c], delayed(source, D, n)[c], 0, n), `static delay: exported WAV, channel ${c}`).toBeLessThan(1e-5);

    // Automated by master keyframes, one undo step per insert.
    const afterValues = await history();
    await E(page, `h.nativePlugins.host.keyframeRackNativeParameter("${MASTER}", "${effectId}", "100", 0.01, 0.5)`);
    await E(page, `h.nativePlugins.host.keyframeRackNativeParameter("${MASTER}", "${effectId}", "100", 0.04, 2.5)`);
    expect(await history(), "one undo step per keyframe insert").toBe(afterValues + 2);
    await sleep(300);
    const step = await E(page, "h.nativePlugins.rack.steps(h.project.getState().project.timeline.masterPluginRack)[0]");
    expect(step.automation["100"]).toEqual([[0.5, 0.01], [2.5, 0.04]]);
    const [reference, helperMs] = await timed(async () => helperRun(bundle("adelay"), step));
    console.log(`[vst3-racks] helper command line offline render of 4 s stereo (process start included): ${helperMs} ms`);
    const exported = await renderMix(page, SECONDS - 0.05);
    const [file, exportMs] = await timed(() => exportWav(page));
    console.log(`[vst3-racks] full ExportEngine.exportAudio to a 24-bit WAV with the master plugin: ${exportMs} ms`);
    const previewed = await renderPreview(page, SECONDS - 0.05);
    expect(await E(page, "[...h.nativePlugins.rack.previewState.getState().stemmed]"), "the preview plays the master stem").toEqual([MASTER]);
    for (let c = 0; c < 2; c += 1) {
      const mixVsHelper = maxDiff(exported[c], reference[c], 0, n);
      const fileVsHelper = maxDiff(file.channels[c], reference[c], 0, n);
      const vsHelper = residual(previewed[c], reference[c]);
      const vsExport = residual(previewed[c], exported[c]);
      console.log(`[vst3-racks] MASTER ch${c}: mixdown vs helper max diff ${mixVsHelper.toExponential(2)}; export file vs helper ${fileVsHelper.toExponential(2)}; preview vs helper residual ${vsHelper.residualDb.toFixed(1)} dB (gain ${vsHelper.gain.toFixed(6)}); preview vs export ${vsExport.residualDb.toFixed(1)} dB`);
      expect(mixVsHelper, `mixdown vs helper offline render, channel ${c}`).toBeLessThan(1e-5);
      expect(fileVsHelper, `export file vs helper offline render, channel ${c}`).toBeLessThan(1e-5);
      expect(vsHelper.residualDb, `preview vs helper offline render, channel ${c}`).toBeLessThan(-90);
      expect(vsExport.residualDb, `preview vs export, channel ${c}`).toBeLessThan(-90);
      expect(Math.abs(vsExport.gain - 1)).toBeLessThan(1e-4);
    }
    expect(maxDiff(exported[0], dryMix[0], 0, n), "the master plugin changes the audio").toBeGreaterThan(0.1);

    // The master fader comes AFTER the master plugin (and the preview agrees).
    await E(page, 'h.project.getState().setAudioRack("master", { effects: [], volume: 0.5 })');
    await sleep(300);
    const faded = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(faded[0], exported[0].map((v) => v * 0.5), 0, n), "plugin first, then the master fader").toBeLessThan(1e-5);
    const fadedPreview = await renderPreview(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) expect(residual(fadedPreview[c], faded[c]).residualDb, `faded preview vs export, channel ${c}`).toBeLessThan(-90);
    await E(page, 'h.project.getState().setAudioRack("master", null)');

    // Disabled = the dry mix; enabling again = the same samples (cache hit).
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${MASTER}", "${effectId}", { enabled: false })`);
    await sleep(200);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], source[0], 0, n), "a bypassed master plugin leaves the mix untouched").toBeLessThan(1e-5);
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${MASTER}", "${effectId}", { enabled: true })`);
    await sleep(200);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], exported[0], 0, n), "enabling it again gives the same render").toBe(0);

    // A track plugin feeding the master plugin: equals the helper's chained renders (track step, then master step).
    const trackEffect = await E(page, `h.nativePlugins.host.addNativePluginToRack("${trackId}", h.nativePlugins.host.useNativePluginHost.getState().plugins.find((p) => p.id === "${DELAY}"))`);
    await E(page, `h.nativePlugins.host.updateRackNativePlugin("${trackId}", "${trackEffect}", { values: { "100": 0.005 } })`);
    await sleep(300);
    const trackStep = await E(page, `h.nativePlugins.rack.steps(h.project.getState().project.timeline.tracks.find((t) => t.id === "${trackId}").pluginRack)[0]`);
    const chained = helperRun(bundle("adelay"), step, helperRun(bundle("adelay"), trackStep, source));
    const chainExport = await renderMix(page, SECONDS - 0.05);
    const chainFile = await exportWav(page);
    const chainPreview = await renderPreview(page, SECONDS - 0.05);
    for (let c = 0; c < 2; c += 1) {
      expect(maxDiff(chainExport[c], chained[c], 0, n), `track plugin into master plugin: mixdown vs chained helper renders, channel ${c}`).toBeLessThan(1e-5);
      expect(maxDiff(chainFile.channels[c], chained[c], 0, n), `track plugin into master plugin: export file, channel ${c}`).toBeLessThan(1e-5);
      expect(residual(chainPreview[c], chainExport[c]).residualDb, `chained preview vs export, channel ${c}`).toBeLessThan(-90);
    }
    await E(page, `h.nativePlugins.host.removeRackNativePlugin("${trackId}", "${trackEffect}")`);

    // The plugin's own editor window: a second master plugin (the example with a test editor). The edit comes back as ONE undo step.
    const uiPath = bundle("adelay_ui");
    const second = await E(page, `h.nativePlugins.host.addNativePluginToRack("${MASTER}", h.nativePlugins.host.useNativePluginHost.getState().plugins.find((p) => p.path === ${JSON.stringify(uiPath)}))`);
    expect(typeof second).toBe("string");
    const stepsBefore = await history();
    const session = await E(page, `h.nativePlugins.host.openRackNativePluginWindow("${MASTER}", "${second}")`);
    expect(typeof session).toBe("string");
    await sleep(1500);
    await E(page, `h.nativePlugins.host.closeNativePluginWindow("${session}")`);
    const readState = `h.project.getState().project.timeline.masterPluginRack.plugins.find((e) => e.id === "${second}").params.state ?? null`;
    await vi.waitFor(async () => expect(await E(page, readState)).not.toBeNull(), { timeout: 15_000, interval: 200 });
    expect(Buffer.from(await E(page, readState), "base64").subarray(0, 4).toString("latin1")).toBe("ORV3");
    expect(await history(), "the window closing is one undo step").toBe(stepsBefore + 1);
    await E(page, `h.nativePlugins.host.removeRackNativePlugin("${MASTER}", "${second}")`);

    // The project file keeps the master rack: plugin, values, keyframes, and no baked automation.
    await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
    await page.keyboard.press(SAVE_KEY);
    await vi.waitFor(() => expect(fs.existsSync(projectFile)).toBe(true), { timeout: 20_000, interval: 200 });
    const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(saved.timeline.masterPluginRack.plugins[0].params).toMatchObject({ pluginId: DELAY, format: "vst3", name: "ADelay" });
    expect(saved.timeline.masterPluginRack.plugins[0].params.values["100"]).toBeCloseTo(0.01, 6);
    expect(saved.timeline.masterPluginRack.plugins[0].params).not.toHaveProperty("automation");
    expect(saved.timeline.masterPluginRack.keyframes).toHaveLength(2);
    // Undo walks back through the master edits.
    const stepsAfter = await history();
    await E(page, "h.project.getState().undo()");
    expect(await history()).toBe(stepsAfter - 1);
    await quit(s);
  }, 600_000);

  it("reopened where the plugin is not installed: reported against the master, bypassed (the export is the dry mix), never dropped", async () => {
    const s = await launch(path.join(work, "profile-missing"), emptyFolder);
    const page = s.page;
    await createProject(page);
    await stubDialogs(s, { open: projectFile, save: projectFile });
    expect(await E(page, "h.projectFile.openEditorProject()")).toBe(true);
    await page.getByText(/Plugin missing: ADelay/).waitFor({ timeout: 30_000 });
    expect(await E(page, "h.project.getState().project.timeline.masterPluginRack.plugins.map((p) => p.params.pluginId)")).toEqual([DELAY]);
    expect(await E(page, `h.nativePlugins.findMissing(new Set()).filter((m) => m.rackTarget === "${MASTER}").map((m) => [m.rackTargetName, m.name])`)).toEqual([["Master", "ADelay"]]);
    await vi.waitFor(async () => {
      const mix = await renderMix(page, SECONDS - 0.05);
      expect(maxDiff(mix[0], source[0], 0, mix[0].length), "bypassed: the dry mix").toBeLessThan(1e-5);
      expect(await E(page, `[...h.audio.getAudioEngine().getPluginRackReport()].map(([id]) => id)`)).toContain(MASTER);
    }, { timeout: 60_000, interval: 1000 });
    const file = await exportWav(page);
    expect(maxDiff(file.channels[0], source[0], 0, SR * (SECONDS - 0.05)), "the exported file is the dry mix").toBeLessThan(1e-5);
    await quit(s);
  }, 240_000);
});
