import { describe, expect, it } from "vitest";
import { checkExportRequest, parseExportRequest } from "@openreel/agent";
import { buildExportCatalog, buildVideoExportSettings, extendedSettingsPatch, findVideoPreset } from "./export-options";

const project = { width: 1920, height: 1080, frameRate: 30 };
const allEncoders = ["libx264", "libx265", "prores_ks", "dnxhd", "mpeg2video", "libvpx-vp9", "libsvtav1"];

const desktop = buildExportCatalog({ desktop: true, encoders: allEncoders, hdr: { supported: true }, project });
const web = buildExportCatalog({ desktop: false, hdr: { supported: false, reason: "This browser cannot encode 10-bit HEVC." }, project });

const format = (catalog: typeof desktop, id: string) => catalog.formats.find((entry) => entry.id === id)!;

describe("buildExportCatalog", () => {
  it("lists every container with its codecs, bit depths and HDR on a full desktop build", () => {
    expect(desktop.platform).toBe("desktop");
    expect(desktop.formats.map((entry) => entry.id)).toEqual(["mp4", "mov", "webm", "mxf"]);
    expect(format(desktop, "mp4")).toMatchObject({ available: true, codecs: ["h264", "h265", "av1"], bitDepths: [8, 10], hdr: ["sdr", "pq", "hlg"] });
    expect(format(desktop, "mov").codecs).toEqual(["h264", "h265", "prores", "dnxhr", "xdcamhd422", "avcintra100"]);
    expect(format(desktop, "mxf")).toMatchObject({ available: true, codecs: ["dnxhr", "xdcamhd422", "avcintra100"] });
    expect(desktop.timecode.supported).toBe(true);
    expect(desktop.audioLayouts).toEqual(["mono", "stereo", "5.1"]);
  });

  it("carries the quick presets, the platform presets and the audio preset", () => {
    const ids = desktop.presets.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining(["mp4", "1080p-high", "1080p-60", "wav", "youtube-4k"]));
    expect(desktop.presets.find((entry) => entry.id === "wav")).toMatchObject({ kind: "audio" });
    expect(desktop.presets.find((entry) => entry.id === "youtube-4k")).toMatchObject({ kind: "video", width: 3840, height: 2160, codec: "h264", bitrateKbps: 50000 });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts the project size first and offers common frame rates", () => {
    expect(desktop.resolutions[0]).toEqual({ label: "Project size", width: 1920, height: 1080 });
    expect(desktop.frameRates).toEqual(expect.arrayContaining([23.976, 24, 25, 29.97, 30, 60]));
  });

  it("marks desktop-only containers and timecode unavailable on the web, with reasons", () => {
    expect(format(web, "mxf")).toMatchObject({ available: false, reason: expect.stringMatching(/desktop/) });
    expect(format(web, "mov").codecs).toEqual(["h264", "h265"]);
    expect(format(web, "mov").unavailableCodecs?.some((entry) => entry.codec === "prores")).toBe(true);
    expect(web.timecode.supported).toBe(false);
    expect(web.hdr).toEqual({ supported: false, reason: "This browser cannot encode 10-bit HEVC." });
    expect(format(web, "mp4").hdr).toEqual(["sdr"]);
    expect(format(web, "mp4").bitDepths).toEqual([8]);
  });

  it("drops a codec the desktop ffmpeg cannot encode and says why", () => {
    const noProres = buildExportCatalog({ desktop: true, encoders: ["libx264", "libx265"], hdr: { supported: true }, project });
    const mov = format(noProres, "mov");
    expect(mov.codecs).not.toContain("prores");
    expect(mov.unavailableCodecs?.find((entry) => entry.codec === "prores")?.reason).toMatch(/no ProRes encoder/);
    expect(format(noProres, "mxf")).toMatchObject({ available: true, codecs: ["avcintra100"] });
    expect(format(noProres, "mxf").unavailableCodecs?.map((entry) => entry.codec)).toEqual(["dnxhr", "xdcamhd422"]);
    const noHdr = buildExportCatalog({ desktop: true, encoders: ["libx264"], hdr: { supported: false, reason: "no 10-bit HEVC" }, project });
    expect(noHdr.hdr.supported).toBe(false);
  });

  it("answers UNSUPPORTED from the shared validator for combinations the catalog excludes", () => {
    const parsed = parseExportRequest({ format: "mp4", codec: "h264", hdr: "pq" });
    if (!parsed.ok) throw new Error("parse");
    expect(checkExportRequest(parsed.value, desktop)).toMatchObject({ code: "UNSUPPORTED" });
    const hdrWeb = parseExportRequest({ hdr: "pq" });
    if (!hdrWeb.ok) throw new Error("parse");
    const issue = checkExportRequest(hdrWeb.value, web);
    expect(issue?.code).toBe("UNSUPPORTED");
    expect(issue?.message).toMatch(/10-bit HEVC/);
  });
});

