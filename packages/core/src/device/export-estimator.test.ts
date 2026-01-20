import { describe, it, expect } from "vitest";
import {
  estimateExportTime,
  compareCodecEstimates,
  shouldRecommendBenchmark,
  type ExportEstimateSettings,
} from "./export-estimator";
import type { DeviceProfile, BenchmarkResult } from "./device-capabilities";

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

const createMockSettings = (
  overrides?: Partial<ExportEstimateSettings>
): ExportEstimateSettings => ({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 60,
  codec: "h264",
  ...overrides,
});

describe("ExportEstimator", () => {
  describe("estimateExportTime", () => {
    it("should return a time estimate with seconds and formatted string", () => {
      const profile = createMockProfile();
      const settings = createMockSettings();

      const estimate = estimateExportTime(profile, settings);

      expect(estimate).toHaveProperty("seconds");
      expect(estimate).toHaveProperty("formatted");
      expect(estimate).toHaveProperty("confidence");
      expect(estimate.seconds).toBeGreaterThan(0);
      expect(estimate.formatted).toMatch(/^~\d+/);
    });

    it("should estimate faster for hardware-accelerated codecs", () => {
      const profile = createMockProfile();
      const h264Settings = createMockSettings({ codec: "h264" });
      const vp9Settings = createMockSettings({ codec: "vp9" });

      const h264Estimate = estimateExportTime(profile, h264Settings);
      const vp9Estimate = estimateExportTime(profile, vp9Settings);

      expect(h264Estimate.seconds).toBeLessThan(vp9Estimate.seconds);
    });

    it("should estimate slower for higher resolutions", () => {
      const profile = createMockProfile();
      const settings1080p = createMockSettings({ width: 1920, height: 1080 });
      const settings4K = createMockSettings({ width: 3840, height: 2160 });

      const estimate1080p = estimateExportTime(profile, settings1080p);
      const estimate4K = estimateExportTime(profile, settings4K);

      expect(estimate4K.seconds).toBeGreaterThan(estimate1080p.seconds);
    });

    it("should estimate proportionally longer for longer durations", () => {
      const profile = createMockProfile();
      const settings30s = createMockSettings({ duration: 30 });
      const settings60s = createMockSettings({ duration: 60 });

      const estimate30s = estimateExportTime(profile, settings30s);
      const estimate60s = estimateExportTime(profile, settings60s);

      expect(estimate60s.seconds).toBeCloseTo(estimate30s.seconds * 2, 0);
    });

    it("should use benchmark data when available", () => {
      const benchmark: BenchmarkResult = {
        framesPerSecond: 100,
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        testedAt: Date.now(),
      };

      const profile = createMockProfile({ benchmark });
      const settings = createMockSettings({ duration: 10 });

      const estimate = estimateExportTime(profile, settings);

      expect(estimate.confidence).toBe("measured");
      expect(estimate.seconds).toBeCloseTo(3, 0);
    });

    it("should return estimated confidence when no benchmark", () => {
      const profile = createMockProfile();
      const settings = createMockSettings();

      const estimate = estimateExportTime(profile, settings);

      expect(estimate.confidence).toBe("estimated");
    });

    it("should include breakdown of rendering, encoding, and muxing", () => {
      const profile = createMockProfile();
      const settings = createMockSettings();

      const estimate = estimateExportTime(profile, settings);

      expect(estimate.breakdown).toBeDefined();
      expect(estimate.breakdown?.rendering).toBeGreaterThan(0);
      expect(estimate.breakdown?.encoding).toBeGreaterThan(0);
      expect(estimate.breakdown?.muxing).toBeGreaterThan(0);

      const total =
        estimate.breakdown!.rendering +
        estimate.breakdown!.encoding +
        estimate.breakdown!.muxing;
      expect(total).toBeCloseTo(estimate.seconds, 1);
    });

    it("should estimate slower for low-tier devices", () => {
      const highTierProfile = createMockProfile({ overallTier: "high" });
      const lowTierProfile = createMockProfile({ overallTier: "low" });
      const settings = createMockSettings();

      const highTierEstimate = estimateExportTime(highTierProfile, settings);
      const lowTierEstimate = estimateExportTime(lowTierProfile, settings);

      expect(lowTierEstimate.seconds).toBeGreaterThan(highTierEstimate.seconds);
    });

    it("should estimate slower when effects are present", () => {
      const profile = createMockProfile();
      const settingsNoEffects = createMockSettings({ hasEffects: false });
      const settingsWithEffects = createMockSettings({ hasEffects: true });

      const noEffectsEstimate = estimateExportTime(profile, settingsNoEffects);
      const withEffectsEstimate = estimateExportTime(profile, settingsWithEffects);

      expect(withEffectsEstimate.seconds).toBeGreaterThan(noEffectsEstimate.seconds);
    });

    it("should format time correctly for various durations", () => {
      const profile = createMockProfile();

      const shortEstimate = estimateExportTime(
        profile,
        createMockSettings({ duration: 5 })
      );
      expect(shortEstimate.formatted).toMatch(/~\d+ seconds?/);

      const benchmark: BenchmarkResult = {
        framesPerSecond: 1,
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        testedAt: Date.now(),
      };
      const slowProfile = createMockProfile({ benchmark });
      const longEstimate = estimateExportTime(
        slowProfile,
        createMockSettings({ duration: 300 })
      );
      expect(longEstimate.formatted).toMatch(/~\d+h|\d+m/);
    });
  });

  describe("compareCodecEstimates", () => {
    it("should return estimates for all supported codecs", () => {
      const profile = createMockProfile();
      const settings = { width: 1920, height: 1080, frameRate: 30, duration: 60 };

      const comparisons = compareCodecEstimates(profile, settings);

      expect(comparisons.length).toBeGreaterThan(0);
      expect(comparisons.some((c) => c.codec === "h264")).toBe(true);
    });

    it("should sort by estimated time (fastest first)", () => {
      const profile = createMockProfile();
      const settings = { width: 1920, height: 1080, frameRate: 30, duration: 60 };

      const comparisons = compareCodecEstimates(profile, settings);

      for (let i = 1; i < comparisons.length; i++) {
        expect(comparisons[i].estimate.seconds).toBeGreaterThanOrEqual(
          comparisons[i - 1].estimate.seconds
        );
      }
    });

    it("should include speed labels", () => {
      const profile = createMockProfile();
      const settings = { width: 1920, height: 1080, frameRate: 30, duration: 60 };

      const comparisons = compareCodecEstimates(profile, settings);

      comparisons.forEach((c) => {
        expect(c.speedLabel).toMatch(/Fast|Good|Slow|Very slow/i);
      });
    });

    it("should only include supported codecs", () => {
      const profile = createMockProfile({
        encoding: {
          h264: { hardware: true, supported: true },
          h265: { hardware: false, supported: false },
          vp9: { hardware: false, supported: false },
          av1: { hardware: false, supported: false },
        },
      });
      const settings = { width: 1920, height: 1080, frameRate: 30, duration: 60 };

      const comparisons = compareCodecEstimates(profile, settings);

      expect(comparisons.length).toBe(1);
      expect(comparisons[0].codec).toBe("h264");
    });
  });

  describe("shouldRecommendBenchmark", () => {
    it("should recommend benchmark when no benchmark exists", () => {
      const profile = createMockProfile();

      expect(shouldRecommendBenchmark(profile)).toBe(true);
    });

    it("should not recommend benchmark when recent benchmark exists", () => {
      const benchmark: BenchmarkResult = {
        framesPerSecond: 60,
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        testedAt: Date.now(),
      };
      const profile = createMockProfile({ benchmark });

      expect(shouldRecommendBenchmark(profile)).toBe(false);
    });

    it("should recommend benchmark when benchmark is older than 1 week", () => {
      const oneWeekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const benchmark: BenchmarkResult = {
        framesPerSecond: 60,
        codec: "h264",
        resolution: { width: 1920, height: 1080 },
        testedAt: oneWeekAgo,
      };
      const profile = createMockProfile({ benchmark });

      expect(shouldRecommendBenchmark(profile)).toBe(true);
    });
  });
});
