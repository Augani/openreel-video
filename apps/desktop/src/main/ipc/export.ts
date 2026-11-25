import { patchContentLightLevel, type MeasuredLightLevel } from "../sidecar/patch-content-light-level";
import { MessageChannelMain, type WebContents, type MessagePortMain } from "electron";
import { promises as fs, rmSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ExportJob, canHoldChapters, usesPcmAudio, type CaptionInput, type ExportArgs } from "../sidecar/export-job";
import { assertRawYuv420Allowed, pipeFrameBytes } from "../sidecar/raw-yuv420";
import { assertLocalSourcePath } from "../sidecar/probe-source";
import { fingerprintFile, fingerprintMismatch, verifySourceForCopy, type FingerprintCache } from "../sidecar/source-guard";
import { SmartExportSession, type SmartStreamMatch } from "../sidecar/smart-export";
import type { SmartAudioCopyPlan } from "../sidecar/smart-audio";
import { CfrWriter } from "../sidecar/cfr";
import { selectEncoder, getVerifiedEncoders, isHardwareEncoder } from "../sidecar/encoder-probe";
import { join } from "node:path";
import { resolveEncoderChoice, type EncoderChoice } from "../../../../../packages/core/src/export/encoder-choice";
import { appTempDir, newTempPathReady, releaseTemp, releaseTempSync } from "../temp-dir";
import { acquirePowerHold, releasePowerHold, releaseAllPowerHolds } from "../power";
import { isBroadcastExportCodec, isProres4444, type BroadcastScan, type DnxhrProfile, type ExportCodec, type EncodeMode } from "../sidecar/encode-args";
import { dolbyPlanFromRequest } from "../sidecar/dolby-args";
import { dolbyContainerProblem } from "../../../../../packages/core/src/export/dolby";
import { addSphericalMetadataToFile, type SphericalExportFields } from "../sidecar/spherical-file";
import { isNativeColorOutput, type NativeColorOutput } from "../sidecar/color-output-args";
import { buildSegmentArgs } from "../sidecar/segment-args";
import { segmentRuns } from "./segment-registry";

export interface ExportStartArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  format: string;
  bitrateKbps: number;
  /** One-pass VBR: `bitrateKbps` is the average, this the peak cap. */
  maxBitrateKbps?: number;
  /** "vbr2": two-pass VBR (H.264 / HEVC through libx264 / libx265, no colour-managed output). */
  rateControl?: "quality" | "vbr" | "vbr2";
  outputPath: string;
  totalFrames: number;
  audioSampleRate: number;
  audioChannels: number;
  encodeMode?: "fast" | "balanced" | "smallest";
  /** Encoder picker. Absent or "auto" keeps the encode-mode ordering. */
  encoderChoice?: EncoderChoice;
  quality?: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  dnxhrProfile?: DnxhrProfile;
  /** ProRes 4444 / 4444 XQ: write the alpha channel (the renderer is exporting over a transparent background). */
  alpha?: boolean;
  /** Frames arrive as planar 8-bit 4:2:0 (I420, BT.709 limited) converted on the renderer's GPU instead of RGBA. */
  rawYuv420?: boolean;
  keyframeInterval?: number;
  audioBitrateKbps?: number;
  /** "ac3" (Dolby Digital) / "eac3" (Dolby Digital Plus): the audio track's codec instead of AAC / Opus / PCM. MP4, MOV or MKV. */
  audioCodec?: string;
  /** AC-3 / E-AC-3 dialogue normalisation, dB, -31 to -1. */
  dialnorm?: number;
  /** Broadcast delivery: interlaced (1080i) flags for XDCAM HD422 / AVC-Intra 100. */
  scan?: BroadcastScan;
  /** MXF wrapper: "op1a" (default) or "opatom" (one file per essence track). */
  mxfPattern?: "op1a" | "opatom";
  /** The audio is this many mono tracks (the renderer sends an N-channel WAV). */
  audioTrackCount?: number;
  /** File start timecode, HH:MM:SS:FF (`;` before the frames for drop frame). */
  startTimecode?: string;
  /** VR sequence in MP4 / MOV: spherical metadata written into the finished file. */
  vr?: SphericalExportFields;
  /**
   * Colour-managed export (Rec.2020 / HDR10 / HLG): frames arrive as raw planar
   * YCbCr already converted to this space instead of RGBA, and the stream is tagged with it.
   */
  color?: NativeColorOutput;
  captions?: Array<{ kind: "mov_text" | "cea608"; data: string; language?: string }>;
  /** ffmpeg `;FFMETADATA1` text with one [CHAPTER] per chapter marker; written as MP4 / MOV chapters. */
  chaptersMetadata?: string;
  /**
   * Native smart render: the renderer stream-copies untouched spans of the
   * sources (copyExportRun) and sends frames only for the re-encoded spans;
   * `match` is what those spans must reproduce to join the copied ones.
   */
  smartRender?: { match: SmartStreamMatch };
  /**
   * One video-only segment of a parallel export (see segment-export.ts): the arguments, encoder and output file
   * come from the session, which already resolved them for the whole export.
   */
  segment?: { sessionId: string; index: number };
}

// 288 MB admits 8 frames at 4K (33 MB each) and 2 at 8K (133 MB each).
const MAX_INITIAL_CREDITS = 16;
const MAX_IN_FLIGHT_FRAME_BYTES = 288 * 1024 * 1024;

// Frames are kept (up to this many bytes) so a failed hardware encode can be
// replayed into a software encoder. Past the budget the replay is dropped.
const MAX_REPLAY_BYTES = 128 * 1024 * 1024;

