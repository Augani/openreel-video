/**
 * The AAF structured-storage object layer on top of CFB: every AAF object is a storage whose
 * CLSID is the class AUID and whose "properties" stream lists (pid, format, size) entries followed
 * by their data. Strong references to other objects are child storages named by the property.
 */
import { findChild, storage, stream, type CfbNode } from "./cfb";
import { auid, auidString, FMT } from "./ids";

const PROPERTY_BYTE_ORDER = 0x4c;
const PROPERTY_VERSION = 32;

export interface PropEntry {
  readonly pid: number;
  readonly fmt: number;
  readonly data: Uint8Array;
}

// ── scalar encodings ────────────────────────────────────────────────────────

export const u8 = (v: number): Uint8Array => Uint8Array.of(v & 0xff);
export const u16 = (v: number): Uint8Array => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
};
export const u32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
};
export const i32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
};
export const i64 = (v: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(Math.round(v)), true);
  return b;
};
export const bool = (v: boolean): Uint8Array => u8(v ? 1 : 0);
/** UTF-16LE with a terminating NUL, the AAF String type. */
export function str(v: string): Uint8Array {
  const b = new Uint8Array((v.length + 1) * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < v.length; i++) dv.setUint16(i * 2, v.charCodeAt(i), true);
  return b;
}
export const rational = (num: number, den: number): Uint8Array => {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, num, true);
  dv.setInt32(4, den, true);
  return b;
};
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
/** AAF Timestamp: year (int16), month, day, hour, minute, second, fraction (1/250 s). */
export function timestamp(date: Date): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setInt16(0, date.getUTCFullYear(), true);
  b[2] = date.getUTCMonth() + 1;
  b[3] = date.getUTCDate();
  b[4] = date.getUTCHours();
  b[5] = date.getUTCMinutes();
  b[6] = date.getUTCSeconds();
  b[7] = Math.min(249, Math.floor(date.getUTCMilliseconds() / 4));
  return b;
}

export function decodeStr(data: Uint8Array): string {
  let s = "";
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i + 1 < data.length; i += 2) {
    const c = dv.getUint16(i, true);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// ── properties stream ───────────────────────────────────────────────────────

export function encodeProps(entries: readonly PropEntry[]): Uint8Array {
  const head = new Uint8Array(4 + entries.length * 6);
  const dv = new DataView(head.buffer);
  head[0] = PROPERTY_BYTE_ORDER;
  head[1] = PROPERTY_VERSION;
  dv.setUint16(2, entries.length, true);
  entries.forEach((e, i) => {
    dv.setUint16(4 + i * 6, e.pid, true);
    dv.setUint16(6 + i * 6, e.fmt, true);
    dv.setUint16(8 + i * 6, e.data.length, true);
  });
  return concat(head, ...entries.map((e) => e.data));
}

export function decodeProps(data: Uint8Array): PropEntry[] {
  if (data.length < 4) return [];
  if (data[0] !== PROPERTY_BYTE_ORDER) throw new Error("Big-endian AAF properties are not supported.");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getUint16(2, true);
  const out: PropEntry[] = [];
  let off = 4 + count * 6;
  for (let i = 0; i < count; i++) {
    const pid = dv.getUint16(4 + i * 6, true);
    const fmt = dv.getUint16(6 + i * 6, true);
    const size = dv.getUint16(8 + i * 6, true);
    out.push({ pid, fmt, data: data.subarray(off, off + size) });
    off += size;
  }
  return out;
}

// ── write side ──────────────────────────────────────────────────────────────

export type Prop =
  | { readonly k: "data"; readonly pid: number; readonly v: Uint8Array }
  | { readonly k: "ref"; readonly pid: number; readonly name: string; readonly obj: Obj }
  | { readonly k: "vec"; readonly pid: number; readonly name: string; readonly items: readonly Obj[] }
  | {
      readonly k: "set";
      readonly pid: number;
      readonly name: string;
      readonly keyPid: number;
      readonly keySize: 16 | 32;
      readonly items: readonly { readonly key: Uint8Array; readonly obj: Obj }[];
    }
  | { readonly k: "weak"; readonly pid: number; readonly index: number; readonly keyPid: number; readonly key: Uint8Array };

/** An object to be written: its class (canonical AUID) and properties. */
export interface Obj {
  readonly cls: string;
  readonly props: readonly Prop[];
}

export const obj = (cls: string, props: readonly Prop[]): Obj => ({ cls, props });
export const dataProp = (pid: number, v: Uint8Array): Prop => ({ k: "data", pid, v });
export const refProp = (pid: number, name: string, o: Obj): Prop => ({ k: "ref", pid, name, obj: o });
export const vecProp = (pid: number, name: string, items: readonly Obj[]): Prop => ({ k: "vec", pid, name, items });
export const weakProp = (pid: number, index: number, keyPid: number, canonicalAuid: string): Prop => ({
  k: "weak",
  pid,
  index,
  keyPid,
  key: auid(canonicalAuid),
});

const childName = (name: string, key: number): string => `${name}{${key.toString(16)}}`;

function indexStream(count: number, keys: readonly number[]): Uint8Array {
  const b = new Uint8Array(12 + keys.length * 4);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, count, true);
  dv.setUint32(4, count, true);
  dv.setUint32(8, 0xffffffff, true);
  keys.forEach((k, i) => dv.setUint32(12 + i * 4, k, true));
  return b;
}

