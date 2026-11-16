import { describe, it, expect } from "vitest";
import { buildProfileFromNativeSpecs, getNativeGpuTier, type NativeHardwareInfo } from "./native-profile";

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

});

describe("getNativeGpuTier", () => {
  it("treats vendor-only Apple strings as high, not low", () => {
    expect(getNativeGpuTier("Apple GPU")).toBe("high");
    expect(getNativeGpuTier("Apple Paravirtual device")).not.toBe("high");
  });

  it("unwraps ANGLE strings", () => {
    expect(getNativeGpuTier("ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)")).toBe("high");
    expect(getNativeGpuTier("ANGLE (Apple, ANGLE Metal Renderer: Apple GPU, Unspecified Version)")).toBe("high");
  });
});
