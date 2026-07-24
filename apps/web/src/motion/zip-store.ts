export interface ZipStoreEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

interface PreparedEntry {
  readonly nameBytes: Uint8Array;
  readonly data: Uint8Array;
  readonly crc: number;
  readonly localHeaderOffset: number;
}

export function createStoredZip(
  entries: readonly ZipStoreEntry[],
): Uint8Array<ArrayBuffer> {
  if (!Array.isArray(entries)) {
    throw new Error("createStoredZip: entries must be an array");
  }

  const LOCAL_HEADER_SIZE = 30;
  const CENTRAL_HEADER_SIZE = 46;
  const END_RECORD_SIZE = 22;

  const prepared: PreparedEntry[] = [];
  let localSectionSize = 0;
  for (const entry of entries) {
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      throw new Error("createStoredZip: entry name must be a non-empty string");
    }
    if (!(entry.data instanceof Uint8Array)) {
      throw new Error("createStoredZip: entry data must be a Uint8Array");
    }
    const nameBytes = encodeName(entry.name);
    prepared.push({
      nameBytes,
      data: entry.data,
      crc: crc32(entry.data),
      localHeaderOffset: localSectionSize,
    });
    localSectionSize += LOCAL_HEADER_SIZE + nameBytes.length + entry.data.length;
  }

  let centralSectionSize = 0;
  for (const entry of prepared) {
    centralSectionSize += CENTRAL_HEADER_SIZE + entry.nameBytes.length;
  }

  const totalSize = localSectionSize + centralSectionSize + END_RECORD_SIZE;
  const backing = new ArrayBuffer(totalSize);
  const buffer = new Uint8Array(backing);
  const view = new DataView(backing);

  let cursor = 0;
  for (const entry of prepared) {
    writeUint32(view, cursor, 0x04034b50);
    writeUint16(view, cursor + 4, 20);
    writeUint16(view, cursor + 6, 0);
    writeUint16(view, cursor + 8, 0);
    writeUint16(view, cursor + 10, 0);
    writeUint16(view, cursor + 12, 0);
    writeUint32(view, cursor + 14, entry.crc);
    writeUint32(view, cursor + 18, entry.data.length);
    writeUint32(view, cursor + 22, entry.data.length);
    writeUint16(view, cursor + 26, entry.nameBytes.length);
    writeUint16(view, cursor + 28, 0);
    buffer.set(entry.nameBytes, cursor + LOCAL_HEADER_SIZE);
    buffer.set(entry.data, cursor + LOCAL_HEADER_SIZE + entry.nameBytes.length);
    cursor += LOCAL_HEADER_SIZE + entry.nameBytes.length + entry.data.length;
  }

  const centralStart = cursor;
  for (const entry of prepared) {
    writeUint32(view, cursor, 0x02014b50);
    writeUint16(view, cursor + 4, 20);
    writeUint16(view, cursor + 6, 20);
    writeUint16(view, cursor + 8, 0);
    writeUint16(view, cursor + 10, 0);
    writeUint16(view, cursor + 12, 0);
    writeUint16(view, cursor + 14, 0);
    writeUint32(view, cursor + 16, entry.crc);
    writeUint32(view, cursor + 20, entry.data.length);
    writeUint32(view, cursor + 24, entry.data.length);
    writeUint16(view, cursor + 28, entry.nameBytes.length);
    writeUint16(view, cursor + 30, 0);
    writeUint16(view, cursor + 32, 0);
    writeUint16(view, cursor + 34, 0);
    writeUint16(view, cursor + 36, 0);
    writeUint32(view, cursor + 38, 0);
    writeUint32(view, cursor + 42, entry.localHeaderOffset);
    buffer.set(entry.nameBytes, cursor + CENTRAL_HEADER_SIZE);
    cursor += CENTRAL_HEADER_SIZE + entry.nameBytes.length;
  }

  writeUint32(view, cursor, 0x06054b50);
  writeUint16(view, cursor + 4, 0);
  writeUint16(view, cursor + 6, 0);
  writeUint16(view, cursor + 8, prepared.length);
  writeUint16(view, cursor + 10, prepared.length);
  writeUint32(view, cursor + 12, centralSectionSize);
  writeUint32(view, cursor + 16, centralStart);
  writeUint16(view, cursor + 20, 0);

  return buffer;
}
