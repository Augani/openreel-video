import { guessVrFromAspect, type VrProperties } from "../vr/vr-properties";
import { parseSourceColor, type SourceColorSpace } from "../color/source-color";
import type {
  MediaTrackInfo,
  ThumbnailResult,
  WaveformData,
  ExportSettings,
  ExportProgress,
  VideoFrameResult,
  FrameCacheEntry,
} from "./types";
import { extractAudioWav } from "./extract-audio";
import {
  claimNativeSource,
  isNativeContainerFile,
  NativeCanvasSink,
  NativeExportFrameDecoder,
  type ExportFrameDecoderLike,
  type NativeSourceInfo,
} from "./native-frame-source";

import type {
  InputVideoTrack,
  InputAudioTrack,
  ConversionOptions,
  WrappedCanvas,
} from "mediabunny";

/**
 * Spherical Video V1 / V2 metadata only exists in MP4 / MOV (ISO BMFF) files, so the parser (which also holds the
 * export-side box writers) is a lazy chunk that loads only when one is probed: a file whose bytes 4-8 read "ftyp".
 */
async function detectSphericalMetadataIfMp4(file: Blob): Promise<VrProperties | null> {
  try {
    if (typeof file.slice !== "function") return null;
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head.length < 8 || String.fromCharCode(head[4], head[5], head[6], head[7]) !== "ftyp") return null;
    const { detectSphericalMetadata } = await import("../export/spherical-metadata");
    return await detectSphericalMetadata(file);
  } catch {
    return null;
  }
}

const SUPPORTED_VIDEO_FORMATS = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
];

const SUPPORTED_AUDIO_FORMATS = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/webm",
];

const SUPPORTED_IMAGE_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export function isSupportedFormat(mimeType: string): boolean {
  const baseMimeType = mimeType.split(";")[0].trim();
  return (
    SUPPORTED_VIDEO_FORMATS.includes(baseMimeType) ||
    SUPPORTED_AUDIO_FORMATS.includes(baseMimeType) ||
    SUPPORTED_IMAGE_FORMATS.includes(baseMimeType)
  );
}

export function inferMediaType(
  mimeType: string,
): "video" | "audio" | "image" | null {
  const baseMimeType = mimeType.split(";")[0].trim();
  if (SUPPORTED_VIDEO_FORMATS.includes(baseMimeType)) return "video";
  if (SUPPORTED_AUDIO_FORMATS.includes(baseMimeType)) return "audio";
  if (SUPPORTED_IMAGE_FORMATS.includes(baseMimeType)) return "image";
  return null;
}
type MediaBunnyInput = {
  computeDuration(): Promise<number>;
  getMimeType(): Promise<string>;
  getPrimaryVideoTrack(): Promise<InputVideoTrack | null>;
  getPrimaryAudioTrack(): Promise<InputAudioTrack | null>;
  getAudioTracks(): Promise<InputAudioTrack[]>;
  getFormat(): Promise<unknown>;
  [Symbol.dispose]?: () => void;
};

/** One forward-only decode position inside a source (its own sink, so canvas pools never collide). */
interface ExportCursor {
  sink: InstanceType<typeof import("mediabunny").CanvasSink>;
  iterator: AsyncIterator<WrappedCanvas> | null;
  currentFrame: WrappedCanvas | null;
  nextFrame: WrappedCanvas | null;
  done: boolean;
  lastUsed: number;
}

/**
 * Sequential frame source for export. Export asks for ever-increasing timestamps, so decoding is one
 * forward iterator. A feature timeline routinely shows the SAME source at two or more places at once
 * (stacked B-roll, split screens, a nest re-using a clip, multicam angles cut from one file); with a
 * single iterator every layer's request looked like "time moved backwards" and restarted decoding at
 * the previous keyframe, which on 4K long-GOP media is hundreds of frames per layer per output frame
 * (measured 8 s/frame on the 110-minute soak timeline). Each distinct playhead gets its own cursor,
 * up to MAX_CURSORS; a request continues the nearest cursor that is behind it.
 */
export class ExportFrameDecoder {
  /** Decode positions kept per source. Each one is a hardware decoder, so keep it small. */
  static readonly MAX_CURSORS = 4;
  /** Decoding forward this far is cheaper than a keyframe seek elsewhere (seconds of source). */
  static readonly FORWARD_WINDOW_S = 4;

  private input: MediaBunnyInput | null = null;
  private videoTrack: unknown = null;
  private sinkOptions: Record<string, unknown> = {};
  private cursors: ExportCursor[] = [];
  private mediabunny: typeof import("mediabunny");
  private file: File | Blob;
  private width?: number;
  private initialized = false;
  private reusableCanvas: OffscreenCanvas | null = null;
  private reusableCtx: OffscreenCanvasRenderingContext2D | null = null;
  private decodeTail: Promise<void> = Promise.resolve();
  private tick = 0;

  constructor(mediabunny: typeof import("mediabunny"), file: File | Blob, width?: number) {
    this.mediabunny = mediabunny;
    this.file = file;
    this.width = width;
  }

