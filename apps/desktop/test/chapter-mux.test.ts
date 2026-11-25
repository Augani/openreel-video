import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

import { buildAssembleArgs } from "../src/main/sidecar/smart-export";
import { buildFfmpegArgs, canHoldChapters, chapterMuxArgs, type ExportArgs } from "../src/main/sidecar/export-job";
import { isChaptersMetadata } from "../src/main/ipc/export";
import { chaptersToFfMetadata, deliveryChapters } from "../../../packages/core/src/export/chapters";

const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) => existsSync(p));
const FFPROBE = FFMPEG?.replace(/ffmpeg$/, "ffprobe");

const base = (extra: Partial<ExportArgs> = {}): ExportArgs =>
  ({
    width: 64, height: 36, frameRate: 30, codec: "h264", encoder: "libx264", mode: "fast", quality: 70,
    bitrateKbps: 500, outputPath: "/tmp/out.mp4", audioWavPath: "/tmp/a.wav", format: "mp4", ...extra,
  }) as ExportArgs;

describe("chapter muxing arguments", () => {
  it("adds the metadata file as the next input after audio and captions and maps its chapters", () => {
    const none = chapterMuxArgs(base());
    expect(none).toEqual({ inputs: [], outputs: [] });
    expect(chapterMuxArgs(base({ chaptersPath: "/tmp/c.ffmeta" }))).toEqual({
      inputs: ["-f", "ffmetadata", "-i", "/tmp/c.ffmeta"],
      outputs: ["-map_chapters", "2"],
    });
    const withCaptions = chapterMuxArgs(base({ chaptersPath: "/tmp/c.ffmeta", captionInputs: [{ path: "/tmp/c.srt", kind: "mov_text" }] }));
    expect(withCaptions.outputs).toEqual(["-map_chapters", "3"]);
  });

  it("is MP4 / MOV only and shows up in the full ffmpeg command", () => {
    expect(canHoldChapters("mp4")).toBe(true);
    expect(canHoldChapters("mov")).toBe(true);
    expect(canHoldChapters("mkv")).toBe(false);
    expect(buildFfmpegArgs(base({ chaptersPath: "/tmp/c.ffmeta", format: "mkv" }))).not.toContain("-map_chapters");
    const args = buildFfmpegArgs(base({ chaptersPath: "/tmp/c.ffmeta" }));
    const at = args.indexOf("/tmp/c.ffmeta");
    expect(args.slice(at - 3, at + 1)).toEqual(["-f", "ffmetadata", "-i", "/tmp/c.ffmeta"].slice(0, 4));
    expect(args[args.indexOf("-map_chapters") + 1]).toBe("2");
    expect(buildFfmpegArgs(base())).not.toContain("-map_chapters");
  });

  it("only accepts chapter text in ffmpeg's metadata format", () => {
    expect(isChaptersMetadata(";FFMETADATA1\n[CHAPTER]\n")).toBe(true);
    expect(isChaptersMetadata("[CHAPTER]\n")).toBe(false);
    expect(isChaptersMetadata(42)).toBe(false);
    expect(isChaptersMetadata(`;FFMETADATA1\n${"x".repeat(300000)}`)).toBe(false);
  });
});

