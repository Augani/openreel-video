import type {
  ExportFormatOption,
  ExportOptionsCatalog,
  ExportPresetOption,
} from "@openreel/agent";
import {
  DEFAULT_VIDEO_SETTINGS,
  getVideoExportValidationError,
  isValidLoudnessTarget,
  normalizeStartTimecode,
  probeHdrExportSupport,
  type HdrExportSupport,
  type VideoExportSettings,
} from "@openreel/core";
import type { Project } from "@openreel/core/types/project";
import { exportPresetsManager } from "../export-presets";
import { getQuickExportPresets } from "../quick-export-presets";

/**
 * The export catalog agents see (`get_export_options`) and the mapping from an agent's request to
 * VideoExportSettings. Both read the same sources as the Export dialog: quick presets, platform
 * presets, the desktop encoder list and the HDR capability probe.
 */

type ProjectSizing = Pick<Project["settings"], "width" | "height" | "frameRate"> & { startTimecode?: string; workingColorSpace?: Project["settings"]["workingColorSpace"] };

export interface ExportCatalogEnv {
  desktop: boolean;
  /** ffmpeg encoder names the desktop build reports; undefined = unknown (assume present). */
  encoders?: readonly string[];
  hdr: HdrExportSupport;
  project: ProjectSizing;
  /** Working colour space is Rec.2020 (colour-managed output even for SDR). */
  colorManaged?: boolean;
}

const COMMON_RESOLUTIONS = [
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
  { label: "1440p", width: 2560, height: 1440 },
  { label: "4K UHD", width: 3840, height: 2160 },
  { label: "Vertical 1080x1920", width: 1080, height: 1920 },
  { label: "Square 1080x1080", width: 1080, height: 1080 },
] as const;

const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as const;

