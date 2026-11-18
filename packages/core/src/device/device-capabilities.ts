import type { NativeHardwareInfo } from "./native-profile";

export type DeviceTier = "low" | "mid" | "high";

export interface CpuInfo {
  cores: number;
  tier: DeviceTier;
}

export interface MemoryInfo {
  gb: number;
  tier: DeviceTier;
}

export interface GpuInfo {
  vendor: string;
  renderer: string;
  tier: DeviceTier;
  hasHardwareEncoding: boolean;
}

export interface DeviceCodecSupport {
  hardware: boolean;
  supported: boolean;
  maxResolution?: { width: number; height: number };
}

export interface EncodingSupport {
  h264: DeviceCodecSupport;
  h265: DeviceCodecSupport;
  vp9: DeviceCodecSupport;
  av1: DeviceCodecSupport;
}

export interface BenchmarkResult {
  framesPerSecond: number;
  codec: string;
  resolution: { width: number; height: number };
  testedAt: number;
}

export interface DeviceProfile {
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpu: GpuInfo;
  encoding: EncodingSupport;
  benchmark?: BenchmarkResult;
  platform: {
    os: string;
    browser: string;
    isMobile: boolean;
  };
  overallTier: DeviceTier;
}

export interface CodecRecommendation {
  codec: "h264" | "h265" | "vp9" | "av1";
  label: string;
  recommended: boolean;
  reason: string;
  speedRating: "fast" | "medium" | "slow" | "very-slow";
  qualityRating: "good" | "better" | "best";
}

const STORAGE_KEY = "openreel_device_profile";

export function getCpuTier(cores: number): DeviceTier {
  if (cores >= 8) return "high";
  if (cores >= 4) return "mid";
  return "low";
}

export function getMemoryTier(gb: number): DeviceTier {
  if (gb >= 8) return "high";
  if (gb >= 4) return "mid";
  return "low";
}

export function getGpuTier(renderer: string): DeviceTier {
  const r = renderer.toLowerCase();

  // Apple Silicon (native strings like "Apple M2 Pro"; covers current + future generations):
  // M1 base = mid, M1 Pro/Max/Ultra = high, M2 and newer = high.
  const appleSilicon = /apple m(\d+)/.exec(r);
  if (appleSilicon) {
    const generation = Number(appleSilicon[1]);
    if (generation >= 2) return "high";
    if (r.includes("pro") || r.includes("max") || r.includes("ultra")) return "high";
    return "mid";
  }

  const highEndPatterns = [
    "nvidia rtx",
    "nvidia geforce rtx",
    "radeon rx 6",
    "radeon rx 7",
    "apple m1 pro",
    "apple m1 max",
    "apple m2",
    "apple m3",
    "intel arc",
  ];

  const midEndPatterns = [
    "nvidia gtx 1",
    "nvidia geforce gtx",
    "radeon rx 5",
    "apple m1",
    "intel iris",
    "intel uhd",
  ];

  if (highEndPatterns.some((p) => r.includes(p))) return "high";
  if (midEndPatterns.some((p) => r.includes(p))) return "mid";
  return "low";
}

function detectPlatform(): DeviceProfile["platform"] {
  const ua = navigator.userAgent;

  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";

  let browser = "Unknown";
  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edg")) browser = "Edge";

  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  return { os, browser, isMobile };
}

function detectGpu(): Omit<GpuInfo, "hasHardwareEncoding"> {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");

    if (!gl) {
      return { vendor: "Unknown", renderer: "Unknown", tier: "low" };
    }

    const debugInfo = (gl as WebGLRenderingContext).getExtension(
      "WEBGL_debug_renderer_info"
    );

    if (debugInfo) {
      const vendor = (gl as WebGLRenderingContext).getParameter(
        debugInfo.UNMASKED_VENDOR_WEBGL
      );
      const renderer = (gl as WebGLRenderingContext).getParameter(
        debugInfo.UNMASKED_RENDERER_WEBGL
      );

      return {
        vendor: vendor || "Unknown",
        renderer: renderer || "Unknown",
        tier: getGpuTier(renderer || ""),
      };
    }

    return { vendor: "Unknown", renderer: "Unknown", tier: "mid" };
  } catch {
    return { vendor: "Unknown", renderer: "Unknown", tier: "low" };
  }
}

