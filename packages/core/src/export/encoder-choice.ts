/**
 * Encoder picker: Auto, Hardware or Software, with honest capability detection.
 * Pure mapping from (codec, platform, encoders the ffmpeg sidecar reports) to what the export
 * dialog may offer and which ffmpeg encoder a choice resolves to. The browser path maps the same
 * three choices onto WebCodecs `hardwareAcceleration` hints.
 */
export type EncoderChoice = "auto" | "hardware" | "software";
export type HardwareFamily = "videotoolbox" | "nvenc" | "qsv" | "amf";
export type EncoderCodec = "h264" | "h265" | "hevc" | "av1";

export const ENCODER_CHOICES: readonly EncoderChoice[] = ["auto", "hardware", "software"];
export const isEncoderChoice = (value: unknown): value is EncoderChoice => value === "auto" || value === "hardware" || value === "software";

export const HARDWARE_FAMILY_LABEL: Record<HardwareFamily, string> = {
  videotoolbox: "Apple VideoToolbox",
  nvenc: "NVIDIA NVENC",
  qsv: "Intel Quick Sync",
  amf: "AMD AMF",
};

const normalizeCodec = (codec: string): "h264" | "hevc" | "av1" | null =>
  codec === "h264" ? "h264" : codec === "h265" || codec === "hevc" ? "hevc" : codec === "av1" ? "av1" : null;

const SOFTWARE: Record<"h264" | "hevc" | "av1", string> = { h264: "libx264", hevc: "libx265", av1: "libsvtav1" };

/** Hardware encoders in preference order per platform. VAAPI is excluded: encode-args emits no hwupload. */
const HARDWARE: Record<"h264" | "hevc" | "av1", Partial<Record<string, string[]>>> = {
  h264: { darwin: ["h264_videotoolbox"], win32: ["h264_nvenc", "h264_qsv", "h264_amf"], linux: ["h264_nvenc", "h264_qsv"] },
  hevc: { darwin: ["hevc_videotoolbox"], win32: ["hevc_nvenc", "hevc_qsv", "hevc_amf"], linux: ["hevc_nvenc", "hevc_qsv"] },
  av1: { win32: ["av1_nvenc", "av1_qsv", "av1_amf"], linux: ["av1_nvenc", "av1_qsv"] },
};

export function hardwareFamilyOf(encoder: string): HardwareFamily | null {
  if (encoder.endsWith("_videotoolbox")) return "videotoolbox";
  if (encoder.endsWith("_nvenc")) return "nvenc";
  if (encoder.endsWith("_qsv")) return "qsv";
  if (encoder.endsWith("_amf")) return "amf";
  return null;
}

export interface ResolvedEncoder {
  /** ffmpeg encoder name, or null when the choice cannot be honoured. */
  readonly encoder: string | null;
  readonly hardware: boolean;
  readonly family: HardwareFamily | null;
  /** Why the choice is unavailable (set exactly when `encoder` is null). */
  readonly reason?: string;
}

const unavailable = (reason: string): ResolvedEncoder => ({ encoder: null, hardware: false, family: null, reason });

/**
 * Resolve a choice to an ffmpeg encoder. `available` is the verified encoder list from the sidecar
 * (hardware entries are smoke-tested, so a listed one actually opens). Auto prefers hardware and
 * falls back to software; Hardware never falls back, it reports why it cannot run.
 */
export function resolveEncoderChoice(input: {
  codec: string;
  choice: EncoderChoice;
  platform: string;
  available: readonly string[];
}): ResolvedEncoder {
  const codec = normalizeCodec(input.codec);
  if (!codec) return unavailable("This codec is encoded by a fixed encoder; the encoder choice does not apply.");
  const software = SOFTWARE[codec];
  const hasSoftware = input.available.includes(software);
  const hardwareEncoder = (HARDWARE[codec][input.platform] ?? []).find((name) => input.available.includes(name));
  const hw = (name: string): ResolvedEncoder => ({ encoder: name, hardware: true, family: hardwareFamilyOf(name) });
  const sw: ResolvedEncoder = { encoder: software, hardware: false, family: null };
  if (input.choice === "software") {
    return hasSoftware ? sw : unavailable(`This ffmpeg build has no ${software} software encoder.`);
  }
  if (input.choice === "hardware") {
    if (hardwareEncoder) return hw(hardwareEncoder);
    return unavailable(noHardwareReason(codec, input.platform));
  }
  if (hardwareEncoder) return hw(hardwareEncoder);
  return hasSoftware ? sw : unavailable("No usable encoder for this codec was found in this ffmpeg build.");
}

function noHardwareReason(codec: "h264" | "hevc" | "av1", platform: string): string {
  const names = (HARDWARE[codec][platform] ?? []).map((name) => hardwareFamilyOf(name)).filter((f): f is HardwareFamily => f !== null);
  const label = codec === "hevc" ? "H.265" : codec === "av1" ? "AV1" : "H.264";
  if (!names.length) return `${platform === "darwin" ? "VideoToolbox" : "No hardware encoder"} has no ${label} encoder on this platform.`;
  return `No working ${names.map((family) => HARDWARE_FAMILY_LABEL[family]).join(" / ")} ${label} encoder was detected on this machine.`;
}

