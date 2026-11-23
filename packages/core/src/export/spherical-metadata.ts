/**
 * Spherical video metadata in MP4 / MOV: what YouTube, Facebook, VLC, Quest and desktop players read to treat a
 * file as 360.
 *
 * WRITE: Spherical Video V2 (Google): `st3d` (stereo mode) and `sv3d` (svhd, proj > prhd, equi) boxes inside the
 * video sample entry (avc1 / hvc1 / ...). ffprobe reports them as side data "Stereo 3D" and "Spherical Mapping".
 * The prhd box carries the initial view direction (yaw / pitch / roll, 16.16 fixed point degrees).
 * Alongside V2, the V1 `uuid` XML document (GSpherical, ffcc8263-f855-4a93-8814-587a02521fdd) is written as the
 * last child of the video `trak` for older players (initial view as InitialViewHeading / Pitch / RollDegrees).
 * `applySphericalToMoov` rewrites a `moov` box in memory; `planSphericalPatch` does the byte bookkeeping for a file
 * (moov in front of mdat: every chunk offset is shifted by the growth; moov behind mdat: nothing else moves).
 *
 * READ: V2 boxes and the V1 `uuid` XML box (GSpherical), for import detection.
 *
 * Fragmented MP4 (moof) is not rewritten: the sample entry lives in the init segment only and chunk offsets are
 * moof relative, so only the stsd edit applies; OpenReel never writes fragmented files.
 */
import { normalizeInitialView, normalizeVrProperties, type VrProperties } from "../vr/vr-properties";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** V1 spherical video uuid: ffcc8263-f855-4a93-8814-587a02521fdd. */
const V1_UUID = Uint8Array.from([
  0xff, 0xcc, 0x82, 0x63, 0xf8, 0x55, 0x4a, 0x93, 0x88, 0x14, 0x58, 0x7a, 0x02, 0x52, 0x1f, 0xdd,
]);

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
const VISUAL_ENTRY_HEADER = 78; // bytes of a VisualSampleEntry before its child boxes
const MAX_MOOV_BYTES = 256 * 1024 * 1024;

