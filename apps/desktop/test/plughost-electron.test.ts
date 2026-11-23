/**
 * Real-Electron end-to-end test of hosted audio plugins (Playwright _electron, the BUILT app, the real Swift helper, Apple's
 * own Audio Units):
 *
 *  - the scan finds AUDelay & co. through the sandboxed helper and lists them in Audio > Audio plugins;
 *  - AUDelay is inserted on a clip from that panel (one undo step), its parameters edited, and Dry/Wet automated with
 *    ordinary clip keyframes;
 *  - the export mixdown, the live-preview path and the helper's own command line offline render all carry the same samples,
 *    and differ from the bypassed clip (latency compensated by the helper for the lookahead AU too);
 *  - the plugin's own window opens in its own helper process, and its state chunk comes back as one undoable edit;
 *  - the project file keeps the plugin, its state chunk, values and keyframes; reopened without the plugin installed it is
 *    reported and bypassed, never dropped.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_PLUGHOST_E2E=1:  pnpm --filter @openreel/desktop test:plughost-e2e
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
  process.env.OPENREEL_DESKTOP_PLUGHOST_E2E === "1" &&
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
const MBC = "au:aufx:mcmp:appl";

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

/** The live-preview path: a RealtimeAudioGraph on an OfflineAudioContext, fed what the editor's preview schedules for the clip. */
async function renderPreview(page: any, clipId: string, seconds: number): Promise<Float32Array[]> {
  const data: number[][] = await page.evaluate(
    async ({ id, len }: { id: string; len: number }) => {
      const h = (window as any).__openreelE2E;
      const st = h.project.getState();
      const clip = st.project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
      const media = st.project.mediaLibrary.items.find((m: any) => m.id === clip.mediaId);
      const decoded: AudioBuffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await media.blob.arrayBuffer());
      const ctx = new OfflineAudioContext(2, Math.floor(48000 * len), 48000);
      const graph = new h.audio.RealtimeAudioGraph({ getAudioContext: () => ctx, currentTime: 0, isPlaying: true } as any);
      const effects = h.nativePlugins.resolveClipAudioEffects(clip, st.project.timeline).filter((e: any) => e.enabled && e.metadata?.previewBypass !== true);
      const prepared = await graph.prepareNativePlugins(decoded, effects);
      graph.scheduleClip({ clipId: id, trackId: "t", audioBuffer: prepared.buffer, startTime: 0, endTime: len, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects: prepared.effects, speed: 1 });
      const rendered = await ctx.startRendering();
      return [Array.from(rendered.getChannelData(0) as Float32Array), Array.from(rendered.getChannelData(1) as Float32Array)];
    },
    { id: clipId, len: seconds },
  );
  return data.map((channel) => Float32Array.from(channel));
}

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "plughost-e2e-"));
  wavPath = path.join(work, "plugin-test.wav");
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

