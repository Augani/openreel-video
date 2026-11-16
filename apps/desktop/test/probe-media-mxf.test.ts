import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { parseFfmpegProbe } from "../src/main/ingest/probe-media";

const dnxhr = `Input #0, mxf, from 'cam.mxf':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 83000 kb/s
  Stream #0:0: Video: dnxhd (DNXHR HQ), yuv422p(tv, bt709/unknown/unknown, progressive), 1280x720, SAR 1:1 DAR 16:9, 24 fps, 24 tbr, 24 tbn
  Stream #0:1: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s
  Stream #0:2: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s`;

const xdcam = `Input #0, mxf, from 'xd.mxf':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 52000 kb/s
  Stream #0:0: Video: mpeg2video (4:2:2), yuv422p(tv, bottom first), 1920x1080 [SAR 1:1 DAR 16:9], 50000 kb/s, 25 fps, 25 tbr, 25 tbn
  Stream #0:1: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s
  Stream #0:2: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s
  Stream #0:3: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s
  Stream #0:4: Audio: pcm_s24le, 48000 Hz, mono, s32 (24 bit), 1152 kb/s`;

const mov = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: prores (HQ) (apch / 0x68637061), yuv422p10le(progressive), 640x360, 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1[0x2](und): Audio: pcm_s16le (sowt / 0x74776F73), 48000 Hz, stereo, s16, 1536 kb/s (default)`;

describe("parseFfmpegProbe on professional wrappers", () => {
  it("reads an MXF: demuxer, DNxHR codec, one entry per mono PCM audio track, progressive", () => {
    const probe = parseFfmpegProbe(dnxhr);
    expect(probe).toMatchObject({ container: "mxf", videoCodec: "dnxhd", width: 1280, height: 720, frameRate: 24, hasAudio: true });
    expect(probe.audioStreams).toEqual([
      { codec: "pcm_s24le", channels: 1, sampleRate: 48000 },
      { codec: "pcm_s24le", channels: 1, sampleRate: 48000 },
    ]);
    expect(probe.interlaced).toBeUndefined();
  });

  it("flags XDCAM HD422 (MPEG-2 4:2:2, field order printed) as interlaced and counts its four tracks", () => {
    const probe = parseFfmpegProbe(xdcam);
    expect(probe).toMatchObject({ container: "mxf", videoCodec: "mpeg2video", width: 1920, height: 1080, interlaced: true });
    expect(probe.audioStreams).toHaveLength(4);
  });

  it("keeps the QuickTime demuxer name and a stereo track as one two-channel stream", () => {
    const probe = parseFfmpegProbe(mov);
    expect(probe.container).toBe("mov,mp4,m4a,3gp,3g2,mj2");
    expect(probe.audioStreams).toEqual([{ codec: "pcm_s16le", channels: 2, sampleRate: 48000 }]);
    expect(probe.interlaced).toBeUndefined();
  });
});