export function buildExportCatalog(env: ExportCatalogEnv): ExportOptionsCatalog {
  const hasEncoder = (pattern: RegExp): boolean => !env.encoders || env.encoders.some((name) => pattern.test(name));
  const tenBit = env.hdr.supported;
  const hdrModes: Array<"sdr" | "pq" | "hlg"> = tenBit ? ["sdr", "pq", "hlg"] : ["sdr"];
  const missing = (what: string): string => `this build's ffmpeg has no ${what} encoder`;

  type Option = NonNullable<ExportFormatOption["codecOptions"]>[number];
  const h264: Option = { codec: "h264", bitDepths: [8], hdr: ["sdr"] };
  const h265: Option = { codec: "h265", bitDepths: tenBit ? [8, 10] : [8], hdr: hdrModes };

  const collect = (
    id: string,
    container: string,
    candidates: Array<{ option: Option; ok: boolean; why?: string }>,
    desktopOnlyReason?: string,
  ): ExportFormatOption => {
    const usable = candidates.filter((entry) => entry.ok).map((entry) => entry.option);
    const blocked = candidates.filter((entry) => !entry.ok).map((entry) => ({ codec: entry.option.codec, reason: entry.why ?? "unavailable here" }));
    const available = desktopOnlyReason ? false : usable.length > 0;
    return {
      id,
      container,
      codecs: desktopOnlyReason ? [] : usable.map((option) => option.codec),
      bitDepths: [...new Set(usable.flatMap((option) => option.bitDepths))].sort((a, b) => a - b) as Array<8 | 10>,
      hdr: [...new Set(usable.flatMap((option) => option.hdr))] as Array<"sdr" | "pq" | "hlg">,
      available,
      ...(available ? {} : { reason: desktopOnlyReason ?? "no usable encoder" }),
      ...(available ? { codecOptions: usable } : {}),
      ...(blocked.length && available ? { unavailableCodecs: blocked } : {}),
    };
  };

  const proresHdr: Option = { codec: "prores", bitDepths: [10], hdr: hdrModes };
  const formats: ExportFormatOption[] = [
    collect("mp4", "MPEG-4", [
      { option: h264, ok: true },
      { option: h265, ok: env.desktop ? hasEncoder(/libx265|hevc/) : true, why: missing("H.265") },
      { option: { codec: "av1", bitDepths: [8], hdr: ["sdr"] }, ok: env.desktop && hasEncoder(/av1|aom|svt|rav1e/), why: env.desktop ? missing("AV1") : "AV1 export needs the desktop app" },
    ]),
    collect("mov", "QuickTime", [
      { option: h264, ok: true },
      { option: h265, ok: env.desktop ? hasEncoder(/libx265|hevc/) : true, why: missing("H.265") },
      { option: proresHdr, ok: env.desktop && hasEncoder(/prores/), why: env.desktop ? missing("ProRes") : "ProRes export needs the desktop app" },
      { option: { codec: "dnxhr", bitDepths: [8], hdr: ["sdr"] }, ok: env.desktop && hasEncoder(/dnxhd/), why: env.desktop ? missing("DNxHR") : "DNxHR export needs the desktop app" },
      { option: { codec: "xdcamhd422", bitDepths: [8], hdr: ["sdr"] }, ok: env.desktop && hasEncoder(/mpeg2video/), why: env.desktop ? missing("MPEG-2") : "XDCAM HD422 export needs the desktop app" },
      { option: { codec: "avcintra100", bitDepths: [10], hdr: ["sdr"] }, ok: env.desktop && hasEncoder(/libx264/), why: env.desktop ? missing("x264") : "AVC-Intra 100 export needs the desktop app" },
    ]),
    collect("webm", "WebM", [
      { option: { codec: "vp9", bitDepths: [8], hdr: ["sdr"] }, ok: true },
      { option: { codec: "vp8", bitDepths: [8], hdr: ["sdr"] }, ok: true },
      { option: { codec: "av1", bitDepths: [8], hdr: ["sdr"] }, ok: env.desktop && hasEncoder(/av1|aom|svt|rav1e/), why: env.desktop ? missing("AV1") : "AV1 export needs the desktop app" },
    ]),
    collect(
      "mxf",
      "MXF",
      [
        { option: { codec: "dnxhr", bitDepths: [8], hdr: ["sdr"] }, ok: hasEncoder(/dnxhd/), why: missing("DNxHR") },
        { option: { codec: "xdcamhd422", bitDepths: [8], hdr: ["sdr"] }, ok: hasEncoder(/mpeg2video/), why: missing("MPEG-2") },
        { option: { codec: "avcintra100", bitDepths: [10], hdr: ["sdr"] }, ok: hasEncoder(/libx264/), why: missing("x264") },
      ],
      env.desktop ? undefined : "MXF export needs the desktop app",
    ),
  ];

  const presets: ExportPresetOption[] = [];
  const seen = new Set<string>();
  for (const preset of getQuickExportPresets(env.project)) {
    seen.add(preset.id);
    if (preset.kind === "video") {
      presets.push({
        id: preset.id,
        label: preset.label,
        kind: "video",
        description: preset.description,
        format: preset.settings.format,
        codec: preset.settings.codec,
        width: preset.settings.width,
        height: preset.settings.height,
        frameRate: preset.settings.frameRate,
        ...(preset.settings.bitrate ? { bitrateKbps: preset.settings.bitrate } : {}),
      });
    } else {
      presets.push({ id: preset.id, label: preset.label, kind: "audio", description: preset.description, format: preset.settings.format ?? "wav" });
    }
  }
  for (const preset of exportPresetsManager.getAllPresets()) {
    const settings = preset.settings;
    if (seen.has(preset.id) || !("codec" in settings)) continue;
    seen.add(preset.id);
    presets.push({
      id: preset.id,
      label: preset.name,
      kind: "video",
      description: preset.description,
      format: settings.format,
      codec: settings.codec,
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      ...(settings.bitrate ? { bitrateKbps: settings.bitrate } : {}),
    });
  }

  const project = env.project;
  const resolutions = [{ label: "Project size", width: project.width, height: project.height }, ...COMMON_RESOLUTIONS.filter((entry) => !(entry.width === project.width && entry.height === project.height))];

  return {
    platform: env.desktop ? "desktop" : "web",
    ...(env.colorManaged ? { colorManaged: true } : {}),
    formats,
    presets,
    resolutions,
    frameRates: [...new Set<number>([project.frameRate, ...FRAME_RATES])].sort((a, b) => a - b),
    audioLayouts: ["mono", "stereo", "5.1"],
    hdr: env.hdr.reason ? { supported: env.hdr.supported, reason: env.hdr.reason } : { supported: env.hdr.supported },
    timecode: env.desktop ? { supported: true } : { supported: false, reason: "writing a start timecode needs the desktop encoder" },
  };
}

