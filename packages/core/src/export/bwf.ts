import { framesToSeconds, resolveFrameRate, timecodeToFrames } from "../interchange/timecode";

/**
 * Broadcast Wave (BWF) delivery: the `bext` chunk (EBU Tech 3285 v1) and the `iXML` chunk (iXML 1.5) written into a
 * finished PCM / float WAV. Pure byte code with a parser, so exports can be read back and verified.
 */

export interface BwfBextFields {
  /** Free text, 256 bytes max (ASCII). */
  readonly description: string;
  /** Who made the file, 32 bytes max. */
  readonly originator: string;
  /** Unique reference, 32 bytes max. */
  readonly originatorReference?: string;
  /** `YYYY-MM-DD`. */
  readonly originationDate: string;
  /** `HH:MM:SS`. */
  readonly originationTime: string;
  /** Sample count since midnight (the sequence start timecode in samples). */
  readonly timeReference: number;
  readonly codingHistory?: string;
}

export interface BwfIxmlTrack {
  /** 1-based channel of the WAV this entry describes. */
  readonly channelIndex: number;
  readonly name: string;
}

export interface BwfIxmlFields {
  readonly project: string;
  readonly note?: string;
  readonly tracks: readonly BwfIxmlTrack[];
  readonly sampleRate: number;
  /** Same sample count as `bext.timeReference`. */
  readonly timeReference: number;
  /** Names of the sequence's audio tracks that fed the mix (stored in a `<USER>` block). */
  readonly sourceTracks?: readonly string[];
  readonly startTimecode?: string;
  readonly frameRate?: number;
}

export const BEXT_FIXED_SIZE = 602;

const ascii = (text: string, max: number): Uint8Array => {
  const out = new Uint8Array(max);
  for (let i = 0; i < Math.min(text.length, max); i++) {
    const code = text.charCodeAt(i);
    out[i] = code >= 32 && code < 127 ? code : 63;
  }
  return out;
};

const readAscii = (bytes: Uint8Array, offset: number, length: number): string => {
  let end = offset;
  while (end < offset + length && bytes[end] !== 0) end++;
  return String.fromCharCode(...bytes.subarray(offset, end));
};

export function buildBextChunk(fields: BwfBextFields): Uint8Array {
  const history = ascii(fields.codingHistory ?? "", 4096);
  const historyLength = fields.codingHistory ? Math.min(fields.codingHistory.length, 4096) : 0;
  const out = new Uint8Array(BEXT_FIXED_SIZE + historyLength);
  const view = new DataView(out.buffer);
  out.set(ascii(fields.description, 256), 0);
  out.set(ascii(fields.originator, 32), 256);
  out.set(ascii(fields.originatorReference ?? "", 32), 288);
  out.set(ascii(fields.originationDate, 10), 320);
  out.set(ascii(fields.originationTime, 8), 330);
  const ref = Math.max(0, Math.floor(fields.timeReference));
  view.setUint32(338, ref % 0x100000000, true);
  view.setUint32(342, Math.floor(ref / 0x100000000), true);
  view.setUint16(346, 1, true); // version 1 (UMID and loudness fields follow, left unset)
  // 348..411 UMID, 412..421 loudness, 422..601 reserved: all zero.
  out.set(history.subarray(0, historyLength), BEXT_FIXED_SIZE);
  return out;
}

export function parseBextChunk(data: Uint8Array): BwfBextFields & { readonly version: number } {
  if (data.length < BEXT_FIXED_SIZE) throw new Error("bext chunk is shorter than 602 bytes");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    description: readAscii(data, 0, 256),
    originator: readAscii(data, 256, 32),
    originatorReference: readAscii(data, 288, 32),
    originationDate: readAscii(data, 320, 10),
    originationTime: readAscii(data, 330, 8),
    timeReference: view.getUint32(338, true) + view.getUint32(342, true) * 0x100000000,
    version: view.getUint16(346, true),
    codingHistory: readAscii(data, BEXT_FIXED_SIZE, data.length - BEXT_FIXED_SIZE),
  };
}

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);

