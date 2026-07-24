import {
  getCpuTier,
  getMemoryTier,
  getGpuTier,
  calculateOverallTier,
  type DeviceProfile,
  type EncodingSupport,
  type DeviceCodecSupport,
  type BenchmarkResult,
  type CpuInfo,
  type MemoryInfo,
  type GpuInfo,
} from "./device-capabilities";

// Mirror of OpenReelHardwareInfo (window.openreel.probeHardware result). packages/core does not
// see apps/web's ambient type, so the shape is declared locally.
export interface NativeHardwareInfo {
  cpu: { model: string; physicalCores: number; logicalCores: number };
  memory: { totalBytes: number; freeBytes: number };
  gpus: string[];
  encoders: string[];
  platform: "darwin" | "win32" | "linux";
  arch: string;
}

// Per-codec ffmpeg encoder families (mirrors the desktop encoder-probe preference tables).
const HW_ENCODERS: Record<keyof EncodingSupport, string[]> = {
  h264: ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "h264_vaapi"],
  h265: ["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_vaapi"],
  vp9: ["vp9_qsv", "vp9_vaapi"],
  av1: ["av1_nvenc", "av1_qsv", "av1_amf", "av1_vaapi"],
};
const SW_ENCODERS: Record<keyof EncodingSupport, string[]> = {
  h264: ["libx264"],
  h265: ["libx265"],
  vp9: ["libvpx-vp9", "libvpx"],
  av1: ["libsvtav1", "libaom-av1"],
};

function encodersToSupport(encoders: string[]): EncodingSupport {
  const codecSupport = (codec: keyof EncodingSupport): DeviceCodecSupport => {
    const hardware = HW_ENCODERS[codec].some((e) => encoders.includes(e));
    const supported = hardware || SW_ENCODERS[codec].some((e) => encoders.includes(e));
    return { hardware, supported };
  };
  return {
    h264: codecSupport("h264"),
    h265: codecSupport("h265"),
    vp9: codecSupport("vp9"),
    av1: codecSupport("av1"),
  };
}

function osLabel(platform: NativeHardwareInfo["platform"]): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

export function buildProfileFromNativeSpecs(
  info: NativeHardwareInfo,
  benchmark?: BenchmarkResult,
): DeviceProfile {
  const cores = info.cpu.logicalCores;
  const gb = Math.round(info.memory.totalBytes / 1024 ** 3);
  const renderer = info.gpus[0] ?? "Unknown";
  const encoding = encodersToSupport(info.encoders);

  const cpu: CpuInfo = { cores, tier: getCpuTier(cores) };
  const memory: MemoryInfo = { gb, tier: getMemoryTier(gb) };
  const gpu: GpuInfo = {
    vendor: renderer.split(/\s+/)[0] || "Unknown",
    renderer,
    tier: getGpuTier(renderer),
    hasHardwareEncoding: encoding.h264.hardware || encoding.h265.hardware,
  };

  return {
    cpu,
    memory,
    gpu,
    encoding,
    benchmark,
    platform: { os: osLabel(info.platform), browser: "Electron", isMobile: false },
    overallTier: calculateOverallTier(cpu, memory, gpu),
  };
}
