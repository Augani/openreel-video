/**
 * Minimal ZIP reader/writer for `.orplugin` packages.
 *
 * Reading supports the two methods real archivers use (stored and deflate) and
 * is bounded: entry count, per-entry and total uncompressed size are capped
 * BEFORE inflating, so a zip bomb is rejected from the central directory alone.
 * Inflate uses the platform `DecompressionStream("deflate-raw")` (browsers, Node 18+, Electron).
 * Writing produces stored (uncompressed) archives, enough for tests and packing.
 */

export const MAX_ZIP_ENTRIES = 64;
export const MAX_ENTRY_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This runtime cannot inflate zip entries (DecompressionStream is unavailable)");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`zip entry inflates beyond the ${limit} byte limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Read every file entry of a zip archive. Directory entries are skipped. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip archive (no end-of-central-directory record)");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  if (count > MAX_ZIP_ENTRIES) throw new Error(`Archive has more than ${MAX_ZIP_ENTRIES} entries`);

  interface Entry {
    name: string;
    method: number;
    compressed: number;
    size: number;
    localOffset: number;
  }
  const entries: Entry[] = [];
  let declaredTotal = 0;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== SIG_CEN) {
      throw new Error("Corrupt zip central directory");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`Encrypted zip entries are not supported (${name})`);
    if (name.endsWith("/")) continue;
    if (size > MAX_ENTRY_BYTES) throw new Error(`${name} is larger than ${MAX_ENTRY_BYTES} bytes`);
    declaredTotal += size;
    if (declaredTotal > MAX_TOTAL_BYTES) throw new Error(`Archive exceeds ${MAX_TOTAL_BYTES} bytes uncompressed`);
    entries.push({ name, method, compressed, size, localOffset });
  }

  const out = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.localOffset + 30 > bytes.length || view.getUint32(e.localOffset, true) !== SIG_LOC) {
      throw new Error(`Corrupt local header for ${e.name}`);
    }
    const nameLen = view.getUint16(e.localOffset + 26, true);
    const extraLen = view.getUint16(e.localOffset + 28, true);
    const start = e.localOffset + 30 + nameLen + extraLen;
    if (start + e.compressed > bytes.length) throw new Error(`Truncated data for ${e.name}`);
    const raw = bytes.subarray(start, start + e.compressed);
    let data: Uint8Array;
    if (e.method === 0) data = raw.slice();
    else if (e.method === 8) data = await inflateRaw(raw, Math.min(e.size, MAX_ENTRY_BYTES));
    else throw new Error(`Unsupported zip compression method ${e.method} (${e.name})`);
    if (data.length !== e.size) throw new Error(`Size mismatch for ${e.name}`);
    out.set(e.name, data);
  }
  return out;
}

/** Build a stored (uncompressed) zip archive. */
export function createStoredZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOC, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, data);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
