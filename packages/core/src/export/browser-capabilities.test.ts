import { describe, expect, it, vi } from "vitest";
import { checkBrowserExportCapability, getMissingExportMedia, getVideoExportValidationError } from "./browser-capabilities";
import { DEFAULT_VIDEO_SETTINGS } from "./types";
import type { Project } from "../types/project";

function library(video: string | null = "avc", audio: string | null = "aac") {
  class Mp4 { getSupportedVideoCodecs() { return ["avc", "hevc", "vp9", "av1"]; } getSupportedAudioCodecs() { return ["aac", "opus"]; } }
  class WebM { getSupportedVideoCodecs() { return ["vp8", "vp9", "av1"]; } getSupportedAudioCodecs() { return ["opus"]; } }
  return { Mp4OutputFormat: Mp4, MovOutputFormat: Mp4, WebMOutputFormat: WebM, getFirstEncodableVideoCodec: vi.fn(async () => video), getFirstEncodableAudioCodec: vi.fn(async () => audio) } as unknown as typeof import("mediabunny");
}

describe("browser export preflight", () => {
  it("checks the exact selected codec and the actual output dimensions", async () => {
    const media = library();
    await expect(checkBrowserExportCapability(DEFAULT_VIDEO_SETTINGS, media)).resolves.toMatchObject({ supported: true, audioCodec: "aac" });
    expect(media.getFirstEncodableVideoCodec).toHaveBeenCalledWith(["avc"], { width: 1920, height: 1080, bitrate: 5_000_000 });
    expect(media.getFirstEncodableAudioCodec).toHaveBeenCalledWith(["aac", "opus"], { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 });
  });
  it("rejects an incompatible container before querying the encoder", async () => {
    const media = library();
    await expect(checkBrowserExportCapability({ ...DEFAULT_VIDEO_SETTINGS, format: "webm" }, media)).resolves.toMatchObject({ supported: false, reason: expect.stringContaining("VP9") });
    expect(media.getFirstEncodableVideoCodec).not.toHaveBeenCalled();
  });
  it("reports unsupported video and audio without guessing a substitute", async () => {
    await expect(checkBrowserExportCapability(DEFAULT_VIDEO_SETTINGS, library(null))).resolves.toMatchObject({ supported: false, reason: expect.stringContaining("cannot encode H264") });
    await expect(checkBrowserExportCapability(DEFAULT_VIDEO_SETTINGS, library("avc", null))).resolves.toMatchObject({ supported: false, reason: expect.stringContaining("cannot encode audio") });
    await expect(checkBrowserExportCapability({ ...DEFAULT_VIDEO_SETTINGS, format: "webm", codec: "vp9" }, library("vp9", "opus"))).resolves.toMatchObject({ supported: true, audioCodec: "opus" });
  });
  it("rejects native-only export requirements explicitly", async () => {
    for (const settings of [{ codec: "prores" }, { colorDepth: 10 }, { pixelFormat: "rgb" }] as const) {
      await expect(checkBrowserExportCapability({ ...DEFAULT_VIDEO_SETTINGS, ...settings }, library())).resolves.toMatchObject({ supported: false, reason: expect.stringContaining("desktop") });
    }
  });
  it("validates empty and nonfinite settings before browser clamping", () => {
    expect(getVideoExportValidationError(DEFAULT_VIDEO_SETTINGS, 0)).toContain("Add a clip");
    expect(getVideoExportValidationError({ ...DEFAULT_VIDEO_SETTINGS, width: 0 }, 2)).toContain("width");
    expect(getVideoExportValidationError({ ...DEFAULT_VIDEO_SETTINGS, frameRate: NaN }, 2)).toContain("frame rate");
    expect(getVideoExportValidationError({ ...DEFAULT_VIDEO_SETTINGS, bitrate: Infinity }, 2)).toContain("bitrate");
  });
  it("requires referenced original files even if a preview proxy exists", () => {
    const project = { timeline: { tracks: [{ clips: [{ mediaId: "video" }] }] }, mediaLibrary: { items: [{ id: "video", name: "Original.mp4", type: "video", blob: null, proxyUrl: "blob:proxy" }, { id: "unused", name: "Unused.mp4", type: "video", blob: null }] } } as unknown as Project;
    expect(getMissingExportMedia(project)).toEqual(["Original.mp4"]);
    project.mediaLibrary.items[0] = { ...project.mediaLibrary.items[0], blob: new Blob(["original"]) };
    expect(getMissingExportMedia(project)).toEqual([]);
  });
});
