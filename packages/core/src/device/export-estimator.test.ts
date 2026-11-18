import { describe, it, expect } from "vitest";
import {
  estimateExportTime,
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

    it("should estimate faster for hardware-accelerated codecs", () => {
      const profile = createMockProfile();
      const h264Settings = createMockSettings({ codec: "h264" });
      const vp9Settings = createMockSettings({ codec: "vp9" });

      const h264Estimate = estimateExportTime(profile, h264Settings);
      const vp9Estimate = estimateExportTime(profile, vp9Settings);

      expect(h264Estimate.seconds).toBeLessThan(vp9Estimate.seconds);
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

  });

  describe("shouldRecommendBenchmark", () => {

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