  /** Number of live decode positions (diagnostics and tests). */
  get cursorCount(): number {
    return this.cursors.length;
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    const { Input, ALL_FORMATS, BlobSource } = this.mediabunny;

    this.input = new Input({
      source: new BlobSource(this.file),
      formats: ALL_FORMATS,
    }) as unknown as MediaBunnyInput;

    const videoTrack = await this.input.getPrimaryVideoTrack();
    if (!videoTrack) {
      this.dispose();
      return false;
    }

    const canDecode = await videoTrack.canDecode();
    if (!canDecode) {
      this.dispose();
      return false;
    }

    const sinkOptions: Record<string, unknown> = { poolSize: 2 };
    if (this.width) {
      const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
      sinkOptions.width = this.width;
      sinkOptions.height = Math.round(this.width * aspectRatio);
      sinkOptions.fit = "contain";
    }
    this.videoTrack = videoTrack;
    this.sinkOptions = sinkOptions;
    this.initialized = true;
    return true;
  }

  async getFrame(timestamp: number): Promise<OffscreenCanvas | null> {
    const framePromise = this.decodeTail.then(() => this.getSequentialFrame(timestamp));
    this.decodeTail = framePromise.then(
      () => undefined,
      () => undefined,
    );
    return framePromise;
  }

  private createCursor(): ExportCursor {
    const { CanvasSink } = this.mediabunny;
    const sink = new CanvasSink(this.videoTrack as never, this.sinkOptions) as ExportCursor["sink"];
    const cursor: ExportCursor = { sink, iterator: null, currentFrame: null, nextFrame: null, done: false, lastUsed: 0 };
    this.cursors.push(cursor);
    return cursor;
  }

  /** The cursor is at or behind `timestamp` and close enough that decoding forward beats a new seek. */
  private serves(c: ExportCursor, timestamp: number): boolean {
    if (!c.iterator || !c.currentFrame) return false;
    const gap = timestamp - c.currentFrame.timestamp;
    if (gap < -1e-8) return false;
    // A sparse stream (screen recording, freeze): the next frame is already past `timestamp`, so the
    // current one is the answer however old it is.
    return gap <= ExportFrameDecoder.FORWARD_WINDOW_S || (c.nextFrame !== null && c.nextFrame.timestamp > timestamp);
  }

  /** The cursor to continue for `timestamp`, or a fresh/recycled one when none is close behind it. */
  private pickCursor(timestamp: number): ExportCursor {
    let best: ExportCursor | null = null;
    for (const c of this.cursors) {
      if (!this.serves(c, timestamp)) continue;
      if (!best || c.currentFrame!.timestamp > best.currentFrame!.timestamp) best = c;
    }
    if (best) return best;
    if (this.cursors.length < ExportFrameDecoder.MAX_CURSORS) return this.createCursor();
    return this.cursors.reduce((oldest, c) => (c.lastUsed < oldest.lastUsed ? c : oldest));
  }

  private async getSequentialFrame(timestamp: number): Promise<OffscreenCanvas | null> {
    if (!this.initialized) return null;

    const cursor = this.pickCursor(timestamp);
    cursor.lastUsed = ++this.tick;
    // A new sequential decode for the first request, or when no live cursor is close behind this time
    // (a later clip reusing the media from an earlier in-point, reverse playback, a loop).
    if (!this.serves(cursor, timestamp)) {
      await this.resetCursor(cursor, timestamp);
    }

    if (!cursor.currentFrame) return null;

    // Keep one decoded frame of lookahead so selection exactly matches
    // CanvasSink.getCanvas(): the last source frame starting at or before the
    // requested timestamp. CanvasSink's two-canvas pool keeps both frames
    // stable while we copy the selected one below.
    while (true) {
      if (!cursor.nextFrame && !cursor.done) {
        const next = await cursor.iterator!.next();
        if (next.done) {
          cursor.done = true;
        } else {
          cursor.nextFrame = next.value;
        }
      }

      if (cursor.nextFrame && cursor.nextFrame.timestamp <= timestamp + 1e-8) {
        cursor.currentFrame = cursor.nextFrame;
        cursor.nextFrame = null;
        continue;
      }
      break;
    }

    if (cursor.currentFrame.timestamp > timestamp + 1e-8) return null;

    const w = cursor.currentFrame.canvas.width;
    const h = cursor.currentFrame.canvas.height;

    if (!this.reusableCanvas || this.reusableCanvas.width !== w || this.reusableCanvas.height !== h) {
      this.reusableCanvas = new OffscreenCanvas(w, h);
      this.reusableCtx = this.reusableCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    }

    this.reusableCtx!.clearRect(0, 0, w, h);
    this.reusableCtx!.drawImage(cursor.currentFrame.canvas, 0, 0);
    return this.reusableCanvas;
  }