const SOFTWARE_FALLBACK: Record<ExportCodec, string | undefined> = {
  h264: "libx264",
  hevc: "libx265",
  h265: "libx265",
  av1: "libsvtav1",
  vp9: "libvpx-vp9",
  prores: "prores_ks",
  dnxhr: "dnxhd",
  xdcamhd422: undefined,
  avcintra100: undefined,
};

/** Software encoder to retry with after `encoder` failed, or null when there is none to try. */
export function softwareFallbackEncoder(
  codec: ExportCodec,
  encoder: string,
  available: string[],
): string | null {
  if (!isHardwareEncoder(encoder)) return null;
  const sw = SOFTWARE_FALLBACK[codec];
  return sw && available.includes(sw) ? sw : null;
}

export function hardwareFailureMessage(encoder: string, message: string): string {
  return `${message}\nThe hardware encoder ${encoder} failed on this system. Set the encode mode to "smallest" to export with the software encoder instead.`;
}

/**
 * True when ffmpeg's stderr points at the output file or disk rather than the
 * encoder, so neither a software retry nor the hardware-encoder hint applies.
 */
export function isOutputIoFailure(message: string, outputPath: string): boolean {
  if (/ENOSPC|No space left|Permission denied|Read-only file system|Disk quota exceeded/i.test(message)) {
    return true;
  }
  return message.split(/\r?\n/).some(
    (line) =>
      /No such file or directory|Invalid argument/i.test(line) &&
      ((outputPath !== "" && line.includes(outputPath)) ||
        /opening output|writing (trailer|header)|av_interleaved_write_frame|muxer/i.test(line)),
  );
}

interface JobEntry {
  job: ExportJob | null;
  encoders: string[];
  replay: Uint8Array[] | null;
  replayBytes: number;
  /** True once the renderer's "finish" has been delivered to the current job. */
  finishDelivered: boolean;
  /** PQ exports: the MaxCLL / MaxFALL the renderer measured, written into the file once ffmpeg has exited. */
  lightLevel?: MeasuredLightLevel;
  retried: boolean;
  /** Hardware was chosen explicitly: a failure is reported, never retried on the software encoder. */
  strictHardware: boolean;
  cancelled: boolean;
  cfr: CfrWriter | null;
  port: MessagePortMain;
  exportArgs: ExportArgs;
  audioWavPath: string;
  audioHandle: FileHandle | null;
  started: boolean;
  audioQueue: Promise<void>;
  queue: Promise<void>;
  /** Temp subtitle files muxed into the output; released with the job. */
  captionPaths: string[];
  /** Present for a smart-render job: runs are joined here instead of piping into one ffmpeg. */
  smart: SmartExportSession | null;
  smartVideoPath: string | null;
  /** The open re-encoded run: frames of it go through this CFR writer, timestamps relative to `baseTs`. */
  smartRun: { cfr: CfrWriter; baseTs: number } | null;
  /** Full-content hashes of the copy sources already verified in this job (keyed by path, size and mtime). */
  sourceFingerprints: FingerprintCache;
  /** Set for a segment of a parallel export. */
  segment: { sessionId: string; index: number } | null;
  /** Highest frame count ffmpeg reported. */
  framesWritten: number;
}

const jobs = new Map<string, JobEntry>();

function initialFrameCredits(args: Pick<ExportArgs, "width" | "height">): number {
  const frameBytes = Math.max(1, args.width * args.height * 4);
  return Math.max(
    1,
    Math.min(MAX_INITIAL_CREDITS, Math.floor(MAX_IN_FLIGHT_FRAME_BYTES / frameBytes)),
  );
}

/**
 * Encoder for a colour-managed export. HDR needs a 10-bit encoder: libx265
 * (which writes the HDR10 mastering-display and content-light SEI) is preferred
 * over hevc_videotoolbox (10-bit, but no mastering metadata from the command
 * line); ProRes goes through prores_ks. Throws a message for the export dialog
 * when the build has none.
 */
export function selectColorEncoder(
  codec: ExportCodec,
  color: NativeColorOutput,
  encoders: string[],
  platform: NodeJS.Platform,
  mode: EncodeMode,
): string {
  const hdr = color.transfer !== "bt709";
  if (codec === "prores") {
    if (!encoders.includes("prores_ks")) throw new Error("This ffmpeg build has no prores_ks encoder, which Rec.2020 / HDR ProRes needs.");
    return "prores_ks";
  }
  if (codec === "hevc") {
    if (hdr) {
      if (encoders.includes("libx265")) return "libx265";
      if (encoders.includes("hevc_videotoolbox")) return "hevc_videotoolbox";
      throw new Error("This ffmpeg build has no 10-bit HEVC encoder (libx265 or hevc_videotoolbox), which HDR export needs.");
    }
    return selectEncoder("hevc", platform, encoders, mode) ?? "libx265";
  }
  if (hdr) throw new Error("HDR export needs H.265 (HEVC Main10) or ProRes 4444 XQ.");
  return selectEncoder(codec, platform, encoders, mode) ?? "libx264";
}

/** Spherical (VR) fields of a start request, validated (they come from the renderer). MP4 and MOV only. */
export function sphericalExportFields(args: Pick<ExportStartArgs, "vr" | "format">): { vr?: SphericalExportFields } {
  if (args.vr === undefined) return {};
  if (args.format !== "mp4" && args.format !== "mov") return {};
  const { layout, horizontalFov, verticalFov, initialView } = args.vr;
  if (layout !== "mono" && layout !== "over-under" && layout !== "side-by-side") throw new Error("Invalid VR frame layout.");
  if (!(Number.isFinite(horizontalFov) && horizontalFov >= 1 && horizontalFov <= 360)) throw new Error("Invalid VR horizontal field of view.");
  if (!(Number.isFinite(verticalFov) && verticalFov >= 1 && verticalFov <= 180)) throw new Error("Invalid VR vertical field of view.");
  if (initialView !== undefined) {
    const { yaw, pitch, roll } = initialView;
    if (![yaw, pitch, roll].every(Number.isFinite) || Math.abs(yaw) > 360 || Math.abs(roll) > 360 || Math.abs(pitch) > 90) throw new Error("Invalid VR initial view.");
    return { vr: { layout, horizontalFov, verticalFov, initialView: { yaw, pitch, roll } } };
  }
  return { vr: { layout, horizontalFov, verticalFov } };
}

