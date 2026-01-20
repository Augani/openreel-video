import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCodecRecommendations,
  getResolutionRecommendations,
  formatDeviceSummary,
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
    it("should return recommendations for supported codecs", () => {
      const profile = createMockProfile();
      const recommendations = getCodecRecommendations(profile, {
        width: 1920,
        height: 1080,
      });

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0]).toHaveProperty("codec");
      expect(recommendations[0]).toHaveProperty("recommended");
      expect(recommendations[0]).toHaveProperty("speedRating");
    });

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

    it("should mark software-only codecs as slow", () => {
      const profile = createMockProfile({
        encoding: {
          h264: { hardware: false, supported: true },
          h265: { hardware: false, supported: true },
          vp9: { hardware: false, supported: true },
          av1: { hardware: false, supported: true },
        },
      });

      const recommendations = getCodecRecommendations(profile, {
        width: 1920,
        height: 1080,
      });

      const vp9 = recommendations.find((r) => r.codec === "vp9");

      expect(vp9?.speedRating).toBe("slow");
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

    it("should sort recommendations with recommended first", () => {
      const profile = createMockProfile();
      const recommendations = getCodecRecommendations(profile, {
        width: 1920,
        height: 1080,
      });

      const recommendedIndices = recommendations
        .map((r, i) => (r.recommended ? i : -1))
        .filter((i) => i >= 0);

      const notRecommendedIndices = recommendations
        .map((r, i) => (!r.recommended ? i : -1))
        .filter((i) => i >= 0);

      if (recommendedIndices.length > 0 && notRecommendedIndices.length > 0) {
        expect(Math.max(...recommendedIndices)).toBeLessThan(
          Math.min(...notRecommendedIndices)
        );
      }
    });
  });

  describe("getResolutionRecommendations", () => {
    it("should always include 720p and 1080p", () => {
      const profile = createMockProfile();
      const recommendations = getResolutionRecommendations(profile);

      const labels = recommendations.map((r) => r.label);

      expect(labels).toContain("720p HD");
      expect(labels).toContain("1080p Full HD");
    });

    it("should recommend 1080p for high-tier devices", () => {
      const profile = createMockProfile({ overallTier: "high" });
      const recommendations = getResolutionRecommendations(profile);

      const r1080p = recommendations.find((r) => r.label === "1080p Full HD");

      expect(r1080p?.recommended).toBe(true);
    });

    it("should recommend 720p for low-tier devices", () => {
      const profile = createMockProfile({ overallTier: "low" });
      const recommendations = getResolutionRecommendations(profile);

      const r720p = recommendations.find((r) => r.label === "720p HD");

      expect(r720p?.recommended).toBe(true);
    });

    it("should include 4K only for devices with 8GB+ RAM", () => {
      const profile = createMockProfile({
        memory: { gb: 8, tier: "high" },
        overallTier: "mid",
      });
      const recommendations = getResolutionRecommendations(profile);

      const r4k = recommendations.find((r) => r.label === "4K UHD");

      expect(r4k).toBeDefined();
      expect(r4k?.warning).toBeDefined();
    });

    it("should not include 4K for low memory devices", () => {
      const profile = createMockProfile({
        memory: { gb: 4, tier: "mid" },
        overallTier: "low",
      });
      const recommendations = getResolutionRecommendations(profile);

      const r4k = recommendations.find((r) => r.label === "4K UHD");

      expect(r4k).toBeUndefined();
    });
  });

  describe("formatDeviceSummary", () => {
    it("should format device summary with GPU, cores, and RAM", () => {
      const profile = createMockProfile();
      const summary = formatDeviceSummary(profile);

      expect(summary).toContain("8 cores");
      expect(summary).toContain("16GB RAM");
    });

    it("should include GPU name when available", () => {
      const profile = createMockProfile({
        gpu: {
          vendor: "Apple",
          renderer: "Apple M2 Pro",
          tier: "high",
          hasHardwareEncoding: true,
        },
      });
      const summary = formatDeviceSummary(profile);

      expect(summary).toContain("Apple M2 Pro");
    });

    it("should handle unknown GPU gracefully", () => {
      const profile = createMockProfile({
        gpu: {
          vendor: "Unknown",
          renderer: "Unknown",
          tier: "low",
          hasHardwareEncoding: false,
        },
      });
      const summary = formatDeviceSummary(profile);

      expect(summary).toContain("8 cores");
      expect(summary).not.toContain("Unknown");
    });
  });

});
