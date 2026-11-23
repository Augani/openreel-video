import { inflateRaw } from "../../interchange/aaf/inflate";

/**
 * Minimal, dependency-free ZIP reader for `.mogrt` archives (a .mogrt is a plain zip). It reads the central
 * directory, supports "stored" and "deflate" entries (all a .mogrt uses) and enforces limits so a hostile archive
 * cannot exhaust memory: entry count, per-entry and total uncompressed size, and a compression-ratio cap.
 * It never touches the file system; entry names are only ever used as map keys.
 */

export const ZIP_LIMITS = {
  maxEntries: 2000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 192 * 1024 * 1024,
  /** A real template compresses text ~20:1; anything past this is a bomb. */
  maxRatio: 1000,
} as const;

export interface ZipEntry {
  readonly name: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: number;
  readonly isDirectory: boolean;
  /** Inflate (or copy) the entry. Throws on a corrupt entry or when a limit is hit. */
  read(): Uint8Array;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 22 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  if (!looksLikeZip(bytes)) throw new ZipError("This file is not a zip archive, so it is not a .mogrt.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes (a trailing comment can follow it).
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (view.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("The zip directory could not be found (truncated or corrupt file).");
  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff || dirSize === 0xffffffff) {
    throw new ZipError("Zip64 archives are not supported.");
  }
  if (count > ZIP_LIMITS.maxEntries) throw new ZipError(`The archive holds more than ${ZIP_LIMITS.maxEntries} files.`);
  if (dirOffset + dirSize > bytes.length) throw new ZipError("The zip directory is outside the file (corrupt).");

  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let pos = dirOffset;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CENTRAL) throw new ZipError("The zip directory is corrupt.");
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)).replace(/\\/g, "/");
    pos += 46 + nameLength + extraLength + commentLength;
    declaredTotal += size;
    if (size > ZIP_LIMITS.maxEntryBytes) throw new ZipError(`"${name}" is larger than ${ZIP_LIMITS.maxEntryBytes / 1048576} MB uncompressed.`);
    if (declaredTotal > ZIP_LIMITS.maxTotalBytes) throw new ZipError("The archive is larger than the 192 MB uncompressed limit.");
    if (compressedSize > 0 && size / compressedSize > ZIP_LIMITS.maxRatio && size > 1_000_000) {
      throw new ZipError(`"${name}" has an implausible compression ratio (zip bomb?).`);
    }
    const isDirectory = name.endsWith("/");
    entries.push({
      name,
      size,
      compressedSize,
      method,
      isDirectory,
      read() {
        if (flags & 1) throw new ZipError(`"${name}" is encrypted.`);
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL) throw new ZipError(`"${name}" has a corrupt header.`);
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        if (start + compressedSize > bytes.length) throw new ZipError(`"${name}" is truncated.`);
        const raw = bytes.subarray(start, start + compressedSize);
        if (method === 0) return raw.slice();
        if (method === 8) {
          let out: Uint8Array;
          try {
            out = inflateRaw(raw, size, Math.min(ZIP_LIMITS.maxEntryBytes, Math.max(size, 1) * 2));
          } catch {
            throw new ZipError(`"${name}" could not be decompressed.`);
          }
          return out.length > size ? out.subarray(0, size) : out;
        }
        throw new ZipError(`"${name}" uses unsupported compression method ${method}.`);
      },
    });
  }
  return entries;
}
