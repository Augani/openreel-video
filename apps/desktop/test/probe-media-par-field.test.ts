import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { parseFfmpegProbe } from "../src/main/ingest/probe-media";

const hdv = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'hdv.mov':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 25000 kb/s
  Stream #0:0[0x1](eng): Video: mpeg2video (Main), yuv420p(tv, top first), 1440x1080 [SAR 4:3 DAR 16:9], 25000 kb/s, 25 fps, 25 tbr, 25 tbn`;
const dv = `Input #0, dv, from 'dv.dv':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 28771 kb/s
  Stream #0:0: Video: dvvideo, yuv411p(tv, bottom first), 720x480 [SAR 8:9 DAR 4:3], 28771 kb/s, 29.97 fps, 29.97 tbr, 29.97 tbn`;
const square = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 24 fps, 24 tbr, 12288 tbn`;

describe("parseFfmpegProbe pixel aspect and field order", () => {
  it("reads a non-square SAR and the top field first order", () => {
    const probe = parseFfmpegProbe(hdv);
    expect(probe.pixelAspectRatio).toBeCloseTo(4 / 3);
    expect(probe.fieldOrder).toBe("upper");
    expect(probe.interlaced).toBe(true);
  });
  it("reads DV NTSC's 8:9 SAR and bottom field first", () => {
    const probe = parseFfmpegProbe(dv);
    expect(probe.pixelAspectRatio).toBeCloseTo(8 / 9);
    expect(probe.fieldOrder).toBe("lower");
  });
  it("reports nothing for square, progressive footage", () => {
    const probe = parseFfmpegProbe(square);
    expect(probe.pixelAspectRatio).toBeUndefined();
    expect(probe.fieldOrder).toBeUndefined();
  });
});
