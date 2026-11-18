/** Minimal generated font binaries for tests (a single OS/2 table). */
const OS2 = [0x4f, 0x53, 0x2f, 0x32];

function os2Table(fsType: number): Uint8Array {
  const table = new Uint8Array(96);
  new DataView(table.buffer).setUint16(8, fsType);
  return table;
}

export function makeSfnt(fsType: number, flavor: "ttf" | "otf" = "ttf"): ArrayBuffer {
  const out = new Uint8Array(12 + 16 + 96);
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor === "otf" ? 0x4f54544f : 0x00010000);
  view.setUint16(4, 1);
  out.set(OS2, 12);
  view.setUint32(20, 28);
  view.setUint32(24, 96);
  out.set(os2Table(fsType), 28);
  return out.buffer;
}

export function makeWoff(fsType: number, compress: boolean, deflate: (data: Uint8Array) => Uint8Array): ArrayBuffer {
  const raw = os2Table(fsType);
  const stored = compress ? new Uint8Array(deflate(raw)) : raw;
  const out = new Uint8Array(44 + 20 + stored.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646);
  view.setUint16(12, 1);
  out.set(OS2, 44);
  view.setUint32(48, 64);
  view.setUint32(52, stored.byteLength);
  view.setUint32(56, raw.byteLength);
  out.set(stored, 64);
  return out.buffer;
}

/**
 * Minimal synthetic WOFF2: a filler "head" table (registered index 1) followed
 * by OS/2 (registered index 6, never transformed), so the OS/2 offset inside
 * the Brotli stream is non-zero.
 */
export function makeWoff2(fsType: number, brotli: (data: Uint8Array) => Uint8Array): ArrayBuffer {
  const head = new Uint8Array(54).fill(7);
  const os2 = os2Table(fsType);
  const stream = new Uint8Array(brotli(new Uint8Array([...head, ...os2])));
  const directory = new Uint8Array([1, 54, 6, 96]);
  const out = new Uint8Array(48 + directory.length + stream.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, out.byteLength);
  view.setUint16(12, 2);
  view.setUint32(20, stream.byteLength);
  out.set(directory, 48);
  out.set(stream, 48 + directory.length);
  return out.buffer;
}

export interface Woff2TableSpec {
  /** Four-character tag, written inline only when `index` is 63 (arbitrary tag). */
  readonly tag: string;
  /** Registered-tag index (0-62) or 63 for an arbitrary tag. */
  readonly index: number;
  /** Table-flags transform version (bits 6-7). */
  readonly version?: number;
  /** Bytes as they sit in the Brotli stream (the transformed data for transformed tables). */
  readonly stored: Uint8Array;
  /** The table's untransformed length (origLength); defaults to the stored length. */
  readonly origLength?: number;
}

function base128(value: number): number[] {
  const out = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) out.unshift((rest & 0x7f) | 0x80);
  return out;
}

/**
 * General synthetic WOFF2 per the spec's table directory: multi-byte UIntBase128
 * lengths, arbitrary tags (index 63) and the glyf/loca transform length.
 */
export function makeWoff2FromTables(tables: readonly Woff2TableSpec[], brotli: (data: Uint8Array) => Uint8Array): ArrayBuffer {
  const directory: number[] = [];
  const stream: number[] = [];
  for (const table of tables) {
    const version = table.version ?? 0;
    directory.push((version << 6) | table.index);
    if (table.index === 63) for (let i = 0; i < 4; i++) directory.push(table.tag.charCodeAt(i));
    directory.push(...base128(table.origLength ?? table.stored.byteLength));
    const transformed = table.index === 10 || table.index === 11 ? version === 0 : version !== 0;
    if (transformed) directory.push(...base128(table.stored.byteLength));
    for (const byte of table.stored) stream.push(byte);
  }
  const compressed = new Uint8Array(brotli(new Uint8Array(stream)));
  const out = new Uint8Array(48 + directory.length + compressed.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, out.byteLength);
  view.setUint16(12, tables.length);
  view.setUint32(20, compressed.byteLength);
  out.set(directory, 48);
  out.set(compressed, 48 + directory.length);
  return out.buffer;
}

/** A realistic-looking OS/2 table (version 4, weight 400) with a chosen fsType. */
export function makeOs2Table(fsType: number): Uint8Array {
  const table = new Uint8Array(96);
  const view = new DataView(table.buffer);
  view.setUint16(0, 4);
  view.setUint16(4, 400);
  view.setUint16(8, fsType);
  return table;
}
