/**
 * Which camera formats OpenReel can import, and why the others cannot.
 *
 * DNG is an open, documented specification (and CinemaDNG is a sequence of DNG
 * files), so OpenReel decodes it itself on every platform. The proprietary
 * still formats are undocumented and change per camera body; decoding them
 * needs a maintained library (LibRaw) whose WebAssembly build is not shipped
 * here, so they are handled by the operating system on desktop macOS and
 * otherwise rejected with an instruction to convert to DNG. The cinema formats
 * (BRAW, R3D, ARRIRAW) need the vendors' proprietary SDKs.
 */

export type RawSupport =
  /** Decoded by OpenReel on web and desktop; the RAW Source Settings panel applies. */
  | "native"
  /** Desktop macOS only: developed by Apple's ImageIO (via `sips`); the panel cannot change the development. */
  | "macos-imageio"
  /** Not importable; the message says what to do instead. */
  | "unsupported";

export interface RawFormatInfo {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly support: RawSupport;
  readonly reason: string;
}

const PROPRIETARY_REASON =
  "Undocumented, per-camera-model format. Decoding needs LibRaw (or the vendor SDK), which is not bundled.";

export const RAW_FORMATS: readonly RawFormatInfo[] = [
  { id: "dng", label: "Adobe DNG / CinemaDNG", extensions: ["dng"], support: "native", reason: "Open specification; decoded by OpenReel (CFA and LinearRaw, uncompressed and lossless JPEG)." },
  { id: "cr2", label: "Canon CR2", extensions: ["cr2"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "cr3", label: "Canon CR3", extensions: ["cr3"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "nef", label: "Nikon NEF / NRW", extensions: ["nef", "nrw"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "arw", label: "Sony ARW", extensions: ["arw", "srf", "sr2"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "raf", label: "Fujifilm RAF", extensions: ["raf"], support: "macos-imageio", reason: `${PROPRIETARY_REASON} X-Trans sensors also use a 6x6 colour filter array.` },
  { id: "orf", label: "Olympus / OM System ORF", extensions: ["orf"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "rw2", label: "Panasonic RW2", extensions: ["rw2", "raw"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "pef", label: "Pentax PEF", extensions: ["pef"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "srw", label: "Samsung SRW", extensions: ["srw"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "3fr", label: "Hasselblad 3FR / FFF", extensions: ["3fr", "fff"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "iiq", label: "Phase One IIQ", extensions: ["iiq"], support: "macos-imageio", reason: PROPRIETARY_REASON },
  { id: "braw", label: "Blackmagic RAW (BRAW)", extensions: ["braw"], support: "unsupported", reason: "Requires Blackmagic's proprietary BRAW SDK. Export CinemaDNG or ProRes from DaVinci Resolve." },
  { id: "r3d", label: "RED R3D", extensions: ["r3d"], support: "unsupported", reason: "Requires RED's proprietary REDline / R3D SDK. Export DNG sequences or ProRes from REDCINE-X." },
  { id: "arriraw", label: "ARRIRAW", extensions: ["ari", "arx"], support: "unsupported", reason: "Requires ARRI's proprietary ARRIRAW SDK. Export ProRes or DNG from ARRI Reference Tool." },
];

const BY_EXTENSION = new Map<string, RawFormatInfo>();
for (const format of RAW_FORMATS) for (const ext of format.extensions) BY_EXTENSION.set(ext, format);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The camera format a file name belongs to, or null for ordinary media. */
export function rawFormatForFile(name: string): RawFormatInfo | null {
  return BY_EXTENSION.get(fileExtension(name)) ?? null;
}

/** Every extension that is a camera RAW format (for file pickers and drop filters). */
export const RAW_FILE_EXTENSIONS: readonly string[] = [...BY_EXTENSION.keys()];

/** `accept` fragment for a file input: ".dng,.cr3,..." */
export const RAW_FILE_ACCEPT: string = RAW_FILE_EXTENSIONS.map((e) => `.${e}`).join(",");

export function isRawFileName(name: string): boolean {
  return BY_EXTENSION.has(fileExtension(name));
}

/** Why a file cannot be imported on this platform, or null when it can. */
export function rawImportBlocker(format: RawFormatInfo, canUseMacImageIO: boolean): string | null {
  if (format.support === "native") return null;
  if (format.support === "macos-imageio" && canUseMacImageIO) return null;
  if (format.support === "macos-imageio") {
    return `${format.label} files are not decoded by OpenReel: ${format.reason} Convert to DNG (Adobe DNG Converter is free), or use the OpenReel desktop app on macOS.`;
  }
  return `${format.label} is not supported: ${format.reason}`;
}

// ---- CinemaDNG sequences ---------------------------------------------------------

export interface DngSequence<T extends { name: string }> {
  readonly prefix: string;
  readonly frames: readonly T[];
}

const SEQUENCE_NAME = /^(.*?)(\d{3,})\.dng$/i;

/**
 * Splits dropped `.dng` files into CinemaDNG sequences (a shared prefix and a
 * running frame number, at least two files) and single stills. Frame order is
 * numeric, not lexical. Files that are not DNG pass through in `others`.
 */
export function groupCinemaDng<T extends { name: string }>(files: readonly T[]): {
  readonly sequences: DngSequence<T>[];
  readonly stills: T[];
  readonly others: T[];
} {
  const groups = new Map<string, Array<{ file: T; n: number }>>();
  const stills: T[] = [];
  const others: T[] = [];
  for (const file of files) {
    if (fileExtension(file.name) !== "dng") {
      others.push(file);
      continue;
    }
    const m = SEQUENCE_NAME.exec(file.name);
    if (!m) {
      stills.push(file);
      continue;
    }
    const list = groups.get(m[1]) ?? [];
    list.push({ file, n: Number(m[2]) });
    groups.set(m[1], list);
  }
  const sequences: DngSequence<T>[] = [];
  for (const [prefix, list] of groups) {
    if (list.length < 2) {
      stills.push(list[0].file);
      continue;
    }
    list.sort((a, b) => a.n - b.n);
    sequences.push({ prefix, frames: list.map((e) => e.file) });
  }
  return { sequences, stills, others };
}