/** Add the entries of `props` to an existing object storage (children, index streams, properties stream). */
export function applyProps(node: CfbNode, props: readonly Prop[]): void {
  const existing = findChild(node, "properties");
  const entries: PropEntry[] = existing ? decodeProps(existing.data) : [];
  for (const p of props) {
    switch (p.k) {
      case "data":
        entries.push({ pid: p.pid, fmt: FMT.data, data: p.v });
        break;
      case "ref":
        entries.push({ pid: p.pid, fmt: FMT.strongRef, data: str(p.name) });
        node.children.push(toNode(p.name, p.obj));
        break;
      case "vec": {
        entries.push({ pid: p.pid, fmt: FMT.strongRefVector, data: str(p.name) });
        const keys = p.items.map((_, i) => i);
        p.items.forEach((item, i) => node.children.push(toNode(childName(p.name, i), item)));
        node.children.push(stream(`${p.name} index`, indexStream(p.items.length, keys)));
        break;
      }
      case "set": {
        entries.push({ pid: p.pid, fmt: FMT.strongRefSet, data: str(p.name) });
        const header = new Uint8Array(3);
        new DataView(header.buffer).setUint16(0, p.keyPid, true);
        header[2] = p.keySize;
        const rows: Uint8Array[] = [];
        p.items.forEach((item, i) => {
          node.children.push(toNode(childName(p.name, i), item.obj));
          rows.push(concat(u32(i), u32(1), item.key));
        });
        node.children.push(stream(`${p.name} index`, concat(indexStream(p.items.length, []), header, ...rows)));
        break;
      }
      case "weak":
        entries.push({ pid: p.pid, fmt: FMT.weakRef, data: concat(u16(p.index), u16(p.keyPid), u8(16), p.key) });
        break;
    }
  }
  const encoded = encodeProps(entries);
  if (existing) existing.data = encoded;
  else node.children.push(stream("properties", encoded));
}

export function toNode(name: string, o: Obj): CfbNode {
  const node = storage(name, auid(o.cls));
  applyProps(node, o.props);
  return node;
}

// ── read side ───────────────────────────────────────────────────────────────

/** A read AAF object: its storage plus decoded property table. */
export class AafObject {
  readonly classId: string;
  private readonly entries = new Map<number, PropEntry>();

  constructor(readonly node: CfbNode) {
    this.classId = auidString(node.clsid);
    const props = findChild(node, "properties");
    if (props) for (const e of decodeProps(props.data)) this.entries.set(e.pid, e);
  }