d("hosted audio plugins in the desktop app", () => {
  let clipId = "";
  let effectId = "";
  let projectFile = "";
  let savedProfile = "";

  it("scans, inserts an Apple Audio Unit on a clip, automates a parameter, and preview, export and the helper's offline render agree", async () => {
    savedProfile = path.join(work, "profile-main");
    projectFile = path.join(work, "plugin-project.oreel");
    const s = await launch(savedProfile);
    const page = s.page;
    await createProject(page);
    await stubDialogs(s, { save: projectFile });

    // media + clip
    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(wavPath);
    await page.getByLabel("Select media plugin-test.wav").waitFor({ timeout: 60_000 });
    clipId = await E(page, `(async () => {
      const st = h.project.getState();
      const item = st.project.mediaLibrary.items.find((m) => m.name === "plugin-test.wav");
      let track = st.project.timeline.tracks.find((t) => t.type === "audio" && !t.locked);
      if (!track) { await st.addTrack("audio"); track = h.project.getState().project.timeline.tracks.find((t) => t.type === "audio"); }
      const result = await st.addClip(track.id, item.id, 0);
      if (!result.success) throw new Error(JSON.stringify(result));
      return h.project.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.mediaId === item.id).id;
    })()`);
    await sleep(500);

    // The scan (sandboxed helper) lists the built-in Audio Units as usable.
    await E(page, "h.nativePlugins.host.scanNativePlugins(true)");
    const plugins = await E(page, "h.nativePlugins.host.useNativePluginHost.getState().plugins");
    for (const id of [DELAY, "au:aufx:lpas:appl", "au:aufx:lmtr:appl", MBC]) expect(plugins.find((p: any) => p.id === id)?.status, id).toBe("ok");
    expect(await E(page, "h.nativePlugins.host.useNativePluginHost.getState().helperError")).toBeNull();

    // Insert it from the inspector: select the clip, Audio tab, Audio plugins.
    await page.locator(`[data-timeline-item-id="${clipId}"]`).first().click();
    await page.getByRole("tab", { name: /^Audio$/ }).click();
    await page.getByText("Audio plugins", { exact: true }).first().click();
    const section = page.getByTestId("native-plugin-section");
    await section.waitFor({ timeout: 15_000 });
    await vi.waitFor(async () => expect(await section.getByTestId("native-plugin-select").locator("option").count()).toBeGreaterThan(3), { timeout: 30_000, interval: 250 });
    const history = () => E(page, "h.project.getState().actionHistory.getDisplayHistory().length");
    const before = await history();
    await section.getByTestId("native-plugin-select").selectOption(DELAY);
    await section.getByTestId("native-plugin-add").click();
    await vi.waitFor(async () => expect(await E(page, `h.project.getState().getClip("${clipId}").audioEffects.filter((e) => e.type === "nativePlugin").length`)).toBe(1), { timeout: 15_000, interval: 200 });
    expect(await history(), "adding a plugin is one undo step").toBe(before + 1);
    effectId = await E(page, `h.project.getState().getClip("${clipId}").audioEffects.find((e) => e.type === "nativePlugin").id`);
    await page.getByTestId(`native-plugin-card-${effectId}`).waitFor({ timeout: 15_000 });
    // parameters come from the plugin itself
    await page.getByTestId(`native-plugin-card-${effectId}`).getByTestId("native-plugin-param-0").waitFor({ timeout: 30_000 });

    // Parameters: fully wet, 120 ms, some feedback; Dry/Wet automated 20 -> 100 with ordinary keyframes.
    await E(page, `h.nativePlugins.host.updateNativePlugin("${clipId}", "${effectId}", { values: { "0": 100, "1": 0.12, "2": 35 } })`);
    const prop = await E(page, `h.nativePlugins.nativePluginKeyframeProperty("${effectId}", "0")`);
    await E(page, `h.project.getState().updateClipKeyframes("${clipId}", [
      { id: "kf-a", time: 0.5, property: ${JSON.stringify("PROP")}, value: 20, easing: "linear" },
      { id: "kf-b", time: 2.5, property: ${JSON.stringify("PROP")}, value: 100, easing: "linear" },
    ])`.replace(/"PROP"/g, JSON.stringify(prop)));
    await sleep(300);

    // The three renders.
    const step = await E(page, `(() => { const st = h.project.getState(); const clip = st.getClip("${clipId}"); return h.nativePlugins.nativePluginSteps(h.nativePlugins.resolveClipAudioEffects(clip, st.project.timeline))[0]; })()`);
    expect(Object.keys(step.automation)).toEqual(["0"]);
    expect(step.automation["0"].length).toBe(2);
    const reference = helperReference(DELAY, step);
    const exported = await renderMix(page, SECONDS - 0.05);
    const previewed = await renderPreview(page, clipId, SECONDS - 0.05);
    const n = exported[0].length;
    for (let c = 0; c < 2; c += 1) {
      expect(maxDiff(exported[c], reference[c], 0, n), `export vs helper offline render, channel ${c}`).toBeLessThan(1e-5);
      const vsHelper = residual(previewed[c], reference[c]);
      const vsExport = residual(previewed[c], exported[c]);
      console.log(`[plughost] preview channel ${c}: vs helper gain ${vsHelper.gain.toFixed(6)} residual ${vsHelper.residualDb.toFixed(1)} dB; vs export gain ${vsExport.gain.toFixed(6)} residual ${vsExport.residualDb.toFixed(1)} dB; max edge diff ${maxDiff(previewed[c], exported[c], 0, n).toFixed(4)}`);
      expect(vsHelper.residualDb, `preview vs helper offline render, channel ${c}`).toBeLessThan(-90);
      expect(vsExport.residualDb, `preview vs export, channel ${c}`).toBeLessThan(-90);
      expect(Math.abs(vsExport.gain - 1)).toBeLessThan(1e-4);
    }

    // It is a real, audible effect, and the automation shapes it: it differs from the bypassed clip everywhere that matters.
    await E(page, `h.nativePlugins.host.updateNativePlugin("${clipId}", "${effectId}", { enabled: false })`);
    await sleep(200);
    const bypassed = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(bypassed[0], source[0], 0, n), "a bypassed plugin leaves the clip untouched").toBeLessThan(1e-5);
    expect(maxDiff(exported[0], bypassed[0], 0, n), "the plugin changes the audio").toBeGreaterThan(0.1);
    let differing = 0;
    for (let i = 0; i < n; i += 4800) if (rms(exported[0], i, i + 4800) > 0 && Math.abs(rms(exported[0], i, i + 4800) - rms(bypassed[0], i, i + 4800)) > 0.01) differing += 1;
    expect(differing, "most 100 ms windows sound different from bypass").toBeGreaterThan(20);
    await E(page, `h.nativePlugins.host.updateNativePlugin("${clipId}", "${effectId}", { enabled: true })`);
    await sleep(200);
    const again = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(again[0], exported[0], 0, n), "enabling it again gives the same render (cache hit)").toBe(0);

    // Without the automation the same plugin sounds different at the start (lane 20 % vs static 100 %).
    await E(page, `h.project.getState().updateClipKeyframes("${clipId}", [])`);
    await sleep(200);
    const flat = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(flat[0], exported[0], 0, 24000), "keyframed Dry/Wet differs from the static value").toBeGreaterThan(0.05);
    await E(page, `h.project.getState().updateClipKeyframes("${clipId}", [
      { id: "kf-a", time: 0.5, property: ${JSON.stringify(prop)}, value: 20, easing: "linear" },
      { id: "kf-b", time: 2.5, property: ${JSON.stringify(prop)}, value: 100, easing: "linear" },
    ])`);
    await sleep(300);

    // A lookahead plugin: AUMultibandCompressor reports latency; the compensated render still lines up with the helper's offline render.
    const second = await E(page, `h.nativePlugins.host.addNativePluginToClip("${clipId}", h.nativePlugins.host.useNativePluginHost.getState().plugins.find((p) => p.id === "${MBC}"))`);
    expect(typeof second).toBe("string");
    const stepsNow = await E(page, `(() => { const st = h.project.getState(); const clip = st.getClip("${clipId}"); return h.nativePlugins.nativePluginSteps(h.nativePlugins.resolveClipAudioEffects(clip, st.project.timeline)); })()`);
    expect(stepsNow).toHaveLength(2);
    const chain1 = helperReference(DELAY, stepsNow[0]);
    // chain: the second plugin's input is the first one's output
    const saveSource = source;
    source = chain1;
    const chain2 = helperReference(MBC, stepsNow[1]);
    source = saveSource;
    const chained = await renderMix(page, SECONDS - 0.05);
    expect(maxDiff(chained[0], chain2[0], 0, n), "a two-plugin chain equals the helper's chained offline renders").toBeLessThan(1e-5);
    await E(page, `h.nativePlugins.host.removeNativePluginFromClip("${clipId}", "${second}")`);
    await sleep(300);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], exported[0], 0, n)).toBeLessThan(1e-5);

    // The plugin's own window: opens in a separate helper process; closing it returns the state chunk as ONE undoable edit.
    const stepsBefore = await history();
    const session = await E(page, `h.nativePlugins.host.openNativePluginWindow("${clipId}", "${effectId}")`);
    expect(typeof session).toBe("string");
    await sleep(1200);
    await E(page, `h.nativePlugins.host.closeNativePluginWindow("${session}")`);
    await vi.waitFor(async () => expect(await E(page, `h.project.getState().getClip("${clipId}").audioEffects.find((e) => e.id === "${effectId}").params.state ?? null`)).not.toBeNull(), { timeout: 15_000, interval: 200 });
    const state: string = await E(page, `h.project.getState().getClip("${clipId}").audioEffects.find((e) => e.id === "${effectId}").params.state`);
    expect(Buffer.from(state, "base64").subarray(0, 6).toString("latin1"), "the state chunk is the plugin's own property list").toBe("bplist");
    expect(await history(), "the window closing is one undo step").toBe(stepsBefore + 1);
    // With the chunk stored the render still equals the helper rendering that chunk.
    const stateStep = await E(page, `(() => { const st = h.project.getState(); const clip = st.getClip("${clipId}"); return h.nativePlugins.nativePluginSteps(h.nativePlugins.resolveClipAudioEffects(clip, st.project.timeline))[0]; })()`);
    expect(stateStep.state).toBe(state);
    const withState = helperReference(DELAY, stateStep);
    expect(maxDiff((await renderMix(page, SECONDS - 0.05))[0], withState[0], 0, n)).toBeLessThan(1e-5);

    // The project file keeps the plugin, its state chunk, values and keyframes.
    await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
    await page.keyboard.press(SAVE_KEY);
    await vi.waitFor(() => expect(fs.existsSync(projectFile)).toBe(true), { timeout: 20_000, interval: 200 });
    const saved = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    const savedClip = saved.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === clipId);
    const savedEffect = savedClip.audioEffects.find((e: any) => e.type === "nativePlugin");
    expect(savedEffect.params).toMatchObject({ pluginId: DELAY, name: "AUDelay", vendor: "Apple", state });
    expect(savedEffect.params.values["1"]).toBeCloseTo(0.12, 6);
    expect(savedEffect.params).not.toHaveProperty("automation");
    expect(savedClip.keyframes.filter((k: any) => k.property === prop)).toHaveLength(2);
    // Undo walks back through the plugin edits (one step each).
    const stepsAfter = await history();
    await E(page, "h.project.getState().undo()");
    expect(await history()).toBe(stepsAfter - 1);
    await quit(s);
  }, 420_000);

  it("reopens a project whose plugin is not installed: reported, bypassed, never dropped", async () => {
    // The saved project, with its plugin id pointing at a plugin this computer does not have.
    const doc = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    for (const track of doc.timeline.tracks) for (const clip of track.clips) for (const fx of clip.audioEffects) if (fx.type === "nativePlugin") { fx.params.pluginId = "au:aufx:gone:none"; fx.params.name = "Gone Reverb"; }
    const missingFile = path.join(work, "missing-plugin.oreel");
    fs.writeFileSync(missingFile, JSON.stringify(doc));

    const s = await launch(path.join(work, "profile-missing"));
    await createProject(s.page);
    await stubDialogs(s, { open: missingFile, save: missingFile });
    expect(await E(s.page, "h.projectFile.openEditorProject()")).toBe(true);
    await s.page.getByText(/Plugin missing: Gone Reverb/).waitFor({ timeout: 30_000 });
    const text = await s.page.getByText(/Plugin missing: Gone Reverb/).first().innerText();
    expect(text).toMatch(/Gone Reverb/);
    // Still in the project, with its settings.
    const kept = await E(s.page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips).flatMap((c) => c.audioEffects).filter((e) => e.type === "nativePlugin").map((e) => ({ id: e.params.pluginId, hasState: typeof e.params.state === "string", enabled: e.enabled }))`);
    expect(kept).toEqual([{ id: "au:aufx:gone:none", hasState: true, enabled: true }]);
    const missing = await E(s.page, `h.nativePlugins.findMissing(new Set())`);
    expect(missing.map((m: any) => m.name)).toEqual(["Gone Reverb"]);
    await quit(s);
  }, 240_000);
});
