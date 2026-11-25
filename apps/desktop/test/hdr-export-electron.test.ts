/**
 * Real-Electron test for source colour management and the desktop HDR export (Playwright _electron, the BUILT app).
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * and ffmpeg + ffprobe on disk. Opt in with OPENREEL_DESKTOP_HDR_E2E=1:  pnpm --filter @openreel/desktop test:hdr-e2e
 * Run it under the machine's heavy-run lock.
 *
 * Fixture: a ProRes 422 HQ file tagged BT.2020 / HLG (Chromium cannot decode ProRes, so it takes the desktop's native
 * ffmpeg path, which hands over raw HLG code values). It proves:
 *  - the file's colour tags are detected and stored on the media item (shown in Interpret Footage);
 *  - the input transform (HLG -> SDR working image) is applied in the monitor, and the monitor matches an independent
 *    ffmpeg decode run through the same core transform; "Interpret footage" as Rec.709 switches it off and undo restores it;
 *  - an SDR export of the clip equals that same transformed picture (preview and export agree);
 *  - HDR10 PQ and HLG exports (HEVC Main10 via libx265) and a ProRes 4444 XQ export are real 10-bit files, verified with
 *    ffprobe: pix_fmt, color_primaries bt2020, color_transfer smpte2084 / arib-std-b67, mastering display metadata.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyInputTransformToRgba, createInputTransform } from "../../../packages/core/src/color/input-transform";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? path.join(path.dirname(FFMPEG), "ffprobe");
const enabled =
  process.env.OPENREEL_DESKTOP_HDR_E2E === "1" &&
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

const W = 1280;
const H = 720;
const FPS = 24;
const SECONDS = 2;
const TW = 160;
const TH = 90;

let work = "";
let HLG_SOURCE = "";
let app: any;
let page: any;

function makeHlgProres(out: string): void {
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    // ffmpeg 8 drops output-level -color_primaries/-color_trc for prores_ks: tag the frames themselves too.
    "-vf", "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv",
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "arib-std-b67",
    "-c:a", "pcm_s16le", "-shortest", out,
  ]);
}

/** ffmpeg's raw decode of source frame `n` (BT.2020 matrix, no transfer change), scaled; RGBA codes as the sidecar hands them over. */
function rawReference(file: string, n: number, w: number, h: number, flags: string): Uint8ClampedArray {
  const out = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${w}:${h}:flags=${flags}:in_color_matrix=bt2020`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 27 });
  return new Uint8ClampedArray(out.buffer, out.byteOffset, out.byteLength).slice();
}

const transformed = (rgba: Uint8ClampedArray): Uint8ClampedArray => {
  const copy = rgba.slice();
  applyInputTransformToRgba(copy, createInputTransform({ primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl", fullRange: false })!);
  return copy;
};

const meanAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};

async function monitorThumb(): Promise<Uint8ClampedArray> {
  const data: number[] = await page.evaluate(
    ([w, h]: number[]) => {
      const source = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const probe = document.createElement("canvas");
      probe.width = w;
      probe.height = h;
      const ctx = probe.getContext("2d")!;
      ctx.drawImage(source, 0, 0, w, h);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    [TW, TH],
  );
  return Uint8ClampedArray.from(data);
}

async function seek(t: number): Promise<void> {
  await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), t);
}

/** Seek, then poll the monitor until it is within `tolerance` of `reference`; returns the last difference. */
async function monitorMatches(t: number, reference: ArrayLike<number>, tolerance = 6, timeout = 10_000): Promise<number> {
  const started = Date.now();
  await seek(t);
  let diff = Infinity;
  for (;;) {
    diff = meanAbsDiff(await monitorThumb(), reference);
    if (diff < tolerance || Date.now() - started > timeout) return diff;
    await sleep(40);
  }
}

interface FfprobeOut {
  streams: Array<Record<string, any>>;
  frames: Array<{ side_data_list?: Array<Record<string, any>> }>;
}
function ffprobe(file: string): FfprobeOut {
  return JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-read_intervals", "%+#1", "-of", "json", file], { maxBuffer: 1 << 24 }).toString());
}

async function exportClip(settings: Record<string, unknown>, label: string): Promise<string> {
  await E(page, `h.exportQueue.getState().enqueue({ settings: ${JSON.stringify({ width: W, height: H, frameRate: FPS, bitrate: 20000, encodeMode: "fast", ...settings })}, presetLabel: ${JSON.stringify(label)} })`);
  await E(page, "h.exportQueue.getState().start()");
  const finished = await page.waitForFunction((l: string) => {
    const job = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((j: any) => j.presetLabel === l);
    if (job?.status === "failed") throw new Error(job.error);
    return job?.status === "completed" ? (job.output?.path as string) : null;
  }, label, { timeout: 240_000, polling: 500 });
  return (await finished.jsonValue()) as string;
}

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "orhdr-e2e-"));
  HLG_SOURCE = path.join(work, "fixture-hlg-prores.mov");
  makeHlgProres(HLG_SOURCE);
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

d("source colour management and HDR export in real Electron", () => {
  let clipStart = 0;
  let mediaId = "";

  it("detects the file's colour tags and stores them on the media item", async () => {
    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(HLG_SOURCE);
    await page.getByLabel("Select media fixture-hlg-prores.mov").waitFor({ timeout: 60_000 });
    const item = await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === "fixture-hlg-prores.mov")`);
    mediaId = item.id;
    expect(item.nativeSource?.codec).toBe("prores");
    expect(item.metadata.sourceColor).toMatchObject({ primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl" });
    expect(item.colorInterpretation).toBeUndefined();
  }, 120_000);

  it("shows the tags in Interpret Footage and applies an override as one undoable step", async () => {
    await page.getByRole("button", { name: "Media actions for fixture-hlg-prores.mov" }).click();
    await page.getByRole("menuitem", { name: "Interpret Footage…" }).click();
    const info = page.getByTestId("media-color-info");
    await info.waitFor();
    await expect(await page.getByTestId("media-color-detected").innerText()).toBe("Rec.2020 / HLG / BT.2020nc / limited");
    await expect(await page.getByTestId("media-color-transform").innerText()).toMatch(/tone-mapped/);
    await page.getByTestId("interpret-rec709").check();
    await page.getByTestId("interpret-apply").click();
    await page.waitForFunction((id: string) => (window as any).__openreelE2E.project.getState().project.mediaLibrary.items.find((m: any) => m.id === id).colorInterpretation === "rec709", mediaId, { timeout: 10_000 });
    await E(page, "h.project.getState().undo()");
    expect(await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.id === "${mediaId}").colorInterpretation ?? null`)).toBeNull();
  }, 120_000);

  it("the monitor shows the HLG input transform, matches an independent decode, and Interpret as Rec.709 switches it off", async () => {
    await page.getByRole("button", { name: "Media actions for fixture-hlg-prores.mov" }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.clips.length > 0), undefined, { timeout: 30_000 });
    await sleep(800);
    clipStart = await E(page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].startTime");

    const raw = rawReference(HLG_SOURCE, 12, TW, TH, "area");
    const expected = transformed(raw);
    const rawVsTransformed = meanAbsDiff(raw, expected);
    // Must clear the 6-code match tolerance below, so a monitor showing the raw picture cannot pass as transformed.
    expect(rawVsTransformed, "the transform visibly changes the picture").toBeGreaterThan(8);

    const t = clipStart + 12 / FPS;
    expect(await monitorMatches(t, expected), "monitor equals decode + core input transform").toBeLessThan(6);

    await E(page, `h.project.getState().executeAction({ type: "media/organize", id: crypto.randomUUID(), timestamp: Date.now(), params: { label: "Interpret footage", itemPatches: { "${mediaId}": { colorInterpretation: "rec709" } } } })`);
    expect(await monitorMatches(t, raw), "as Rec.709 the monitor shows the raw code values").toBeLessThan(6);

    await E(page, "h.project.getState().undo()");
    expect(await monitorMatches(t, expected), "undo restores the transform").toBeLessThan(6);
  }, 180_000);

  it("an SDR export of the clip carries the same transform as the monitor (preview and export agree)", async () => {
    const out = await exportClip({ format: "mp4", codec: "h264" }, "SDR 709");
    const n = Math.round(clipStart * FPS) + 12;
    const exported = new Uint8ClampedArray(
      execFileSync(FFMPEG, ["-v", "error", "-i", out, "-vf", `select=eq(n\\,${n}),scale=${TW}:${TH}:flags=area:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 27 }),
    );
    const expected = transformed(rawReference(HLG_SOURCE, 12, TW, TH, "area"));
    const diff = meanAbsDiff(exported, expected);
    console.log(`[hdr-e2e] SDR export vs transformed decode: mean abs diff ${diff.toFixed(2)}`);
    expect(diff).toBeLessThan(8);
  }, 300_000);

  it("HDR10 (PQ) export: HEVC Main10 yuv420p10le, BT.2020, smpte2084, mastering display and content light level", async () => {
    const out = await exportClip({ format: "mp4", codec: "h265", hdr: "pq" }, "HDR10 PQ");
    const { streams, frames } = ffprobe(out);
    console.log(`[hdr-e2e] PQ: ${JSON.stringify(streams[0])}`);
    expect(streams[0]).toMatchObject({ codec_name: "hevc", profile: "Main 10", pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc" });
    const side = frames[0].side_data_list ?? [];
    expect(side.find((s) => s.side_data_type === "Mastering display metadata")).toMatchObject({ max_luminance: "10000000/10000", min_luminance: "1/10000" });
    // The HLG test bars reach about 3.8 times SDR white (203 nits). The mix of
    // saturated colours produces a lower frame average than the brightest pixel.
    const light = side.find((s) => s.side_data_type === "Content light level metadata");
    expect(light?.max_content).toBeGreaterThan(730);
    expect(light?.max_content).toBeLessThan(810);
    expect(light?.max_average).toBeGreaterThan(640);
    expect(light?.max_average).toBeLessThan(Number(light?.max_content));
  }, 300_000);

  it("HDR10 (PQ) export keeps highlights above SDR white: decoded 10-bit luma passes the SDR reference white code", async () => {
    // Scene-referred path: the HLG source's highlights (signal 1.0 is ~3.8x SDR white) go in without a tone map, so the PQ
    // file's luma reaches far above the code of SDR reference white (203 nits, 10-bit code ~573). The classic 8-bit
    // working image could not exceed it.
    const out = await exportClip({ format: "mp4", codec: "h265", hdr: "pq" }, "HDR10 PQ highlights");
    const n = Math.round(clipStart * FPS) + 12;
    const raw = execFileSync(FFMPEG, ["-v", "error", "-i", out, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "-"], { maxBuffer: 1 << 27 });
    let peak = 0;
    for (let i = 0; i < W * H; i++) peak = Math.max(peak, raw.readUInt16LE(i * 2));
    const sdrWhiteCode = 64 + 876 * 0.5807; // PQ signal of 203 nits
    console.log(`[hdr-e2e] PQ export peak luma code ${peak} (SDR white ${sdrWhiteCode.toFixed(0)})`);
    expect(peak).toBeGreaterThan(sdrWhiteCode + 40);
  }, 300_000);

  it("HLG export: arib-std-b67, BT.2020, 10-bit", async () => {
    const out = await exportClip({ format: "mp4", codec: "h265", hdr: "hlg" }, "HLG");
    const { streams } = ffprobe(out);
    expect(streams[0]).toMatchObject({ pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "arib-std-b67", color_space: "bt2020nc" });
  }, 300_000);

  it("ProRes 4444 XQ HDR export: 4:4:4 with BT.2020 PQ tags", async () => {
    const out = await exportClip({ format: "mov", codec: "prores", proresProfile: "4444xq", hdr: "pq" }, "ProRes XQ PQ");
    const { streams } = ffprobe(out);
    expect(streams[0]).toMatchObject({ codec_name: "prores", profile: "XQ", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc" });
    expect(String(streams[0].pix_fmt)).toMatch(/^yuv444p1[02]le$/);
  }, 300_000);
});
