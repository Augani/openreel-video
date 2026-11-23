import { describe, expect, it } from "vitest";
import {
  XMP_NS,
  XMP_UUID,
  applyXmpFields,
  describeMediaMetadata,
  extractXmpFromIsoBmff,
  extractXmpFromJpeg,
  mediaFieldsToXmpFields,
  mergeXmpFields,
  parseKeywordText,
  parseXmp,
  readEmbeddedXmpPacket,
  readXmpFields,
  scanForXmpPacket,
  serializeXmp,
  sidecarXmpName,
  xmpFieldsFromPackets,
  xmpFieldsToMediaFields,
  type XmpByteReader,
} from "./xmp";

const PREMIERE_PACKET = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:custom="urn:example:custom#"
    xmpDM:scene="12A"
    xmpDM:shotName="Wide &amp; low"
    xmpDM:takeNumber="3"
    xmpDM:good="True"
    xmp:Rating="4">
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Hero walks in</rdf:li><rdf:li xml:lang="fr">Le heros entre</rdf:li></rdf:Alt></dc:description>
   <dc:subject><rdf:Bag><rdf:li>interior</rdf:li><rdf:li>night</rdf:li><rdf:li>Night</rdf:li></rdf:Bag></dc:subject>
   <dc:creator><rdf:Seq><rdf:li>Ada</rdf:li><rdf:li>Grace</rdf:li></rdf:Seq></dc:creator>
   <xmpDM:logComment>Use the second half &lt;best&gt;</xmpDM:logComment>
   <xmpDM:tapeName>A007</xmpDM:tapeName>
   <custom:rig rdf:parseType="Resource"><custom:lens>35mm</custom:lens><custom:stops><rdf:Seq><rdf:li>2.8</rdf:li></rdf:Seq></custom:stops></custom:rig>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

describe("XMP parse", () => {
  it("reads attribute and element forms, Alt / Bag / Seq arrays and entities", () => {
    const doc = parseXmp(PREMIERE_PACKET)!;
    expect(doc).not.toBeNull();
    const fields = readXmpFields(doc);
    expect(fields).toEqual({
      description: "Hero walks in",
      creator: "Ada, Grace",
      keywords: ["interior", "night"],
      scene: "12A",
      shot: "Wide & low",
      take: "3",
      good: true,
      logComment: "Use the second half <best>",
      reel: "A007",
    });
  });

  it("keeps namespaces it does not know, including structs", () => {
    const doc = parseXmp(PREMIERE_PACKET)!;
    const rig = doc.properties.find((p) => p.ns === "urn:example:custom#" && p.name === "rig")!;
    expect(rig.value.kind).toBe("struct");
    expect(doc.prefixes["urn:example:custom#"]).toBe("custom");
    expect(doc.properties.find((p) => p.ns === XMP_NS.xmp && p.name === "Rating")).toBeDefined();
  });

  it("returns null for text without RDF", () => {
    expect(parseXmp("<root/>")).toBeNull();
    expect(parseXmp("not xml")).toBeNull();
  });
});

