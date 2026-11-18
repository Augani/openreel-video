import type { EditingHost, ExportFormatOption, ExportOptionsCatalog, HostFileErrorCode } from "./host";
import type { JSONSchema } from "./types";

/**
 * Shared export-request rules for export_video and queue_export: the argument schema, parsing,
 * and validation against the catalog `get_export_options` returns. Pure, so the live host and the
 * tests agree. An unsupported combination answers UNSUPPORTED with a hint listing what the catalog
 * does offer.
 */

export const EXPORT_FORMAT_IDS = ["mp4", "mov", "webm", "mxf"] as const;
export const EXPORT_CODEC_IDS = ["h264", "h265", "vp8", "vp9", "av1", "prores", "dnxhr", "xdcamhd422", "avcintra100"] as const;
export const EXPORT_HDR_IDS = ["sdr", "pq", "hlg"] as const;
export const EXPORT_AUDIO_LAYOUTS = ["mono", "stereo", "5.1"] as const;

export type ExportFormatId = (typeof EXPORT_FORMAT_IDS)[number];
export type ExportCodecId = (typeof EXPORT_CODEC_IDS)[number];

/** Properties shared by export_video and queue_export (queue_export adds range, captions, ...). */
export const EXPORT_REQUEST_PROPERTIES: Record<string, JSONSchema> = {
  format: { type: "string", enum: [...EXPORT_FORMAT_IDS], description: "Container. Call get_export_options for what this machine can write." },
  presetId: { type: "string", description: "A preset id from get_export_options presets[]. Explicit fields below override it." },
  codec: { type: "string", enum: [...EXPORT_CODEC_IDS] },
  bitDepth: { type: "number", enum: [8, 10], description: "10 needs a codec that carries it (see get_export_options)." },
  hdr: { type: "string", enum: [...EXPORT_HDR_IDS], description: "sdr (default), pq (HDR10 / ST 2084) or hlg. HDR is 10-bit H.265 (or ProRes 4444 XQ on desktop)." },
  width: { type: "number" },
  height: { type: "number" },
  frameRate: { type: "number" },
  bitrateKbps: { type: "number", description: "Video bitrate in kbps. Ignored by ProRes, DNxHR and the broadcast codecs, which are profile-rated." },
  maxBitrateKbps: { type: "number", description: "Peak video bitrate cap in kbps. Switches to one-pass variable-bitrate rate control: bitrateKbps is the average, this the cap (desktop encoders apply both; the browser encoder applies the average only). Must be at least bitrateKbps." },
  rateControl: { type: "string", enum: ["quality", "vbr", "vbr2"], description: "quality (default) = constant quality; vbr = one-pass, hit bitrateKbps on average; vbr2 = true two-pass VBR (desktop app, H.264 / H.265 only, slower: the frames are analysed, then encoded; not with a Rec.2020 sequence or HDR; clips under ~10 s can overshoot the target by 6-7 %). Implied by maxBitrateKbps." },
  bitrateMode: { type: "string", enum: ["cbr", "vbr1", "vbr2"], description: "Shorthand for the rate control: cbr = hold bitrateKbps (peak cap equals the target), vbr1 = one-pass VBR, vbr2 = two-pass VBR (desktop, H.264 / H.265). Uses bitrateKbps as the target and maxBitrateKbps as the peak cap." },
  audioChannels: { type: "string", enum: [...EXPORT_AUDIO_LAYOUTS] },
  timecode: { type: "boolean", description: "Write the sequence start timecode (MOV / MXF, desktop)." },
  targetLufs: { type: "number", description: "Normalize the mix to this integrated loudness (-40..-5)." },
  truePeakCeilingDb: { type: "number", description: "True-peak ceiling for targetLufs (-20..0, default -1)." },
  outputPath: { type: "string", description: "Absolute destination file, inside the allowed folders (Settings > MCP). Omit to keep the app's own output file." },
  overwrite: { type: "boolean", description: "Replace an existing file at outputPath (default false)." },
};

