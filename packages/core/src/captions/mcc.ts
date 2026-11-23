import type { Subtitle } from "../types/timeline";
import {
  NTSC_FPS,
  framesToSeconds,
  framesToTimecode,
  resolveCaptionFrameRate,
  timecodeProblem,
  timecodeToFrames,
  type CaptionFrameRate,
} from "./caption-timecode";
import { Cea608Decoder, cea608CuesToSubtitles, type Cc } from "./cea608-decoder";
import { encodeScc, type CaptionFormatIssue, type SccOptions } from "./scc";

/**
 * MCC (MacCaption) import and export.
 *
 * An MCC file is a text header (`File Format=MacCaption_MCC V1.0|V2.0`, `Time Code Rate=...`) followed by one
 * line per frame: `HH:MM:SS:FF<TAB>hex`. The hex is an SMPTE 291 ancillary packet (DID 61h, SDID 01h, data count,
 * then a SMPTE 334-2 Caption Distribution Packet) written with single-letter aliases for common byte runs
 * (G..O = FA 00 00 repeated 1..9 times, P = FB 80 80, Q = FC 80 80, R = FD 80 80, S = 96 69, T = 61 01,
 * U = E1 00 00 00, Z = 00). The CDP carries cc_data triplets: type 0 is CEA-608 field 1 (CC1 / CC2), type 1 is
 * field 2 (CC3 / CC4), types 2 and 3 are CEA-708 (DTVCC) packet data.
 *
 * Import decodes the CEA-608 data with the shared decoder (so pop-on, roll-up, paint-on, characters, rows and
 * colours behave as in SCC). CEA-708 caption services are detected and reported, not decoded.
 * Export writes the 608 captions the SCC encoder produces, one CDP per frame.
 */

const ALIASES: Record<string, string> = {
  G: "FA0000",
  H: "FA0000".repeat(2),
  I: "FA0000".repeat(3),
  J: "FA0000".repeat(4),
  K: "FA0000".repeat(5),
  L: "FA0000".repeat(6),
  M: "FA0000".repeat(7),
  N: "FA0000".repeat(8),
  O: "FA0000".repeat(9),
  P: "FB8080",
  Q: "FC8080",
  R: "FD8080",
  S: "9669",
  T: "6101",
  U: "E1000000",
  Z: "00",
};

export function isMccContent(content: string): boolean {
  return /^﻿?\s*File Format\s*=\s*MacCaption_MCC/i.test(content);
}

/** Expand MCC aliases into plain hex. Returns null when the text has a character that is neither hex nor an alias. */
export function expandMccHex(raw: string): string | null {
  let out = "";
  for (const ch of raw.trim()) {
    if (/[0-9a-fA-F]/.test(ch)) out += ch;
    else if (ALIASES[ch]) out += ALIASES[ch];
    else if (!/\s/.test(ch)) return null;
  }
  return out;
}

/** Compress plain bytes with the MCC aliases. */
export function compressMccBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  let out = "";
  for (let i = 0; i < hex.length; ) {
    const rest = hex.slice(i);
    let run = 0;
    while (rest.startsWith("FA0000", run * 6) && run < 9) run++;
    if (run > 0) {
      out += String.fromCharCode("G".charCodeAt(0) + run - 1);
      i += run * 6;
      continue;
    }
    const four = rest.slice(0, 4);
    const six = rest.slice(0, 6);
    if (six === "FB8080") (out += "P"), (i += 6);
    else if (six === "FC8080") (out += "Q"), (i += 6);
    else if (six === "FD8080") (out += "R"), (i += 6);
    else if (four === "9669") (out += "S"), (i += 4);
    else if (four === "6101") (out += "T"), (i += 4);
    else if (rest.startsWith("00")) (out += "Z"), (i += 2);
    else (out += rest.slice(0, 2)), (i += 2);
  }
  return out;
}

const CDP_RATE_CODE: Record<string, number> = { "23.976": 1, "24": 2, "25": 3, "29.97": 4, "30": 5, "50": 6, "59.94": 7, "60": 8 };
const CC_COUNT: Record<number, number> = { 1: 25, 2: 25, 3: 24, 4: 20, 5: 20, 6: 12, 7: 10, 8: 10 };

interface MccRate {
  rate: CaptionFrameRate;
  label: string;
}

