import type { Project } from "@openreel/core/types/project";
import type { Subtitle } from "@openreel/core/types/timeline";
import type { TimelineToolPlan } from "@openreel/core/editing/timeline-tool-edit";
import {
  CAPTION_EXPORT_FORMATS,
  CAPTION_FORMAT_INFO,
  listCaptionTracks,
  type CaptionExportFormat,
} from "@openreel/core/captions/caption-formats";
import { exportCaptionFileAsync, importCaptionFile, looksLikeTranscriptJson } from "@openreel/core/captions/caption-import";
import { checkCaptions } from "@openreel/core/captions/caption-qc";
import { planEmbeddedCaptions } from "@openreel/core/captions/caption-export";
import {
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  findFillerWords,
  findPauses,
  parseTranscriptJson,
  renameSpeaker,
  type TimeRange,
} from "@openreel/core/captions/transcript";
import { cutDuration, planTranscriptCut } from "@openreel/core/captions/transcript-edit";
import type { EditingHost, TimelinePlanBuilder } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Captions and transcript editing for agents. Reads the same caption cues the
 * Transcript panel shows (`timeline.subtitles`, word-timed when available) and
 * cuts through the same sync-lock aware planner, so each edit is ONE undo step
 * and linked picture/sound stay together.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const obj = (
  properties: Record<string, JSONSchema>,
  required: string[] = [],
): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const round = (value: number, places = 3): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

function guarded(
  run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult,
): RegisteredTool["handler"] {
  return async (args, host) => {
    try {
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request", "INVALID_PARAMS");
    }
  };
}

const trackOption = (args: Record<string, unknown>): { captionTrackId?: string } =>
  typeof args.captionTrackId === "string" ? { captionTrackId: args.captionTrackId } : {};

async function commitCut(
  host: EditingHost,
  build: TimelinePlanBuilder,
): Promise<{ ok: true; plan: TimelineToolPlan } | { ok: false; error: ToolResult }> {
  host.requireOpenProject();
  if (host.commitTimelinePlan) {
    const result = await host.commitTimelinePlan(build);
    if (!result.success)
      return {
        ok: false,
        error: fail(result.error?.message ?? "The edit failed", result.error?.code ?? "ACTION_FAILED"),
      };
    if (!result.plan) return { ok: false, error: fail("The edit produced no plan", "ACTION_FAILED") };
    return { ok: true, plan: result.plan };
  }
  const plan = build(host.getProject());
  const result = await host.applyAction({
    type: "timeline/toolEdit",
    id: genId(),
    timestamp: Date.now(),
    params: { edits: plan.edits, label: plan.label },
  });
  if (!result.success)
    return {
      ok: false,
      error: fail(result.error?.message ?? "The edit failed", result.error?.code ?? "ACTION_FAILED"),
    };
  return { ok: true, plan };
}

async function cutRanges(
  host: EditingHost,
  ranges: readonly TimeRange[],
  label: string,
  noun: string,
): Promise<ToolResult> {
  const outcome = await commitCut(host, (project: Project) =>
    planTranscriptCut(project, ranges, genId(), label),
  );
  if (!outcome.ok) return outcome.error;
  const removed = round(cutDuration(ranges));
  return ok(`${noun}: removed ${removed}s from the sequence (one undo step)`, {
    removed,
    cuts: ranges.length,
    ranges: ranges.map((r) => ({ start: round(r.start), end: round(r.end) })),
  });
}

const subtitlesOf = (host: EditingHost): Subtitle[] => host.getProject().timeline.subtitles;