describe("XMP serialize round trip", () => {
  it("parse -> serialize -> parse is stable and keeps unknown properties", () => {
    const first = parseXmp(PREMIERE_PACKET)!;
    const written = serializeXmp(first);
    expect(written.startsWith("<?xpacket begin=")).toBe(true);
    expect(written).toContain("<rdf:Bag>");
    expect(written).toContain("<rdf:Seq>");
    expect(written).toContain("<rdf:Alt>");
    expect(written).toContain('xmlns:custom="urn:example:custom#"');
    const second = parseXmp(written)!;
    expect(readXmpFields(second)).toEqual(readXmpFields(first));
    expect(second.properties.length).toBe(first.properties.length);
    const rig = second.properties.find((p) => p.name === "rig")!;
    expect(JSON.stringify(rig.value)).toContain("35mm");
    // Serializing the reparsed document is byte-identical.
    expect(serializeXmp(second)).toBe(written);
  });

  it("preserves language alternatives", () => {
    const doc = parseXmp(serializeXmp(parseXmp(PREMIERE_PACKET)!))!;
    const description = doc.properties.find((p) => p.name === "description")!.value;
    expect(description.kind === "array" && description.items.map((i) => (i.kind === "text" ? i.lang : ""))).toEqual(["x-default", "fr"]);
  });

  it("escapes markup in values", () => {
    const doc = applyXmpFields(null, { description: 'a < b & "c"', keywords: ["x&y"] });
    const reread = readXmpFields(parseXmp(serializeXmp(doc))!);
    expect(reread.description).toBe('a < b & "c"');
    expect(reread.keywords).toEqual(["x&y"]);
  });

  it("writes a new document with every edited field", () => {
    const doc = applyXmpFields(null, { description: "d", keywords: ["a", "b"], scene: "1", shot: "2", take: "3", good: true, logComment: "note", reel: "R1", title: "T", creator: "A, B", rights: "(c)" });
    const out = serializeXmp(doc);
    expect(out).toContain("xmlns:xmpDM=");
    expect(out).toContain("<xmpDM:tapeName>R1</xmpDM:tapeName>");
    expect(readXmpFields(parseXmp(out)!)).toEqual({ title: "T", description: "d", creator: "A, B", rights: "(c)", keywords: ["a", "b"], scene: "1", shot: "2", take: "3", good: true, logComment: "note", reel: "R1" });
  });

  it("applying fields edits only those properties and keeps the rest", () => {
    const base = parseXmp(PREMIERE_PACKET)!;
    const next = applyXmpFields(base, { keywords: ["alpha"], scene: "" });
    const fields = readXmpFields(next);
    expect(fields.keywords).toEqual(["alpha"]);
    expect(fields.scene).toBeUndefined();
    expect(fields.reel).toBe("A007");
    expect(next.properties.some((p) => p.name === "rig")).toBe(true);
    // The input is not mutated.
    expect(readXmpFields(base).keywords).toEqual(["interior", "night"]);
  });
});

describe("XMP packet finders", () => {
  const enc = new TextEncoder();
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const u32 = (n: number): Uint8Array => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
    const body = concat(...payload);
    return concat(u32(8 + body.length), enc.encode(type), body);
  };
  const reader = (bytes: Uint8Array): XmpByteReader => ({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) });

  it("finds the packet in a JPEG APP1 segment", () => {
    const header = enc.encode("http://ns.adobe.com/xap/1.0/\0");
    const packet = enc.encode(PREMIERE_PACKET);
    const length = 2 + header.length + packet.length;
    const app0 = Uint8Array.from([0xff, 0xe0, 0, 4, 0, 0]);
    const jpeg = concat(Uint8Array.from([0xff, 0xd8]), app0, Uint8Array.from([0xff, 0xe1, length >> 8, length & 255]), header, packet, Uint8Array.from([0xff, 0xd9]));
    const found = extractXmpFromJpeg(jpeg)!;
    expect(readXmpFields(parseXmp(found)!).scene).toBe("12A");
  });

  it("finds the uuid box of an MP4 after mdat", async () => {
    const mp4 = concat(box("ftyp", enc.encode("isom"), u32(0)), box("mdat", new Uint8Array(40)), box("uuid", XMP_UUID, enc.encode(PREMIERE_PACKET)));
    const found = (await extractXmpFromIsoBmff(reader(mp4)))!;
    expect(readXmpFields(parseXmp(found)!).keywords).toEqual(["interior", "night"]);
  });

  it("finds an XMP_ atom inside moov/udta (QuickTime)", async () => {
    const mov = concat(box("ftyp", enc.encode("qt  "), u32(0)), box("moov", box("udta", box("XMP_", enc.encode(PREMIERE_PACKET)))));
    const found = (await readEmbeddedXmpPacket("clip.mov", reader(mov)))!;
    expect(readXmpFields(parseXmp(found)!).reel).toBe("A007");
  });

  it("returns null when an MP4 has no XMP", async () => {
    const mp4 = concat(box("ftyp", enc.encode("isom"), u32(0)), box("mdat", new Uint8Array(16)));
    expect(await extractXmpFromIsoBmff(reader(mp4))).toBeNull();
  });

  it("scans other containers for a packet", async () => {
    const wav = concat(enc.encode("RIFF....WAVEdata"), new Uint8Array(32), enc.encode(PREMIERE_PACKET));
    expect(scanForXmpPacket(wav)).toContain("xmpDM:scene");
    expect((await readEmbeddedXmpPacket("take.wav", reader(wav)))!).toContain("xmpmeta");
  });

  it("merges embedded and sidecar fields, the sidecar winning field by field and replacing the keywords", () => {
    const sidecar = serializeXmp(applyXmpFields(null, { scene: "99", keywords: ["extra", "night"] }));
    const fields = xmpFieldsFromPackets(PREMIERE_PACKET, sidecar)!;
    expect(fields.scene).toBe("99");
    expect(fields.shot).toBe("Wide & low");
    expect(fields.keywords).toEqual(["extra", "night"]);
    expect(xmpFieldsFromPackets(null, null)).toBeNull();
  });
});

