import type { Subtitle, SubtitleStyle, Timeline } from "../types/timeline";

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 45,
  color: "#ffffff",
  backgroundColor: "transparent",
  position: "bottom",
};

export const SUBTITLE_STYLE_PRESETS: Record<string, SubtitleStyle> = {
  default: DEFAULT_SUBTITLE_STYLE,
  classic: {
    fontFamily: "Arial",
    fontSize: 24,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    position: "bottom",
  },
  modern: {
    fontFamily: "Helvetica Neue",
    fontSize: 28,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    position: "bottom",
  },
  cinematic: {
    fontFamily: "Georgia",
    fontSize: 26,
    color: "#f0f0f0",
    backgroundColor: "transparent",
    position: "bottom",
  },
  bold: {
    fontFamily: "Impact",
    fontSize: 32,
    color: "#ffff00",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    position: "bottom",
  },
  minimal: {
    fontFamily: "Roboto",
    fontSize: 22,
    color: "#ffffff",
    backgroundColor: "transparent",
    position: "bottom",
  },
  topCenter: {
    fontFamily: "Arial",
    fontSize: 24,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    position: "top",
  },
  centered: {
    fontFamily: "Arial",
    fontSize: 24,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    position: "center",
  },
};

export interface SRTParseResult {
  readonly success: boolean;
  readonly subtitles: Subtitle[];
  readonly errors: SRTParseError[];
}

export interface SRTParseError {
  readonly line: number;
  readonly message: string;
  readonly segment?: number;
}

function generateSubtitleId(): string {
  return `subtitle-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Parses SRT timestamp format: HH:MM:SS,mmm (comma or period for milliseconds).
 * Both SRT standard (comma) and some variants (period) are supported.
 * Returns null if format is invalid or time values are out of range.
 */
export function parseSRTTimestamp(timestamp: string): number | null {
  // Regex: 1-2 digit hours : 2 digit minutes : 2 digit seconds [,.]3 digit milliseconds
  const match = timestamp
    .trim()
    .match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);

  if (!match) {
    return null;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);

  // Validate ranges (minutes and seconds must be < 60)
  if (minutes >= 60 || seconds >= 60) {
    return null;
  }

  // Convert to total seconds
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function formatSRTTimestamp(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) {
    seconds = 0;
  }

  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
    .toString()
    .padStart(3, "0")}`;
}

