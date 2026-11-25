import { x265ColorParams, type NativeColorOutput } from "./color-output-args";

export type ExportCodec = "h264" | "h265" | "hevc" | "av1" | "prores" | "vp9" | "dnxhr" | "xdcamhd422" | "avcintra100";
export type BroadcastScan = "progressive" | "interlaced-tff";

export const isBroadcastExportCodec = (codec: string): codec is "xdcamhd422" | "avcintra100" =>
  codec === "xdcamhd422" || codec === "avcintra100";
export type DnxhrProfile = "lb" | "sq" | "hq" | "hqx" | "444";
export type EncodeMode = "fast" | "balanced" | "smallest";
type CodecFamily = "x264" | "x265" | "svtav1" | "vp9";

export interface EncodePlan {
  codec: ExportCodec;
  encoder: string;
  mode: EncodeMode;
  quality: number;
  width: number;
  height: number;
  frameRate: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  /** DNxHR flavour (codec "dnxhr"); HQ when omitted. */
  dnxhrProfile?: DnxhrProfile;
  /** ProRes 4444 / 4444 XQ only: carry the render's alpha channel (yuva444p10le) instead of an opaque 4:4:4 picture. */
  alpha?: boolean;
  /** GOP length in frames (-g). Omitted lets the encoder pick. */
  keyframeInterval?: number;
  /** Colour-managed output (BT.2020 / HDR). Absent: the classic BT.709 SDR path, argument for argument. */
  color?: NativeColorOutput;
  /** XDCAM HD422 / AVC-Intra 100: top-field-first interlaced frames (1080i) instead of progressive. */
  scan?: BroadcastScan;
  /** One-pass variable bitrate: average `targetKbps`, peaks under `maxKbps`. Replaces CRF / the derived hardware target. */
  rate?: { targetKbps: number; maxKbps?: number };
  /**
   * Two-pass VBR (needs `rate`; libx264 / libx265 only): stage 1 writes the first-pass statistics to
   * `logPrefix`, stage 2 reads them to spend the bits where the picture needs them.
   */
  pass?: { stage: 1 | 2; logPrefix: string };
}

/** Encoders that run a real two-pass encode through ffmpeg's -pass / -passlogfile. */
export function supportsTwoPass(encoder: string): boolean {
  return encoder === "libx264" || encoder === "libx265";
}

/** `-b:v / -maxrate / -bufsize` for an explicit rate (the buffer is two seconds of the peak rate, as for the hardware path). */
export function rateControlArgs(rate: { targetKbps: number; maxKbps?: number }): string[] {
  const target = Math.max(100, Math.round(rate.targetKbps));
  const max = Math.max(target, Math.round(rate.maxKbps ?? target * 1.5));
  return ["-b:v", `${target}k`, "-maxrate", `${max}k`, "-bufsize", `${max * 2}k`];
}

const clampQuality = (q: number): number => Math.max(50, Math.min(100, q));

const CRF_BOUNDS: Record<CodecFamily, [number, number]> = {
  x264: [30, 16],
  x265: [30, 18],
  svtav1: [45, 23],
  vp9: [40, 24],
};

export function qualityToCrf(family: CodecFamily, quality: number): number {
  const [lo, hi] = CRF_BOUNDS[family];
  const t = (clampQuality(quality) - 50) / 50;
  return Math.round(lo + (hi - lo) * t);
}

export function isSoftwareEncoder(encoder: string): boolean {
  return /^(libx264|libx265|libsvtav1|libaom|libvpx)/.test(encoder);
}

function familyForEncoder(encoder: string): CodecFamily {
  if (encoder.includes("vpx")) return "vp9";
  if (encoder.includes("x265")) return "x265";
  if (encoder.includes("svtav1") || encoder.includes("aom") || encoder.includes("av1")) return "svtav1";
  return "x264";
}

function softwarePreset(family: CodecFamily, mode: EncodeMode): string {
  if (family === "svtav1") {
    if (mode === "fast") return "8";
    if (mode === "balanced") return "6";
    return "5";
  }
  if (mode === "fast") return "veryfast";
  if (mode === "balanced") return "fast";
  return "slow";
}

const CODEC_BPP_SCALE: Partial<Record<ExportCodec, number>> = {
  h264: 1.0,
  h265: 0.6,
  hevc: 0.6,
  av1: 0.55,
  vp9: 0.7,
};

const MODE_BPP_SCALE: Record<EncodeMode, number> = {
  fast: 0.85,
  balanced: 1.0,
  smallest: 1.0,
};

function hardwareTargetKbps(plan: {
  codec: ExportCodec;
  mode: EncodeMode;
  quality: number;
  width: number;
  height: number;
  frameRate: number;
}): number {
  const q = clampQuality(plan.quality);
  const baseBpp = 0.07 + ((q - 50) / 50) * 0.11;
  const bpp = baseBpp * (CODEC_BPP_SCALE[plan.codec] ?? 1.0) * MODE_BPP_SCALE[plan.mode];
  const kbps = (plan.width * plan.height * plan.frameRate * bpp) / 1000;
  return Math.max(500, Math.round(kbps));
}

