import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";
import type { EditingHost } from "./host";
import {
  EXPORT_REQUEST_PROPERTIES,
  checkExportRequest,
  parseExportRequest,
  preflightOutputPath,
  resolveFormatAndCodec,
  usesExtendedExportOptions,
  type ExportRequestInput,
  type ExportRequestIssue,
} from "./export-options";

/**
 * Export queue tools. Jobs snapshot the project when queued, so edits made
 * afterwards do not change a queued export; none of these touch the project,
 * so none create undo steps.
 */

const num: JSONSchema = { type: "number" };
const str: JSONSchema = { type: "string" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});

const UNSUPPORTED = "export queue is not supported by this host (needs the live editor)";

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const FORMATS = ["mp4", "webm", "mov", "mxf"] as const;
const CODECS = ["h264", "h265", "vp8", "vp9", "av1", "prores", "dnxhr", "xdcamhd422", "avcintra100"] as const;

const failIssue = (found: ExportRequestIssue): ToolResult => ({
  ok: false,
  summary: `${found.message} ${found.hint}`,
  error: { code: found.code, message: found.message, hint: found.hint },
});

/**
 * Parse an export request and check it against what this machine can do (get_export_options).
 * Hosts without a catalog (headless) skip the catalog check and keep the old behaviour.
 */
async function prepareExportRequest(
  args: Record<string, unknown>,
  host: EditingHost,
): Promise<{ ok: true; request: ExportRequestInput; resolved?: { format: string; codec: string } } | { ok: false; result: ToolResult }> {
  const parsed = parseExportRequest(args);
  if (!parsed.ok) return { ok: false, result: failIssue(parsed.issue) };
  const request = parsed.value;
  let resolved: { format: string; codec: string } | undefined;
  if (typeof host.exportOptions === "function") {
    const catalog = await host.exportOptions();
    const problem = checkExportRequest(request, catalog);
    if (problem) return { ok: false, result: failIssue(problem) };
    resolved = resolveFormatAndCodec(request, catalog);
  }
  const outputProblem = await preflightOutputPath(host, request);
  if (outputProblem) return { ok: false, result: failIssue(outputProblem) };
  return { ok: true, request, ...(resolved ? { resolved } : {}) };
}

const noProject = (): ToolResult => ({
  ok: false,
  summary: "No project is open. Call create_project or open_project_file first.",
  error: { code: "NO_PROJECT", message: "No project is open", hint: "Call create_project or open_project_file first." },
});

const hasOpenProject = (host: EditingHost): boolean => {
  try {
    host.requireOpenProject();
    return true;
  } catch {
    return false;
  }
};

export const GET_EXPORT_OPTIONS_TOOL: RegisteredTool = {
  name: "get_export_options",
  domain: "export",
  title: "Get export options",
  description:
    "List what export_video and queue_export can do on this machine, from the same sources as the Export dialog: formats[{id, container, codecs, bitDepths, hdr[sdr|pq|hlg], available, reason?, codecOptions, unavailableCodecs}], presets[{id, label, kind, format, codec, width, height, frameRate, bitrateKbps}] (pass an id as presetId), resolutions, frameRates, audioLayouts (mono|stereo|5.1), hdr {supported, reason?} and timecode {supported}. Call this before exporting anything but a plain MP4: an unsupported combination is refused with UNSUPPORTED and a hint that lists the valid alternatives. Read-only.",
  inputSchema: obj({}),
  readOnly: true,
  destructive: false,
  expensive: false,
  handler: async (_args, host) => {
    if (typeof host.exportOptions !== "function") {
      return {
        ok: false,
        summary: "Export options are not available in this host (needs the live editor).",
        error: { code: "UNSUPPORTED", message: "get_export_options needs the live editor", hint: "Run OpenReel desktop." },
      };
    }
    const catalog = await host.exportOptions();
    const usable = catalog.formats.filter((format) => format.available).map((format) => format.id);
    return ok(`${usable.length} usable format(s) (${usable.join(", ")}), ${catalog.presets.length} preset(s); HDR ${catalog.hdr.supported ? "available" : "unavailable"}`, catalog);
  },
};

