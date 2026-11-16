import { beforeEach, describe, expect, it } from "vitest";
import { effectiveRateControl, twoPassAvailability } from "@openreel/core";
import { ExportPresetsManager, type PlatformExportPreset } from "./export-presets";
import { extendedSettingsPatch } from "./agent/export-options";

const settings = (over: Record<string, unknown>) =>
  ({
    format: "mp4", codec: "h264", width: 1920, height: 1080, frameRate: 30, bitrate: 8000,
    bitrateMode: "vbr2", maxBitrate: 12000, rateControl: "vbr2", quality: 80, keyframeInterval: 60,
    ...over,
  }) as unknown as PlatformExportPreset["settings"];

const base = { description: "", platform: "Custom", category: "custom" } as const;

describe("two-pass presets", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips bitrateMode vbr2 with target and max through save, export and import", () => {
    const a = new ExportPresetsManager();
    a.addCustomPreset({ ...base, name: "Two pass", settings: settings({}) });
    const json = a.exportCustomPresets();
    localStorage.clear();
    const imported = new ExportPresetsManager().importCustomPresets(json);
    expect(imported.skipped).toBe(0);
    expect(imported.imported[0].settings).toMatchObject({ bitrateMode: "vbr2", rateControl: "vbr2", bitrate: 8000, maxBitrate: 12000 });
    expect(new ExportPresetsManager().getCustomPresets()[0].settings).toMatchObject({ bitrateMode: "vbr2", maxBitrate: 12000 });
  });

  it("accepts vbr1, and the legacy cbr / vbr, and rejects an unknown mode, rate control or peak", () => {
    const m = new ExportPresetsManager();
    const run = (over: Record<string, unknown>) => m.importCustomPresets(JSON.stringify({ presets: [{ name: "P", settings: settings(over) }] }));
    expect(run({ bitrateMode: "vbr1", rateControl: "vbr" }).imported).toHaveLength(1);
    expect(run({ bitrateMode: "cbr", rateControl: undefined, maxBitrate: undefined }).imported).toHaveLength(1);
    expect(run({ bitrateMode: "abr" }).skipped).toBe(1);
    expect(run({ rateControl: "2pass" }).skipped).toBe(1);
    expect(run({ maxBitrate: -1 }).skipped).toBe(1);
  });
});

describe("rate control resolution", () => {
  it("an explicit rateControl wins, otherwise bitrateMode decides, otherwise constant quality", () => {
    expect(effectiveRateControl({ rateControl: "vbr", bitrateMode: "vbr2" })).toBe("vbr");
    expect(effectiveRateControl({ bitrateMode: "vbr2" })).toBe("vbr2");
    expect(effectiveRateControl({ bitrateMode: "vbr1" })).toBe("vbr");
    expect(effectiveRateControl({ bitrateMode: "vbr" })).toBe("quality");
    expect(effectiveRateControl({ bitrateMode: "cbr" })).toBe("quality");
  });

  it("two-pass is offered on the desktop for H.264 / H.265 only, and disabled with a reason elsewhere", () => {
    expect(twoPassAvailability(true, { codec: "h264" })).toEqual({ available: true });
    expect(twoPassAvailability(true, { codec: "h265" })).toEqual({ available: true });
    const web = twoPassAvailability(false, { codec: "h264" });
    expect(web.available).toBe(false);
    expect(web.available === false && web.reason).toMatch(/desktop/);
    expect(twoPassAvailability(true, { codec: "vp9" }).available).toBe(false);
    expect(twoPassAvailability(true, { codec: "h265", hdr: "pq" }).available).toBe(false);
  });

  it("the agent's rateControl vbr2 reaches the export settings with its max bitrate", () => {
    const project = { width: 1920, height: 1080, frameRate: 30 } as Parameters<typeof extendedSettingsPatch>[1];
    expect(extendedSettingsPatch({ rateControl: "vbr2", maxBitrateKbps: 12000 }, project)).toMatchObject({ rateControl: "vbr2", maxBitrate: 12000 });
  });

  it("a Rec.2020 project is colour-managed even for SDR: two-pass is unavailable and a stored vbr2 runs as one-pass VBR", () => {
    const off = twoPassAvailability(true, { codec: "h264" }, "rec2020");
    expect(off.available).toBe(false);
    expect(off.available === false && off.reason).toMatch(/Rec\.2020/);
    expect(twoPassAvailability(true, { codec: "h264" }, "rec709")).toEqual({ available: true });
    const project = { width: 1920, height: 1080, frameRate: 30, workingColorSpace: "rec2020" } as Parameters<typeof extendedSettingsPatch>[1];
    const patch = extendedSettingsPatch({}, project, { codec: "h264", rateControl: "vbr2", bitrateMode: "vbr2" });
    expect(patch).toMatchObject({ rateControl: "vbr", bitrateMode: "vbr1" });
    const sdr = { ...project, workingColorSpace: "rec709" } as typeof project;
    expect(extendedSettingsPatch({}, sdr, { codec: "h264", rateControl: "vbr2", bitrateMode: "vbr2" })).not.toHaveProperty("rateControl");
  });
});