export interface ExportRequestInput {
  readonly format?: ExportFormatId;
  readonly presetId?: string;
  readonly codec?: ExportCodecId;
  readonly bitDepth?: 8 | 10;
  readonly hdr?: "sdr" | "pq" | "hlg";
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly bitrateKbps?: number;
  readonly maxBitrateKbps?: number;
  readonly rateControl?: "quality" | "vbr" | "vbr2";
  readonly audioChannels?: "mono" | "stereo" | "5.1";
  readonly timecode?: boolean;
  readonly targetLufs?: number;
  readonly truePeakCeilingDb?: number;
  readonly outputPath?: string;
  readonly overwrite?: boolean;
}

export interface ExportRequestIssue {
  readonly code: HostFileErrorCode;
  readonly message: string;
  readonly hint: string;
}

const issue = (code: ExportRequestIssue["code"], message: string, hint: string): ExportRequestIssue => ({ code, message, hint });

const optString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** True when the arguments use anything beyond the legacy export_video surface (format, loudness, outputPath). */
export function usesExtendedExportOptions(args: Record<string, unknown>): boolean {
  return Object.keys(EXPORT_REQUEST_PROPERTIES).some((key) => !["format", "targetLufs", "truePeakCeilingDb", "outputPath", "overwrite"].includes(key) && args[key] !== undefined);
}

