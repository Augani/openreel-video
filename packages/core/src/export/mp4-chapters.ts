import { box, children, duration, timescale } from "./mp4-audio-timing";
import { deliveryChapters, type ChapterRange } from "./chapters";
import type { Marker } from "../types/timeline";

const utf8 = new TextEncoder();
const uint32 = (...words: number[]) => {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word));
  return bytes;
};
const uint64 = (value: number) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
};
const matrix = uint32(65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000);

/** Add a QuickTime chapter track. Only the trailing movie header moves. Audio/video samples and offsets stay in place. */
export function addChapterTrack(movie: Uint8Array, position: number, markers: readonly Marker[], range?: ChapterRange): Uint8Array[] {
  const atoms = children(movie);
  const header = atoms.find((a) => a.type === "mvhd")?.bytes;
  if (!header) throw new Error("Missing MP4 movie header for chapters.");
  const scale = timescale(header);
  const seconds = duration(header) / scale;
  const chapters = deliveryChapters(markers, seconds + (range?.startTime ?? 0), range);
  if (!chapters.length) return [movie];

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const nextId = view.getUint32(header.length - 4);
  view.setUint32(header.length - 4, nextId + 1);
  const samples = chapters.map(({ title }) => {
    const label = utf8.encode(title);
    if (label.length > 65535) throw new Error("Shorten the chapter title to fit the QuickTime text format.");
    const sample = new Uint8Array(label.length + 2);
    new DataView(sample.buffer).setUint16(0, label.length);
    sample.set(label, 2);
    return sample;
  });
  const data = box("mdat", samples);
  const firstMs = Math.round(chapters[0].start * 1000);
  const durationMs = Math.round(seconds * 1000);
  // Version 1 headers and chunk offsets also handle long timelines and files larger than 4 GiB.
  const tkhd = box("tkhd", [uint32(0x01000002, 0, 0, 0, 0, nextId, 0), uint64(duration(header)), new Uint8Array(16), matrix, uint32(0, 0)]);
  const mdhd = box("mdhd", [uint32(0x01000000, 0, 0, 0, 0, 1000), uint64(durationMs), uint32(0x55c40000)]);
  const hdlr = box("hdlr", [uint32(0, 0), utf8.encode("text"), new Uint8Array(12), utf8.encode("Chapters\0")]);
  const gmhd = box("gmhd", [box("gmin", [uint32(0, 0x00408000, 0x80008000, 0)]), box("text", [matrix])]);
  const dinf = box("dinf", [box("dref", [uint32(0, 1), box("url ", [uint32(1)])])]);
  const style = new Uint8Array(43);
  style[7] = 1; // self-contained data reference
  style[11] = 1; // display flags
  const entry = box("text", [style]);
  // Pad the last text sample by the leading gap. The edit list clips it to the movie end.
  // Readers that derive the last chapter end from the media duration then agree with QuickTime.
  const deltas = chapters.map((c, i) => {
    const padding = i === chapters.length - 1 ? firstMs : 0;
    return uint32(1, Math.round(c.end * 1000) - Math.round(c.start * 1000) + padding);
  });
  const stts = box("stts", [uint32(0, chapters.length), ...deltas]);
  const stbl = box("stbl", [
    box("stsd", [uint32(0, 1), entry]), stts,
    box("stsc", [uint32(0, 1, 1, samples.length, 1)]),
    box("stsz", [uint32(0, 0, samples.length), ...samples.map((s) => uint32(s.length))]),
    box("co64", [uint32(0, 1), uint64(position + 8)]),
  ]);
  const mdia = box("mdia", [mdhd, hdlr, box("minf", [gmhd, dinf, stbl])]);
  const initialDelay = Math.round(chapters[0].start * scale);
  const edits = initialDelay ? [box("edts", [box("elst", [
    uint32(0x01000000, 2), uint64(initialDelay), uint32(0xffffffff, 0xffffffff, 65536),
    uint64(duration(header) - initialDelay), uint64(0), uint32(65536),
  ])])] : [];

  const chap = box("chap", [uint32(nextId)]);
  const tracks = atoms.map((a) => {
    if (a.type !== "trak") return a.bytes;
    const parts = children(a.bytes);
    const mdia = parts.find((part) => part.type === "mdia");
    const handler = mdia && children(mdia.bytes).find((part) => part.type === "hdlr");
    const kind = handler && new TextDecoder().decode(handler.bytes.subarray(16, 20));
    if (kind !== "vide" && kind !== "soun") return a.bytes;
    const tref = parts.find((part) => part.type === "tref");
    if (tref) tref.bytes = box("tref", [...children(tref.bytes).map((c) => c.bytes), chap]);
    else parts.push({ type: "tref", bytes: box("tref", [chap]) });
    return box("trak", parts.map((part) => part.bytes));
  });
  return [data, box("moov", [...tracks, box("trak", [tkhd, ...edits, mdia])])];
}
