/**
 * Professional camera / broadcast media (MXF, ProRes, DNxHD/DNxHR) and what each build does with it.
 *
 * - Desktop: the ffmpeg sidecar decodes it natively (see `native-frame-source.ts`), no conversion.
 * - Web: browsers cannot demux MXF or decode ProRes/DNx, so the file is converted in the browser to a
 *   WebM/MP4 proxy for editing. The notice below says so, instead of an "unsupported format" failure.
 *
 * Camera RAW (REDCODE R3D, ARRIRAW, BRAW, Sony X-OCN, CinemaDNG) is out of scope on both builds: those
 * need the vendors' SDKs. See docs/pro-media.md.
 */

export type ProMediaKind = "mxf" | "prores-dnx";

export interface ProMediaInfo {
  kind: ProMediaKind;
  /** Short label for messages ("MXF", "ProRes / DNxHD"). */
  label: string;
}

/** Camera RAW wrappers: never decoded, the message says what to do instead. */
const CAMERA_RAW = /\.(r3d|ari|arx|braw|mlv|crm|dng|x-ocn)$/i;

export function isCameraRawName(name: string | undefined | null): boolean {
  return Boolean(name) && CAMERA_RAW.test(name!);
}

export function classifyProMedia(name: string | undefined | null, mimeType = ""): ProMediaInfo | null {
  if (name && /\.mxf$/i.test(name)) return { kind: "mxf", label: "MXF" };
  if (/mxf/i.test(mimeType)) return { kind: "mxf", label: "MXF" };
  return null;
}

/** Prefix of the import warning that tells the UI a pro file was converted to an editing proxy in the browser. */
export const PRO_MEDIA_PROXY_PREFIX = "Pro media proxy:";

export function proMediaProxyNotice(label: string): string {
  return `${PRO_MEDIA_PROXY_PREFIX} ${label} cannot be read by a browser, so OpenReel converted it to an H.264/VP9 proxy for editing in this tab. Exports use the proxy. The OpenReel desktop app edits ${label} directly and exports ProRes and DNxHR masters.`;
}

/** Why a pro file could not be brought in on the web build, and what to do. */
export function proMediaWebMessage(file: { name?: string; type?: string }): string | null {
  if (isCameraRawName(file.name)) {
    return "Camera RAW (R3D, ARRIRAW, BRAW, X-OCN) is not supported. Debayer it to ProRes or DNxHR in the camera maker's tool, then import that file.";
  }
  const info = classifyProMedia(file.name, file.type);
  if (!info) return null;
  return `${info.label} cannot be opened in a browser and the in-browser converter could not read this file. Convert it to H.264 MP4 or ProRes MOV first, or open it in the OpenReel desktop app, which edits ${info.label} directly.`;
}
