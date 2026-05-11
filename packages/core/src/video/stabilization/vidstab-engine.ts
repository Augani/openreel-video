import type { StabilizationConfig } from "./types";
import { DEFAULT_STABILIZATION_CONFIG } from "./types";

type FFmpegInstance = {
  load(options?: {
    coreURL?: string;
    wasmURL?: string;
    workerURL?: string;
  }): Promise<void>;
  writeFile(name: string, data: Uint8Array | string): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  exec(args: string[]): Promise<number>;
  on(
    event: string,
    callback: (data: { progress?: number; time?: number; message?: string; type?: string }) => void,
  ): void;
  off(
    event: string,
    callback?: (data: { progress?: number; time?: number; message?: string; type?: string }) => void,
  ): void;
  terminate(): void;
};

const VIDSTAB_CORE_CDN = {
  mt: "https://mediashares.openreel.video/ffmpeg-vidstab/mt",
  st: "https://mediashares.openreel.video/ffmpeg-vidstab/st",
};

export type VidstabProgress = {
  stage: "downloading" | "detecting" | "stabilizing";
  progress: number;
};

export class VidstabEngine {
  private ffmpeg: FFmpegInstance | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private stabilizedBlobs: Map<string, Blob> = new Map();

  async load(onProgress?: (progress: VidstabProgress) => void): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = this.doLoad(onProgress);
    await this.loading;
  }

  private async doLoad(onProgress?: (progress: VidstabProgress) => void): Promise<void> {
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");

      this.ffmpeg = new FFmpeg() as unknown as FFmpegInstance;

      onProgress?.({ stage: "downloading", progress: 0 });

      const useMultiThread =
        typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;

      const baseURL = useMultiThread ? VIDSTAB_CORE_CDN.mt : VIDSTAB_CORE_CDN.st;

      if (useMultiThread) {
        const [coreURL, wasmURL, workerURL] = await Promise.all([
          toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
          toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript"),
        ]);

        onProgress?.({ stage: "downloading", progress: 0.9 });

        await this.ffmpeg.load({ coreURL, wasmURL, workerURL });
      } else {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        ]);

        onProgress?.({ stage: "downloading", progress: 0.9 });

        await this.ffmpeg.load({ coreURL, wasmURL });
      }

      onProgress?.({ stage: "downloading", progress: 1 });
      this.loaded = true;
    } catch (error) {
      this.loading = null;
      throw new Error(
        `Failed to load FFmpeg vidstab core: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  isLoaded(): boolean {
    return this.loaded && this.ffmpeg !== null;
  }

  hasStabilized(clipId: string): boolean {
    return this.stabilizedBlobs.has(clipId);
  }

  getStabilizedBlob(clipId: string): Blob | null {
    return this.stabilizedBlobs.get(clipId) ?? null;
  }

  async stabilize(
    clipId: string,
    sourceBlob: Blob,
    config: StabilizationConfig = DEFAULT_STABILIZATION_CONFIG,
    onProgress?: (progress: VidstabProgress) => void,
    trimRange?: { inPoint: number; outPoint: number },
  ): Promise<Blob> {
    if (!this.ffmpeg || !this.loaded) {
      throw new Error("VidstabEngine not loaded. Call load() first.");
    }

    const inputData = new Uint8Array(await sourceBlob.arrayBuffer());
    await this.ffmpeg.writeFile("input.mp4", inputData);

    const shakiness = Math.max(1, Math.min(10, Math.round(config.strength / 10)));
    const accuracy = Math.max(3, Math.min(15, Math.round((config.strength / 100) * 15)));
    const smoothing = Math.max(1, Math.round((config.strength / 100) * 30));
    const zoom = config.cropMode === "auto" ? -1 : 0;

    const logs: string[] = [];
    let frameCount = 0;
    let totalFrames = 0;
    const logHandler = (data: { message?: string; type?: string }) => {
      if (!data.message) return;
      logs.push(data.message);

      const durationMatch = data.message.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (durationMatch) {
        const secs = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]) + parseInt(durationMatch[4]) / 100;
        const fpsMatch = logs.join(" ").match(/(\d+(?:\.\d+)?) fps/);
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 30;
        totalFrames = Math.round(secs * fps);
      }

      if (data.message.includes("Discarding frame")) {
        frameCount++;
        if (totalFrames > 0) {
          onProgress?.({ stage: "detecting", progress: frameCount / totalFrames });
        }
      }
    };
    this.ffmpeg.on("log", logHandler);

    let progressHandler: ((data: { progress?: number }) => void) | null = null;

    progressHandler = (data: { progress?: number; time?: number }) => {
      if (data.progress !== undefined && data.progress > 0) {
        onProgress?.({ stage: "detecting", progress: Math.min(data.progress, 1) });
      } else if (data.time !== undefined && data.time > 0 && totalFrames > 0) {
        const timeSecs = data.time / 1000000;
        const fpsMatch = logs.join(" ").match(/(\d+(?:\.\d+)?) fps/);
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 30;
        const durationSecs = totalFrames / fps;
        if (durationSecs > 0) {
          onProgress?.({ stage: "detecting", progress: Math.min(timeSecs / durationSecs, 0.99) });
        }
      }
    };
    this.ffmpeg.on("progress", progressHandler);

    const inputArgs: string[] = [];
    if (trimRange && trimRange.inPoint > 0) {
      inputArgs.push("-ss", trimRange.inPoint.toString());
    }
    inputArgs.push("-i", "input.mp4");
    if (trimRange && trimRange.outPoint > trimRange.inPoint) {
      inputArgs.push("-t", (trimRange.outPoint - trimRange.inPoint).toString());
    }

    const detectResult = await this.ffmpeg.exec([
      ...inputArgs,
      "-an",
      "-vf", `vidstabdetect=shakiness=${shakiness}:accuracy=${accuracy}:result=transforms.trf`,
      "-f", "null",
      "-",
    ]);

    if (detectResult !== 0) {
      this.ffmpeg.off("progress", progressHandler);
      this.ffmpeg.off("log", logHandler);
      await this.cleanup();
      throw new Error(`vidstabdetect failed: ${logs.slice(-5).join(" | ")}`);
    }

    this.ffmpeg.off("progress", progressHandler);

    onProgress?.({ stage: "stabilizing", progress: 0 });

    progressHandler = (data: { progress?: number; time?: number }) => {
      if (data.progress !== undefined && data.progress > 0) {
        onProgress?.({ stage: "stabilizing", progress: Math.min(data.progress, 1) });
      } else if (data.time !== undefined && data.time > 0 && totalFrames > 0) {
        const timeSecs = data.time / 1000000;
        const fpsMatch = logs.join(" ").match(/(\d+(?:\.\d+)?) fps/);
        const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 30;
        const durationSecs = totalFrames / fps;
        if (durationSecs > 0) {
          onProgress?.({ stage: "stabilizing", progress: Math.min(timeSecs / durationSecs, 0.99) });
        }
      }
    };
    this.ffmpeg.on("progress", progressHandler);

    const transformResult = await this.ffmpeg.exec([
      ...inputArgs,
      "-vf", `vidstabtransform=input=transforms.trf:smoothing=${smoothing}:zoom=${zoom}:interpol=bicubic`,
      "-preset", "slow",
      "-crf", "15",
      "-c:a", "copy",
      "output.mp4",
    ]);

    this.ffmpeg.off("progress", progressHandler);

    this.ffmpeg.off("log", logHandler);

    if (transformResult !== 0) {
      await this.cleanup();
      throw new Error(`vidstabtransform failed: ${logs.slice(-5).join(" | ")}`);
    }

    const outputData = await this.ffmpeg.readFile("output.mp4");
    const stabilizedBlob = new Blob([outputData.buffer as ArrayBuffer], { type: "video/mp4" });

    this.stabilizedBlobs.set(clipId, stabilizedBlob);

    await this.cleanup();

    return stabilizedBlob;
  }

  private async cleanup(): Promise<void> {
    if (!this.ffmpeg) return;
    try { await this.ffmpeg.deleteFile("input.mp4"); } catch {}
    try { await this.ffmpeg.deleteFile("output.mp4"); } catch {}
    try { await this.ffmpeg.deleteFile("transforms.trf"); } catch {}
  }

  removeStabilized(clipId: string): void {
    this.stabilizedBlobs.delete(clipId);
  }

  dispose(): void {
    this.stabilizedBlobs.clear();
    if (this.ffmpeg) {
      this.ffmpeg.terminate();
      this.ffmpeg = null;
    }
    this.loaded = false;
    this.loading = null;
  }
}

let vidstabEngineInstance: VidstabEngine | null = null;

export function getVidstabEngine(): VidstabEngine {
  if (!vidstabEngineInstance) {
    vidstabEngineInstance = new VidstabEngine();
  }
  return vidstabEngineInstance;
}

export function disposeVidstabEngine(): void {
  vidstabEngineInstance?.dispose();
  vidstabEngineInstance = null;
}
