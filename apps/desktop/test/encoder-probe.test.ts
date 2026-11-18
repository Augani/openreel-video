import { describe, it, expect } from "vitest";
import { parseEncoders, selectEncoder } from "../src/main/sidecar/encoder-probe";

const SAMPLE = `
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder
 V....D hevc_videotoolbox    VideoToolbox HEVC Encoder
 V....D libx264              libx264 H.264
 V....D prores_videotoolbox  Apple ProRes
`;

describe("encoder probe", () => {
  it("parses encoder names from ffmpeg -encoders output", () => {
    const names = parseEncoders(SAMPLE);
    expect(names).toContain("h264_videotoolbox");
    expect(names).toContain("libx264");
  });

  it("selects prores_videotoolbox for prores on darwin", () => {
    const names = parseEncoders(SAMPLE);
    expect(selectEncoder("prores", "darwin", names)).toBe("prores_videotoolbox");
  });
});

describe("selectEncoder mode-awareness", () => {
  const hw = ["h264_videotoolbox", "hevc_videotoolbox", "libx264", "libx265", "libsvtav1"];

  it("prefers hardware for fast/balanced", () => {
    expect(selectEncoder("h265", "darwin", hw, "balanced")).toBe("hevc_videotoolbox");
    expect(selectEncoder("h264", "darwin", hw, "fast")).toBe("h264_videotoolbox");
  });

  it("forces software for smallest", () => {
    expect(selectEncoder("h265", "darwin", hw, "smallest")).toBe("libx265");
    expect(selectEncoder("av1", "darwin", hw, "smallest")).toBe("libsvtav1");
  });

  it("falls back to software when hardware is missing", () => {
    const swOnly = ["libx264", "libx265", "libsvtav1"];
    expect(selectEncoder("h265", "darwin", swOnly, "balanced")).toBe("libx265");
  });

  it("selects libvpx-vp9 for vp9 and skips the -encoders legend", () => {
    const names = parseEncoders(
      " V..... = Video\n A..... = Audio\n ------\n V....D libvpx-vp9  libvpx VP9\n",
    );
    expect(names).toEqual(["libvpx-vp9"]);
    expect(selectEncoder("vp9", "darwin", names)).toBe("libvpx-vp9");
  });
});

import { buildSmokeTestArgs, isHardwareEncoder } from "../src/main/sidecar/encoder-probe";

describe("encoder smoke test", () => {
  it("classifies hardware encoders", () => {
    expect(isHardwareEncoder("h264_videotoolbox")).toBe(true);
    expect(isHardwareEncoder("libx264")).toBe(false);
  });

  it("builds a one-frame null encode", () => {
    const args = buildSmokeTestArgs("h264_nvenc");
    expect(args).toContain("-frames:v");
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "h264_nvenc"]);
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });
});

import { createEncoderVerifier, NEGATIVE_RETRY_MS } from "../src/main/sidecar/encoder-probe";

describe("encoder verifier", () => {
  function setup(results: Record<string, boolean[]>) {
    let t = 0;
    const calls: string[] = [];
    const verify = createEncoderVerifier({
      list: async () => ["libx264", "h264_videotoolbox"],
      smoke: async (e) => {
        calls.push(e);
        const queue = results[e] ?? [true];
        return queue.length > 1 ? queue.shift()! : queue[0];
      },
      now: () => t,
    });
    return { verify, calls, advance: (ms: number) => (t += ms) };
  }

  it("drops failing hardware encoders, caches the negative for 60s, then retries", async () => {
    const { verify, calls, advance } = setup({ h264_videotoolbox: [false, true] });
    expect(await verify()).toEqual(["libx264"]);
    advance(NEGATIVE_RETRY_MS - 1);
    expect(await verify()).toEqual(["libx264"]);
    expect(calls).toEqual(["h264_videotoolbox"]);
    advance(2);
    expect(await verify()).toEqual(["libx264", "h264_videotoolbox"]);
    expect(calls).toHaveLength(2);
  });

  it("caches a positive result permanently", async () => {
    const { verify, calls, advance } = setup({});
    await verify();
    advance(10 * NEGATIVE_RETRY_MS);
    await verify();
    expect(calls).toEqual(["h264_videotoolbox"]);
  });
});
