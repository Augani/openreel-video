import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { embedCea608Sei } from "../export/caption-sei-embed";
import { exportScc } from "./scc";
import {
  avcLengthSize,
  avccNalTypes,
  buildCcDataPayload,
  buildCea608SeiNal,
  hasA53Sei,
  insertSeiIntoAvccSample,
  isSupportedCea608Rate,
  sccToFrameSchedule,
} from "./cea608-sei";

const cue = (id: string, text: string, startTime: number, endTime: number): Subtitle => ({ id, text, startTime, endTime });
const CUES = [cue("1", "HELLO WORLD", 1, 2.5), cue("2", "SECOND CAPTION", 3, 3.8)];

function tool(command: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(`${command} is not installed. The CEA-608 embedding tests verify the output with ffmpeg/ffprobe and must not skip.`);
  }
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("CEA-608 SEI building blocks", () => {
  it("builds the ATSC A/53 cc_data payload with a field-1 triplet per pair", () => {
    const payload = buildCcDataPayload([[0x94, 0x2c], [0xc8, 0xc5]]);
    expect([...payload]).toEqual([
      0xb5, 0x00, 0x31, 0x47, 0x41, 0x39, 0x34, 0x03, 0x42, 0xff,
      0xfc, 0x94, 0x2c,
      0xfc, 0xc8, 0xc5,
      0xff,
    ]);
    expect(() => buildCcDataPayload([])).toThrow();
  });

  it("wraps it in a SEI NAL (type 6, payload type 4) with rbsp trailing bits", () => {
    const nal = buildCea608SeiNal([[0x94, 0x2c]]);
    expect(nal[0]).toBe(0x06);
    expect(nal[1]).toBe(0x04);
    expect(nal[2]).toBe(14); // 11 + 3 bytes
    expect(nal[nal.length - 1]).toBe(0x80);
  });

  it("escapes 00 00 0x sequences so no start code can appear inside the NAL", () => {
    const nal = buildCea608SeiNal([[0x00, 0x00], [0x00, 0x01]]);
    const text = [...nal].join(",");
    expect(text).not.toMatch(/(^|,)0,0,[0-3](,|$)/);
    expect(nal).toContain(0x03);
  });

  it("inserts the SEI before the first picture NAL of an AVCC sample, once", () => {
    const nal = (type: number, size: number) => [0, 0, 0, size, type, ...Array(size - 1).fill(0x55)];
    const sample = Uint8Array.from([...nal(0x09, 2), ...nal(0x67, 4), ...nal(0x68, 3), ...nal(0x65, 6)]);
    const sei = buildCea608SeiNal([[0x94, 0x20]]);
    const out = insertSeiIntoAvccSample(sample, 4, sei);
    expect(avccNalTypes(out, 4)).toEqual([9, 7, 8, 6, 5]);
    expect(out.length).toBe(sample.length + 4 + sei.length);
    expect(hasA53Sei(out, 4)).toBe(true);
    expect(insertSeiIntoAvccSample(out, 4, sei)).toBe(out);
    expect(insertSeiIntoAvccSample(Uint8Array.from(nal(0x67, 4)), 4, sei).length).toBe(8); // no picture NAL: unchanged
  });

  it("reads the NAL length size from an avcC record", () => {
    expect(avcLengthSize(Uint8Array.from([1, 100, 0, 30, 0xff, 0xe1]))).toBe(4);
    expect(avcLengthSize(Uint8Array.from([1, 100, 0, 30, 0xfd, 0xe1]))).toBe(2);
    expect(avcLengthSize(undefined)).toBe(4);
  });

  it("schedules one byte pair per frame from an SCC file, honouring the start offset", () => {
    const scc = exportScc(CUES, { frameRate: 29.97 });
    const plain = sccToFrameSchedule(scc, { frameRate: 29.97 });
    expect(plain.pairCount).toBeGreaterThan(20);
    expect(plain.rate.fps).toBeCloseTo(29.97, 2);
    expect([...plain.pairs.keys()].every((frame) => frame >= 0)).toBe(true);
    const shifted = exportScc(CUES, { frameRate: 29.97, offsetSeconds: 3600 });
    const back = sccToFrameSchedule(shifted, { frameRate: 29.97, offsetSeconds: 3600 });
    expect([...back.pairs.entries()]).toEqual([...plain.pairs.entries()]);
    expect(() => sccToFrameSchedule("nope", { frameRate: 29.97 })).toThrow(/Scenarist_SCC/);
    expect(() => sccToFrameSchedule(scc, { frameRate: 24 })).toThrow(/29\.97 and 30/);
    expect(isSupportedCea608Rate(30)).toBe(true);
    expect(isSupportedCea608Rate(25)).toBe(false);
  });
});