export function parseSRT(srtContent: string): SRTParseResult {
  const subtitles: Subtitle[] = [];
  const errors: SRTParseError[] = [];

  const normalizedContent = srtContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks = normalizedContent
    .split(/\n\n+/)
    .filter((block) => block.trim());

  let lineNumber = 1;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    const lines = block.split("\n");

    if (lines.length < 2) {
      errors.push({
        line: lineNumber,
        message: "Invalid subtitle block: insufficient lines",
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    const indexLine = lines[0].trim();
    const index = parseInt(indexLine, 10);

    if (isNaN(index)) {
      errors.push({
        line: lineNumber,
        message: `Invalid subtitle index: "${indexLine}"`,
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    const timestampLine = lines[1].trim();
    const timestampMatch = timestampLine.match(
      /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/,
    );

    if (!timestampMatch) {
      errors.push({
        line: lineNumber + 1,
        message: `Invalid timestamp format: "${timestampLine}"`,
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    const startTime = parseSRTTimestamp(timestampMatch[1]);
    const endTime = parseSRTTimestamp(timestampMatch[2]);

    if (startTime === null) {
      errors.push({
        line: lineNumber + 1,
        message: `Invalid start timestamp: "${timestampMatch[1]}"`,
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    if (endTime === null) {
      errors.push({
        line: lineNumber + 1,
        message: `Invalid end timestamp: "${timestampMatch[2]}"`,
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    if (endTime <= startTime) {
      errors.push({
        line: lineNumber + 1,
        message: `End time must be greater than start time`,
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    const text = lines.slice(2).join("\n").trim();

    if (!text) {
      errors.push({
        line: lineNumber + 2,
        message: "Empty subtitle text",
        segment: i + 1,
      });
      lineNumber += block.split("\n").length + 1;
      continue;
    }

    subtitles.push({
      id: generateSubtitleId(),
      text,
      startTime,
      endTime,
      style: DEFAULT_SUBTITLE_STYLE,
    });

    lineNumber += block.split("\n").length + 1;
  }

  return {
    success: errors.length === 0,
    subtitles,
    errors,
  };
}

export function exportSRT(subtitles: readonly Subtitle[]): string {
  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);

  const blocks: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const subtitle = sorted[i];
    const index = i + 1;
    const startTimestamp = formatSRTTimestamp(subtitle.startTime);
    const endTimestamp = formatSRTTimestamp(subtitle.endTime);

    blocks.push(
      `${index}\n${startTimestamp} --> ${endTimestamp}\n${subtitle.text}`,
    );
  }

  return blocks.join("\n\n");
}

export function normalizeSRT(srtContent: string): string {
  const parseResult = parseSRT(srtContent);

  if (parseResult.subtitles.length === 0) {
    return "";
  }

  return exportSRT(parseResult.subtitles);
}

export class SubtitleEngine {
  importSRT(
    timeline: Timeline,
    srtContent: string,
  ): { timeline: Timeline; result: SRTParseResult } {
    const result = parseSRT(srtContent);

    const updatedTimeline: Timeline = {
      ...timeline,
      subtitles: [...timeline.subtitles, ...result.subtitles],
    };

    return { timeline: updatedTimeline, result };
  }

  exportSRT(timeline: Timeline): string {
    return exportSRT(timeline.subtitles);
  }

  addSubtitle(
    timeline: Timeline,
    text: string,
    startTime: number,
    endTime: number,
    style?: SubtitleStyle,
  ): { timeline: Timeline; subtitle: Subtitle } | { error: string } {
    if (endTime <= startTime) {
      return { error: "End time must be greater than start time" };
    }

    if (startTime < 0) {
      return { error: "Start time cannot be negative" };
    }

    const subtitle: Subtitle = {
      id: generateSubtitleId(),
      text,
      startTime,
      endTime,
      style: style || DEFAULT_SUBTITLE_STYLE,
    };

    const updatedTimeline: Timeline = {
      ...timeline,
      subtitles: [...timeline.subtitles, subtitle],
    };

    return { timeline: updatedTimeline, subtitle };
  }

  updateSubtitle(
    timeline: Timeline,
    subtitleId: string,
    updates: Partial<Pick<Subtitle, "text" | "startTime" | "endTime">>,
  ): { timeline: Timeline; subtitle: Subtitle } | { error: string } {
    const subtitleIndex = timeline.subtitles.findIndex(
      (s) => s.id === subtitleId,
    );

    if (subtitleIndex === -1) {
      return { error: "Subtitle not found" };
    }

    const existingSubtitle = timeline.subtitles[subtitleIndex];

    const newStartTime = updates.startTime ?? existingSubtitle.startTime;
    const newEndTime = updates.endTime ?? existingSubtitle.endTime;

    if (newEndTime <= newStartTime) {
      return { error: "End time must be greater than start time" };
    }

    if (newStartTime < 0) {
      return { error: "Start time cannot be negative" };
    }

    const updatedSubtitle: Subtitle = {
      ...existingSubtitle,
      text: updates.text ?? existingSubtitle.text,
      startTime: newStartTime,
      endTime: newEndTime,
    };

    const updatedSubtitles = [...timeline.subtitles];
    updatedSubtitles[subtitleIndex] = updatedSubtitle;

    const updatedTimeline: Timeline = {
      ...timeline,
      subtitles: updatedSubtitles,
    };

    return { timeline: updatedTimeline, subtitle: updatedSubtitle };
  }

  removeSubtitle(
    timeline: Timeline,
    subtitleId: string,
  ): { timeline: Timeline } | { error: string } {
    const subtitleIndex = timeline.subtitles.findIndex(
      (s) => s.id === subtitleId,
    );

    if (subtitleIndex === -1) {
      return { error: "Subtitle not found" };
    }

    const updatedTimeline: Timeline = {
      ...timeline,
      subtitles: timeline.subtitles.filter((s) => s.id !== subtitleId),
    };

    return { timeline: updatedTimeline };
  }

  setGlobalStyle(timeline: Timeline, style: SubtitleStyle): Timeline {
    return {
      ...timeline,
      subtitles: timeline.subtitles.map((subtitle) => ({
        ...subtitle,
        style,
      })),
    };
  }

  setSubtitleStyle(
    timeline: Timeline,
    subtitleId: string,
    style: SubtitleStyle,
  ): { timeline: Timeline } | { error: string } {
    const subtitleIndex = timeline.subtitles.findIndex(
      (s) => s.id === subtitleId,
    );

    if (subtitleIndex === -1) {
      return { error: "Subtitle not found" };
    }

    const updatedSubtitles = [...timeline.subtitles];
    updatedSubtitles[subtitleIndex] = {
      ...updatedSubtitles[subtitleIndex],
      style,
    };

    return {
      timeline: {
        ...timeline,
        subtitles: updatedSubtitles,
      },
    };
  }

  getSubtitleAtTime(timeline: Timeline, time: number): Subtitle | null {
    return (
      timeline.subtitles.find((s) => time >= s.startTime && time < s.endTime) ||
      null
    );
  }

  getSubtitlesInRange(
    timeline: Timeline,
    startTime: number,
    endTime: number,
  ): Subtitle[] {
    return timeline.subtitles.filter(
      (s) => s.endTime > startTime && s.startTime < endTime,
    );
  }

  getSortedSubtitles(timeline: Timeline): Subtitle[] {
    return [...timeline.subtitles].sort((a, b) => a.startTime - b.startTime);
  }

  shiftAllSubtitles(timeline: Timeline, offset: number): Timeline {
    return {
      ...timeline,
      subtitles: timeline.subtitles.map((subtitle) => ({
        ...subtitle,
        startTime: Math.max(0, subtitle.startTime + offset),
        endTime: Math.max(0.001, subtitle.endTime + offset),
      })),
    };
  }

  applyStylePreset(
    timeline: Timeline,
    presetName: string,
  ): { timeline: Timeline } | { error: string } {
    const preset = SUBTITLE_STYLE_PRESETS[presetName];

    if (!preset) {
      return { error: `Unknown style preset: ${presetName}` };
    }

    return {
      timeline: this.setGlobalStyle(timeline, preset),
    };
  }

  mergeAdjacentSubtitles(
    timeline: Timeline,
    gapThreshold: number = 0.1,
  ): Timeline {
    const sorted = this.getSortedSubtitles(timeline);

    if (sorted.length <= 1) {
      return timeline;
    }

    const merged: Subtitle[] = [];
    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      if (next.startTime <= current.endTime + gapThreshold) {
        current = {
          ...current,
          text: current.text + "\n" + next.text,
          endTime: Math.max(current.endTime, next.endTime),
        };
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);

    return {
      ...timeline,
      subtitles: merged,
    };
  }

  splitSubtitle(
    timeline: Timeline,
    subtitleId: string,
    splitTime: number,
  ):
    | { timeline: Timeline; subtitles: [Subtitle, Subtitle] }
    | { error: string } {
    const subtitle = timeline.subtitles.find((s) => s.id === subtitleId);

    if (!subtitle) {
      return { error: "Subtitle not found" };
    }

    if (splitTime <= subtitle.startTime || splitTime >= subtitle.endTime) {
      return { error: "Split time must be within subtitle duration" };
    }

    const firstHalf: Subtitle = {
      ...subtitle,
      endTime: splitTime,
    };

    const secondHalf: Subtitle = {
      ...subtitle,
      id: generateSubtitleId(),
      startTime: splitTime,
    };

    const updatedSubtitles = timeline.subtitles.filter(
      (s) => s.id !== subtitleId,
    );
    updatedSubtitles.push(firstHalf, secondHalf);

    return {
      timeline: {
        ...timeline,
        subtitles: updatedSubtitles,
      },
      subtitles: [firstHalf, secondHalf],
    };
  }

  clearAllSubtitles(timeline: Timeline): Timeline {
    return {
      ...timeline,
      subtitles: [],
    };
  }

  getStylePresets(): string[] {
    return Object.keys(SUBTITLE_STYLE_PRESETS);
  }

  getStylePreset(presetName: string): SubtitleStyle | undefined {
    return SUBTITLE_STYLE_PRESETS[presetName];
  }
}
