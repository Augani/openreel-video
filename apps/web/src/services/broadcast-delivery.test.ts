import { describe, expect, it } from "vitest";
import { broadcastDeliveryProblem, exportSettingsRequireNativeEncoder, type Clip, type MediaItem, type VideoExportSettings } from "@openreel/core";
import { exportPresetsManager } from "./export-presets";
import { broadcastStartFields } from "./native-ffmpeg-backend";
import { clipSourceTimecodeRange } from "./source-timecode";
import { describePreset } from "../stores/export-queue-store";

const delivery = () => exportPresetsManager.getPresetsByPlatform("Delivery");
const byId = () => Object.fromEntries(delivery().map((p) => [p.id, p.settings as VideoExportSettings]));

describe("broadcast delivery presets", () => {
  it("offers XDCAM HD422 (1080i25, 1080i29.97 drop frame, 1080p25, OP-Atom), AVC-Intra 100 and an 8-track ProRes MOV", () => {
    const presets = byId();
    expect(presets["delivery-xdcam-1080i25-mxf"]).toMatchObject({
      codec: "xdcamhd422", format: "mxf", width: 1920, height: 1080, frameRate: 25,
      broadcast: { scan: "interlaced-tff", audioTracks: 8, startTimecode: "10:00:00:00" },
    });
    expect(presets["delivery-xdcam-1080i2997-mxf"]).toMatchObject({ frameRate: 29.97, broadcast: { scan: "interlaced-tff", startTimecode: "10:00:00;00" } });
    expect(presets["delivery-xdcam-1080p25-mxf"].broadcast?.scan).toBeUndefined();
    expect(presets["delivery-xdcam-1080i25-opatom"]).toMatchObject({ format: "mxf", broadcast: { mxfPattern: "opatom", audioTracks: 8 } });
    expect(presets["delivery-avcintra100-1080i25-mxf"]).toMatchObject({ codec: "avcintra100", format: "mxf", broadcast: { scan: "interlaced-tff" } });
    expect(presets["delivery-avcintra100-1080p25-mxf"]).toMatchObject({ codec: "avcintra100", format: "mxf" });
    expect(presets["delivery-prores-422hq-8ch-mov"]).toMatchObject({ codec: "prores", format: "mov", proresProfile: "hq", broadcast: { audioTracks: 8, startTimecode: "10:00:00:00" } });
  });

  it("every broadcast preset is a valid delivery and needs the desktop encoder (the web build explains that)", () => {
    const presets = Object.entries(byId()).filter(([id]) => /xdcam|avcintra|8ch/.test(id));
    expect(presets.length).toBeGreaterThanOrEqual(7);
    for (const [id, settings] of presets) {
      expect(exportSettingsRequireNativeEncoder(settings), id).toBe(true);
      expect(broadcastDeliveryProblem(settings), id).toBeNull();
      expect(settings.audioSettings, id).toMatchObject({ format: "wav", bitDepth: 24, sampleRate: 48000 });
    }
  });

  it("queue rows name the broadcast codecs", () => {
    expect(describePreset({ width: 1920, height: 1080, frameRate: 25, codec: "xdcamhd422", format: "mxf" })).toBe("1080p 25fps XDCAM HD422 MXF");
    expect(describePreset({ width: 1920, height: 1080, frameRate: 25, codec: "avcintra100", format: "mxf" })).toBe("1080p 25fps AVC-Intra 100 MXF");
  });
});

describe("broadcastStartFields (renderer to the sidecar)", () => {
  const settings = (over: Partial<VideoExportSettings>): VideoExportSettings => ({
    format: "mxf", codec: "xdcamhd422", width: 1920, height: 1080, frameRate: 25, bitrate: 0, bitrateMode: "cbr", quality: 100, keyframeInterval: 1,
    audioSettings: { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 },
    ...over,
  });
  it("sends nothing for a plain export", () => {
    expect(broadcastStartFields(settings({}))).toEqual({});
  });
  it("sends scan, OP-Atom, the mono track count and the timecode", () => {
    expect(broadcastStartFields(settings({ broadcast: { scan: "interlaced-tff", mxfPattern: "opatom", audioTracks: 8, startTimecode: "10:00:00:00" } }))).toEqual({
      scan: "interlaced-tff", mxfPattern: "opatom", audioTrackCount: 8, startTimecode: "10:00:00:00",
    });
  });
  it("the file timecode follows the In point of a range export, and OP-Atom is dropped outside MXF", () => {
    const fields = broadcastStartFields(settings({ format: "mov", codec: "prores", range: { startTime: 4, endTime: 8 }, broadcast: { mxfPattern: "opatom", startTimecode: "10:00:00:00" } }));
    expect(fields).toEqual({ startTimecode: "10:00:04:00" });
  });
  it("a timecode for MP4 is not sent (no timecode track there)", () => {
    expect(broadcastStartFields(settings({ format: "mp4", codec: "h264", broadcast: { startTimecode: "10:00:00:00" } }))).toEqual({});
  });
});

describe("source timecode of a clip", () => {
  const media = (text: string | undefined, start = 36000): Pick<MediaItem, "metadata"> => ({
    metadata: { duration: 10, width: 1920, height: 1080, frameRate: 25, codec: "mpeg2video", sampleRate: 48000, channels: 2, fileSize: 1, ...(text ? { startTimecode: start, startTimecodeText: text } : {}) },
  });
  const clip = { inPoint: 2, outPoint: 4.48 } as Pick<Clip, "inPoint" | "outPoint">;
  it("is the file's start timecode plus the In and Out points", () => {
    expect(clipSourceTimecodeRange(media("10:00:00:00"), clip)).toBe("10:00:02:00 → 10:00:04:12");
  });
  it("is absent for media without an embedded timecode", () => {
    expect(clipSourceTimecodeRange(media(undefined), clip)).toBeUndefined();
    expect(clipSourceTimecodeRange(undefined, clip)).toBeUndefined();
  });
});