export function buildIxmlChunk(fields: BwfIxmlFields): Uint8Array {
  const high = Math.floor(fields.timeReference / 0x100000000);
  const low = fields.timeReference % 0x100000000;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<BWFXML>",
    "<IXML_VERSION>1.5</IXML_VERSION>",
    `<PROJECT>${escapeXml(fields.project)}</PROJECT>`,
    ...(fields.note ? [`<NOTE>${escapeXml(fields.note)}</NOTE>`] : []),
    "<SPEED>",
    `<TIMESTAMP_SAMPLE_RATE>${fields.sampleRate}</TIMESTAMP_SAMPLE_RATE>`,
    `<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>${high}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>`,
    `<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>${low}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>`,
    ...(fields.startTimecode ? [`<TC_START>${escapeXml(fields.startTimecode)}</TC_START>`] : []),
    ...(fields.frameRate ? [`<TC_RATE>${fields.frameRate}</TC_RATE>`] : []),
    "</SPEED>",
    "<TRACK_LIST>",
    `<TRACK_COUNT>${fields.tracks.length}</TRACK_COUNT>`,
    ...fields.tracks.flatMap((t) => [
      "<TRACK>",
      `<CHANNEL_INDEX>${t.channelIndex}</CHANNEL_INDEX>`,
      `<INTERLEAVE_INDEX>${t.channelIndex}</INTERLEAVE_INDEX>`,
      `<NAME>${escapeXml(t.name)}</NAME>`,
      "</TRACK>",
    ]),
    "</TRACK_LIST>",
    ...(fields.sourceTracks?.length
      ? ["<USER>", ...fields.sourceTracks.map((n) => `<SOURCE_TRACK>${escapeXml(n)}</SOURCE_TRACK>`), "</USER>"]
      : []),
    "</BWFXML>",
  ];
  return new TextEncoder().encode(lines.join("\n"));
}

const unescapeXml = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n] ?? "");

export interface ParsedIxml {
  readonly project: string;
  readonly tracks: readonly BwfIxmlTrack[];
  readonly timeReference: number;
  readonly sampleRate: number;
  readonly sourceTracks: readonly string[];
}

export function parseIxmlChunk(data: Uint8Array): ParsedIxml {
  const xml = new TextDecoder().decode(data);
  const tag = (src: string, name: string): string | undefined => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(src);
    return m ? unescapeXml(m[1]) : undefined;
  };
  const tracks: BwfIxmlTrack[] = [];
  for (const m of xml.matchAll(/<TRACK>([\s\S]*?)<\/TRACK>/g)) {
    tracks.push({ channelIndex: Number(tag(m[1], "CHANNEL_INDEX")), name: tag(m[1], "NAME") ?? "" });
  }
  const hi = Number(tag(xml, "TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI") ?? 0);
  const lo = Number(tag(xml, "TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO") ?? 0);
  return {
    project: tag(xml, "PROJECT") ?? "",
    tracks,
    timeReference: hi * 0x100000000 + lo,
    sampleRate: Number(tag(xml, "TIMESTAMP_SAMPLE_RATE") ?? 0),
    sourceTracks: [...xml.matchAll(/<SOURCE_TRACK>([\s\S]*?)<\/SOURCE_TRACK>/g)].map((m) => unescapeXml(m[1])),
  };
}

export interface RiffChunk {
  readonly id: string;
  readonly data: Uint8Array;
}

/** A RIFF size field holds at most this; a bigger WAV is written as RF64 (EBU Tech 3306) with a `ds64` chunk. */
export const RIFF_MAX_SIZE = 0xffffffff;
const DS64_BODY_SIZE = 28;
/** `RF64` + size + `WAVE`, then the `ds64` chunk header and body. */
export const RF64_PREAMBLE_SIZE = 12 + 8 + DS64_BODY_SIZE;