/** The renderer sends chapter text only in ffmpeg's metadata format, bounded in size. */
export function isChaptersMetadata(text: unknown): text is string {
  return typeof text === "string" && text.length <= 262144 && text.startsWith(";FFMETADATA1\n");
}

const TIMECODE_RE = /^\d{2}:\d{2}:\d{2}[:;]\d{2,3}$/;

/** Broadcast delivery fields of a start request, validated (they come from the renderer). */
export function broadcastExportFields(args: ExportStartArgs): Pick<ExportArgs, "scan" | "mxfPattern" | "audioTrackCount" | "startTimecode"> {
  const out: Pick<ExportArgs, "scan" | "mxfPattern" | "audioTrackCount" | "startTimecode"> = {};
  if (args.scan !== undefined) {
    if (args.scan !== "progressive" && args.scan !== "interlaced-tff") throw new Error("Invalid scan type.");
    out.scan = args.scan;
  }
  if (args.mxfPattern !== undefined) {
    if (args.mxfPattern !== "op1a" && args.mxfPattern !== "opatom") throw new Error("Invalid MXF operational pattern.");
    if (args.mxfPattern === "opatom") {
      if (args.format !== "mxf") throw new Error("MXF OP-Atom needs the MXF format.");
      out.mxfPattern = "opatom";
    }
  }
  if (args.audioTrackCount !== undefined) {
    if (!Number.isInteger(args.audioTrackCount) || args.audioTrackCount < 1 || args.audioTrackCount > 64) throw new Error("Invalid audio track count.");
    if (args.format !== "mxf" && args.format !== "mov") throw new Error("Mono audio tracks are written in MXF or MOV.");
    if (args.audioChannels !== args.audioTrackCount) throw new Error("The audio must carry one channel per mono track.");
    out.audioTrackCount = args.audioTrackCount;
  }
  if (args.startTimecode !== undefined) {
    if (!TIMECODE_RE.test(args.startTimecode)) throw new Error(`Invalid start timecode "${args.startTimecode}".`);
    if (args.format === "mxf" || args.format === "mov") out.startTimecode = args.startTimecode;
  }
  return out;
}

/**
 * Honour an explicit Hardware / Software choice for H.264, H.265 and AV1. Auto (or no choice) returns
 * null so the encode-mode ordering decides. Hardware never falls back: it throws with the reason.
 */
function pickChosenEncoder(args: ExportStartArgs, platform: NodeJS.Platform, usable: string[]): string | null {
  if (args.encoderChoice !== "hardware" && args.encoderChoice !== "software") return null;
  if (!["h264", "h265", "hevc", "av1"].includes(args.codec)) return null;
  const resolved = resolveEncoderChoice({ codec: args.codec, choice: args.encoderChoice, platform, available: usable });
  if (!resolved.encoder) throw new Error(resolved.reason ?? "The chosen encoder is not available.");
  return resolved.encoder;
}

