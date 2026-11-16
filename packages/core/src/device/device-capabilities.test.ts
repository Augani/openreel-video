import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCodecRecommendations,
  type DeviceProfile,
} from "./device-capabilities";

const createMockProfile = (overrides?: Partial<DeviceProfile>): DeviceProfile => ({
  cpu: { cores: 8, tier: "high" },
  memory: { gb: 16, tier: "high" },
  gpu: {
    vendor: "Apple",
    renderer: "Apple M2 Pro",
    tier: "high",
    hasHardwareEncoding: true,
  },
  encoding: {
    h264: { hardware: true, supported: true },
    h265: { hardware: true, supported: true },
    vp9: { hardware: false, supported: true },
    av1: { hardware: false, supported: true },
  },
  platform: {
    os: "macOS",
    browser: "Chrome",
    isMobile: false,
  },
  overallTier: "high",
  ...overrides,
});

describe("DeviceCapabilities", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      hardwareConcurrency: 8,
      deviceMemory: 16,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getCodecRecommendations", () => {

    it("should recommend H.264 with hardware encoding as fast", () => {
      const profile = createMockProfile();
      const recommendations = getCodecRecommendations(profile, {
        width: 1920,
        height: 1080,
      });

      const h264 = recommendations.find((r) => r.codec === "h264");

      expect(h264).toBeDefined();
      expect(h264?.speedRating).toBe("fast");
      expect(h264?.recommended).toBe(true);
    });

    it("should not recommend AV1 without hardware on low-tier devices", () => {
      const profile = createMockProfile({
        overallTier: "low",
        encoding: {
          h264: { hardware: true, supported: true },
          h265: { hardware: false, supported: true },
          vp9: { hardware: false, supported: true },
          av1: { hardware: false, supported: true },
        },
      });

      const recommendations = getCodecRecommendations(profile, {
        width: 1920,
        height: 1080,
      });

      const av1 = recommendations.find((r) => r.codec === "av1");

      expect(av1?.recommended).toBe(false);
      expect(av1?.speedRating).toBe("very-slow");
    });

  });

});
