import type { CueSettings, Subtitle, SubtitleStyle } from "../types/timeline";
import { encodeScc, isSccContent, parseScc, type CaptionFormatIssue } from "./scc";
import { encodeStl, isStlContent, parseStl } from "./ebu-stl";
import { encodeSbv, isSbvContent, parseSbv } from "./sbv";
import { isTtmlContent, parseTtml } from "./ttml";

/**
 * Caption interchange: SRT, WebVTT, SBV and TTML / DFXP import, SRT / WebVTT / SBV / TTML
 * (IMSC1 text profile) export. Pure functions over `Subtitle[]`; the editor commits the
 * result through the action system.
 *
 * Speakers travel as WebVTT voice tags (`<v Name>`); SRT has no standard for
 * them, so SRT export can optionally prefix `Name: `. Caption tracks are
 * exported one at a time (`captionTrackId`), so each language is its own file.
 *
 * Broadcast formats live beside this file: SCC (CEA-608, `scc.ts`) and EBU-STL
 * (EBU Tech 3264, `ebu-stl.ts`, binary). `exportCaptionFile` / `parseCaptionBytes`
 * route to them so callers handle every format through one entry point.
 */

export interface CaptionParseResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  format: "srt" | "vtt" | "scc" | "mcc" | "stl" | "ttml" | "sbv" | "txt";
  /** Format-specific notes (SCC / STL decoding). */
  issues?: CaptionFormatIssue[];
}

export interface CaptionTrackSelect {
  /** Only cues on this track; `undefined` = every cue, `""` = the default track. */
  captionTrackId?: string;
}

const EPS = 1e-9;

const pad = (value: number, width: number) => String(value).padStart(width, "0");

function splitTime(seconds: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, Math.round(seconds * 1000));
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor(total / 60_000) % 60,
    s: Math.floor(total / 1000) % 60,
    ms: total % 1000,
  };
}

export function formatSrtTime(seconds: number): string {
  const t = splitTime(seconds);
  return `${pad(t.h, 2)}:${pad(t.m, 2)}:${pad(t.s, 2)},${pad(t.ms, 3)}`;
}

export function formatVttTime(seconds: number): string {
  const t = splitTime(seconds);
  return `${pad(t.h, 2)}:${pad(t.m, 2)}:${pad(t.s, 2)}.${pad(t.ms, 3)}`;
}

const TS = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIMING_LINE = new RegExp(String.raw`^\s*${TS}\s*-->\s*${TS}`);
const TIMING_WITH_SETTINGS = new RegExp(String.raw`^\s*${TS}\s*-->\s*${TS}(.*)$`);

const pct = (value: string): number | undefined => {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(value);
  return m ? Number(m[1]) : undefined;
};