export function resolveExportArgs(
  args: ExportStartArgs,
  platform: NodeJS.Platform,
  encoders: string[],
  audioWavPath: string,
): ExportArgs {
  const mode: EncodeMode = args.encodeMode ?? "balanced";
  // encode-args emits no -vaapi_device/hwupload, so VAAPI encoders cannot run.
  // VideoToolbox's ProRes encoder writes 4:2:2 only: 4444 (with or without alpha) goes to prores_ks.
  const needs4444 = args.codec === "prores" && isProres4444(args.proresProfile);
  const usable = encoders.filter((name) => !name.endsWith("_vaapi") && !(needs4444 && name === "prores_videotoolbox"));
  const codec = (args.codec === "h265" ? "hevc" : args.codec) as ExportCodec;
  if (args.color !== undefined && !isNativeColorOutput(args.color)) throw new Error("Invalid colour output settings.");
  const color = args.color;
  if (isBroadcastExportCodec(codec)) {
    if (color) throw new Error("XDCAM HD422 and AVC-Intra 100 are Rec.709 deliveries; set the sequence colour space to Rec.709.");
    if (args.format !== "mxf" && args.format !== "mov") throw new Error("XDCAM HD422 and AVC-Intra 100 are delivered in MXF or MOV.");
  }
  if (args.format === "mkv" && (codec === "prores" || codec === "dnxhr" || isBroadcastExportCodec(codec))) {
    throw new Error("ProRes, DNxHR, XDCAM HD422 and AVC-Intra are delivered in MOV or MXF, not MKV. Choose H.264, H.265, AV1 or VP9 for MKV.");
  }
  const broadcastEncoder = codec === "xdcamhd422" ? "mpeg2video" : codec === "avcintra100" ? "libx264" : null;
  if (broadcastEncoder && !usable.includes(broadcastEncoder)) {
    throw new Error(
      broadcastEncoder === "libx264"
        ? "This ffmpeg build has no libx264 encoder, which AVC-Intra 100 needs. The shipped OpenReel ffmpeg includes it; a custom OPENREEL_FFMPEG_PATH build must be GPL with libx264."
        : "This ffmpeg build has no mpeg2video encoder, which XDCAM HD422 needs.",
    );
  }
  const twoPass = args.rateControl === "vbr2";
  const chosen = args.encoderChoice === "hardware" || args.encoderChoice === "software" ? args.encoderChoice : null;
  const choiceApplies = chosen !== null && (codec === "h264" || codec === "hevc" || codec === "av1");
  if (twoPass && choiceApplies && chosen === "hardware") {
    throw new Error("Hardware encoders have no two-pass mode. Choose Software or Auto for Two-pass VBR, or pick another rate control for Hardware.");
  }
  if (color && choiceApplies && chosen === "hardware") {
    throw new Error("Hardware encoding is not available with Rec.2020 / HDR output (it needs libx265 for the HDR metadata). Choose Software or Auto, or set the sequence colour space to Rec.709.");
  }
  if (twoPass) {
    if (codec !== "h264" && codec !== "hevc") throw new Error("Two-pass VBR is available for H.264 and H.265 only.");
    if (color) throw new Error("Two-pass VBR is not available with Rec.2020 / HDR output; use one-pass VBR or constant quality.");
    if (!(args.bitrateKbps > 0)) throw new Error("Two-pass VBR needs a target bitrate.");
    if (args.smartRender) throw new Error("Two-pass VBR re-encodes the whole timeline, so it cannot be combined with smart render.");
  }
  // Hardware encoders have no two-pass mode: it always runs on the software encoder.
  const twoPassEncoder = codec === "hevc" ? "libx265" : "libx264";
  if (twoPass && !usable.includes(twoPassEncoder)) {
    throw new Error(`Two-pass VBR needs the ${twoPassEncoder} encoder, which this ffmpeg build does not include.`);
  }
  const encoder = twoPass ? twoPassEncoder : (broadcastEncoder ?? (color
    ? (color.transfer === "bt709" && choiceApplies && chosen === "software" ? pickChosenEncoder(args, platform, usable) : null) ?? selectColorEncoder(codec, color, usable, platform, mode)
    : (pickChosenEncoder(args, platform, usable) ?? selectEncoder(args.codec, platform, usable, mode) ?? "libx264")));
  if (choiceApplies && chosen === "software" && isHardwareEncoder(encoder)) {
    throw new Error(`Software was chosen, but this export would use the hardware encoder ${encoder}. Choose Auto or Hardware, or install an ffmpeg build with the software encoder.`);
  }
  const hdrProres = !!color && codec === "prores" && color.transfer !== "bt709";
  if (args.rawYuv420 === true) {
    assertRawYuv420Allowed({ codec, color, alpha: args.alpha, width: args.width, height: args.height, rateControl: args.rateControl, format: args.format, scan: args.scan, mxfPattern: args.mxfPattern });
    if (args.smartRender) throw new Error("Raw 4:2:0 frames cannot be combined with smart render.");
  }
  const dolby = dolbyPlanFromRequest(args);
  if (dolby) {
    const containerProblem = dolbyContainerProblem(args.format);
    if (containerProblem) throw new Error(containerProblem);
    if (args.audioTrackCount !== undefined) throw new Error("Dolby Digital audio is a stereo or 5.1 track; it cannot be combined with mono audio tracks.");
    if (!usable.includes(dolby.codec)) throw new Error(`This ffmpeg build has no ${dolby.codec} encoder, which Dolby Digital delivery needs.`);
  }
  return {
    ...(color ? { color } : {}),
    width: args.width,
    height: args.height,
    frameRate: args.frameRate,
    codec,
    encoder,
    mode,
    quality: args.quality ?? 80,
    bitrateKbps: args.bitrateKbps,
    ...(args.rateControl === "vbr" || args.rateControl === "vbr2" ? { rateControl: args.rateControl } : {}),
    totalFrames: args.totalFrames,
    ...((args.rateControl === "vbr" || args.rateControl === "vbr2") && args.maxBitrateKbps && args.maxBitrateKbps > 0 ? { maxBitrateKbps: args.maxBitrateKbps } : {}),
    outputPath: args.outputPath,
    audioWavPath,
    format: args.format,
    // HDR ProRes is 4444 XQ (default), 4444 or 422 HQ (10-bit 4:2:2, the renderer's 4:4:4 planes are subsampled by
    // ffmpeg). The lower 422 profiles are too coarse for HDR and are raised to HQ.
    proresProfile: hdrProres
      ? (args.proresProfile === "4444" || args.proresProfile === "hq" ? args.proresProfile : args.proresProfile && args.proresProfile !== "4444xq" ? "hq" : "4444xq")
      : args.proresProfile,
    dnxhrProfile: args.dnxhrProfile,
    alpha: needs4444 && args.alpha === true,
    ...(args.rawYuv420 === true ? { rawYuv420: true } : {}),
    keyframeInterval: args.keyframeInterval,
    audioBitrateKbps: args.audioBitrateKbps,
    ...(dolby ? { dolby } : {}),
    ...broadcastExportFields(args),
    ...sphericalExportFields(args),
  };
}

/**
 * Estimated size of the lossless FFV1 RGBA intermediate a two-pass export keeps between its passes.
 * Raw RGBA is w*h*4 per frame; FFV1 typically halves that, so half is the planning figure (noisy
 * footage can exceed it, which is why this only refuses when even the typical size cannot fit).
 */
export function twoPassScratchBytes(width: number, height: number, totalFrames: number): number {
  return Math.ceil(width * height * 4 * Math.max(1, totalFrames) * 0.5);
}

