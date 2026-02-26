import type { ExportProgress } from "../export/types";
type FFmpegInstance = {
  load(options?: {
    coreURL?: string;
    wasmURL?: string;
    workerURL?: string;
  }): Promise<void>;
  writeFile(name: string, data: Uint8Array | string): Promise<void>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
  listDir(path: string): Promise<{ name: string; isDir: boolean }[]>;
  exec(args: string[]): Promise<number>;
  on(
    event: string,
    callback: (data: { progress: number; time?: number }) => void,
  ): void;
  off(
    event: string,
    callback?: (data: { progress: number; time?: number }) => void,
  ): void;
  terminate(): void;
};

export interface ProxySettings {
  scale: number;
  preset: "ultrafast" | "fast" | "medium";
  crf: number;
  audioBitrate: number;
  maxWidth?: number;
  maxHeight?: number;
}

export const PROXY_PRESETS: Record<"low" | "medium" | "high", ProxySettings> = {
  low: {
    scale: 0.25,
    preset: "ultrafast",
    crf: 32,
    audioBitrate: 96,
    maxWidth: 960,
    maxHeight: 540,
  },
  medium: {
    scale: 0.5,
    preset: "fast",
    crf: 28,
    audioBitrate: 128,
    maxWidth: 1280,
    maxHeight: 720,
  },
  high: {
    scale: 0.75,
    preset: "medium",
    crf: 23,
    audioBitrate: 192,
    maxWidth: 1920,
    maxHeight: 1080,
  },
};

export const PROXY_THRESHOLDS = {
  /** Minimum pixel count to trigger proxy (4K = 3840 * 2160) */
  minPixelCount: 3840 * 2160,
  minDuration: 600,
  minFileSize: 500 * 1024 * 1024,
};

export interface TranscodeOptions {
  format?: "webm" | "mp4";
  videoCodec?: "libvpx-vp9" | "libx264";
  audioCodec?: "libopus" | "aac";
  videoBitrate?: string;
  audioBitrate?: string;
  enableRowMt?: boolean;
}

const DEFAULT_TRANSCODE_OPTIONS: Required<TranscodeOptions> = {
  format: "webm",
  videoCodec: "libvpx-vp9",
  audioCodec: "libopus",
  videoBitrate: "2M",
  audioBitrate: "128k",
  enableRowMt: true,
};

export class FFmpegFallback {
  private ffmpeg: FFmpegInstance | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private progressCallback:
    | ((data: { progress: number; time?: number }) => void)
    | null = null;

  private calculateBufsize(bitrate: string): string {
    const match = bitrate.match(/^(\d+(?:\.\d+)?)\s*([KkMmGg]?)$/);
    if (!match) return bitrate;
    const value = parseFloat(match[1]);
    const unit = match[2] || "";
    return `${Math.round(value * 2)}${unit}`;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = this.doLoad();
    await this.loading;
  }

  private async doLoad(): Promise<void> {
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");

      this.ffmpeg = new FFmpeg() as unknown as FFmpegInstance;

      const useMultiThread = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
      const baseURL = useMultiThread
        ? "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm"
        : "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

      if (useMultiThread) {
        const [coreURL, wasmURL, workerURL] = await Promise.all([
          toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
          toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript"),
        ]);

        await this.ffmpeg.load({
          coreURL,
          wasmURL,
          workerURL,
        });
      } else {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        ]);

