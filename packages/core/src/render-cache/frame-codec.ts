/**
 * Intra-only frame codecs for the render cache. Every cached frame is
 * independently decodable (no inter-frame dependencies), so a single frame can
 * be invalidated, replaced or evicted without touching its neighbours and
 * playback can start at any cached frame.
 */
export interface EncodedCacheFrame {
  readonly data: ArrayBuffer;
}

export interface FrameCodec {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  encode(image: ImageBitmap): Promise<EncodedCacheFrame>;
  /** Decode independent frames in order. The caller owns (and must close) the bitmaps. */
  decodeBatch(frames: readonly EncodedCacheFrame[]): Promise<ImageBitmap[]>;
  dispose(): void;
}

export interface FrameCodecOptions {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** Target bitrate for WebCodecs intra frames (bits per second). */
  readonly bitrate?: number;
  /** JPEG quality for the image fallback codec. */
  readonly quality?: number;
  /** Force a particular codec family (tests and diagnostics). */
  readonly prefer?: "webcodecs" | "image";
}

/** JPEG fallback: universally available, intra by construction. */
export class ImageFrameCodec implements FrameCodec {
  readonly id = "image/jpeg";

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly quality = 0.92,
  ) {}

  async encode(image: ImageBitmap): Promise<EncodedCacheFrame> {
    const canvas = new OffscreenCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("render cache: no 2D context for JPEG encoding");
    ctx.drawImage(image, 0, 0, this.width, this.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: this.quality });
    return { data: await blob.arrayBuffer() };
  }

  async decodeBatch(frames: readonly EncodedCacheFrame[]): Promise<ImageBitmap[]> {
    return Promise.all(
      frames.map((frame) => createImageBitmap(new Blob([frame.data], { type: "image/jpeg" }))),
    );
  }

  dispose(): void {}
}

const ENCODE_ATTEMPTS = 3;

const CANDIDATE_CODECS = ["avc1.640034", "vp09.00.50.08", "vp8"] as const;

type PendingEncode = {
  resolve: (frame: EncodedCacheFrame) => void;
  reject: (error: Error) => void;
};

/** All-keyframe WebCodecs stream: each frame is its own IDR/key chunk. */
export class WebCodecsIntraCodec implements FrameCodec {
  readonly id: string;
  private encoder: VideoEncoder | null = null;
  private decoder: VideoDecoder | null = null;
  private readonly pending = new Map<number, PendingEncode>();
  private decoded = new Map<number, VideoFrame>();
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 1;
  private broken: Error | null = null;

  private constructor(
    readonly width: number,
    readonly height: number,
    codec: string,
    private readonly encoderConfig: VideoEncoderConfig,
    private readonly decoderConfig: VideoDecoderConfig,
  ) {
    this.id = `webcodecs/${codec}`;
  }