/** Fail early, with a plain message, when the temp volume cannot hold the two-pass intermediate. */
async function assertTwoPassScratchSpace(args: ExportStartArgs): Promise<void> {
  const needed = twoPassScratchBytes(args.width, args.height, args.totalFrames);
  let free: number;
  try {
    const stats = await fs.statfs(appTempDir());
    free = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return; // free space unknown: let the export try
  }
  if (free < needed) {
    const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);
    throw new Error(
      `Two-pass VBR needs about ${gb(needed)} GB of temporary disk space for its intermediate video, but only ${gb(free)} GB is free. Free some space, shorten the range, or use one-pass VBR.`,
    );
  }
}

export async function startExport(wc: WebContents, args: ExportStartArgs): Promise<{ jobId: string; rawYuv420?: boolean }> {
  const jobId = randomUUID();
  const segmentRun = args.segment ? segmentRuns.get(args.segment.sessionId) : undefined;
  if (args.segment && !segmentRun) throw new Error("This parallel export is no longer running.");
  if (!args.segment && args.rateControl === "vbr2") await assertTwoPassScratchSpace(args);
  // Verified, not merely listed: a listed hardware encoder can still fail to start
  // (and encode-args forbids software fallback inside videotoolbox).
  const encoders = await getVerifiedEncoders();
  // A segment is video only: its audio is rendered once for the whole export by the session.
  const audioWavPath = args.segment ? "" : await newTempPathReady(`openreel-export-${jobId}`, "wav");
  const exportArgs = args.segment && segmentRun
    ? segmentRun.session.argsFor(segmentRun.session.segments[args.segment.index] ?? (() => { throw new Error(`Unknown segment ${args.segment!.index}.`); })())
    : resolveExportArgs(args, process.platform, encoders, audioWavPath);
  const captionPaths: string[] = [];
  if (args.captions?.length) {
    const inputs: CaptionInput[] = [];
    for (const [index, caption] of args.captions.entries()) {
      const path = await newTempPathReady(`openreel-captions-${jobId}-${index}`, caption.kind === "cea608" ? "scc" : "srt");
      await fs.writeFile(path, caption.data, "utf8");
      captionPaths.push(path);
      inputs.push({ path, kind: caption.kind, language: caption.language });
    }
    exportArgs.captionInputs = inputs;
  }
  if (args.chaptersMetadata !== undefined && !args.segment && canHoldChapters(args.format)) {
    if (!isChaptersMetadata(args.chaptersMetadata)) throw new Error("Invalid chapter metadata.");
    const path = await newTempPathReady(`openreel-chapters-${jobId}`, "ffmeta");
    await fs.writeFile(path, args.chaptersMetadata, "utf8");
    captionPaths.push(path);
    exportArgs.chaptersPath = path;
  }

  let smart: SmartExportSession | null = null;
  let smartVideoPath: string | null = null;
  if (args.smartRender) {
    smartVideoPath = await newTempPathReady(`openreel-smart-${jobId}`, "ts");
    smart = new SmartExportSession({
      args: exportArgs,
      match: args.smartRender.match,
      videoPath: smartVideoPath,
      totalFrames: args.totalFrames,
    });
  }

  if (exportArgs.rateControl === "vbr2") {
    // Pass-1 statistics and the lossless intermediate live here; ExportJob and the cancel / cleanup paths remove it.
    exportArgs.passDir = await fs.mkdtemp(join(appTempDir(), `openreel-2pass-${jobId}-`));
  }

  const { port1, port2 } = new MessageChannelMain();
  const entry: JobEntry = {
    job: null,
    encoders,
    replay: [],
    replayBytes: 0,
    finishDelivered: false,
    retried: false,
    strictHardware: args.encoderChoice === "hardware",
    cancelled: false,
    cfr: null,
    port: port1,
    exportArgs,
    audioWavPath,
    audioHandle: null,
    started: false,
    audioQueue: Promise.resolve(),
    queue: Promise.resolve(),
    captionPaths,
    smart,
    smartVideoPath,
    smartRun: null,
    sourceFingerprints: new Map(),
    segment: args.segment ?? null,
    framesWritten: 0,
  };

  // The renderer streams frames concurrently (credit window), but CfrWriter is
  // stateful and must process pushes strictly in arrival order. EventEmitter
  // fires this listener synchronously per message, so chaining each frame onto a
  // per-job queue keeps exactly one push (and one ffmpeg stdin write) in flight —
  // preventing the frame-duplication race (inflated duration / looping frames)
  // and the stdin listener pile-up. "finish" is chained after all frames so
  // endInput() cannot close stdin while frames are still queued.
  port1.on("message", (e) => {
    const msg = e.data as
      | { type?: string; ts?: number; buffer?: ArrayBuffer; lightLevel?: MeasuredLightLevel }
      | null;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "finish" && msg.lightLevel && Number.isFinite(msg.lightLevel.maxCll) && Number.isFinite(msg.lightLevel.maxFall)) {
      entry.lightLevel = msg.lightLevel;
    }
    if (entry.smart) {
      handleSmartMessage(jobId, entry, msg);
      return;
    }
    if (msg.type === "frame" && msg.buffer) {
      const buffer = msg.buffer;
      const ts = msg.ts ?? 0;
      entry.queue = entry.queue
        .then(async () => {
          if (!entry.cfr) return;
          // A frame of the wrong layout (RGBA into a raw 4:2:0 pipe or the reverse) would be encoded as garbage.
          const expected = pipeFrameBytes(entry.exportArgs);
          if (entry.exportArgs.rawYuv420 && expected !== undefined && buffer.byteLength !== expected) {
            throw new Error(`Frame of ${buffer.byteLength} bytes does not match the raw 4:2:0 pipe (${expected} bytes).`);
          }
          await entry.cfr.push(new Uint8Array(buffer), ts);
          port1.postMessage({ type: "credit", credits: 1 });
        })
        .catch((err) => {
          port1.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    } else if (msg.type === "finish") {
      entry.queue = entry.queue.then(() => {
        entry.finishDelivered = true;
        entry.job?.endInput();
      });
    }
  });
  port1.start();

  wc.postMessage("openreel:export-port", { jobId, ...(exportArgs.rawYuv420 ? { rawYuv420: true } : {}) }, [port2]);
  jobs.set(jobId, entry);
  // A reload, crash or close of the owning renderer orphans the job: stop it.
  acquirePowerHold(jobId, wc, () => {
    void cancelExport({ jobId });
  });
  // No audio to wait for: the segment's encoder starts at once.
  if (entry.segment) {
    segmentRun?.jobIds.add(jobId);
    startNativeExportJob(jobId, entry);
  }
  return { jobId, ...(exportArgs.rawYuv420 ? { rawYuv420: true } : {}) };
}

export async function writeAudioWav(args: { jobId: string; wav: ArrayBuffer }): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) throw new Error(`unknown export job ${args.jobId}`);
  if (entry.started) return;
  entry.audioQueue = entry.audioQueue.then(() =>
    fs.writeFile(entry.audioWavPath, Buffer.from(args.wav)),
  );
  await entry.audioQueue;
  startNativeExportJob(args.jobId, entry);
}