describe.skipIf(!FFMPEG)("MP4 chapter atoms written by the real ffmpeg", () => {
  it("writes the chapter markers as chapters of the MP4 and a MOV, with their times and titles", () => {
    const dir = mkdtempSync(join(tmpdir(), "chapter-mux-"));
    try {
      const wav = join(dir, "a.wav");
      execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ar", "48000", "-ac", "2", wav]);
      const meta = join(dir, "c.ffmeta");
      writeFileSync(
        meta,
        chaptersToFfMetadata(
          deliveryChapters(
            [
              { id: "1", time: 0, label: "Intro", color: "#fff", kind: "chapter" },
              { id: "2", time: 1.5, label: "Act one; the = start", color: "#fff", kind: "chapter" },
              { id: "3", time: 3.25, label: "Finale", color: "#fff", kind: "chapter" },
            ],
            5,
          ),
        ),
      );
      for (const format of ["mp4", "mov"] as const) {
        const output = join(dir, `out.${format}`);
        const args = buildFfmpegArgs(base({ outputPath: output, audioWavPath: wav, format, chaptersPath: meta }));
        const run = spawnSync(FFMPEG!, args, { input: Buffer.alloc(64 * 36 * 4 * 150, 0x80), encoding: "buffer" });
        expect(run.status, run.stderr.toString().slice(-600)).toBe(0);
        const chapters = JSON.parse(execFileSync(FFPROBE!, ["-v", "error", "-show_chapters", "-of", "json", output], { encoding: "utf8" })).chapters as Array<{ start_time: string; end_time: string; tags: { title: string } }>;
        expect(chapters.map((c) => c.tags.title)).toEqual(["Intro", "Act one; the = start", "Finale"]);
        expect(chapters.map((c) => Number(c.start_time))).toEqual([0, 1.5, 3.25]);
        expect(Number(chapters[2].end_time)).toBeCloseTo(5, 1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chapters at the final join of smart-render and parallel-segment exports", () => {
  const assemble = (extra: Record<string, unknown> = {}) =>
    buildAssembleArgs({
      videoPath: "/tmp/joined.ts", audioWavPath: "/tmp/a.wav", outputPath: "/tmp/out.mp4", frameRate: 30,
      codec: "avc", audioCodec: "aac", format: "mp4", ...extra,
    });

  it("adds the chapter file as the input after audio and maps its chapters", () => {
    expect(assemble()).not.toContain("-map_chapters");
    const args = assemble({ chaptersPath: "/tmp/c.ffmeta" });
    expect(args.slice(args.indexOf("/tmp/c.ffmeta") - 3, args.indexOf("/tmp/c.ffmeta") + 1)).toEqual(["-f", "ffmetadata", "-i", "/tmp/c.ffmeta"].slice(0, 4));
    expect(args[args.indexOf("-map_chapters") + 1]).toBe("2");
    // After one caption input the chapter file is input 3.
    const withCaption = assemble({ chaptersPath: "/tmp/c.ffmeta", captionInputs: [{ path: "/tmp/c.srt", kind: "mov_text" }] });
    expect(withCaption[withCaption.indexOf("-map_chapters") + 1]).toBe("3");
    // Containers without chapter atoms ignore it.
    expect(assemble({ chaptersPath: "/tmp/c.ffmeta", format: "mkv" })).not.toContain("-map_chapters");
  });

  it.skipIf(!FFMPEG)("a stream-copied join with the real ffmpeg keeps the chapters", () => {
    const dir = mkdtempSync(join(tmpdir(), "chapter-join-"));
    try {
      const video = join(dir, "v.ts");
      const wav = join(dir, "a.wav");
      execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x36:rate=30:duration=4", "-c:v", "libx264", "-f", "mpegts", video]);
      execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ar", "48000", "-ac", "2", wav]);
      const meta = join(dir, "c.ffmeta");
      writeFileSync(meta, chaptersToFfMetadata(deliveryChapters([
        { id: "1", time: 0, label: "One", color: "#fff", kind: "chapter" },
        { id: "2", time: 2, label: "Two", color: "#fff", kind: "chapter" },
      ], 4)));
      const output = join(dir, "out.mp4");
      execFileSync(FFMPEG!, assemble({ videoPath: video, audioWavPath: wav, outputPath: output, chaptersPath: meta }), { stdio: "ignore" });
      const chapters = JSON.parse(execFileSync(FFPROBE!, ["-v", "error", "-show_chapters", "-of", "json", output], { encoding: "utf8" })).chapters as Array<{ start_time: string; tags: { title: string } }>;
      expect(chapters.map((c) => c.tags.title)).toEqual(["One", "Two"]);
      expect(chapters.map((c) => Number(c.start_time))).toEqual([0, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
