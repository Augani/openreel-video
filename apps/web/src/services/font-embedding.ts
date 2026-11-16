import type { Project } from "@openreel/core";
import {
  collectFontUsages,
  googleFontStylesheetUrl,
  isBundledFontFamily,
} from "./project-fonts";

/**
 * Font embedding for project packages (Collect Files style). User fonts are
 * copied into the package when their OS/2 fsType allows it; catalog (web)
 * fonts are recorded by family + stylesheet URL; restricted fonts are left out
 * and reported.
 */

export type FontPermission = "installable" | "editable" | "preview-print" | "restricted" | "unknown";

export interface FontPermissionInfo {
  readonly fsType: number | null;
  readonly permission: FontPermission;
}

export type FontEmbedStatus =
  | "embedded"
  | "embedded-readonly"
  | "restricted"
  | "unknown-license"
  | "web"
  | "bundled"
  | "system";

export interface FontEmbedEntry {
  readonly family: string;
  readonly usages: readonly string[];
  readonly status: FontEmbedStatus;
  readonly fsType?: number | null;
  readonly url?: string;
  readonly note: string;
}

export type FontFormat = "ttf" | "otf" | "woff" | "woff2";

/** Bytes of a user/local font by family, or null when the family is not a user font. */
export type FontFileSource = (family: string) => Promise<ArrayBuffer | null>;

const SFNT_TAGS = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]);
const WOFF_SIGNATURE = 0x774f4646;
const WOFF2_SIGNATURE = 0x774f4632;
const TTC_SIGNATURE = 0x74746366;
const OS2_TAG = 0x4f532f32;

export function detectFontFormat(data: ArrayBuffer): FontFormat | null {
  if (data.byteLength < 4) return null;
  const tag = new DataView(data).getUint32(0);
  if (tag === 0x4f54544f) return "otf";
  if (SFNT_TAGS.has(tag) || tag === TTC_SIGNATURE) return "ttf";
  if (tag === WOFF_SIGNATURE) return "woff";
  if (tag === WOFF2_SIGNATURE) return "woff2";
  return null;
}

export function classifyFsType(fsType: number): FontPermission {
  // Bit 1 (restricted license) wins; the usage-permission bits are mutually exclusive.
  if (fsType & 0x0002) return "restricted";
  // Bit 9: only bitmap embedding is allowed, so embedding the outline file is not.
  // (Bit 8, no-subsetting, is fine: the whole font file is embedded, never a subset.)
  if (fsType & 0x0200) return "restricted";
  if (fsType & 0x0004) return "preview-print";
  if (fsType & 0x0008) return "editable";
  return "installable";
}

function readFsTypeFromSfnt(view: DataView, base: number): number | null {
  if (view.byteLength < base + 12) return null;
  const tables = view.getUint16(base + 4);
  for (let i = 0; i < tables; i++) {
    const record = base + 12 + i * 16;
    if (record + 16 > view.byteLength) return null;
    if (view.getUint32(record) !== OS2_TAG) continue;
    const offset = view.getUint32(record + 8);
    if (offset + 10 > view.byteLength) return null;
    return view.getUint16(offset + 8);
  }
  // A font without an OS/2 table carries no embedding bits: treat as installable.
  return 0;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new DecompressionStream("deflate");
    const writer = stream.writable.getWriter();
    void writer.write(bytes as BufferSource).then(() => writer.close()).catch(() => undefined);
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  } catch {
    return null;
  }
}

async function readFsTypeFromWoff(data: ArrayBuffer): Promise<number | null> {
  const view = new DataView(data);
  if (view.byteLength < 44) return null;
  const tables = view.getUint16(12);
  for (let i = 0; i < tables; i++) {
    const record = 44 + i * 20;
    if (record + 20 > view.byteLength) return null;
    if (view.getUint32(record) !== OS2_TAG) continue;
    const offset = view.getUint32(record + 4);
    const compressed = view.getUint32(record + 8);
    const original = view.getUint32(record + 12);
    if (offset + compressed > view.byteLength || original < 10) return null;
    const raw = new Uint8Array(data, offset, compressed);
    const table = compressed === original ? raw : await inflate(raw);
    if (!table || table.byteLength < 10) return null;
    return new DataView(table.buffer, table.byteOffset, table.byteLength).getUint16(8);
  }
  return 0;
}

/**
 * Read OS/2 fsType from a TTF/OTF/TTC/WOFF file. WOFF2 (Brotli-compressed
 * tables) cannot be read here and yields `unknown`, so WOFF2 fonts are never
 * embedded; convert them to TTF/OTF/WOFF to embed.
 */
