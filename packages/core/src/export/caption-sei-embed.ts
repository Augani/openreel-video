/**
 * File-level pass that writes CEA-608 captions into the H.264 stream of an existing MP4 / MOV
 * (see captions/cea608-sei.ts): every video sample whose frame has a caption byte pair gets an
 * A/53 cc_data SEI NAL unit.
 *
 * Nothing is re-encoded and nothing is re-muxed: the file's boxes are copied byte for byte, only
 * the captioned video samples grow (by 4 + 14 bytes), and the sample-size (stsz) and chunk-offset
 * (stco / co64) tables plus the mdat size are patched to match. Audio, edit lists, other tracks,
 * metadata and the picture are therefore bit-identical to the input. Only non-fragmented files are
 * handled (what the editor's exporters write).
 *
 * A frame's caption pair rides in that frame's own sample, and the frame is identified by its
 * presentation time (decode time + composition offset - edit-list start), so B-frame reordering
 * does not move captions.
 */
import {
  avcLengthSize,
  buildCea608SeiNal,
  insertSeiIntoAvccSample,
  sccToFrameSchedule,
} from "../captions/cea608-sei";

export interface EmbedCea608Options {
  /** The finished MP4 / MOV (H.264 video, optional audio). */
  source: Blob;
  /** SCC text for the caption track (see captions/scc.ts `exportScc`). */
  scc: string;
  /** Frame rate of the video; 29.97 or 30. */
  frameRate: number;
  /** Subtracted from the SCC times (a 01:00:00;00 SCC start maps to frame 0). */
  offsetSeconds?: number;
}

export interface EmbedCea608Result {
  readonly blob: Blob;
  /** Video frames that now carry caption data. */
  readonly framesWithCaptions: number;
  readonly videoFrames: number;
  readonly warnings: string[];
}

export class CaptionSeiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptionSeiError";
  }
}

interface Box {
  readonly type: string;
  readonly start: number;
  readonly headerSize: number;
  readonly end: number;
}

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (at + 16 > end) throw new CaptionSeiError("The MP4 file is truncated.");
      size = Number(view.getBigUint64(at + 8));
      headerSize = 16;
    } else if (size === 0) size = end - at;
    if (size < headerSize || at + size > end) throw new CaptionSeiError("The MP4 file has an invalid box size.");
    boxes.push({ type, start: at, headerSize, end: at + size });
    at += size;
  }
  return boxes;
}

const child = (bytes: Uint8Array, parent: Box, type: string): Box | undefined =>
  readBoxes(bytes, parent.start + parent.headerSize, parent.end).find((box) => box.type === type);

interface TrackTables {
  handler: string;
  mediaTimescale: number;
  /** Where the tables live in the moov copy (absolute positions in the moov bytes). */
  stsz?: Box;
  stco?: Box;
  co64?: Box;
  sampleCount: number;
  sampleSizes: number[];
  chunkOffsets: number[];
  samplesPerChunk: number[];
  sampleOffsets: number[];
  /** Presentation seconds per sample (video only). */
  presentation: number[];
  lengthSize: number;
  isAvc: boolean;
}

