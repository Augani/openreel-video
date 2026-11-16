import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

import { buildFfmpegArgs, type ExportArgs } from "../src/main/sidecar/export-job";

const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) => existsSync(p));
const FFPROBE = FFMPEG?.replace(/ffmpeg$/, "ffprobe");

const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHello broadcast\n\n2\n00:00:03,000 --> 00:00:04,500\nSecond cue\n";
// "Hello" at 1.00 s to 3.00 s (29.97 non-drop), hand-checked in core scc.test.ts.
const SCC = [
  "Scenarist_SCC V1.0",
  "",
  "00:00:00:19\t9420 9420 94ae 94ae 9476 9476 97a1 97a1 c8e5 ecec ef80 942f 942f",
  "",
  "00:00:03:00\t942c 942c",
  "",
].join("\n");

/** Runs the real arguments buildFfmpegArgs produces, feeding raw frames and a WAV like the app does. */
function runExport(dir: string, format: "mp4" | "mov", captionInputs: ExportArgs["captionInputs"]): string {
  const wav = join(dir, "a.wav");
  execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ar", "48000", "-ac", "2", wav]);
  const output = join(dir, `out.${format}`);
  const width = 64;
  const height = 36;
  const args = buildFfmpegArgs({
    width, height, frameRate: 30, codec: "h264", encoder: "libx264", mode: "fast", quality: 70,
    bitrateKbps: 500, outputPath: output, audioWavPath: wav, format, captionInputs,
  });
  const frames = Buffer.alloc(width * height * 4 * 150, 0x80);
  const run = spawnSync(FFMPEG!, args, { input: frames, encoding: "buffer" });
  expect(run.status, run.stderr.toString().slice(-600)).toBe(0);
  return output;
}

const streams = (file: string) =>
  JSON.parse(execFileSync(FFPROBE!, ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" })).streams as Array<Record<string, any>>;

describe.skipIf(!FFMPEG)("embedded captions through the real ffmpeg argument list", () => {
  it("writes a tx3g (mov_text) subtitle track in MP4 and the cues can be extracted", () => {
    const dir = mkdtempSync(join(tmpdir(), "caption-mux-"));
    const srt = join(dir, "c.srt");
    writeFileSync(srt, SRT);
    const file = runExport(dir, "mp4", [{ path: srt, kind: "mov_text", language: "eng" }]);
    const subs = streams(file).filter((s) => s.codec_type === "subtitle");
    expect(subs).toHaveLength(1);
    expect(subs[0].codec_name).toBe("mov_text");
    expect(subs[0].tags?.language).toBe("eng");
    const extracted = execFileSync(FFMPEG!, ["-v", "error", "-i", file, "-map", "0:s:0", "-f", "srt", "-"], { encoding: "utf8" });
    expect(extracted).toContain("Hello broadcast");
    expect(extracted).toContain("00:00:01,000 --> 00:00:02,500");
    expect(extracted).toContain("Second cue");
  });

  it("writes a CEA-608 (c608) track in MOV and ffmpeg's 608 decoder reads the caption back", () => {
    const dir = mkdtempSync(join(tmpdir(), "caption-mux-"));
    const scc = join(dir, "c.scc");
    writeFileSync(scc, SCC);
    const file = runExport(dir, "mov", [{ path: scc, kind: "cea608", language: "eng" }]);
    const subs = streams(file).filter((s) => s.codec_type === "subtitle");
    expect(subs).toHaveLength(1);
    expect(subs[0].codec_name).toBe("eia_608");
    expect(subs[0].codec_tag_string).toBe("c608");
    const extracted = execFileSync(FFMPEG!, ["-v", "error", "-i", file, "-map", "0:s:0", "-f", "srt", "-"], { encoding: "utf8" });
    expect(extracted).toContain("Hello");
    // the file still has its picture and sound
    expect(streams(file).map((s) => s.codec_type).sort()).toEqual(["audio", "subtitle", "video"]);
  });
});
