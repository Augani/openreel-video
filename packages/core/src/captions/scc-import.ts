import type { Subtitle } from "../types/timeline";
import { framesToSeconds, resolveCaptionFrameRate, timecodeProblem, timecodeToFrames, type CaptionFrameRate } from "./caption-timecode";
import { Cea608Decoder, cea608CuesToSubtitles, type Cc } from "./cea608-decoder";
import type { CaptionFormatIssue, SccParseResult } from "./scc";

export interface SccParseOptions {
  captionTrackId?: string;
  language?: string;
  /** Real frame rate; default 29.97. */
  frameRate?: number;
  /** Subtracted from every time (the inverse of the export offset). */
  offsetSeconds?: number;
  /** Keep `<i>` / `<u>` tags for italic / underlined runs (default: strip). */
  styleTags?: "keep" | "strip";
  /** Seconds a still-visible last caption is shown for. */
  trailingSeconds?: number;
  /** Which CEA-608 caption channel to import (CC1..CC4, default 1). */
  ccChannel?: Cc;
}

export function isSccContent(content: string): boolean {
  return /^﻿?\s*Scenarist_SCC/i.test(content);
}

/** SCC import: a Scenarist file is a list of `timecode  hex pairs` lines that feed the shared CEA-608 decoder. */
export function parseScc(content: string, options: SccParseOptions = {}): SccParseResult {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const errors: SccParseResult["errors"] = [];
  const issues: CaptionFormatIssue[] = [];
  const lines = text.split("\n");
  if (!/^\s*Scenarist_SCC/i.test(lines[0] ?? "")) {
    errors.push({ line: 1, message: 'Missing "Scenarist_SCC V1.0" header.' });
    return { subtitles: [], errors, issues, format: "scc" };
  }

  // Frame rate: explicit option, else drop-frame separator implies 29.97 DF.
  const hasDrop = lines.some((l) => /^\d{1,2}:\d{2}:\d{2};\d{2}\s/.test(l));
  const rate: CaptionFrameRate = resolveCaptionFrameRate(options.frameRate, hasDrop);
  const decoder = new Cea608Decoder({ channel: options.ccChannel ?? 1, keepTags: options.styleTags === "keep" });

  for (let ln = 1; ln < lines.length; ln++) {
    const line = lines[ln];
    if (!line.trim()) continue;
    const m = /^(\d{1,2}:\d{2}:\d{2}[:;.,]\d{2})\s+(.*)$/.exec(line.trim());
    if (!m) {
      errors.push({ line: ln + 1, message: "Line has no timecode followed by byte pairs." });
      continue;
    }
    const startFrame = timecodeToFrames(m[1], rate);
    if (startFrame === null) {
      errors.push({ line: ln + 1, message: `Invalid timecode ${timecodeProblem(m[1], rate) ?? `"${m[1]}"`}` });
      continue;
    }
    const words = m[2].trim().split(/\s+/).filter(Boolean);
    for (let w = 0; w < words.length; w++) {
      if (!/^[0-9a-fA-F]{4}$/.test(words[w])) {
        errors.push({ line: ln + 1, message: `Invalid byte pair "${words[w]}".` });
        continue;
      }
      const raw = parseInt(words[w], 16);
      decoder.feed(raw >> 8, raw & 0xff, framesToSeconds(startFrame + w, rate), 1);
    }
  }
  if (decoder.open) {
    decoder.finish(decoder.time + (options.trailingSeconds ?? 2));
    issues.push({
      severity: "warning",
      code: "scc-unterminated",
      message: "The last caption was never cleared; it was given a default duration.",
    });
  }
  issues.push(...decoder.issues("SCC"));
  const subtitles: Subtitle[] = cea608CuesToSubtitles(
    decoder,
    { ...options, idPrefix: "scc" },
    issues,
  );
  subtitles.sort((a, b) => a.startTime - b.startTime);
  return { subtitles, errors, issues, format: "scc" };
}
