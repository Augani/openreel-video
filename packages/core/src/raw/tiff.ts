/**
 * Minimal TIFF / TIFF-EP / DNG container reader: header, IFD chains and
 * SubIFDs, typed tag values. It reads structure only; pixel decoding lives in
 * `dng.ts`. All offsets are bounds-checked so a truncated or hostile file
 * throws a `RawDecodeError` instead of reading garbage.
 */

export class RawDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawDecodeError";
  }
}

export const TIFF_TYPE_BYTES: Readonly<Record<number, number>> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

export interface TiffEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Absolute byte offset of the value data. */
  readonly dataOffset: number;
}

export interface TiffIfd {
  readonly entries: ReadonlyMap<number, TiffEntry>;
  readonly subIfds: readonly TiffIfd[];
}

export interface TiffFile {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly littleEndian: boolean;
  /** Top-level IFD chain (IFD0, IFD1...). */
  readonly ifds: readonly TiffIfd[];
}

const TAG_SUB_IFDS = 330;
const MAX_IFDS = 64;
const MAX_ENTRIES = 4096;

function checkRange(bytes: Uint8Array, offset: number, length: number, what: string): void {
  if (!Number.isFinite(offset) || offset < 0 || length < 0 || offset + length > bytes.byteLength)
    throw new RawDecodeError(`Truncated or corrupt file: ${what} is outside the file.`);
}

function readIfd(
  view: DataView,
  bytes: Uint8Array,
  littleEndian: boolean,
  offset: number,
  visited: Set<number>,
  depth: number,
): { ifd: TiffIfd; next: number } {
  checkRange(bytes, offset, 2, "an IFD");
  const count = view.getUint16(offset, littleEndian);
  if (count > MAX_ENTRIES) throw new RawDecodeError("Corrupt file: implausible IFD entry count.");
  checkRange(bytes, offset + 2, count * 12 + 4, "an IFD");
  const entries = new Map<number, TiffEntry>();
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    const tag = view.getUint16(at, littleEndian);
    const type = view.getUint16(at + 2, littleEndian);
    const n = view.getUint32(at + 4, littleEndian);
    if (!TIFF_TYPE_BYTES[type]) continue;
    const size = TIFF_TYPE_BYTES[type] * n;
    const dataOffset = size <= 4 ? at + 8 : view.getUint32(at + 8, littleEndian);
    if (size > 0) checkRange(bytes, dataOffset, size, `tag ${tag}`);
    entries.set(tag, { tag, type, count: n, dataOffset });
  }
  const next = view.getUint32(offset + 2 + count * 12, littleEndian);
  const subIfds: TiffIfd[] = [];
  const sub = entries.get(TAG_SUB_IFDS);
  if (sub && depth < 3) {
    for (let i = 0; i < Math.min(sub.count, 16); i++) {
      const subOffset = view.getUint32(sub.dataOffset + i * 4, littleEndian);
      if (visited.has(subOffset)) continue;
      visited.add(subOffset);
      try {
        subIfds.push(readIfd(view, bytes, littleEndian, subOffset, visited, depth + 1).ifd);
      } catch {
        // A damaged thumbnail SubIFD must not make the main image unreadable.
      }
    }
  }
  return { ifd: { entries, subIfds }, next };
}

export function isTiffLike(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!le && !be) return false;
  const magic = le ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3];
  return magic === 42;
}

export function readTiff(buffer: ArrayBuffer | Uint8Array): TiffFile {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isTiffLike(bytes)) throw new RawDecodeError("Not a TIFF/DNG file (bad header).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[0] === 0x49;
  const visited = new Set<number>();
  const ifds: TiffIfd[] = [];
  let offset = view.getUint32(4, littleEndian);
  while (offset !== 0 && ifds.length < MAX_IFDS) {
    if (visited.has(offset)) break;
    visited.add(offset);
    const { ifd, next } = readIfd(view, bytes, littleEndian, offset, visited, 0);
    ifds.push(ifd);
    offset = next;
  }
  if (ifds.length === 0) throw new RawDecodeError("The file has no image directory.");
  return { view, bytes, littleEndian, ifds };
}

/** Numeric tag values (rationals become fractions). Empty when the tag is absent. */
export function tagNumbers(file: TiffFile, ifd: TiffIfd, tag: number): number[] {
  const e = ifd.entries.get(tag);
  if (!e) return [];
  const { view, littleEndian: le } = file;
  const out: number[] = [];
  const width = TIFF_TYPE_BYTES[e.type] ?? 1;
  for (let i = 0; i < e.count; i++) {
    const o = e.dataOffset + i * width;
    switch (e.type) {
      case 1: case 7: out.push(view.getUint8(o)); break;
      case 6: out.push(view.getInt8(o)); break;
      case 3: out.push(view.getUint16(o, le)); break;
      case 8: out.push(view.getInt16(o, le)); break;
      case 4: case 13: out.push(view.getUint32(o, le)); break;
      case 9: out.push(view.getInt32(o, le)); break;
      case 5: { const d = view.getUint32(o + 4, le); out.push(d === 0 ? 0 : view.getUint32(o, le) / d); break; }
      case 10: { const d = view.getInt32(o + 4, le); out.push(d === 0 ? 0 : view.getInt32(o, le) / d); break; }
      case 11: out.push(view.getFloat32(o, le)); break;
      case 12: out.push(view.getFloat64(o, le)); break;
      default: break;
    }
  }
  return out;
}

export function tagNumber(file: TiffFile, ifd: TiffIfd, tag: number): number | undefined {
  return tagNumbers(file, ifd, tag)[0];
}

export function tagString(file: TiffFile, ifd: TiffIfd, tag: number): string | undefined {
  const e = ifd.entries.get(tag);
  if (!e || (e.type !== 2 && e.type !== 1 && e.type !== 7)) return undefined;
  let s = "";
  for (let i = 0; i < e.count; i++) {
    const c = file.bytes[e.dataOffset + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim() || undefined;
}
