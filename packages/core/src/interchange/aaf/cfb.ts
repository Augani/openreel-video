/**
 * Minimal Microsoft Compound File Binary (structured storage) reader and writer.
 * AAF is a CFB container: storages are directories, streams are files. Only what AAF needs is
 * implemented: versions 3 (512-byte sectors) and 4 (4096-byte sectors), the mini stream, DIFAT on
 * read. The writer always emits version 4 (the same layout pyaaf2 and the AAF SDK's "4K" files use).
 */

export interface CfbNode {
  readonly name: string;
  readonly kind: "storage" | "stream";
  /** 16 bytes, all zero when unset. AAF stores the object's class AUID here (little-endian GUID layout). */
  clsid: Uint8Array;
  /** Storages only. */
  children: CfbNode[];
  /** Streams only. */
  data: Uint8Array;
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;
const MINI_SECTOR = 64;
const MINI_CUTOFF = 4096;
const ZERO_CLSID = (): Uint8Array => new Uint8Array(16);

export const storage = (name: string, clsid: Uint8Array = ZERO_CLSID()): CfbNode => ({
  name,
  kind: "storage",
  clsid,
  children: [],
  data: new Uint8Array(0),
});

export const stream = (name: string, data: Uint8Array): CfbNode => ({
  name,
  kind: "stream",
  clsid: ZERO_CLSID(),
  children: [],
  data,
});

export function findChild(node: CfbNode, name: string): CfbNode | undefined {
  return node.children.find((c) => c.name === name);
}

export class CfbError extends Error {}

// ── reader ──────────────────────────────────────────────────────────────────

export function parseCfb(bytes: Uint8Array): CfbNode {
  if (bytes.length < 512 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new CfbError("Not a compound file (bad signature).");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint16(0x1a, true);
  const sectorShift = view.getUint16(0x1e, true);
  const miniShift = view.getUint16(0x20, true);
  if ((major !== 3 && major !== 4) || (sectorShift !== 9 && sectorShift !== 12) || miniShift !== 6) {
    throw new CfbError("Unsupported compound file version.");
  }
  const sectorSize = 1 << sectorShift;
  const sectorOffset = (sector: number): number => (sector + 1) * sectorSize;
  const readSector = (sector: number): Uint8Array => {
    const start = sectorOffset(sector);
    if (start >= bytes.length) throw new CfbError("Sector outside the file.");
    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length));
  };

  const fatSectorCount = view.getUint32(0x2c, true);
  const firstDirSector = view.getUint32(0x30, true);
  const miniCutoff = view.getUint32(0x38, true);
  const firstMiniFat = view.getUint32(0x3c, true);
  const miniFatCount = view.getUint32(0x40, true);
  let difatSector = view.getUint32(0x44, true);
  const difatCount = view.getUint32(0x48, true);

  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i++) {
    const s = view.getUint32(0x4c + i * 4, true);
    if (s !== FREESECT) fatSectors.push(s);
  }
  for (let d = 0; d < difatCount && difatSector !== ENDOFCHAIN && difatSector !== FREESECT; d++) {
    const sec = readSector(difatSector);
    const sv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatSectors.length < fatSectorCount; i++) {
      const s = sv.getUint32(i * 4, true);
      if (s !== FREESECT) fatSectors.push(s);
    }
    difatSector = sv.getUint32(per * 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((s, i) => {
    const sec = readSector(s);
    const sv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let k = 0; k < sectorSize / 4; k++) fat[i * (sectorSize / 4) + k] = sv.getUint32(k * 4, true);
  });

  const chain = (start: number): number[] => {
    const out: number[] = [];
    let s = start;
    while (s !== ENDOFCHAIN && s !== FREESECT) {
      if (s >= fat.length || out.length > fat.length) throw new CfbError("Corrupt sector chain.");
      out.push(s);
      s = fat[s];
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const sectors = chain(start);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => out.set(readSector(s), i * sectorSize));
    return size >= 0 && size <= out.length ? out.subarray(0, size) : out;
  };

  const dirBytes = readChain(firstDirSector, -1);
  const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  interface Entry {
    name: string;
    type: number;
    left: number;
    right: number;
    child: number;
    clsid: Uint8Array;
    start: number;
    size: number;
  }
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = dv.getUint16(off + 64, true);
    let name = "";
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(dv.getUint16(off + i * 2, true));
    const sizeLow = dv.getUint32(off + 120, true);
    const sizeHigh = major === 4 ? dv.getUint32(off + 124, true) : 0;
    entries.push({
      name,
      type: dirBytes[off + 66],
      left: dv.getUint32(off + 68, true),
      right: dv.getUint32(off + 72, true),
      child: dv.getUint32(off + 76, true),
      clsid: dirBytes.slice(off + 80, off + 96),
      start: dv.getUint32(off + 116, true),
      size: sizeHigh * 0x100000000 + sizeLow,
    });
  }
  if (!entries.length || entries[0].type !== 5) throw new CfbError("Missing root directory entry.");

  // Mini stream and mini FAT.
  const miniStream = entries[0].size > 0 ? readChain(entries[0].start, entries[0].size) : new Uint8Array(0);
  const miniFatBytes = miniFatCount > 0 ? readChain(firstMiniFat, -1) : new Uint8Array(0);
  const mv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = (i: number): number => mv.getUint32(i * 4, true);
  const readMini = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let s = start;
    let written = 0;
    let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && written < size) {
      if (guard++ > miniFatBytes.length / 4 + 1) throw new CfbError("Corrupt mini sector chain.");
      const from = s * MINI_SECTOR;
      const take = Math.min(MINI_SECTOR, size - written);
      out.set(miniStream.subarray(from, from + take), written);
      written += take;
      s = miniFat(s);
    }
    return out;
  };

  const build = (index: number): CfbNode => {
    const e = entries[index];
    if (e.type === 2) {
      const data = e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size);
      return { name: e.name, kind: "stream", clsid: e.clsid, children: [], data: data.slice() };
    }
    const node: CfbNode = { name: e.name, kind: "storage", clsid: e.clsid, children: [], data: new Uint8Array(0) };
    const stack: number[] = [];
    let cur = e.child;
    // In-order traversal of the sibling red-black tree.
    const seen = new Set<number>();
    while (cur !== NOSTREAM || stack.length) {
      while (cur !== NOSTREAM) {
        if (cur >= entries.length || seen.has(cur)) throw new CfbError("Corrupt directory tree.");
        seen.add(cur);
        stack.push(cur);
        cur = entries[cur].left;
      }
      const top = stack.pop() as number;
      node.children.push(build(top));
      cur = entries[top].right;
    }
    return node;
  };
  const root = build(0);
  return root;
}