interface BoxRef {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  /** Bytes of the box header (8, or 16 with a 64-bit size). */
  readonly header: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function listBoxes(bytes: Uint8Array, from = 0, to = bytes.length): BoxRef[] {
  const out: BoxRef[] = [];
  const dv = view(bytes);
  let offset = from;
  while (offset + 8 <= to) {
    let size = dv.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) break;
      size = Number(dv.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = to - offset;
    if (size < header || offset + size > to) break;
    out.push({ type, start: offset, end: offset + size, header });
    offset += size;
  }
  return out;
}

function makeBox(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const size = 8 + payloads.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(size);
  view(out).setUint32(0, size);
  out.set(encoder.encode(type), 4);
  let o = 8;
  for (const p of payloads) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

const STEREO_MODE: Readonly<Record<VrProperties["layout"], number>> = {
  mono: 0,
  "over-under": 1,
  "side-by-side": 2,
};

/** Fraction of the sphere not covered on each side, as the 0.32 fixed point the equi box stores. */
function boundsFraction(capturedDeg: number, fullDeg: number): number {
  const margin = Math.max(0, Math.min(1, (fullDeg - capturedDeg) / 2 / fullDeg));
  return Math.min(0xffffffff, Math.round(margin * 4294967296));
}

/** The `st3d` and `sv3d` boxes of a VR property set (V2 spherical metadata). */
export function buildSphericalBoxes(vr: VrProperties): { st3d: Uint8Array; sv3d: Uint8Array } {
  const st3dPayload = new Uint8Array(5); // version + flags, stereo_mode
  st3dPayload[4] = STEREO_MODE[vr.layout];
  const st3d = makeBox("st3d", st3dPayload);

  const svhd = makeBox("svhd", new Uint8Array(4), encoder.encode("OpenReel\0"));
  const prhdPayload = new Uint8Array(16); // version/flags + yaw, pitch, roll (signed 16.16 fixed point degrees)
  const pv = view(prhdPayload);
  const initial = vr.initialView;
  if (initial) {
    pv.setInt32(4, Math.round(initial.yaw * 65536));
    pv.setInt32(8, Math.round(initial.pitch * 65536));
    pv.setInt32(12, Math.round(initial.roll * 65536));
  }
  const prhd = makeBox("prhd", prhdPayload);
  const bounds = new Uint8Array(20); // version/flags + top, bottom, left, right (0.32 fixed)
  const bv = view(bounds);
  const v = boundsFraction(vr.verticalFov, 180);
  const h = boundsFraction(vr.horizontalFov, 360);
  bv.setUint32(4, v);
  bv.setUint32(8, v);
  bv.setUint32(12, h);
  bv.setUint32(16, h);
  const equi = makeBox("equi", bounds);
  const proj = makeBox("proj", prhd, equi);
  return { st3d, sv3d: makeBox("sv3d", svhd, proj) };
}

const V1_STEREO: Readonly<Record<VrProperties["layout"], string | null>> = { mono: null, "over-under": "top-bottom", "side-by-side": "left-right" };

/**
 * The Spherical Video V1 XML document. `frame` (the coded picture size, both eyes) is only needed to describe a
 * partial sphere (cropped area); a full 360 x 180 sphere needs no pixel fields.
 */
export function buildSphericalV1Xml(vr: VrProperties, frame?: { readonly width: number; readonly height: number }): string {
  const parts: string[] = [
    '<?xml version="1.0"?>',
    '<rdf:SphericalVideo xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/">',
    "<GSpherical:Spherical>true</GSpherical:Spherical>",
    "<GSpherical:Stitched>true</GSpherical:Stitched>",
    "<GSpherical:StitchingSoftware>OpenReel</GSpherical:StitchingSoftware>",
    "<GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType>",
  ];
  const stereo = V1_STEREO[vr.layout];
  if (stereo) parts.push(`<GSpherical:StereoMode>${stereo}</GSpherical:StereoMode>`);
  if (vr.initialView) {
    parts.push(`<GSpherical:InitialViewHeadingDegrees>${vr.initialView.yaw}</GSpherical:InitialViewHeadingDegrees>`);
    parts.push(`<GSpherical:InitialViewPitchDegrees>${vr.initialView.pitch}</GSpherical:InitialViewPitchDegrees>`);
    parts.push(`<GSpherical:InitialViewRollDegrees>${vr.initialView.roll}</GSpherical:InitialViewRollDegrees>`);
  }
  if (frame && (vr.horizontalFov < 360 || vr.verticalFov < 180)) {
    const eyeW = vr.layout === "side-by-side" ? Math.floor(frame.width / 2) : frame.width;
    const eyeH = vr.layout === "over-under" ? Math.floor(frame.height / 2) : frame.height;
    const fullW = Math.round((eyeW * 360) / vr.horizontalFov);
    const fullH = Math.round((eyeH * 180) / vr.verticalFov);
    parts.push(
      `<GSpherical:FullPanoWidthPixels>${fullW}</GSpherical:FullPanoWidthPixels>`,
      `<GSpherical:FullPanoHeightPixels>${fullH}</GSpherical:FullPanoHeightPixels>`,
      `<GSpherical:CroppedAreaImageWidthPixels>${eyeW}</GSpherical:CroppedAreaImageWidthPixels>`,
      `<GSpherical:CroppedAreaImageHeightPixels>${eyeH}</GSpherical:CroppedAreaImageHeightPixels>`,
      `<GSpherical:CroppedAreaLeftPixels>${Math.round((fullW - eyeW) / 2)}</GSpherical:CroppedAreaLeftPixels>`,
      `<GSpherical:CroppedAreaTopPixels>${Math.round((fullH - eyeH) / 2)}</GSpherical:CroppedAreaTopPixels>`,
    );
  }
  parts.push("</rdf:SphericalVideo>");
  return parts.join("");
}

/** The V1 `uuid` box of a VR property set. */
export function buildSphericalV1Box(vr: VrProperties, frame?: { readonly width: number; readonly height: number }): Uint8Array {
  return makeBox("uuid", V1_UUID, encoder.encode(buildSphericalV1Xml(vr, frame)));
}

/** Width and height of the first sample entry of a `stsd` inside a trak, or null. */
function codedSizeOfTrak(trak: Uint8Array): { width: number; height: number } | null {
  const mdia = listBoxes(trak, 8).find((b) => b.type === "mdia");
  if (!mdia) return null;
  const minf = listBoxes(trak, mdia.start + mdia.header, mdia.end).find((b) => b.type === "minf");
  if (!minf) return null;
  const stbl = listBoxes(trak, minf.start + minf.header, minf.end).find((b) => b.type === "stbl");
  if (!stbl) return null;
  const stsd = listBoxes(trak, stbl.start + stbl.header, stbl.end).find((b) => b.type === "stsd");
  if (!stsd) return null;
  const entry = listBoxes(trak, stsd.start + 16, stsd.end)[0];
  if (!entry || entry.end - entry.start < 8 + VISUAL_ENTRY_HEADER) return null;
  const dv = view(trak);
  // VisualSampleEntry: 6 reserved + data reference index (8), 16 bytes pre-defined / reserved, then width and height.
  const width = dv.getUint16(entry.start + 8 + 24);
  const height = dv.getUint16(entry.start + 8 + 26);
  return width > 0 && height > 0 ? { width, height } : null;
}

function rebuildSampleEntry(entry: Uint8Array, extra: readonly Uint8Array[]): Uint8Array {
  const fixedEnd = 8 + VISUAL_ENTRY_HEADER;
  if (entry.length < fixedEnd) return entry;
  const kept: Uint8Array[] = [entry.subarray(8, fixedEnd)];
  for (const child of listBoxes(entry, fixedEnd, entry.length)) {
    if (child.type === "st3d" || child.type === "sv3d") continue;
    kept.push(entry.subarray(child.start, child.end));
  }
  const type = decoder.decode(entry.subarray(4, 8));
  return makeBox(type, ...kept, ...extra);
}

function rebuildStsd(stsd: Uint8Array, extra: readonly Uint8Array[]): Uint8Array {
  const head = stsd.subarray(8, 16); // version/flags + entry count
  const entries = listBoxes(stsd, 16, stsd.length).map((entry) => rebuildSampleEntry(stsd.subarray(entry.start, entry.end), extra));
  return makeBox("stsd", head, ...entries);
}

function handlerOf(trak: Uint8Array): string | null {
  const mdia = listBoxes(trak, 8).find((b) => b.type === "mdia");
  if (!mdia) return null;
  const hdlr = listBoxes(trak, mdia.start + mdia.header, mdia.end).find((b) => b.type === "hdlr");
  return hdlr ? decoder.decode(trak.subarray(hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12)) : null;
}

function rebuildContainer(box: Uint8Array, transform: (type: string, bytes: Uint8Array) => Uint8Array | null): Uint8Array {
  const type = decoder.decode(box.subarray(4, 8));
  const parts = listBoxes(box, 8).map((child) => {
    const bytes = box.subarray(child.start, child.end);
    return transform(child.type, bytes) ?? bytes;
  });
  return makeBox(type, ...parts);
}

function isV1Uuid(body: Uint8Array): boolean {
  return body.length > 16 && V1_UUID.every((v, i) => body[i] === v);
}

/** Copy of a container box without the children `drop` selects. */
function rebuildContainerFiltered(box: Uint8Array, drop: (type: string, bytes: Uint8Array) => boolean): Uint8Array {
  const type = decoder.decode(box.subarray(4, 8));
  const parts = listBoxes(box, 8)
    .map((child) => ({ child, bytes: box.subarray(child.start, child.end) }))
    .filter(({ child, bytes }) => !drop(child.type, bytes))
    .map(({ bytes }) => bytes);
  return makeBox(type, ...parts);
}

/**
 * Adds the spherical boxes to the first video track's sample entries (V2) and its trak (V1 uuid). `moov` is a whole `moov` box (header
 * included); the result is a whole `moov` box. Existing st3d / sv3d boxes are replaced.
 */
export function applySphericalToMoov(moov: Uint8Array, vr: VrProperties): Uint8Array {
  const { st3d, sv3d } = buildSphericalBoxes(vr);
  let done = false;
  const inStbl = (type: string, bytes: Uint8Array): Uint8Array | null => (type === "stsd" ? rebuildStsd(bytes, [st3d, sv3d]) : null);
  const inMinf = (type: string, bytes: Uint8Array): Uint8Array | null => (type === "stbl" ? rebuildContainer(bytes, inStbl) : null);
  const inMdia = (type: string, bytes: Uint8Array): Uint8Array | null => (type === "minf" ? rebuildContainer(bytes, inMinf) : null);
  const out = rebuildContainer(moov, (type, bytes) => {
    if (type !== "trak" || done || handlerOf(bytes) !== "vide") return null;
    done = true;
    const frame = codedSizeOfTrak(bytes) ?? undefined;
    // V1 uuid box: replaced when present, and written last in the trak.
    const stripped = rebuildContainerFiltered(bytes, (childType, child) => childType === "uuid" && isV1Uuid(child.subarray(8)));
    const withMdia = rebuildContainer(stripped, (childType, child) => (childType === "mdia" ? rebuildContainer(child, inMdia) : null));
    return makeBox("trak", withMdia.subarray(8), buildSphericalV1Box(vr, frame));
  });
  if (!done) throw new Error("No video track to tag with spherical metadata.");
  return out;
}

/** Adds `delta` to every chunk offset (stco / co64) of a moov box, in place. */
export function shiftChunkOffsets(moov: Uint8Array, delta: number): void {
  const dv = view(moov);
  const walk = (from: number, to: number): void => {
    for (const box of listBoxes(moov, from, to)) {
      if (CONTAINERS.has(box.type)) walk(box.start + box.header, box.end);
      else if (box.type === "stco") {
        const count = dv.getUint32(box.start + box.header + 4);
        for (let i = 0; i < count; i++) {
          const at = box.start + box.header + 8 + i * 4;
          const next = dv.getUint32(at) + delta;
          if (next < 0 || next > 0xffffffff) throw new Error("A chunk offset no longer fits 32 bits after adding spherical metadata.");
          dv.setUint32(at, next);
        }
      } else if (box.type === "co64") {
        const count = dv.getUint32(box.start + box.header + 4);
        for (let i = 0; i < count; i++) {
          const at = box.start + box.header + 8 + i * 8;
          dv.setBigUint64(at, dv.getBigUint64(at) + BigInt(delta));
        }
      }
    }
  };
  walk(8, moov.length);
}

/* -------------------------------------------------------------------------- */
/* File-level helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Random access to a file of known size (a Blob in the browser, a file handle in Node). */
export interface ByteReader {
  readonly size: number;
  read(start: number, length: number): Promise<Uint8Array>;
}

export function blobReader(blob: Blob): ByteReader {
  return {
    size: blob.size,
    read: async (start, length) => new Uint8Array(await blob.slice(start, start + length).arrayBuffer()),
  };
}

interface TopLevel {
  readonly moov: { start: number; end: number } | null;
  readonly mdatStart: number | null;
}

async function scanTopLevel(reader: ByteReader): Promise<TopLevel> {
  let offset = 0;
  let moov: TopLevel["moov"] = null;
  let mdatStart: number | null = null;
  let guard = 0;
  while (offset + 8 <= reader.size && guard++ < 10000) {
    const head = await reader.read(offset, 16);
    if (head.length < 8) break;
    const dv = view(head);
    let size = dv.getUint32(0);
    const type = decoder.decode(head.subarray(4, 8));
    if (size === 1 && head.length >= 16) size = Number(dv.getBigUint64(8));
    else if (size === 0) size = reader.size - offset;
    if (size < 8) break;
    if (type === "moov") moov = { start: offset, end: Math.min(reader.size, offset + size) };
    if (type === "mdat" && mdatStart === null) mdatStart = offset;
    offset += size;
  }
  return { moov, mdatStart };
}

export interface SphericalPatch {
  /** Bytes of the original file before the moov box. */
  readonly moovStart: number;
  /** Original offset just after the moov box: the rest of the file follows the new moov unchanged. */
  readonly moovEnd: number;
  readonly moov: Uint8Array;
}

/**
 * Computes the rewritten moov for a file; the new file is original[0, moovStart) + moov + original[moovEnd, size).
 * Returns null when the file has no moov (not an MP4 / MOV).
 */
export async function planSphericalPatch(reader: ByteReader, vr: VrProperties): Promise<SphericalPatch | null> {
  const top = await scanTopLevel(reader);
  if (!top.moov) return null;
  if (top.moov.end - top.moov.start > MAX_MOOV_BYTES) throw new Error("The movie header is too large to add spherical metadata.");
  const original = await reader.read(top.moov.start, top.moov.end - top.moov.start);
  const patched = applySphericalToMoov(original, normalizeVrProperties(vr));
  // Chunk offsets point into mdat; when mdat follows the moov everything after it moves by the growth.
  if (top.mdatStart !== null && top.mdatStart > top.moov.start) shiftChunkOffsets(patched, patched.length - original.length);
  return { moovStart: top.moov.start, moovEnd: top.moov.end, moov: patched };
}

/** Browser: a new Blob with spherical metadata (the sample data are shared, not copied). */
export async function addSphericalMetadataToBlob(blob: Blob, vr: VrProperties): Promise<Blob> {
  const plan = await planSphericalPatch(blobReader(blob), vr);
  if (!plan) throw new Error("The file is not an MP4 or MOV movie.");
  return new Blob([blob.slice(0, plan.moovStart), plan.moov as BlobPart, blob.slice(plan.moovEnd)], { type: blob.type });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

function readV2(entry: Uint8Array): VrProperties | null {
  const fixedEnd = 8 + VISUAL_ENTRY_HEADER;
  if (entry.length < fixedEnd) return null;
  let layout: VrProperties["layout"] = "mono";
  let equirect = false;
  let horizontalFov = 360;
  let verticalFov = 180;
  let initialView: VrProperties["initialView"];
  for (const child of listBoxes(entry, fixedEnd, entry.length)) {
    const body = entry.subarray(child.start + child.header, child.end);
    if (child.type === "st3d" && body.length >= 5) {
      layout = body[4] === 1 ? "over-under" : body[4] === 2 ? "side-by-side" : "mono";
    } else if (child.type === "sv3d") {
      for (const inner of listBoxes(body)) {
        if (inner.type !== "proj") continue;
        const projBody = body.subarray(inner.start + inner.header, inner.end);
        for (const leaf of listBoxes(projBody)) {
          if (leaf.type === "prhd") {
            const pb = projBody.subarray(leaf.start + leaf.header, leaf.end);
            if (pb.length >= 16) {
              const pv = view(pb);
              initialView = normalizeInitialView({ yaw: pv.getInt32(4) / 65536, pitch: pv.getInt32(8) / 65536, roll: pv.getInt32(12) / 65536 });
            }
          }
          if (leaf.type !== "equi") continue;
          equirect = true;
          const eb = projBody.subarray(leaf.start + leaf.header, leaf.end);
          if (eb.length >= 20) {
            const dv = view(eb);
            const top = dv.getUint32(4) / 4294967296;
            const left = dv.getUint32(12) / 4294967296;
            verticalFov = Math.max(1, 180 * (1 - 2 * top));
            horizontalFov = Math.max(1, 360 * (1 - 2 * left));
          }
        }
      }
    }
  }
  return equirect ? { projection: "equirectangular", layout, horizontalFov, verticalFov, ...(initialView ? { initialView } : {}), source: "metadata" } : null;
}

/** Spherical Video V1: an XML document in a trak-level uuid box. */
export function parseSphericalV1Xml(xml: string): VrProperties | null {
  if (!/<GSpherical:Spherical>\s*true/i.test(xml)) return null;
  const projection = /<GSpherical:ProjectionType>\s*([a-z]+)/i.exec(xml)?.[1]?.toLowerCase();
  if (projection && projection !== "equirectangular") return null;
  const stereo = /<GSpherical:StereoMode>\s*([a-z-]+)/i.exec(xml)?.[1]?.toLowerCase();
  const layout = stereo === "top-bottom" ? "over-under" : stereo === "left-right" ? "side-by-side" : "mono";
  const num = (tag: string): number | null => {
    const m = new RegExp(`<GSpherical:${tag}>\\s*(-?[0-9.]+)`, "i").exec(xml);
    return m ? Number(m[1]) : null;
  };
  const fullW = num("FullPanoWidthPixels");
  const cropW = num("CroppedAreaImageWidthPixels");
  const fullH = num("FullPanoHeightPixels");
  const cropH = num("CroppedAreaImageHeightPixels");
  const horizontalFov = fullW && cropW ? Math.min(360, (360 * cropW) / fullW) : 360;
  const verticalFov = fullH && cropH ? Math.min(180, (180 * cropH) / fullH) : 180;
  const initialView = normalizeInitialView({ yaw: num("InitialViewHeadingDegrees") ?? 0, pitch: num("InitialViewPitchDegrees") ?? 0, roll: num("InitialViewRollDegrees") ?? 0 });
  return { projection: "equirectangular", layout, horizontalFov, verticalFov, ...(initialView ? { initialView } : {}), source: "metadata" };
}

/** Spherical metadata found in a whole `moov` box (V2 boxes of the first video track, else a V1 uuid box). */
export function readSphericalFromMoov(moov: Uint8Array): VrProperties | null {
  for (const trak of listBoxes(moov, 8).filter((b) => b.type === "trak")) {
    const bytes = moov.subarray(trak.start, trak.end);
    if (handlerOf(bytes) !== "vide") continue;
    for (const child of listBoxes(bytes, 8)) {
      if (child.type === "uuid") {
        const body = bytes.subarray(child.start + child.header, child.end);
        if (body.length > 16 && V1_UUID.every((v, i) => body[i] === v)) {
          const found = parseSphericalV1Xml(decoder.decode(body.subarray(16)));
          if (found) return found;
        }
      }
      if (child.type !== "mdia") continue;
      const mdia = bytes.subarray(child.start, child.end);
      const minf = listBoxes(mdia, 8).find((b) => b.type === "minf");
      if (!minf) continue;
      const stbl = listBoxes(mdia, minf.start + minf.header, minf.end).find((b) => b.type === "stbl");
      if (!stbl) continue;
      const stsd = listBoxes(mdia, stbl.start + stbl.header, stbl.end).find((b) => b.type === "stsd");
      if (!stsd) continue;
      const stsdBytes = mdia.subarray(stsd.start, stsd.end);
      for (const entry of listBoxes(stsdBytes, 16)) {
        const found = readV2(stsdBytes.subarray(entry.start, entry.end));
        if (found) return found;
      }
    }
    break;
  }
  return null;
}

/** Spherical metadata of an MP4 / MOV file, or null (not spherical, or not an ISO base media file). Reads only the moov box. */
export async function readSphericalMetadata(reader: ByteReader): Promise<VrProperties | null> {
  try {
    const top = await scanTopLevel(reader);
    if (!top.moov || top.moov.end - top.moov.start > MAX_MOOV_BYTES) return null;
    return readSphericalFromMoov(await reader.read(top.moov.start, top.moov.end - top.moov.start));
  } catch {
    return null;
  }
}

/** Detect from a File / Blob; never throws. */
export async function detectSphericalMetadata(blob: Blob): Promise<VrProperties | null> {
  if (typeof blob.slice !== "function") return null;
  return readSphericalMetadata(blobReader(blob));
}

