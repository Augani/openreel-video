import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { probeMediaFile } from "../src/main/ingest/probe-media";
import { WATCH_EXPORT_PRESET_IDS } from "../src/shared/watch-folders";
import { WATCH_PRESETS, buildWatchRenderArgs, classifyFile, isWatchPresetId, parseOutTimeSeconds, renderMediaFile, uniquePath, type RenderDeps } from "../src/main/watch/render";

const bundled = path.resolve(__dirname, `../resources/bin/${process.platform}-${process.arch}/ffmpeg`);
const FFMPEG = fs.existsSync(bundled) ? bundled : "ffmpeg";
process.env.OPENREEL_FFMPEG_PATH = FFMPEG; // probeMediaFile resolves ffmpeg through the app's sidecar path
const haveFfmpeg = spawnSync(FFMPEG, ["-version"]).status === 0;
const haveFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;

describe("watch render planning", () => {
  it("has a preset for every id the settings UI offers", () => {
    for (const id of WATCH_EXPORT_PRESET_IDS) expect(isWatchPresetId(id)).toBe(true);
    expect(isWatchPresetId("youtube-4k")).toBe(false);
    expect(Object.keys(WATCH_PRESETS).sort()).toEqual([...WATCH_EXPORT_PRESET_IDS].sort());
  });

  it("classifies files by extension", () => {
    expect(classifyFile("/x/a.MOV")).toBe("video");
    expect(classifyFile("/x/a.wav")).toBe("audio");
    expect(classifyFile("/x/a.oreel")).toBe("project");
    expect(classifyFile("/x/a.openreel")).toBe("project");
    expect(classifyFile("/x/a.png")).toBe("other");
    expect(classifyFile("/x/a")).toBe("other");
  });

  it("builds fixed-size presets as fit-and-pad at the preset frame rate", () => {
    const plan = buildWatchRenderArgs("1080p-60", "/in/a.mov", "/out/a.mp4", { hasVideo: true, hasAudio: true }, "libx264");
    expect(plan.ext).toBe("mp4");
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(vf).toContain("pad=1920:1080");
    expect(vf).toContain("fps=60");
    expect(plan.args).toContain("25000k");
    expect(plan.args.at(-1)).toBe("/out/a.mp4");
  });

  it("keeps the source size and frame rate for the standard preset, forcing even dimensions", () => {
    const plan = buildWatchRenderArgs("mp4", "/in/a.mov", "/out/a.mp4", { hasVideo: true, hasAudio: false });
    const vf = plan.args[plan.args.indexOf("-vf") + 1];
    expect(vf).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(plan.args).not.toContain("-c:a");
  });

  it("makes WAV for the audio preset and AAC for an audio file under a video preset", () => {
    expect(buildWatchRenderArgs("wav", "/in/a.mov", "/out/a.wav", { hasVideo: true, hasAudio: true }).ext).toBe("wav");
    expect(buildWatchRenderArgs("1080p-high", "/in/a.wav", "/out/a.m4a", { hasVideo: false, hasAudio: true }).ext).toBe("m4a");
  });

  it("refuses sources that cannot make the output", () => {
    expect(() => buildWatchRenderArgs("wav", "/in/a.mov", "/o", { hasVideo: true, hasAudio: false })).toThrow(/no audio/);
    expect(() => buildWatchRenderArgs("mp4", "/in/a.mov", "/o", { hasVideo: false, hasAudio: false })).toThrow(/neither video nor audio/);
  });

  it("reads progress from ffmpeg's out_time and picks unique output names", () => {
    expect(parseOutTimeSeconds("frame=1\nout_time_us=1500000\nprogress=continue\nout_time_us=2500000")).toBe(2.5);
    expect(parseOutTimeSeconds("nothing")).toBeNull();
    const taken = new Set([path.join("/o", "a.mp4"), path.join("/o", "a-1.mp4")]);
    expect(uniquePath("/o", "a", "mp4", (p) => taken.has(p))).toBe(path.join("/o", "a-2.mp4"));
    expect(uniquePath("/o", "b", "mp4", (p) => taken.has(p))).toBe(path.join("/o", "b.mp4"));
  });
});

// Real encodes (1080p H.264 of a 2 s clip) are slow on shared CI runners; give them room.
const FFMPEG_TEST_TIMEOUT = 60_000;

describe.skipIf(!haveFfmpeg)("watch render with a real ffmpeg", { timeout: FFMPEG_TEST_TIMEOUT }, () => {
  let dir = "";
  let clip = "";
  const deps: RenderDeps = {
    ffmpegPath: () => FFMPEG,
    probe: async (file) => {
      const probe = await probeMediaFile(file);
      if (!probe) throw new Error("unreadable");
      return probe;
    },
    videoEncoder: async () => "libx264",
    isHardwareEncoder: () => false,
  };
  beforeAll(() => {
    dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "watch-render-")));
    clip = path.join(dir, "source.mov");
    execFileSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", clip]);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const streams = (file: string) =>
    JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", file]).toString()).streams as Array<{ codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate: string }>;

  it.skipIf(!haveFfprobe)("renders 1080p-high: 1920x1080 H.264 at 30 fps with audio, written atomically", async () => {
    const out = path.join(dir, "out");
    const progress: Array<number | null> = [];
    const result = await renderMediaFile({ src: clip, presetId: "1080p-high", outputDir: out, onProgress: (f) => progress.push(f), signal: new AbortController().signal }, deps);
    expect(result).toBe(path.join(out, "source.mp4"));
    const found = streams(result);
    const video = found.find((s) => s.codec_type === "video")!;
    expect(video).toMatchObject({ codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1" });
    expect(found.some((s) => s.codec_type === "audio")).toBe(true);
    expect(fs.readdirSync(out)).toEqual(["source.mp4"]); // no partial file left behind
    expect(progress.at(-1)).toBe(1);
    // A second render of the same name never overwrites.
    const again = await renderMediaFile({ src: clip, presetId: "mp4", outputDir: out, onProgress: () => undefined, signal: new AbortController().signal }, deps);
    expect(path.basename(again)).toBe("source-1.mp4");
    expect(streams(again).find((s) => s.codec_type === "video")).toMatchObject({ width: 1280, height: 720 });
  });

  it.skipIf(!haveFfprobe)("renders the audio preset to a 24-bit 48 kHz WAV", async () => {
    const result = await renderMediaFile({ src: clip, presetId: "wav", outputDir: path.join(dir, "wav"), onProgress: () => undefined, signal: new AbortController().signal }, deps);
    expect(path.extname(result)).toBe(".wav");
    expect(streams(result)).toMatchObject([{ codec_type: "audio", codec_name: "pcm_s24le" }]);
  });

  it("fails with ffmpeg's reason on a file that is not media, and leaves nothing behind", async () => {
    const bad = path.join(dir, "bad.mov");
    fs.writeFileSync(bad, "this is not a video");
    const out = path.join(dir, "out-bad");
    await expect(renderMediaFile({ src: bad, presetId: "mp4", outputDir: out, onProgress: () => undefined, signal: new AbortController().signal }, deps)).rejects.toThrow();
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
  });

  it("stops a render when it is cancelled", async () => {
    const controller = new AbortController();
    const out = path.join(dir, "out-cancel");
    const pending = renderMediaFile({ src: clip, presetId: "4k", outputDir: out, onProgress: () => undefined, signal: controller.signal }, deps);
    setTimeout(() => controller.abort(), 150);
    await expect(pending).rejects.toThrow(/Cancelled/);
    expect(fs.readdirSync(out)).toEqual([]);
  });
});
