import { describe, it, expect } from "vitest";
import {
  computeCompressionPlan,
  estimateCompressedBytes,
  compressionPlanToExportSettings,
  COMPRESSION_SIZE_PRESETS,
  type CompressionSource,
} from "./compression";

const HD: CompressionSource = {
  durationSec: 60,
  width: 1920,
  height: 1080,
  frameRate: 30,
  hasAudio: true,
};

const UHD: CompressionSource = {
  durationSec: 60,
  width: 3840,
  height: 2160,
  frameRate: 30,
  hasAudio: true,
};

describe("computeCompressionPlan — quality mode", () => {
  it("light keeps up to 1080p with audio", () => {
    const plan = computeCompressionPlan(HD, { mode: "quality", quality: "light" });
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.audioBitrateKbps).toBe(160);
    expect(plan.videoBitrateKbps).toBeGreaterThan(300);
  });

  it("balanced caps the long edge at 1280 (720p)", () => {
    const plan = computeCompressionPlan(HD, {
      mode: "quality",
      quality: "balanced",
    });
    expect(Math.max(plan.width, plan.height)).toBe(1280);
    expect(plan.height).toBe(720);
  });

  it("strong caps the long edge at 854 and shrinks the most", () => {
    const strong = computeCompressionPlan(HD, {
      mode: "quality",
      quality: "strong",
    });
    const light = computeCompressionPlan(HD, {
      mode: "quality",
      quality: "light",
    });
    expect(Math.max(strong.width, strong.height)).toBe(854);
    expect(estimateCompressedBytes(strong, 60)).toBeLessThan(
      estimateCompressedBytes(light, 60),
    );
  });

  it("downscales a 4K source to the light tier (1080p)", () => {
    const light = computeCompressionPlan(UHD, {
      mode: "quality",
      quality: "light",
    });
    expect(Math.max(light.width, light.height)).toBe(1920);
    expect(light.height).toBe(1080);
  });

  it("emits no audio bitrate when the source is silent", () => {
    const plan = computeCompressionPlan(
      { ...HD, hasAudio: false },
      { mode: "quality", quality: "balanced" },
    );
    expect(plan.audioBitrateKbps).toBe(0);
  });

  it("always produces even dimensions", () => {
    const plan = computeCompressionPlan(
      { durationSec: 10, width: 1081, height: 607, frameRate: 30, hasAudio: true },
      { mode: "quality", quality: "light" },
    );
    expect(plan.width % 2).toBe(0);
    expect(plan.height % 2).toBe(0);
  });
});

describe("computeCompressionPlan — size mode", () => {
  it("estimated size lands within 2% of the requested target", () => {
    for (const preset of COMPRESSION_SIZE_PRESETS) {
      const plan = computeCompressionPlan(HD, {
        mode: "size",
        targetBytes: preset.bytes,
      });
      const estimated = estimateCompressedBytes(plan, HD.durationSec);
      const error = Math.abs(estimated - preset.bytes) / preset.bytes;
      expect(error).toBeLessThan(0.02);
    }
  });

  it("downscales when the target is too small to hold full resolution", () => {
    const tiny = computeCompressionPlan(UHD, {
      mode: "size",
      targetBytes: 8 * 1024 * 1024,
    });
    expect(Math.max(tiny.width, tiny.height)).toBeLessThan(3840);
  });

  it("keeps resolution when the target is generous", () => {
    const roomy = computeCompressionPlan(HD, {
      mode: "size",
      targetBytes: 200 * 1024 * 1024,
    });
    expect(roomy.width).toBe(1920);
    expect(roomy.height).toBe(1080);
  });

  it("never goes below the minimum video bitrate", () => {
    const plan = computeCompressionPlan(HD, {
      mode: "size",
      targetBytes: 100 * 1024,
    });
    expect(plan.videoBitrateKbps).toBeGreaterThanOrEqual(150);
  });
});

describe("compressionPlanToExportSettings", () => {
  it("maps plan fields onto VideoExportSettings", () => {
    const plan = computeCompressionPlan(HD, {
      mode: "quality",
      quality: "balanced",
    });
    const settings = compressionPlanToExportSettings(plan);
    expect(settings.codec).toBe("h264");
    expect(settings.width).toBe(plan.width);
    expect(settings.height).toBe(plan.height);
    expect(settings.bitrate).toBe(plan.videoBitrateKbps);
    expect(settings.audioSettings.bitrate).toBe(plan.audioBitrateKbps);
  });
});