const FRACTIONAL = 1000 / 1001;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * `Time Code Rate` names the label base (24, 25, 30, 50, 60) and, for 30 and 60, drop-frame. It never says
 * whether "24" means 24 or 23.976 fps (or "30" 30 or 29.97, "60" 60 or 59.94): MacCaption and ffmpeg both
 * write 23.976 as "24". Reading it as exactly 24 drifts about 1 s per 15 minutes on 23.976 media, so an
 * ambiguous label takes the project / sequence rate when that is one of the two candidates, then the exact
 * `OpenReel Frame Rate` header an OpenReel export records, and only then the literal integer rate.
 */
function mccRate(
  label: string | undefined,
  hasDrop: boolean,
  fallbackFps: number | undefined,
  projectFps: number | undefined,
  exactRate: string | undefined,
  issues: CaptionFormatIssue[],
): MccRate {
  const v = (label ?? "").trim().toUpperCase();
  const table: Record<string, CaptionFrameRate & { ambiguous?: boolean }> = {
    "24": { fps: 24, nominal: 24, dropFrame: false, ambiguous: true },
    "23.976": { fps: 24000 / 1001, nominal: 24, dropFrame: false },
    "25": { fps: 25, nominal: 25, dropFrame: false },
    "30": { fps: 30, nominal: 30, dropFrame: false, ambiguous: true },
    "30DF": { fps: NTSC_FPS, nominal: 30, dropFrame: true },
    "29.97": { fps: NTSC_FPS, nominal: 30, dropFrame: hasDrop },
    "50": { fps: 50, nominal: 50, dropFrame: false },
    "60": { fps: 60, nominal: 60, dropFrame: false, ambiguous: true },
    "60DF": { fps: 60000 / 1001, nominal: 60, dropFrame: true },
    "59.94": { fps: 60000 / 1001, nominal: 60, dropFrame: hasDrop },
  };
  const entry = v ? table[v] : undefined;
  if (entry) {
    const { ambiguous, ...rate } = entry;
    if (!ambiguous) return { rate, label: v };
    const fractional = rate.nominal * FRACTIONAL;
    const exact = exactRate ? /^(\d+)\/(\d+)$/.exec(exactRate.trim()) : null;
    const recorded = exact ? Number(exact[1]) / Number(exact[2]) : exactRate ? Number(exactRate) : NaN;
    if (projectFps && Number.isFinite(projectFps) && (near(projectFps, rate.fps) || near(projectFps, fractional))) {
      const fps = near(projectFps, fractional) ? fractional : rate.fps;
      issues.push({
        severity: "info",
        code: "mcc-rate-assumed",
        message: `"Time Code Rate=${label?.trim()}" does not say whether the file is ${rate.nominal} or ${(Math.round(fractional * 1000) / 1000).toString()} fps; the project frame rate (${(Math.round(fps * 1000) / 1000).toString()}) was used.`,
      });
      return { rate: { ...rate, fps }, label: v };
    }
    if (Number.isFinite(recorded) && (near(recorded, rate.fps) || near(recorded, fractional)))
      return { rate: { ...rate, fps: near(recorded, fractional) ? fractional : rate.fps }, label: v };
    issues.push({
      severity: "info",
      code: "mcc-rate-assumed",
      message: `"Time Code Rate=${label?.trim()}" was read as exactly ${rate.nominal} fps. If the footage is ${(Math.round(fractional * 1000) / 1000).toString()} fps, set the project frame rate first (about 1 s of drift per 15 minutes otherwise).`,
    });
    return { rate, label: v };
  }
  if (v)
    issues.push({ severity: "warning", code: "mcc-rate", message: `Unknown "Time Code Rate=${label}"; frame rate ${fallbackFps ?? "30"} was assumed.` });
  const r = resolveCaptionFrameRate(fallbackFps ?? (hasDrop ? NTSC_FPS : 30), hasDrop);
  return { rate: r, label: r.dropFrame ? "30DF" : String(r.nominal) };
}

export interface MccParseOptions {
  captionTrackId?: string;
  language?: string;
  /** Used only when the file has no (or an unknown) Time Code Rate. */
  frameRate?: number;
  /** The project / sequence frame rate: settles 24 vs 23.976, 30 vs 29.97 and 60 vs 59.94, which `Time Code Rate` cannot say. */
  projectFrameRate?: number;
  offsetSeconds?: number;
  styleTags?: "keep" | "strip";
  trailingSeconds?: number;
  /** Which CEA-608 caption channel to import (CC1..CC4, default 1). */
  ccChannel?: Cc;
}

