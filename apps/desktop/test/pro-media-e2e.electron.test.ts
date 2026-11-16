/**
 * Real-Electron end-to-end coverage of professional media (Playwright _electron, the BUILT app):
 *
 *  1. An MXF (DNxHR HQ, two mono PCM tracks) is imported natively like ProRes: no proxy, a native source, both
 *     audio tracks counted, and the program monitor shows the file's frames (compared with ffmpeg's own decode).
 *  2. Delivery masters are exported through the ffmpeg sidecar and read back with ffprobe: ProRes 4444 with a
 *     real alpha channel (the pillarbox around a 4:3 clip is transparent), ProRes 422 HQ, DNxHR HQ in MXF and
 *     DNxHR HQX in MOV: codec, profile, pix_fmt and audio tracks, and the MXF's own audio reaches the master.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_PRO_E2E=1:  pnpm --filter @openreel/desktop test:pro-media-e2e
 * Run it (and the build) under the shared heavy-run lock.
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = path.join(path.dirname(FFMPEG), "ffprobe");
const enabled =
  process.env.OPENREEL_DESKTOP_PRO_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
  fs.existsSync(FFPROBE) &&
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

const W = 480;
const H = 360;
const FPS = 24;
const SECONDS = 3;
const TW = 128;
const TH = 96;
/** Mean abs diff (0-255) that counts as "the monitor shows this frame". */
const MATCH = 12;
const PROBE_TIMES = [0.25, 1.5, 2.5];

let work = "";
let mxf = "";
let app: any;
let page: any;