async function checkCodecSupport(
  codecString: string,
  width: number,
  height: number
): Promise<DeviceCodecSupport> {
  if (typeof VideoEncoder === "undefined") {
    return { hardware: false, supported: false };
  }

  try {
    const baseConfig = {
      codec: codecString,
      width,
      height,
      bitrate: 5_000_000,
      framerate: 30,
    };

    const hwResult = await VideoEncoder.isConfigSupported({
      ...baseConfig,
      hardwareAcceleration: "prefer-hardware",
    });

    const swResult = await VideoEncoder.isConfigSupported({
      ...baseConfig,
      hardwareAcceleration: "prefer-software",
    });

    const isHardware =
      hwResult.supported === true &&
      hwResult.config?.hardwareAcceleration === "prefer-hardware";

    return {
      hardware: isHardware,
      supported: hwResult.supported === true || swResult.supported === true,
      maxResolution: { width, height },
    };
  } catch {
    return { hardware: false, supported: false };
  }
}

async function detectEncodingSupport(): Promise<EncodingSupport> {
  const codecs = {
    h264: "avc1.42001E",
    h265: "hvc1.1.6.L93.B0",
    vp9: "vp09.00.10.08",
    av1: "av01.0.04M.08",
  };

  const [h264, h265, vp9, av1] = await Promise.all([
    checkCodecSupport(codecs.h264, 1920, 1080),
    checkCodecSupport(codecs.h265, 1920, 1080),
    checkCodecSupport(codecs.vp9, 1920, 1080),
    checkCodecSupport(codecs.av1, 1920, 1080),
  ]);

  return { h264, h265, vp9, av1 };
}

export function calculateOverallTier(
  cpu: CpuInfo,
  memory: MemoryInfo,
  gpu: GpuInfo
): DeviceTier {
  const tierValues: Record<DeviceTier, number> = { low: 1, mid: 2, high: 3 };
  const avg =
    (tierValues[cpu.tier] +
      tierValues[memory.tier] +
      tierValues[gpu.tier] * 1.5) /
    3.5;

  if (avg >= 2.5) return "high";
  if (avg >= 1.5) return "mid";
  return "low";
}

async function detectDeviceCapabilities(): Promise<DeviceProfile> {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;

  const cpu: CpuInfo = { cores, tier: getCpuTier(cores) };
  const memoryInfo: MemoryInfo = { gb: memory, tier: getMemoryTier(memory) };
  const gpuBase = detectGpu();
  const encoding = await detectEncodingSupport();
  const platform = detectPlatform();

  const hasHardwareEncoding = Object.values(encoding).some((e) => e.hardware);
  const gpu: GpuInfo = { ...gpuBase, hasHardwareEncoding };

  const overallTier = calculateOverallTier(cpu, memoryInfo, gpu);

  const cached = loadCachedBenchmark();

  return {
    cpu,
    memory: memoryInfo,
    gpu,
    encoding,
    platform,
    overallTier,
    benchmark: cached,
  };
}

export function getCodecRecommendations(
  profile: DeviceProfile,
  resolution: { width: number; height: number }
): CodecRecommendation[] {
  const is4K = resolution.width * resolution.height > 1920 * 1080;
  const recommendations: CodecRecommendation[] = [];

  if (profile.encoding.h264.supported) {
    const hasHw = profile.encoding.h264.hardware;
    recommendations.push({
      codec: "h264",
      label: "H.264 (MP4)",
      recommended: true,
      reason: hasHw ? "Hardware accelerated" : "Fast software encoding",
      speedRating: hasHw ? "fast" : "medium",
      qualityRating: "good",
    });
  }

  if (profile.encoding.h265.supported) {
    const hasHw = profile.encoding.h265.hardware;
    recommendations.push({
      codec: "h265",
      label: "H.265/HEVC (MP4)",
      recommended: hasHw && !is4K,
      reason: hasHw
        ? "Hardware accelerated, better compression"
        : "Better compression, slower encoding",
      speedRating: hasHw ? "medium" : "slow",
      qualityRating: "better",
    });
  }

  if (profile.encoding.vp9.supported) {
    recommendations.push({
      codec: "vp9",
      label: "VP9 (WebM)",
      recommended: false,
      reason: "Good for web, software encoding only",
      speedRating: "slow",
      qualityRating: "better",
    });
  }

  if (profile.encoding.av1.supported) {
    const hasHw = profile.encoding.av1.hardware;
    recommendations.push({
      codec: "av1",
      label: "AV1 (MP4/WebM)",
      recommended: hasHw && profile.overallTier === "high",
      reason: hasHw
        ? "Best compression, hardware accelerated"
        : "Best compression, very slow encoding",
      speedRating: hasHw ? "medium" : "very-slow",
      qualityRating: "best",
    });
  }

  return recommendations.sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return 0;
  });
}

function loadCachedBenchmark(): BenchmarkResult | undefined {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (data.benchmark && Date.now() - data.benchmark.testedAt < oneWeek) {
        return data.benchmark;
      }
    }
  } catch {
    // Ignore cache errors
  }
  return undefined;
}