export async function readFontEmbeddingPermission(data: ArrayBuffer): Promise<FontPermissionInfo> {
  const format = detectFontFormat(data);
  let fsType: number | null = null;
  if (format === "ttf" || format === "otf") {
    const view = new DataView(data);
    fsType = readFsTypeFromSfnt(view, view.getUint32(0) === TTC_SIGNATURE && data.byteLength >= 16 ? view.getUint32(12) : 0);
  } else if (format === "woff") fsType = await readFsTypeFromWoff(data);
  if (fsType === null) return { fsType: null, permission: "unknown" };
  return { fsType, permission: classifyFsType(fsType) };
}

export interface FontPlanOptions {
  /** True when the family is a registered user/local font (even if its bytes are unavailable). */
  readonly isUserFont?: (family: string) => boolean;
}

export interface FontPlan {
  readonly entries: FontEmbedEntry[];
  /** Files to copy, keyed by family; only `embedded` / `embedded-readonly` entries. */
  readonly payloads: Map<string, ArrayBuffer>;
}

type FontScanProject = Pick<Project, "textClips" | "timeline" | "motionCompositions">;

/**
 * Decide, for every font family the project uses, how it travels. `readUserFont`
 * returns the bytes when the family is an uploaded/local font.
 */
export async function planProjectFonts(
  project: FontScanProject,
  readUserFont: FontFileSource,
  options: FontPlanOptions = {},
): Promise<FontPlan> {
  const entries: FontEmbedEntry[] = [];
  const payloads = new Map<string, ArrayBuffer>();
  for (const [family, usages] of collectFontUsages(project)) {
    const data = await readUserFont(family);
    if (data) {
      const info = await readFontEmbeddingPermission(data);
      const base = { family, usages, fsType: info.fsType };
      if (info.permission === "restricted") {
        entries.push({ ...base, status: "restricted", note: "License (fsType restricted) forbids embedding; install the font on the other machine." });
      } else if (info.permission === "unknown") {
        entries.push({ ...base, status: "unknown-license", note: "Font license could not be read (WOFF2 files cannot be inspected), so the font was not embedded. Use a TTF/OTF/WOFF copy to embed it." });
      } else if (info.permission === "preview-print") {
        payloads.set(family, data);
        entries.push({ ...base, status: "embedded-readonly", note: "Embedded for preview and export only; the license does not allow editing with this font." });
      } else {
        payloads.set(family, data);
        entries.push({ ...base, status: "embedded", note: "Embedded in the package." });
      }
      continue;
    }
    if (options.isUserFont?.(family)) {
      entries.push({ family, usages, status: "unknown-license", note: "This is an uploaded font but its file data is unavailable (it was not saved), so it was not embedded." });
      continue;
    }
    const url = googleFontStylesheetUrl(family);
    if (isBundledFontFamily(family)) entries.push({ family, usages, status: "bundled", note: "Ships with OpenReel." });
    else if (url) entries.push({ family, usages, status: "web", url, note: "Web font recorded by family and URL; loaded on demand." });
    else entries.push({ family, usages, status: "system", note: "System font; not embedded. Install it on the other machine." });
  }
  entries.sort((a, b) => a.family.localeCompare(b.family));
  return { entries, payloads };
}

export interface PackagedFont {
  readonly family: string;
  readonly data: Blob;
  readonly readOnly: boolean;
}

export type FontRegistration = "absent" | "same" | "different";

export interface FontRegistrar {
  /**
   * Whether the family is already registered and, if so, whether it is the
   * same font file as the packaged one.
   */
  compare(family: string, data: ArrayBuffer): Promise<FontRegistration> | FontRegistration;
  /** Read-only fonts must be registered for rendering only, never made editable or persisted. */
  register(family: string, data: ArrayBuffer, options: { readOnly: boolean; replacesExisting: boolean }): Promise<void>;
}

export interface RegisterPackagedFontsResult {
  registered: string[];
  failed: string[];
  /** Registered read-only (license: preview & print). */
  readOnly: string[];
  /** A different font with the same family name was already present; the packaged one now renders. */
  conflicts: string[];
}

/**
 * Register embedded fonts so preview and export can use them before first
 * render. A family already present with identical bytes is left alone; one
 * present with different bytes is overridden for rendering and reported.
 */
export async function registerPackagedFonts(
  fonts: readonly PackagedFont[],
  registrar: FontRegistrar,
): Promise<RegisterPackagedFontsResult> {
  const result: RegisterPackagedFontsResult = { registered: [], failed: [], readOnly: [], conflicts: [] };
  for (const font of fonts) {
    try {
      const data = await font.data.arrayBuffer();
      const existing = await registrar.compare(font.family, data);
      if (existing === "same") continue;
      await registrar.register(font.family, data, { readOnly: font.readOnly, replacesExisting: existing === "different" });
      result.registered.push(font.family);
      if (font.readOnly) result.readOnly.push(font.family);
      if (existing === "different") result.conflicts.push(font.family);
    } catch {
      result.failed.push(font.family);
    }
  }
  return result;
}
