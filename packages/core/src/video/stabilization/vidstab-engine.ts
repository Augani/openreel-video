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
  mt: "https://unpkg.com/@willyjl/ffmpeg.wasm-core-vidstab-mt@0.12.6/dist/esm",
  st: "https://unpkg.com/@willyjl/ffmpeg.wasm-core-vidstab@0.12.6/dist/esm",
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
  ): Promise<Blob> {
    if (!this.ffmpeg || !this.loaded) {
      throw new Error("VidstabEngine not loaded. Call load() first.");
    }

    const inputData = new Uint8Array(await sourceBlob.arrayBuffer());
    await this.ffmpeg.writeFile("input.mp4", inputData);

    const shakiness = Math.max(1, Math.min(10, Math.round(config.strength / 10)));
    const smoothing = Math.max(1, Math.round((config.strength / 100) * 30));
    const zoom = config.cropMode === "auto" ? -1 : 0;

    let progressHandler: ((data: { progress?: number }) => void) | null = null;

    progressHandler = (data: { progress?: number }) => {
      if (data.progress !== undefined) {
        onProgress?.({ stage: "detecting", progress: data.progress });
      }
    };
    this.ffmpeg.on("progress", progressHandler);

    const detectResult = await this.ffmpeg.exec([
      "-i", "input.mp4",
      "-vf", `vidstabdetect=shakiness=${shakiness}:accuracy=15:result=transforms.trf`,
      "-f", "null",
      "-",
    ]);

    if (detectResult !== 0) {
      this.ffmpeg.off("progress", progressHandler);
      await this.cleanup();
      throw new Error("vidstabdetect failed");
    }

    this.ffmpeg.off("progress", progressHandler);

    progressHandler = (data: { progress?: number }) => {
      if (data.progress !== undefined) {
        onProgress?.({ stage: "stabilizing", progress: data.progress });
      }
    };
    this.ffmpeg.on("progress", progressHandler);

    const transformResult = await this.ffmpeg.exec([
      "-i", "input.mp4",
      "-vf", `vidstabtransform=input=transforms.trf:smoothing=${smoothing}:zoom=${zoom}:interpol=bicubic`,
      "-c:a", "copy",
      "output.mp4",
    ]);

    this.ffmpeg.off("progress", progressHandler);

    if (transformResult !== 0) {
      await this.cleanup();
      throw new Error("vidstabtransform failed");
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