  private async resetCursor(cursor: ExportCursor, timestamp: number): Promise<void> {
    await cursor.iterator?.return?.();
    cursor.currentFrame = null;
    cursor.nextFrame = null;
    cursor.done = false;
    cursor.iterator = cursor.sink.canvases(timestamp)[Symbol.asyncIterator]();

    const first = await cursor.iterator.next();
    if (first.done) {
      cursor.done = true;
      return;
    }
    cursor.currentFrame = first.value;
  }

  dispose(): void {
    for (const c of this.cursors) void c.iterator?.return?.();
    this.cursors = [];
    if (this.input) {
      this.input[Symbol.dispose]?.();
      this.input = null;
    }
    this.videoTrack = null;
    this.decodeTail = Promise.resolve();
    this.reusableCanvas = null;
    this.reusableCtx = null;
    this.initialized = false;
  }
}

export class MediaBunnyEngine {
  private initialized = false;
  private mediabunny: typeof import("mediabunny") | null = null;
  private frameCache: Map<string, FrameCacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 5;
  private exportDecoders: Map<string, ExportFrameDecoderLike> = new Map();

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to support lazy loading
      this.mediabunny = await import("mediabunny");
      this.initialized = true;
    } catch (error) {
      console.warn("MediaBunny not available, will use fallback");
      throw new Error("MediaBunny initialization failed");
    }
  }

  isAvailable(): boolean {
    return this.initialized && this.mediabunny !== null;
  }

  clearFrameCache(): void {
    for (const entry of this.frameCache.values()) {
      if (entry.image instanceof OffscreenCanvas) {
        entry.image.width = 0;
        entry.image.height = 0;
      }
    }
    this.frameCache.clear();
  }

  getFrameCacheSize(): number {
    return this.frameCache.size;
  }

  async createExportDecoder(mediaId: string, file: File | Blob, width?: number): Promise<ExportFrameDecoderLike | null> {
    // Callers that never imported media in this page (a queued export retried from its snapshot on a
    // fresh page) reach here with an engine nobody initialized. Throwing sent every frame down the
    // per-frame getFrameAtTime path, which restarts a decoder at the previous keyframe each time.
    await this.initialize();

    const existing = this.exportDecoders.get(mediaId);
    if (existing) {
      return existing;
    }

    // Codecs WebCodecs cannot decode (ProRes...) go to the desktop's native decoder, at full quality.
    const native = await claimNativeSource(file);
    if (native) {
      const nativeDecoder = new NativeExportFrameDecoder(native, width);
      this.exportDecoders.set(mediaId, nativeDecoder);
      return nativeDecoder;
    }

    const decoder = new ExportFrameDecoder(this.mediabunny!, file, width);
    const success = await decoder.initialize();
    if (!success) {
      return null;
    }

    this.exportDecoders.set(mediaId, decoder);
    return decoder;
  }

  getExportDecoder(mediaId: string): ExportFrameDecoderLike | null {
    return this.exportDecoders.get(mediaId) || null;
  }

  disposeExportDecoder(mediaId: string): void {
    const decoder = this.exportDecoders.get(mediaId);
    if (decoder) {
      decoder.dispose();
      this.exportDecoders.delete(mediaId);
    }
  }

  disposeAllExportDecoders(): void {
    for (const decoder of this.exportDecoders.values()) {
      decoder.dispose();
    }
    this.exportDecoders.clear();
  }

  private ensureInitialized(): void {
    if (!this.mediabunny) {
      throw new Error("MediaBunny not initialized. Call initialize() first.");
    }
  }

  /** Peaks of an MXF's first audio track, read through the sidecar (mediabunny cannot open the wrapper). */
  private async nativeContainerWaveform(file: File | Blob, samplesPerSecond: number, signal?: AbortSignal): Promise<WaveformData> {
    const wav = await (await extractAudioWav(file, 0, { channels: 1 })).arrayBuffer();
    signal?.throwIfAborted();
    const view = new DataView(wav);
    let offset = 12;
    let dataStart = -1;
    let dataLength = 0;
    let sampleRate = 48000;
    while (offset + 8 <= view.byteLength) {
      const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
      const size = view.getUint32(offset + 4, true);
      if (id === "fmt ") sampleRate = view.getUint32(offset + 12, true);
      if (id === "data") {
        dataStart = offset + 8;
        dataLength = Math.min(size, view.byteLength - dataStart);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (dataStart < 0) throw new Error("No audio data in the extracted track");
    // The sidecar writes mono 32-bit float PCM.
    const samples = new Float32Array(wav.slice(dataStart, dataStart + Math.floor(dataLength / 4) * 4));
    const perBucket = Math.max(1, Math.floor(sampleRate / samplesPerSecond));
    const buckets = Math.ceil(samples.length / perBucket);
    const peaks = new Float32Array(buckets);
    const rms = new Float32Array(buckets);
    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      let sum = 0;
      const from = b * perBucket;
      const to = Math.min(samples.length, from + perBucket);
      for (let i = from; i < to; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
        sum += samples[i] * samples[i];
      }
      peaks[b] = peak;
      rms[b] = Math.sqrt(sum / Math.max(1, to - from));
    }
    return { peaks, rms, sampleRate: samplesPerSecond, duration: samples.length / sampleRate, samplesPerSecond };
  }

  async createInput(file: File | Blob): Promise<MediaBunnyInput> {
    this.ensureInitialized();
    const { Input, ALL_FORMATS, BlobSource } = this.mediabunny!;

    return new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
  }

  async validateFormat(file: File | Blob): Promise<{
    supported: boolean;
    format: string | null;
    error?: string;
  }> {
    const mimeType = file.type;
    if (!isSupportedFormat(mimeType)) {
      return {
        supported: false,
        format: null,
        error: `Unsupported format: ${
          mimeType || "unknown"
        }. Supported formats: MP4, WebM, MOV, MP3, WAV, AAC, JPG, PNG, WebP`,
      };
    }

    // Images don't need MediaBunny validation - they're already supported
    if (mimeType.startsWith("image/")) {
      return {
        supported: true,
        format: mimeType,
      };
    }

    try {
      const input = await this.createInput(file);
      const format = await input.getFormat();

      input[Symbol.dispose]?.();

      if (!format) {
        return {
          supported: false,
          format: null,
          error: "Could not determine file format. The file may be corrupted.",
        };
      }

      return {
        supported: true,
        format: mimeType,
      };
    } catch (error) {
      return {
        supported: false,
        format: null,
        error: `Failed to parse file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private async extractImageMetadata(
    file: File | Blob,
    mimeType: string,
  ): Promise<MediaTrackInfo> {
    // Load image to get dimensions
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = objectUrl;
      });

      return {
        duration: 0, // Images have no duration
        width: img.naturalWidth,
        height: img.naturalHeight,
        frameRate: 0,
        codec: "",
        sampleRate: 0,
        channels: 0,
        fileSize: file.size,
        mimeType,
        hasVideo: false,
        hasAudio: false,
        rotation: 0,
        canDecode: true,
        videoBitrate: 0,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /** What the desktop probe says about a pro wrapper (MXF) mediabunny has no demuxer for, or null off the desktop. */
  private async nativeContainerMetadata(file: File | Blob): Promise<MediaTrackInfo | null> {
    if (!isNativeContainerFile(file)) return null;
    const native = await claimNativeSource(file);
    if (!native) return null;
    const audio = native.audio;
    return {
      duration: native.duration,
      width: native.width,
      height: native.height,
      frameRate: native.frameRate,
      codec: native.codec,
      sampleRate: audio?.sampleRate ?? 0,
      channels: audio?.channels ?? 0,
      fileSize: file.size,
      mimeType: file.type || "video/mxf",
      hasVideo: true,
      hasAudio: Boolean(audio && audio.trackCount > 0),
      rotation: native.rotation ?? 0,
      // Decoded by the sidecar on demand, exactly like ProRes.
      canDecode: true,
      canDecodeVideo: true,
      audioTrackCount: audio?.trackCount ?? 0,
      ...(audio?.streamChannels && audio.streamChannels.length > 1 ? { audioStreamChannels: [...audio.streamChannels] } : {}),
    };
  }

  async extractMetadata(file: File | Blob): Promise<MediaTrackInfo> {
    const nativeContainer = await this.nativeContainerMetadata(file);
    if (nativeContainer) return nativeContainer;
    // Special handling for images - MediaBunny doesn't process static images well
    const fileType = file instanceof File ? file.type : "";
    if (fileType.startsWith("image/")) {
      return await this.extractImageMetadata(file, fileType);
    }

    const input = await this.createInput(file);

    try {
      const duration = await input.computeDuration();
      const mimeType = await input.getMimeType();

      const videoTrack = await input.getPrimaryVideoTrack();
      const audioTrack = await input.getPrimaryAudioTrack();

      let width = 0;
      let height = 0;
      let frameRate = 0;
      let videoCodec = "";
      let rotation = 0;
      let canDecodeVideo = false;
      let videoBitrate = 0;
      let sourceColor: SourceColorSpace | undefined;

      if (videoTrack) {
        try {
          sourceColor = parseSourceColor(await videoTrack.getColorSpace()) ?? undefined;
        } catch {
          sourceColor = undefined;
        }
        width = videoTrack.displayWidth;
        height = videoTrack.displayHeight;
        rotation = videoTrack.rotation || 0;
        videoCodec = videoTrack.codec || "";
        canDecodeVideo = await videoTrack.canDecode();

        // Compute frame rate and bitrate from packet stats
        try {
          const stats = await videoTrack.computePacketStats(100);
          frameRate = stats.averagePacketRate || 30;
          videoBitrate = stats.averageBitrate || 0;
        } catch {
          frameRate = 30; // Default
        }
      }

      // Immersive video: spherical metadata in the file, else a 2:1 picture is only a hint.
      let vr: VrProperties | undefined;
      if (videoTrack && width > 0) {
        vr = ((await detectSphericalMetadataIfMp4(file)) ?? guessVrFromAspect(width, height)) ?? undefined;
      }

      let sampleRate = 0;
      let channels = 0;
      let audioCodec = "";
      let canDecodeAudio = false;
      let audioTrackCount = 0;
      let audioStreamChannels: number[] | undefined;

      if (audioTrack) {
        sampleRate = audioTrack.sampleRate;
        channels = audioTrack.numberOfChannels;
        audioCodec = audioTrack.codec || "";
        canDecodeAudio = await audioTrack.canDecode();
      }

      try {
        const allAudioTracks = await input.getAudioTracks();
        audioTrackCount = allAudioTracks.length;
        if (allAudioTracks.length > 1) audioStreamChannels = allAudioTracks.map((track) => track.numberOfChannels);
      } catch {
        audioTrackCount = audioTrack ? 1 : 0;
      }

      return {
        duration,
        width,
        height,
        frameRate,
        codec: videoCodec || audioCodec,
        sampleRate,
        channels,
        fileSize: file.size,
        mimeType,
        hasVideo: !!videoTrack,
        hasAudio: !!audioTrack,
        rotation,
        canDecode: canDecodeVideo || canDecodeAudio,
        canDecodeVideo,
        videoBitrate,
        audioTrackCount,
        ...(audioStreamChannels ? { audioStreamChannels } : {}),
        ...(sourceColor ? { sourceColor } : {}),
        ...(vr ? { vr } : {}),
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async generateThumbnails(
    file: File | Blob,
    count: number = 5,
    width: number = 320,
  ): Promise<ThumbnailResult[]> {
    this.ensureInitialized();
    const native = await claimNativeSource(file);
    if (native) {
      return this.nativeThumbnails(native, count, width);
    }
    const { CanvasSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return [];
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }
      const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
      const height = Math.round(width * aspectRatio);

      const sink = new CanvasSink(videoTrack, {
        width,
        height,
        fit: "contain" as const,
        poolSize: Math.min(count, 10), // Limit pool size for memory efficiency
      });

      const startTimestamp = await videoTrack.getFirstTimestamp();
      const endTimestamp = await videoTrack.computeDuration();
      const duration = endTimestamp - startTimestamp;
      const timestamps =
        count === 1
          ? [startTimestamp]
          : Array.from(
              { length: count },
              (_, i) => startTimestamp + (i / (count - 1)) * duration,
            );

      const thumbnails: ThumbnailResult[] = [];

      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (result) {
          // Clone the canvas since the pool reuses them
          const clone = new OffscreenCanvas(
            result.canvas.width,
            result.canvas.height,
          );
          const ctx = clone.getContext("2d");
          if (ctx) {
            ctx.drawImage(result.canvas, 0, 0);
          }
          let dataUrl: string | undefined;
          try {
            const blob = await clone.convertToBlob({
              type: "image/jpeg",
              quality: 0.7,
            });
            dataUrl = URL.createObjectURL(blob);
          } catch {}

          thumbnails.push({
            timestamp: result.timestamp,
            canvas: clone,
            dataUrl,
          });
        }
      }

      return thumbnails;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  private async nativeThumbnails(
    native: NativeSourceInfo,
    count: number,
    width: number,
    span: number = native.duration,
  ): Promise<ThumbnailResult[]> {
    const sink = new NativeCanvasSink(native, { width, quality: "preview" });
    const last = Math.max(0, span - 1 / Math.max(1, native.frameRate));
    const thumbnails: ThumbnailResult[] = [];
    for (let i = 0; i < count; i++) {
      const time = count === 1 ? 0 : (i / (count - 1)) * last;
      const frame = await sink.getCanvas(time);
      if (!frame) continue;
      let dataUrl: string | undefined;
      try {
        dataUrl = URL.createObjectURL(await frame.canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 }));
      } catch {}
      thumbnails.push({ timestamp: frame.timestamp, canvas: frame.canvas, dataUrl });
    }
    return thumbnails;
  }

  async generateFilmstripThumbnails(
    file: File | Blob,
    duration: number,
    thumbnailWidth: number = 80,
    interval: number = 1,
  ): Promise<ThumbnailResult[]> {
    this.ensureInitialized();
    const nativeSource = await claimNativeSource(file);
    if (nativeSource) {
      return this.nativeThumbnails(nativeSource, Math.max(1, Math.ceil(duration / interval)), thumbnailWidth, duration);
    }
    const { CanvasSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return [];
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }
      const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
      const height = Math.round(thumbnailWidth * aspectRatio);
      const count = Math.max(1, Math.ceil(duration / interval));

      const sink = new CanvasSink(videoTrack, {
        width: thumbnailWidth,
        height,
        fit: "cover" as const,
        poolSize: Math.min(count, 20),
      });

      const startTimestamp = await videoTrack.getFirstTimestamp();
      const timestamps = Array.from(
        { length: count },
        (_, i) => startTimestamp + i * interval,
      );

      const thumbnails: ThumbnailResult[] = [];

      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (result) {
          // Clone the canvas
          const clone = new OffscreenCanvas(
            result.canvas.width,
            result.canvas.height,
          );
          const ctx = clone.getContext("2d");
          if (ctx) {
            ctx.drawImage(result.canvas, 0, 0);
          }
          let dataUrl: string | undefined;
          try {
            const blob = await clone.convertToBlob({
              type: "image/jpeg",
              quality: 0.6,
            });
            dataUrl = URL.createObjectURL(blob);
          } catch {}

          thumbnails.push({
            timestamp: result.timestamp,
            canvas: clone,
            dataUrl,
          });
        }
      }

      return thumbnails;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async getFrameAtTime(
    file: File | Blob,
    timestamp: number,
    width?: number,
  ): Promise<VideoFrameResult | null> {
    this.ensureInitialized();
    const native = await claimNativeSource(file);
    if (native) {
      const nativeFrame = await new NativeCanvasSink(native, { width, quality: "full" }).getCanvas(timestamp);
      return nativeFrame
        ? {
            timestamp: nativeFrame.timestamp,
            duration: nativeFrame.duration,
            canvas: nativeFrame.canvas,
            width: nativeFrame.canvas.width,
            height: nativeFrame.canvas.height,
          }
        : null;
    }
    const { CanvasSink } = this.mediabunny!;
    const fileName = "name" in file ? file.name : "blob";
    const cacheKey = `${fileName}-${file.size}-${timestamp}-${width || "auto"}`;
    const cached = this.frameCache.get(cacheKey);
    if (cached) {
      cached.lastAccessed = Date.now();
      return {
        timestamp: cached.timestamp,
        duration: 0, // Cached frames might not have duration stored, or we can add it to cache
        canvas: cached.image,
        width: cached.width,
        height: cached.height,
      };
    }

    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return null;
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }

      const sinkOptions: Record<string, unknown> = { poolSize: 1 };
      if (width) {
        const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
        sinkOptions.width = width;
        sinkOptions.height = Math.round(width * aspectRatio);
        sinkOptions.fit = "contain";
      }

      const sink = new CanvasSink(videoTrack, sinkOptions);
      const result = await sink.getCanvas(timestamp);

      if (!result) {
        return null;
      }

      // Clone the canvas
      const clone = new OffscreenCanvas(
        result.canvas.width,
        result.canvas.height,
      );
      const ctx = clone.getContext("2d");
      if (ctx) {
        ctx.drawImage(result.canvas, 0, 0);
      }

      // Cache the result
      if (this.frameCache.size >= this.MAX_CACHE_SIZE) {
        let oldestKey = "";
        let oldestTime = Infinity;
        for (const [key, entry] of this.frameCache.entries()) {
          if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed;
            oldestKey = key;
          }
        }
        if (oldestKey) {
          this.frameCache.delete(oldestKey);
        }
      }

      this.frameCache.set(cacheKey, {
        timestamp: result.timestamp,
        image: clone,
        width: clone.width,
        height: clone.height,
        lastAccessed: Date.now(),
      });

      return {
        timestamp: result.timestamp,
        duration: result.duration,
        canvas: clone,
        width: clone.width,
        height: clone.height,
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async generateWaveform(
    file: File | Blob,
    samplesPerSecond: number = 100,
    signal?: AbortSignal,
  ): Promise<WaveformData> {
    signal?.throwIfAborted();
    this.ensureInitialized();
    if (isNativeContainerFile(file) && (await claimNativeSource(file))) {
      return this.nativeContainerWaveform(file, samplesPerSecond, signal);
    }
    const { AudioSampleSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      signal?.throwIfAborted();
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        throw new Error("No audio track found");
      }

      const canDecode = await audioTrack.canDecode();
      signal?.throwIfAborted();
      if (!canDecode) {
        throw new Error("Cannot decode audio track");
      }

      const sink = new AudioSampleSink(audioTrack);
      const duration = await audioTrack.computeDuration();
      const totalSamples = Math.ceil(duration * samplesPerSecond);

      const peaks: number[] = [];
      const rms: number[] = [];
      const timestamps = Array.from(
        { length: totalSamples },
        (_, i) => i / samplesPerSecond,
      );

      for await (const sample of sink.samplesAtTimestamps(timestamps)) {
        if (signal?.aborted) {
          sample?.close();
          signal.throwIfAborted();
        }
        if (!sample) {
          peaks.push(0);
          rms.push(0);
          continue;
        }
        const bytesNeeded = sample.allocationSize({
          format: "f32",
          planeIndex: 0,
        });
        const floats = new Float32Array(bytesNeeded / 4);
        sample.copyTo(floats, { format: "f32", planeIndex: 0 });
        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < floats.length; i++) {
          const abs = Math.abs(floats[i]);
          peak = Math.max(peak, abs);
          sumSquares += floats[i] * floats[i];
        }

        peaks.push(peak);
        rms.push(Math.sqrt(sumSquares / floats.length));

        sample.close();
      }

      return {
        peaks: new Float32Array(peaks),
        rms: new Float32Array(rms),
        sampleRate: samplesPerSecond,
        duration,
        samplesPerSecond,
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async convertMedia(
    file: File | Blob,
    settings: ExportSettings,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    this.ensureInitialized();
    const {
      Input,
      Output,
      Conversion,
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      MovOutputFormat,
      Mp3OutputFormat,
      QUALITY_HIGH,
      QUALITY_MEDIUM,
    } = this.mediabunny!;

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
    let cancelConversion: (() => void) | undefined;
    let cancellation: Promise<void> | undefined;
    try {
      let outputFormat;
      switch (settings.format) {
        case "webm":
          outputFormat = new WebMOutputFormat();
          break;
        case "mov":
          outputFormat = new MovOutputFormat();
          break;
        case "mp3":
          outputFormat = new Mp3OutputFormat();
          break;
        case "mp4":
        default:
          outputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
          break;
      }

      const output = new Output({
        format: outputFormat,
        target: new BufferTarget(),
      });
      const conversionOptions: Record<string, unknown> = {
        input,
        output,
      };

      // Video options
      if (settings.width || settings.height || settings.videoBitrate) {
        conversionOptions.video = {
          ...(settings.width && { width: settings.width }),
          ...(settings.height && { height: settings.height }),
          ...(settings.width && settings.height && { fit: "contain" }),
          ...(settings.frameRate && { frameRate: settings.frameRate }),
          ...(settings.videoCodec && { codec: settings.videoCodec }),
          ...(settings.keyFrameInterval && { keyFrameInterval: settings.keyFrameInterval }),
          bitrate: settings.videoBitrate || QUALITY_HIGH,
        };
      }

      // Audio options
      if (settings.audioBitrate || settings.sampleRate || settings.channels) {
        conversionOptions.audio = {
          ...(settings.audioBitrate && { bitrate: settings.audioBitrate }),
          ...(settings.sampleRate && { sampleRate: settings.sampleRate }),
          ...(settings.channels && { numberOfChannels: settings.channels }),
          ...(settings.audioCodec && { codec: settings.audioCodec }),
        };
      }

      // Discard audio for video-only export
      if (
        settings.format === "mp4" ||
        settings.format === "webm" ||
        settings.format === "mov"
      ) {
        if (!conversionOptions.audio) {
          conversionOptions.audio = { bitrate: QUALITY_MEDIUM };
        }
      }

      const conversion = await Conversion.init(
        conversionOptions as ConversionOptions,
      );

      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks
          .map((t: { reason: string }) => t.reason)
          .join(", ");
        throw new Error(`Conversion invalid: ${reasons}`);
      }

      // Warn about discarded tracks that were not explicitly discarded
      if (conversion.discardedTracks.length > 0) {
        console.warn(
          "Some tracks were discarded during conversion:",
          conversion.discardedTracks,
        );
      }
      if (onProgress) {
        let lastProgress = 0;
        conversion.onProgress = (progress: number) => {
          if (progress > lastProgress) {
            lastProgress = progress;
            onProgress({
              phase: progress < 1 ? "encoding" : "complete",
              progress,
              currentFrame: 0,
              totalFrames: 0,
              estimatedTimeRemaining: 0,
            });
          }
        };
      }
      if (signal) {
        cancelConversion = () => { cancellation = conversion.cancel().catch(() => undefined); };
        signal.addEventListener("abort", cancelConversion, { once: true });
        if (signal.aborted) {
          cancelConversion();
          throw new DOMException("Aborted", "AbortError");
        }
      }

      try {
        await conversion.execute();
      } catch (error) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw error;
      }
      const buffer = output.target.buffer;
      if (!buffer) {
        throw new Error("Output buffer is empty");
      }
      const mimeType = this.getMimeTypeForFormat(settings.format);

      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return new Blob([buffer], { type: mimeType });
    } finally {
      if (cancelConversion) signal?.removeEventListener("abort", cancelConversion);
      await cancellation;
      input[Symbol.dispose]?.();
    }
  }

  async extractAudio(
    file: File | Blob,
    format: "mp3" | "wav" | "aac" = "mp3",
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    return this.convertMedia(
      file,
      {
        format: format as ExportSettings["format"],
        audioBitrate: 128000,
        sampleRate: 48000,
        channels: 2,
      },
      onProgress,
      signal,
    );
  }

  async trimMedia(
    file: File | Blob,
    startTime: number,
    endTime: number,
    settings?: Partial<ExportSettings>,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    this.ensureInitialized();
    const {
      Input,
      Output,
      Conversion,
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
    } = this.mediabunny!;

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      trim: {
        start: startTime,
        end: endTime,
      },
      ...(settings?.videoBitrate && {
        video: { bitrate: settings.videoBitrate },
      }),
      ...(settings?.audioBitrate && {
        audio: { bitrate: settings.audioBitrate },
      }),
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((t: { reason: string }) => t.reason)
        .join(", ");
      throw new Error(`Trim conversion invalid: ${reasons}`);
    }

    if (onProgress) {
      conversion.onProgress = (progress: number) => {
        onProgress({
          phase: progress < 1 ? "encoding" : "complete",
          progress,
          currentFrame: 0,
          totalFrames: 0,
          estimatedTimeRemaining: 0,
        });
      };
    }
    if (signal) {
      signal.addEventListener("abort", () => {
        conversion.cancel();
      });
    }

    try {
      await conversion.execute();
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      throw error;
    }

    if (!output.target.buffer) {
      throw new Error("Output buffer is empty");
    }
    return new Blob([output.target.buffer], { type: "video/mp4" });
  }

  private getMimeTypeForFormat(format: ExportSettings["format"]): string {
    switch (format) {
      case "mp4":
        return "video/mp4";
      case "webm":
        return "video/webm";
      case "mov":
        return "video/quicktime";
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "aac":
        return "audio/aac";
      default:
        return "video/mp4";
    }
  }

  async checkCodecSupport(): Promise<{
    video: string[];
    audio: string[];
  }> {
    this.ensureInitialized();
    const { getEncodableVideoCodecs, getEncodableAudioCodecs } =
      this.mediabunny!;

    const [videoCodecs, audioCodecs] = await Promise.all([
      getEncodableVideoCodecs(),
      getEncodableAudioCodecs(),
    ]);

    return {
      video: videoCodecs,
      audio: audioCodecs,
    };
  }

  async getBestVideoCodec(
    width: number,
    height: number,
  ): Promise<string | null> {
    this.ensureInitialized();
    const { getFirstEncodableVideoCodec, Mp4OutputFormat } = this.mediabunny!;

    const format = new Mp4OutputFormat();
    const supportedCodecs = format.getSupportedVideoCodecs();

    try {
      const codec = await getFirstEncodableVideoCodec(supportedCodecs, {
        width,
        height,
      });
      return codec || null;
    } catch {
      return null;
    }
  }

  async exportFrame(
    file: File | Blob,
    timestamp: number,
    format: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
    quality: number = 0.8,
  ): Promise<Blob> {
    const frame = await this.getFrameAtTime(file, timestamp);
    if (!frame) {
      throw new Error("Could not extract frame");
    }

    const { canvas } = frame;
    let blob: Blob | null = null;

    if (canvas instanceof OffscreenCanvas) {
      blob = await canvas.convertToBlob({ type: format, quality });
    } else if (canvas instanceof HTMLCanvasElement) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, format, quality),
      );
    } else if (canvas instanceof ImageBitmap) {
      const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = offscreen.getContext("2d");
      if (ctx) {
        ctx.drawImage(canvas, 0, 0);
        blob = await offscreen.convertToBlob({ type: format, quality });
      }
    }

    if (!blob) {
      throw new Error("Failed to create image blob");
    }

    return blob;
  }

  async generateProxy(
    file: File | Blob,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
    settings: Partial<ExportSettings> = {},
  ): Promise<Blob> {
    // Proxy settings: 540p, lower bitrate, faster encoding
    const proxySettings: ExportSettings = {
      format: "mp4",
      height: 540,
      videoBitrate: 1_000_000, // 1 Mbps
      audioBitrate: 96_000, // 96 kbps
      keyFrameInterval: 1,
      ...settings,
    };

    return this.convertMedia(file, proxySettings, onProgress, signal);
  }

  async exportImageSequence(
    file: File | Blob,
    startTime: number,
    endTime: number,
    frameRate: number,
    format: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
    quality: number = 0.8,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob[]> {
    this.ensureInitialized();
    const { CanvasSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error("No video track found");
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }

      const duration = endTime - startTime;
      const frameCount = Math.ceil(duration * frameRate);
      const timestamps = Array.from(
        { length: frameCount },
        (_, i) => startTime + i / frameRate,
      );

      const sink = new CanvasSink(videoTrack, {
        fit: "contain",
        poolSize: 5,
      });

      const blobs: Blob[] = [];
      let processed = 0;

      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        if (result) {
          const { canvas } = result;
          let blob: Blob | null = null;
          if (canvas instanceof OffscreenCanvas) {
            blob = await canvas.convertToBlob({ type: format, quality });
          }

          if (blob) {
            blobs.push(blob);
          }
        }

        processed++;
        onProgress?.(processed / frameCount);
      }

      return blobs;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async getBestAudioCodec(): Promise<string | null> {
    this.ensureInitialized();
    const { getFirstEncodableAudioCodec, Mp4OutputFormat } = this.mediabunny!;

    const format = new Mp4OutputFormat();
    const supportedCodecs = format.getSupportedAudioCodecs();

    try {
      const codec = await getFirstEncodableAudioCodec(supportedCodecs);
      return codec || null;
    } catch {
      return null;
    }
  }
}
let engineInstance: MediaBunnyEngine | null = null;

export function getMediaEngine(): MediaBunnyEngine {
  if (!engineInstance) {
    engineInstance = new MediaBunnyEngine();
  }
  return engineInstance;
}

export async function initializeMediaEngine(): Promise<MediaBunnyEngine> {
  const engine = getMediaEngine();
  await engine.initialize();
  return engine;
}