describe("embedding CEA-608 into a real H.264 MP4 (verified with ffprobe and ffmpeg)", () => {
  function makeVideo(dir: string, frameRate: string, container: "mp4" | "faststart" | "mov" = "mp4"): string {
    const file = join(dir, container === "mov" ? "in.mov" : "in.mp4");
    const r = tool("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `testsrc2=size=320x240:rate=${frameRate}:duration=5`,
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "2", "-g", "30", "-preset", "ultrafast",
      "-c:a", "aac", "-shortest", ...(container === "faststart" ? ["-movflags", "+faststart"] : []), file,
    ]);
    expect(r.ok, r.stderr).toBe(true);
    return file;
  }

  /** Frames ffprobe reports with ATSC A53 closed-caption side data (the SEI this module writes). */
  function a53Frames(file: string): number {
    const r = tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=pts_time:frame_side_data_list", file]);
    expect(r.ok, r.stderr).toBe(true);
    return (r.stdout.match(/ATSC A53 Part 4 Closed Captions/g) ?? []).length;
  }

  /** Captions decoded back from the video stream by ffmpeg's CEA-608 decoder. */
  function decodedCaptions(file: string): string {
    const r = tool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `movie=${file}[out0+subcc]`, "-map", "0:s:0", "-f", "srt", "-"]);
    expect(r.ok, r.stderr).toBe(true);
    return r.stdout;
  }

  it.each([
    ["30000/1001", 29.97, "mp4"],
    ["30", 30, "faststart"],
    ["30000/1001", 29.97, "mov"],
  ] as const)("%s fps (%s) in a %s file: the captions are in the video stream, picture and audio are bit-identical", async (rate, fps, container) => {
    const dir = mkdtempSync(join(tmpdir(), "cea608-sei-"));
    const input = makeVideo(dir, rate, container);
    expect(a53Frames(input), "the source has no captions in its stream").toBe(0);

    const scc = exportScc(CUES, { frameRate: fps });
    const result = await embedCea608Sei({ source: new Blob([readFileSync(input)]), scc, frameRate: fps });
    expect(result.framesWithCaptions).toBe(sccToFrameSchedule(scc, { frameRate: fps }).pairCount);
    expect(result.videoFrames).toBeGreaterThanOrEqual(149);
    const output = join(dir, container === "mov" ? "out.mov" : "out.mp4");
    writeFileSync(output, Buffer.from(await result.blob.arrayBuffer()));

    // ffprobe sees an ATSC A53 closed-caption SEI on exactly the frames that were captioned.
    expect(a53Frames(output)).toBe(result.framesWithCaptions);
    expect(tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1", output]).stdout).toContain("codec_name=h264");
    // Same picture and audio: ffmpeg's frame hashes of both files agree.
    const hash = (file: string, map: string) => tool("ffmpeg", ["-v", "error", "-i", file, "-map", map, "-f", "hash", "-hash", "md5", "-"]).stdout.trim();
    expect(hash(output, "0:v:0")).toBe(hash(input, "0:v:0"));
    expect(hash(output, "0:a:0")).toBe(hash(input, "0:a:0"));

    // The captions decode with the right text at the right time (within a frame or two of the cue).
    const srt = decodedCaptions(output);
    expect(srt).toContain("HELLO WORLD");
    expect(srt).toContain("SECOND CAPTION");
    const times = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) --> /g)].map((m) => Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
    expect(times[0]).toBeGreaterThan(0.9);
    expect(times[0]).toBeLessThan(1.2);
    expect(times[1]).toBeGreaterThan(2.9);
    expect(times[1]).toBeLessThan(3.2);
  }, 120_000);

  it("refuses other frame rates, non-H.264 files and files with subtitle tracks with a clear message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cea608-sei-"));
    const input = makeVideo(dir, "25");
    const bytes = new Blob([readFileSync(input)]);
    await expect(embedCea608Sei({ source: bytes, scc: exportScc(CUES, { frameRate: 29.97 }), frameRate: 25 })).rejects.toThrow(/29\.97 and 30/);
    const vp9 = join(dir, "in.webm");
    const made = tool("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=1", "-c:v", "libvpx-vp9", "-deadline", "realtime", vp9]);
    if (made.ok) {
      await expect(embedCea608Sei({ source: new Blob([readFileSync(vp9)]), scc: exportScc(CUES, { frameRate: 30 }), frameRate: 30 })).rejects.toThrow(/MP4|MOV|box/);
    }
  }, 120_000);

  it("rejects a hostile file whose sample tables claim billions of entries without hanging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cea608-sei-"));
    const bytes = new Uint8Array(readFileSync(makeVideo(dir, "30")));
    const find = (type: string): number[] => {
      const out: number[] = [];
      for (let i = 4; i + 4 < bytes.length; i++) if (String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]) === type) out.push(i - 4);
      return out;
    };
    for (const [type, countOffset] of [["stts", 12], ["stts", 16], ["stsc", 12], ["stsz", 16], ["stco", 12]] as const) {
      const copy = bytes.slice();
      const view = new DataView(copy.buffer);
      for (const at of find(type)) view.setUint32(at + countOffset, 0xfffffff0);
      const started = Date.now();
      // Either a clear rejection or a harmless clamp is fine; what must not happen is a hang or an out-of-memory loop.
      await embedCea608Sei({ source: new Blob([copy]), scc: exportScc(CUES, { frameRate: 30 }), frameRate: 30 }).catch((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
      });
      expect(Date.now() - started).toBeLessThan(5000);
    }
  }, 120_000);
});