export const EXPORT_VIDEO_TOOL: RegisteredTool = {
  name: "export_video",
  domain: "export",
  title: "Export video",
  description:
    "Render the whole project to a video file and wait for it (use queue_export for long or queued jobs). With no options it writes a standard MP4 (H.264). Call get_export_options first for anything else: format (mp4|mov|webm|mxf), codec, bitDepth (8|10), hdr (sdr|pq|hlg), width, height, frameRate, bitrateKbps, audioChannels (mono|stereo|5.1), timecode, presetId. outputPath (absolute, inside the allowed folders; see get_app_state mcp.allowedRoots) puts the file there, overwrite:true replaces an existing one; without it the file stays in the app's export folder and data.path says where. targetLufs (-40..-5) normalizes loudness with a true-peak ceiling (truePeakCeilingDb, default -1). An unsupported combination returns UNSUPPORTED with a hint listing valid alternatives. Result data: path, filename, bytes, sizeBytes, sha256, format, contentType. Expensive: requires confirmation.",
  inputSchema: obj({ ...EXPORT_REQUEST_PROPERTIES }),
  readOnly: false,
  destructive: false,
  expensive: true,
  handler: async (args, host) => {
    if (!hasOpenProject(host)) return noProject();
    const prepared = await prepareExportRequest(args, host);
    if (!prepared.ok) return prepared.result;
    const { request, resolved } = prepared;
    const extended = usesExtendedExportOptions(args);
    const params: Record<string, unknown> = {
      ...(request.format !== undefined ? { format: request.format } : {}),
      ...(request.targetLufs !== undefined ? { targetLufs: request.targetLufs } : {}),
      ...(request.truePeakCeilingDb !== undefined ? { truePeakCeilingDb: request.truePeakCeilingDb } : {}),
      ...(request.outputPath !== undefined ? { outputPath: request.outputPath, overwrite: request.overwrite === true } : {}),
    };
    if (extended) {
      for (const [key, value] of Object.entries(request)) if (value !== undefined) params[key] = value;
      if (resolved) {
        params.format = resolved.format;
        params.codec = resolved.codec;
      }
      params.extended = true;
    }
    const result = await host.runJob("exportVideo", params);
    if (!result.ok) {
      const message = result.error ?? "exportVideo job failed";
      return {
        ok: false,
        summary: result.hint ? `${message} ${result.hint}` : message,
        error: { code: result.code ?? "JOB_FAILED", message, ...(result.hint ? { hint: result.hint } : {}) },
      };
    }
    return ok("exportVideo job complete", result.data);
  },
};

