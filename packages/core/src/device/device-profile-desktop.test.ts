import { describe, it, expect, afterEach, vi } from "vitest";
import { getDeviceProfile } from "./device-capabilities";

afterEach(() => {
  delete (globalThis as unknown as { openreel?: unknown }).openreel;
});

describe("getDeviceProfile desktop branch", () => {
  it("builds the profile from window.openreel.probeHardware when on desktop", async () => {
    const probeHardware = vi.fn(async () => ({
      cpu: { model: "Apple M3 Max", physicalCores: 14, logicalCores: 14 },
      memory: { totalBytes: 36 * 1024 ** 3, freeBytes: 20 * 1024 ** 3 },
      gpus: ["Apple M3 Max"],
      encoders: ["h264_videotoolbox", "hevc_videotoolbox", "libx264"],
      platform: "darwin" as const,
      arch: "arm64",
    }));
    (globalThis as unknown as { openreel?: unknown }).openreel = { platform: "desktop", probeHardware };

    const profile = await getDeviceProfile(true);

    expect(probeHardware).toHaveBeenCalled();
    expect(profile.platform.os).toBe("macOS");
    expect(profile.platform.browser).toBe("Electron");
    expect(profile.cpu.cores).toBe(14);
    expect(profile.cpu.tier).toBe("high");
    expect(profile.memory.gb).toBe(36);
    expect(profile.gpu.tier).toBe("high");
    expect(profile.encoding.h264.hardware).toBe(true);
  });
});