/** Parse and type-check raw tool arguments. `bitrate` and `preset` (queue_export's older names) are accepted as aliases. */
export function parseExportRequest(args: Record<string, unknown>): { ok: true; value: ExportRequestInput } | { ok: false; issue: ExportRequestIssue } {
  const bad = (field: string, expectation: string): { ok: false; issue: ExportRequestIssue } => ({
    ok: false,
    issue: issue("INVALID_PARAMS", `${field} ${expectation}.`, "Call get_export_options to see the valid values."),
  });
  const out: { -readonly [K in keyof ExportRequestInput]: ExportRequestInput[K] } = {};

  const format = optString(args.format)?.toLowerCase();
  if (args.format !== undefined) {
    if (!format || !(EXPORT_FORMAT_IDS as readonly string[]).includes(format)) return bad("format", `must be one of ${EXPORT_FORMAT_IDS.join(", ")}`);
    out.format = format as ExportFormatId;
  }
  const preset = optString(args.presetId) ?? optString(args.preset);
  if (preset) out.presetId = preset;
  if (args.codec !== undefined) {
    const codec = optString(args.codec)?.toLowerCase();
    if (!codec || !(EXPORT_CODEC_IDS as readonly string[]).includes(codec)) return bad("codec", `must be one of ${EXPORT_CODEC_IDS.join(", ")}`);
    out.codec = codec as ExportCodecId;
  }
  if (args.bitDepth !== undefined) {
    if (args.bitDepth !== 8 && args.bitDepth !== 10) return bad("bitDepth", "must be 8 or 10");
    out.bitDepth = args.bitDepth;
  }
  if (args.hdr !== undefined) {
    if (typeof args.hdr !== "string" || !(EXPORT_HDR_IDS as readonly string[]).includes(args.hdr)) return bad("hdr", "must be sdr, pq or hlg");
    out.hdr = args.hdr as "sdr" | "pq" | "hlg";
  }
  for (const key of ["width", "height"] as const) {
    if (args[key] === undefined) continue;
    const value = args[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return bad(key, "must be a positive whole number");
    out[key] = value;
  }
  if (args.frameRate !== undefined) {
    if (typeof args.frameRate !== "number" || !Number.isFinite(args.frameRate) || args.frameRate <= 0 || args.frameRate > 240) return bad("frameRate", "must be a number between 0 and 240");
    out.frameRate = args.frameRate;
  }
  const bitrate = args.bitrateKbps ?? args.bitrate;
  if (bitrate !== undefined) {
    if (typeof bitrate !== "number" || !Number.isFinite(bitrate) || bitrate <= 0) return bad("bitrateKbps", "must be a positive number");
    out.bitrateKbps = bitrate;
  }
  if (args.maxBitrateKbps !== undefined) {
    if (typeof args.maxBitrateKbps !== "number" || !Number.isFinite(args.maxBitrateKbps) || args.maxBitrateKbps <= 0) return bad("maxBitrateKbps", "must be a positive number");
    if (typeof bitrate === "number" && args.maxBitrateKbps < bitrate) return bad("maxBitrateKbps", "must be at least bitrateKbps");
    out.maxBitrateKbps = args.maxBitrateKbps;
  }
  if (args.rateControl !== undefined) {
    if (args.rateControl !== "quality" && args.rateControl !== "vbr" && args.rateControl !== "vbr2") return bad("rateControl", "must be quality, vbr or vbr2");
    out.rateControl = args.rateControl;
  }
  if (args.bitrateMode !== undefined) {
    if (args.bitrateMode !== "cbr" && args.bitrateMode !== "vbr1" && args.bitrateMode !== "vbr2") return bad("bitrateMode", "must be cbr, vbr1 or vbr2");
    const implied = args.bitrateMode === "vbr2" ? "vbr2" : "vbr";
    if (out.rateControl !== undefined && out.rateControl !== implied) return bad("bitrateMode", `conflicts with rateControl '${out.rateControl}'`);
    out.rateControl = implied;
    if (args.bitrateMode === "cbr") {
      if (typeof bitrate !== "number") return bad("bitrateMode cbr", "needs bitrateKbps");
      if (out.maxBitrateKbps !== undefined && out.maxBitrateKbps !== bitrate) return bad("maxBitrateKbps", "must equal bitrateKbps for bitrateMode cbr");
      out.maxBitrateKbps = bitrate;
    }
  }
  if (args.audioChannels !== undefined) {
    if (typeof args.audioChannels !== "string" || !(EXPORT_AUDIO_LAYOUTS as readonly string[]).includes(args.audioChannels)) return bad("audioChannels", "must be mono, stereo or 5.1");
    out.audioChannels = args.audioChannels as "mono" | "stereo" | "5.1";
  }
  if (args.timecode !== undefined) {
    if (typeof args.timecode !== "boolean") return bad("timecode", "must be true or false");
    out.timecode = args.timecode;
  }
  if (args.targetLufs !== undefined) {
    if (typeof args.targetLufs !== "number" || !(args.targetLufs >= -40 && args.targetLufs <= -5)) return bad("targetLufs", "must be between -40 and -5");
    out.targetLufs = args.targetLufs;
  }
  if (args.truePeakCeilingDb !== undefined) {
    if (typeof args.truePeakCeilingDb !== "number" || !(args.truePeakCeilingDb >= -20 && args.truePeakCeilingDb <= 0)) return bad("truePeakCeilingDb", "must be between -20 and 0");
    out.truePeakCeilingDb = args.truePeakCeilingDb;
  }
  if (args.outputPath !== undefined) {
    const outputPath = optString(args.outputPath);
    if (!outputPath) return bad("outputPath", "must be a non-empty absolute path");
    out.outputPath = outputPath;
  }
  if (args.overwrite !== undefined) {
    if (typeof args.overwrite !== "boolean") return bad("overwrite", "must be true or false");
    out.overwrite = args.overwrite;
  }
  if (out.overwrite !== undefined && out.outputPath === undefined) {
    return { ok: false, issue: issue("INVALID_PARAMS", "overwrite only applies together with outputPath.", "Pass outputPath, or drop overwrite.") };
  }
  return { ok: true, value: out };
}

const FORMAT_PREFERENCE: readonly string[] = ["mp4", "mov", "webm", "mxf"];
const DEFAULT_CODEC: Record<string, string> = { mp4: "h264", mov: "h264", webm: "vp9", mxf: "xdcamhd422" };

const describeFormat = (format: ExportFormatOption): string =>
  `${format.id}${format.available ? "" : " (unavailable)"}: ${format.codecs.length ? format.codecs.join(", ") : "none"}`;

export function describeFormats(catalog: ExportOptionsCatalog): string {
  return catalog.formats.map(describeFormat).join("; ");
}

/** Container and codec a request resolves to before the combination is checked. */
export function resolveFormatAndCodec(
  request: ExportRequestInput,
  catalog: ExportOptionsCatalog,
): { format: string; codec: string } {
  const preset = request.presetId ? catalog.presets.find((entry) => entry.id === request.presetId) : undefined;
  let codec = request.codec ?? (request.hdr && request.hdr !== "sdr" ? undefined : preset?.codec);
  let format = request.format ?? preset?.format;
  if (!format) {
    if (codec) {
      const holder = FORMAT_PREFERENCE.map((id) => catalog.formats.find((entry) => entry.id === id)).find(
        (entry) => entry?.available && entry.codecs.includes(codec as string),
      );
      format = holder?.id ?? (codec === "vp8" || codec === "vp9" ? "webm" : codec === "prores" || codec === "dnxhr" ? "mov" : codec === "xdcamhd422" || codec === "avcintra100" ? "mxf" : "mp4");
    } else {
      format = "mp4";
    }
  }
  if (!codec) {
    if (request.hdr && request.hdr !== "sdr") {
      const container = catalog.formats.find((entry) => entry.id === format);
      codec = container?.codecOptions?.find((entry) => entry.hdr.includes(request.hdr as "pq" | "hlg"))?.codec ?? "h265";
    } else {
      codec = DEFAULT_CODEC[format] ?? "h264";
    }
  }
  return { format, codec };
}

/** Codecs whose encoder path ignores rate control (AV1 is constant quality; the others have a fixed rate or profile). */
const NO_RATE_CONTROL_CODECS = new Set<string>(["av1", "prores", "dnxhr", "xdcamhd422", "avcintra100"]);

const EXTENSION_OF: Record<string, string[]> = { mp4: ["mp4", "m4v"], mov: ["mov"], webm: ["webm"], mxf: ["mxf"] };

/** The first reason `request` cannot be exported on this machine, or null. */
export function checkExportRequest(request: ExportRequestInput, catalog: ExportOptionsCatalog): ExportRequestIssue | null {
  if (request.presetId && !catalog.presets.some((entry) => entry.id === request.presetId)) {
    const ids = catalog.presets.filter((entry) => entry.kind === "video").map((entry) => entry.id);
    return issue("INVALID_PARAMS", `Unknown preset '${request.presetId}'.`, `Valid video presets: ${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ", ..." : ""}.`);
  }
  const preset = request.presetId ? catalog.presets.find((entry) => entry.id === request.presetId) : undefined;
  if (preset && preset.kind !== "video") {
    return issue("INVALID_PARAMS", `Preset '${preset.id}' is an audio preset.`, "Use export_audio for audio-only presets, or pick a video preset from get_export_options.");
  }
  const { format, codec } = resolveFormatAndCodec(request, catalog);
  const container = catalog.formats.find((entry) => entry.id === format);
  const alternatives = `Available: ${describeFormats(catalog)}.`;
  if (!container) return issue("UNSUPPORTED", `Format '${format}' is not offered by this app.`, alternatives);
  if (!container.available) {
    return issue("UNSUPPORTED", `${format.toUpperCase()} export is unavailable here${container.reason ? `: ${container.reason}` : "."}`, alternatives);
  }
  if (!container.codecs.includes(codec)) {
    const blocked = container.unavailableCodecs?.find((entry) => entry.codec === codec);
    return issue(
      "UNSUPPORTED",
      blocked ? `${codec} cannot be exported here: ${blocked.reason}` : `${format.toUpperCase()} cannot carry ${codec}.`,
      `${format} supports: ${container.codecs.join(", ") || "nothing on this machine"}. ${alternatives}`,
    );
  }
  const wantsRate = request.rateControl === "vbr" || request.rateControl === "vbr2" || request.maxBitrateKbps !== undefined;
  if (wantsRate && NO_RATE_CONTROL_CODECS.has(codec)) {
    return issue(
      "UNSUPPORTED",
      `${codec} has no target / max bitrate control here.`,
      codec === "av1" ? "Use h264, h265 or vp9 for a target bitrate; AV1 exports use constant quality." : `${codec} is a fixed-rate or fixed-quality codec; drop rateControl and maxBitrateKbps.`,
    );
  }
  if (request.rateControl === "vbr2") {
    if (catalog.platform !== "desktop") {
      return issue("UNSUPPORTED", "Two-pass VBR is not available in the browser: frames are streamed to the encoder once.", "Use the desktop app for two-pass, or rateControl 'vbr' (one-pass) here.");
    }
    if (codec !== "h264" && codec !== "h265") {
      return issue("UNSUPPORTED", `Two-pass VBR is available for h264 and h265 only, not ${codec}.`, "Use codec h264 or h265, or rateControl 'vbr'.");
    }
    if (catalog.colorManaged) {
      return issue("UNSUPPORTED", "Two-pass VBR is not available when the sequence colour space is Rec.2020 (colour-managed output).", "Use rateControl 'vbr', or set the sequence colour space to Rec.709.");
    }
    if (request.hdr !== undefined && request.hdr !== "sdr") {
      return issue("UNSUPPORTED", "Two-pass VBR is not available with HDR output.", "Use rateControl 'vbr' for HDR.");
    }
    if (!(request.bitrateKbps ?? preset?.bitrateKbps)) {
      return issue("INVALID_PARAMS", "Two-pass VBR needs a target bitrate.", "Pass bitrateKbps (and optionally maxBitrateKbps).");
    }
  }
  const detail = container.codecOptions?.find((entry) => entry.codec === codec);
  const bitDepths = detail?.bitDepths ?? container.bitDepths;
  const hdrModes = detail?.hdr ?? container.hdr;
  if (request.bitDepth !== undefined && !bitDepths.includes(request.bitDepth)) {
    return issue("UNSUPPORTED", `${codec} in ${format} cannot be exported at ${request.bitDepth}-bit here.`, `${codec} supports bit depths: ${bitDepths.join(", ")}. Try a 10-bit capable codec such as h265 or prores (see get_export_options).`);
  }
  if (request.hdr !== undefined && !hdrModes.includes(request.hdr)) {
    const why = !catalog.hdr.supported && request.hdr !== "sdr" && catalog.hdr.reason ? ` ${catalog.hdr.reason}` : "";
    return issue("UNSUPPORTED", `${codec} in ${format} cannot be exported as ${request.hdr} here.${why}`, `${codec} supports hdr: ${hdrModes.join(", ")}. HDR needs h265 in mp4 or mov.`);
  }
  if (request.audioChannels !== undefined && !catalog.audioLayouts.includes(request.audioChannels)) {
    return issue("UNSUPPORTED", `Audio layout '${request.audioChannels}' is not offered.`, `Valid audio layouts: ${catalog.audioLayouts.join(", ")}.`);
  }
  if (request.timecode === true && (!catalog.timecode.supported || (format !== "mov" && format !== "mxf"))) {
    return issue("UNSUPPORTED", `A start timecode cannot be written to ${format.toUpperCase()} here${catalog.timecode.reason ? `: ${catalog.timecode.reason}` : "."}`, "Timecode is written in MOV or MXF on the desktop app.");
  }
  if (request.outputPath !== undefined) {
    const ext = request.outputPath.replace(/^.*[\\/]/, "").split(".").pop()?.toLowerCase() ?? "";
    const allowed = EXTENSION_OF[format] ?? [format];
    if (!allowed.includes(ext)) {
      return issue("INVALID_PARAMS", `outputPath must end in .${allowed[0]} for a ${format} export (got .${ext || "none"}).`, `Rename the destination to end in .${allowed[0]}.`);
    }
  }
  return null;
}

/**
 * Check `outputPath` before an expensive export starts: it must be inside the allowed folders, its
 * folder must exist, and an existing file needs overwrite:true. Needs a host with file access.
 */
export async function preflightOutputPath(host: EditingHost, request: ExportRequestInput): Promise<ExportRequestIssue | null> {
  if (request.outputPath === undefined) return null;
  if (!host.files) {
    return issue("UNSUPPORTED", "outputPath needs the desktop app.", "Omit outputPath and use the returned path, or run OpenReel desktop.");
  }
  const result = await host.files.resolve([request.outputPath], { mode: "write" });
  const rejected = result.rejected[0];
  if (rejected) {
    return {
      code: rejected.code,
      message: rejected.message,
      hint:
        rejected.code === "OUTSIDE_ALLOWED_ROOTS"
          ? "Choose a path inside the allowed folders (get_app_state mcp.allowedRoots lists them), or add the folder in Settings > MCP."
          : rejected.code === "NOT_FOUND"
            ? "Create the destination folder first, or pick an existing one."
            : "Pass an absolute file path inside an allowed folder.",
    };
  }
  const target = result.resolved[0];
  if (target?.exists && request.overwrite !== true) {
    return issue("INVALID_PARAMS", `A file already exists at ${request.outputPath}.`, "Pass overwrite:true to replace it, or choose another outputPath.");
  }
  return null;
}