describe("XMP helpers", () => {
  it("names the sidecar after the media", () => {
    expect(sidecarXmpName("A001_C002.mov")).toBe("A001_C002.xmp");
    expect(sidecarXmpName("noext")).toBe("noext.xmp");
    expect(sidecarXmpName("a.b.mp4")).toBe("a.b.xmp");
  });

  it("parses keyword text", () => {
    expect(parseKeywordText("Night, interior;  night\nstreet  lamp")).toEqual(["Night", "interior", "street lamp"]);
  });

  it("maps XMP to media fields and back", () => {
    const fields = readXmpFields(parseXmp(PREMIERE_PACKET)!);
    const media = xmpFieldsToMediaFields(fields);
    expect(media).toMatchObject({ description: "Hero walks in", scene: "12A", shot: "Wide & low", take: "3", goodTake: true, reel: "A007" });
    const back = mediaFieldsToXmpFields(media);
    expect(back.good).toBe(true);
    expect(back.keywords).toEqual(["interior", "night"]);
    expect(mergeXmpFields({ scene: "1" }, { scene: "2", shot: "s" })).toEqual({ scene: "2", shot: "s" });
  });

  it("describes metadata for exports", () => {
    expect(describeMediaMetadata({ description: "d", keywords: ["a", "b"], scene: "1", take: "2", goodTake: true, reel: "R", logComment: "c" })).toEqual([
      "Description: d",
      "Keywords: a, b",
      "Scene 1 / Take 2 / Good take",
      "Reel: R",
      "Log comment: c",
    ]);
    expect(describeMediaMetadata({})).toEqual([]);
  });

  it("keeps other-language alternatives when the default description is edited or unchanged", () => {
    const source = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:d="http://purl.org/dc/elements/1.1/"><d:description><rdf:Alt><rdf:li xml:lang="de">Beschreibung</rdf:li><rdf:li xml:lang="x-default">Desc</rdf:li></rdf:Alt></d:description></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const doc = parseXmp(source)!;
    const same = serializeXmp(applyXmpFields(doc, { description: "Desc" }));
    expect(same).toContain("Beschreibung");
    expect(same.match(/<rdf:li/g)).toHaveLength(2);
    const edited = serializeXmp(applyXmpFields(doc, { description: "New" }));
    expect(edited).toContain("Beschreibung");
    expect(readXmpFields(parseXmp(edited)!).description).toBe("New");
  });

  it("a sidecar's keywords replace the embedded ones instead of being unioned", () => {
    const packet = (words: string[]) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag>${words.map((w) => `<rdf:li>${w}</rdf:li>`).join("")}</rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
    expect(xmpFieldsFromPackets(packet(["a", "b"]), packet(["z"]))?.keywords).toEqual(["z"]);
    expect(xmpFieldsFromPackets(packet(["a", "b"]), null)?.keywords).toEqual(["a", "b"]);
  });
});