/** WebVTT cue settings after the end timestamp. Unknown or malformed settings are ignored. */
export function parseCueSettings(raw: string): CueSettings | undefined {
  const out: { -readonly [K in keyof CueSettings]: CueSettings[K] } = {};
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const colon = token.indexOf(":");
    if (colon <= 0) continue;
    const name = token.slice(0, colon);
    const [value, extra] = token.slice(colon + 1).split(",");
    if (name === "line") {
      const percent = pct(value);
      const n = percent ?? Number(value);
      if (value === "" || !Number.isFinite(n) || value === "auto") continue;
      out.line = n;
      out.snapToLines = percent === undefined;
      if (extra === "start" || extra === "center" || extra === "end") out.lineAlign = extra;
    } else if (name === "position") {
      const n = pct(value);
      if (n === undefined || n > 100) continue;
      out.position = n;
      if (extra === "line-left" || extra === "center" || extra === "line-right") out.positionAlign = extra;
    } else if (name === "size") {
      const n = pct(value);
      if (n !== undefined && n <= 100) out.size = n;
    } else if (name === "align") {
      if (["start", "center", "end", "left", "right"].includes(value)) out.align = value as CueSettings["align"];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const fmtNum = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Cue settings as a WebVTT settings string (leading space), or "" when there is nothing to say. */
export function formatCueSettings(cue: Pick<Subtitle, "cueSettings" | "style">): string {
  const c = cue.cueSettings;
  const parts: string[] = [];
  if (c?.line !== undefined) {
    const align = c.lineAlign ? `,${c.lineAlign}` : "";
    parts.push(`line:${fmtNum(c.line)}${c.snapToLines === false ? "%" : ""}${align}`);
  } else if (cue.style?.position === "top") {
    parts.push("line:0");
  } else if (cue.style?.position === "center") {
    parts.push("line:50%,center");
  }
  if (c?.position !== undefined) {
    parts.push(`position:${fmtNum(c.position)}%${c.positionAlign ? `,${c.positionAlign}` : ""}`);
  }
  if (c?.size !== undefined) parts.push(`size:${fmtNum(c.size)}%`);
  if (c?.align) parts.push(`align:${c.align}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** `::cue` rule for the cue style the format can express (colour, background, font, shadow). */
export function vttStyleBlock(subtitles: readonly Subtitle[]): string {
  const style: SubtitleStyle | undefined = subtitles.find((cue) => cue.style)?.style;
  if (!style) return "";
  const decl: string[] = [];
  if (style.color) decl.push(`color: ${style.color};`);
  if (style.backgroundColor) decl.push(`background-color: ${style.backgroundColor};`);
  if (style.fontFamily) decl.push(`font-family: ${JSON.stringify(style.fontFamily)};`);
  if (style.shadowColor) {
    decl.push(
      `text-shadow: ${style.shadowOffsetX ?? 0}px ${style.shadowOffsetY ?? 0}px ${style.shadowBlur ?? 0}px ${style.shadowColor};`,
    );
  } else if (style.strokeColor && (style.strokeWidth ?? 0) > 0) {
    const w = style.strokeWidth as number;
    decl.push(`text-shadow: ${[[-w, 0], [w, 0], [0, -w], [0, w]].map(([x, y]) => `${x}px ${y}px 0 ${style.strokeColor}`).join(", ")};`);
  }
  if (!decl.length) return "";
  // A blank line would end the STYLE block, and "-->" is illegal inside it.
  return `STYLE\n::cue {\n${decl.map((d) => `  ${d.replace(/-->/g, "")}`).join("\n")}\n}\n\n`;
}

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&lrm;|&rlm;/g, "")
    .replace(/&amp;/g, "&");
}

/** Cue payload -> plain text plus the speaker of a `<v Name>` tag. */
function readCuePayload(payload: string): { text: string; speaker?: string } {
  let speaker: string | undefined;
  const voice = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(payload);
  if (voice) speaker = decodeEntities(voice[1]).trim() || undefined;
  const text = decodeEntities(
    payload
      .replace(/<\d{1,3}:\d{2}[.:]\d{2,3}(?:[.,]\d{1,3})?>/g, "")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return { text, speaker };
}

let counter = 0;
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

export interface CaptionImportOptions {
  captionTrackId?: string;
  language?: string;
  /** SCC / STL: real frame rate of the timecodes (default 29.97 SCC, the file's base for STL). */
  frameRate?: number;
  /** MCC: the project / sequence frame rate. Settles 24 vs 23.976, 30 vs 29.97 and 60 vs 59.94, which `Time Code Rate` cannot say. */
  projectFrameRate?: number;
  /** SCC / STL: seconds subtracted from every time (the file's programme start). */
  offsetSeconds?: number;
  /** SCC / STL: keep <i> / <u> tags for styled runs (default: strip). */
  styleTags?: "keep" | "strip";
  /** SCC / MCC: which CEA-608 caption channel to import, 1 (CC1, default) to 4 (CC4). */
  ccChannel?: 1 | 2 | 3 | 4;
}

/** Parse SRT, WebVTT or SCC (auto-detected). Malformed blocks are reported, not fatal. */
export function parseCaptions(content: string, options: CaptionImportOptions = {}): CaptionParseResult {
  if (/^\uFEFF?\s*File Format\s*=\s*MacCaption_MCC/i.test(content))
    return { subtitles: [], errors: [{ line: 1, message: "MCC files are read by importCaptionFile (the parser loads on demand)." }], format: "mcc" };
  if (isTtmlContent(content)) {
    const r = parseTtml(content, options);
    return { subtitles: r.subtitles, errors: r.errors, format: "ttml", issues: r.issues };
  }
  // XML / HTML that is not TTML. A plain SRT/VTT/SBV whose first cue merely starts with an inline tag
  // (`<i>`, `<b>`...) has timing arrows and is parsed normally below.
  if (/^\s*(?:\uFEFF)?<(?:\?xml|!|[A-Za-z])/.test(content) && !/-->|^\s*\d+:\d{2}:\d{2}[.,]\d+\s*,/m.test(content.slice(0, 4096))) {
    return { subtitles: [], errors: [{ line: 1, message: "Not a TTML caption file: no <tt> root element was found." }], format: "ttml" };
  }
  if (isSbvContent(content)) {
    const r = parseSbv(content, options);
    return { subtitles: r.subtitles, errors: r.errors, format: "sbv", issues: r.issues };
  }
  if (isSccContent(content)) {
    const r = parseScc(content, options);
    return { subtitles: r.subtitles, errors: r.errors, format: "scc", issues: r.issues };
  }
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const format: "srt" | "vtt" = text.trimStart().startsWith("WEBVTT") ? "vtt" : "srt";
  const lines = text.split("\n");
  const subtitles: Subtitle[] = [];
  const errors: CaptionParseResult["errors"] = [];
  let i = format === "vtt" ? lines.findIndex((l) => l.startsWith("WEBVTT")) + 1 : 0;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    const blockStart = i;
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") block.push(lines[i++]);
    if (format === "vtt" && /^(NOTE|STYLE|REGION)(\s|$)/.test(block[0].trim())) continue;
    const timingIndex = block.findIndex((line) => TIMING_LINE.test(line));
    if (timingIndex < 0 || timingIndex > 1) {
      errors.push({ line: blockStart + 1, message: "Cue has no valid timing line." });
      continue;
    }
    const m = TIMING_WITH_SETTINGS.exec(block[timingIndex])!;
    const startTime = toSeconds(m[1], m[2], m[3], m[4]);
    const endTime = toSeconds(m[5], m[6], m[7], m[8]);
    if (!(endTime > startTime + EPS)) {
      errors.push({ line: blockStart + timingIndex + 1, message: "Cue ends before it starts." });
      continue;
    }
    const cueSettings = format === "vtt" ? parseCueSettings(m[9] ?? "") : undefined;
    const { text: cueText, speaker } = readCuePayload(block.slice(timingIndex + 1).join("\n"));
    if (!cueText) {
      errors.push({ line: blockStart + timingIndex + 1, message: "Cue has no text." });
      continue;
    }
    subtitles.push({
      id: newId("cue"),
      text: cueText,
      startTime,
      endTime,
      ...(speaker ? { speaker } : {}),
      ...(cueSettings ? { cueSettings } : {}),
      ...(options.language ? { language: options.language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    });
  }
  return { subtitles, errors, format };
}

function select(subtitles: readonly Subtitle[], { captionTrackId }: CaptionTrackSelect): Subtitle[] {
  return subtitles
    .filter((cue) => captionTrackId === undefined || (cue.captionTrackId ?? "") === captionTrackId)
    .filter((cue) => cue.endTime > cue.startTime && cue.text.trim() !== "")
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}

export function exportSrt(
  subtitles: readonly Subtitle[],
  options: CaptionTrackSelect & { includeSpeakers?: boolean } = {},
): string {
  const blocks = select(subtitles, options).map((cue, index) => {
    // A blank line would end the SRT block early, so collapse them.
    const text = cue.text.replace(/\n\s*\n+/g, "\n");
    const body = options.includeSpeakers && cue.speaker ? `${cue.speaker}: ${text}` : text;
    return `${index + 1}\n${formatSrtTime(cue.startTime)} --> ${formatSrtTime(cue.endTime)}\n${body}`;
  });
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

const escapeVtt = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** WebVTT with `<v Speaker>` voice tags. Cue text cannot contain a blank line or "-->". */
export function exportVtt(subtitles: readonly Subtitle[], options: CaptionTrackSelect = {}): string {
  const cues = select(subtitles, options).map((cue, index) => {
    const body = escapeVtt(cue.text.replace(/\n\s*\n+/g, "\n").replace(/-->/g, "->"));
    const voice = cue.speaker
      ? `<v ${escapeVtt(cue.speaker.replace(/[\r\n]+/g, " "))}>${body}</v>`
      : body;
    return `${index + 1}\n${formatVttTime(cue.startTime)} --> ${formatVttTime(cue.endTime)}${formatCueSettings(cue)}\n${voice}`;
  });
  const styleBlock = cues.length ? vttStyleBlock(select(subtitles, options)) : "";
  return `WEBVTT\n\n${styleBlock}${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * TTML / IMSC1 text profile (basic): one region at the bottom, one style, one
 * `<p>` per cue (clock-time, media time base), speakers as `ttm:agent`
 * metadata referenced by each paragraph.
 */
export function exportTtml(
  subtitles: readonly Subtitle[],
  options: CaptionTrackSelect & { language?: string } = {},
): string {
  const cues = select(subtitles, options);
  const language = options.language ?? cues.find((cue) => cue.language)?.language ?? "en";
  const speakers = [...new Set(cues.map((cue) => cue.speaker).filter((s): s is string => !!s))];
  const agentId = new Map(speakers.map((name, index) => [name, `spk${index + 1}`]));
  const agents = speakers.map(
    (name) =>
      `      <ttm:agent xml:id="${agentId.get(name)}" type="person"><ttm:name type="alias">${escapeXml(name)}</ttm:name></ttm:agent>`,
  );
  // Cues positioned away from the default bottom edge get their own region (box bottom edge = line %).
  const regionKeys = new Map<number, string>();
  const lineOf = (cue: Subtitle): number => {
    const settings = cue.cueSettings;
    if (settings && settings.snapToLines === false && typeof settings.line === "number") return Math.min(100, Math.max(18, Math.round(settings.line * 100) / 100));
    const pos = cue.style?.position;
    return pos === "top" ? 23 : pos === "center" ? 59 : 96;
  };
  for (const cue of cues) {
    const line = lineOf(cue);
    if (line !== 96 && !regionKeys.has(line)) regionKeys.set(line, `r${regionKeys.size + 2}`);
  }
  // One <style> per distinct cue look (colour, box, font, outline); cues without a custom style share the default s1.
  const toTtmlFont = (family: string): string => {
    const f = family.toLowerCase();
    return f === "monospace" ? "monospace" : f === "serif" ? "serif" : f === "sans-serif" ? "proportionalSansSerif" : family;
  };
  const styleAttrs = (cue: Subtitle): string => {
    const st = cue.style;
    if (!st) return "";
    const parts: string[] = [];
    if (st.fontFamily && st.fontFamily !== "Inter") parts.push(`tts:fontFamily="${escapeXml(toTtmlFont(st.fontFamily))}"`);
    if (st.color) parts.push(`tts:color="${escapeXml(st.color)}"`);
    if (st.backgroundColor) parts.push(`tts:backgroundColor="${escapeXml(st.backgroundColor)}"`);
    if (st.strokeColor && (st.strokeWidth ?? 0) > 0) parts.push(`tts:textOutline="${escapeXml(st.strokeColor)} ${st.strokeWidth}px"`);
    return parts.join(" ");
  };
  const styleIds = new Map<string, string>();
  for (const cue of cues) {
    const attrs = styleAttrs(cue);
    if (attrs && !styleIds.has(attrs)) styleIds.set(attrs, `s${styleIds.size + 2}`);
  }
  const paragraphs = cues.map((cue, index) => {
    const regionId = regionKeys.get(lineOf(cue)) ?? "r1";
    const styleId = styleIds.get(styleAttrs(cue)) ?? "s1";
    const lines = cue.text.split("\n").map(escapeXml).join("<br/>");
    const agent = cue.speaker ? ` ttm:agent="${agentId.get(cue.speaker)}"` : "";
    return `      <p xml:id="c${index + 1}" begin="${formatVttTime(cue.startTime)}" end="${formatVttTime(cue.endTime)}" region="${regionId}" style="${styleId}"${agent}>${lines}</p>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="${escapeXml(language)}" ttp:timeBase="media" ttp:profile="http://www.w3.org/ns/ttml/profile/imsc1/text">`,
    `  <head>`,
    ...(agents.length ? [`    <metadata>`, ...agents, `    </metadata>`] : []),
    `    <styling>`,
    `      <style xml:id="s1" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:color="#FFFFFF" tts:backgroundColor="#000000B3" tts:textAlign="center"/>`,
    ...[...styleIds].map(([attrs, id]) => `      <style xml:id="${id}" style="s1" ${attrs}/>`),
    `    </styling>`,
    `    <layout>`,
    `      <region xml:id="r1" tts:origin="10% 78%" tts:extent="80% 18%" tts:displayAlign="after" tts:textAlign="center"/>`,
    ...[...regionKeys].map(
      ([line, id]) =>
        `      <region xml:id="${id}" tts:origin="10% ${line - 18}%" tts:extent="80% 18%" tts:displayAlign="after" tts:textAlign="center"/>`,
    ),
    `    </layout>`,
    `  </head>`,
    `  <body>`,
    `    <div>`,
    ...paragraphs,
    `    </div>`,
    `  </body>`,
    `</tt>`,
    ``,
  ].join("\n");
}

export type CaptionExportFormat = "srt" | "vtt" | "sbv" | "ttml" | "scc" | "mcc" | "stl";
export const CAPTION_EXPORT_FORMATS: readonly CaptionExportFormat[] = ["srt", "vtt", "sbv", "ttml", "scc", "mcc", "stl"];

export interface CaptionExportOptions extends CaptionTrackSelect {
  includeSpeakers?: boolean;
  language?: string;
  /** SCC / STL: real frame rate (SCC default 29.97 drop-frame, STL default 25). */
  frameRate?: number;
  /** SCC: drop-frame timecode (default true at 29.97). */
  dropFrame?: boolean;
  /** SCC / STL: seconds added to every time (e.g. 3600 for a 01:00:00 programme start). */
  offsetSeconds?: number;
  /** STL: programme title for the GSI block. */
  title?: string;
  /** WebVTT: source-clip metadata (scene, take, keywords, ...) written as a `NOTE` block under the header. */
  metadataNote?: readonly string[];
}

export const CAPTION_FORMAT_INFO: Readonly<
  Record<CaptionExportFormat, { label: string; extension: string; mimeType: string; binary: boolean }>
> = {
  srt: { label: "SRT", extension: "srt", mimeType: "application/x-subrip", binary: false },
  vtt: { label: "WebVTT", extension: "vtt", mimeType: "text/vtt", binary: false },
  sbv: { label: "SBV (YouTube)", extension: "sbv", mimeType: "text/plain", binary: false },
  ttml: { label: "TTML (IMSC1)", extension: "ttml", mimeType: "application/ttml+xml", binary: false },
  scc: { label: "SCC (CEA-608)", extension: "scc", mimeType: "text/x-scc", binary: false },
  mcc: { label: "MCC (MacCaption)", extension: "mcc", mimeType: "text/plain", binary: false },
  stl: { label: "EBU-STL", extension: "stl", mimeType: "application/octet-stream", binary: true },
};

/** Text caption formats. EBU-STL is binary: use `exportCaptionFile`. */
export function exportCaptions(
  subtitles: readonly Subtitle[],
  format: CaptionExportFormat,
  options: CaptionExportOptions = {},
): string {
  if (format === "srt") return exportSrt(subtitles, options);
  // `includeSpeakers: false` leaves the speaker out of the voice-tag / agent formats too.
  const unlabelled = () =>
    subtitles.map((cue) => {
      const { speaker: _speaker, ...rest } = cue;
      void _speaker;
      return rest;
    });
  if (format === "vtt") return exportVtt(options.includeSpeakers === false ? unlabelled() : subtitles, options);
  if (format === "ttml") return exportTtml(options.includeSpeakers === false ? unlabelled() : subtitles, options);
  if (format === "sbv") return encodeSbv(select(subtitles, options)).content;
  if (format === "scc") return encodeScc(subtitles, options).content;
  if (format === "stl") throw new Error("EBU-STL is a binary format: use exportCaptionFile.");
  if (format === "mcc") throw new Error("MCC is loaded on demand: use exportCaptionFileAsync.");
  throw new Error(`Unsupported caption format "${String(format)}". Use ${CAPTION_EXPORT_FORMATS.join(", ")}.`);
}

export interface CaptionFile {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
  /** Present for SCC / STL: encoding warnings (wrapped lines, delayed captions, ...). */
  issues: CaptionFormatIssue[];
}

/** Insert a `NOTE` block (no blank lines inside, no `-->`) right after the WEBVTT header block. */
export function withVttNote(vtt: string, lines: readonly string[]): string {
  const clean = lines.map((l) => l.replace(/-->/g, "->").replace(/[\r\n]+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return vtt;
  const match = /^(\uFEFF?WEBVTT[^\n]*\n)/.exec(vtt);
  if (!match) return vtt;
  return `${match[1]}\nNOTE OpenReel clip metadata\n${clean.join("\n")}\n${vtt.slice(match[1].length)}`;
}

/** Any caption format as file bytes, with the encoder's validation report. */
export function exportCaptionFile(
  subtitles: readonly Subtitle[],
  format: CaptionExportFormat,
  options: CaptionExportOptions = {},
): CaptionFile {
  const info = CAPTION_FORMAT_INFO[format];
  if (!info) throw new Error(`Unsupported caption format "${String(format)}". Use ${CAPTION_EXPORT_FORMATS.join(", ")}.`);
  if (format === "mcc") throw new Error("MCC is loaded on demand: use exportCaptionFileAsync.");
  if (format === "stl") {
    const r = encodeStl(subtitles, options);
    return { bytes: r.bytes, mimeType: info.mimeType, extension: info.extension, issues: r.issues };
  }
  if (format === "scc") {
    const r = encodeScc(subtitles, options);
    return { bytes: new TextEncoder().encode(r.content), mimeType: info.mimeType, extension: info.extension, issues: r.issues };
  }
  let text = exportCaptions(subtitles, format, options);
  if (format === "vtt" && options.metadataNote?.length) text = withVttNote(text, options.metadataNote);
  return {
    bytes: new TextEncoder().encode(text),
    mimeType: info.mimeType,
    extension: info.extension,
    issues: format === "sbv" ? encodeSbv(select(subtitles, options)).issues : [],
  };
}

/** Text caption bytes -> string: UTF-16 by BOM, UTF-8, else Windows-1252 (legacy SRT files). */
export function decodeCaptionText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Parse caption file bytes: EBU-STL is detected by its GSI block, everything else is decoded as text. */
export function parseCaptionBytes(bytes: Uint8Array, options: CaptionImportOptions = {}): CaptionParseResult {
  if (isStlContent(bytes)) {
    const r = parseStl(bytes, options);
    return { subtitles: r.subtitles, errors: r.errors, format: "stl", issues: r.issues };
  }
  return parseCaptions(decodeCaptionText(bytes), options);
}

/** A caption track is a distinct `captionTrackId`; "" is the default track. */
export interface CaptionTrackSummary {
  id: string;
  language?: string;
  cueCount: number;
}

export function listCaptionTracks(subtitles: readonly Subtitle[]): CaptionTrackSummary[] {
  const tracks = new Map<string, CaptionTrackSummary>();
  for (const cue of subtitles) {
    const id = cue.captionTrackId ?? "";
    const entry = tracks.get(id) ?? { id, cueCount: 0 };
    entry.cueCount += 1;
    if (!entry.language && cue.language) entry.language = cue.language;
    tracks.set(id, entry);
  }
  return [...tracks.values()].sort((a, b) => a.id.localeCompare(b.id));
}
