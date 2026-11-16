import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildFfmpegArgs, exportOutputPaths, monoSplitFilter, monoTrackCount, opAtomOutputs, type ExportArgs } from "../src/main/sidecar/export-job";
import { avcIntra100Args, pixelFormatForPlan, videoEncodeArgs, withTopFieldFirst, xdcamGopLength, xdcamHd422Args } from "../src/main/sidecar/encode-args";
import { buildAssembleArgs } from "../src/main/sidecar/smart-export";
import { parseFfmpegProbe } from "../src/main/ingest/probe-media";
import { broadcastExportFields, resolveExportArgs } from "../src/main/ipc/export";

const base: ExportArgs = {
  width: 1920, height: 1080, frameRate: 25,
  codec: "xdcamhd422", encoder: "mpeg2video", mode: "smallest", quality: 100,
  bitrateKbps: 0, outputPath: "/tmp/out.mxf", audioWavPath: "/tmp/a.wav", format: "mxf",
};

const after = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

describe("XDCAM HD422 / AVC-Intra 100 encoder arguments", () => {
  it("XDCAM: 4:2:2 profile, High level, 50 Mb/s CBR, long GOP with 2 B frames, yuv422p", () => {
    const a = videoEncodeArgs({ codec: "xdcamhd422", encoder: "mpeg2video", mode: "smallest", quality: 100, width: 1920, height: 1080, frameRate: 25 });
    expect(a.slice(0, 2)).toEqual(["-c:v", "mpeg2video"]);
    expect(after(a, "-profile:v")).toBe("0");
    expect(after(a, "-level:v")).toBe("2");
    expect([after(a, "-b:v"), after(a, "-minrate"), after(a, "-maxrate")]).toEqual(["50000k", "50000k", "50000k"]);
    expect(after(a, "-g")).toBe("12");
    expect(after(a, "-bf")).toBe("2");
    expect(after(a, "-pix_fmt")).toBe("yuv422p");
    expect(a).not.toContain("-flags");
  });

  it("XDCAM interlaced adds interlaced DCT / motion estimation and top field first", () => {
    const a = xdcamHd422Args({ frameRate: 25, scan: "interlaced-tff" });
    expect(after(a, "-flags")).toBe("+ildct+ilme");
    expect(a).not.toContain("-top");
    const vf = (args: string[]) => args[args.indexOf("-vf") + 1];
    expect(vf(withTopFieldFirst(["-vf", "scale=out_range=tv"], { codec: "xdcamhd422", scan: "interlaced-tff" }))).toBe("scale=out_range=tv,setfield=tff");
    expect(withTopFieldFirst(["-vf", "x"], { codec: "xdcamhd422", scan: "progressive" })).toEqual(["-vf", "x"]);
  });

  it("GOP is 15 frames in the 29.97 family and 12 otherwise; the dialog's keyframe interval does not override it", () => {
    expect(xdcamGopLength(30000 / 1001)).toBe(15);
    expect(xdcamGopLength(29.97)).toBe(15);
    expect(xdcamGopLength(25)).toBe(12);
    expect(xdcamGopLength(24)).toBe(12);
    const a = videoEncodeArgs({ codec: "xdcamhd422", encoder: "mpeg2video", mode: "smallest", quality: 100, width: 1920, height: 1080, frameRate: 25, keyframeInterval: 1 });
    expect(a.filter((x) => x === "-g")).toHaveLength(1);
    expect(after(a, "-g")).toBe("12");
  });

  it("AVC-Intra 100: libx264 avcintra-class 100, BT.709 tags, 10-bit 4:2:2, no CRF / preset", () => {
    const a = videoEncodeArgs({ codec: "avcintra100", encoder: "libx264", mode: "smallest", quality: 100, width: 1920, height: 1080, frameRate: 25 });
    expect(after(a, "-x264-params")).toBe("avcintra-class=100:colorprim=bt709:transfer=bt709:colormatrix=bt709");
    expect(after(a, "-pix_fmt")).toBe("yuv422p10le");
    expect(a).not.toContain("-crf");
    expect(a).not.toContain("-preset");
    expect(a).not.toContain("-field_order");
    expect(avcIntra100Args({ scan: "interlaced-tff" })).toEqual(expect.arrayContaining(["-field_order", "tt", "+ildct"]));
  });

  it("pixel formats", () => {
    expect(pixelFormatForPlan({ codec: "xdcamhd422" })).toBe("yuv422p");
    expect(pixelFormatForPlan({ codec: "avcintra100" })).toBe("yuv422p10le");
  });
});