export const isProres4444 = (profile: EncodePlan["proresProfile"]): boolean => profile === "4444" || profile === "4444xq";

export function pixelFormatForPlan(plan: Pick<EncodePlan, "codec" | "proresProfile" | "dnxhrProfile" | "alpha">): string {
  if (plan.codec === "xdcamhd422") return "yuv422p";
  if (plan.codec === "avcintra100") return "yuv422p10le";
  if (plan.codec === "prores") {
    if (isProres4444(plan.proresProfile)) return plan.alpha ? "yuva444p10le" : "yuv444p10le";
    return "yuv422p10le";
  }
  if (plan.codec === "dnxhr") {
    switch (plan.dnxhrProfile ?? "hq") {
      case "hqx":
        return "yuv422p10le";
      case "444":
        return "yuv444p10le";
      default:
        return "yuv422p";
    }
  }
  return "yuv420p";
}

/** ffmpeg `-profile:v` value of each DNxHR flavour (the dnxhd encoder serves DNxHD and DNxHR). */
const DNXHR_PROFILE_NAME: Record<DnxhrProfile, string> = {
  lb: "dnxhr_lb",
  sq: "dnxhr_sq",
  hq: "dnxhr_hq",
  hqx: "dnxhr_hqx",
  "444": "dnxhr_444",
};
/** Pixel format handed to the encoder for a colour-managed export. */
function colorPixelFormat(plan: EncodePlan, color: NativeColorOutput): string {
  // ProRes 4444 / 4444 XQ keep the renderer's 4:4:4 planes; 422 HQ (and the other 422 profiles) take them down to 4:2:2
  // here, a chroma-only conversion (the planes are already in the output colour space and tagged by setparams).
  if (plan.codec === "prores") return proresProfileIs444(plan.proresProfile) && color.chroma === "444" ? "yuv444p10le" : "yuv422p10le";
  if (color.bitDepth === 10) {
    // VideoToolbox takes 10-bit input as p010; the stream is still Main10 4:2:0 10-bit.
    return plan.encoder.endsWith("_videotoolbox") ? "p010le" : "yuv420p10le";
  }
  return "yuv420p";
}

/** ProRes 4444 and 4444 XQ store 4:4:4 with alpha-capable chroma; every other profile is 4:2:2. */
export function proresProfileIs444(profile: EncodePlan["proresProfile"]): boolean {
  return profile === "4444" || profile === "4444xq";
}

const PRORES_PROFILE_NUM: Record<NonNullable<EncodePlan["proresProfile"]>, string> = {
  proxy: "0",
  lt: "1",
  standard: "2",
  hq: "3",
  "4444": "4",
  "4444xq": "5",
};

function clampKeyframeInterval(frames: number): number {
  if (!Number.isFinite(frames)) return 1;
  return Math.max(1, Math.min(600, Math.round(frames)));
}

/** Frames per GOP of XDCAM HD422: 12 at the 25 / 24 Hz family, 15 at the 29.97 / 30 Hz family. */
export const xdcamGopLength = (frameRate: number): number => (frameRate > 26 && frameRate < 31 ? 15 : 12);

/**
 * XDCAM HD422: MPEG-2 4:2:2 Profile @ High Level, 50 Mb/s constant bit rate, long GOP (open GOP off, 2 B frames),
 * intra DC precision 10 and the quantiser settings Sony cameras use. With `scan` interlaced the frames carry the
 * top-field-first flags and the encoder uses interlaced DCT and motion estimation.
 */
export function xdcamHd422Args(plan: Pick<EncodePlan, "frameRate" | "scan">): string[] {
  const interlaced = plan.scan === "interlaced-tff";
  return [
    "-profile:v", "0",
    "-level:v", "2",
    "-b:v", "50000k", "-minrate", "50000k", "-maxrate", "50000k",
    "-bufsize", "36408333", "-rc_init_occupancy", "36408333",
    "-g", String(xdcamGopLength(plan.frameRate)), "-bf", "2",
    "-intra_vlc", "1", "-non_linear_quant", "1", "-dc", "10", "-qmax", "8",
    "-mpv_flags", "+strict_gop", "-sc_threshold", "1000000000",
    // Top-field-first is stamped on the frames by `setfield=tff` (see `withTopFieldFirst`): the `-top` output
    // option was removed in FFmpeg 9 and `-field_order` is overridden by the frame properties.
    ...(interlaced ? ["-flags", "+ildct+ilme"] : []),
  ];
}

/**
 * Marks every frame as top-field-first interlaced by appending `setfield=tff` to the `-vf` chain in `args`
 * (adding one when absent). The ffmpeg CLI derives the MPEG-2 encoder's field order from the frame flags, and
 * this works the same on FFmpeg 7.x and 9.x (the old `-top 1` is an error on 9).
 */
