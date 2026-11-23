import { describe, expect, it } from "vitest";
import {
  addSphericalMetadataToBlob,
  applySphericalToMoov,
  blobReader,
  buildSphericalBoxes,
  buildSphericalV1Box,
  buildSphericalV1Xml,
  parseSphericalV1Xml,
  planSphericalPatch,
  readSphericalFromMoov,
  readSphericalMetadata,
  shiftChunkOffsets,
} from "./spherical-metadata";

const enc = new TextEncoder();
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(enc.encode(type), 4);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u32 = (...v: number[]): Uint8Array => { const b = new Uint8Array(v.length * 4); v.forEach((x, i) => new DataView(b.buffer).setUint32(i * 4, x)); return b; };

function videoTrak(chunkOffsets: number[]): Uint8Array {
  const hdlr = box("hdlr", u32(0, 0), enc.encode("vide"), new Uint8Array(13));
  const avc1 = box("avc1", new Uint8Array(78), box("avcC", new Uint8Array([1, 100, 0, 31, 0xff])));
  const stsd = box("stsd", u32(0, 1), avc1);
  const stco = box("stco", u32(0, chunkOffsets.length, ...chunkOffsets));
  return box("trak", box("tkhd", new Uint8Array(84)), box("mdia", box("mdhd", new Uint8Array(24)), hdlr, box("minf", box("stbl", stsd, stco))));
}
function audioTrak(chunkOffsets: number[]): Uint8Array {
  const hdlr = box("hdlr", u32(0, 0), enc.encode("soun"), new Uint8Array(13));
  const mp4a = box("mp4a", new Uint8Array(28));
  return box("trak", box("mdia", hdlr, box("minf", box("stbl", box("stsd", u32(0, 1), mp4a), box("stco", u32(0, chunkOffsets.length, ...chunkOffsets))))));
}
const moovOf = (v: number[], a: number[]): Uint8Array => box("moov", box("mvhd", new Uint8Array(100)), videoTrak(v), audioTrak(a));

describe("spherical metadata boxes", () => {
  it("builds st3d and sv3d (svhd, proj > prhd, equi)", () => {
    const { st3d, sv3d } = buildSphericalBoxes({ projection: "equirectangular", layout: "over-under", horizontalFov: 360, verticalFov: 180 });
    expect(st3d.length).toBe(13);
    expect(st3d[12]).toBe(1);
    const text = new TextDecoder("latin1").decode(sv3d);
    for (const tag of ["sv3d", "svhd", "proj", "prhd", "equi"]) expect(text).toContain(tag);
  });

  it("round trips layout and field of view through a moov", () => {
    for (const layout of ["mono", "over-under", "side-by-side"] as const) {
      const out = applySphericalToMoov(moovOf([100], [200]), { projection: "equirectangular", layout, horizontalFov: 180, verticalFov: 120 });
      const back = readSphericalFromMoov(out);
      expect(back?.layout).toBe(layout);
      expect(back?.horizontalFov).toBeCloseTo(180, 3);
      expect(back?.verticalFov).toBeCloseTo(120, 3);
      expect(back?.source).toBe("metadata");
    }
  });

  it("tags only the video track and replaces earlier spherical boxes", () => {
    const once = applySphericalToMoov(moovOf([100], [200]), { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 });
    const twice = applySphericalToMoov(once, { projection: "equirectangular", layout: "side-by-side", horizontalFov: 360, verticalFov: 180 });
    // V1 XML text length depends on the stereo mode name, so only the box counts are stable.
    expect(readSphericalFromMoov(twice)?.layout).toBe("side-by-side");
    const text = new TextDecoder("latin1").decode(twice);
    expect(text.split("sv3d").length - 1).toBe(1);
    // The size fields of the ancestors stay consistent: every box tiles its parent exactly.
    const check = (bytes: Uint8Array, from: number, to: number, containers: Set<string>): void => {
      let o = from;
      while (o < to) {
        const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(o);
        const type = new TextDecoder().decode(bytes.subarray(o + 4, o + 8));
        expect(size).toBeGreaterThanOrEqual(8);
        if (containers.has(type)) check(bytes, o + 8, o + size, containers);
        o += size;
      }
      expect(o).toBe(to);
    };
    check(twice, 0, twice.length, new Set(["moov", "trak", "mdia", "minf", "stbl"]));
  });

  it("shifts chunk offsets of every track", () => {
    const moov = moovOf([1000, 2000], [3000]);
    shiftChunkOffsets(moov, 77);
    const dv = new DataView(moov.buffer);
    const text = new TextDecoder("latin1").decode(moov);
    const first = text.indexOf("stco") + 4 + 8;
    expect(dv.getUint32(first)).toBe(1077);
    expect(dv.getUint32(first + 4)).toBe(2077);
  });

  it("parses the V1 XML", () => {
    const xml = `<rdf:SphericalVideo><GSpherical:Spherical>true</GSpherical:Spherical><GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType><GSpherical:StereoMode>top-bottom</GSpherical:StereoMode></rdf:SphericalVideo>`;
    expect(parseSphericalV1Xml(xml)).toMatchObject({ projection: "equirectangular", layout: "over-under", horizontalFov: 360 });
    expect(parseSphericalV1Xml("<x/>")).toBeNull();
  });
});