        await this.ffmpeg.load({
          coreURL,
          wasmURL,
        });
      }

      this.loaded = true;
    } catch (error) {
      this.loading = null;
      console.error("[FFmpeg] Load error:", error);

      throw new Error(
        `Failed to load FFmpeg.wasm: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  isLoaded(): boolean {
    return this.loaded && this.ffmpeg !== null;
  }

  private ensureLoaded(): void {
    if (!this.ffmpeg || !this.loaded) {
      throw new Error("FFmpeg not loaded. Call load() first.");
    }
  }

  private async fileToUint8Array(file: File | Blob): Promise<Uint8Array> {
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  private async cleanupFiles(filenames: string[]): Promise<void> {
    if (!this.ffmpeg) return;

    for (const filename of filenames) {
      try {
        await this.ffmpeg.deleteFile(filename);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private setupProgressTracking(
    onProgress?: (progress: ExportProgress) => void,
    totalDuration?: number,
  ): void {
    if (!this.ffmpeg || !onProgress) return;
    if (this.progressCallback) {
      this.ffmpeg.off("progress", this.progressCallback);
    }

    this.progressCallback = ({ progress, time }) => {
      let estimatedTimeRemaining = 0;
      if (totalDuration && time && progress > 0) {
        const elapsedTime = time / 1000000;
        const rate = elapsedTime / progress;
        estimatedTimeRemaining = (1 - progress) * rate;
      }

      onProgress({
        phase: progress < 1 ? "encoding" : "complete",
        progress: Math.min(progress, 1),
        currentFrame: 0,
        totalFrames: 0,
        estimatedTimeRemaining,
        bytesWritten: 0,
        currentBitrate: 0,
      });
    };

    this.ffmpeg.on("progress", this.progressCallback);
  }

  private removeProgressTracking(): void {
    if (!this.ffmpeg || !this.progressCallback) return;
    this.ffmpeg.off("progress", this.progressCallback);
    this.progressCallback = null;
  }

  async transcodeToCompatible(
    file: File | Blob,
    onProgress?: (progress: ExportProgress) => void,
    options: TranscodeOptions = {},
  ): Promise<Blob> {
    await this.load();
    this.ensureLoaded();

    const opts = { ...DEFAULT_TRANSCODE_OPTIONS, ...options };
    const inputFilename = "input";
    const outputFilename = `output.${opts.format}`;

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);
      this.setupProgressTracking(onProgress);
      const args = ["-i", inputFilename];

      // Video codec settings
      args.push("-c:v", opts.videoCodec);
      args.push("-b:v", opts.videoBitrate);

      // Enable row-based multi-threading for VP9
      if (opts.videoCodec === "libvpx-vp9" && opts.enableRowMt) {
        args.push("-row-mt", "1");
      }

      // Audio codec settings
      args.push("-c:a", opts.audioCodec);
      args.push("-b:a", opts.audioBitrate);

      // Output file
      args.push(outputFilename);

      await this.ffmpeg!.exec(args);

      const data = await this.ffmpeg!.readFile(outputFilename);
      const mimeType = opts.format === "webm" ? "video/webm" : "video/mp4";

      return new Blob([data.buffer as ArrayBuffer], { type: mimeType });
    } finally {
      this.removeProgressTracking();
      await this.cleanupFiles([inputFilename, outputFilename]);
    }
  }

  async transcodeToMp4(
    file: File | Blob,
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob> {
    return this.transcodeToCompatible(file, onProgress, {
      format: "mp4",
      videoCodec: "libx264",
      audioCodec: "aac",
      videoBitrate: "5M",
      audioBitrate: "192k",
    });
  }

  async extractAudioAsWav(file: File | Blob): Promise<Blob> {
    await this.load();
    this.ensureLoaded();

    const inputFilename = "input";
    const outputFilename = "output.wav";

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);

      await this.ffmpeg!.exec([
        "-i",
        inputFilename,
        "-vn", // No video
        "-acodec",
        "pcm_f32le", // 32-bit float PCM
        "-ar",
        "48000", // 48kHz sample rate
        "-ac",
        "2", // Stereo
        outputFilename,
      ]);

      const data = await this.ffmpeg!.readFile(outputFilename);
      return new Blob([data.buffer as ArrayBuffer], { type: "audio/wav" });
    } finally {
      await this.cleanupFiles([inputFilename, outputFilename]);
    }
  }

  async generateProxy(
    file: File | Blob,
    settings: Partial<ProxySettings> = {},
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob> {
    await this.load();
    this.ensureLoaded();
    const opts: ProxySettings = { ...PROXY_PRESETS.medium, ...settings };
    const inputFilename = "input";
    const outputFilename = "proxy.mp4";

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);
      this.setupProgressTracking(onProgress);
      let scaleFilter: string;
      if (opts.maxWidth && opts.maxHeight) {
        // Scale to fit within max dimensions while maintaining aspect ratio
        scaleFilter = `scale='min(${opts.maxWidth},iw*${opts.scale})':'min(${opts.maxHeight},ih*${opts.scale})':force_original_aspect_ratio=decrease`;
      } else {
        scaleFilter = `scale=iw*${opts.scale}:ih*${opts.scale}`;
      }
      scaleFilter += ",pad=ceil(iw/2)*2:ceil(ih/2)*2";

      await this.ffmpeg!.exec([
        "-i",
        inputFilename,
        "-vf",
        scaleFilter,
        "-c:v",
        "libx264",
        "-preset",
        opts.preset,
        "-crf",
        opts.crf.toString(),
        "-c:a",
        "aac",
        "-b:a",
        `${opts.audioBitrate}k`,
        // Fast start for web playback
        "-movflags",
        "+faststart",
        outputFilename,
      ]);

      const data = await this.ffmpeg!.readFile(outputFilename);
      return new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
    } finally {
      this.removeProgressTracking();
      await this.cleanupFiles([inputFilename, outputFilename]);
    }
  }

  async generateProxyWithPreset(
    file: File | Blob,
    preset: "low" | "medium" | "high",
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob> {
    return this.generateProxy(file, PROXY_PRESETS[preset], onProgress);
  }

  async extractRange(
    file: File | Blob,
    startTime: number,
    endTime: number,
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob> {
    await this.load();
    this.ensureLoaded();

    const inputFilename = "input";
    const outputFilename = "output.mp4";
    const duration = endTime - startTime;

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);

      this.setupProgressTracking(onProgress, duration);

      await this.ffmpeg!.exec([
        "-ss",
        startTime.toString(),
        "-i",
        inputFilename,
        "-t",
        duration.toString(),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputFilename,
      ]);

      const data = await this.ffmpeg!.readFile(outputFilename);
      return new Blob([data.buffer as ArrayBuffer], { type: "video/mp4" });
    } finally {
      this.removeProgressTracking();
      await this.cleanupFiles([inputFilename, outputFilename]);
    }
  }

  async getMetadata(file: File | Blob): Promise<{
    duration: number;
    width: number;
    height: number;
    hasVideo: boolean;
    hasAudio: boolean;
  }> {
    await this.load();
    this.ensureLoaded();

    const inputFilename = "input";

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);

      // FFmpeg.wasm doesn't expose ffprobe, so metadata extraction
      // is limited. Use MediaBunny for comprehensive metadata.
      try {
        await this.ffmpeg!.exec(["-i", inputFilename, "-f", "null", "-"]);
      } catch {
        // FFmpeg outputs info to stderr during probe
      }
      return {
        duration: 0,
        width: 0,
        height: 0,
        hasVideo: true,
        hasAudio: true,
      };
    } finally {
      await this.cleanupFiles([inputFilename]);
    }
  }

  shouldUseProxy(metadata: {
    width: number;
    height: number;
    duration: number;
    fileSize?: number;
  }): boolean {
    const pixelCount = metadata.width * metadata.height;
    if (pixelCount >= PROXY_THRESHOLDS.minPixelCount) {
      return true;
    }
    if (metadata.duration >= PROXY_THRESHOLDS.minDuration) {
      return true;
    }
    if (
      metadata.fileSize !== undefined &&
      metadata.fileSize >= PROXY_THRESHOLDS.minFileSize
    ) {
      return true;
    }

    return false;
  }

  getRecommendedProxyPreset(metadata: {
    width: number;
    height: number;
  }): "low" | "medium" | "high" {
    const pixelCount = metadata.width * metadata.height;

    // 8K or higher -> low quality proxy
    if (pixelCount >= 7680 * 4320) {
      return "low";
    }

    // 4K -> medium quality proxy
    if (pixelCount >= 3840 * 2160) {
      return "medium";
    }

    // Lower resolutions -> high quality proxy
    return "high";
  }

  async convertAudio(
    file: File | Blob,
    format: "mp3" | "wav" | "aac" | "ogg",
    options: {
      bitrate?: string;
      sampleRate?: number;
      channels?: number;
    } = {},
  ): Promise<Blob> {
    await this.load();
    this.ensureLoaded();

    const inputFilename = "input";
    const outputFilename = `output.${format}`;

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);

      const args = ["-i", inputFilename, "-vn"]; // No video
      switch (format) {
        case "mp3":
          args.push("-c:a", "libmp3lame");
          break;
        case "wav":
          args.push("-c:a", "pcm_s16le");
          break;
        case "aac":
          args.push("-c:a", "aac");
          break;
        case "ogg":
          args.push("-c:a", "libvorbis");
          break;
      }
      if (options.bitrate) {
        args.push("-b:a", options.bitrate);
      }
      if (options.sampleRate) {
        args.push("-ar", options.sampleRate.toString());
      }
      if (options.channels) {
        args.push("-ac", options.channels.toString());
      }

      args.push(outputFilename);

      await this.ffmpeg!.exec(args);

      const data = await this.ffmpeg!.readFile(outputFilename);
      const mimeTypes: Record<string, string> = {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        aac: "audio/aac",
        ogg: "audio/ogg",
      };

      return new Blob([data.buffer as ArrayBuffer], {
        type: mimeTypes[format],
      });
    } finally {
      await this.cleanupFiles([inputFilename, outputFilename]);
    }
  }

  async extractFrame(
    file: File | Blob,
    timestamp: number,
    format: "jpg" | "png" = "jpg",
  ): Promise<Blob> {
    await this.load();
    this.ensureLoaded();

    const inputFilename = "input";
    const outputFilename = `frame.${format}`;

    try {
      const inputData = await this.fileToUint8Array(file);
      await this.ffmpeg!.writeFile(inputFilename, inputData);

      await this.ffmpeg!.exec([
        "-ss",
        timestamp.toString(),
        "-i",
        inputFilename,
        "-vframes",
        "1",
        "-q:v",
        "2", // High quality
        outputFilename,
      ]);

      const data = await this.ffmpeg!.readFile(outputFilename);
      const mimeType = format === "png" ? "image/png" : "image/jpeg";

      return new Blob([data.buffer as ArrayBuffer], { type: mimeType });
    } finally {
      await this.cleanupFiles([inputFilename, outputFilename]);
    }
  }

  async encodeFrameSequence(
    frames: AsyncIterable<{ image: ImageBitmap; frameIndex: number }>,
    options: {
      width: number;
      height: number;
      frameRate: number;
      totalFrames: number;
      format?: "mp4" | "webm";
      videoBitrate?: string;
      audioBitrate?: string;
      audioBuffer?: AudioBuffer;
      writableStream?: FileSystemWritableFileStream;
    },
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob | null> {
    await this.load();
    this.ensureLoaded();

    const {
      width,
      height,
      frameRate,
      totalFrames,
      format = "mp4",
      videoBitrate = "10M",
      audioBitrate = "192k",
      audioBuffer,
      writableStream,
    } = options;

    const outputFilename = `output.${format}`;
    let frameCount = 0;

    try {
      const BATCH_SIZE = 10;

      for await (const { image, frameIndex } of frames) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);

        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
        const arrayBuffer = await blob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        const paddedIndex = String(frameIndex).padStart(6, "0");
        const frameFilename = `frame_${paddedIndex}.jpg`;

        await this.ffmpeg!.writeFile(frameFilename, data);
        frameCount++;

        image.close();

        if (onProgress) {
          onProgress({
            phase: "rendering",
            progress: frameCount / totalFrames * 0.7,
            currentFrame: frameCount,
            totalFrames,
            estimatedTimeRemaining: 0,
            bytesWritten: 0,
            currentBitrate: 0,
          });
        }

        if (frameCount % BATCH_SIZE === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      let hasAudio = false;
      if (audioBuffer && audioBuffer.length > 0) {
        const wavBlob = this.encodeAudioBufferToWav(audioBuffer);
        const wavData = new Uint8Array(await wavBlob.arrayBuffer());
        if (wavData.length > 44) {
          await this.ffmpeg!.writeFile("audio.wav", wavData);
          hasAudio = true;
        }
      }

      if (onProgress) {
        onProgress({
          phase: "encoding",
          progress: 0.7,
          currentFrame: totalFrames,
          totalFrames,
          estimatedTimeRemaining: 0,
          bytesWritten: 0,
          currentBitrate: 0,
        });
      }

      const ffmpegArgs = [
        "-framerate", frameRate.toString(),
        "-i", "frame_%06d.jpg",
      ];

      if (hasAudio) {
        ffmpegArgs.push("-i", "audio.wav");
      }

      ffmpegArgs.push("-threads", "4");

      if (format === "mp4") {
        ffmpegArgs.push(
          "-c:v", "libx264",
          "-preset", "fast",
          "-crf", "23",
          "-maxrate", videoBitrate,
          "-bufsize", this.calculateBufsize(videoBitrate),
          "-pix_fmt", "yuv420p",
        );
      } else {
        ffmpegArgs.push(
          "-c:v", "libvpx-vp9",
          "-crf", "31",
          "-b:v", "0",
          "-deadline", "good",
          "-cpu-used", "4",
          "-row-mt", "1",
        );
      }

      if (hasAudio) {
        ffmpegArgs.push(
          "-c:a", format === "mp4" ? "aac" : "libopus",
          "-b:a", audioBitrate,
        );
      }

      ffmpegArgs.push(
        "-movflags", "+faststart",
        "-y",
        outputFilename,
      );

      this.setupProgressTracking((progress) => {
        if (onProgress) {
          onProgress({
            phase: "encoding",
            progress: 0.7 + progress.progress * 0.25,
            currentFrame: totalFrames,
            totalFrames,
            estimatedTimeRemaining: progress.estimatedTimeRemaining,
            bytesWritten: 0,
            currentBitrate: 0,
          });
        }
      });

      await this.ffmpeg!.exec(ffmpegArgs);
      this.removeProgressTracking();

      if (onProgress) {
        onProgress({
          phase: "muxing",
          progress: 0.95,
          currentFrame: totalFrames,
          totalFrames,
          estimatedTimeRemaining: 0,
          bytesWritten: 0,
          currentBitrate: 0,
        });
      }

      const outputData = await this.ffmpeg!.readFile(outputFilename);
      const mimeType = format === "mp4" ? "video/mp4" : "video/webm";

      if (writableStream) {
        const CHUNK_SIZE = 4 * 1024 * 1024;
        const buffer = outputData.buffer as ArrayBuffer;
        for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
          const chunk = new Uint8Array(buffer, offset, Math.min(CHUNK_SIZE, buffer.byteLength - offset));
          await writableStream.write(chunk);
        }
        await writableStream.close();

        if (onProgress) {
          onProgress({
            phase: "complete",
            progress: 1,
            currentFrame: totalFrames,
            totalFrames,
            estimatedTimeRemaining: 0,
            bytesWritten: buffer.byteLength,
            currentBitrate: 0,
          });
        }
        return null;
      }

      if (onProgress) {
        onProgress({
          phase: "complete",
          progress: 1,
          currentFrame: totalFrames,
          totalFrames,
          estimatedTimeRemaining: 0,
          bytesWritten: outputData.buffer.byteLength,
          currentBitrate: 0,
        });
      }

      return new Blob([outputData.buffer as ArrayBuffer], { type: mimeType });
    } finally {
      for (let i = 0; i < frameCount; i++) {
        const paddedIndex = String(i).padStart(6, "0");
        try {
          await this.ffmpeg!.deleteFile(`frame_${paddedIndex}.jpg`);
        } catch {}
      }
      try {
        await this.ffmpeg!.deleteFile("audio.wav");
      } catch {}
      try {
        await this.ffmpeg!.deleteFile(outputFilename);
      } catch {}
    }
  }

  private encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataLength = buffer.length * blockAlign;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = buffer.getChannelData(channel)[i];
        const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
        view.setInt16(offset, intSample, true);
        offset += bytesPerSample;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async exportVideoDirectly(
    inputFile: File | Blob,
    options: {
      startTime?: number;
      endTime?: number;
      width: number;
      height: number;
      frameRate: number;
      format?: "mp4" | "webm";
      videoBitrate?: string;
      audioBitrate?: string;
      speed?: number;
      writableStream?: FileSystemWritableFileStream;
      useStreamCopy?: boolean;
    },
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<Blob | null> {
    await this.load();
    this.ensureLoaded();

    const {
      startTime = 0,
      endTime,
      width,
      height,
      frameRate,
      format = "mp4",
      videoBitrate = "10M",
      audioBitrate = "192k",
      speed = 1,
      writableStream,
      useStreamCopy = false,
    } = options;

    const inputFilename = "input_video";
    const outputFilename = `output.${format}`;

    try {
      if (onProgress) {
        onProgress({
          phase: "preparing",
          progress: 0.05,
          currentFrame: 0,
          totalFrames: 0,
          estimatedTimeRemaining: 0,
          bytesWritten: 0,
          currentBitrate: 0,
        });
      }

      const inputData = await this.fileToUint8Array(inputFile);
      await this.ffmpeg!.writeFile(inputFilename, inputData);

      const ffmpegArgs: string[] = [];

      if (startTime > 0) {
        ffmpegArgs.push("-ss", startTime.toString());
      }

      ffmpegArgs.push("-i", inputFilename);

      if (endTime !== undefined && endTime > startTime) {
        ffmpegArgs.push("-t", (endTime - startTime).toString());
      }

      ffmpegArgs.push("-threads", "4");

      const needsReencode = speed !== 1 || !useStreamCopy;

      if (needsReencode) {
        const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${frameRate}`;

        if (speed !== 1 && speed > 0) {
          const videoSpeed = 1 / speed;
          const audioSpeed = Math.max(0.5, Math.min(2.0, speed));
          ffmpegArgs.push(
            "-filter_complex",
            `[0:v]${scaleFilter},setpts=${videoSpeed}*PTS[v];[0:a]atempo=${audioSpeed}[a]`,
            "-map", "[v]",
            "-map", "[a]"
          );
        } else {
          ffmpegArgs.push("-vf", scaleFilter);
        }

        if (format === "mp4") {
          ffmpegArgs.push(
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-maxrate", videoBitrate,
            "-bufsize", this.calculateBufsize(videoBitrate),
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", audioBitrate,
          );
        } else {
          ffmpegArgs.push(
            "-c:v", "libvpx-vp9",
            "-crf", "31",
            "-b:v", "0",
            "-deadline", "good",
            "-cpu-used", "4",
            "-row-mt", "1",
            "-c:a", "libopus",
            "-b:a", audioBitrate,
          );
        }
      } else {
        ffmpegArgs.push("-c", "copy");
      }

      ffmpegArgs.push(
        "-movflags", "+faststart",
        "-y",
        outputFilename,
      );

      this.setupProgressTracking((progress) => {
        if (onProgress) {
          onProgress({
            phase: "encoding",
            progress: 0.1 + progress.progress * 0.85,
            currentFrame: 0,
            totalFrames: 0,
            estimatedTimeRemaining: progress.estimatedTimeRemaining,
            bytesWritten: 0,
            currentBitrate: 0,
          });
        }
      });

      await this.ffmpeg!.exec(ffmpegArgs);
      this.removeProgressTracking();

      const outputData = await this.ffmpeg!.readFile(outputFilename);
      const mimeType = format === "mp4" ? "video/mp4" : "video/webm";

      if (writableStream) {
        const CHUNK_SIZE = 4 * 1024 * 1024;
        const buffer = outputData.buffer as ArrayBuffer;
        for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
          const chunk = new Uint8Array(buffer, offset, Math.min(CHUNK_SIZE, buffer.byteLength - offset));
          await writableStream.write(chunk);
        }
        await writableStream.close();

        if (onProgress) {
          onProgress({
            phase: "complete",
            progress: 1,
            currentFrame: 0,
            totalFrames: 0,
            estimatedTimeRemaining: 0,
            bytesWritten: buffer.byteLength,
            currentBitrate: 0,
          });
        }
        return null;
      }

      if (onProgress) {
        onProgress({
          phase: "complete",
          progress: 1,
          currentFrame: 0,
          totalFrames: 0,
          estimatedTimeRemaining: 0,
          bytesWritten: outputData.buffer.byteLength,
          currentBitrate: 0,
        });
      }

      return new Blob([outputData.buffer as ArrayBuffer], { type: mimeType });
    } finally {
      try { await this.ffmpeg!.deleteFile(inputFilename); } catch {}
      try { await this.ffmpeg!.deleteFile(outputFilename); } catch {}
    }
  }

  async concatenateSegments(
    segments: Blob[],
    format: string = "mp4",
  ): Promise<Blob> {
    this.ensureLoaded();

    const filenames: string[] = [];
    const ext = format === "webm" ? "webm" : "mp4";

    for (let i = 0; i < segments.length; i++) {
      const name = `seg_${String(i).padStart(4, "0")}.${ext}`;
      const data = new Uint8Array(await segments[i].arrayBuffer());
      await this.ffmpeg!.writeFile(name, data);
      filenames.push(name);
    }

    let concatList = "";
    for (const name of filenames) {
      concatList += `file '${name}'\n`;
    }
    await this.ffmpeg!.writeFile("concat_list.txt", concatList);

    const outputName = `output.${ext}`;
    await this.ffmpeg!.exec([
      "-f", "concat", "-safe", "0",
      "-i", "concat_list.txt",
      "-c", "copy",
      outputName,
    ]);

    const outputData = await this.ffmpeg!.readFile(outputName);
    const mimeType = format === "webm" ? "video/webm" : "video/mp4";
    const blob = new Blob([outputData.buffer as ArrayBuffer], { type: mimeType });

    await this.cleanupFiles([
      ...filenames,
      "concat_list.txt",
      outputName,
    ]);

    return blob;
  }

  terminate(): void {
    if (this.ffmpeg) {
      this.removeProgressTracking();
      this.ffmpeg.terminate();
      this.ffmpeg = null;
      this.loaded = false;
      this.loading = null;
    }
  }
}
let ffmpegInstance: FFmpegFallback | null = null;

export function getFFmpegFallback(): FFmpegFallback {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpegFallback();
  }
  return ffmpegInstance;
}

export function shouldUseProxy(metadata: {
  width: number;
  height: number;
  duration: number;
  fileSize?: number;
}): boolean {
  return getFFmpegFallback().shouldUseProxy(metadata);
}

export function getRecommendedProxyPreset(metadata: {
  width: number;
  height: number;
}): "low" | "medium" | "high" {
  return getFFmpegFallback().getRecommendedProxyPreset(metadata);
}
