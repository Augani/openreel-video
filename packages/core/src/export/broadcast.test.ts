import { describe, expect, it, vi } from "vitest";

// export-engine pulls in the decode worker module, which reads `self` at load time.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self ??= globalThis;
});
import {
  BROADCAST_AUDIO_TRACK_OPTIONS,
  broadcastAudioTrackCount,
  broadcastDeliveryProblem,
  exportStartTimecode,
  isBroadcastCodec,
  layoutBroadcastChannels,
  normalizeStartTimecode,
  planBroadcastChannels,
  secondsToStartTimecode,
  sequencePositionOf,
  sequenceTimecodeAt,
  sourceTimecodeAt,
  timecodeToSeconds,
} from "./broadcast";
import { exportSettingsRequireNativeEncoder, hasBroadcastOptions } from "./export-engine";
import { getVideoExportValidationError } from "./browser-capabilities";
import type { VideoExportSettings } from "./types";

const xdcam = { codec: "xdcamhd422", format: "mxf", width: 1920, height: 1080, frameRate: 25 } as const;

describe("start timecode", () => {
  it("accepts HH:MM:SS:FF and the drop-frame semicolon only at 29.97 / 59.94", () => {
    expect(normalizeStartTimecode("10:00:00:00", 25)).toBe("10:00:00:00");
    expect(normalizeStartTimecode("10:00:00;00", 29.97)).toBe("10:00:00;00");
    expect(normalizeStartTimecode("10:00:00:00", 29.97)).toBe("10:00:00:00");
    // a semicolon at a rate that cannot drop frames is plain non-drop
    expect(normalizeStartTimecode("10:00:00;00", 25)).toBe("10:00:00:00");
  });
  it("rejects malformed, out-of-range and dropped-frame values", () => {
    expect(normalizeStartTimecode("10:00", 25)).toBeNull();
    expect(normalizeStartTimecode("10:00:00:25", 25)).toBeNull();
    expect(normalizeStartTimecode("24:00:00:00", 25)).toBeNull();
    expect(normalizeStartTimecode("10:01:00;00", 29.97)).toBeNull();
    expect(normalizeStartTimecode("nope", 25)).toBeNull();
  });
  it("the file's timecode moves with the In point of a range export", () => {
    expect(exportStartTimecode("10:00:00:00", 25, 0)).toBe("10:00:00:00");
    expect(exportStartTimecode("10:00:00:00", 25, 2)).toBe("10:00:02:00");
    expect(exportStartTimecode("10:00:00;00", 30000 / 1001, 60)).toBe("10:00:59;28");
    expect(exportStartTimecode("bad", 25, 1)).toBeNull();
  });
  it("converts a media start timecode to seconds and back", () => {
    expect(timecodeToSeconds("10:00:00:00", 25)).toBe(36000);
    expect(timecodeToSeconds("01:00:00:12", 24)).toBe(3600.5);
    expect(secondsToStartTimecode(36000.04, 25)).toBe("10:00:00:01");
    expect(sourceTimecodeAt(36000, 2, 25)).toBe("10:00:02:00");
  });
  it("shows the sequence timecode of a position and parses it back", () => {
    expect(sequenceTimecodeAt(1.48, "10:00:00:00", 25)).toBe("10:00:01:12");
    expect(sequenceTimecodeAt(1.5, undefined, 25)).toBeNull();
    expect(sequencePositionOf("10:00:01:12", "10:00:00:00", 25)).toBe(1.48);
    expect(sequencePositionOf("09:59:59:00", "10:00:00:00", 25)).toBeNull();
    expect(sequenceTimecodeAt(0, "10:00:00;00", 30000 / 1001)).toBe("10:00:00;00");
    expect(sequencePositionOf(sequenceTimecodeAt(61.5, "10:00:00;00", 30000 / 1001)!, "10:00:00;00", 30000 / 1001)).toBeCloseTo(61.5, 1);
  });
});