function parseTrack(moov: Uint8Array, trak: Box, movieTimescale: number): TrackTables {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const mdia = child(moov, trak, "mdia");
  const hdlr = mdia && child(moov, mdia, "hdlr");
  const mdhd = mdia && child(moov, mdia, "mdhd");
  const minf = mdia && child(moov, mdia, "minf");
  const stbl = minf && child(moov, minf, "stbl");
  if (!mdia || !hdlr || !mdhd || !stbl) throw new CaptionSeiError("The MP4 file has an incomplete track.");
  const handler = ascii(moov, hdlr.start + hdlr.headerSize + 8, 4);
  const mdhdBody = mdhd.start + mdhd.headerSize;
  const mediaTimescale = view.getUint32(mdhdBody + (moov[mdhdBody] === 1 ? 20 : 12));
  const tables: TrackTables = {
    handler, mediaTimescale, sampleCount: 0, sampleSizes: [], chunkOffsets: [], samplesPerChunk: [], sampleOffsets: [],
    presentation: [], lengthSize: 4, isAvc: false,
  };
  const boxes = readBoxes(moov, stbl.start + stbl.headerSize, stbl.end);
  const find = (type: string) => boxes.find((box) => box.type === type);
  const stsz = find("stsz");
  const stco = find("stco");
  const co64 = find("co64");
  const stsc = find("stsc");
  const stts = find("stts");
  const ctts = find("ctts");
  const stsd = find("stsd");
  if (!stsz || (!stco && !co64) || !stsc || !stts) throw new CaptionSeiError("The MP4 file has no sample tables (fragmented files are not supported).");
  tables.stsz = stsz;
  tables.stco = stco;
  tables.co64 = co64;
  // Untrusted counts: every table must fit inside its own box, and a sample is at least one byte.
  const within = (box: Box, headerBytes: number, count: number, entryBytes: number): void => {
    if (!Number.isSafeInteger(count) || box.start + box.headerSize + headerBytes + count * entryBytes > box.end) {
      throw new CaptionSeiError("The MP4 sample tables are corrupt (a table is larger than its box).");
    }
  };
  const maxSamples = moov.length * 64 + 1_000_000;

  // sample sizes
  const szBody = stsz.start + stsz.headerSize;
  const constant = view.getUint32(szBody + 4);
  tables.sampleCount = view.getUint32(szBody + 8);
  if (constant !== 0) {
    if (tables.sampleCount > maxSamples) throw new CaptionSeiError("The MP4 sample tables are corrupt (implausible sample count).");
  } else within(stsz, 12, tables.sampleCount, 4);
  if (handler === "vide" && constant !== 0) throw new CaptionSeiError("The video track uses a constant sample size and cannot hold captions.");
  for (let i = 0; i < tables.sampleCount; i++) tables.sampleSizes.push(constant !== 0 ? constant : view.getUint32(szBody + 12 + i * 4));

  // chunk offsets
  const cBox = (stco ?? co64)!;
  const cBody = cBox.start + cBox.headerSize;
  const chunkCount = view.getUint32(cBody + 4);
  within(cBox, 8, chunkCount, stco ? 4 : 8);
  for (let i = 0; i < chunkCount; i++) {
    tables.chunkOffsets.push(stco ? view.getUint32(cBody + 8 + i * 4) : Number(view.getBigUint64(cBody + 8 + i * 8)));
  }

  // samples per chunk
  const scBody = stsc.start + stsc.headerSize;
  const runs = view.getUint32(scBody + 4);
  within(stsc, 8, runs, 12);
  const runList: Array<{ first: number; per: number }> = [];
  for (let i = 0; i < runs; i++) runList.push({ first: view.getUint32(scBody + 8 + i * 12), per: view.getUint32(scBody + 12 + i * 12) });
  for (let chunk = 1; chunk <= chunkCount; chunk++) {
    let per = 0;
    for (const run of runList) if (run.first <= chunk) per = run.per;
    tables.samplesPerChunk.push(per);
  }
  let sample = 0;
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    let at = tables.chunkOffsets[chunk];
    for (let n = 0; n < tables.samplesPerChunk[chunk] && sample < tables.sampleCount; n++, sample++) {
      tables.sampleOffsets.push(at);
      at += tables.sampleSizes[sample];
    }
  }
  if (tables.sampleOffsets.length !== tables.sampleCount) throw new CaptionSeiError("The MP4 sample tables are inconsistent.");

  if (handler === "vide") {
    if (!stsd) throw new CaptionSeiError("The video track has no sample description.");
    const entry = readBoxes(moov, stsd.start + stsd.headerSize + 8, stsd.end)[0];
    if (!entry || (entry.type !== "avc1" && entry.type !== "avc3")) {
      throw new CaptionSeiError(`CEA-608 in the video stream needs H.264 (AVC) video; this file's video is "${entry?.type ?? "unknown"}".`);
    }
    tables.isAvc = true;
    const avcC = readBoxes(moov, entry.start + entry.headerSize + 78, entry.end).find((box) => box.type === "avcC");
    if (!avcC) throw new CaptionSeiError("The H.264 configuration (avcC) is missing.");
    tables.lengthSize = avcLengthSize(moov.subarray(avcC.start + avcC.headerSize, avcC.end));

    // decode times
    const sttsBody = stts.start + stts.headerSize;
    const sttsCount = view.getUint32(sttsBody + 4);
    within(stts, 8, sttsCount, 8);
    const dts: number[] = [];
    let t = 0;
    for (let i = 0; i < sttsCount; i++) {
      const count = Math.min(view.getUint32(sttsBody + 8 + i * 8), tables.sampleCount - dts.length);
      const delta = view.getUint32(sttsBody + 12 + i * 8);
      for (let n = 0; n < count; n++) {
        dts.push(t);
        t += delta;
      }
    }
    const cto = new Array<number>(dts.length).fill(0);
    if (ctts) {
      const body = ctts.start + ctts.headerSize;
      const signed = moov[body] === 1;
      const count = view.getUint32(body + 4);
      within(ctts, 8, count, 8);
      let at = 0;
      for (let i = 0; i < count; i++) {
        const n = view.getUint32(body + 8 + i * 8);
        const offset = signed ? view.getInt32(body + 12 + i * 8) : view.getUint32(body + 12 + i * 8);
        for (let k = 0; k < n && at < cto.length; k++) cto[at++] = offset;
      }
    }
    // edit list: leading empty edit delays the track, the first real edit starts the media at media_time
    let mediaStart = 0;
    let delay = 0;
    const edts = child(moov, trak, "edts");
    const elst = edts && child(moov, edts, "elst");
    if (elst) {
      const body = elst.start + elst.headerSize;
      const v1 = moov[body] === 1;
      const entries = view.getUint32(body + 4);
      const stride = v1 ? 20 : 12;
      for (let i = 0; i < entries; i++) {
        const base = body + 8 + i * stride;
        const duration = v1 ? Number(view.getBigUint64(base)) : view.getUint32(base);
        const mediaTime = v1 ? Number(view.getBigInt64(base + 8)) : view.getInt32(base + 4);
        if (mediaTime === -1) delay += duration / movieTimescale;
        else {
          mediaStart = mediaTime / mediaTimescale;
          break;
        }
      }
    }
    tables.presentation = dts.map((value, i) => (value + cto[i]) / mediaTimescale - mediaStart + delay);
  }
  return tables;
}