describe("file level patch", () => {
  it("shifts chunk offsets when moov precedes mdat and leaves them when it trails", async () => {
    const mdat = box("mdat", new Uint8Array(500));
    const ftyp = box("ftyp", enc.encode("isom"), u32(0), enc.encode("isom"));
    const vr = { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 } as const;

    // moov first: chunk offsets point after the moov and must grow with it.
    const front = box("moov", box("mvhd", new Uint8Array(100)), videoTrak([0]));
    const mdatStart = ftyp.length + front.length;
    const frontFixed = box("moov", box("mvhd", new Uint8Array(100)), videoTrak([mdatStart + 8]));
    const frontFile = new Blob([ftyp as BlobPart, frontFixed as BlobPart, mdat as BlobPart]);
    const frontOut = await addSphericalMetadataToBlob(frontFile, vr);
    const frontBytes = new Uint8Array(await frontOut.arrayBuffer());
    const text = new TextDecoder("latin1").decode(frontBytes);
    const stcoAt = text.indexOf("stco") + 4 + 8;
    const newMdat = text.indexOf("mdat") - 4;
    expect(new DataView(frontBytes.buffer).getUint32(stcoAt)).toBe(newMdat + 8);
    expect(await readSphericalMetadata(blobReader(frontOut))).toMatchObject({ layout: "mono", horizontalFov: 360 });

    // moov last: nothing moves.
    const back = box("moov", box("mvhd", new Uint8Array(100)), videoTrak([ftyp.length + 8]));
    const backFile = new Blob([ftyp as BlobPart, mdat as BlobPart, back as BlobPart]);
    const plan = await planSphericalPatch(blobReader(backFile), vr);
    expect(plan?.moovStart).toBe(ftyp.length + mdat.length);
    const backOut = new Uint8Array(await (await addSphericalMetadataToBlob(backFile, vr)).arrayBuffer());
    const t2 = new TextDecoder("latin1").decode(backOut);
    expect(new DataView(backOut.buffer).getUint32(t2.indexOf("stco") + 12)).toBe(ftyp.length + 8);
  });

  it("returns null for non-movies", async () => {
    expect(await readSphericalMetadata(blobReader(new Blob(["hello world, not an mp4 file"])))).toBeNull();
    expect(await planSphericalPatch(blobReader(new Blob(["hello world"])), { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180 })).toBeNull();
  });
});

