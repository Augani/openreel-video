/**
 * Real-Electron test for native ProRes decode (Playwright _electron, the BUILT app).
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * and ffmpeg on disk. Opt in with OPENREEL_DESKTOP_PRORES_E2E=1:  pnpm --filter @openreel/desktop test:prores-e2e
 *
 * Proves, with a ProRes 422 HQ fixture generated here with `ffmpeg -c:v prores_ks`:
 *  - the file imports on the desktop with no proxy (no queue entry, no warning) even though Chromium cannot decode ProRes;
 *  - the program monitor shows the correct frame at several times (compared with ffmpeg's own decode of the source);
 *  - scrubbing is served by the sidecar decoder (frame requests were made over IPC), and its latency is printed;
 *  - the export decodes every frame at full quality through the same frame source and its pixels match the source.
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
  process.env.OPENREEL_DESKTOP_PRORES_E2E === "1" &&
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

const W = 1280;
const H = 720;
const FPS = 24;
const SECONDS = 4;
/** Thumbnail used to compare the monitor with the source. */
const TW = 160;
const TH = 90;

let work = "";
let PRORES = "";
let app: any;
let page: any;

function makeProres(out: string): void {
  // testsrc2 changes every frame (frame counter, moving bars), so a wrong frame is easy to tell from the right one.
  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
    "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "pcm_s16le", "-shortest", out,
  ]);
}

/** ffmpeg's decode of the source frame shown at `t`, scaled to a comparison thumbnail (RGBA bytes). */
function referenceThumb(file: string, t: number, w = TW, h = TH): Buffer {
  const n = Math.floor(t * FPS + 1e-6);
  return execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${w}:${h}:flags=area:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
}

const meanAbsDiff = (a: Uint8Array, b: Uint8Array): number => {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};

/** The program monitor's current pixels as a thumbnail. */
async function monitorThumb(): Promise<Buffer> {
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
  return Buffer.from(data);
}

async function seek(t: number): Promise<void> {
  await page.evaluate((s: number) => (window as any).__openreelE2E.timeline.getState().seekTo(s), t);
}

/** Seek and poll the monitor until it shows the frame for `t`. Returns the wall-clock milliseconds it took. */
async function seekUntilShown(t: number, clipStart: number, reference: Buffer, timeout = 8_000): Promise<{ ms: number; diff: number }> {
  const started = Date.now();
  await seek(clipStart + t);
  let diff = Infinity;
  for (;;) {
    diff = meanAbsDiff(await monitorThumb(), reference);
    if (diff < 6 || Date.now() - started > timeout) return { ms: Date.now() - started, diff };
    await sleep(15);
  }
}

beforeAll(async () => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "orprores-e2e-"));
  PRORES = path.join(work, "fixture-prores422hq.mov");
  makeProres(PRORES);
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