describe("mono tracks, timecode and OP-Atom in the ffmpeg command", () => {
  it("OP1a with 8 mono tracks: splits the 8-channel WAV into 8 mono streams, maps them, 24-bit PCM, timecode before the muxer", () => {
    const a = buildFfmpegArgs({ ...base, audioTrackCount: 8, startTimecode: "10:00:00:00", scan: "interlaced-tff" });
    expect(after(a, "-filter_complex")).toBe(monoSplitFilter(8));
    expect(after(a, "-filter_complex")).toContain("[1:a]asplit=8");
    expect(after(a, "-filter_complex")).toContain("[s7]pan=mono|c0=c7[a7]");
    const maps = a.flatMap((x, i) => (x === "-map" ? [a[i + 1]] : []));
    expect(maps).toEqual(["0:v:0", "[a0]", "[a1]", "[a2]", "[a3]", "[a4]", "[a5]", "[a6]", "[a7]"]);
    expect(after(a, "-c:a")).toBe("pcm_s24le");
    expect(after(a, "-timecode")).toBe("10:00:00:00");
    expect(a.indexOf("-timecode")).toBeLessThan(a.indexOf("-f", a.indexOf("-timecode")));
    expect(a.slice(-3)).toEqual(["-progress", "pipe:2", "/tmp/out.mxf"]);
    expect(a[a.indexOf("-f", a.indexOf("-timecode"))+1]).toBe("mxf");
  });

  it("a plain stereo MXF has no filter graph and no timecode", () => {
    const a = buildFfmpegArgs(base);
    expect(a).not.toContain("-filter_complex");
    expect(a).not.toContain("-timecode");
    expect(a).not.toContain("-map");
  });

  it("MOV gets the timecode track request and mono tracks; MP4 and WebM never get -timecode", () => {
    const mov = buildFfmpegArgs({ ...base, codec: "prores", encoder: "prores_ks", format: "mov", outputPath: "/tmp/o.mov", audioTrackCount: 4, startTimecode: "01:00:00;00" });
    expect(after(mov, "-timecode")).toBe("01:00:00;00");
    expect(after(mov, "-filter_complex")).toContain("asplit=4");
    expect(mov).toContain("-movflags");
    const mp4 = buildFfmpegArgs({ ...base, codec: "h264", encoder: "libx264", format: "mp4", outputPath: "/tmp/o.mp4", startTimecode: "10:00:00:00" });
    expect(mp4).not.toContain("-timecode");
  });

  it("OP-Atom writes the picture and each mono track to its own mxf_opatom file, each with the timecode", () => {
    const a = buildFfmpegArgs({ ...base, mxfPattern: "opatom", audioTrackCount: 2, startTimecode: "10:00:00:00" });
    expect(a.filter((x) => x === "mxf_opatom")).toHaveLength(3);
    expect(a.filter((x) => x === "-timecode")).toHaveLength(3);
    expect(a).toContain("/tmp/out_V01.mxf");
    expect(a).toContain("/tmp/out_A01.mxf");
    expect(a).toContain("/tmp/out_A02.mxf");
    expect(a).not.toContain("/tmp/out.mxf");
    // The picture options belong to the first output only.
    const firstOutput = a.indexOf("/tmp/out_V01.mxf");
    expect(a.indexOf("-vf")).toBeLessThan(firstOutput);
    expect(a.lastIndexOf("-vf")).toBeLessThan(firstOutput);
    expect(a.indexOf("-c:v")).toBeLessThan(firstOutput);
  });

  it("OP-Atom without a track count writes the stereo mix as two mono files", () => {
    expect(monoTrackCount({ format: "mxf", mxfPattern: "opatom" })).toBe(2);
    expect(monoTrackCount({ format: "mxf" })).toBe(0);
    expect(monoTrackCount({ format: "mxf", audioTrackCount: 16 })).toBe(16);
    expect(exportOutputPaths({ format: "mxf", mxfPattern: "opatom", outputPath: "/x/clip.mxf" })).toEqual(["/x/clip_V01.mxf", "/x/clip_A01.mxf", "/x/clip_A02.mxf"]);
    expect(exportOutputPaths({ format: "mxf", outputPath: "/x/clip.mxf" })).toEqual(["/x/clip.mxf"]);
    expect(opAtomOutputs("/x/clip.MXF", 1)).toEqual({ video: "/x/clip_V01.mxf", audio: ["/x/clip_A01.mxf"] });
  });

  it("captions on a mono-track MOV map the split streams, not the stereo WAV", () => {
    const a = buildFfmpegArgs({
      ...base, codec: "prores", encoder: "prores_ks", format: "mov", outputPath: "/tmp/o.mov", audioTrackCount: 2,
      captionInputs: [{ path: "/tmp/c.srt", kind: "mov_text" }],
    });
    const maps = a.flatMap((x, i) => (x === "-map" ? [a[i + 1]] : []));
    expect(maps.slice(0, 3)).toEqual(["0:v:0", "[a0]", "[a1]"]);
    expect(maps).not.toContain("1:a:0");
  });

  it("smart-render assemble writes the timecode into a MOV only", () => {
    const common = { videoPath: "/tmp/v.ts", audioWavPath: "/tmp/a.wav", outputPath: "/tmp/o.mov", frameRate: 25, codec: "avc" as const, audioCodec: "aac" };
    expect(after(buildAssembleArgs({ ...common, format: "mov", startTimecode: "10:00:00:00" }), "-timecode")).toBe("10:00:00:00");
    expect(buildAssembleArgs({ ...common, format: "mp4", startTimecode: "10:00:00:00" })).not.toContain("-timecode");
  });
});

