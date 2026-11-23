import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));

import { AUDIO_SERVICE_LAUNCH_ON_STARTUP, buildEnableFeatures, buildJsFlags, computeMaxOldSpaceMb, parseFallbackLaunches } from "./switches";

const GB = 1024 ** 3;

describe("computeMaxOldSpaceMb", () => {
  it("floors small machines, scales in between and caps large ones", () => {
    expect(computeMaxOldSpaceMb(4 * GB)).toBe(4096);
    expect(computeMaxOldSpaceMb(24 * GB)).toBe(Math.floor(24 * 1024 * 0.3));
    expect(computeMaxOldSpaceMb(128 * GB)).toBe(8192);
  });
});

describe("parseFallbackLaunches", () => {
  it("reads the launch counter and treats legacy timestamps and garbage as one launch", () => {
    expect(parseFallbackLaunches("3")).toBe(3);
    expect(parseFallbackLaunches("2\n")).toBe(2);
    expect(parseFallbackLaunches("1767225600000")).toBe(1);
    expect(parseFallbackLaunches("abc")).toBe(1);
    expect(parseFallbackLaunches("0")).toBe(1);
  });
});

describe("buildJsFlags", () => {
  it("always caps the old space and appends the experiment flags last", () => {
    expect(buildJsFlags(24 * GB)).toBe(`--max-old-space-size=${Math.floor(24 * 1024 * 0.3)}`);
    expect(buildJsFlags(4 * GB, "  --min-semi-space-size=16 ")).toBe("--max-old-space-size=4096 --min-semi-space-size=16");
    expect(buildJsFlags(4 * GB, "   ")).toBe("--max-old-space-size=4096");
  });
});

describe("buildEnableFeatures", () => {
  it("always starts the audio service with the app (cold-start warm-up) and adds the VA-API pair only on aggressive Linux", () => {
    expect(buildEnableFeatures("darwin")).toEqual([AUDIO_SERVICE_LAUNCH_ON_STARTUP]);
    expect(buildEnableFeatures("win32", true)).toEqual([AUDIO_SERVICE_LAUNCH_ON_STARTUP]);
    expect(buildEnableFeatures("linux")).toEqual([AUDIO_SERVICE_LAUNCH_ON_STARTUP]);
    expect(buildEnableFeatures("linux", true)).toEqual([
      AUDIO_SERVICE_LAUNCH_ON_STARTUP,
      "VaapiVideoDecoder",
      "VaapiVideoEncoder",
    ]);
  });
});