// ── writer ──────────────────────────────────────────────────────────────────

/** Directory sibling order: shorter names first, then case-insensitive (upper-cased UTF-16) comparison. */
function compareNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

interface FlatEntry {
  node: CfbNode;
  type: 1 | 2 | 5;
  left: number;
  right: number;
  child: number;
  color: 0 | 1; // 0 red, 1 black
  start: number;
  size: number;
}

export function writeCfb(root: CfbNode, sectorSize: 512 | 4096 = 4096): Uint8Array {
  if (root.kind !== "storage") throw new CfbError("The root must be a storage.");
  const entries: FlatEntry[] = [];
  const add = (node: CfbNode, type: 1 | 2 | 5): number => {
    entries.push({ node, type, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, color: 1, start: ENDOFCHAIN, size: 0 });
    return entries.length - 1;
  };
  const layout = (parent: number): void => {
    const node = entries[parent].node;
    const kids = [...node.children].sort((x, y) => compareNames(x.name, y.name));
    for (let i = 1; i < kids.length; i++) {
      if (compareNames(kids[i - 1].name, kids[i].name) === 0) throw new CfbError(`Duplicate entry name "${kids[i].name}".`);
    }
    const ids = kids.map((k) => add(k, k.kind === "storage" ? 1 : 2));
    // Balanced tree by median split. Only the deepest level (when incomplete) is red.
    const maxDepth = kids.length ? Math.floor(Math.log2(kids.length)) : 0;
    const perfect = kids.length === Math.pow(2, maxDepth + 1) - 1;
    const link = (lo: number, hi: number, depth: number): number => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi) >> 1;
      const id = ids[mid];
      entries[id].left = link(lo, mid - 1, depth + 1);
      entries[id].right = link(mid + 1, hi, depth + 1);
      entries[id].color = !perfect && depth === maxDepth ? 0 : 1;
      return id;
    };
    entries[parent].child = link(0, ids.length - 1, 0);
    kids.forEach((k, i) => {
      if (k.kind === "storage") layout(ids[i]);
    });
  };
  add(root, 5);
  layout(0);

  // Mini stream container for small streams.
  const miniChunks: Uint8Array[] = [];
  const miniFat: number[] = [];
  let miniCount = 0;
  for (const e of entries) {
    if (e.type !== 2) continue;
    const len = e.node.data.length;
    e.size = len;
    if (len === 0) continue;
    if (len < MINI_CUTOFF) {
      const sectors = Math.ceil(len / MINI_SECTOR);
      e.start = miniCount;
      for (let i = 0; i < sectors; i++) miniFat.push(i === sectors - 1 ? ENDOFCHAIN : miniCount + i + 1);
      miniCount += sectors;
      const padded = new Uint8Array(sectors * MINI_SECTOR);
      padded.set(e.node.data);
      miniChunks.push(padded);
    }
  }
  const perSector = sectorSize / 4;
  // Unused entries of the last mini-FAT sector are "free" (readers size the mini stream from the last used one).
  while (miniFat.length % perSector !== 0) miniFat.push(FREESECT);
  const miniStream = new Uint8Array(miniCount * MINI_SECTOR);
  {
    let off = 0;
    for (const c of miniChunks) {
      miniStream.set(c, off);
      off += c.length;
    }
  }

  const sectorsFor = (len: number): number => Math.ceil(len / sectorSize);
  const fatEntries: number[] = [];
  const dataSectors: Uint8Array[] = [];
  const allocChain = (data: Uint8Array): number => {
    const n = sectorsFor(data.length);
    if (n === 0) return ENDOFCHAIN;
    const first = fatEntries.length;
    for (let i = 0; i < n; i++) {
      fatEntries.push(i === n - 1 ? ENDOFCHAIN : first + i + 1);
      const sec = new Uint8Array(sectorSize);
      sec.set(data.subarray(i * sectorSize, (i + 1) * sectorSize));
      dataSectors.push(sec);
    }
    return first;
  };

  entries[0].size = miniStream.length;
  entries[0].start = miniStream.length ? allocChain(miniStream) : ENDOFCHAIN;
  for (const e of entries) {
    if (e.type === 2 && e.node.data.length >= MINI_CUTOFF) e.start = allocChain(e.node.data);
  }

  const miniFatBytes = new Uint8Array(miniFat.length * 4);
  {
    const mv = new DataView(miniFatBytes.buffer);
    miniFat.forEach((v, i) => mv.setUint32(i * 4, v, true));
  }
  const firstMiniFat = miniFat.length ? allocChain(miniFatBytes) : ENDOFCHAIN;
  const miniFatSectors = miniFat.length ? sectorsFor(miniFatBytes.length) : 0;

  const dirBytes = new Uint8Array(sectorsFor(entries.length * 128) * sectorSize);
  const dv = new DataView(dirBytes.buffer);
  entries.forEach((e, i) => {
    const off = i * 128;
    const name = e.node.name;
    if (name.length > 31) throw new CfbError(`Entry name too long: "${name}".`);
    for (let k = 0; k < name.length; k++) dv.setUint16(off + k * 2, name.charCodeAt(k), true);
    dv.setUint16(off + 64, (name.length + 1) * 2, true);
    dirBytes[off + 66] = e.type;
    dirBytes[off + 67] = e.color;
    dv.setUint32(off + 68, e.left, true);
    dv.setUint32(off + 72, e.right, true);
    dv.setUint32(off + 76, e.child, true);
    dirBytes.set(e.node.clsid, off + 80);
    dv.setUint32(off + 116, e.type === 1 ? 0 : e.start, true);
    dv.setUint32(off + 120, e.size % 0x100000000, true);
    dv.setUint32(off + 124, Math.floor(e.size / 0x100000000), true);
  });
  // Unused directory slots are "free" entries with NOSTREAM links.
  for (let i = entries.length; i < dirBytes.length / 128; i++) {
    const off = i * 128;
    dv.setUint32(off + 68, NOSTREAM, true);
    dv.setUint32(off + 72, NOSTREAM, true);
    dv.setUint32(off + 76, NOSTREAM, true);
  }
  const firstDir = allocChain(dirBytes);
  const dirSectors = dirBytes.length / sectorSize;

  // FAT sectors cover every sector including themselves.
  let fatSectors = 0;
  while ((fatEntries.length + fatSectors) > fatSectors * perSector) fatSectors++;
  if (fatSectors > 109) throw new CfbError("The file is too large for this writer.");
  const firstFat = fatEntries.length;
  for (let i = 0; i < fatSectors; i++) fatEntries.push(FATSECT);
  const fatBytes = new Uint8Array(fatSectors * sectorSize);
  {
    const fv = new DataView(fatBytes.buffer);
    for (let i = 0; i < fatSectors * perSector; i++) fv.setUint32(i * 4, i < fatEntries.length ? fatEntries[i] : FREESECT, true);
  }

  const totalSectors = fatEntries.length;
  const out = new Uint8Array(sectorSize * (1 + totalSectors));
  const ov = new DataView(out.buffer);
  SIGNATURE.forEach((b, i) => (out[i] = b));
  ov.setUint16(0x18, 0x3e, true);
  ov.setUint16(0x1a, sectorSize === 4096 ? 4 : 3, true);
  ov.setUint16(0x1c, 0xfffe, true);
  ov.setUint16(0x1e, sectorSize === 4096 ? 12 : 9, true);
  ov.setUint16(0x20, 6, true);
  ov.setUint32(0x28, sectorSize === 4096 ? dirSectors : 0, true);
  ov.setUint32(0x2c, fatSectors, true);
  ov.setUint32(0x30, firstDir, true);
  ov.setUint32(0x38, MINI_CUTOFF, true);
  ov.setUint32(0x3c, firstMiniFat, true);
  ov.setUint32(0x40, miniFatSectors, true);
  ov.setUint32(0x44, ENDOFCHAIN, true);
  ov.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) ov.setUint32(0x4c + i * 4, i < fatSectors ? firstFat + i : FREESECT, true);
  dataSectors.forEach((sec, i) => out.set(sec, sectorSize * (1 + i)));
  // dataSectors holds everything allocated before the FAT sectors.
  out.set(fatBytes, sectorSize * (1 + firstFat));
  return out;
}