export function saveBenchmarkResult(result: BenchmarkResult): void {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    const data = existing ? JSON.parse(existing) : {};
    data.benchmark = result;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

let cachedProfile: DeviceProfile | null = null;

export async function getDeviceProfile(
  forceRefresh = false
): Promise<DeviceProfile> {
  if (!forceRefresh && cachedProfile) {
    return cachedProfile;
  }

  // Desktop: build the profile from real hardware specs (window.openreel.probeHardware)
  // instead of the browser heuristics (navigator/WebGL/WebCodecs).
  const bridge = (globalThis as unknown as {
    openreel?: { platform?: string; probeHardware?: () => Promise<NativeHardwareInfo> };
  }).openreel;
  if (bridge?.platform === "desktop" && typeof bridge.probeHardware === "function") {
    const info = await bridge.probeHardware();
    const { buildProfileFromNativeSpecs } = await import("./native-profile");
    cachedProfile = buildProfileFromNativeSpecs(info);
    return cachedProfile;
  }

  cachedProfile = await detectDeviceCapabilities();
  return cachedProfile;
}

export function formatDeviceSummary(profile: DeviceProfile): string {
  const parts = [];

  if (profile.gpu.renderer !== "Unknown") {
    const gpuName = profile.gpu.renderer
      .replace(/ANGLE \(|, .*\)/g, "")
      .replace(/Direct3D11 vs_\d+_\d+ ps_\d+_\d+/g, "")
      .trim();
    parts.push(gpuName);
  }

  parts.push(`${profile.cpu.cores} cores`);

  return parts.join(" · ");
}

export type WorkerKind = "decode";

function isDesktopRuntime(): boolean {
  return (
    (globalThis as unknown as { openreel?: { platform?: string } }).openreel
      ?.platform === "desktop"
  );
}

/**
 * Worker count for a pool. Web keeps min(4, cores); desktop scales with the
 * logical core count (half of it, between 4 and 8).
 */
export function getRecommendedWorkerCount(
  _kind: WorkerKind,
  logicalCores: number = (typeof navigator !== "undefined" &&
    navigator.hardwareConcurrency) ||
    4,
  desktop: boolean = isDesktopRuntime(),
): number {
  const cores = Math.max(1, Math.floor(logicalCores));
  if (!desktop) return Math.min(4, cores);
  return Math.max(4, Math.min(Math.floor(cores / 2), 8));
}

export interface CacheBudget {
  maxSizeBytes: number;
  maxFrames: number;
}

const WEB_CACHE_BYTES = 500 * 1024 * 1024;
const MIN_DESKTOP_CACHE_BYTES = 500 * 1024 * 1024;
const MAX_DESKTOP_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
// The V8 heap is capped near 30% of RAM on desktop; decoded frames must leave room for it.
const MAX_DESKTOP_CACHE_RAM_FRACTION = 0.15;
// A cached 1080p RGBA frame; maxFrames follows the byte budget at this size.
const REFERENCE_FRAME_BYTES = 1920 * 1080 * 4;

/**
 * Frame cache budget. Web keeps 500 MB / 100 frames. Desktop uses ~12% of total
 * RAM (500 MB to 2 GB, never above 15% of RAM), minus the heap already in use.
 */
export function computeCacheBudget(
  totalMemoryBytes: number | null,
  desktop: boolean,
  usedHeapBytes = 0,
): CacheBudget {
  if (!desktop || !totalMemoryBytes || totalMemoryBytes <= 0) {
    return { maxSizeBytes: WEB_CACHE_BYTES, maxFrames: 100 };
  }
  const ceiling = Math.min(
    MAX_DESKTOP_CACHE_BYTES,
    totalMemoryBytes * MAX_DESKTOP_CACHE_RAM_FRACTION,
  );
  const floor = Math.min(MIN_DESKTOP_CACHE_BYTES, ceiling);
  const target = Math.min(
    ceiling,
    Math.max(MIN_DESKTOP_CACHE_BYTES, totalMemoryBytes * 0.12),
  );
  const maxSizeBytes = Math.max(floor, target - Math.max(0, usedHeapBytes));
  const maxFrames = Math.max(
    100,
    Math.floor(maxSizeBytes / REFERENCE_FRAME_BYTES),
  );
  return { maxSizeBytes: Math.floor(maxSizeBytes), maxFrames };
}

/** Cache budget for the running platform, derived from the device profile. */
export async function getRecommendedCacheBudget(
  usedHeapBytes = 0,
): Promise<CacheBudget> {
  const desktop = isDesktopRuntime();
  if (!desktop) return computeCacheBudget(null, false);
  const profile = await getDeviceProfile();
  return computeCacheBudget(profile.memory.gb * 1024 ** 3, true, usedHeapBytes);
}
