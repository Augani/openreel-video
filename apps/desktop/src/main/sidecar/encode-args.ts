export type ExportCodec = "h264" | "h265" | "hevc" | "av1" | "prores" | "vp9";
export type EncodeMode = "fast" | "balanced" | "smallest";
export type CodecFamily = "x264" | "x265" | "svtav1";

export interface EncodePlan {
  codec: ExportCodec;
  encoder: string;
  mode: EncodeMode;
  quality: number;
  width: number;
  height: number;
  frameRate: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}

const clampQuality = (q: number): number => Math.max(50, Math.min(100, q));

const CRF_BOUNDS: Record<CodecFamily, [number, number]> = {
  x264: [30, 16],
  x265: [30, 18],
  svtav1: [45, 23],
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

export function hardwareTargetKbps(plan: {
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

export function containerForCodec(codec: ExportCodec): "mp4" | "mov" {
  return codec === "prores" ? "mov" : "mp4";
}

export function pixelFormatForCodec(codec: ExportCodec): string {
  return codec === "prores" ? "yuv422p10le" : "yuv420p";
}

const PRORES_PROFILE_NUM: Record<NonNullable<EncodePlan["proresProfile"]>, string> = {
  proxy: "0",
  lt: "1",
  standard: "2",
  hq: "3",
  "4444": "4",
  "4444xq": "5",
};

export function videoEncodeArgs(plan: EncodePlan): string[] {
  const args: string[] = ["-c:v", plan.encoder];

  if (plan.codec === "prores") {
    args.push("-profile:v", PRORES_PROFILE_NUM[plan.proresProfile ?? "hq"]);
  } else if (isSoftwareEncoder(plan.encoder)) {
    const family = familyForEncoder(plan.encoder);
    args.push("-crf", String(qualityToCrf(family, plan.quality)));
    args.push("-preset", softwarePreset(family, plan.mode));
  } else {
    const target = hardwareTargetKbps(plan);
    args.push(
      "-b:v", `${target}k`,
      "-maxrate", `${Math.round(target * 1.5)}k`,
      "-bufsize", `${target * 2}k`,
    );
  }

  args.push("-pix_fmt", pixelFormatForCodec(plan.codec));

  if (plan.codec === "hevc" || plan.codec === "h265") {
    args.push("-tag:v", "hvc1");
  }

  return args;
}
