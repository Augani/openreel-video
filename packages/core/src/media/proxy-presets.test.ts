import { describe, expect, it } from "vitest";
import { DEFAULT_PROXY_PRESET_ID, PROXY_PRESETS, isIntermediateProxyCodec, isProxyPresetId, proxyPresetById, proxyPresetForProfile } from "./proxy-presets";
import { desktopProxyDimensions, desktopProxyExtension, isDesktopProxyProfile } from "./desktop-ingest";

describe("proxy presets", () => {
  it("offers ProRes Proxy, H.264 half and quarter, and DNxHR LB, all valid saved profiles", () => {
    expect(PROXY_PRESETS.map((p) => p.id)).toEqual(["prores-proxy", "h264-half", "h264-quarter", "dnxhr-lb"]);
    for (const preset of PROXY_PRESETS) expect(isDesktopProxyProfile(preset.profile)).toBe(true);
  });
  it("round-trips a profile to its preset and reports custom combinations as null", () => {
    for (const preset of PROXY_PRESETS) expect(proxyPresetForProfile(preset.profile)).toBe(preset.id);
    expect(proxyPresetForProfile({ codec: "h264", size: "1080p" })).toBeNull();
    expect(isProxyPresetId("dnxhr-lb")).toBe(true);
    expect(isProxyPresetId("nope")).toBe(false);
    expect(proxyPresetById(DEFAULT_PROXY_PRESET_ID).profile.codec).toBe("h264");
  });
  it("sizes and containers follow the preset", () => {
    expect(desktopProxyDimensions(3840, 2160, proxyPresetById("h264-quarter").profile.size)).toEqual({ width: 960, height: 540 });
    expect(desktopProxyDimensions(3840, 2160, proxyPresetById("dnxhr-lb").profile.size)).toEqual({ width: 1920, height: 1080 });
    expect(desktopProxyExtension("dnxhr-lb")).toBe("mov");
    expect(desktopProxyExtension("prores-proxy")).toBe("mov");
    expect(desktopProxyExtension("h264")).toBe("mp4");
  });
  it("gives intermediate codecs an H.264 preview twin", () => {
    expect(isIntermediateProxyCodec("dnxhr-lb")).toBe(true);
    expect(isIntermediateProxyCodec("prores-proxy")).toBe(true);
    expect(isIntermediateProxyCodec("h264")).toBe(false);
  });
});
