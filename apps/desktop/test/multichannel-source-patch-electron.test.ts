/**
 * Real-Electron end-to-end coverage of multichannel source patching on the desktop's native import path
 * (Playwright _electron, the BUILT app):
 *
 *  An MXF (DNxHR HQ) with FOUR mono PCM tracks (440 / 660 / 880 / 1100 Hz) is imported natively (no proxy, a native
 *  source, four audio streams). The Source monitor shows four patch indicators (A1..A4); A3 is switched off and A1 is
 *  patched to the Dialogue track; Insert places the picture muted plus one linked sound clip per enabled stream
 *  (audioTrackIndex 0, 1, 3) in ONE undo step, and the export mixdown, decoded natively through the ffmpeg sidecar,
 *  carries exactly the enabled streams' tones. A layout from Modify > Audio Channels (stream 1 as a stereo clip, streams
 *  3 and 4 as monos, stream 2 left out) then changes what a second Insert places.
 *
 * Needs a build made with the e2e hook:  OPENREEL_DESKTOP=1 VITE_OPENREEL_E2E=1 pnpm --filter @openreel/web exec vite build
 * and the main bundle (pnpm --filter @openreel/desktop exec tsup).
 * Opt in with OPENREEL_DESKTOP_MULTICHANNEL_E2E=1:  pnpm --filter @openreel/desktop test:multichannel-e2e
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_MULTICHANNEL_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
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

const FREQS = [440, 660, 880, 1100];
let work = "";
let mxf = "";
let app: any;
let page: any;

function makeMxf(out: string): void {
  const tones = FREQS.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:sample_rate=48000:duration=3`]);
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=480x360:rate=24:duration=3",
    ...tones,
    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:a", "-map", "4:a",
    "-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "pcm_s24le", "-f", "mxf", out,
  ]);
}

/** Amplitude of one frequency (single-bin DFT) over [from, to) seconds. */
const toneAmp = (x: number[], rate: number, freq: number, from: number, to: number): number => {
  const a = Math.floor(from * rate);
  const b = Math.floor(to * rate);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i++) {
    const w = (2 * Math.PI * freq * (i - a)) / rate;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
};

async function spectrum(at: number): Promise<{ f: number; left: number; right: number }[]> {
  const m = await page.evaluate(async ([start]: number[]) => {
    const e = (window as any).__openreelE2E;
    const engine = e.audio.getAudioEngine();
    if (!engine.isInitialized()) await engine.initialize();
    const rendered = await engine.renderAudio(e.project.getState().getFullProject(), start, 2.5);
    const buffer = rendered.buffer as AudioBuffer;
    return { rate: buffer.sampleRate, left: Array.from(buffer.getChannelData(0)), right: Array.from(buffer.getChannelData(1)) };
  }, [at]);
  return FREQS.map((f) => ({ f, left: toneAmp(m.left, m.rate, f, 0.3, 2.2), right: toneAmp(m.right, m.rate, f, 0.3, 2.2) }));
}

const clipsOfMedia = (): Promise<any[]> =>
  E(page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips.filter((c) => c.mediaId === h.project.getState().project.mediaLibrary.items.find((m) => m.name === "four-mono.mxf").id).map((c) => ({ id: c.id, track: t.name, type: t.type, audioTrackIndex: c.audioTrackIndex ?? 0, channelMap: c.channelMap ?? null, volume: c.volume, link: c.metadata?.separatedFromClipId ?? null })))`);

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "ormc-e2e-"));
  mxf = path.join(work, "four-mono.mxf");
  makeMxf(mxf);
  const { _electron } = loadPlaywright();
  app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${path.join(work, "profile")}`],
    env: { ...process.env, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_SKIP_ONBOARDING: "1" },
    timeout: 120_000,
  });
  page = await app.firstWindow();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  await page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.proxy?.desktop), undefined, { timeout: 30_000 });
}, 240_000);