export const EXPORT_QUEUE_TOOLS: RegisteredTool[] = [
  GET_EXPORT_OPTIONS_TOOL,
  {
    name: "queue_export",
    domain: "export",
    title: "Queue export",
    description:
      "Add a video export to the export queue (Export dialog > Add to queue) and, unless start=false, start the queue. The job captures the project as it is now: later edits do not change it. Give a quick preset id (mp4 | 4k | 1080p-high | 1080p-60) or explicit format (mp4|webm|mov), codec, width, height, frameRate and bitrate (kbps); anything omitted comes from the project. Optional rangeStart/rangeEnd (seconds, start<end) export only that span; filename overrides the output name; sequenceId renders that sequence instead of the active one (see list_sequences); usePreviews (default true) reuses frames from the preview render cache when it matches the export size and frame rate; smartRender (default true) stream-copies untouched, GOP-aligned runs of H.264 sources (also HEVC on desktop's native encoder) when codec, size and frame rate match the source and re-encodes everything else (finished jobs report 'Smart render: N% copied' in data.jobs[].smartRender, with reasons when less was copied). captions: [{captionTrackId (\"\" = default), burnIn (default true: draw the track into the picture), embedded: none|subtitle|cea608}] sets per-track caption delivery - \"subtitle\" embeds a subtitle track (WebVTT in browser MP4, tx3g mov_text in desktop MP4/MOV) and \"cea608\" embeds CEA-608 as a c608 track in desktop MOV (MP4 falls back to tx3g); a track with burnIn false is left out of the picture (smart render may then stream-copy under it). Jobs run one at a time. Also takes the export_video options: presetId (any id from get_export_options), codec incl. prores/dnxhr/xdcamhd422/avcintra100, format mxf, bitDepth, hdr (sdr|pq|hlg), audioChannels, timecode, targetLufs and outputPath (absolute, inside the allowed folders; overwrite:true replaces a file): when the job completes the file is placed there and list_export_jobs reports outputPath, outputBytes and sha256. An unsupported combination returns UNSUPPORTED with a hint. Returns data.jobId; poll list_export_jobs. Not an edit: no undo step. Expensive - requires confirmation.",
    inputSchema: obj({
      ...EXPORT_REQUEST_PROPERTIES,
      preset: str,
      format: { type: "string", enum: [...FORMATS] },
      codec: { type: "string", enum: [...CODECS] },
      bitrate: num,
      rangeStart: num,
      rangeEnd: num,
      usePreviews: bool,
      smartRender: bool,
      filename: str,
      sequenceId: str,
      start: bool,
      captions: {
        type: "array",
        items: obj(
          {
            captionTrackId: str,
            burnIn: bool,
            embedded: { type: "string", enum: ["none", "subtitle", "cea608"] },
          },
          ["captionTrackId"],
        ),
      },
    }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      if (typeof host.exportQueue?.enqueue !== "function") return fail(UNSUPPORTED, "UNSUPPORTED");
      if (!hasOpenProject(host)) return noProject();
      const rangeStart = optionalNumber(args.rangeStart);
      const rangeEnd = optionalNumber(args.rangeEnd);
      if ((rangeStart === undefined) !== (rangeEnd === undefined)) {
        return fail("Pass both rangeStart and rangeEnd, or neither.", "INVALID_PARAMS");
      }
      if (rangeStart !== undefined && rangeEnd !== undefined && (rangeStart < 0 || rangeEnd <= rangeStart)) {
        return fail("rangeStart must be >= 0 and rangeEnd must be greater than rangeStart.", "INVALID_PARAMS");
      }
      const format = optionalString(args.format);
      if (format !== undefined && !(FORMATS as readonly string[]).includes(format)) {
        return fail(`format must be one of ${FORMATS.join(", ")}.`, "INVALID_PARAMS");
      }
      const codec = optionalString(args.codec);
      if (codec !== undefined && !(CODECS as readonly string[]).includes(codec)) {
        return fail(`codec must be one of ${CODECS.join(", ")}.`, "INVALID_PARAMS");
      }
      for (const key of ["width", "height", "frameRate", "bitrate"] as const) {
        const value = optionalNumber(args[key]);
        if (args[key] !== undefined && (value === undefined || value <= 0)) {
          return fail(`${key} must be a positive number.`, "INVALID_PARAMS");
        }
      }
      const prepared = await prepareExportRequest(args, host);
      if (!prepared.ok) return prepared.result;
      const extra = prepared.request;
      const extended = usesExtendedExportOptions(args);
      let captions: Array<{ captionTrackId: string; burnIn?: boolean; embedded?: "none" | "subtitle" | "cea608" }> | undefined;
      if (args.captions !== undefined) {
        if (!Array.isArray(args.captions)) return fail("captions must be an array.", "INVALID_PARAMS");
        captions = [];
        for (const entry of args.captions as Array<Record<string, unknown>>) {
          if (!entry || typeof entry.captionTrackId !== "string")
            return fail("Each captions entry needs a captionTrackId string.", "INVALID_PARAMS");
          if (entry.embedded !== undefined && !["none", "subtitle", "cea608"].includes(String(entry.embedded)))
            return fail("captions[].embedded must be none, subtitle or cea608.", "INVALID_PARAMS");
          captions.push({
            captionTrackId: entry.captionTrackId,
            ...(typeof entry.burnIn === "boolean" ? { burnIn: entry.burnIn } : {}),
            ...(entry.embedded ? { embedded: entry.embedded as "none" | "subtitle" | "cea608" } : {}),
          });
        }
      }
      try {
        const job = await host.exportQueue.enqueue({
          preset: extra.presetId,
          format: extended && prepared.resolved ? (prepared.resolved.format as (typeof FORMATS)[number]) : (format as (typeof FORMATS)[number] | undefined),
          codec: extended && prepared.resolved ? (prepared.resolved.codec as (typeof CODECS)[number]) : (codec as (typeof CODECS)[number] | undefined),
          width: optionalNumber(args.width),
          height: optionalNumber(args.height),
          frameRate: optionalNumber(args.frameRate),
          bitrate: extra.bitrateKbps,
          ...(extra.maxBitrateKbps !== undefined ? { maxBitrateKbps: extra.maxBitrateKbps } : {}),
          ...(extra.rateControl !== undefined ? { rateControl: extra.rateControl } : {}),
          ...(extra.bitDepth !== undefined ? { bitDepth: extra.bitDepth } : {}),
          ...(extra.hdr !== undefined ? { hdr: extra.hdr } : {}),
          ...(extra.audioChannels !== undefined ? { audioChannels: extra.audioChannels } : {}),
          ...(extra.timecode !== undefined ? { timecode: extra.timecode } : {}),
          ...(extra.targetLufs !== undefined ? { targetLufs: extra.targetLufs } : {}),
          ...(extra.truePeakCeilingDb !== undefined ? { truePeakCeilingDb: extra.truePeakCeilingDb } : {}),
          ...(extra.outputPath !== undefined ? { outputPath: extra.outputPath, overwrite: extra.overwrite === true } : {}),
          rangeStart,
          rangeEnd,
          usePreviews: typeof args.usePreviews === "boolean" ? args.usePreviews : undefined,
          smartRender: typeof args.smartRender === "boolean" ? args.smartRender : undefined,
          filename: optionalString(args.filename),
          sequenceId: optionalString(args.sequenceId),
          ...(captions ? { captions } : {}),
          start: args.start === false ? false : true,
        });
        return ok(`Queued export ${job.outputName} (${job.presetLabel})`, { jobId: job.id, job });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Could not queue the export", "QUEUE_FAILED");
      }
    },
  },
  {
    name: "list_export_jobs",
    domain: "export",
    title: "List export jobs",
    description:
      "List the export queue: data.jobs with id, outputName, sequenceName, presetLabel, status (queued|running|completed|failed|cancelled|interrupted), progress (0..1), elapsedMs, etaMs, range, usePreviews, framesFromCache, smartRender ({copiedPercent, summary, reasons} once finished), error and outputPath (desktop). Read-only.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (_args, host) => {
      if (typeof host.exportQueue?.list !== "function") return fail(UNSUPPORTED, "UNSUPPORTED");
      const jobs = host.exportQueue.list();
      const running = jobs.filter((job) => job.status === "running").length;
      const queued = jobs.filter((job) => job.status === "queued").length;
      return ok(`${jobs.length} export job(s): ${running} running, ${queued} queued`, { jobs });
    },
  },
  {
    name: "cancel_export_job",
    domain: "export",
    title: "Cancel export job",
    description:
      "Cancel a queued or running export job by jobId (from queue_export / list_export_jobs). A queued job is dropped from the line; a running job stops at the next frame. Finished jobs are left as they are. Not an edit: no undo step.",
    inputSchema: obj({ jobId: str }, ["jobId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      if (typeof host.exportQueue?.cancel !== "function") return fail(UNSUPPORTED, "UNSUPPORTED");
      const jobId = optionalString(args.jobId);
      if (!jobId) return fail("jobId is required.", "INVALID_PARAMS");
      const result = host.exportQueue.cancel(jobId);
      if (!result.found) return fail(`Export job not found: ${jobId}`, "NOT_FOUND");
      return ok(`Export job ${jobId} is ${result.status ?? "cancelled"}`, { jobId, status: result.status });
    },
  },
];