async function setSubtitles(host: EditingHost, subtitles: Subtitle[]): Promise<ToolResult | null> {
  const result = await host.applyAction({
    type: "subtitle/setAll",
    id: genId(),
    timestamp: Date.now(),
    params: { subtitles },
  });
  return result.success
    ? null
    : fail(result.error?.message ?? "The caption change failed", result.error?.code ?? "ACTION_FAILED");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function readFormat(value: unknown): CaptionExportFormat {
  const format = typeof value === "string" ? value.toLowerCase() : "vtt";
  if (!(CAPTION_EXPORT_FORMATS as readonly string[]).includes(format))
    throw new Error(`format must be one of ${CAPTION_EXPORT_FORMATS.join(", ")}.`);
  return format as CaptionExportFormat;
}

const phrasesOf = (args: Record<string, unknown>): string[] => {
  if (args.fillers === undefined) return [...DEFAULT_FILLER_PHRASES];
  if (!Array.isArray(args.fillers) || args.fillers.some((p) => typeof p !== "string"))
    throw new Error("fillers must be an array of words or phrases.");
  return args.fillers as string[];
};

export const CAPTION_TOOLS: RegisteredTool[] = [
  {
    name: "get_caption_transcript",
    domain: "subtitle",
    title: "Get caption transcript",
    description:
      "Read the caption transcript: words with start/end seconds and speakers, plus sentences (word index ranges) and the caption tracks. Words of cues without word timings carry estimated:true. Optional captionTrackId (\"\" = default track), speaker filter, and limit/offset over words (default 400). Read-only; use it to pick the times for transcript_cut_range.",
    inputSchema: obj({ captionTrackId: str, speaker: str, offset: num, limit: num }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      host.requireOpenProject();
      const subtitles = subtitlesOf(host);
      const transcript = buildTranscript(subtitles, trackOption(args));
      const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
      const limit = Math.min(2000, Math.max(1, Math.floor(Number(args.limit ?? 400)) || 400));
      const speaker = typeof args.speaker === "string" ? args.speaker : undefined;
      const all = transcript.words.filter((w) => speaker === undefined || w.speaker === speaker);
      const page = all.slice(offset, offset + limit);
      return ok(`${all.length} words, ${transcript.sentences.length} sentences`, {
        tracks: listCaptionTracks(subtitles),
        totalWords: all.length,
        offset,
        words: page.map((w) => ({
          index: w.index,
          text: w.text,
          start: round(w.start),
          end: round(w.end),
          ...(w.speaker ? { speaker: w.speaker } : {}),
          ...(w.estimated ? { estimated: true } : {}),
        })),
        sentences: transcript.sentences.map((s) => ({
          index: s.index,
          wordStart: s.wordStart,
          wordEnd: s.wordEnd - 1,
          start: round(s.start),
          end: round(s.end),
          ...(s.speaker ? { speaker: s.speaker } : {}),
        })),
      });
    }),
  },
  {
    name: "export_captions",
    domain: "subtitle",
    title: "Export captions",
    description:
      "Render the project's captions as a file: format srt, vtt (WebVTT with <v Speaker> voice tags), ttml (TTML/IMSC1), scc (CEA-608 pop-on, 32-column rows, <i>/<u> as mid-row codes), mcc (MacCaption: the same CEA-608 captions, one CDP per frame) or stl (EBU-STL, binary: returned as data.contentBase64). One track per call (captionTrackId, \"\" = default; omit for all). includeSpeakers true prefixes SRT cues with \"Name: \"; false drops speaker names everywhere (unset keeps WebVTT voice tags and TTML agents). SCC/MCC/STL options: frameRate (SCC/MCC default 29.97 DF, STL 25; 23.976 and 59.94 need it set), dropFrame, offsetSeconds (programme start, e.g. 3600), title (STL). SCC/MCC/STL return data.issues (wrapped lines, dropped rows, substituted characters, delayed captions). embedded: \"subtitle\" or \"cea608\" instead returns data.embedded, the subtitle track a video export would embed (payload text and warnings) for context mp4|mov and desktop:true|false. Read-only.",
    inputSchema: obj({
      format: { type: "string", enum: [...CAPTION_EXPORT_FORMATS] },
      captionTrackId: str,
      includeSpeakers: bool,
      language: str,
      frameRate: num,
      dropFrame: bool,
      offsetSeconds: num,
      title: str,
      embedded: { type: "string", enum: ["subtitle", "cea608"] },
      container: { type: "string", enum: ["mp4", "mov"] },
      desktop: bool,
    }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const subtitles = subtitlesOf(host);
      const track = trackOption(args);
      const any = subtitles.some(
        (cue) => track.captionTrackId === undefined || (cue.captionTrackId ?? "") === track.captionTrackId,
      );
      if (!any) return fail("There are no captions to export.", "NO_CAPTIONS");
      const frameRate = typeof args.frameRate === "number" && args.frameRate > 0 ? args.frameRate : undefined;
      if (typeof args.embedded === "string") {
        if (args.embedded !== "subtitle" && args.embedded !== "cea608")
          return fail('embedded must be "subtitle" or "cea608".', "INVALID_PARAMS");
        const container = args.container === "mov" ? "mov" : "mp4";
        const plan = planEmbeddedCaptions(
          subtitles,
          { tracks: [{ captionTrackId: track.captionTrackId ?? "", burnIn: true, sidecar: "none", embedded: args.embedded }] },
          {
            format: container,
            engine: args.desktop === true ? "native" : "web",
            frameRate: frameRate ?? host.getProject().settings.frameRate,
          },
        );
        return ok(`Embedded caption plan: ${plan.payloads.length} track(s), ${plan.warnings.length} warning(s)`, {
          embedded: plan.payloads,
          warnings: plan.warnings,
        });
      }
      const format = readFormat(args.format);
      const file = await exportCaptionFileAsync(subtitles, format, {
        ...track,
        // Unset keeps WebVTT voice tags and TTML agents and leaves SRT unprefixed; false drops them everywhere.
        ...(typeof args.includeSpeakers === "boolean" ? { includeSpeakers: args.includeSpeakers } : {}),
        ...(typeof args.language === "string" ? { language: args.language } : {}),
        ...(frameRate ? { frameRate } : {}),
        ...(typeof args.dropFrame === "boolean" ? { dropFrame: args.dropFrame } : {}),
        ...(typeof args.offsetSeconds === "number" ? { offsetSeconds: args.offsetSeconds } : {}),
        ...(typeof args.title === "string" ? { title: args.title } : {}),
      });
      const info = CAPTION_FORMAT_INFO[format];
      const content = info.binary ? undefined : new TextDecoder().decode(file.bytes);
      return ok(`Exported ${info.label} (${file.bytes.length} bytes${file.issues.length ? `, ${file.issues.length} validation note(s)` : ""})`, {
        format,
        mimeType: file.mimeType,
        extension: file.extension,
        ...(content !== undefined ? { content } : { contentBase64: toBase64(file.bytes), bytes: file.bytes.length }),
        ...(file.issues.length ? { issues: file.issues } : {}),
      });
    }),
  },
  {
    name: "caption_qc",
    domain: "subtitle",
    title: "Caption QC",
    description:
      "Quality-check the captions: reading speed (characters/second and words/minute), rows per cue, characters per row, minimum/maximum duration, gaps shorter than minGapFrames frames and overlaps. Defaults: maxCps 17, maxWpm 180, maxLines 2, maxCharsPerLine 42, minDuration 0.833s, maxDuration 7s, minGapFrames 2, frameRate = the project's. One caption track via captionTrackId (\"\" = default). Returns data.issues (code, severity, cueId, cueIndex, time in seconds to jump to, message, value, limit), data.counts, data.averageCps, data.worstCps. Read-only: fix problems with the caption edit tools.",
    inputSchema: obj({
      captionTrackId: str,
      frameRate: num,
      maxCps: num,
      maxWpm: num,
      maxLines: num,
      maxCharsPerLine: num,
      minDuration: num,
      maxDuration: num,
      minGapFrames: num,
    }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((args, host) => {
      host.requireOpenProject();
      const subtitles = subtitlesOf(host);
      if (!subtitles.length) return fail("There are no captions to check.", "NO_CAPTIONS");
      const numbers: Record<string, number> = {};
      for (const key of ["frameRate", "maxCps", "maxWpm", "maxLines", "maxCharsPerLine", "minDuration", "maxDuration", "minGapFrames"]) {
        const value = args[key];
        if (value !== undefined && (typeof value !== "number" || !(value > 0)))
          return fail(`${key} must be a positive number.`, "INVALID_PARAMS");
        if (typeof value === "number") numbers[key] = value;
      }
      const report = checkCaptions(subtitles, {
        frameRate: host.getProject().settings.frameRate,
        ...numbers,
        ...trackOption(args),
      });
      return ok(
        report.issues.length
          ? `${report.errorCount} error(s), ${report.warningCount} warning(s) across ${report.cueCount} captions`
          : `${report.cueCount} captions pass every check`,
        report,
      );
    }),
  },
  {
    name: "import_captions",
    domain: "subtitle",
    title: "Import captions",
    description:
      "Add captions from a caption file; the format is detected from the content. Text formats go in `content`: SRT, WebVTT (speakers from <v Name>), SBV, TTML / DFXP / iTT (styles, regions, agents, SMPTE drop-frame times), SCC (pop-on, paint-on, roll-up; frameRate default 29.97, drop-frame from the timecode separator), MCC (CEA-608 in CDP packets; 708 is reported, not decoded; 24/30/60 vs 23.976/29.97/59.94 follows the project rate), a timed text transcript ([00:01:02] lines) or word-timed transcript JSON ({segments:[{start,end,speaker?,words:[{word,start,end}]}]}). Binary EBU-STL goes in `contentBase64`. For SCC/MCC, ccChannel (1-4, default 1) picks CC1..CC4; row/indent become an approximate position, PAC/mid-row colours the cue colour. For SCC/MCC/STL, offsetSeconds is subtracted from every time (the file's programme start) and styleTags:\"keep\" keeps <i>/<u>. Optional captionTrackId and language put the cues on their own caption track (e.g. a translation). data.format is the detected format. data.issues lists what the caption model cannot hold (other channels, text service, colours, flashing, approximated positions, 708, ...), data.skipped the unreadable blocks: relay both to the user. One undo step.",
    inputSchema: obj(
      {
        content: str,
        contentBase64: str,
        captionTrackId: str,
        language: str,
        frameRate: num,
        offsetSeconds: num,
        styleTags: { type: "string", enum: ["keep", "strip"] },
        ccChannel: { type: "integer", enum: [1, 2, 3, 4] },
      },
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const hasText = typeof args.content === "string" && args.content.trim() !== "";
      const hasBinary = typeof args.contentBase64 === "string" && args.contentBase64 !== "";
      if (!hasText && !hasBinary) return fail("content (or contentBase64 for EBU-STL) is required.", "INVALID_PARAMS");
      const options = {
        ...(typeof args.captionTrackId === "string" && args.captionTrackId
          ? { captionTrackId: args.captionTrackId }
          : {}),
        ...(typeof args.language === "string" && args.language ? { language: args.language } : {}),
      };
      const broadcast = {
        ...options,
        projectFrameRate: host.getProject().settings.frameRate,
        ...(typeof args.frameRate === "number" && args.frameRate > 0 ? { frameRate: args.frameRate } : {}),
        ...(typeof args.offsetSeconds === "number" ? { offsetSeconds: args.offsetSeconds } : {}),
        ...(args.styleTags === "keep" ? { styleTags: "keep" as const } : {}),
        ...(args.ccChannel === 1 || args.ccChannel === 2 || args.ccChannel === 3 || args.ccChannel === 4
          ? { ccChannel: args.ccChannel as 1 | 2 | 3 | 4 }
          : {}),
      };
      let issues: unknown[] = [];
      let format: string | undefined;
      const trimmed = hasText ? (args.content as string).trimStart() : "";
      let parsed: { subtitles: Subtitle[]; errors: string[] };
      if (!hasBinary && looksLikeTranscriptJson(trimmed)) {
        parsed = parseTranscriptJson(args.content as string, { ...options, idPrefix: `tr-${genId().slice(0, 8)}` });
        format = "transcript-json";
      } else {
        const bytes = hasBinary ? fromBase64(args.contentBase64 as string) : new TextEncoder().encode(args.content as string);
        const r = await importCaptionFile(bytes, broadcast);
        issues = r.issues;
        format = r.format;
        parsed = { subtitles: r.subtitles, errors: r.errors.map((e) => `Line ${e.line}: ${e.message}`) };
      }
      if (!parsed.subtitles.length)
        return fail(parsed.errors[0] ?? "No captions were found.", "INVALID_PARAMS");
      const failure = await setSubtitles(host, [...subtitlesOf(host), ...parsed.subtitles]);
      if (failure) return failure;
      return ok(`Imported ${parsed.subtitles.length} captions (one undo step)`, {
        added: parsed.subtitles.length,
        ...(format ? { format } : {}),
        skipped: parsed.errors,
        ...(issues.length ? { issues } : {}),
      });
    }),
  },
  {
        name: "rename_speaker",
    domain: "subtitle",
    title: "Rename speaker",
    description:
      "Rename a speaker on every caption (renaming onto an existing speaker merges them; an empty `to` clears the label). One undo step.",
    inputSchema: obj({ from: str, to: str }, ["from", "to"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      if (typeof args.from !== "string" || typeof args.to !== "string")
        return fail("from and to are required.", "INVALID_PARAMS");
      const current = subtitlesOf(host);
      const next = renameSpeaker(current, args.from, args.to);
      if (next === current) return fail(`No captions are labelled "${args.from}".`, "NO_CHANGE");
      const failure = await setSubtitles(host, next);
      if (failure) return failure;
      const changed = current.filter((c) => c.speaker === args.from).length;
      return ok(`Renamed "${args.from}" to "${args.to}" on ${changed} captions (one undo step)`, { changed });
    }),
  },
  {
    name: "merge_speakers",
    domain: "subtitle",
    title: "Merge speakers",
    description:
      "Merge speaker `from` into the existing speaker `into`: every caption labelled `from` takes `into` (and its look). Use when speaker detection split one voice in two. One undo step.",
    inputSchema: obj({ from: str, into: str }, ["from", "into"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      if (typeof args.from !== "string" || typeof args.into !== "string" || !args.from.trim() || !args.into.trim())
        return fail("from and into are required.", "INVALID_PARAMS");
      if (args.from === args.into) return fail("Pick two different speakers.", "INVALID_PARAMS");
      const current = subtitlesOf(host);
      if (!current.some((c) => c.speaker === args.into))
        return fail(`No captions are labelled "${args.into}". Use rename_speaker to rename instead.`, "NO_CHANGE");
      const next = renameSpeaker(current, args.from, args.into);
      if (next === current) return fail(`No captions are labelled "${args.from}".`, "NO_CHANGE");
      const failure = await setSubtitles(host, next);
      if (failure) return failure;
      const changed = current.filter((c) => c.speaker === args.from).length;
      return ok(`Merged "${args.from}" into "${args.into}" on ${changed} captions (one undo step)`, { changed });
    }),
  },
  {
    name: "transcript_cut_range",
    domain: "clip",
    title: "Cut transcript range",
    description:
      "Ripple-cut a time range [start, end] (seconds, as read from get_caption_transcript) out of the sequence the way deleting that text in the Transcript panel does: every unlocked sync-locked track is cut and closed together (linked picture and sound stay in sync), markers and captions ripple, one undo step. Fails (nothing changes) if a linked partner sits on a locked or not sync-locked track.",
    inputSchema: obj({ start: num, end: num }, ["start", "end"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const { start, end } = args;
      if (typeof start !== "number" || typeof end !== "number" || !(end > start) || start < 0)
        return fail("start and end must be seconds with end greater than start.", "INVALID_PARAMS");
      return cutRanges(host, [{ start, end }], "Delete transcript text", `Cut ${round(start)}s-${round(end)}s`);
    }),
  },
  {
    name: "remove_filler_words",
    domain: "clip",
    title: "Remove filler words",
    description:
      `Find filler words in the transcript (default list: ${DEFAULT_FILLER_PHRASES.join(", ")}; override with fillers) and ripple-cut each one out, all as ONE undo step. Pass preview:true to only list what would be removed (text, start, end) without editing. Same sync-lock and linked-clip rules as transcript_cut_range.`,
    inputSchema: obj({
      fillers: { type: "array", items: str },
      preview: bool,
      captionTrackId: str,
    }),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      const words = buildTranscript(subtitlesOf(host), trackOption(args)).words;
      const found = findFillerWords(words, phrasesOf(args));
      const listing = found.map((f) => ({
        text: f.text,
        start: round(f.start),
        end: round(f.end),
      }));
      if (args.preview === true)
        return ok(`${found.length} filler words found (${round(cutDuration(found))}s)`, { fillers: listing });
      if (!found.length) return fail("No filler words found.", "NO_CHANGE");
      const result = await cutRanges(
        host,
        found.map((f) => ({ start: f.start, end: f.end })),
        "Remove filler words",
        `Removed ${found.length} filler words`,
      );
      return result.ok ? { ...result, data: { ...(result.data as object), fillers: listing } } : result;
    }),
  },
  {
    name: "remove_pauses",
    domain: "clip",
    title: "Remove pauses",
    description:
      "Ripple-cut pauses longer than minDuration seconds between spoken words, leaving `keep` seconds (default 0.2) of breathing room at each, all as ONE undo step. preview:true lists them without editing.",
    inputSchema: obj({ minDuration: num, keep: num, preview: bool, captionTrackId: str }, ["minDuration"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      host.requireOpenProject();
      if (typeof args.minDuration !== "number" || args.minDuration < 0)
        return fail("minDuration must be zero or more seconds.", "INVALID_PARAMS");
      const words = buildTranscript(subtitlesOf(host), trackOption(args)).words;
      const pauses = findPauses(words, args.minDuration, {
        ...(typeof args.keep === "number" ? { keep: args.keep } : {}),
      });
      const listing = pauses.map((p) => ({
        start: round(p.start),
        end: round(p.end),
        gap: round(p.gap),
        cutStart: round(p.cut.start),
        cutEnd: round(p.cut.end),
      }));
      if (args.preview === true)
        return ok(`${pauses.length} pauses found`, { pauses: listing });
      if (!pauses.length) return fail("No pauses that long.", "NO_CHANGE");
      return cutRanges(
        host,
        pauses.map((p) => p.cut),
        "Remove pauses",
        `Removed ${pauses.length} pauses`,
      );
    }),
  },
];