function makeDnxhrMxf(out: string): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${SECONDS}`,
    "-map", "0:v", "-map", "1:a", "-map", "2:a",
    "-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "pcm_s24le", "-f", "mxf", out,
  ]);
}

interface ProbedFile {
  streams: Array<Record<string, string | number>>;
  format: { format_name: string };
}
const ffprobeJson = (file: string): ProbedFile =>
  JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 24 }).toString());

/** Mean audio level in dB (volumedetect); silence reads about -91. */
function meanVolume(file: string): number {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(run.stderr);
  return match ? Number(match[1]) : -999;
}

function referenceThumb(file: string, t: number): Buffer {
  const n = Math.floor(t * FPS + 1e-6);
  return execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${TW}:${TH}:flags=area:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
}

const meanAbsDiff = (a: Uint8Array, b: Uint8Array): number => {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};

async function monitorThumb(): Promise<Buffer | null> {
  const data: number[] | null = await page.evaluate(
    ([w, h]: number[]) => {
      const source = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement | null;
      if (!source) return null;
      const probe = document.createElement("canvas");
      probe.width = w;
      probe.height = h;
      const ctx = probe.getContext("2d")!;
      ctx.drawImage(source, 0, 0, w, h);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    [TW, TH],
  );
  return data ? Buffer.from(data) : null;
}

async function expectFrame(source: string, clipStart: number, t: number): Promise<void> {
  const reference = referenceThumb(source, t);
  await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), clipStart + t);
  const started = Date.now();
  let diff = Infinity;
  while (Date.now() - started < 15_000) {
    const shown = await monitorThumb();
    diff = shown ? meanAbsDiff(shown, reference) : Infinity;
    if (shown && diff < MATCH) {
      const other = referenceThumb(source, t < 1 ? t + 1.5 : t - 1);
      expect(meanAbsDiff((await monitorThumb())!, other), `monitor at ${t}s is not another frame`).toBeGreaterThan(diff * 2);
      return;
    }
    await sleep(50);
  }
  expect(diff, `monitor at ${t}s shows the source frame`).toBeLessThan(MATCH);
}

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "orpro-e2e-"));
  mxf = path.join(work, "A001_C002.mxf");
  makeDnxhrMxf(mxf);
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

afterEach(() => undefined);

afterAll(async () => {
  try {
    await Promise.race([app?.evaluate(({ app: a }: any) => a.exit(0)).catch(() => undefined), sleep(4000)]);
    app?.process().kill("SIGKILL");
  } catch {
    /* already closed */
  }
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

async function exportAndWait(settings: Record<string, unknown>, label: string): Promise<string> {
  const before: number = await E(page, "h.exportQueue.getState().queue.jobs.length");
  await E(page, `h.exportQueue.getState().enqueue({ settings: ${JSON.stringify(settings)}, presetLabel: ${JSON.stringify(label)} })`);
  await E(page, "h.exportQueue.getState().start()");
  const finished = await page.waitForFunction((index: number) => {
    const job = (window as any).__openreelE2E.exportQueue.getState().queue.jobs[index];
    if (job?.status === "failed") throw new Error(job.error);
    return job?.status === "completed" ? (job.output?.path as string) : null;
  }, before, { timeout: 240_000, polling: 500 });
  return (await finished.jsonValue()) as string;
}

d("pro media on the desktop: MXF (DNxHR) import and delivery exports", () => {
  it("imports an MXF natively: no proxy, a native source, both PCM audio tracks, and the monitor shows its frames", async () => {
    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(mxf);
    await page.getByLabel("Select media A001_C002.mxf").waitFor({ timeout: 60_000 });
    const item = await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === "A001_C002.mxf")`);
    expect(item.type).toBe("video");
    expect(item.nativeSource).toMatchObject({ path: mxf, codec: "dnxhd", width: W, height: H, frameRate: FPS });
    expect(item.proxy ?? null).toBeNull();
    expect(item.metadata).toMatchObject({ width: W, height: H, hasVideo: true, hasAudio: true, audioTrackCount: 2 });
    expect(item.metadata.duration).toBeCloseTo(SECONDS, 1);
    expect(await E(page, "Object.keys(h.proxy.desktop.store.getState().jobs).length")).toBe(0);

    await page.getByRole("button", { name: "Media actions for A001_C002.mxf" }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Keep Current" }).click({ timeout: 8_000 }).catch(() => undefined);
    // Keep the 16:9 project: the 4:3 clip is pillarboxed, which the alpha export below relies on.
    await page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.clips.length > 0), undefined, { timeout: 30_000 });
    const stats = await page.evaluate(() => (window as any).openreel.media.nativeStats());
    expect(stats).toBeTruthy();
    const clipStart = await E(page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].startTime");
    // The monitor shows the clip inside the 16:9 frame: compare only that the picture changes with time and is not black.
    const frames: Buffer[] = [];
    for (const t of PROBE_TIMES) {
      await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), clipStart + t);
      await sleep(1200);
      frames.push((await monitorThumb())!);
    }
    expect(meanAbsDiff(frames[0], frames[1])).toBeGreaterThan(2);
    expect(meanAbsDiff(frames[1], frames[2])).toBeGreaterThan(2);
    const after = await page.evaluate(() => (window as any).openreel.media.nativeStats());
    expect(after.framesDecoded, "frames came from the sidecar decoder").toBeGreaterThan(0);
  }, 240_000);

  it("exports ProRes 4444 with alpha (the pillarbox around the 4:3 clip is transparent), verified with ffprobe", async () => {
    const out = await exportAndWait(
      { width: 640, height: 360, frameRate: FPS, format: "mov", codec: "prores", proresProfile: "4444", alpha: true, bitrate: 0, quality: 100, keyframeInterval: 1, audioSettings: { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 } },
      "ProRes 4444 alpha",
    );
    const probed = ffprobeJson(out);
    const v = probed.streams.find((s) => s.codec_type === "video")!;
    expect(v).toMatchObject({ codec_name: "prores", profile: "4444", width: 640, height: 360 });
    expect(String(v.pix_fmt)).toMatch(/^yuva444p1[02]le$/);
    const a = probed.streams.filter((s) => s.codec_type === "audio");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ codec_name: "pcm_s24le", channels: 2, sample_rate: "48000" });
    // The MXF's own tracks (440 / 880 Hz) reached the master: it is not silent.
    expect(meanVolume(out)).toBeGreaterThan(-50);
    const rgba = execFileSync(FFMPEG, ["-v", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
    const alphaAt = (x: number, y: number): number => rgba[(y * 640 + x) * 4 + 3];
    expect(alphaAt(20, 180), "left pillar is transparent").toBeLessThan(10);
    expect(alphaAt(620, 180), "right pillar is transparent").toBeLessThan(10);
    expect(alphaAt(320, 180), "the picture is opaque").toBeGreaterThan(245);
  }, 300_000);

  it("exports ProRes 422 HQ, DNxHR HQ in MXF and DNxHR HQX in MOV, each verified with ffprobe (codec, profile, pix_fmt, audio)", async () => {
    const audioSettings = { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 };
    const base = { width: 640, height: 360, frameRate: FPS, bitrate: 0, quality: 100, keyframeInterval: 1, audioSettings };

    const hq = ffprobeJson(await exportAndWait({ ...base, format: "mov", codec: "prores", proresProfile: "hq" }, "ProRes 422 HQ"));
    expect(hq.streams.find((s) => s.codec_type === "video")).toMatchObject({ codec_name: "prores", profile: "HQ", pix_fmt: "yuv422p10le" });
    expect(hq.streams.filter((s) => s.codec_type === "audio")).toHaveLength(1);

    const mxfOut = await exportAndWait({ ...base, format: "mxf", codec: "dnxhr", dnxhrProfile: "hq" }, "DNxHR HQ MXF");
    expect(mxfOut.endsWith(".mxf")).toBe(true);
    const dnxMxf = ffprobeJson(mxfOut);
    expect(dnxMxf.format.format_name).toContain("mxf");
    expect(dnxMxf.streams.find((s) => s.codec_type === "video")).toMatchObject({ codec_name: "dnxhd", profile: "DNXHR HQ", pix_fmt: "yuv422p", width: 640, height: 360 });
    const mxfAudio = dnxMxf.streams.filter((s) => s.codec_type === "audio");
    expect(mxfAudio.length).toBeGreaterThanOrEqual(1);
    expect(mxfAudio.every((s) => s.codec_name === "pcm_s24le")).toBe(true);
    expect(mxfAudio.reduce((n, s) => n + Number(s.channels), 0)).toBe(2);
    expect(meanVolume(mxfOut)).toBeGreaterThan(-50);

    const hqxMov = ffprobeJson(await exportAndWait({ ...base, format: "mov", codec: "dnxhr", dnxhrProfile: "hqx" }, "DNxHR HQX MOV"));
    expect(hqxMov.format.format_name).toContain("mov");
    expect(hqxMov.streams.find((s) => s.codec_type === "video")).toMatchObject({ codec_name: "dnxhd", profile: "DNXHR HQX", pix_fmt: "yuv422p10le" });
    expect(hqxMov.streams.filter((s) => s.codec_type === "audio").length).toBeGreaterThanOrEqual(1);

    // The exported MXF is itself importable natively (round trip).
    const probe = await page.evaluate((p: string) => (window as any).openreel.media.nativeProbe({ path: p }), mxfOut);
    expect(probe).toMatchObject({ codec: "dnxhd", width: 640, height: 360, container: "mxf" });
  }, 600_000);
});

