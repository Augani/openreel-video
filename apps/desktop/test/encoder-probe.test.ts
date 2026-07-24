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

  it("selects videotoolbox h264 on darwin when present", () => {
    const names = parseEncoders(SAMPLE);
    expect(selectEncoder("h264", "darwin", names)).toBe("h264_videotoolbox");
  });

  it("falls back to libx264 when no hw encoder present", () => {
    expect(selectEncoder("h264", "linux", ["libx264"])).toBe("libx264");
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
});
