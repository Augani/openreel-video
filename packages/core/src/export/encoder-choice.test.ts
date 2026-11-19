import { describe, expect, it } from "vitest";
import {
  describeBrowserEncoderOptions,
  describeEncoderOptions,
  hardwareFamilyOf,
  resolveEncoderChoice,
  webCodecsHardwareHint,
  webCodecsEncoderOptions,
  encoderChoiceForcesNative,
} from "./encoder-choice";

const mac = ["libx264", "libx265", "h264_videotoolbox", "hevc_videotoolbox"];
const win = ["libx264", "libx265", "h264_nvenc", "h264_qsv", "hevc_nvenc", "av1_nvenc"];

describe("resolveEncoderChoice", () => {
  it("maps Auto to the platform hardware encoder and Software to the CPU encoder", () => {
    expect(resolveEncoderChoice({ codec: "h264", choice: "auto", platform: "darwin", available: mac })).toMatchObject({ encoder: "h264_videotoolbox", hardware: true, family: "videotoolbox" });
    expect(resolveEncoderChoice({ codec: "h264", choice: "software", platform: "darwin", available: mac })).toMatchObject({ encoder: "libx264", hardware: false });
    expect(resolveEncoderChoice({ codec: "h265", choice: "hardware", platform: "darwin", available: mac }).encoder).toBe("hevc_videotoolbox");
  });
  it("prefers NVENC over Quick Sync on Windows and maps AV1", () => {
    expect(resolveEncoderChoice({ codec: "h264", choice: "auto", platform: "win32", available: win }).family).toBe("nvenc");
    expect(resolveEncoderChoice({ codec: "h264", choice: "hardware", platform: "win32", available: ["libx264", "h264_qsv"] }).family).toBe("qsv");
    expect(resolveEncoderChoice({ codec: "av1", choice: "auto", platform: "win32", available: win }).encoder).toBe("av1_nvenc");
  });
  it("Auto falls back to software; Hardware never does and says why", () => {
    const softwareOnly = ["libx264"];
    expect(resolveEncoderChoice({ codec: "h264", choice: "auto", platform: "win32", available: softwareOnly })).toMatchObject({ encoder: "libx264", hardware: false });
    const hw = resolveEncoderChoice({ codec: "h264", choice: "hardware", platform: "win32", available: softwareOnly });
    expect(hw.encoder).toBeNull();
    expect(hw.reason).toMatch(/NVIDIA NVENC/);
  });
  it("never picks VAAPI, and reports an encoder missing from the build", () => {
    expect(resolveEncoderChoice({ codec: "h264", choice: "hardware", platform: "linux", available: ["libx264", "h264_vaapi"] }).encoder).toBeNull();
    expect(resolveEncoderChoice({ codec: "h264", choice: "software", platform: "linux", available: ["h264_nvenc"] }).reason).toMatch(/libx264/);
  });
  it("AV1 has no VideoToolbox encoder", () => {
    expect(resolveEncoderChoice({ codec: "av1", choice: "hardware", platform: "darwin", available: ["libsvtav1"] }).reason).toMatch(/no AV1 encoder on this platform/i);
  });
  it("leaves fixed-encoder codecs alone", () => {
    expect(resolveEncoderChoice({ codec: "prores", choice: "hardware", platform: "darwin", available: mac }).encoder).toBeNull();
  });
  it("identifies hardware families", () => {
    expect(hardwareFamilyOf("h264_amf")).toBe("amf");
    expect(hardwareFamilyOf("libx264")).toBeNull();
  });
});

describe("describeEncoderOptions", () => {
  it("shows what each choice uses on this machine", () => {
    const options = describeEncoderOptions({ codec: "h264", platform: "darwin", available: mac });
    expect(options.map((o) => o.available)).toEqual([true, true, true]);
    expect(options[1].detail).toBe("Apple VideoToolbox (h264_videotoolbox)");
    expect(options[2].detail).toBe("libx264, CPU");
  });
  it("marks Hardware unavailable honestly and keeps Auto usable", () => {
    const options = describeEncoderOptions({ codec: "h264", platform: "linux", available: ["libx264"] });
    expect(options.find((o) => o.choice === "hardware")).toMatchObject({ available: false });
    expect(options.find((o) => o.choice === "auto")).toMatchObject({ available: true });
  });
  it("only Auto is selectable while the probe is pending", () => {
    expect(describeEncoderOptions({ codec: "h264", platform: "", available: null }).map((o) => o.available)).toEqual([true, false, false]);
  });
});

describe("browser (WebCodecs) mapping", () => {
  it("reflects the probe result", () => {
    expect(describeBrowserEncoderOptions({ hardware: false, software: true }).map((o) => o.available)).toEqual([true, false, true]);
    expect(describeBrowserEncoderOptions({ hardware: false, software: false }).every((o) => !o.available)).toBe(true);
  });
  it("maps choices onto the hardwareAcceleration hint", () => {
    expect(webCodecsHardwareHint("software")).toBe("prefer-software");
    expect(webCodecsHardwareHint("hardware")).toBe("prefer-hardware");
    expect(webCodecsHardwareHint(undefined)).toBe("prefer-hardware");
  });
});

describe("strict WebCodecs options and native routing", () => {
  it("makes Hardware and Software strict, Auto lenient", () => {
    expect(webCodecsEncoderOptions("software")).toEqual({ hardwareAcceleration: "prefer-software", strictHardwareAcceleration: true });
    expect(webCodecsEncoderOptions("hardware")).toEqual({ hardwareAcceleration: "prefer-hardware", strictHardwareAcceleration: true });
    expect(webCodecsEncoderOptions("auto").strictHardwareAcceleration).toBe(false);
    expect(webCodecsEncoderOptions(undefined).strictHardwareAcceleration).toBe(false);
  });

  it("sends explicit choices for H.264/H.265/AV1 to the ffmpeg sidecar on desktop", () => {
    expect(encoderChoiceForcesNative("hardware", "h264")).toBe(true);
    expect(encoderChoiceForcesNative("software", "h265")).toBe(true);
    expect(encoderChoiceForcesNative("auto", "h264")).toBe(false);
    expect(encoderChoiceForcesNative("hardware", "prores")).toBe(false);
  });
});
