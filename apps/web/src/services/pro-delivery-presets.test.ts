import { describe, expect, it } from "vitest";
import { exportSettingsRequireNativeEncoder, exportWritesAlpha, type VideoExportSettings } from "@openreel/core";
import { exportPresetsManager } from "./export-presets";
import { extForFormat, mimeForExt } from "./export-runner";
import { describePreset } from "../stores/export-queue-store";

const delivery = () => exportPresetsManager.getPresetsByPlatform("Delivery");

describe("delivery master presets", () => {
  it("offers ProRes 422 HQ / 4444+alpha in MOV and DNxHR HQ / HQX in MXF and MOV", () => {
    const byId = Object.fromEntries(delivery().map((p) => [p.id, p.settings as VideoExportSettings]));
    expect(byId["delivery-prores-422hq"]).toMatchObject({ codec: "prores", format: "mov", proresProfile: "hq" });
    expect(byId["delivery-prores-4444"]).toMatchObject({ codec: "prores", format: "mov", proresProfile: "4444", alpha: true });
    expect(byId["delivery-dnxhr-hq-mxf"]).toMatchObject({ codec: "dnxhr", format: "mxf", dnxhrProfile: "hq" });
    expect(byId["delivery-dnxhr-hqx-mxf"]).toMatchObject({ codec: "dnxhr", format: "mxf", dnxhrProfile: "hqx" });
    expect(byId["delivery-dnxhr-hq-mov"]).toMatchObject({ codec: "dnxhr", format: "mov", dnxhrProfile: "hq" });
    expect(byId["delivery-dnxhr-hqx-mov"]).toMatchObject({ codec: "dnxhr", format: "mov", dnxhrProfile: "hqx" });
  });

  it("every one needs the desktop encoder (the web build shows its H.264 fallback notice) and carries 24-bit PCM audio", () => {
    for (const preset of delivery()) {
      const settings = preset.settings as VideoExportSettings;
      expect(exportSettingsRequireNativeEncoder(settings), preset.id).toBe(true);
      expect(settings.audioSettings).toMatchObject({ format: "wav", bitDepth: 24, sampleRate: 48000 });
    }
  });

  it("only ProRes 4444 with the alpha option writes alpha", () => {
    expect(exportWritesAlpha({ codec: "prores", proresProfile: "4444", alpha: true })).toBe(true);
    expect(exportWritesAlpha({ codec: "prores", proresProfile: "4444xq", alpha: true })).toBe(true);
    expect(exportWritesAlpha({ codec: "prores", proresProfile: "4444" })).toBe(false);
    expect(exportWritesAlpha({ codec: "prores", proresProfile: "hq", alpha: true })).toBe(false);
    expect(exportWritesAlpha({ codec: "h264", alpha: true })).toBe(false);
  });
});

describe("pro container naming", () => {
  it("writes .mxf for an MXF master, .mov for ProRes and DNxHR in QuickTime", () => {
    expect(extForFormat("mxf", "dnxhr")).toBe("mxf");
    expect(extForFormat("mov", "dnxhr")).toBe("mov");
    expect(extForFormat("mov", "prores")).toBe("mov");
    expect(mimeForExt("mxf")).toBe("application/mxf");
  });

  it("labels queue rows with the codec", () => {
    expect(describePreset({ width: 1920, height: 1080, frameRate: 24, codec: "dnxhr", format: "mxf" })).toBe("1080p 24fps DNxHR MXF");
  });
});