/** Gather the machine's capabilities (encoder list, HDR probe) and build the catalog. */
export async function loadExportCatalog(project: Project): Promise<ExportOptionsCatalog> {
  const desktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const hardware = desktop ? await (window.openreel?.probeHardware?.() ?? Promise.resolve(null)).catch(() => null) : null;
  const hdr = await probeHdrExportSupport({ native: desktop, encoders: hardware?.encoders }).catch(
    (): HdrExportSupport => ({ supported: false, reason: "The HDR capability probe failed." }),
  );
  return buildExportCatalog({
    desktop,
    ...(hardware?.encoders ? { encoders: hardware.encoders } : {}),
    hdr,
    colorManaged: project.settings.workingColorSpace === "rec2020",
    project: { width: project.settings.width, height: project.settings.height, frameRate: project.settings.frameRate, startTimecode: project.settings.startTimecode },
  });
}

export interface VideoPreset {
  label: string;
  settings: Partial<VideoExportSettings>;
}

/** A video preset by id: the quick presets first, then the platform presets (and the user's own). */
export function findVideoPreset(id: string, project: ProjectSizing): VideoPreset | undefined {
  const quick = getQuickExportPresets(project).find((entry) => entry.id === id);
  if (quick) return quick.kind === "video" ? { label: quick.label, settings: quick.settings } : undefined;
  const platform = exportPresetsManager.getAllPresets().find((entry) => entry.id === id);
  if (platform && "codec" in platform.settings) return { label: platform.name, settings: platform.settings };
  return undefined;
}

/** Request fields beyond the queue's own (format, codec, size, rate, bitrate). */
export interface ExtendedExportFields {
  codec?: string;
  bitDepth?: 8 | 10;
  hdr?: "sdr" | "pq" | "hlg";
  audioChannels?: "mono" | "stereo" | "5.1";
  timecode?: boolean;
  targetLufs?: number;
  truePeakCeilingDb?: number;
  maxBitrateKbps?: number;
  rateControl?: "quality" | "vbr" | "vbr2";
}

/**
 * The settings an agent's extended options add on top of a preset: colour depth and HDR, the
 * profile of ProRes / DNxHR, audio layout, a written start timecode and loudness normalization.
 * Throws a plain Error for a value the engine would reject.
 */