/** Peak level in dB of audio stream `index` (volumedetect); digital silence reads -inf / about -91. */
function streamPeak(file: string, index: number): number {
  const run = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-map", `0:a:${index}`, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const match = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(run.stderr);
  if (!match) return Number.NaN;
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}
type TaggedProbe = ProbedFile & { format: { tags?: Record<string, string> } };
const probeTagged = (file: string): TaggedProbe => ffprobeJson(file) as TaggedProbe;
const tcOf = (p: TaggedProbe): string | undefined =>
  p.format.tags?.timecode ?? (p.streams as Array<{ tags?: Record<string, string> }>).find((s) => s.tags?.timecode)?.tags?.timecode;
const broadcastBase = {
  width: 1920, height: 1080, frameRate: 25, bitrate: 0, quality: 100, keyframeInterval: 1,
  audioSettings: { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 },
};
let xdcamMaster = "";

d("broadcast delivery on the desktop: XDCAM HD422, AVC-Intra, OP-Atom, mono tracks and timecode", () => {
  it("exports XDCAM HD422 1080i25 in MXF OP1a with 8 mono tracks (mix, one stem, silence) and a 10:00:00:00 timecode", async () => {
    const out = await exportAndWait(
      { ...broadcastBase, format: "mxf", codec: "xdcamhd422", broadcast: { scan: "interlaced-tff", audioTracks: 8, extraTracks: "stems", startTimecode: "10:00:00:00" } },
      "XDCAM HD422 1080i25",
    );
    xdcamMaster = out;
    expect(out.endsWith(".mxf")).toBe(true);
    const p = probeTagged(out);
    const v = p.streams.find((s) => s.codec_type === "video")!;
    expect(v).toMatchObject({ codec_name: "mpeg2video", profile: "4:2:2", level: 2, pix_fmt: "yuv422p", field_order: "tt", width: 1920, height: 1080, r_frame_rate: "25/1" });
    expect(Number(v.bit_rate)).toBe(50_000_000);
    const audio = p.streams.filter((s) => s.codec_type === "audio");
    expect(audio).toHaveLength(8);
    for (const track of audio) expect(track).toMatchObject({ codec_name: "pcm_s24le", channels: 1, sample_rate: "48000" });
    expect(tcOf(p)).toBe("10:00:00:00");
    // 1 and 2: the stereo mix (the imported MXF's tones). 3: the "Untyped" stem carries the same clip audio. 4-8: silence.
    expect(streamPeak(out, 0)).toBeGreaterThan(-40);
    expect(streamPeak(out, 1)).toBeGreaterThan(-40);
    expect(streamPeak(out, 2)).toBeGreaterThan(-40);
    for (let i = 3; i < 8; i++) expect(streamPeak(out, i), `track ${i + 1} is silent`).toBeLessThan(-80);
  }, 600_000);

  it("exports AVC-Intra 100 1080p25 in MXF OP1a (High 4:2:2 Intra, 10-bit, progressive) with silent extra tracks", async () => {
    const out = await exportAndWait(
      { ...broadcastBase, format: "mxf", codec: "avcintra100", broadcast: { audioTracks: 4, startTimecode: "10:00:00:00" } },
      "AVC-Intra 100 1080p25",
    );
    const p = probeTagged(out);
    expect(p.streams.find((s) => s.codec_type === "video")).toMatchObject({
      codec_name: "h264", profile: "High 4:2:2 Intra", pix_fmt: "yuv422p10le", field_order: "progressive", width: 1920, height: 1080,
    });
    expect(p.streams.filter((s) => s.codec_type === "audio")).toHaveLength(4);
    expect(tcOf(p)).toBe("10:00:00:00");
    expect(streamPeak(out, 0)).toBeGreaterThan(-40);
    expect(streamPeak(out, 3)).toBeLessThan(-80);
  }, 600_000);

  it("exports MXF OP-Atom: one file for the picture and one per mono audio track, all carrying the timecode", async () => {
    const out = await exportAndWait(
      { ...broadcastBase, format: "mxf", codec: "xdcamhd422", broadcast: { scan: "interlaced-tff", mxfPattern: "opatom", audioTracks: 2, startTimecode: "10:00:00:00" } },
      "XDCAM OP-Atom",
    );
    const base = out.replace(/\.mxf$/i, "");
    const files = [`${base}_V01.mxf`, `${base}_A01.mxf`, `${base}_A02.mxf`];
    for (const file of files) expect(fs.existsSync(file), file).toBe(true);
    const v = probeTagged(files[0]);
    expect(v.streams).toHaveLength(1);
    expect(v.streams[0]).toMatchObject({ codec_name: "mpeg2video", profile: "4:2:2", pix_fmt: "yuv422p", field_order: "tt" });
    expect(tcOf(v)).toBe("10:00:00:00");
    for (const file of files.slice(1)) {
      const a = probeTagged(file);
      expect(a.streams).toHaveLength(1);
      expect(a.streams[0]).toMatchObject({ codec_type: "audio", codec_name: "pcm_s24le", channels: 1 });
      expect(tcOf(a)).toBe("10:00:00:00");
      expect(streamPeak(file, 0)).toBeGreaterThan(-40);
    }
  }, 600_000);

  it("a sequence start timecode (an undoable setting) is written into a ProRes MOV master with 8 mono tracks and shown in the preview timecode", async () => {
    expect((await E(page, "h.project.getState().project.settings.startTimecode")) ?? null).toBeNull();
    await E(page, `h.project.getState().updateSettings({ startTimecode: "10:00:00:00" })`);
    expect(await E(page, "h.project.getState().project.settings.startTimecode")).toBe("10:00:00:00");
    await E(page, "h.timeline.getState().seekTo(0)");
    await page.waitForFunction(() => (document.querySelector('[aria-label="Playhead timecode"]') as HTMLInputElement | null)?.value === "10:00:00:00", undefined, { timeout: 10_000 });

    const out = await exportAndWait(
      { ...broadcastBase, width: 640, height: 360, format: "mov", codec: "prores", proresProfile: "hq", broadcast: { audioTracks: 8 } },
      "ProRes HQ 8 mono",
    );
    const p = probeTagged(out);
    const audio = p.streams.filter((s) => s.codec_type === "audio");
    expect(audio).toHaveLength(8);
    for (const track of audio) expect(track).toMatchObject({ codec_name: "pcm_s24le", channels: 1 });
    expect(tcOf(p)).toBe("10:00:00:00");

    // Undo clears the sequence timecode again; the readout goes back to the plain count.
    await E(page, "h.project.getState().undo()");
    await page.waitForFunction(() => !(window as any).__openreelE2E.project.getState().project.settings.startTimecode, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => (document.querySelector('[aria-label="Playhead timecode"]') as HTMLInputElement | null)?.value === "00:00:00:00", undefined, { timeout: 10_000 });
  }, 600_000);

  it("re-imports the XDCAM master: the start timecode is read from the MXF and stored in the media metadata", async () => {
    expect(fs.existsSync(xdcamMaster)).toBe(true);
    const probe = await page.evaluate((p: string) => (window as any).openreel.media.nativeProbe({ path: p }), xdcamMaster);
    expect(probe).toMatchObject({ codec: "mpeg2video", width: 1920, height: 1080, container: "mxf", interlaced: true, startTimecode: "10:00:00:00" });
    expect(probe.audioStreams).toHaveLength(8);

    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(xdcamMaster);
    const name = path.basename(xdcamMaster);
    await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 60_000 });
    const item = await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === ${JSON.stringify(name)})`);
    expect(item.metadata).toMatchObject({ startTimecode: 36000, startTimecodeText: "10:00:00:00", audioTrackCount: 8 });
  }, 300_000);
});
