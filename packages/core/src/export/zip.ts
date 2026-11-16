/**
 * Minimal store-only (no compression) ZIP writer and reader. WAV stems are
 * incompressible enough that deflate would cost time for little gain, and this
 * keeps the export path free of new dependencies. Files up to 4 GiB, no ZIP64.
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const MAX_U32 = 0xffffffff;

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  /** Last-modified time; defaults to now. */
  readonly modified?: Date;
}

interface Recorded {
  readonly nameBytes: Uint8Array;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
  readonly dosTime: number;
  readonly dosDate: number;
}

const encoder = new TextEncoder();

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** A zip entry name: forward slashes, no leading slash or drive, no `..` segments. */
export function safeZipName(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..");
  return parts.join("/") || "file";
}

/**
 * Streams a zip archive to `sink`: each `add` writes the local header and data
 * straight away (so only one stem is in memory at a time) and `finish` writes
 * the central directory.
 */
export class ZipWriter {
  private readonly records: Recorded[] = [];
  private offset = 0;
  private finished = false;
  private readonly names = new Set<string>();
  constructor(private readonly sink: (chunk: Uint8Array) => void | Promise<void>) {}

  private async emit(chunk: Uint8Array): Promise<void> {
    await this.sink(chunk);
    this.offset += chunk.byteLength;
  }

  async add(entry: ZipEntry): Promise<void> {
    if (this.finished) throw new Error("Zip already finished");
    const name = safeZipName(entry.name);
    if (this.names.has(name)) throw new Error(`Duplicate zip entry: ${name}`);
    this.names.add(name);
    if (entry.data.byteLength >= MAX_U32 || this.offset + entry.data.byteLength + 1024 >= MAX_U32) {
      throw new Error("Zip archives larger than 4 GiB are not supported.");
    }
    const nameBytes = encoder.encode(name);
    const crc = crc32(entry.data);
    const stamp = dosDateTime(entry.modified ?? new Date());
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, 0, true); // stored
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.byteLength, true);
    view.setUint32(22, entry.data.byteLength, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    const offset = this.offset;
    await this.emit(header);
    await this.emit(entry.data);
    this.records.push({ nameBytes, crc, size: entry.data.byteLength, offset, dosTime: stamp.time, dosDate: stamp.date });
  }

  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const start = this.offset;
    let size = 0;
    for (const r of this.records) {
      const header = new Uint8Array(46 + r.nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, r.dosTime, true);
      view.setUint16(14, r.dosDate, true);
      view.setUint32(16, r.crc, true);
      view.setUint32(20, r.size, true);
      view.setUint32(24, r.size, true);
      view.setUint16(28, r.nameBytes.length, true);
      view.setUint32(42, r.offset, true);
      header.set(r.nameBytes, 46);
      size += header.byteLength;
      await this.emit(header);
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.records.length, true);
    view.setUint16(10, this.records.length, true);
    view.setUint32(12, size, true);
    view.setUint32(16, start, true);
    await this.emit(end);
  }

  get bytesWritten(): number {
    return this.offset;
  }
}

/** Whole archive in memory. */
export async function zipStore(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const writer = new ZipWriter((chunk) => void chunks.push(chunk));
  for (const entry of entries) await writer.add(entry);
  await writer.finish();
  const out = new Uint8Array(writer.bytesWritten);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export interface ZipFileInfo {
  readonly name: string;
  readonly size: number;
  readonly crc: number;
  readonly data: Uint8Array;
}

/** Reads a store-only archive written by `ZipWriter` (verifies every CRC). Throws on anything else. */
export function readZipStore(bytes: Uint8Array): ZipFileInfo[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error("Not a zip archive (too short).");
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip archive (no end-of-central-directory record).");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files: ZipFileInfo[] = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Corrupt central directory.");
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (method !== 0) throw new Error(`Unsupported compression method ${method} for ${name}.`);
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Corrupt local header for ${name}.`);
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}.`);
    files.push({ name, size, crc, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
