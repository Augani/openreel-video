/**
 * Why the preview cannot show a clip. Browsers (and so the web editor) have no decoder for ProRes,
 * DNxHD and similar, and a blank preview with a generic "unavailable" label reads as a bug. The
 * desktop app decodes these directly, so this only matters on the web.
 */

const KNOWN_CODEC_LABELS: Array<[RegExp, string]> = [
  [/prores|apc[nohs]|ap4[hx]/i, "ProRes"],
  [/dnx/i, "DNxHD/DNxHR"],
  [/cineform|cfhd/i, "CineForm"],
  [/hap/i, "HAP"],
];

export function describeCodec(codec: string | null | undefined, fileName?: string): string {
  const haystack = `${codec ?? ""}`;
  for (const [pattern, label] of KNOWN_CODEC_LABELS) if (pattern.test(haystack)) return label;
  if (codec) return codec.toUpperCase();
  // mediabunny reports no codec at all for fourccs it does not know (ProRes arrives this way).
  if (fileName && /\.(mov|mxf)$/i.test(fileName)) return "this professional codec (for example ProRes or DNxHD)";
  return "this codec";
}

export function undecodableMessage(label: string, desktop: boolean): string {
  return desktop
    ? `This video's codec (${label}) could not be decoded. Check that the original file is still on disk, or create a proxy.`
    : `This browser cannot decode ${label} video. Create a preview proxy for this clip (Media panel, Proxies) or use the OpenReel desktop app, which plays it directly.`;
}

/** The explanation for a Blob whose video track exists but cannot be decoded here; null when decoding is fine. */
export async function explainUndecodableVideo(blob: Blob, desktop: boolean): Promise<string | null> {
  try {
    const { Input, ALL_FORMATS, BlobSource } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) return null;
      if (await track.canDecode()) return null;
      const name = blob instanceof File ? blob.name : undefined;
      return undecodableMessage(describeCodec(track.codec, name), desktop);
    } finally {
      input[Symbol.dispose]?.();
    }
  } catch {
    return null;
  }
}
