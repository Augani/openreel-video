import type { DeviceProfile, BenchmarkResult } from "./device-capabilities";
import { saveBenchmarkResult } from "./device-capabilities";

export interface ExportEstimateSettings {
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  codec: "h264" | "h265" | "vp9" | "av1";
  hasEffects?: boolean;
  hasTransitions?: boolean;
  trackCount?: number;
}

export interface TimeEstimate {
  seconds: number;
  formatted: string;
  confidence: "measured" | "estimated" | "rough";
  breakdown?: {
    rendering: number;
    encoding: number;
    muxing: number;
  };
}

export interface BenchmarkProgress {
  phase: "preparing" | "rendering" | "encoding" | "complete";
  progress: number;
  framesProcessed: number;
  totalFrames: number;
}

const BASE_FPS_ESTIMATES: Record<string, Record<string, number>> = {
  h264: {
    hardware_high: 120,
    hardware_mid: 90,
    hardware_low: 60,
    software_high: 45,
    software_mid: 30,
    software_low: 15,
  },
  h265: {
    hardware_high: 60,
    hardware_mid: 45,
    hardware_low: 30,
    software_high: 15,
    software_mid: 8,
    software_low: 4,
  },
  vp9: {
    hardware_high: 30,
    hardware_mid: 20,
    hardware_low: 15,
    software_high: 20,
    software_mid: 12,
    software_low: 6,
  },
  av1: {
    hardware_high: 45,
    hardware_mid: 30,
    hardware_low: 20,
    software_high: 8,
    software_mid: 4,
    software_low: 2,
  },
};

const RESOLUTION_MULTIPLIERS: Record<string, number> = {
  "1280x720": 1.5,
  "1920x1080": 1.0,
  "2560x1440": 0.6,
  "3840x2160": 0.25,
};

function getResolutionMultiplier(width: number, height: number): number {
  const key = `${width}x${height}`;
  if (RESOLUTION_MULTIPLIERS[key]) {
    return RESOLUTION_MULTIPLIERS[key];
  }

  const pixels = width * height;
  const basePixels = 1920 * 1080;
  return basePixels / pixels;
}