export interface MccParseResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
  format: "mcc";
  /** Header values (File Format, Time Code Rate, UUID, ...). */
  header: Record<string, string>;
}

export function parseMcc(content: string, options: MccParseOptions = {}): MccParseResult {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const errors: MccParseResult["errors"] = [];
  const issues: CaptionFormatIssue[] = [];
  const header: Record<string, string> = {};
  if (!isMccContent(text)) {
    errors.push({ line: 1, message: 'Missing "File Format=MacCaption_MCC V1.0" header.' });
    return { subtitles: [], errors, issues, format: "mcc", header };
  }
  const isData = (l: string) => /^\s*\d{1,2}:\d{2}:\d{2}[:;.,]\d{2}\s/.test(l);
  const hasDrop = lines.some((l) => /^\s*\d{1,2}:\d{2}:\d{2};\d{2}\s/.test(l));
  for (const l of lines) {
    if (isData(l)) break;
    const kv = /^\s*([A-Za-z][^=/]*?)\s*=\s*(.*)$/.exec(l);
    if (kv) header[kv[1].trim()] = kv[2].trim();
  }
  const { rate } = mccRate(header["Time Code Rate"], hasDrop, options.frameRate, options.projectFrameRate, header["OpenReel Frame Rate"], issues);
  const decoder = new Cea608Decoder({ channel: options.ccChannel ?? 1, keepTags: options.styleTags === "keep" });
  const stats = { packets: 0, badChecksum: 0, badPacket: 0, dtvcc: 0, dtvccPackets: 0, timecodeJumps: 0 };
  let lastFrame = -1;

  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (!isData(line)) {
      // Header, comment and blank lines before the data are fine; other text after it is reported.
      if (line.trim() && stats.packets + stats.badPacket > 0 && !/^\s*(\/\/|[A-Za-z][^=]*=)/.test(line))
        errors.push({ line: ln + 1, message: "Line has no timecode followed by caption data." });
      continue;
    }
    const m = /^\s*(\d{1,2}:\d{2}:\d{2}[:;.,]\d{2})\s+(.*)$/.exec(line);
    if (!m) {
      errors.push({ line: ln + 1, message: "Line has a timecode but no caption data." });
      continue;
    }
    const frame = timecodeToFrames(m[1], rate);
    if (frame === null) {
      errors.push({ line: ln + 1, message: `Invalid timecode ${timecodeProblem(m[1], rate) ?? `"${m[1]}"`}` });
      continue;
    }
    if (frame < lastFrame) stats.timecodeJumps++;
    lastFrame = frame;
    const hex = expandMccHex(m[2]);
    if (hex === null || hex.length % 2 !== 0 || hex.length === 0) {
      errors.push({ line: ln + 1, message: "Caption data has characters that are neither hexadecimal nor MCC aliases (or an odd number of digits)." });
      continue;
    }
    const bytes = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
    stats.packets++;
    // SMPTE 291 ANC wrapper: DID 61, SDID 01, DC, CDP, checksum. A bare CDP (96 69 ...) is accepted too.
    let cdpAt = 0;
    if (bytes[0] === 0x61 && bytes[1] === 0x01) {
      cdpAt = 3;
      if (bytes.length >= 4) {
        let sum = 0;
        for (let k = 0; k < bytes.length - 1; k++) sum += bytes[k];
        if ((sum & 0xff) !== bytes[bytes.length - 1]) stats.badChecksum++;
      }
    }
    if (bytes[cdpAt] !== 0x96 || bytes[cdpAt + 1] !== 0x69) {
      stats.badPacket++;
      errors.push({ line: ln + 1, message: "Caption data is not a CEA-708 caption distribution packet (96 69)." });
      continue;
    }
    if (bytes.length < cdpAt + 3) {
      stats.badPacket++;
      errors.push({ line: ln + 1, message: "Truncated caption packet (no length byte)." });
      continue;
    }
    const cdpLen = bytes[cdpAt + 2];
    const cdp = bytes.subarray(cdpAt, cdpAt + Math.min(cdpLen, bytes.length - cdpAt));
    if (cdp.length !== cdpLen || cdpLen < 11) {
      stats.badPacket++;
      errors.push({ line: ln + 1, message: `Truncated caption packet (declared ${cdpLen} bytes, found ${cdp.length}).` });
      continue;
    }
    let csum = 0;
    for (const b of cdp) csum += b;
    if ((csum & 0xff) !== 0) stats.badChecksum++;
    const flags = cdp[4];
    let p = 7; // after identifier(2), length, frame rate, flags, sequence(2)
    if (flags & 0x80) p += 5; // time code section: 71 + 4
    const frameTime = framesToSeconds(frame, rate);
    if (flags & 0x40 && cdp[p] === 0x72) {
      const count = cdp[p + 1] & 0x1f;
      p += 2;
      const fieldCounts: [number, number, number] = [0, 0, 0];
      const triples: Array<[number, number, number]> = [];
      for (let k = 0; k < count && p + 2 < cdp.length; k++, p += 3) {
        const marker = cdp[p];
        const valid = (marker & 0x04) !== 0;
        const type = marker & 0x03;
        if (!valid) continue;
        if (type === 0 || type === 1) {
          triples.push([type, cdp[p + 1], cdp[p + 2]]);
          fieldCounts[type]++;
        } else if (cdp[p + 1] !== 0 || cdp[p + 2] !== 0) {
          stats.dtvcc++;
        }
      }
      const seen: [number, number] = [0, 0];
      for (const [type, b1, b2] of triples) {
        const n = fieldCounts[type];
        const t = frameTime + (seen[type]++ / n) * (1 / rate.fps);
        decoder.feed(b1, b2, t, (type + 1) as 1 | 2);
      }
    }
  }
  if (!stats.packets && !errors.length) errors.push({ line: 1, message: "The MCC file has no caption data lines." });
  if (decoder.open) {
    decoder.finish(decoder.time + (options.trailingSeconds ?? 2));
    issues.push({ severity: "warning", code: "scc-unterminated", message: "The last caption was never cleared; it was given a default duration." });
  }
  if (stats.dtvcc)
    issues.push({
      severity: "warning",
      code: "mcc-708",
      message: `The file carries CEA-708 (DTVCC) caption service data (${stats.dtvcc} byte pairs). It was not decoded; only the CEA-608 captions (CC${decoder.channel}) were imported.`,
    });
  if (stats.badChecksum)
    issues.push({ severity: "warning", code: "mcc-checksum", message: `${stats.badChecksum} caption packet${stats.badChecksum === 1 ? "" : "s"} failed the checksum; they were decoded anyway.` });
  if (stats.timecodeJumps)
    issues.push({ severity: "warning", code: "mcc-timecode-order", message: `${stats.timecodeJumps} line${stats.timecodeJumps === 1 ? "" : "s"} had a timecode earlier than the line before; the lines were read in file order.` });
  issues.push(...decoder.issues("MCC"));
  const subtitles = cea608CuesToSubtitles(decoder, { ...options, idPrefix: "mcc" }, issues);
  subtitles.sort((a, b) => a.startTime - b.startTime);
  return { subtitles, errors, issues, format: "mcc", header };
}

