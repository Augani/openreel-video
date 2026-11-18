/**
 * Scan -> plan on files made by a real ffmpeg: ProRes sources are scanned from their packet index and
 * planned as exact-frame copies, and 10-bit / 4:2:2 / HDR sources decline with a reason that names the
 * format. Skipped when no ffmpeg is installed (set FFMPEG to point at one).
 */
import { describe, expect, it, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Clip, MediaItem, Project, Track } from "../types";
import { planSmartRender, type SmartRenderSourceInfo } from "./smart-render";
import { scanSourceForSmartRender } from "./smart-render-scan";

const candidates = [process.env.FFMPEG, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].filter((p): p is string => Boolean(p));
const ffmpeg = candidates.find((p) => existsSync(p));
const work = mkdtempSync(path.join(tmpdir(), "oreel-real-sources-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FPS = 30000 / 1001;
const encoders = ffmpeg ? execFileSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }) : "";

function make(name: string, seconds: number, args: string[]): Blob {
  const file = path.join(work, name);
  execFileSync(ffmpeg!, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=30000/1001:duration=${seconds}`, ...args, file]);
  return new Blob([readFileSync(file)]);
}

const clip = (over: Partial<Clip>): Clip =>
  ({
    id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, effects: [], audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    volume: 1, keyframes: [], ...over,
  }) as Clip;

const project = (blob: Blob, clips: Clip[]): Project =>
  ({
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 320, height: 180, frameRate: FPS, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "m1", name: "a.mov", type: "video", fileHandle: null, blob, thumbnailUrl: null, waveformData: null,
          metadata: { duration: 4, width: 320, height: 180, frameRate: FPS, codec: "x", sampleRate: 48000, channels: 2, fileSize: blob.size, hasVideo: true, hasAudio: false },
        } as MediaItem,
      ],
    },
    timeline: {
      tracks: [{ id: "t1", type: "video", name: "V1", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track],
      subtitles: [], duration: 4, markers: [],
    },
  }) as unknown as Project;

const scan = async (blob: Blob): Promise<SmartRenderSourceInfo | null> => {
  const mediabunny = await import("mediabunny");
  return scanSourceForSmartRender(mediabunny, "m1", blob, "native");
};

describe.skipIf(!ffmpeg)("smart render scan + plan on real files", () => {
  it("scans a ProRes HQ source from its packet index and plans exact-frame copies around an effect", async () => {
    if (!encoders.includes("prores_ks")) return;
    const blob = make("hq.mov", 4, ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]);
    const info = await scan(blob);
    expect(info).toMatchObject({ codec: "prores", proresProfile: "hq", allIntra: true, closedGops: true, constantFrameRate: true, width: 320, height: 180 });
    expect(info!.keyframeTimes).toHaveLength(120);
    expect(info!.frameRate).toBeCloseTo(FPS, 4);

    const total = 120;
    const effect = [{ id: "e", type: "vignette", params: {}, enabled: true }] as never;
    // frames 0-44 untouched, 45-74 (an off-GOP cut: ProRes has no GOPs) get an effect, 75-119 untouched
    const p = project(blob, [
      clip({ id: "a", startTime: 0, duration: (45 * 1001) / 30000, inPoint: 0 }),
      clip({ id: "b", startTime: (45 * 1001) / 30000, duration: (30 * 1001) / 30000, inPoint: (45 * 1001) / 30000, effects: effect }),
      clip({ id: "c", startTime: (75 * 1001) / 30000, duration: (45 * 1001) / 30000, inPoint: (75 * 1001) / 30000 }),
    ]);
    const plan = planSmartRender({
      project: p,
      settings: { format: "mov", codec: "prores", proresProfile: "hq", width: 320, height: 180, frameRate: FPS },
      sources: new Map([["m1", info!]]),
      exportStart: 0,
      totalFrames: total,
      engine: "native",
    });
    expect(plan.eligible).toBe(true);
    expect(plan.segments.map((s) => [s.kind, s.startFrame, s.endFrame])).toEqual([
      ["copy", 0, 45],
      ["encode", 45, 75],
      ["copy", 75, 120],
    ]);
    expect(plan.copiedFrames).toBe(90);
    expect(plan.encodeMatch).toMatchObject({ codec: "prores", proresProfile: "hq" });
  });

  it.each(["webcodecs", "native"] as const)("scans and plans a source that starts at 1.4 s (%s engine): first frame at its own PTS, copied from there", async (engine) => {
    if (!encoders.includes("libx264")) return;
    // 42 frames of 29.97 fps (1.4014 s); the mp4 edit list stores it in 1 ms ticks, so the stream starts at 1.401 s.
    const blob = make(`shifted-${engine}.mp4`, 10, ["-c:v", "libx264", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-bf", "2", "-pix_fmt", "yuv420p", "-output_ts_offset", "1.4014", "-muxdelay", "0"]);
    const info = (await scanSourceForSmartRender(await import("mediabunny"), "m1", blob, engine))!;
    expect(info.firstPts).toBeCloseTo(1.4014, 3);
    expect(info.firstPts).toBeGreaterThan(1.4);
    expect(info.keyframeTimes[0]).toBe(info.firstPts);
    expect(info.constantFrameRate).toBe(true);
    expect(info.closedGops).toBe(true);
    const settings = { format: "mp4", codec: "h264", width: 320, height: 180, frameRate: FPS } as const;
    const frames = Math.round(info.endTime * FPS);

    // Imported as-is (in point 0): media time is the file's own PTS, so the first 42 output frames precede the footage.
    const whole = planSmartRender({ project: project(blob, [clip({ duration: info.endTime, outPoint: info.endTime })]), settings, sources: new Map([["m1", info]]), exportStart: 0, totalFrames: frames, engine });
    expect(whole.eligible).toBe(true);
    expect(whole.segments.map((s) => [s.kind, s.startFrame, s.endFrame])).toEqual([
      ["encode", 0, 42],
      ["copy", 42, frames],
    ]);
    expect(whole.copiedFrames).toBe(300);

    // Trimmed to the footage (in point = first PTS): the whole export is one copy.
    const trimmed = planSmartRender({
      project: project(blob, [clip({ duration: info.endTime - info.firstPts, inPoint: info.firstPts, outPoint: info.endTime })]),
      settings,
      sources: new Map([["m1", info]]),
      exportStart: 0,
      totalFrames: 300,
      engine,
    });
    expect(trimmed.eligible).toBe(true);
    expect(trimmed.copiedFrames).toBe(300);
    expect(trimmed.copiedPercent).toBe(100);
    expect(trimmed.segments[0]).toMatchObject({ kind: "copy", startFrame: 0, sourceStart: info.firstPts });
  });

  it("recognises the ProRes profile from the sample entry", async () => {
    if (!encoders.includes("prores_ks")) return;
    for (const [profile, expected] of [["0", "proxy"], ["1", "lt"], ["2", "standard"]] as const) {
      const info = await scan(make(`p${profile}.mov`, 1, ["-c:v", "prores_ks", "-profile:v", profile, "-pix_fmt", "yuv422p10le"]));
      expect(info?.proresProfile).toBe(expected);
    }
  });

  it("declines ProRes 4444 with the reason", async () => {
    if (!encoders.includes("prores_ks")) return;
    const blob = make("4444.mov", 2, ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuv444p10le"]);
    const info = await scan(blob);
    expect(info?.proresProfile).toBe("4444");
    const plan = planSmartRender({
      project: project(blob, [clip({ duration: 2, outPoint: 2 })]),
      settings: { format: "mov", codec: "prores", proresProfile: "4444", width: 320, height: 180, frameRate: FPS },
      sources: new Map([["m1", info!]]),
      exportStart: 0,
      totalFrames: 60,
      engine: "native",
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reasons.join(" ")).toMatch(/ProRes 4444/);
  });

  it.each([
    ["10-bit H.264", "libx264", ["-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-profile:v", "high10"], "h264", /10-bit \(H\.264 High 10\)/],
    ["4:2:2 H.264", "libx264", ["-c:v", "libx264", "-pix_fmt", "yuv422p", "-profile:v", "high422"], "h264", /4:2:2/],
    ["10-bit HEVC", "libx265", ["-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error", "-tag:v", "hvc1"], "h265", /10-bit \(HEVC Main 10\)/],
    ["4:2:2 HEVC", "libx265", ["-c:v", "libx265", "-pix_fmt", "yuv422p10le", "-x265-params", "log-level=error", "-tag:v", "hvc1"], "h265", /range extensions \(4:2:2/],
  ] as const)("declines %s with a reason that names the format", async (label, encoder, args, codec, pattern) => {
    if (!encoders.includes(encoder)) return;
    const blob = make(`${label.replace(/\W+/g, "-")}.mp4`, 2, [...args]);
    const info = await scan(blob);
    expect(info, `${label} should scan`).not.toBeNull();
    const plan = planSmartRender({
      project: project(blob, [clip({ duration: 2, outPoint: 2 })]),
      settings: { format: "mp4", codec, width: 320, height: 180, frameRate: FPS },
      sources: new Map([["m1", info!]]),
      exportStart: 0,
      totalFrames: 60,
      engine: "native",
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reasons.join(" ")).toMatch(pattern);
    expect(plan.reasons.join(" ")).toMatch(/8-bit 4:2:0 SDR sources only/);
  });
});