function getComplexityMultiplier(settings: ExportEstimateSettings): number {
  let multiplier = 1.0;

  if (settings.hasEffects) {
    multiplier *= 0.7;
  }

  if (settings.hasTransitions) {
    multiplier *= 0.85;
  }

  if (settings.trackCount && settings.trackCount > 2) {
    multiplier *= Math.max(0.5, 1 - (settings.trackCount - 2) * 0.1);
  }

  return multiplier;
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `~${Math.round(seconds)} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (minutes < 60) {
    if (remainingSeconds === 0) {
      return `~${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    return `~${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `~${hours}h ${remainingMinutes}m`;
}

export function estimateExportTime(
  profile: DeviceProfile,
  settings: ExportEstimateSettings
): TimeEstimate {
  const totalFrames = Math.ceil(settings.duration * settings.frameRate);

  if (profile.benchmark) {
    const benchmarkResPixels =
      profile.benchmark.resolution.width * profile.benchmark.resolution.height;
    const targetResPixels = settings.width * settings.height;
    const resolutionFactor = benchmarkResPixels / targetResPixels;

    let codecFactor = 1.0;
    if (profile.benchmark.codec !== settings.codec) {
      const codecSpeeds: Record<string, number> = {
        h264: 1.0,
        h265: 0.4,
        vp9: 0.5,
        av1: 0.2,
      };
      codecFactor =
        (codecSpeeds[profile.benchmark.codec] || 1) /
        (codecSpeeds[settings.codec] || 1);
    }

    const adjustedFps =
      profile.benchmark.framesPerSecond *
      resolutionFactor *
      codecFactor *
      getComplexityMultiplier(settings);

    const seconds = totalFrames / Math.max(1, adjustedFps);

    return {
      seconds,
      formatted: formatTime(seconds),
      confidence: "measured",
      breakdown: {
        rendering: seconds * 0.4,
        encoding: seconds * 0.55,
        muxing: seconds * 0.05,
      },
    };
  }

  const codecSupport = profile.encoding[settings.codec];
  const isHardware = codecSupport?.hardware || false;
  const tier = profile.overallTier;

  const encodingType = isHardware ? "hardware" : "software";
  const key = `${encodingType}_${tier}`;

  const baseFps = BASE_FPS_ESTIMATES[settings.codec]?.[key] || 15;
  const resolutionMultiplier = getResolutionMultiplier(
    settings.width,
    settings.height
  );
  const complexityMultiplier = getComplexityMultiplier(settings);

  const estimatedFps = baseFps * resolutionMultiplier * complexityMultiplier;
  const seconds = totalFrames / Math.max(1, estimatedFps);

  return {
    seconds,
    formatted: formatTime(seconds),
    confidence: "estimated",
    breakdown: {
      rendering: seconds * 0.4,
      encoding: seconds * 0.55,
      muxing: seconds * 0.05,
    },
  };
}

export async function runBenchmark(
  onProgress?: (progress: BenchmarkProgress) => void
): Promise<BenchmarkResult> {
  const BENCHMARK_FRAMES = 60;
  const WIDTH = 1920;
  const HEIGHT = 1080;

  onProgress?.({
    phase: "preparing",
    progress: 0,
    framesProcessed: 0,
    totalFrames: BENCHMARK_FRAMES,
  });

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to create canvas context for benchmark");
  }

  const frames: ImageBitmap[] = [];
  for (let i = 0; i < BENCHMARK_FRAMES; i++) {
    ctx.fillStyle = `hsl(${(i * 6) % 360}, 70%, 50%)`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "white";
    ctx.font = "48px sans-serif";
    ctx.fillText(`Frame ${i + 1}`, WIDTH / 2 - 80, HEIGHT / 2);

    const bitmap = await createImageBitmap(canvas);
    frames.push(bitmap);

    onProgress?.({
      phase: "rendering",
      progress: ((i + 1) / BENCHMARK_FRAMES) * 0.3,
      framesProcessed: i + 1,
      totalFrames: BENCHMARK_FRAMES,
    });
  }

  if (typeof VideoEncoder === "undefined") {
    frames.forEach((f) => f.close());
    throw new Error("VideoEncoder not supported");
  }

  const encodedChunks: EncodedVideoChunk[] = [];
  let encodedCount = 0;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      encodedChunks.push(chunk);
      encodedCount++;
      onProgress?.({
        phase: "encoding",
        progress: 0.3 + (encodedCount / BENCHMARK_FRAMES) * 0.65,
        framesProcessed: encodedCount,
        totalFrames: BENCHMARK_FRAMES,
      });
    },
    error: (e) => {
      console.error("Benchmark encoder error:", e);
    },
  });

  const config: VideoEncoderConfig = {
    codec: "avc1.42001E",
    width: WIDTH,
    height: HEIGHT,
    bitrate: 5_000_000,
    framerate: 30,
    hardwareAcceleration: "prefer-hardware",
  };

  const supported = await VideoEncoder.isConfigSupported(config);
  if (!supported.supported) {
    config.hardwareAcceleration = "prefer-software";
  }

  encoder.configure(config);

  const startTime = performance.now();

  for (let i = 0; i < frames.length; i++) {
    const frame = new VideoFrame(frames[i], {
      timestamp: i * (1_000_000 / 30),
      duration: 1_000_000 / 30,
    });

    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  const endTime = performance.now();
  const elapsedSeconds = (endTime - startTime) / 1000;
  const framesPerSecond = BENCHMARK_FRAMES / elapsedSeconds;

  frames.forEach((f) => f.close());

  onProgress?.({
    phase: "complete",
    progress: 1,
    framesProcessed: BENCHMARK_FRAMES,
    totalFrames: BENCHMARK_FRAMES,
  });

  const result: BenchmarkResult = {
    framesPerSecond,
    codec: "h264",
    resolution: { width: WIDTH, height: HEIGHT },
    testedAt: Date.now(),
  };

  saveBenchmarkResult(result);

  return result;
}

export function shouldRecommendBenchmark(profile: DeviceProfile): boolean {
  if (!profile.benchmark) {
    return true;
  }

  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - profile.benchmark.testedAt > oneWeek) {
    return true;
  }

  return false;
}
