import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildProxyArgs } from "../src/main/ingest/proxy-args";
import { pickBurnInFont } from "../src/main/ingest/proxy-runner";
import { BUILTIN_INGEST_PRESETS } from "../../../packages/core/src/media/ingest-presets";
import type { DesktopProxyProfile } from "../../../packages/core/src/types/project";

// The bundled sidecar (a full build with drawtext) when it is present, else ffmpeg on the PATH.
const bundled = join(__dirname, `../resources/bin/${process.platform}-${process.arch}/${process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"}`);
const ffmpeg = process.env.OPENREEL_FFMPEG_PATH ?? (existsSync(bundled) ? bundled : "ffmpeg");
const have = spawnSync(ffmpeg, ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const hasDrawtext = have && /drawtext/.test(spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout);
const font = pickBurnInFont();

interface Stream { codec_type: string; codec_name: string; profile?: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string; sample_rate?: string }
const probe = (file: string): Stream[] =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate", "-of", "json", file]).toString()).streams;
const video = (file: string): Stream => probe(file).find((s) => s.codec_type === "video")!;

describe.skipIf(!have)("ingest presets produce real files with ffmpeg", () => {
  const dir = mkdtempSync(join(tmpdir(), "openreel-ingest-presets-"));
  const src = join(dir, "src.mp4");
  beforeAll(() => {
    // 1280x720 at 29.97 with stereo audio.
    execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30000/1001:duration=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", src]);
    return () => rmSync(dir, { recursive: true, force: true });
  });
  const make = (name: string, profile: DesktopProxyProfile, extra: { previewOutPath?: string; clipName?: string } = {}) => {
    const ext = profile.codec === "h264" ? "mp4" : "mov";
    const out = join(dir, `${name}.${ext}`);
    const args = buildProxyArgs({ srcPath: src, outPath: out, srcWidth: 1280, srcHeight: 720, threads: 2, profile, frameRate: 29.97, fontFile: font, ...extra });
    const run = spawnSync(ffmpeg, args, { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    return out;
  };

  const codecs: Array<[DesktopProxyProfile["codec"], string, string | undefined, string]> = [
    ["prores-proxy", "prores", "Proxy", "yuv422p10le"],
    ["prores-lt", "prores", "LT", "yuv422p10le"],
    ["prores-422", "prores", "Standard", "yuv422p10le"],
    ["dnxhr-lb", "dnxhd", "DNXHR LB", "yuv422p"],
    ["dnxhr-sq", "dnxhd", "DNXHR SQ", "yuv422p"],
    ["h264", "h264", undefined, "yuv420p"],
  ];
  for (const [codec, name, profileName, pixFmt] of codecs) {
    it(`${codec}: ${name}${profileName ? ` (${profileName})` : ""}, ${pixFmt}, half size, frame rate kept, audio kept`, () => {
      const out = make(`c-${codec}`, { codec, size: "half" });
      const v = video(out);
      expect(v.codec_name).toBe(name);
      if (profileName) expect(v.profile).toBe(profileName);
      expect(v.pix_fmt).toBe(pixFmt);
      expect([v.width, v.height]).toEqual([640, 360]);
      expect(v.r_frame_rate).toBe("30000/1001");
      expect(probe(out).some((s) => s.codec_type === "audio")).toBe(true);
    });
  }

  it("sizes: full, quarter, 720p and a custom width", () => {
    const size = (s: DesktopProxyProfile["size"], customWidth?: number) => {
      const v = video(make(`s-${s}-${customWidth ?? 0}`, { codec: "h264", size: s, ...(customWidth ? { customWidth } : {}) }));
      return [v.width, v.height];
    };
    expect(size("full")).toEqual([1280, 720]);
    expect(size("quarter")).toEqual([320, 180]);
    expect(size("720p")).toEqual([1280, 720]);
    expect(size("custom", 480)).toEqual([480, 270]);
    // Never upscales.
    expect(size("custom", 4000)).toEqual([1280, 720]);
  });

  it("audio strip leaves no audio stream, in every container", () => {
    for (const codec of ["h264", "prores-lt", "dnxhr-lb"] as const) {
      const out = make(`na-${codec}`, { codec, size: "half", audio: "strip" });
      expect(probe(out).some((s) => s.codec_type === "audio")).toBe(false);
    }
  });

  it("the preview twin of an intermediate proxy is an H.264 mp4 of the same size", () => {
    const twin = join(dir, "twin.preview.mp4");
    const out = make("twin", { codec: "prores-422", size: "half" }, { previewOutPath: twin });
    expect(video(out).codec_name).toBe("prores");
    expect(video(twin).codec_name).toBe("h264");
    expect(video(twin).height).toBe(360);
  });

  it("the built-in presets each build a file of their codec", () => {
    for (const preset of BUILTIN_INGEST_PRESETS.filter((p) => !p.profile.burnIn)) {
      const v = video(make(`b-${preset.id}`, preset.profile));
      expect(v.codec_name).toBe(preset.profile.codec === "h264" ? "h264" : preset.profile.codec.startsWith("prores") ? "prores" : "dnxhd");
    }
  });

  describe.skipIf(!hasDrawtext || !font)("burn-in (needs a drawtext build and an installed font)", () => {
    // The first frame as raw bytes: any burned-in text changes them.
    const frameHash = (file: string): string =>
      execFileSync(ffmpeg, ["-v", "error", "-i", file, "-frames:v", "1", "-f", "md5", "-"]).toString().trim();
    it("clip name and timecode change the picture; either alone does too, and they differ from each other", () => {
      const plain = make("bi-plain", { codec: "h264", size: "half" });
      const name = make("bi-name", { codec: "h264", size: "half", burnIn: { clipName: true } }, { clipName: "Interview A" });
      const tc = make("bi-tc", { codec: "h264", size: "half", burnIn: { timecode: true } });
      const both = make("bi-both", { codec: "h264", size: "half", burnIn: { clipName: true, timecode: true } }, { clipName: "Interview A" });
      const hashes = [plain, name, tc, both].map(frameHash);
      expect(new Set(hashes).size).toBe(4);
      expect(video(both).codec_name).toBe("h264");
      expect([video(both).width, video(both).height]).toEqual([640, 360]);
    });
    it("burn-in in a ProRes proxy keeps the codec, profile and size", () => {
      const out = make("bi-prores", { codec: "prores-lt", size: "half", burnIn: { clipName: true, timecode: true } }, { clipName: "It's: A, clip;[1]%{x}" });
      const v = video(out);
      expect([v.codec_name, v.profile, v.width, v.height]).toEqual(["prores", "LT", 640, 360]);
    });
    it("the timecode runs: the last frame differs from the first (a counting timecode, not a still)", () => {
      const out = make("bi-run", { codec: "h264", size: "half", burnIn: { timecode: true } });
      const last = execFileSync(ffmpeg, ["-v", "error", "-sseof", "-0.1", "-i", out, "-frames:v", "1", "-f", "md5", "-"]).toString().trim();
      const first = frameHash(out);
      const plainLast = execFileSync(ffmpeg, ["-v", "error", "-sseof", "-0.1", "-i", make("bi-run-plain", { codec: "h264", size: "half" }), "-frames:v", "1", "-f", "md5", "-"]).toString().trim();
      expect(last).not.toBe(first);
      expect(last).not.toBe(plainLast);
    });
  });
});