describe("start request validation", () => {
  const start = { width: 1920, height: 1080, frameRate: 25, codec: "xdcamhd422", format: "mxf", bitrateKbps: 0, outputPath: "/tmp/x.mxf", totalFrames: 1, audioSampleRate: 48000, audioChannels: 8 };
  it("passes the broadcast fields through for MXF", () => {
    expect(broadcastExportFields({ ...start, scan: "interlaced-tff", mxfPattern: "opatom", audioTrackCount: 8, startTimecode: "10:00:00;00" })).toEqual({
      scan: "interlaced-tff", mxfPattern: "opatom", audioTrackCount: 8, startTimecode: "10:00:00;00",
    });
    expect(broadcastExportFields(start)).toEqual({});
  });
  it("resolves the XDCAM and AVC-Intra encoders and refuses a Rec.2020 / HDR request", () => {
    const encoders = ["mpeg2video", "libx264"];
    expect(resolveExportArgs({ ...start, startTimecode: "10:00:00:00" }, "darwin", encoders, "/tmp/a.wav").encoder).toBe("mpeg2video");
    expect(resolveExportArgs({ ...start, codec: "avcintra100", audioChannels: 2 }, "darwin", encoders, "/tmp/a.wav").encoder).toBe("libx264");
    const hdr = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" } as const;
    expect(() => resolveExportArgs({ ...start, color: hdr }, "darwin", encoders, "/tmp/a.wav")).toThrow(/Rec.709/);
  });
});

describe("start timecode in the import probe", () => {
  it("reads the timecode of an MXF (format metadata)", () => {
    const probe = parseFfmpegProbe(`Input #0, mxf, from 'xd.mxf':
  Metadata:
    operational_pattern_ul: 060e2b34.04010101.0d010201.01010900
    timecode        : 10:00:00:00
  Duration: 00:00:02.00, start: 0.000000, bitrate: 52000 kb/s
  Stream #0:0: Video: mpeg2video (4:2:2), yuv422p(tv, top first), 1920x1080 [SAR 1:1 DAR 16:9], 50000 kb/s, 25 fps, 25 tbr, 25 tbn
  Stream #0:1: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s`);
    expect(probe.startTimecode).toBe("10:00:00:00");
    expect(probe.interlaced).toBe(true);
  });

  it("reads the timecode of a MOV (video stream and tmcd track) and keeps the drop-frame semicolon", () => {
    const probe = parseFfmpegProbe(`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: prores (HQ) (apch / 0x68637061), yuv422p10le(progressive), 640x360, 29.97 fps, 29.97 tbr, 30k tbn (default)
    Metadata:
      timecode        : 01:00:00;02
  Stream #0:1[0x2](eng): Data: none (tmcd / 0x64636D74), 0 kb/s
    Metadata:
      timecode        : 01:00:00;02`);
    expect(probe.startTimecode).toBe("01:00:00;02");
  });

  it("reports nothing for a file with no timecode, and ignores unrelated tags", () => {
    expect(parseFfmpegProbe(`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':
  Metadata:
    comment         : timecode: soon
  Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 640x360, 24 fps, 24 tbr, 12288 tbn (default)`).startTimecode).toBeUndefined();
  });
});
