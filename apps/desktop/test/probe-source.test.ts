import { vi, describe, it, expect } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { assertLocalSourcePath, parseSourceProbe, probeSource } from "../src/main/sidecar/probe-source";

describe("assertLocalSourcePath", () => {
  it("accepts absolute file paths and rejects URLs, pseudo-protocols and relative paths", async () => {
    expect(assertLocalSourcePath("/Users/me/clip.mp4")).toBe("/Users/me/clip.mp4");
    for (const bad of ["http://example.com/a.mp4", "concat:/a.mp4|/b.mp4", "subfile,,start,0,end,0,,:/etc/passwd", "clip.mp4", "../clip.mp4", "/a\u0000b.mp4"]) {
      expect(() => assertLocalSourcePath(bad)).toThrow();
    }
    await expect(probeSource("http://127.0.0.1:1/x.mp4")).resolves.toBeNull();
  });
});

const h264 = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709/unknown/unknown, progressive), 640x360 [SAR 1:1 DAR 16:9], 814 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 69 kb/s (default)
[Parsed_showinfo_0 @ 0x748d416400] n:   0 pts:      0 pts_time:0       duration:   1001 duration_time:0.033367 fmt:yuv420p cl:left sar:1/1 s:640x360 i:P iskey:1 type:I checksum:5A3C0E4B plane_checksum:[1 2 3] mean:[1 2 3] stdev:[1 2 3]
[Parsed_showinfo_0 @ 0x748d416400] color_range:tv color_space:bt709 color_primaries:unknown color_trc:unknown
`;

const hevc10 = `
  Stream #0:0[0x1](eng): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 60 fps, 60 tbr, 60k tbn (default)
[Parsed_showinfo_0 @ 0x1] color_range:tv color_space:bt2020nc color_primaries:bt2020 color_trc:arib-std-b67
`;

const untagged = `
  Stream #0:0: Video: h264 (Constrained Baseline), yuv420p(progressive), 320x240, 25 fps, 25 tbr, 1200k tbn
[Parsed_showinfo_0 @ 0x1] color_range:unknown color_space:unknown color_primaries:unknown color_trc:unknown
`;

describe("parseSourceProbe", () => {
  it("reads codec, pixel format and the colour tags ffmpeg decodes", () => {
    expect(parseSourceProbe(h264)).toEqual({
      codec: "h264",
      pixelFormat: "yuv420p",
      color: { range: "tv", matrix: "bt709", primaries: undefined, transfer: undefined },
    });
  });

  it("reports 10-bit HDR streams as such", () => {
    expect(parseSourceProbe(hevc10)).toEqual({
      codec: "hevc",
      pixelFormat: "yuv420p10le",
      color: { range: "tv", matrix: "bt2020nc", primaries: "bt2020", transfer: "arib-std-b67" },
    });
  });

  it("leaves unspecified tags out", () => {
    expect(parseSourceProbe(untagged)?.color).toEqual({ range: undefined, matrix: undefined, primaries: undefined, transfer: undefined });
  });

  it("returns null without a video stream", () => {
    expect(parseSourceProbe("Stream #0:0: Audio: aac, 48000 Hz")).toBeNull();
  });
});