export async function writeAudioChunk(args: {
  jobId: string;
  chunk: ArrayBuffer;
  position: number;
}): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) throw new Error(`unknown export job ${args.jobId}`);
  if (entry.started) throw new Error(`audio already finalized for export job ${args.jobId}`);

  entry.audioQueue = entry.audioQueue.then(() =>
    writeAudioChunkToEntry(entry, args.chunk, args.position),
  );
  await entry.audioQueue;
}

export async function finishAudio(args: { jobId: string }): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) throw new Error(`unknown export job ${args.jobId}`);
  await entry.audioQueue;
  await closeAudioHandle(entry);
  startNativeExportJob(args.jobId, entry);
}

// One handle stays open across chunks; it is closed before ffmpeg reads the
// file (finishAudio) and on cancel/cleanup.
async function writeAudioChunkToEntry(
  entry: JobEntry,
  chunk: ArrayBuffer,
  position: number,
): Promise<void> {
  if (!entry.audioHandle) {
    try {
      entry.audioHandle = await fs.open(entry.audioWavPath, "r+");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      entry.audioHandle = await fs.open(entry.audioWavPath, "w+");
    }
  }
  await entry.audioHandle.write(Buffer.from(chunk), 0, chunk.byteLength, position);
}

async function closeAudioHandle(entry: JobEntry): Promise<void> {
  const handle = entry.audioHandle;
  entry.audioHandle = null;
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    /* best-effort close */
  }
}

