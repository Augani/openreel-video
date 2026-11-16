import { describe, expect, it } from "vitest";
import { getVideoExportValidationError } from "./browser-capabilities";
import type { VideoExportSettings } from "./types";

describe("export validation for profile-rated codecs", () => {
  const base = { width: 1920, height: 1080, frameRate: 24, bitrate: 0 } as VideoExportSettings;
  it("accepts bitrate 0 for ProRes and DNxHR (the profile sets the rate) but not for H.264", () => {
    expect(getVideoExportValidationError({ ...base, codec: "prores" }, 5)).toBeNull();
    expect(getVideoExportValidationError({ ...base, codec: "dnxhr" }, 5)).toBeNull();
    expect(getVideoExportValidationError({ ...base, codec: "h264" }, 5)).toMatch(/bitrate/);
  });

  it("validates the maximum bitrate against the target", () => {
    const vbr = { ...base, codec: "h264", bitrate: 8000, rateControl: "vbr" } as VideoExportSettings;
    expect(getVideoExportValidationError({ ...vbr, maxBitrate: 12000 }, 5)).toBeNull();
    expect(getVideoExportValidationError({ ...vbr, maxBitrate: 4000 }, 5)).toMatch(/maximum bitrate/);
    expect(getVideoExportValidationError({ ...vbr, maxBitrate: 0 }, 5)).toMatch(/maximum bitrate/);
  });
});