describe("V1 spherical XML (uuid box) and the initial view direction", () => {
  const vr = { projection: "equirectangular", layout: "over-under", horizontalFov: 360, verticalFov: 180, initialView: { yaw: -35.5, pitch: 12.25, roll: 4 } } as const;
  const text = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);
  const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1;

  it("writes the pose into the sv3d prhd box as signed 16.16 fixed point", () => {
    const { sv3d } = buildSphericalBoxes(vr);
    const at = text(sv3d).indexOf("prhd");
    const dv = new DataView(sv3d.buffer, sv3d.byteOffset + at + 4);
    expect(dv.getInt32(4) / 65536).toBeCloseTo(-35.5, 4);
    expect(dv.getInt32(8) / 65536).toBeCloseTo(12.25, 4);
    expect(dv.getInt32(12) / 65536).toBeCloseTo(4, 4);
  });

  it("builds the V1 XML with stereo mode and the initial view", () => {
    const xml = buildSphericalV1Xml(vr);
    expect(xml).toContain("<GSpherical:Spherical>true</GSpherical:Spherical>");
    expect(xml).toContain("<GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType>");
    expect(xml).toContain("<GSpherical:StereoMode>top-bottom</GSpherical:StereoMode>");
    expect(xml).toContain("<GSpherical:InitialViewHeadingDegrees>-35.5</GSpherical:InitialViewHeadingDegrees>");
    expect(buildSphericalV1Xml({ ...vr, layout: "mono", initialView: undefined })).not.toContain("StereoMode");
    expect(parseSphericalV1Xml(xml)?.initialView).toEqual({ yaw: -35.5, pitch: 12.25, roll: 4 });
    // A partial sphere carries the cropped-area pixels (per eye).
    const partial = buildSphericalV1Xml({ ...vr, layout: "mono", horizontalFov: 180, verticalFov: 90 }, { width: 1000, height: 500 });
    expect(partial).toContain("<GSpherical:FullPanoWidthPixels>2000</GSpherical:FullPanoWidthPixels>");
    expect(partial).toContain("<GSpherical:CroppedAreaLeftPixels>500</GSpherical:CroppedAreaLeftPixels>");
    expect(parseSphericalV1Xml(partial)?.horizontalFov).toBeCloseTo(180, 6);
    expect(text(buildSphericalV1Box(vr)).startsWith("\0\0")).toBe(true);
  });

  it("applySphericalToMoov writes V2 and V1 once each on the video track only, and re-applying replaces them", () => {
    const once = applySphericalToMoov(moovOf([100], [200]), vr);
    const twice = applySphericalToMoov(once, { ...vr, initialView: { yaw: 90, pitch: 0, roll: 0 } });
    for (const out of [once, twice]) {
      const t = text(out);
      expect(countOf(t, "sv3d")).toBe(1);
      expect(countOf(t, "st3d")).toBe(1);
      expect(countOf(t, "GSpherical:Spherical>true")).toBe(1);
    }
    expect(readSphericalFromMoov(once)?.initialView).toEqual({ yaw: -35.5, pitch: 12.25, roll: 4 });
    expect(readSphericalFromMoov(twice)?.initialView).toEqual({ yaw: 90, pitch: 0, roll: 0 });
    // V1 only (an older file): the reader still finds the layout and the pose.
    const v1Only = box("moov", box("mvhd", new Uint8Array(100)), box("trak", box("mdia", box("hdlr", u32(0, 0), enc.encode("vide"), new Uint8Array(13))), buildSphericalV1Box(vr)));
    const read = readSphericalFromMoov(v1Only);
    expect(read?.layout).toBe("over-under");
    expect(read?.initialView).toEqual({ yaw: -35.5, pitch: 12.25, roll: 4 });
  });

  it("a straight-ahead view writes no pose fields in V1 and a zero pose in V2", () => {
    const flat = { ...vr, initialView: undefined };
    expect(buildSphericalV1Xml(flat)).not.toContain("InitialView");
    const out = applySphericalToMoov(moovOf([100], [200]), flat);
    expect(readSphericalFromMoov(out)?.initialView).toBeUndefined();
  });

  it("a patch keeps the chunk offsets consistent with the larger moov (V1 box included)", async () => {
    const moov = moovOf([2000], [3000]);
    const file = new Uint8Array(moov.length + 5000);
    file.set(moov, 0);
    file.set(box("mdat", new Uint8Array(4000)), moov.length);
    const plan = await planSphericalPatch(blobReader(new Blob([file as BlobPart])), vr);
    expect(plan).not.toBeNull();
    const growth = plan!.moov.length - moov.length;
    expect(growth).toBeGreaterThan(buildSphericalV1Box(vr).length);
    const stco = text(plan!.moov).indexOf("stco");
    expect(new DataView(plan!.moov.buffer, plan!.moov.byteOffset).getUint32(stco + 4 + 8 + 0)).toBe(2000 + growth);
  });
});