describe("delivery rules", () => {
  it("recognises the broadcast codecs", () => {
    expect(isBroadcastCodec("xdcamhd422")).toBe(true);
    expect(isBroadcastCodec("avcintra100")).toBe(true);
    expect(isBroadcastCodec("prores")).toBe(false);
    expect(isBroadcastCodec(undefined)).toBe(false);
  });
  it("accepts 1080i25 XDCAM HD422 with eight mono tracks and a start timecode", () => {
    expect(broadcastDeliveryProblem({ ...xdcam, broadcast: { scan: "interlaced-tff", audioTracks: 8, startTimecode: "10:00:00:00" } })).toBeNull();
  });
  it("XDCAM and AVC-Intra are 1920x1080 / 1280x720 at broadcast rates in MXF or MOV", () => {
    expect(broadcastDeliveryProblem({ ...xdcam, width: 1280, height: 1080 })).toMatch(/1920x1080 or 1280x720/);
    expect(broadcastDeliveryProblem({ ...xdcam, format: "mp4" })).toMatch(/MXF/);
    expect(broadcastDeliveryProblem({ ...xdcam, frameRate: 12 })).toMatch(/frame rate/);
    expect(broadcastDeliveryProblem({ ...xdcam, frameRate: 50 })).toMatch(/720p/);
    expect(broadcastDeliveryProblem({ ...xdcam, width: 1280, height: 720, frameRate: 50 })).toBeNull();
    expect(broadcastDeliveryProblem({ ...xdcam, width: 1280, height: 720, broadcast: { scan: "interlaced-tff" } })).toMatch(/progressive at 720p/);
    expect(broadcastDeliveryProblem({ ...xdcam, codec: "avcintra100", width: 1280, height: 1080 })).toMatch(/AVC-Intra 100/);
  });
  it("OP-Atom needs MXF, interlaced needs a broadcast codec, tracks are 2 to 16", () => {
    expect(broadcastDeliveryProblem({ ...xdcam, format: "mov", broadcast: { mxfPattern: "opatom" } })).toMatch(/OP-Atom/);
    expect(broadcastDeliveryProblem({ codec: "prores", format: "mov", width: 1920, height: 1080, frameRate: 25, broadcast: { scan: "interlaced-tff" } })).toMatch(/Interlaced/);
    expect(broadcastDeliveryProblem({ codec: "prores", format: "mov", width: 1920, height: 1080, frameRate: 25, broadcast: { audioTracks: 8 } })).toBeNull();
    expect(broadcastDeliveryProblem({ ...xdcam, broadcast: { audioTracks: 17 } })).toMatch(/2 to 16/);
    expect(broadcastDeliveryProblem({ ...xdcam, broadcast: { audioTracks: 1 } })).toMatch(/2 to 16/);
    expect(broadcastDeliveryProblem({ codec: "h264", format: "mp4", width: 1920, height: 1080, frameRate: 25, broadcast: { audioTracks: 8 } })).toMatch(/MXF or MOV/);
  });
  it("a bad timecode is reported with the frame rate", () => {
    expect(broadcastDeliveryProblem({ ...xdcam, broadcast: { startTimecode: "10:00:00:30" } })).toMatch(/not a valid timecode at 25 fps/);
  });
  it("stems cannot combine with loudness normalisation (stereo mix only)", () => {
    expect(broadcastDeliveryProblem({ ...xdcam, broadcast: { audioTracks: 8, extraTracks: "stems" }, audioSettings: { loudness: { enabled: true } } })).toMatch(/Loudness/);
    expect(broadcastDeliveryProblem({ ...xdcam, broadcast: { audioTracks: 8, extraTracks: "silence" }, audioSettings: { loudness: { enabled: true } } })).toBeNull();
  });
  it("is part of the export validation the dialog and the engine run", () => {
    const settings = { ...xdcam, bitrate: 0, bitrateMode: "cbr", quality: 100, keyframeInterval: 1, audioSettings: { format: "wav", sampleRate: 48000, bitDepth: 24, bitrate: 0, channels: 2 }, broadcast: { audioTracks: 99 } } as unknown as VideoExportSettings;
    expect(getVideoExportValidationError(settings, 10)).toMatch(/2 to 16/);
    // the fixed 50 Mb/s class means no bitrate is asked for
    expect(getVideoExportValidationError({ ...settings, broadcast: undefined }, 10)).toBeNull();
  });
});