describe("findVideoPreset", () => {
  it("finds quick and platform presets and ignores the audio one", () => {
    expect(findVideoPreset("4k", project)?.settings).toMatchObject({ width: 3840, height: 2160 });
    expect(findVideoPreset("youtube-4k", project)?.label).toBe("YouTube 4K");
    expect(findVideoPreset("wav", project)).toBeUndefined();
    expect(findVideoPreset("nope", project)).toBeUndefined();
  });
});

describe("extendedSettingsPatch rate control", () => {
  it("maxBitrateKbps implies VBR; quality and vbr are explicit", () => {
    expect(extendedSettingsPatch({ maxBitrateKbps: 12000 }, project)).toMatchObject({ rateControl: "vbr", maxBitrate: 12000 });
    expect(extendedSettingsPatch({ rateControl: "vbr" }, project)).toEqual({ rateControl: "vbr" });
    expect(extendedSettingsPatch({ rateControl: "quality" }, project)).toEqual({ rateControl: "quality" });
  });
  it("buildVideoExportSettings rejects a peak below the target", () => {
    expect(() => buildVideoExportSettings({ bitrateKbps: 8000, maxBitrateKbps: 4000 }, project, 10)).toThrow(/maximum bitrate/);
    expect(buildVideoExportSettings({ bitrateKbps: 8000, maxBitrateKbps: 9000 }, project, 10).settings).toMatchObject({ bitrate: 8000, maxBitrate: 9000, rateControl: "vbr" });
  });
});

describe("extendedSettingsPatch", () => {
  it("HDR sets 10-bit colour depth and the transfer; ProRes HDR uses 4444 XQ", () => {
    expect(extendedSettingsPatch({ hdr: "pq" }, project)).toMatchObject({ hdr: "pq", colorDepth: 10 });
    expect(extendedSettingsPatch({ hdr: "hlg", codec: "prores" }, project)).toMatchObject({ hdr: "hlg", colorDepth: 10, proresProfile: "4444xq" });
  });

  it("maps audio layouts, loudness and the start timecode", () => {
    expect(extendedSettingsPatch({ audioChannels: "mono" }, project).audioSettings).toMatchObject({ channels: 1 });
    expect(extendedSettingsPatch({ audioChannels: "stereo" }, project).audioSettings).toMatchObject({ channels: 2, channelLayout: "stereo" });
    expect(extendedSettingsPatch({ audioChannels: "5.1" }, project).audioSettings).toMatchObject({ channels: 6, channelLayout: "5.1" });
    expect(extendedSettingsPatch({ targetLufs: -23 }, project).audioSettings?.loudness).toEqual({ enabled: true, targetLufs: -23, truePeakCeilingDb: -1 });
    expect(extendedSettingsPatch({ timecode: true }, { ...project, startTimecode: "01:00:00:00" }).broadcast).toEqual({ startTimecode: "01:00:00:00" });
    expect(extendedSettingsPatch({ timecode: true }, project).broadcast).toEqual({ startTimecode: "00:00:00:00" });
  });

  it("rejects loudness targets the engine would refuse", () => {
    expect(() => extendedSettingsPatch({ targetLufs: 3 }, project)).toThrow(/targetLufs/);
  });
});

describe("buildVideoExportSettings", () => {
  it("merges preset, defaults and explicit options", () => {
    const built = buildVideoExportSettings({ presetId: "youtube-4k", frameRate: 60, bitrateKbps: 40000 }, project, 12);
    expect(built.presetLabel).toBe("YouTube 4K");
    expect(built.settings).toMatchObject({ width: 3840, height: 2160, frameRate: 60, bitrate: 40000, format: "mp4", codec: "h264" });
  });

  it("builds a 10-bit HDR HEVC export", () => {
    const built = buildVideoExportSettings({ format: "mp4", codec: "h265", hdr: "pq" }, project, 12);
    expect(built.settings).toMatchObject({ codec: "h265", format: "mp4", hdr: "pq", colorDepth: 10, width: 1920, height: 1080 });
    expect(built.ext).toBe("mp4");
  });

  it("builds a ProRes MOV with the profile and an SDR request clears HDR from a preset", () => {
    const built = buildVideoExportSettings({ format: "mov", codec: "prores", bitDepth: 10 }, project, 12);
    expect(built.settings).toMatchObject({ codec: "prores", format: "mov", proresProfile: "hq", colorDepth: 10 });
    const sdr = buildVideoExportSettings({ hdr: "sdr" }, project, 12);
    expect(sdr.settings.hdr).toBeUndefined();
  });

  it("refuses an unknown preset, an empty timeline and invalid broadcast sizes", () => {
    expect(() => buildVideoExportSettings({ presetId: "nope" }, project, 12)).toThrow(/Unknown video preset/);
    expect(() => buildVideoExportSettings({}, project, 0)).toThrow(/Add a clip/);
    expect(() => buildVideoExportSettings({ format: "mxf", codec: "xdcamhd422", width: 3840, height: 2160 }, project, 12)).toThrow(/1920x1080/);
  });
});