export function extendedSettingsPatch(
  fields: ExtendedExportFields,
  project: ProjectSizing,
  base: Partial<VideoExportSettings> = {},
): Partial<VideoExportSettings> {
  const patch: Partial<VideoExportSettings> = {};
  const codec = fields.codec ?? base.codec;
  if (fields.hdr === "pq" || fields.hdr === "hlg") {
    patch.hdr = fields.hdr;
    patch.colorDepth = 10;
    if (codec === "prores") patch.proresProfile = "4444xq";
  } else if (fields.hdr === "sdr") {
    patch.hdr = undefined;
  }
  if (fields.bitDepth !== undefined) patch.colorDepth = fields.bitDepth;
  if (fields.rateControl === "vbr2") {
    patch.rateControl = "vbr2";
    if (fields.maxBitrateKbps !== undefined) patch.maxBitrate = fields.maxBitrateKbps;
  } else if (fields.rateControl === "vbr" || fields.maxBitrateKbps !== undefined) {
    patch.rateControl = "vbr";
    if (fields.maxBitrateKbps !== undefined) patch.maxBitrate = fields.maxBitrateKbps;
  } else if (fields.rateControl === "quality") {
    patch.rateControl = "quality";
  }
  // Two-pass has no colour-managed path: a stored vbr2 (preset) on a Rec.2020 sequence runs as one-pass VBR.
  if (project.workingColorSpace === "rec2020" && (patch.rateControl ?? base.rateControl) === "vbr2") {
    patch.rateControl = "vbr";
    if ((patch.bitrateMode ?? base.bitrateMode) === "vbr2") patch.bitrateMode = "vbr1";
  }
  if (codec === "prores" && patch.proresProfile === undefined) patch.proresProfile = base.proresProfile ?? "hq";
  if (codec === "dnxhr") patch.dnxhrProfile = base.dnxhrProfile ?? "hq";

  const audio = { ...DEFAULT_VIDEO_SETTINGS.audioSettings, ...(base.audioSettings ?? {}) };
  let audioChanged = false;
  if (fields.audioChannels === "mono") {
    audio.channels = 1;
    audioChanged = true;
  } else if (fields.audioChannels === "stereo") {
    audio.channels = 2;
    audio.channelLayout = "stereo";
    audioChanged = true;
  } else if (fields.audioChannels === "5.1") {
    audio.channels = 6;
    audio.channelLayout = "5.1";
    audioChanged = true;
  }
  if (fields.targetLufs !== undefined) {
    const loudness = { enabled: true, targetLufs: fields.targetLufs, truePeakCeilingDb: fields.truePeakCeilingDb ?? -1 };
    if (!isValidLoudnessTarget(loudness)) throw new Error("targetLufs must be -40..-5 and truePeakCeilingDb must be -20..0 (default -1).");
    audio.loudness = loudness;
    audioChanged = true;
  }
  if (audioChanged) patch.audioSettings = audio;

  if (fields.timecode === true) {
    const start = normalizeStartTimecode(project.startTimecode ?? "00:00:00:00", project.frameRate) ?? "00:00:00:00";
    patch.broadcast = { ...(base.broadcast ?? {}), startTimecode: start };
  }
  return patch;
}

export interface VideoExportRequest extends ExtendedExportFields {
  presetId?: string;
  format?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  bitrateKbps?: number;
}

/** Everything export_video needs: the preset, defaults, explicit options and the extended patch merged. */
export function buildVideoExportSettings(
  request: VideoExportRequest,
  project: ProjectSizing,
  duration: number,
): { settings: VideoExportSettings; presetLabel: string; ext: string } {
  const preset = request.presetId ? findVideoPreset(request.presetId, project) : undefined;
  if (request.presetId && !preset) throw new Error(`Unknown video preset '${request.presetId}'. Call get_export_options for the ids.`);
  const base = preset?.settings ?? {};
  const merged: VideoExportSettings = {
    ...DEFAULT_VIDEO_SETTINGS,
    width: project.width,
    height: project.height,
    frameRate: project.frameRate,
    bitrate: 12000,
    bitrateMode: "vbr",
    quality: 85,
    keyframeInterval: 2,
    ...base,
    ...(request.format ? { format: request.format as VideoExportSettings["format"] } : {}),
    ...(request.codec ? { codec: request.codec as VideoExportSettings["codec"] } : {}),
    ...(request.width !== undefined ? { width: request.width } : {}),
    ...(request.height !== undefined ? { height: request.height } : {}),
    ...(request.frameRate !== undefined ? { frameRate: request.frameRate } : {}),
    ...(request.bitrateKbps !== undefined ? { bitrate: request.bitrateKbps } : {}),
  };
  const patch = extendedSettingsPatch(request, project, merged);
  const settings: VideoExportSettings = { ...merged, ...patch };
  if (patch.hdr === undefined && request.hdr === "sdr") delete (settings as { hdr?: unknown }).hdr;
  const invalid = getVideoExportValidationError(settings, duration);
  if (invalid) throw new Error(invalid);
  const ext = settings.format;
  return { settings, presetLabel: preset?.label ?? "Custom", ext };
}
