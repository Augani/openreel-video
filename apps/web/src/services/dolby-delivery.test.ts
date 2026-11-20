import { describe, expect, it } from "vitest";
import {
  DOLBY_BITRATES,
  exportSettingsRequireNativeEncoder,
  getVideoExportValidationError,
  isDolbyFormat,
  type AudioExportSettings,
  type VideoExportSettings,
} from "@openreel/core";
import { exportPresetsManager, parseVideoExportSettings } from "./export-presets";
import { extForFormat, mimeForExt } from "./export-runner";
import { getQuickExportPresets } from "./quick-export-presets";
import { dolbyStartFields } from "./native-ffmpeg-backend";
import { findVideoPreset } from "./agent/export-options";

const project = { width: 1920, height: 1080, frameRate: 30 };
const dolbyVideo = () => exportPresetsManager.getPresetsByPlatform("Dolby Digital");

describe("Dolby Digital export presets", () => {
  it("offers AC-3 and E-AC-3 video presets in MP4, MOV and MKV", () => {
    const byId = Object.fromEntries(dolbyVideo().map((p) => [p.id, p.settings as VideoExportSettings]));
    expect(Object.keys(byId).sort()).toEqual(["dolby-ac3-mkv", "dolby-ac3-mov", "dolby-ac3-mp4", "dolby-eac3-mkv", "dolby-eac3-mov", "dolby-eac3-mp4"]);
    expect(byId["dolby-ac3-mp4"]).toMatchObject({ format: "mp4", codec: "h264", audioSettings: { format: "ac3", bitrate: 448 } });
    expect(byId["dolby-eac3-mkv"]).toMatchObject({ format: "mkv", audioSettings: { format: "eac3", bitrate: 640 } });
  });

  it("every one is a delivery the desktop encoder writes (and the browser refuses with the desktop-only reason)", () => {
    for (const preset of dolbyVideo()) {
      const settings = preset.settings as VideoExportSettings;
      expect(exportSettingsRequireNativeEncoder(settings), preset.id).toBe(true);
      expect(isDolbyFormat(settings.audioSettings.format)).toBe(true);
      expect(DOLBY_BITRATES[settings.audioSettings.format as "ac3" | "eac3"]).toContain(settings.audioSettings.bitrate);
      expect(getVideoExportValidationError(settings, 10), preset.id).toBeNull();
    }
  });

  it("offers raw .ac3 / .ec3 audio presets that are valid audio settings", () => {
    const audio = exportPresetsManager.getPresetsByPlatform("Audio").filter((p) => isDolbyFormat((p.settings as AudioExportSettings).format));
    expect(audio.map((p) => p.id).sort()).toEqual(["audio-ac3", "audio-ac3-448", "audio-eac3", "audio-eac3-640"]);
    for (const preset of audio) expect(DOLBY_BITRATES[(preset.settings as AudioExportSettings).format as "ac3" | "eac3"]).toContain((preset.settings as AudioExportSettings).bitrate);
  });

  it("imported custom presets keep Dolby audio and the MKV container", () => {
    const parsed = parseVideoExportSettings(dolbyVideo().find((p) => p.id === "dolby-eac3-mkv")!.settings);
    expect(parsed).toMatchObject({ format: "mkv", audioSettings: { format: "eac3" } });
  });

  it("the agent's preset lookup finds them", () => {
    expect(findVideoPreset("dolby-ac3-mov", project)?.settings).toMatchObject({ format: "mov", audioSettings: { format: "ac3" } });
  });
});

describe("quick exports and file naming", () => {
  it("lists audio-only Dolby Digital and Digital Plus with their extensions", () => {
    const quick = getQuickExportPresets(project);
    expect(quick.find((p) => p.id === "ac3")).toMatchObject({ kind: "audio", extension: "ac3", settings: { format: "ac3", bitrate: 192 } });
    expect(quick.find((p) => p.id === "eac3")).toMatchObject({ kind: "audio", extension: "ec3", settings: { format: "eac3", bitrate: 256 } });
    expect(quick.find((p) => p.id === "wav")).toMatchObject({ extension: "wav" });
  });

  it("names the files .ac3 / .ec3 / .mkv and gives them a type", () => {
    expect(extForFormat("ac3")).toBe("ac3");
    expect(extForFormat("eac3")).toBe("ec3");
    expect(extForFormat("mkv", "h264")).toBe("mkv");
    expect(mimeForExt("ac3")).toBe("audio/ac3");
    expect(mimeForExt("ec3")).toBe("audio/eac3");
    expect(mimeForExt("mkv")).toBe("video/x-matroska");
  });
});

describe("desktop export request", () => {
  const settings = (audioSettings: Partial<AudioExportSettings>) => ({ audioSettings: { format: "aac", sampleRate: 48000, bitDepth: 16, bitrate: 192, channels: 2, ...audioSettings } }) as VideoExportSettings;

  it("carries the audio codec and the dialnorm for AC-3 / E-AC-3 only", () => {
    expect(dolbyStartFields(settings({ format: "ac3" }))).toEqual({ audioCodec: "ac3", dialnorm: -31 });
    expect(dolbyStartFields(settings({ format: "eac3", dialnorm: -24 }))).toEqual({ audioCodec: "eac3", dialnorm: -24 });
    expect(dolbyStartFields(settings({ format: "ac3", loudness: { enabled: true, targetLufs: -23, truePeakCeilingDb: -1 } }))).toEqual({ audioCodec: "ac3", dialnorm: -23 });
    expect(dolbyStartFields(settings({ format: "aac" }))).toEqual({});
  });
});
