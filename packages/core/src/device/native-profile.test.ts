import { describe, it, expect } from "vitest";
import { buildProfileFromNativeSpecs, type NativeHardwareInfo } from "./native-profile";

const M2_PRO: NativeHardwareInfo = {
  cpu: { model: "Apple M2 Pro", physicalCores: 12, logicalCores: 12 },
  memory: { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 },
  gpus: ["Apple M2 Pro"],
  encoders: [
    "h264_videotoolbox",
    "hevc_videotoolbox",
    "prores_videotoolbox",
    "libx264",
    "libx265",
    "libsvtav1",
  ],
  platform: "darwin",
  arch: "arm64",
};

describe("buildProfileFromNativeSpecs", () => {
  it("maps cores/memory/platform from real specs", () => {
    const p = buildProfileFromNativeSpecs(M2_PRO);
    expect(p.cpu.cores).toBe(12);
    expect(p.cpu.tier).toBe("high");
    expect(p.memory.gb).toBe(16);
    expect(p.memory.tier).toBe("high");
    expect(p.platform.os).toBe("macOS");
    expect(p.platform.browser).toBe("Electron");
    expect(p.platform.isMobile).toBe(false);
    expect(p.gpu.renderer).toBe("Apple M2 Pro");
  });

  it("maps encoders[] to hardware/software EncodingSupport", () => {
    const p = buildProfileFromNativeSpecs(M2_PRO);
    expect(p.encoding.h264.hardware).toBe(true); // h264_videotoolbox
    expect(p.encoding.h264.supported).toBe(true);
    expect(p.encoding.h265.hardware).toBe(true); // hevc_videotoolbox
    expect(p.encoding.av1.hardware).toBe(false); // no hw av1 encoder present
    expect(p.encoding.av1.supported).toBe(true); // libsvtav1 (software)
    expect(p.gpu.hasHardwareEncoding).toBe(true);
  });

  it("software-only h264 => supported but not hardware", () => {
    const p = buildProfileFromNativeSpecs({
      ...M2_PRO,
      gpus: ["Generic Renderer"],
      encoders: ["libx264"],
    });
    expect(p.encoding.h264.hardware).toBe(false);
    expect(p.encoding.h264.supported).toBe(true);
    expect(p.encoding.h265.supported).toBe(false);
    expect(p.gpu.hasHardwareEncoding).toBe(false);
  });

  it("low-spec maps to low tiers", () => {
    const p = buildProfileFromNativeSpecs({
      ...M2_PRO,
      cpu: { model: "x", physicalCores: 2, logicalCores: 2 },
      memory: { totalBytes: 2 * 1024 ** 3, freeBytes: 1 * 1024 ** 3 },
      gpus: ["Unknown"],
      encoders: ["libx264"],
    });
    expect(p.cpu.tier).toBe("low");
    expect(p.memory.tier).toBe("low");
    expect(p.overallTier).toBe("low");
  });

  it("accepts an optional benchmark (drives measured estimates)", () => {
    const p = buildProfileFromNativeSpecs(M2_PRO, {
      framesPerSecond: 120,
      codec: "h264",
      resolution: { width: 1920, height: 1080 },
      testedAt: 1,
    });
    expect(p.benchmark?.framesPerSecond).toBe(120);
  });
});
