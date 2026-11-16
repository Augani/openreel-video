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