  has(pid: number): boolean {
    return this.entries.has(pid);
  }

  raw(pid: number): Uint8Array | undefined {
    return this.entries.get(pid)?.data;
  }

  private view(pid: number): DataView | undefined {
    const d = this.raw(pid);
    return d ? new DataView(d.buffer, d.byteOffset, d.byteLength) : undefined;
  }

  u8(pid: number): number | undefined {
    return this.raw(pid)?.[0];
  }

  u16(pid: number): number | undefined {
    const v = this.view(pid);
    return v && v.byteLength >= 2 ? v.getUint16(0, true) : undefined;
  }

  u32(pid: number): number | undefined {
    const v = this.view(pid);
    return v && v.byteLength >= 4 ? v.getUint32(0, true) : undefined;
  }

  i32(pid: number): number | undefined {
    const v = this.view(pid);
    return v && v.byteLength >= 4 ? v.getInt32(0, true) : undefined;
  }

  /** Int64 (Length, Position, StartTime). Values beyond 2^53 are not representable and read as NaN. */
  i64(pid: number): number | undefined {
    const v = this.view(pid);
    if (!v || v.byteLength < 8) return undefined;
    const big = v.getBigInt64(0, true);
    return Math.abs(Number(big)) > Number.MAX_SAFE_INTEGER ? Number.NaN : Number(big);
  }

  str(pid: number): string | undefined {
    const d = this.raw(pid);
    return d ? decodeStr(d) : undefined;
  }

  rational(pid: number): { num: number; den: number } | undefined {
    const v = this.view(pid);
    return v && v.byteLength >= 8 ? { num: v.getInt32(0, true), den: v.getInt32(4, true) } : undefined;
  }

  /** A 16-byte AUID value (e.g. UsageCode) as a canonical string. */
  auid(pid: number): string | undefined {
    const d = this.raw(pid);
    return d && d.length >= 16 ? auidString(d) : undefined;
  }

  /** The 32-byte MobID as a hex key. */
  mobKey(pid: number): string | undefined {
    const d = this.raw(pid);
    if (!d || d.length < 32) return undefined;
    let s = "";
    for (const b of d.subarray(0, 32)) s += b.toString(16).padStart(2, "0");
    return s;
  }

  /** Target AUID of a weak reference (the last 16 bytes of its stored form). */
  weakAuid(pid: number): string | undefined {
    const d = this.raw(pid);
    return d && d.length >= 21 ? auidString(d, 5) : undefined;
  }

  /** A strong reference to one object. */
  ref(pid: number): AafObject | undefined {
    const name = this.str(pid);
    const child = name ? findChild(this.node, name) : undefined;
    return child && child.kind === "storage" ? new AafObject(child) : undefined;
  }

  /** A strong reference vector or set, in stored order. */
  list(pid: number): AafObject[] {
    const name = this.str(pid);
    if (!name) return [];
    const index = findChild(this.node, `${name} index`);
    if (!index || index.data.length < 12) return [];
    const dv = new DataView(index.data.buffer, index.data.byteOffset, index.data.byteLength);
    const count = dv.getUint32(0, true);
    const fmt = this.entries.get(pid)?.fmt;
    const keys: number[] = [];
    if (fmt === FMT.strongRefSet) {
      const keySize = index.data[14];
      let off = 15;
      for (let i = 0; i < count && off + 8 + keySize <= index.data.length; i++) {
        keys.push(dv.getUint32(off, true));
        off += 8 + keySize;
      }
    } else {
      for (let i = 0; i < count && 12 + i * 4 + 4 <= index.data.length; i++) keys.push(dv.getUint32(12 + i * 4, true));
    }
    const out: AafObject[] = [];
    for (const k of keys) {
      const child = findChild(this.node, childName(name, k));
      if (child && child.kind === "storage") out.push(new AafObject(child));
    }
    return out;
  }
}