export function withTopFieldFirst(args: string[], plan: Pick<EncodePlan, "codec" | "scan">): string[] {
  if (plan.codec !== "xdcamhd422" || plan.scan !== "interlaced-tff") return args;
  const i = args.indexOf("-vf");
  if (i < 0 || i + 1 >= args.length) return [...args, "-vf", "setfield=tff"];
  const out = [...args];
  out[i + 1] = `${out[i + 1]},setfield=tff`;
  return out;
}

/**
 * AVC-Intra 100: libx264's AVC-Intra class 100 mode (High 4:2:2 Intra profile, 10-bit, all-intra, the fixed
 * 100 Mb/s class rate), tagged BT.709. Needs a libx264 build (the shipped GPL ffmpeg has it).
 */
export function avcIntra100Args(plan: Pick<EncodePlan, "scan">): string[] {
  return [
    "-x264-params", "avcintra-class=100:colorprim=bt709:transfer=bt709:colormatrix=bt709",
    ...(plan.scan === "interlaced-tff" ? ["-field_order", "tt", "-flags", "+ildct"] : []),
  ];
}

export function videoEncodeArgs(plan: EncodePlan): string[] {
  const args: string[] = ["-c:v", plan.encoder];

  if (plan.codec === "xdcamhd422") {
    args.push(...xdcamHd422Args(plan));
  } else if (plan.codec === "avcintra100") {
    args.push(...avcIntra100Args(plan));
  } else if (plan.codec === "prores") {
    args.push("-profile:v", PRORES_PROFILE_NUM[plan.proresProfile ?? "hq"]);
    // prores_ks writes the Apple vendor tag Final Cut / Premiere / Resolve expect.
    if (plan.encoder === "prores_ks") args.push("-vendor", "apl0");
  } else if (plan.codec === "dnxhr") {
    args.push("-profile:v", DNXHR_PROFILE_NAME[plan.dnxhrProfile ?? "hq"]);
  } else if (plan.rate && plan.codec !== "av1") {
    // Explicit target / peak rate: software and hardware encoders alike take -b:v / -maxrate / -bufsize.
    const family = isSoftwareEncoder(plan.encoder) ? familyForEncoder(plan.encoder) : null;
    if (family) args.push("-threads", "0");
    args.push(...rateControlArgs(plan.rate));
    if (family === "vp9") {
      args.push("-row-mt", "1", "-deadline", plan.mode === "smallest" ? "good" : "realtime", "-cpu-used", plan.mode === "fast" ? "8" : plan.mode === "balanced" ? "5" : "2");
    } else if (family) {
      args.push("-preset", softwarePreset(family, plan.mode));
    } else if (plan.encoder.endsWith("_videotoolbox") && plan.width * plan.height <= 4096 * 2304) {
      args.push("-allow_sw", "0");
    }
  } else if (isSoftwareEncoder(plan.encoder)) {
    const family = familyForEncoder(plan.encoder);
    args.push("-threads", "0", "-crf", String(qualityToCrf(family, plan.quality)));
    if (family === "vp9") {
      // libvpx has no -preset; constant-quality mode needs -b:v 0, and
      // -deadline/-cpu-used trade speed for size.
      args.push(
        "-b:v", "0",
        "-row-mt", "1",
        "-deadline", plan.mode === "smallest" ? "good" : "realtime",
        "-cpu-used", plan.mode === "fast" ? "8" : plan.mode === "balanced" ? "5" : "2",
      );
    } else {
      args.push("-preset", softwarePreset(family, plan.mode));
    }
  } else {
    const target = hardwareTargetKbps(plan);
    args.push(
      "-b:v", `${target}k`,
      "-maxrate", `${Math.round(target * 1.5)}k`,
      "-bufsize", `${target * 2}k`,
    );
    // Fail fast instead of silently falling back to the (slow) software path.
    // Sizes past ~4K exceed VideoToolbox limits on many Macs, so let those
    // fall back to software instead of failing.
    if (plan.encoder.endsWith("_videotoolbox") && plan.width * plan.height <= 4096 * 2304) {
      args.push("-allow_sw", "0");
    }
  }

  if (plan.pass && plan.rate && supportsTwoPass(plan.encoder)) {
    args.push("-pass", String(plan.pass.stage), "-passlogfile", plan.pass.logPrefix);
  }

  if (plan.keyframeInterval !== undefined && plan.codec !== "prores" && plan.codec !== "dnxhr" && !isBroadcastExportCodec(plan.codec)) {
    args.push("-g", String(clampKeyframeInterval(plan.keyframeInterval)));
  }

  if (plan.color) {
    if (plan.codec === "prores") args.push("-vendor", "apl0");
    if (plan.encoder === "libx265") args.push("-x265-params", `${x265ColorParams(plan.color)}:log-level=error`);
    if (plan.encoder === "hevc_videotoolbox" && plan.color.bitDepth === 10) args.push("-profile:v", "main10");
    args.push("-pix_fmt", colorPixelFormat(plan, plan.color));
  } else {
    args.push("-pix_fmt", pixelFormatForPlan(plan));
  }

  if (plan.codec === "hevc" || plan.codec === "h265") {
    args.push("-tag:v", "hvc1");
  }

  return args;
}
