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

export type BrotliDecoder = (data: Uint8Array) => Promise<Uint8Array | null>;

async function brotliViaDecompressionStream(bytes: Uint8Array): Promise<Uint8Array | null> {
  // "brotli" is not a universally supported DecompressionStream format; a
  // missing format throws a TypeError, which means "no decoder available".
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new DecompressionStream("brotli" as ConstructorParameters<typeof DecompressionStream>[0]);
    const writer = stream.writable.getWriter();
    void writer.write(bytes as BufferSource).then(() => writer.close()).catch(() => undefined);
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * The desktop shell's Chromium (Electron 33) has no Brotli DecompressionStream,
 * so it decodes in the main process with Node's zlib (`window.openreel.fonts`).
 */
async function brotliViaDesktopBridge(bytes: Uint8Array): Promise<Uint8Array | null> {
  const bridge = typeof window === "undefined" ? undefined : window.openreel?.fonts;
  if (!bridge) return null;
  try {
    const out = await bridge.brotliDecompress(bytes);
    return out ? new Uint8Array(out) : null;
  } catch {
    return null;
  }
}

/** The parts of `brotli-dec-wasm/web` the fallback decoder uses. */
export interface BrotliWasmModule {
  DecompressStream: new () => {
    decompress(input: Uint8Array, outputSize: number): { buf: Uint8Array; code: number; input_offset: number; free(): void };
    free(): void;
  };
  BrotliStreamResultCode: { ResultSuccess: number; NeedsMoreInput: number; NeedsMoreOutput: number };
}

/** Upper bound on decoded WOFF2 table data; matches the desktop bridge's cap. */
export const BROTLI_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Loads the bundled Brotli decoder (MIT/Apache-2.0, ~200 KB wasm) on first use,
 * as its own lazy chunk so it never weighs on startup.
 */
async function loadBundledBrotliWasm(): Promise<BrotliWasmModule> {
  const [mod, wasm] = await Promise.all([import("brotli-dec-wasm/web"), import("brotli-dec-wasm/web/bg.wasm?url")]);
  await mod.default({ module_or_path: wasm.default });
  return mod as unknown as BrotliWasmModule;
}

let brotliWasmLoader: () => Promise<BrotliWasmModule> = loadBundledBrotliWasm;
let brotliWasm: Promise<BrotliWasmModule> | null = null;

/** Override how the bundled wasm decoder loads (tests). Pass null to restore the default. */
export function setBrotliWasmLoader(loader: (() => Promise<BrotliWasmModule>) | null): void {
  brotliWasmLoader = loader ?? loadBundledBrotliWasm;
  brotliWasm = null;
}

/** Streams through the wasm decoder in 1 MB steps, giving up past `maxOutput` bytes or on truncated input. */
export function brotliDecodeBounded(wasm: BrotliWasmModule, bytes: Uint8Array, maxOutput = BROTLI_MAX_OUTPUT_BYTES): Uint8Array | null {
  const codes = wasm.BrotliStreamResultCode;
  const stream = new wasm.DecompressStream();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let input = bytes;
  try {
    for (;;) {
      const result = stream.decompress(input, 1 << 20);
      const { buf, code } = result;
      const consumed = result.input_offset;
      result.free();
      total += buf.byteLength;
      if (total > maxOutput) return null;
      chunks.push(buf);
      if (code === codes.ResultSuccess) break;
      if (code !== codes.NeedsMoreOutput) return null;
      input = input.subarray(consumed);
    }
  } catch {
    return null;
  } finally {
    stream.free();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function brotliViaBundledWasm(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    brotliWasm ??= brotliWasmLoader();
    return brotliDecodeBounded(await brotliWasm, bytes);
  } catch {
    brotliWasm = null;
    return null;
  }
}

/**
 * Default decoder: the platform's native Brotli when present, else the desktop
 * bridge, else the bundled wasm decoder, so every browser can read WOFF2 licences.
 */
export async function defaultBrotliDecoder(bytes: Uint8Array): Promise<Uint8Array | null> {
  return (
    (await brotliViaDecompressionStream(bytes)) ??
    (await brotliViaDesktopBridge(bytes)) ??
    (await brotliViaBundledWasm(bytes))
  );
}

let brotliDecoder: BrotliDecoder = defaultBrotliDecoder;

/**
 * Override the Brotli decoder (tests, or a host with its own). The default
 * tries DecompressionStream("brotli"), then the desktop shell's Node zlib
 * bridge, then the bundled wasm decoder. Returns the previous decoder. A decoder returns null when it cannot decode, which makes WOFF2 fonts report
 * an unknown licence instead of being embedded unchecked.
 */
export function setBrotliDecoder(decoder: BrotliDecoder | null): BrotliDecoder {
  const previous = brotliDecoder;
  brotliDecoder = decoder ?? defaultBrotliDecoder;
  return previous;
}

/** Registered table tags that a WOFF2 directory entry can name by index (spec section 5.1). */
const WOFF2_OS2_INDEX = 6;
const WOFF2_GLYF_INDEX = 10;
const WOFF2_LOCA_INDEX = 11;
const WOFF2_ARBITRARY_TAG = 63;

function readBase128(bytes: Uint8Array, cursor: { pos: number }): number | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (cursor.pos >= bytes.length) return null;
    const byte = bytes[cursor.pos++];
    if (i === 0 && byte === 0x80) return null;
    if (value > 0x01ffffff) return null;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  return null;
}

/**
 * OS/2 is never transformed in WOFF2, so its bytes are read straight from the
 * Brotli-decompressed table stream at the table's offset (the sum of the
 * preceding tables' stored lengths). Returns null when it cannot be read; an
 * empty array when the font has no OS/2 table.
 */
export async function extractWoff2Os2Table(data: ArrayBuffer): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  if (view.byteLength < 48) return null;
  const numTables = view.getUint16(12);
  if (numTables === 0) return null;
  const compressedSize = view.getUint32(20);
  const cursor = { pos: 48 };
  let streamOffset = 0;
  let os2: { offset: number; length: number } | null = null;
  for (let i = 0; i < numTables; i++) {
    if (cursor.pos >= bytes.length) return null;
    const flags = bytes[cursor.pos++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tagIsOs2 = index === WOFF2_OS2_INDEX;
    if (index === WOFF2_ARBITRARY_TAG) {
      if (cursor.pos + 4 > bytes.length) return null;
      tagIsOs2 = view.getUint32(cursor.pos) === OS2_TAG;
      cursor.pos += 4;
    }
    const origLength = readBase128(bytes, cursor);
    if (origLength === null) return null;
    const transformed = index === WOFF2_GLYF_INDEX || index === WOFF2_LOCA_INDEX ? version === 0 : version !== 0;
    let length = origLength;
    if (transformed) {
      const transformLength = readBase128(bytes, cursor);
      if (transformLength === null) return null;
      length = transformLength;
    }
    if (tagIsOs2) {
      if (transformed) return null;
      os2 = { offset: streamOffset, length };
    }
    streamOffset += length;
  }
  if (!os2) return new Uint8Array(0);
  if (os2.length < 10 || cursor.pos + compressedSize > bytes.length) return null;
  const stream = await brotliDecoder(bytes.subarray(cursor.pos, cursor.pos + compressedSize));
  if (!stream || stream.byteLength < os2.offset + os2.length) return null;
  return stream.subarray(os2.offset, os2.offset + os2.length);
}

async function readFsTypeFromWoff2(data: ArrayBuffer): Promise<number | null> {
  const table = await extractWoff2Os2Table(data);
  if (!table) return null;
  // A font without an OS/2 table carries no embedding bits: treat as installable.
  if (table.byteLength === 0) return 0;
  return new DataView(table.buffer, table.byteOffset, table.byteLength).getUint16(8);
}


/**
 * Read OS/2 fsType from a TTF/OTF/TTC/WOFF/WOFF2 file. WOFF2 needs a Brotli
 * decoder (see setBrotliDecoder); without one it yields `unknown`.
 */
export async function readFontEmbeddingPermission(data: ArrayBuffer): Promise<FontPermissionInfo> {
  const format = detectFontFormat(data);
  let fsType: number | null = null;
  if (format === "ttf" || format === "otf") {
    const view = new DataView(data);
    fsType = readFsTypeFromSfnt(view, view.getUint32(0) === TTC_SIGNATURE && data.byteLength >= 16 ? view.getUint32(12) : 0);
  } else if (format === "woff") fsType = await readFsTypeFromWoff(data);
  else if (format === "woff2") fsType = await readFsTypeFromWoff2(data);
  if (fsType === null) return { fsType: null, permission: "unknown" };
  return { fsType, permission: classifyFsType(fsType) };
}

const FONT_MIME: Record<FontFormat, string> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** MIME type recorded for an embedded font file; generic sfnt when the format is unrecognised. */
export function fontMimeType(data: ArrayBuffer): string {
  const format = detectFontFormat(data);
  return format ? FONT_MIME[format] : "font/sfnt";
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
        entries.push({ ...base, status: "unknown-license", note: "Font license could not be read (unrecognised file, or a WOFF2 file this browser cannot Brotli-decode), so the font was not embedded. Use a TTF/OTF/WOFF copy to embed it." });
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