d("native ProRes decode in real Electron", () => {
  let clipStart = 0;
  let mediaId = "";

  it("imports ProRes with no proxy and no browser-side transcode", async () => {
    await page.locator('[data-tour="assets"] input[type="file"]').setInputFiles(PRORES);
    await page.getByLabel("Select media fixture-prores422hq.mov").waitFor({ timeout: 60_000 });
    const item = await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.name === "fixture-prores422hq.mov")`);
    mediaId = item.id;
    expect(item.type).toBe("video");
    expect(item.metadata).toMatchObject({ width: W, height: H });
    expect(item.proxy ?? null).toBeNull();
    // Chromium cannot decode ProRes: this is what the sidecar replaces.
    expect(await page.evaluate(async () => (await VideoDecoder.isConfigSupported({ codec: "apcn", codedWidth: 1280, codedHeight: 720 })).supported)).toBe(false);
    expect(await E(page, `Object.keys(h.proxy.desktop.store.getState().jobs).length`)).toBe(0);
    expect(await E(page, `h.proxy.cache.store.getState().entries["${mediaId}"] ?? null`)).toBeNull();
    // The imported blob still is the original ProRes file (not an H.264 transcode).
    expect(await E(page, `h.project.getState().project.mediaLibrary.items.find((m) => m.id === "${mediaId}").blob.size`)).toBe(fs.statSync(PRORES).size);
    const probe = await page.evaluate((p: string) => (window as any).openreel.media.nativeProbe({ path: p }), PRORES);
    expect(probe).toMatchObject({ codec: "prores", width: W, height: H, frameRate: FPS });
  }, 120_000);

  it("places the clip and the monitor shows the correct frame at several times, without a proxy", async () => {
    await page.getByRole("button", { name: "Media actions for fixture-prores422hq.mov" }).click();
    await page.getByRole("menuitem", { name: "Add to timeline" }).click();
    await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
    await page.waitForFunction(() => (window as any).__openreelE2E.project.getState().project.timeline.tracks.some((t: any) => t.clips.length > 0), undefined, { timeout: 30_000 });
    await sleep(800);
    clipStart = await E(page, "h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].startTime");

    const times = [0, 1.0, 2.5, 0.5, 3.25];
    const refs = new Map(times.map((t) => [t, referenceThumb(PRORES, t)]));
    for (const t of times) {
      const shown = await seekUntilShown(t, clipStart, refs.get(t)!);
      console.log(`[prores] t=${t}s shown in ${shown.ms} ms, mean abs diff vs ffmpeg decode ${shown.diff.toFixed(2)}`);
      expect(shown.diff, `monitor at ${t}s matches the source frame`).toBeLessThan(6);
      // It is that frame and not a neighbouring second's.
      for (const other of times.filter((x) => x !== t)) {
        expect(meanAbsDiff(await monitorThumb(), refs.get(other)!), `monitor at ${t}s is not the frame from ${other}s`).toBeGreaterThan(shown.diff);
      }
    }
    const stats = await page.evaluate(() => (window as any).openreel.media.nativeStats());
    expect(stats.framesDecoded).toBeGreaterThan(0);
    expect(await E(page, `h.proxy.cache.store.getState().entries["${mediaId}"] ?? null`)).toBeNull();
    expect(await E(page, `Object.keys(h.proxy.desktop.store.getState().jobs).length`)).toBe(0);
  }, 180_000);

  it("scrubs: measures seek-to-correct-pixels latency and IPC frame round trips", async () => {
    await E(page, "h.nativeDecode.clear()");
    const targets = [0.2, 3.1, 1.7, 2.9, 0.8, 2.2, 3.6, 1.1, 0.4, 2.6, 1.4, 3.3];
    const refs = targets.map((t) => referenceThumb(PRORES, t));
    const ms: number[] = [];
    for (let i = 0; i < targets.length; i++) {
      const shown = await seekUntilShown(targets[i], clipStart, refs[i]);
      expect(shown.diff).toBeLessThan(6);
      ms.push(shown.ms);
    }
    // A drag: many small steps in one go, nothing may be left stuck on an old frame.
    const dragStart = Date.now();
    for (let t = 1; t < 2; t += 1 / FPS) await seek(clipStart + t);
    const last = referenceThumb(PRORES, 1.96);
    const settle = await seekUntilShown(1.96, clipStart, last);
    ms.sort((a, b) => a - b);
    const pct = (p: number) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))];
    const samples: Array<{ ms: number }> = await E(page, "[...h.nativeDecode.samples()]");
    const ipc = samples.map((s) => s.ms).sort((a, b) => a - b);
    console.log(`[prores] scrub (random seeks, ${W}x${H} ProRes 422 HQ, monitor refreshes ~ every 15 ms): seek-to-correct-pixels p50 ${pct(50)} ms, p95 ${pct(95)} ms, max ${ms[ms.length - 1]} ms`);
    console.log(`[prores] drag of ${FPS} steps then settle: ${Date.now() - dragStart} ms total; settled on the right frame in ${settle.ms} ms`);
    console.log(`[prores] IPC frame round trips: n=${ipc.length}, p50 ${ipc[Math.floor(ipc.length / 2)]?.toFixed(1)} ms, p95 ${ipc[Math.floor(ipc.length * 0.95)]?.toFixed(1)} ms, max ${ipc[ipc.length - 1]?.toFixed(1)} ms`);
    expect(ipc.length).toBeGreaterThan(0);
    expect(settle.diff).toBeLessThan(6);
  }, 180_000);

  it("exports from the same frame source at full quality and the pixels match the source", async () => {
    const before = await page.evaluate(() => (window as any).openreel.media.nativeStats());
    await E(page, `h.exportQueue.getState().enqueue({ settings: { width: ${W}, height: ${H}, frameRate: ${FPS}, format: "mp4", codec: "h264", bitrate: 60000 }, presetLabel: "720p" })`);
    await E(page, "h.exportQueue.getState().start()");
    const finished = await page.waitForFunction(() => {
      const job = (window as any).__openreelE2E.exportQueue.getState().queue.jobs[0];
      if (job?.status === "failed") throw new Error(job.error);
      return job?.status === "completed" ? { path: job.output?.path as string, note: job.sourceMedia as string } : null;
    }, undefined, { timeout: 240_000, polling: 500 });
    const out = (await finished.jsonValue()) as { path: string; note: string };
    const after = await page.evaluate(() => (window as any).openreel.media.nativeStats());
    console.log(`[prores] export: ${out.path}; report: ${out.note}`);
    // Every exported frame came through the full-quality decode path.
    expect(after.fullQualityFrames - before.fullQualityFrames).toBeGreaterThanOrEqual(FPS * SECONDS - 2);

    const frameAt = (file: string, n: number): Buffer =>
      execFileSync(FFMPEG, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${W}:${H}:flags=bicubic:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 27 });
    const psnr = (a: Buffer, b: Buffer): number => {
      let se = 0;
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const dlt = a[i + c] - b[i + c];
          se += dlt * dlt;
          n++;
        }
      }
      return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
    };
    const results: string[] = [];
    // Offset: the clip starts at `clipStart` on the timeline; the export begins at 0.
    for (const n of [0, 12, 30, 59, 77, 95]) {
      const exportIndex = n + Math.round(clipStart * FPS);
      const score = psnr(frameAt(out.path, exportIndex), frameAt(PRORES, n));
      results.push(`frame ${n}: ${score.toFixed(1)} dB`);
      expect(score, `export frame ${n} vs the ProRes source`).toBeGreaterThan(33);
    }
    console.log(`[prores] export vs source PSNR (H.264 @ 60 Mb/s, so only encode loss): ${results.join(", ")}`);
  }, 300_000);
});