/** Walks the top-level chunks of a RIFF/WAVE or RF64/WAVE file (a `0xFFFFFFFF` data size is read from `ds64`). Throws otherwise. */
export function readWavChunks(wav: Uint8Array): RiffChunk[] {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
  const magic = wav.length >= 12 ? tag(0) : "";
  if ((magic !== "RIFF" && magic !== "RF64") || tag(8) !== "WAVE") throw new Error("Not a RIFF/WAVE file");
  let ds64DataSize: number | undefined;
  const chunks: RiffChunk[] = [];
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = tag(offset);
    let size = view.getUint32(offset + 4, true);
    if (id === "ds64" && magic === "RF64" && offset + 8 + DS64_BODY_SIZE <= wav.length) {
      ds64DataSize = Number(view.getBigUint64(offset + 16, true));
    }
    if (magic === "RF64" && id === "data" && size === RIFF_MAX_SIZE && ds64DataSize !== undefined) size = ds64DataSize;
    const end = Math.min(wav.length, offset + 8 + size);
    chunks.push({ id, data: wav.subarray(offset + 8, end) });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

export interface WavChunkPlan {
  readonly id: string;
  /** Payload bytes, without the 8 byte chunk header or the pad byte. */
  readonly size: number;
}

export interface WavLayout {
  readonly rf64: boolean;
  /** Bytes before the first chunk: the 12 byte RIFF header, or the RF64 header with its `ds64` chunk. */
  readonly preamble: Uint8Array;
  /** The size field to write in each chunk header, in `chunks` order (`0xFFFFFFFF` for an oversize `data` in RF64). */
  readonly sizeFields: readonly number[];
  readonly totalSize: number;
}

/**
 * Plans the container from chunk sizes alone: plain RIFF while every size fits 32 bits, else RF64 with a `ds64` chunk
 * (EBU Tech 3306: RIFF size and `data` size become 0xFFFFFFFF, the real 64 bit sizes and the sample count go in `ds64`).
 * Header only, so it can be checked against sizes far beyond what fits in memory. `rf64Threshold` is for tests.
 */
export function planWavLayout(chunks: readonly WavChunkPlan[], blockAlign: number, rf64Threshold = RIFF_MAX_SIZE): WavLayout {
  const padded = (size: number) => size + (size % 2);
  const body = chunks.reduce((n, c) => n + 8 + padded(c.size), 0);
  const riffSize = 4 + body;
  const rf64 = riffSize > rf64Threshold || chunks.some((c) => c.size > rf64Threshold);
  if (!rf64) {
    const preamble = new Uint8Array(12);
    const view = new DataView(preamble.buffer);
    [...'RIFF'].forEach((c, i) => (preamble[i] = c.charCodeAt(0)));
    view.setUint32(4, riffSize, true);
    [...'WAVE'].forEach((c, i) => (preamble[8 + i] = c.charCodeAt(0)));
    return { rf64, preamble, sizeFields: chunks.map((c) => c.size), totalSize: 8 + riffSize };
  }
  const oversize = chunks.filter((c) => c.size > rf64Threshold);
  if (oversize.some((c) => c.id !== "data")) throw new Error("Only the data chunk of an RF64 file can exceed 4 GB");
  const dataSize = chunks.find((c) => c.id === "data")?.size ?? 0;
  const preamble = new Uint8Array(RF64_PREAMBLE_SIZE);
  const view = new DataView(preamble.buffer);
  const put = (o: number, t: string) => [...t].forEach((c, i) => (preamble[o + i] = c.charCodeAt(0)));
  const totalRiff = riffSize + 8 + DS64_BODY_SIZE;
  put(0, "RF64");
  view.setUint32(4, RIFF_MAX_SIZE, true);
  put(8, "WAVE");
  put(12, "ds64");
  view.setUint32(16, DS64_BODY_SIZE, true);
  view.setBigUint64(20, BigInt(totalRiff), true);
  view.setBigUint64(28, BigInt(dataSize), true);
  view.setBigUint64(36, BigInt(blockAlign > 0 ? Math.floor(dataSize / blockAlign) : 0), true);
  view.setUint32(44, 0, true); // no table entries
  return {
    rf64,
    preamble,
    sizeFields: chunks.map((c) => (c.id === "data" ? RIFF_MAX_SIZE : c.size)),
    totalSize: 8 + totalRiff,
  };
}

function chunkBytes(id: string, data: Uint8Array, sizeField = data.length): Uint8Array {
  const padded = data.length % 2;
  const out = new Uint8Array(8 + data.length + padded);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, sizeField, true);
  out.set(data, 8);
  return out;
}

/**
 * Returns the WAV with `bext` placed right after `fmt ` (before the audio, as BWF readers expect) and `iXML` at the
 * end. Existing chunks with those ids are replaced. The audio data is copied untouched. When the result would
 * not fit a 32 bit RIFF size (over 4 GB) it is written as RF64 with a `ds64` chunk first.
 */
