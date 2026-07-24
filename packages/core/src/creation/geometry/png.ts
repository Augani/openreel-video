const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStore(raw: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  let offset = 0;
  while (offset < raw.length) {
    const chunkLength = Math.min(65535, raw.length - offset);
    const isFinal = offset + chunkLength >= raw.length;
    blocks.push(isFinal ? 1 : 0);
    blocks.push(chunkLength & 0xff, (chunkLength >>> 8) & 0xff);
    const nlen = ~chunkLength & 0xffff;
    blocks.push(nlen & 0xff, (nlen >>> 8) & 0xff);
    for (let i = 0; i < chunkLength; i += 1) {
      blocks.push(raw[offset + i]!);
    }
    offset += chunkLength;
  }
  const checksum = adler32(raw);
  blocks.push(
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff,
  );
  return Uint8Array.from(blocks);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error("encodePng: rgba length must equal width * height * 4");
  }
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlibStore(raw);
  const chunks = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, current) => sum + current.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const current of chunks) {
    out.set(current, offset);
    offset += current.length;
  }
  return out;
}