// ---------------------------------------------------------------------------
// Export

export interface MccExportResult {
  content: string;
  issues: CaptionFormatIssue[];
  cueCount: number;
  droppedCount: number;
}

const MCC_HEADER = [
  "File Format=MacCaption_MCC V2.0",
  "",
  "///////////////////////////////////////////////////////////////////////////////////",
  "// Computer Prompting and Captioning Company",
  "// Ancillary Data Packet Transfer File",
  "//",
  "// Permission to generate this format is granted provided that",
  "//   1. This ANC Transfer file format is used on an as-is basis and no warranty is given, and",
  "//   2. This entire descriptive information text is included in a generated .mcc file.",
  "//",
  "///////////////////////////////////////////////////////////////////////////////////",
];

/** One CDP carrying a single CEA-608 field 1 byte pair (field 2 and the 708 slots are padding). */
export function buildCdp(b1: number, b2: number, sequence: number, rateCode: number): Uint8Array {
  const count = CC_COUNT[rateCode] ?? 20;
  const out: number[] = [0x96, 0x69, 0, (rateCode << 4) | 0x0f, 0x43, (sequence >> 8) & 0xff, sequence & 0xff, 0x72, 0xe0 | count];
  out.push(0xfc, b1, b2);
  if (count > 1) out.push(0xfd, 0x80, 0x80);
  while (out.length < 9 + count * 3) out.push(0xfa, 0x00, 0x00);
  out.push(0x74, (sequence >> 8) & 0xff, sequence & 0xff, 0);
  out[2] = out.length;
  let sum = 0;
  for (let i = 0; i < out.length - 1; i++) sum += out[i];
  out[out.length - 1] = -sum & 0xff;
  return Uint8Array.from(out);
}