export function embedBwfChunks(wav: Uint8Array, bext: Uint8Array, ixml?: Uint8Array, options: { rf64Threshold?: number } = {}): Uint8Array {
  const chunks = readWavChunks(wav).filter((c) => c.id !== "bext" && c.id !== "iXML" && c.id !== "ds64");
  const ordered: RiffChunk[] = [];
  let placedBext = false;
  for (const chunk of chunks) {
    if (chunk.id === "data" && !placedBext) {
      ordered.push({ id: "bext", data: bext });
      placedBext = true;
    }
    ordered.push(chunk);
    if (chunk.id === "fmt " && !placedBext) {
      ordered.push({ id: "bext", data: bext });
      placedBext = true;
    }
  }
  if (!placedBext) ordered.push({ id: "bext", data: bext });
  if (ixml) ordered.push({ id: "iXML", data: ixml });
  const fmt = chunks.find((c) => c.id === "fmt ");
  const blockAlign = fmt && fmt.data.length >= 14 ? new DataView(fmt.data.buffer, fmt.data.byteOffset, fmt.data.byteLength).getUint16(12, true) : 0;
  const layout = planWavLayout(ordered.map((c) => ({ id: c.id, size: c.data.length })), blockAlign, options.rf64Threshold);
  const out = new Uint8Array(layout.totalSize);
  out.set(layout.preamble, 0);
  let offset = layout.preamble.length;
  ordered.forEach((chunk, i) => {
    const bytes = chunkBytes(chunk.id, chunk.data, layout.sizeFields[i]);
    out.set(bytes, offset);
    offset += bytes.length;
  });
  return out;
}

export interface ParsedBwf {
  readonly bext?: ReturnType<typeof parseBextChunk>;
  readonly ixml?: ParsedIxml;
  readonly chunkOrder: readonly string[];
}

export function parseBwf(wav: Uint8Array): ParsedBwf {
  const chunks = readWavChunks(wav);
  const bext = chunks.find((c) => c.id === "bext");
  const ixml = chunks.find((c) => c.id === "iXML");
  return {
    ...(bext ? { bext: parseBextChunk(bext.data) } : {}),
    ...(ixml ? { ixml: parseIxmlChunk(ixml.data) } : {}),
    chunkOrder: chunks.map((c) => c.id),
  };
}

/** Sequence start timecode as a sample count at `sampleRate` (0 when absent or unreadable). */
export function startTimecodeToSamples(startTimecode: string | undefined, frameRate: number, sampleRate: number): number {
  if (!startTimecode) return 0;
  try {
    const rate = resolveFrameRate(frameRate, { dropFrame: startTimecode.includes(";") });
    const normalized = startTimecode.trim().replace(/[.,](\d+)$/, ":$1");
    return Math.round(framesToSeconds(timecodeToFrames(normalized, rate), rate) * sampleRate);
  } catch {
    return 0;
  }
}

export interface BwfExportOptions {
  readonly projectName: string;
  readonly description?: string;
  readonly originator?: string;
  readonly sampleRate: number;
  readonly startTimecode?: string;
  readonly frameRate: number;
  /** Names of the sequence's audio tracks that feed the mix. */
  readonly sourceTrackNames: readonly string[];
  /** Names of the delivered channels, in file order. */
  readonly channelNames: readonly string[];
  readonly bitDepth: number;
  readonly now?: Date;
}

const two = (n: number) => String(n).padStart(2, "0");

/** Builds both chunks from the project facts and embeds them in `wav`. */
export function applyBwfMetadata(wav: Uint8Array, options: BwfExportOptions): Uint8Array {
  const now = options.now ?? new Date();
  const timeReference = startTimecodeToSamples(options.startTimecode, options.frameRate, options.sampleRate);
  const bext = buildBextChunk({
    description: options.description ?? options.projectName,
    originator: options.originator ?? "OpenReel",
    originatorReference: `OR${now.getTime().toString(36).toUpperCase()}`.slice(0, 32),
    originationDate: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    originationTime: `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
    timeReference,
    codingHistory: `A=PCM,F=${options.sampleRate},W=${options.bitDepth},M=${options.channelNames.length === 1 ? "mono" : "stereo"},T=OpenReel\r\n`,
  });
  const ixml = buildIxmlChunk({
    project: options.projectName,
    note: options.description,
    tracks: options.channelNames.map((name, i) => ({ channelIndex: i + 1, name })),
    sampleRate: options.sampleRate,
    timeReference,
    sourceTracks: options.sourceTrackNames,
    startTimecode: options.startTimecode,
    frameRate: options.frameRate,
  });
  return embedBwfChunks(wav, bext, ixml);
}
