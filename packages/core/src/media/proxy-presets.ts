import type { DesktopProxyCodec, DesktopProxyProfile } from "../types/project";

/**
 * Named proxy presets (Premiere's Create Proxies presets). A preset is a codec + frame-size pair that
 * maps onto the per-project `DesktopProxyProfile`, so the choice is saved with the project and the
 * ingest / Create Proxies paths build from one profile. Pure: the Electron main process turns a
 * profile into ffmpeg arguments (apps/desktop/src/main/ingest/proxy-args.ts).
 */
export type ProxyPresetId = "prores-proxy" | "h264-half" | "h264-quarter" | "dnxhr-lb";

export interface ProxyPreset {
  readonly id: ProxyPresetId;
  readonly label: string;
  readonly description: string;
  readonly profile: DesktopProxyProfile;
}

export const PROXY_PRESETS: readonly ProxyPreset[] = [
  { id: "prores-proxy", label: "ProRes Proxy", description: "ProRes 422 Proxy .mov at half size. Light to decode, opens in other editors.", profile: { codec: "prores-proxy", size: "half" } },
  { id: "h264-half", label: "H.264 1/2 resolution", description: "H.264 .mp4 at half size. Small and plays everywhere.", profile: { codec: "h264", size: "half" } },
  { id: "h264-quarter", label: "H.264 1/4 resolution", description: "H.264 .mp4 at quarter size. Smallest files, fastest scrubbing on weak machines.", profile: { codec: "h264", size: "quarter" } },
  { id: "dnxhr-lb", label: "DNxHR LB", description: "DNxHR LB .mov at half size. Intra-frame, for Avid-style workflows.", profile: { codec: "dnxhr-lb", size: "half" } },
];

export const DEFAULT_PROXY_PRESET_ID: ProxyPresetId = "h264-half";

export function isProxyPresetId(value: unknown): value is ProxyPresetId {
  return PROXY_PRESETS.some((preset) => preset.id === value);
}

export function proxyPresetById(id: ProxyPresetId): ProxyPreset {
  return PROXY_PRESETS.find((preset) => preset.id === id) ?? PROXY_PRESETS[1];
}

/** The preset a stored profile equals, or null when it is a custom codec/size combination. */
export function proxyPresetForProfile(profile: DesktopProxyProfile): ProxyPresetId | null {
  return PROXY_PRESETS.find((preset) => preset.profile.codec === profile.codec && preset.profile.size === profile.size)?.id ?? null;
}

/** Intermediate codecs (ProRes, DNxHR) are not decodable by the preview player, so they get an H.264 preview twin. */
export const isIntermediateProxyCodec = (codec: DesktopProxyCodec): boolean => codec !== "h264";