describe("native routing", () => {
  it("broadcast codecs and broadcast options need the desktop encoder", () => {
    expect(exportSettingsRequireNativeEncoder({ codec: "xdcamhd422", format: "mxf" })).toBe(true);
    expect(exportSettingsRequireNativeEncoder({ codec: "avcintra100", format: "mov" })).toBe(true);
    expect(exportSettingsRequireNativeEncoder({ codec: "h264", format: "mov", broadcast: { audioTracks: 8 } })).toBe(true);
    expect(exportSettingsRequireNativeEncoder({ codec: "h264", format: "mov", broadcast: { startTimecode: "10:00:00:00" } })).toBe(true);
    expect(exportSettingsRequireNativeEncoder({ codec: "h264", format: "mp4" })).toBe(false);
    expect(hasBroadcastOptions(undefined)).toBe(false);
    expect(hasBroadcastOptions({})).toBe(false);
  });
});

describe("mono track layout", () => {
  it("lays the stereo mix on tracks 1 and 2, then stems, then silence", () => {
    const plan = planBroadcastChannels(8, "stems", 3);
    expect(plan).toEqual([
      { kind: "mix", channel: 0 }, { kind: "mix", channel: 1 },
      { kind: "stem", index: 0 }, { kind: "stem", index: 1 }, { kind: "stem", index: 2 },
      { kind: "silence" }, { kind: "silence" }, { kind: "silence" },
    ]);
    expect(planBroadcastChannels(4, undefined, 3).slice(2)).toEqual([{ kind: "silence" }, { kind: "silence" }]);
    expect(planBroadcastChannels(2, "stems", 3)).toHaveLength(2);
  });
  it("builds N channels of equal length: mix L/R, stems folded to mono, silence", () => {
    const left = Float32Array.from([1, 1, 1, 1]);
    const right = Float32Array.from([0.5, 0.5, 0.5, 0.5]);
    const stem = [Float32Array.from([1, 1, 1, 1]), Float32Array.from([0, 0, 0, 0])];
    const out = layoutBroadcastChannels(planBroadcastChannels(5, "stems", 1), [left, right], [stem], 4);
    expect(out).toHaveLength(5);
    expect([...out[0]]).toEqual([1, 1, 1, 1]);
    expect([...out[1]]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect([...out[2]]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect([...out[3]]).toEqual([0, 0, 0, 0]);
    for (const channel of out) expect(channel.length).toBe(4);
  });
  it("a mono mix feeds both mix tracks and a short chunk is padded", () => {
    const out = layoutBroadcastChannels(planBroadcastChannels(2, undefined, 0), [Float32Array.from([0.25, 0.25])], [], 4);
    expect([...out[0]]).toEqual([0.25, 0.25, 0, 0]);
    expect([...out[1]]).toEqual([0.25, 0.25, 0, 0]);
  });
  it("track counts are clamped to 2..16 and absent without the option", () => {
    expect(broadcastAudioTrackCount(undefined)).toBe(0);
    expect(broadcastAudioTrackCount({})).toBe(0);
    expect(broadcastAudioTrackCount({ audioTracks: 8 })).toBe(8);
    expect(broadcastAudioTrackCount({ audioTracks: 99 })).toBe(16);
    expect(broadcastAudioTrackCount({ audioTracks: 1 })).toBe(2);
    expect([...BROADCAST_AUDIO_TRACK_OPTIONS]).toEqual([2, 4, 8, 16]);
  });
});
