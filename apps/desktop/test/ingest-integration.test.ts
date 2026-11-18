import { vi } from "vitest";
import { existsSync } from "node:fs";

// Real ffmpeg: the bundled sidecar when fetched, else OPENREEL_FFMPEG_PATH, else Homebrew's. Skipped when none exists.
const candidates = [process.env.OPENREEL_FFMPEG_PATH, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter((p): p is string => Boolean(p));
const ffmpegBin = candidates.find((p) => existsSync(p));
if (ffmpegBin) process.env.OPENREEL_FFMPEG_PATH = ffmpegBin;

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeMediaFile } from "../src/main/ingest/probe-media";
import { ProxyQueue, type ProxyJob, type ProxyJobInput, type ProxyQueueStore } from "../src/main/ingest/proxy-queue";
import { runProxyJob } from "../src/main/ingest/proxy-runner";

const run = promisify(execFile);
const d = ffmpegBin ? describe : describe.skip;

let work = "";
let clip4k = "";
let longClip = "";

function makeClip(out: string, seconds: number, size: string): void {
  execFileSync(ffmpegBin!, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=s=${size}:r=24`,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
}

const input = (mediaId: string, srcPath: string, over: Partial<ProxyJobInput> = {}): ProxyJobInput => ({
  projectKey: "p1",
  mediaId,
  srcPath,
  outDir: path.join(work, "Proxies"),
  fileName: `${mediaId}_half_proxy.mov`,
  profile: { codec: "prores-proxy", size: "half" },
  previewTwin: false,
  ...over,
});
const asJob = (i: ProxyJobInput): ProxyJob => ({ ...i, id: `${i.projectKey}:${i.mediaId}`, status: "running", progress: 0, attempts: 1, enqueuedAt: 0 });

beforeAll(() => {
  if (!ffmpegBin) return;
  work = mkdtempSync(path.join(os.tmpdir(), "oringest-int-"));
  clip4k = path.join(work, "clip4k.mp4");
  longClip = path.join(work, "long4k.mp4");
  makeClip(clip4k, 3, "3840x2160");
  makeClip(longClip, 12, "3840x2160");
}, 120_000);
afterAll(async () => {
  if (work) await fs.rm(work, { recursive: true, force: true });
});

d("native proxy runner (real ffmpeg)", () => {
  it("builds a ProRes 422 Proxy .mov at half resolution from a 4K source", async () => {
    const progress: number[] = [];
    const out = await runProxyJob(asJob(input("a", clip4k)), (p) => progress.push(p), new AbortController().signal);
    expect(out).toMatchObject({ width: 1920, height: 1080, codec: "prores" });
    expect(out.frameRate).toBeCloseTo(24, 0);
    expect(out.duration).toBeCloseTo(3, 0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true);
    const { stdout } = await run("/opt/homebrew/bin/ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,profile,width,height,pix_fmt", "-of", "json", out.outPath]).catch(() => ({ stdout: "{}" }));
    const stream = (JSON.parse(stdout) as { streams?: Array<Record<string, string | number>> }).streams?.[0];
    if (stream) expect(stream).toMatchObject({ codec_name: "prores", profile: "Proxy", width: 1920, height: 1080, pix_fmt: "yuv422p10le" });
    // No leftovers: the final file only.
    expect((await fs.readdir(path.join(work, "Proxies"))).filter((f) => f.startsWith("a_"))).toEqual(["a_half_proxy.mov"]);
    // The original is still there, untouched.
    expect(existsSync(clip4k)).toBe(true);
  }, 120_000);

  it("writes an H.264 preview twin from the same decode when asked", async () => {
    const out = await runProxyJob(asJob(input("b", clip4k, { previewTwin: true })), () => undefined, new AbortController().signal);
    expect(out.previewPath).toBe(path.join(work, "Proxies", "b_half_proxy.preview.mp4"));
    const twin = await probeMediaFile(out.previewPath!);
    expect(twin).toMatchObject({ width: 1920, height: 1080, videoCodec: "h264", hasAudio: true });
    const main = await probeMediaFile(out.outPath);
    expect(main?.videoCodec).toBe("prores");
  }, 120_000);

  it("builds an H.264 .mp4 at quarter resolution", async () => {
    const out = await runProxyJob(asJob(input("c", clip4k, { fileName: "c_quarter_proxy.mp4", profile: { codec: "h264", size: "quarter" } })), () => undefined, new AbortController().signal);
    expect(out).toMatchObject({ width: 960, height: 540, codec: "h264" });
  }, 120_000);

  it("runs ffmpeg at low priority (nice 10) so editing stays snappy", async () => {
    const controller = new AbortController();
    const job = asJob(input("n", longClip));
    const pending = runProxyJob(job, () => undefined, controller.signal).catch(() => undefined);
    let nice: number | null = null;
    for (let i = 0; i < 100 && nice === null; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const { stdout } = await run("ps", ["-axo", "ni=,command="]);
      const line = stdout.split("\n").find((l) => l.includes("n_half_proxy.mov.part"));
      if (line) nice = Number(line.trim().split(/\s+/)[0]);
    }
    controller.abort();
    await pending;
    expect(nice).toBe(10);
  }, 120_000);

  it("cancel kills ffmpeg and leaves no partial file", async () => {
    const controller = new AbortController();
    const pending = runProxyJob(asJob(input("x", longClip)), () => undefined, controller.signal);
    await new Promise((r) => setTimeout(r, 1200));
    controller.abort();
    await expect(pending).rejects.toThrow();
    const files = await fs.readdir(path.join(work, "Proxies"));
    expect(files.filter((f) => f.startsWith("x_"))).toEqual([]);
  }, 120_000);

  it("fails with a readable message for a missing source and for a non-video file", async () => {
    await expect(runProxyJob(asJob(input("m", path.join(work, "gone.mov"))), () => undefined, new AbortController().signal)).rejects.toThrow(/missing/);
    const txt = path.join(work, "t.txt");
    await fs.writeFile(txt, "not media");
    await expect(runProxyJob(asJob(input("t", txt)), () => undefined, new AbortController().signal)).rejects.toThrow(/video stream/);
  }, 60_000);
});

d("queue + runner end to end (real ffmpeg)", () => {
  it("builds proxies in the background, one at a time, and resumes after a simulated restart", async () => {
    const store: ProxyQueueStore & { saved: ProxyJob[] } = {
      saved: [],
      load: () => store.saved.map((j) => ({ ...j })),
      save: (jobs) => {
        store.saved = jobs.map((j) => ({ ...j }));
      },
    };
    const outDir = path.join(work, "QueueProxies");
    const first = new ProxyQueue({ store, run: (job, p, s) => runProxyJob(job, p, s, 1) });
    first.enqueue([
      input("q1", longClip, { outDir, fileName: "q1_half_proxy.mov" }),
      input("q2", clip4k, { outDir, fileName: "q2_half_proxy.mov" }),
    ]);
    await new Promise((r) => setTimeout(r, 1000));
    // Quit while q1 runs: it goes back to queued on disk, ffmpeg is stopped.
    first.shutdown();
    await new Promise((r) => setTimeout(r, 500));
    expect(store.saved.map((j) => [j.mediaId, j.status])).toEqual([["q1", "queued"], ["q2", "queued"]]);
    expect(existsSync(path.join(outDir, "q1_half_proxy.mov"))).toBe(false);

    // "Relaunch".
    const second = new ProxyQueue({ store, run: (job, p, s) => runProxyJob(job, p, s, 1) });
    second.restore();
    await second.whenIdle();
    expect(second.list().map((j) => [j.mediaId, j.status])).toEqual([["q1", "done"], ["q2", "done"]]);
    expect(existsSync(path.join(outDir, "q1_half_proxy.mov"))).toBe(true);
    expect(existsSync(path.join(outDir, "q2_half_proxy.mov"))).toBe(true);
    expect(second.list()[0].result).toMatchObject({ width: 1920, height: 1080 });
  }, 180_000);
});