export interface EncoderOption {
  readonly choice: EncoderChoice;
  readonly label: string;
  /** One line under the label: the encoder it would use, or why it is unavailable. */
  readonly detail: string;
  readonly available: boolean;
}

const CHOICE_LABEL: Record<EncoderChoice, string> = { auto: "Auto", hardware: "Hardware", software: "Software" };

/** What the picker shows for each choice on the desktop (ffmpeg sidecar). */
export function describeEncoderOptions(input: { codec: string; platform: string; available: readonly string[] | null }): EncoderOption[] {
  if (input.available === null) {
    return ENCODER_CHOICES.map((choice) => ({ choice, label: CHOICE_LABEL[choice], detail: "Checking this machine…", available: choice === "auto" }));
  }
  const available = input.available;
  return ENCODER_CHOICES.map((choice) => {
    const resolved = resolveEncoderChoice({ codec: input.codec, choice, platform: input.platform, available });
    if (!resolved.encoder) return { choice, label: CHOICE_LABEL[choice], detail: resolved.reason ?? "Unavailable", available: false };
    const family = resolved.family ? HARDWARE_FAMILY_LABEL[resolved.family] : null;
    const detail = resolved.hardware ? `${family ?? "Hardware"} (${resolved.encoder})` : `${resolved.encoder}, CPU`;
    return { choice, label: CHOICE_LABEL[choice], detail: choice === "auto" ? `Hardware when it can, else software (prefers ${detail})` : detail, available: true };
  });
}

export interface WebCodecsEncoderSupport {
  readonly hardware: boolean;
  readonly software: boolean;
}

/** Browser path: describe the choices from a WebCodecs probe (`null` while probing, or no WebCodecs). */
export function describeBrowserEncoderOptions(support: WebCodecsEncoderSupport | null): EncoderOption[] {
  if (support === null) return ENCODER_CHOICES.map((choice) => ({ choice, label: CHOICE_LABEL[choice], detail: "Checking this browser…", available: choice === "auto" }));
  const anyEncoder = support.hardware || support.software;
  return [
    { choice: "auto", label: "Auto", detail: support.hardware ? "Hardware (WebCodecs) when it can, else software" : support.software ? "Software (WebCodecs)" : "No encoder found in this browser", available: anyEncoder },
    { choice: "hardware", label: "Hardware", detail: support.hardware ? "GPU encoder through WebCodecs" : "This browser reports no hardware encoder for this codec", available: support.hardware },
    { choice: "software", label: "Software", detail: support.software ? "CPU encoder through WebCodecs" : "This browser reports no software encoder for this codec", available: support.software },
  ];
}

/** WebCodecs `hardwareAcceleration` hint for a choice. */
export function webCodecsHardwareHint(choice: EncoderChoice | undefined): "prefer-hardware" | "prefer-software" {
  return choice === "software" ? "prefer-software" : "prefer-hardware";
}

/** WebCodecs backend options for a choice. Hardware and Software are strict: no silent switch to the other kind. */
export function webCodecsEncoderOptions(choice: EncoderChoice | undefined): {
  hardwareAcceleration: "prefer-hardware" | "prefer-software";
  strictHardwareAcceleration: boolean;
} {
  return { hardwareAcceleration: webCodecsHardwareHint(choice), strictHardwareAcceleration: choice === "hardware" || choice === "software" };
}

/** Desktop: an explicit Hardware or Software choice is honoured by the ffmpeg sidecar, whose encoder names the picker shows. */
export function encoderChoiceForcesNative(choice: EncoderChoice | undefined, codec: string): boolean {
  return (choice === "hardware" || choice === "software") && (codec === "h264" || codec === "h265" || codec === "hevc" || codec === "av1");
}

/** Probe WebCodecs for hardware and software encoders of a codec at a size. Never throws. */
export async function probeWebCodecsEncoderSupport(codec: string, width: number, height: number, frameRate = 30): Promise<WebCodecsEncoderSupport> {
  const VideoEncoderCtor = (globalThis as { VideoEncoder?: { isConfigSupported(config: unknown): Promise<{ supported?: boolean; config?: { hardwareAcceleration?: string } }> } }).VideoEncoder;
  if (!VideoEncoderCtor?.isConfigSupported) return { hardware: false, software: false };
  const string = codec === "h265" || codec === "hevc" ? "hvc1.1.6.L93.B0" : codec === "av1" ? "av01.0.05M.08" : codec === "vp9" ? "vp09.00.10.08" : "avc1.640028";
  const test = async (hardwareAcceleration: "prefer-hardware" | "prefer-software"): Promise<boolean> => {
    try {
      const result = await VideoEncoderCtor.isConfigSupported({ codec: string, width, height, framerate: frameRate, bitrate: 5_000_000, hardwareAcceleration });
      return result.supported === true;
    } catch {
      return false;
    }
  };
  // Chromium answers `supported: false` for prefer-hardware when no hardware encoder exists; other engines may treat the hint loosely.
  const [hardware, software] = await Promise.all([test("prefer-hardware"), test("prefer-software")]);
  return { hardware, software };
}
