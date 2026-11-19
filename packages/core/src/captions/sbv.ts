import type { Subtitle } from "../types/timeline";
import type { CaptionFormatIssue } from "./scc";

/**
 * YouTube SBV: `h:mm:ss.mmm,h:mm:ss.mmm` timing line followed by the cue text,
 * blocks separated by blank lines. No styling, no cue ids.
 */

const SBV_TIME = String.raw`(\d{1,3}):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?`;
const SBV_TIMING = new RegExp(`^\\s*${SBV_TIME}\\s*,\\s*${SBV_TIME}\\s*$`);

export function isSbvContent(content: string): boolean {
  const first = content
    .replace(/^\uFEFF/, "")
    .split(/\r\n?|\n/)
    .find((line) => line.trim() !== "");
  return first !== undefined && SBV_TIMING.test(first);
}

const toSeconds = (h: string, m: string, s: string, ms = "0") =>
  Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;

export interface SbvParseResult {
  subtitles: Subtitle[];
  errors: Array<{ line: number; message: string }>;
  issues: CaptionFormatIssue[];
}

let counter = 0;

export function parseSbv(
  content: string,
  options: { language?: string; captionTrackId?: string; offsetSeconds?: number } = {},
): SbvParseResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  const subtitles: Subtitle[] = [];
  const errors: SbvParseResult["errors"] = [];
  const offset = options.offsetSeconds ?? 0;
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    const start = i;
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") block.push(lines[i++]);
    const m = SBV_TIMING.exec(block[0]);
    if (!m) {
      errors.push({ line: start + 1, message: "Cue has no valid timing line (expected h:mm:ss.mmm,h:mm:ss.mmm)." });
      continue;
    }
    const startTime = Math.max(0, toSeconds(m[1], m[2], m[3], m[4]) - offset);
    const endTime = Math.max(0, toSeconds(m[5], m[6], m[7], m[8]) - offset);
    if (!(endTime > startTime)) {
      errors.push({ line: start + 1, message: "Cue ends before it starts." });
      continue;
    }
    const text = block
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) {
      errors.push({ line: start + 1, message: "Cue has no text." });
      continue;
    }
    subtitles.push({
      id: `cue-sbv-${Date.now().toString(36)}-${(counter++).toString(36)}`,
      text,
      startTime,
      endTime,
      ...(options.language ? { language: options.language } : {}),
      ...(options.captionTrackId ? { captionTrackId: options.captionTrackId } : {}),
    });
  }
  const issues: CaptionFormatIssue[] = [];
  if (subtitles.some((c) => c.cueSettings || c.style)) issues.push({ severity: "info", code: "sbv-style", message: "SBV carries no styling." });
  return { subtitles, errors, issues };
}

export function formatSbvTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

export function encodeSbv(cues: readonly Subtitle[]): { content: string; issues: CaptionFormatIssue[] } {
  const issues: CaptionFormatIssue[] = [];
  const blocks = cues.map((cue) => {
    if (cue.cueSettings || cue.style)
      issues.push({ severity: "info", code: "sbv-style", message: "SBV has no styling or positioning; it was dropped.", cueId: cue.id });
    return `${formatSbvTime(cue.startTime)},${formatSbvTime(cue.endTime)}\n${cue.text}`;
  });
  const styled = issues.length;
  return {
    content: blocks.length ? `${blocks.join("\n\n")}\n` : "",
    issues: styled ? [issues[0]] : [],
  };
}