/** Remove a two-pass job's statistics / intermediate directory (idempotent; the job removes it too). */
function removePassDir(entry: JobEntry): void {
  const dir = entry.exportArgs.passDir;
  if (dir) void fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

function discardAudio(entry: JobEntry): void {
  removePassDir(entry);
  void entry.audioQueue
    .catch(() => {})
    .then(() => closeAudioHandle(entry))
    .then(() => releaseTemp(entry.audioWavPath))
    .then(() => Promise.all(entry.captionPaths.map((path) => releaseTemp(path))))
    .catch(() => {});
}

function createJob(jobId: string, entry: JobEntry): ExportJob {
  const job = new ExportJob(
    entry.exportArgs,
    (frame) => {
      entry.framesWritten = Math.max(entry.framesWritten, frame);
      entry.port.postMessage({ type: "progress", frame });
      if (entry.segment) segmentRuns.get(entry.segment.sessionId)?.progress(entry.segment.index, frame);
    },
    () => {
      if (entry.segment) {
        try {
          segmentRuns.get(entry.segment.sessionId)?.finished(entry.segment.index, entry.framesWritten);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          entry.port.postMessage({ type: "error", message });
          segmentRuns.get(entry.segment.sessionId)?.fail(message);
          cleanupJob(jobId);
          return;
        }
      }
      void writeMeasuredLightLevel(entry).finally(() => {
        entry.port.postMessage({ type: "done" });
        cleanupJob(jobId);
      });
    },
    (msg) => handleJobError(jobId, entry, job, msg),
    entry.segment ? buildSegmentArgs : undefined,
  );
  entry.job = job;
  return job;
}

/** HDR10 (PQ, libx265) exports: replace the declared content light level with the measured one. Never fails the export. */
async function writeMeasuredLightLevel(entry: JobEntry): Promise<void> {
  const { color, encoder, outputPath, codec } = entry.exportArgs;
  if (!entry.lightLevel || color?.transfer !== "pq" || encoder !== "libx265" || (codec !== "hevc" && codec !== "h265")) return;
  try {
    await patchContentLightLevel(outputPath, entry.lightLevel);
  } catch (error) {
    console.warn("[export] could not write the measured MaxCLL / MaxFALL:", error);
  }
}

function recordReplayFrame(entry: JobEntry, frame: Uint8Array): void {
  if (!entry.replay) return;
  const last = entry.replay[entry.replay.length - 1];
  // CfrWriter repeats the same buffer to fill gaps; only count it once.
  if (last !== frame) entry.replayBytes += frame.byteLength;
  if (entry.replayBytes > MAX_REPLAY_BYTES) {
    entry.replay = null;
    return;
  }
  entry.replay.push(frame);
}

function handleJobError(jobId: string, entry: JobEntry, failed: ExportJob, msg: string): void {
  if (entry.cancelled || jobs.get(jobId) !== entry || entry.job !== failed) return;
  const { encoder, codec, outputPath } = entry.exportArgs;
  const hardwareFailure = isHardwareEncoder(encoder) && !isOutputIoFailure(msg, outputPath);
  const software =
    entry.retried || entry.strictHardware || !hardwareFailure ? null : softwareFallbackEncoder(codec, encoder, entry.encoders);
  if (software && entry.replay) {
    entry.retried = true;
    console.warn(`[export] ${encoder} failed, retrying with ${software}: ${msg}`);
    // Run on the frame queue: every frame already received is replayed first and
    // later frames wait for the new job, so ordering is preserved.
    entry.queue = entry.queue.then(() => retryWithSoftware(jobId, entry, software));
    return;
  }
  const message = hardwareFailure
    ? entry.strictHardware
      ? `${msg}\nThe hardware encoder ${encoder} failed on this system. Hardware was chosen explicitly, so OpenReel did not switch to software. Choose Auto or Software and export again.`
      : hardwareFailureMessage(encoder, msg)
    : msg;
  entry.port.postMessage({ type: "error", message });
  if (entry.segment) segmentRuns.get(entry.segment.sessionId)?.fail(message);
  cleanupJob(jobId);
}

async function retryWithSoftware(jobId: string, entry: JobEntry, software: string): Promise<void> {
  const replay = entry.replay;
  entry.replay = null;
  if (entry.cancelled || jobs.get(jobId) !== entry || !replay) return;
  entry.exportArgs = { ...entry.exportArgs, encoder: software };
  const job = createJob(jobId, entry);
  job.start();
  for (const frame of replay) {
    if (jobs.get(jobId) !== entry || entry.job !== job) return;
    await job.writeFrame(frame);
  }
  if (entry.finishDelivered) job.endInput();
}

/** Port messages of a smart-render job: re-encoded runs arrive as frames between "endRun"s, "finish" joins everything. */
function handleSmartMessage(
  jobId: string,
  entry: JobEntry,
  msg: { type?: string; ts?: number; buffer?: ArrayBuffer },
): void {
  const smart = entry.smart;
  if (!smart) return;
  const fail = (err: unknown): void => {
    if (entry.cancelled) return;
    const message = err instanceof Error ? err.message : String(err);
    const { encoder } = entry.exportArgs;
    entry.port.postMessage({
      type: "error",
      message: isHardwareEncoder(encoder) && !isOutputIoFailure(message, entry.exportArgs.outputPath)
        ? hardwareFailureMessage(encoder, message)
        : message,
    });
    cancelSmartJob(jobId, entry);
  };
  if (msg.type === "frame" && msg.buffer) {
    const buffer = msg.buffer;
    const ts = msg.ts ?? 0;
    entry.queue = entry.queue
      .then(async () => {
        if (entry.cancelled) return;
        if (!entry.smartRun) {
          const fps = entry.exportArgs.frameRate;
          const startFrame = Math.round(ts * fps);
          await smart.beginEncodeRun(startFrame);
          entry.smartRun = { cfr: new CfrWriter(fps, (frame) => smart.writeFrame(frame)), baseTs: startFrame / fps };
        }
        await entry.smartRun.cfr.push(new Uint8Array(buffer), ts - entry.smartRun.baseTs);
        entry.port.postMessage({ type: "credit", credits: 1 });
      })
      .catch(fail);
  } else if (msg.type === "endRun") {
    entry.queue = entry.queue
      .then(async () => {
        if (entry.cancelled) return;
        entry.smartRun = null;
        const frames = await smart.endEncodeRun();
        entry.port.postMessage({ type: "runDone", frames });
      })
      .catch(fail);
  } else if (msg.type === "finish") {
    entry.queue = entry.queue
      .then(async () => {
        if (entry.cancelled) return;
        entry.finishDelivered = true;
        const { outputPath, audioWavPath, audioBitrateKbps, dolby, format, captionInputs, chaptersPath, startTimecode } = entry.exportArgs;
        // ProRes masters carry PCM like the normal export path writes (a ProRes smart export used to get AAC here).
        const pcm = usesPcmAudio(entry.exportArgs);
        await smart.assemble(
          { audioWavPath, outputPath, audioCodec: pcm ? "pcm_s24le" : "aac", audioBitrateKbps: pcm ? undefined : audioBitrateKbps, dolby, format, captionInputs, chaptersPath, startTimecode },
          (frame) => entry.port.postMessage({ type: "progress", frame }),
        );
        if (entry.exportArgs.vr) await addSphericalMetadataToFile(outputPath, entry.exportArgs.vr);
        entry.port.postMessage({ type: "done" });
        cleanupJob(jobId);
      })
      .catch(fail);
  }
}

/** Stop a smart-render job: kill its ffmpeg, drop the temp video, forget the job. */
function cancelSmartJob(jobId: string, entry: JobEntry): void {
  markCancelled(entry);
  entry.smart?.cancel();
  cleanupJob(jobId);
}

/**
 * Native smart render, audio: before any frame is encoded the renderer sends the audio plan (spans of untouched source audio
 * to copy, the rest rendered). The main process checks the sources are still the imported files, writes the AAC packets or the
 * PCM spans, and proves them (see smart-audio.ts). Resolves to `{ declined }` when the audio has to be rendered and encoded
 * instead; a changed source file throws SOURCE_CHANGED like a video copy.
 */
export async function prepareAudioCopy(args: { jobId: string; plan: SmartAudioCopyPlan }): Promise<{ declined?: string }> {
  const entry = jobs.get(args.jobId);
  if (!entry?.smart) throw new Error(`export job ${args.jobId} is not a smart-render job`);
  for (const segment of args.plan.segments) {
    if (segment.kind !== "copy") continue;
    assertLocalSourcePath(segment.sourcePath);
    try {
      if (segment.sourceSize !== undefined && segment.sourceContentHash !== undefined) {
        const mismatch = fingerprintMismatch(
          { size: segment.sourceSize, mtimeMs: segment.sourceMtimeMs, contentHash: segment.sourceContentHash },
          await fingerprintFile(segment.sourcePath, entry.sourceFingerprints),
        );
        if (mismatch) throw new Error(mismatch);
      }
    } catch (error) {
      throw new Error(`SOURCE_CHANGED: ${segment.sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const declined = await entry.smart.prepareAudio(args.plan);
  return declined ? { declined } : {};
}

/**
 * Stream-copy `frames` packets of a source (starting at the key frame at
 * `sourceStart`) onto the video of a smart-render job. The renderer calls this
 * between re-encoded runs, strictly in timeline order.
 */
export async function copyExportRun(args: {
  jobId: string;
  sourcePath: string;
  sourceStart: number;
  outputStartFrame: number;
  frames: number;
  /** Byte size of the media item; a different size on disk means the file was replaced since import. */
  sourceSize?: number;
  /** Last-modified time and head/tail hash of the Blob the plan was made from (see source-guard.ts). */
  sourceMtimeMs?: number;
  sourceContentHash?: string;
}): Promise<{ frames: number }> {
  const entry = jobs.get(args.jobId);
  if (!entry?.smart) throw new Error(`export job ${args.jobId} is not a smart-render job`);
  assertLocalSourcePath(args.sourcePath);
  try {
    const expected =
      args.sourceSize !== undefined && args.sourceContentHash !== undefined
        ? { size: args.sourceSize, mtimeMs: args.sourceMtimeMs, contentHash: args.sourceContentHash }
        : undefined;
    if (!expected && args.sourceSize !== undefined) {
      const stat = await fs.stat(args.sourcePath);
      if (stat.size !== args.sourceSize) throw new Error(`size changed (${args.sourceSize} bytes in the project, ${stat.size} on disk)`);
    }
    const mismatch = await verifySourceForCopy(
      args.sourcePath,
      expected,
      { sourceStart: args.sourceStart, frameRate: entry.exportArgs.frameRate },
      entry.sourceFingerprints,
    );
    if (mismatch) throw new Error(mismatch);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`SOURCE_CHANGED: ${args.sourcePath}: ${reason}`);
  }
  try {
    const frames = await entry.smart.copyRun({
      sourcePath: args.sourcePath,
      sourceStart: args.sourceStart,
      outputStartFrame: args.outputStartFrame,
      frames: args.frames,
      frameRate: entry.exportArgs.frameRate,
    });
    return { frames };
  } catch (error) {
    if (!entry.cancelled) cancelSmartJob(args.jobId, entry);
    throw error;
  }
}

function startNativeExportJob(jobId: string, entry: JobEntry): void {
  if (entry.started) return;
  if (entry.smart) {
    entry.started = true;
    entry.port.postMessage({ type: "credit", credits: initialFrameCredits(entry.exportArgs) });
    return;
  }
  const job = createJob(jobId, entry);
  entry.cfr = new CfrWriter(entry.exportArgs.frameRate, async (f) => {
    await entry.job!.writeFrame(f);
    recordReplayFrame(entry, f);
  });
  job.start();
  entry.started = true;
  entry.port.postMessage({ type: "credit", credits: initialFrameCredits(entry.exportArgs) });
}

export function cancelAllExports(): void {
  for (const [, entry] of jobs) {
    markCancelled(entry);
    try {
      entry.job?.cancel();
    } catch {
      /* best-effort kill on quit */
    }
    entry.smart?.cancel();
    if (entry.smartVideoPath) releaseTempSync(entry.smartVideoPath);
    // Synchronous so it completes inside will-quit.
    try {
      void entry.audioHandle?.close().catch(() => {});
    } catch {
      /* best-effort close */
    }
    releaseTempSync(entry.audioWavPath);
    for (const path of entry.captionPaths) releaseTempSync(path);
    if (entry.exportArgs.passDir) rmSync(entry.exportArgs.passDir, { recursive: true, force: true });
  }
  jobs.clear();
  releaseAllPowerHolds();
}

/** Flag the entry before killing ffmpeg so the resulting close/error never triggers a retry or error report. */
function markCancelled(entry: JobEntry): void {
  entry.cancelled = true;
  entry.retried = true;
  entry.replay = null;
}

function cleanupJob(jobId: string): void {
  const entry = jobs.get(jobId);
  if (!entry) return;
  discardAudio(entry);
  // The run files, the prepared audio copies and the joined audio track live beside the video temp; they were left behind after a finished export.
  void entry.smart?.dispose().catch(() => undefined);
  if (entry.smartVideoPath) void releaseTemp(entry.smartVideoPath).catch(() => {});
  jobs.delete(jobId);
  releasePowerHold(jobId);
}

export async function cancelExport(args: { jobId: string }): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) return;
  markCancelled(entry);
  try {
    entry.job?.cancel();
    entry.smart?.cancel();
    if (entry.smartVideoPath) await releaseTemp(entry.smartVideoPath).catch(() => false);
    await entry.audioQueue.catch(() => {});
    await closeAudioHandle(entry);
    if (entry.exportArgs.passDir) await fs.rm(entry.exportArgs.passDir, { recursive: true, force: true }).catch(() => {});
    try {
      await releaseTemp(entry.audioWavPath);
      await Promise.all(entry.captionPaths.map((path) => releaseTemp(path)));
    } catch {
      /* best-effort temp cleanup */
    }
  } finally {
    jobs.delete(args.jobId);
    releasePowerHold(args.jobId);
  }
}
