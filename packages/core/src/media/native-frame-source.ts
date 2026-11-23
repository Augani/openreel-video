import type { SourceColorSpace } from "../color/source-color";
/**
 * Native frame source: decode video the browser cannot (ProRes, DNxHD, ...) on demand.
 *
 * The desktop app registers a provider that talks to the bundled ffmpeg sidecar. Everything that
 * would otherwise open the file with WebCodecs (preview scrubbing and playback, export, thumbnails)
 * first asks `claimNativeSource(blob)`; a claimed source is decoded by the provider and handed back
 * as canvases through the same shapes the WebCodecs path returns (`getCanvas`, `getFrame`), so the
 * callers need no second code path.
 */

export type NativeFrameQuality = "preview" | "full";

export interface NativeSourceInfo {
  /** Stable id of the file (the path). */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly codec: string;
  /** Clockwise degrees the file's rotation metadata turns the stored frame; width/height are already upright. */
  readonly rotation?: number;
  /** Demuxer of the file (`mxf`, `mov,mp4,...`). */
  readonly container?: string;
  /** Audio the container carries: MXF holds one mono PCM stream per channel, so `trackCount` is often 2-16. */
  readonly audio?: { readonly trackCount: number; readonly channels: number; readonly sampleRate: number; /** Channels of each stream, in stream order. */ readonly streamChannels?: readonly number[] };
  /** Colour space read from the file's stream tags by the native probe (ffmpeg); absent when untagged. */
  readonly sourceColor?: SourceColorSpace;
  /** Non-square pixel (sample) aspect ratio the stream reports; absent = square. */
  readonly pixelAspectRatio?: number;
  /** Field order of an interlaced stream; absent = progressive. */
  readonly fieldOrder?: "upper" | "lower";
}

/**
 * Professional wrappers browsers cannot open at all (no demuxer, so the MIME type is empty or `application/mxf`
 * and the codec inside may be one WebCodecs knows, like AVC-Intra's H.264). The desktop app reads them with the
 * ffmpeg sidecar whatever codec they hold; the web build offers a proxy transcode instead.
 */
const NATIVE_CONTAINER = /\.(mxf)$/i;
export function isNativeContainerName(name: string | undefined | null): boolean {
  return Boolean(name) && NATIVE_CONTAINER.test(name!);
}

/** The pro container of a picked file, going by name (a Blob without a name has none). */
export function isNativeContainerFile(blob: Blob): boolean {
  return isNativeContainerName((blob as File).name);
}

export interface NativeFrame {
  readonly canvas: OffscreenCanvas;
  readonly timestamp: number;
  readonly duration: number;
  /**
   * The frame's raw 16-bit RGBA code values (little-endian, straight alpha), present when the request asked for
   * `precision: 16` and the provider could deliver them. `canvas` then holds the same codes quantised to 8 bits.
   */
  readonly codes16?: { readonly data: Uint16Array; readonly width: number; readonly height: number };
}

export interface NativeFrameRequest {
  /** Output width in pixels; never upscaled past the source. */
  readonly width?: number;
  readonly quality: NativeFrameQuality;
  /** 16 asks for exact 16-bit code values (HDR working mode); the default is 8-bit. */
  readonly precision?: 8 | 16;
}

/** Pixel aspect and field order a probe reads from any video file (absent = square / progressive). */
export interface FootageShapeProbe {
  readonly pixelAspectRatio?: number;
  readonly fieldOrder?: "upper" | "lower";
}

export interface NativeFrameProvider {
  /** Decide whether this Blob needs native decode (and describe it). Called once per Blob. */
  claim(blob: Blob): Promise<NativeSourceInfo | null>;
  /** Pixel aspect / field order of a file the browser decodes itself (WebCodecs/mediabunny read neither). */
  probeShape?(blob: Blob): Promise<FootageShapeProbe | null>;
  getFrame(source: NativeSourceInfo, time: number, request: NativeFrameRequest): Promise<NativeFrame | null>;
}

let provider: NativeFrameProvider | null = null;
let claims = new WeakMap<Blob, Promise<NativeSourceInfo | null>>();

export function registerNativeFrameProvider(next: NativeFrameProvider | null): void {
  provider = next;
  claims = new WeakMap();
}

export function hasNativeFrameProvider(): boolean {
  return provider !== null;
}

/** The native description of a Blob, or null when WebCodecs should (or must) handle it. */
export function claimNativeSource(blob: Blob): Promise<NativeSourceInfo | null> {
  const active = provider;
  if (!active) return Promise.resolve(null);
  let claim = claims.get(blob);
  if (!claim) {
    claim = active.claim(blob).catch(() => null);
    claims.set(blob, claim);
  }
  return claim;
}

/**
 * Pixel aspect ratio and field order of a video file, from the native probe, whether or not the file is natively
 * decoded. Null without a probe (web build, unreadable file).
 */
export async function probeFootageShape(blob: Blob): Promise<FootageShapeProbe | null> {
  const active = provider;
  if (!active?.probeShape) return null;
  return active.probeShape(blob).catch(() => null);
}

/**
 * One full-quality frame of a native source as raw code values, for the HDR working mode: 16-bit when the provider
 * delivers them, else the 8-bit canvas read back. Null when the source is not natively decoded.
 */
export async function getNativeFrameCodes(
  blob: Blob,
  time: number,
  width?: number,
): Promise<{ readonly source: NativeSourceInfo; readonly frame: NativeFrame } | null> {
  const source = await claimNativeSource(blob);
  if (!source || !provider) return null;
  const frame = await provider.getFrame(source, time, { width, quality: "full", precision: 16 });
  return frame ? { source, frame } : null;
}

/** Same surface as mediabunny's CanvasSink for the calls the preview makes. */
export class NativeCanvasSink {
  constructor(
    private readonly source: NativeSourceInfo,
    private readonly request: NativeFrameRequest = { quality: "preview" },
  ) {}

  async getCanvas(time: number): Promise<{ canvas: OffscreenCanvas; timestamp: number; duration: number } | null> {
    if (!provider) return null;
    return provider.getFrame(this.source, time, this.request);
  }

  get info(): NativeSourceInfo {
    return this.source;
  }
}

/** Export-side decoder: full quality, asked for increasing timestamps. */
export class NativeExportFrameDecoder {
  constructor(
    private readonly source: NativeSourceInfo,
    private readonly width?: number,
  ) {}

  async getFrame(timestamp: number): Promise<OffscreenCanvas | null> {
    if (!provider) return null;
    const frame = await provider.getFrame(this.source, timestamp, { width: this.width, quality: "full" });
    return frame?.canvas ?? null;
  }

  dispose(): void {
    // Frames are owned by the provider's cache; nothing to release per decoder.
  }
}

export interface ExportFrameDecoderLike {
  getFrame(timestamp: number): Promise<OffscreenCanvas | null>;
  dispose(): void;
}