export async function embedCea608Sei(options: EmbedCea608Options): Promise<EmbedCea608Result> {
  const schedule = sccToFrameSchedule(options.scc, { frameRate: options.frameRate, offsetSeconds: options.offsetSeconds });
  if (schedule.pairCount === 0) throw new CaptionSeiError("The caption track has no CEA-608 data to embed.");
  const warnings = [...schedule.warnings];
  const file = new Uint8Array(await options.source.arrayBuffer());
  const top = readBoxes(file, 0, file.length);
  if (top.some((box) => box.type === "moof")) throw new CaptionSeiError("Fragmented MP4 files are not supported; export a regular MP4 or MOV.");
  const moovBox = top.find((box) => box.type === "moov");
  if (!moovBox || !top.some((box) => box.type === "mdat")) throw new CaptionSeiError("This is not an MP4 / MOV file with a movie header and media data.");

  const moov = file.slice(moovBox.start, moovBox.end);
  const moovView = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const moovRoot: Box = { type: "moov", start: 0, headerSize: moovBox.headerSize, end: moov.length };
  const mvhd = child(moov, moovRoot, "mvhd");
  if (!mvhd) throw new CaptionSeiError("The movie header (mvhd) is missing.");
  const mvhdBody = mvhd.start + mvhd.headerSize;
  const movieTimescale = moovView.getUint32(mvhdBody + (moov[mvhdBody] === 1 ? 20 : 12));
  const traks = readBoxes(moov, moovRoot.start + moovRoot.headerSize, moovRoot.end).filter((box) => box.type === "trak");
  const tracks = traks.map((trak) => ({ trak, tables: parseTrack(moov, trak, movieTimescale) }));
  const videos = tracks.filter((entry) => entry.tables.handler === "vide");
  if (videos.length !== 1) throw new CaptionSeiError(`Expected one video track, found ${videos.length}.`);
  const video = videos[0].tables;
  const fps = schedule.rate.fps;

  // 1. new bytes for every captioned video sample
  interface Edit { offset: number; oldLength: number; bytes: Uint8Array; sample: number }
  const edits: Edit[] = [];
  for (let i = 0; i < video.sampleCount; i++) {
    const pair = schedule.pairs.get(Math.round(video.presentation[i] * fps));
    if (!pair) continue;
    const offset = video.sampleOffsets[i];
    const old = file.subarray(offset, offset + video.sampleSizes[i]);
    const next = insertSeiIntoAvccSample(old, video.lengthSize, buildCea608SeiNal([pair]));
    if (next === old) continue;
    edits.push({ offset, oldLength: old.length, bytes: next, sample: i });
  }
  if (edits.length === 0) throw new CaptionSeiError("No video frame matched a caption byte pair; the captions start after the end of the video.");
  if (edits.length < schedule.pairCount) warnings.push(`${schedule.pairCount - edits.length} caption byte pair(s) fall outside the video and were not embedded.`);
  edits.sort((a, b) => a.offset - b.offset);

  // 2. absolute offset mapping: every byte after an edit moves by the bytes added before it
  const starts = edits.map((edit) => edit.offset);
  const cumulative: number[] = [];
  let added = 0;
  for (const edit of edits) {
    added += edit.bytes.length - edit.oldLength;
    cumulative.push(added);
  }
  const mapOffset = (offset: number): number => {
    // number of edits that start at or before `offset` (an edit's own start maps to the same place)
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return offset + (lo === 0 ? 0 : cumulative[lo - 1]);
  };

  // 3. patch the moov copy: video sample sizes, then every track's chunk offsets
  const view = moovView;
  const sizeBody = video.stsz!.start + video.stsz!.headerSize;
  for (const edit of edits) view.setUint32(sizeBody + 12 + edit.sample * 4, edit.bytes.length);
  for (const { tables } of tracks) {
    const box = (tables.stco ?? tables.co64)!;
    const body = box.start + box.headerSize;
    tables.chunkOffsets.forEach((offset, i) => {
      const mapped = mapOffset(offset);
      if (tables.stco) {
        if (mapped > 0xffffffff) throw new CaptionSeiError("The captioned file would exceed 4 GB; use a 64-bit (co64) MP4.");
        view.setUint32(body + 8 + i * 4, mapped);
      } else view.setBigUint64(body + 8 + i * 8, BigInt(mapped));
    });
  }

  // 4. write the file: boxes in order, mdat payloads with the edits applied
  const total = file.length + added;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  let at = 0;
  let editIndex = 0;
  for (const box of top) {
    if (box.type === "moov") {
      out.set(moov, at);
      at += moov.length;
      continue;
    }
    if (box.type !== "mdat") {
      out.set(file.subarray(box.start, box.end), at);
      at += box.end - box.start;
      continue;
    }
    const boxStart = at;
    let source = box.start;
    while (editIndex < edits.length && edits[editIndex].offset < box.end) {
      const edit = edits[editIndex++];
      out.set(file.subarray(source, edit.offset), at);
      at += edit.offset - source;
      out.set(edit.bytes, at);
      at += edit.bytes.length;
      source = edit.offset + edit.oldLength;
    }
    out.set(file.subarray(source, box.end), at);
    at += box.end - source;
    const size = at - boxStart;
    if (box.headerSize === 16) outView.setBigUint64(boxStart + 8, BigInt(size));
    else if (size > 0xffffffff) throw new CaptionSeiError("The captioned media data would exceed 4 GB.");
    else outView.setUint32(boxStart, size);
  }
  if (at !== total) throw new CaptionSeiError("Internal error: the captioned file length does not add up.");

  const ftyp = top.find((box) => box.type === "ftyp");
  const isMov = !!ftyp && ascii(file, ftyp.start + 8, 4) === "qt  ";
  return {
    blob: new Blob([out], { type: isMov ? "video/quicktime" : "video/mp4" }),
    framesWithCaptions: edits.length,
    videoFrames: video.sampleCount,
    warnings,
  };
}