  static async create(options: FrameCodecOptions): Promise<WebCodecsIntraCodec | null> {
    if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return null;
    const { width, height, frameRate } = options;
    if (width % 2 !== 0 || height % 2 !== 0) return null;
    const bitrate =
      options.bitrate ?? Math.min(200_000_000, Math.max(8_000_000, Math.round(width * height * frameRate * 0.5)));
    for (const codec of CANDIDATE_CODECS) {
      const encoderConfig: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: frameRate,
        latencyMode: "quality",
        bitrateMode: "constant",
        ...(codec.startsWith("avc1") ? { avc: { format: "annexb" as const } } : {}),
      };
      const decoderConfig: VideoDecoderConfig = {
        codec,
        codedWidth: width,
        codedHeight: height,
        optimizeForLatency: true,
      };
      try {
        const [enc, dec] = await Promise.all([
          VideoEncoder.isConfigSupported(encoderConfig),
          VideoDecoder.isConfigSupported(decoderConfig),
        ]);
        if (!enc.supported || !dec.supported) continue;
        return new WebCodecsIntraCodec(width, height, codec, encoderConfig, decoderConfig);
      } catch {
        continue;
      }
    }
    return null;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private ensureEncoder(): VideoEncoder {
    if (this.broken) throw this.broken;
    if (this.encoder && this.encoder.state === "configured") return this.encoder;
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const waiter = this.pending.get(chunk.timestamp);
        if (!waiter) return;
        this.pending.delete(chunk.timestamp);
        const data = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(data);
        waiter.resolve({ data });
      },
      error: (error) => {
        this.broken = error instanceof Error ? error : new Error(String(error));
        for (const waiter of this.pending.values()) waiter.reject(this.broken);
        this.pending.clear();
      },
    });
    encoder.configure(this.encoderConfig);
    this.encoder = encoder;
    return encoder;
  }

  encode(image: ImageBitmap): Promise<EncodedCacheFrame> {
    return this.serial(async () => {
      // Rate-controlled software encoders (OpenH264 on GPU-less hosts) may
      // silently skip a frame that overshoots the bitrate budget: flush()
      // resolves but no chunk is ever emitted. Waiting on the chunk would hang
      // the whole render, so detect the skip and re-encode the frame.
      for (let attempt = 0; attempt < ENCODE_ATTEMPTS; attempt++) {
        const encoder = this.ensureEncoder();
        const timestamp = this.seq++;
        const result = new Promise<EncodedCacheFrame>((resolve, reject) => {
          this.pending.set(timestamp, { resolve, reject });
        });
        result.catch(() => undefined);
        const frame = new VideoFrame(image, { timestamp });
        try {
          encoder.encode(frame, { keyFrame: true });
        } finally {
          frame.close();
        }
        try {
          await encoder.flush();
        } catch (error) {
          this.pending.delete(timestamp);
          throw error;
        }
        if (this.pending.has(timestamp)) {
          this.pending.delete(timestamp);
          continue;
        }
        return result;
      }
      throw new Error("render cache: the encoder dropped the frame");
    });
  }

  private ensureDecoder(): VideoDecoder {
    if (this.broken) throw this.broken;
    if (this.decoder && this.decoder.state === "configured") return this.decoder;
    const decoder = new VideoDecoder({
      output: (frame) => {
        this.decoded.set(frame.timestamp, frame);
      },
      error: (error) => {
        this.broken = error instanceof Error ? error : new Error(String(error));
      },
    });
    decoder.configure(this.decoderConfig);
    this.decoder = decoder;
    return decoder;
  }

  decodeBatch(frames: readonly EncodedCacheFrame[]): Promise<ImageBitmap[]> {
    return this.serial(async () => {
      const decoder = this.ensureDecoder();
      this.decoded = new Map();
      const stamps: number[] = [];
      for (const frame of frames) {
        const timestamp = this.seq++;
        stamps.push(timestamp);
        decoder.decode(new EncodedVideoChunk({ type: "key", timestamp, data: frame.data }));
      }
      await decoder.flush();
      if (this.broken) throw this.broken;
      const bitmaps: ImageBitmap[] = [];
      try {
        for (const stamp of stamps) {
          const video = this.decoded.get(stamp);
          if (!video) throw new Error("render cache: decoder produced no frame");
          bitmaps.push(await createImageBitmap(video));
          video.close();
          this.decoded.delete(stamp);
        }
      } catch (error) {
        for (const bitmap of bitmaps) bitmap.close();
        throw error;
      } finally {
        for (const leftover of this.decoded.values()) leftover.close();
        this.decoded = new Map();
      }
      return bitmaps;
    });
  }

  dispose(): void {
    for (const waiter of this.pending.values()) waiter.reject(new Error("codec disposed"));
    this.pending.clear();
    try {
      if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
      if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    } catch {
      /* already closed */
    }
    this.encoder = null;
    this.decoder = null;
  }
}

async function selfTest(codec: FrameCodec): Promise<boolean> {
  const canvas = new OffscreenCanvas(codec.width, codec.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const noise = ctx.createImageData(codec.width, codec.height);
  // High-entropy frames: an encoder that skips or stalls on large intra frames
  // (software rate control) must fail here rather than hang a long render.
  for (let i = 0; i < noise.data.length; i += 4) {
    noise.data[i] = (i * 2654435761) >>> 24;
    noise.data[i + 1] = (i * 40503) >>> 8;
    noise.data[i + 2] = (i * 69069 + 12345) >>> 16;
    noise.data[i + 3] = 255;
  }
  ctx.putImageData(noise, 0, 0);
  const source = await createImageBitmap(canvas);
  try {
    for (let i = 0; i < 4; i++) {
      const encoded = await withTimeout(codec.encode(source), 15_000);
      const [out] = await withTimeout(codec.decodeBatch([encoded]), 15_000);
      const ok = out.width === codec.width && out.height === codec.height;
      out.close();
      if (!ok) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    source.close();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("render cache: codec self-test timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Pick the best working intra codec: WebCodecs (hardware where available)
 * first, verified with a real encode/decode round trip, then JPEG.
 */
export async function createFrameCodec(options: FrameCodecOptions): Promise<FrameCodec> {
  if (options.prefer !== "image") {
    try {
      const webcodecs = await WebCodecsIntraCodec.create(options);
      if (webcodecs) {
        if (await selfTest(webcodecs)) return webcodecs;
        webcodecs.dispose();
      }
    } catch {
      /* fall through to JPEG */
    }
  }
  return new ImageFrameCodec(options.width, options.height, options.quality);
}