afterAll(async () => {
  try {
    await Promise.race([app?.evaluate(({ app: a }: any) => a.exit(0)).catch(() => undefined), sleep(4000)]);
    app?.process().kill("SIGKILL");
  } catch {
    /* already closed */
  }
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("multichannel source patching on the desktop (native MXF import)", () => {
  it("four mono streams: four indicators, per-stream patch / off, linked clips by stream, one undo step, native decode tones", async () => {
    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(mxf);
    await page.getByLabel("Select media four-mono.mxf").waitFor({ timeout: 60_000 });
    const item = await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === "four-mono.mxf")`);
    expect(item.nativeSource, "decoded natively").toBeTruthy();
    expect(item.metadata).toMatchObject({ hasAudio: true, audioTrackCount: 4, channels: 1 });

    await page.getByLabel("Select media four-mono.mxf").dblclick();
    await page.getByTestId("source-monitor").waitFor();
    const patch = page.getByTestId("source-patch");
    await patch.waitFor({ timeout: 30_000 });
    expect(await patch.getAttribute("data-multichannel")).toBe("4");

    // Switch A3 off; patch A1 to Dialogue.
    await page.getByTestId("source-patch-channel-toggle-2").click();
    await page.getByTestId("source-patch-audio").click();
    await page.getByRole("option", { name: "Dialogue" }).click();

    const steps = () => E(page, "h.project.getState().actionExecutor.getHistory().getUndoStackSize()");
    const before = await steps();
    await E(page, "h.timeline.getState().seekTo(0)");
    await page.getByRole("button", { name: "Insert (,)" }).click();
    await page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.type === "audio" && t.clips.length > 0), undefined, { timeout: 30_000 });
    const placed = await clipsOfMedia();
    const picture = placed.find((c) => c.type === "video");
    const sounds = placed.filter((c) => c.type === "audio");
    expect(picture.volume).toBe(0);
    expect(sounds.map((c) => c.audioTrackIndex).sort()).toEqual([0, 1, 3]);
    expect(sounds.every((c) => c.channelMap === null && c.link === picture.id)).toBe(true);
    expect(sounds.find((c) => c.audioTrackIndex === 0).track).toBe("Dialogue");
    expect(await steps(), "one undo step").toBe(before + 1);

    // Streams 0, 1 and 3 are heard (native ffmpeg decode of each stream); the switched-off stream 2 is not.
    const heard = await spectrum(0);
    for (const i of [0, 1, 3]) expect(Math.max(heard[i].left, heard[i].right), `${FREQS[i]} Hz`).toBeGreaterThan(0.01);
    expect(Math.max(heard[2].left, heard[2].right), "stream 3 was switched off").toBeLessThan(0.003);

    await page.keyboard.press("Meta+z");
    await sleep(500);
    expect(await clipsOfMedia()).toHaveLength(0);
  }, 300_000);

  it("Modify > Audio Channels regroups the streams (stream 1 as one stereo clip, streams 3 and 4 as monos, stream 2 dropped) and Insert follows", async () => {
    const mediaId = await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === "four-mono.mxf").id`);
    const layout = [
      { stream: 0, map: { format: "stereo", sources: [0, 0] } },
      { stream: 2, map: { format: "mono", sources: [0] } },
      { stream: 3, map: { format: "mono", sources: [0] } },
    ];
    const ok = await E(page, `h.project.getState().executeAction({ id: "mc-layout", timestamp: Date.now(), type: "media/organize", params: { label: "Audio channels", itemPatches: { "${mediaId}": { channelLayout: ${JSON.stringify(layout)} } } } }).then((r) => r.success)`);
    expect(ok).toBe(true);
    await E(page, "h.source.getState().open(" + JSON.stringify(mediaId) + ", h.project.getState().project.id)");
    await page.getByTestId("source-patch").waitFor();
    expect(await page.getByTestId("source-patch").getAttribute("data-multichannel")).toBe("3");
    // Switching A3 off earlier is a Source-monitor preference; re-enable everything for this edit.
    await E(page, "h.workspace.getState().setChannelEnabled(2, true)");
    await E(page, "h.timeline.getState().seekTo(0)");
    await page.getByRole("button", { name: "Insert (,)" }).click();
    await page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.filter((t: any) => t.type === "audio" && t.clips.length > 0).length >= 3, undefined, { timeout: 30_000 });
    const sounds = (await clipsOfMedia()).filter((c) => c.type === "audio");
    expect(sounds.map((c) => [c.audioTrackIndex, c.channelMap?.format ?? "stream"]).sort()).toEqual([[0, "stereo"], [2, "stream"], [3, "stream"]].sort());
  }, 300_000);
});