/** ANC wrapper (DID 61h SDID 01h) around a CDP, with the 8-bit checksum. */
export function wrapAnc(cdp: Uint8Array): Uint8Array {
  const out = new Uint8Array(cdp.length + 4);
  out[0] = 0x61;
  out[1] = 0x01;
  out[2] = cdp.length;
  out.set(cdp, 3);
  let sum = 0;
  for (let i = 0; i < out.length - 1; i++) sum += out[i];
  out[out.length - 1] = sum & 0xff;
  return out;
}

/** MCC time code rate for a project rate: 50 / 60 / 59.94 stay at full rate (MCC has 50, 60 and 60DF labels). */
function mccExportRate(fps: number | undefined, dropFrame: boolean | undefined): CaptionFrameRate {
  let rate = fps && Number.isFinite(fps) && fps > 0 ? fps : NTSC_FPS;
  while (rate > 60.5) rate /= 2;
  if (rate <= 30.5) return resolveCaptionFrameRate(rate, dropFrame);
  const ntsc = near(rate, 60000 / 1001);
  return { fps: ntsc ? 60000 / 1001 : rate, nominal: Math.round(rate), dropFrame: ntsc ? (dropFrame ?? true) : false };
}

export function encodeMcc(subtitles: readonly Subtitle[], options: SccOptions = {}): MccExportResult {
  const scc = encodeScc(subtitles, options);
  const sccRate = resolveCaptionFrameRate(options.frameRate, options.dropFrame);
  const rate = mccExportRate(options.frameRate, options.dropFrame);
  const label = rate.dropFrame ? `${rate.nominal}DF` : String(rate.nominal);
  const fractional = near(rate.fps, rate.nominal * FRACTIONAL);
  const rateKey = fractional ? ({ 24: "23.976", 30: "29.97", 60: "59.94" } as Record<number, string>)[rate.nominal] : String(rate.nominal);
  const rateCode = CDP_RATE_CODE[rateKey] ?? CDP_RATE_CODE[String(rate.nominal)] ?? 5;
  const header = ["UUID=" + stableUuid(scc.content), "Creation Program=OpenReel", `Time Code Rate=${label}`];
  // The label cannot say 23.976 / 29.97 / 59.94 without drop-frame; record the real rate for readers that look.
  if (fractional && !rate.dropFrame) header.push(`OpenReel Frame Rate=${Math.round(rate.nominal * 1000)}/1001`);
  const lines: string[] = [...MCC_HEADER, ...header, ""];
  const step = Math.max(1, Math.round(rate.nominal / sccRate.nominal));
  let seq = 0;
  for (const row of scc.content.split("\n")) {
    const m = /^(\d{2}:\d{2}:\d{2}[:;]\d{2})\t(.*)$/.exec(row);
    if (!m) continue;
    const sccStart = timecodeToFrames(m[1], sccRate);
    if (sccStart === null) continue;
    const start = Math.round(framesToSeconds(sccStart, sccRate) * rate.fps);
    m[2]
      .trim()
      .split(/\s+/)
      .forEach((word, k) => {
        const v = parseInt(word, 16);
        if (!/^[0-9a-f]{4}$/i.test(word)) return;
        const packet = wrapAnc(buildCdp(v >> 8, v & 0xff, seq++ & 0xffff, rateCode));
        lines.push(`${framesToTimecode(start + k * step, rate)}\t${compressMccBytes(packet)}`);
      });
  }
  lines.push("");
  return { content: lines.join("\n"), issues: scc.issues, cueCount: scc.cueCount, droppedCount: scc.droppedCount };
}

/** A UUID-shaped id that depends only on the content, so exports are reproducible. */
function stableUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0").toUpperCase();
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, 31) >>> 0);
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-${a.slice(12, 16)}-${a.slice(16, 20)}-${a.slice(20, 32)}`;
}
