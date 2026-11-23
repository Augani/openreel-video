/**
 * Desktop native decode: the renderer half of the ffmpeg-sidecar frame source.
 *
 * Registers a `NativeFrameProvider` with core so that sources WebCodecs cannot decode (ProRes, DNxHD,
 * MPEG-4 part 2, ...) are decoded on demand by the main process instead of waiting for a proxy. The
 * main process streams raw RGBA frames; this module turns them into canvases and records latency.
 */
import {
  parseSourceColor,
  registerNativeFrameProvider,
  isNativeContainerName,
  type NativeFrame,
  type NativeFrameProvider,
  type NativeFrameRequest,
  type NativeSourceInfo,
} from "@openreel/core";

/** Codecs Chromium's WebCodecs decodes; the rest are native-decode candidates. Mirrors the main process. */
export const WEB_DECODABLE_CODECS: ReadonlySet<string> = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);
/** Still-image "video" codecs: a picture is never a native-decode candidate. */
const STILL_CODECS: ReadonlySet<string> = new Set(["png", "gif", "webp", "bmp", "tiff", "jpegls"]);

import type { OpenReelNativeFrame } from "../types/global";

type Bridge = NonNullable<Window["openreel"]>;

const knownPaths = new WeakMap<Blob, string>();
/** Tell the decoder where a Blob that is not a picked File came from (relinked and reopened media). */
export function rememberNativePath(blob: Blob, path: string): void {
  if (path) knownPaths.set(blob, path);
}

export function hasRememberedNativePath(blob: Blob): boolean {
  return knownPaths.has(blob);
}

export interface NativeDecodeSample {
  /** Round trip of one frame request, in milliseconds. */
  ms: number;
  quality: "preview" | "full";
}

const MAX_SAMPLES = 512;
const samples: NativeDecodeSample[] = [];
export function getNativeDecodeSamples(): readonly NativeDecodeSample[] {
  return samples;
}
export function clearNativeDecodeSamples(): void {
  samples.length = 0;
}
function record(sample: NativeDecodeSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function pathOfBlob(bridge: Bridge, blob: Blob): string {
  const known = knownPaths.get(blob);
  if (known) return known;
  if (typeof File === "undefined" || !(blob instanceof File)) return "";
  return bridge.export.pathForFile?.(blob) ?? "";
}

/**
 * Whether a file the app could not decode with WebCodecs is a native-decode candidate. A pro wrapper
 * (MXF) always is, whatever it holds: AVC-Intra is H.264, which WebCodecs knows, but no browser can
 * open the MXF around it. `fileName` is the file's name or path.
 */
export function isNativeCandidate(blobType: string, codec: string, fileName?: string): boolean {
  if (blobType.startsWith("image/") || blobType.startsWith("audio/")) return false;
  if (isNativeContainerName(fileName)) return true;
  const name = codec.toLowerCase();
  return !WEB_DECODABLE_CODECS.has(name) && !STILL_CODECS.has(name);
}

function toCanvas(frame: OpenReelNativeFrame): OffscreenCanvas {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context for a native frame");
  // Structured-clone IPC hands the bytes over in an ArrayBuffer of their own: view it, do not copy it.
  const pixels = new Uint8ClampedArray(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.rgba.byteLength);
  ctx.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
  return canvas;
}

/** The 8-bit canvas of a 16-bit frame (high bytes; the codes themselves ride along in `codes16`). */
function toCanvas16(frame: OpenReelNativeFrame, codes: Uint16Array): OffscreenCanvas {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context for a native frame");
  const pixels = new Uint8ClampedArray(codes.length);
  for (let i = 0; i < codes.length; i++) pixels[i] = (codes[i] + 128) >> 8;
  ctx.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
  return canvas;
}

export function createDesktopNativeFrameProvider(bridge: Bridge): NativeFrameProvider {
  const media = bridge.media;
  const inFlight = new Map<string, Promise<NativeFrame | null>>();
  return {
    async claim(blob: Blob): Promise<NativeSourceInfo | null> {
      if (!media?.nativeProbe) return null;
      const path = pathOfBlob(bridge, blob);
      if (!path) return null;
      const probe = await media.nativeProbe({ path });
      if (!probe || !isNativeCandidate(blob.type, probe.codec, probe.path)) return null;
      const streams = probe.audioStreams ?? [];
      const sourceColor = parseSourceColor(
        probe.color ? { primaries: probe.color.primaries, transfer: probe.color.transfer, matrix: probe.color.matrix, fullRange: probe.color.range === "pc" || probe.color.range === "jpeg" } : null,
      );
      return {
        id: probe.path,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        duration: probe.duration,
        codec: probe.codec,
        ...(probe.rotation ? { rotation: probe.rotation } : {}),
        ...(probe.container ? { container: probe.container } : {}),
        ...(streams.length
          ? { audio: { trackCount: streams.length, channels: Math.max(...streams.map((s) => s.channels)), sampleRate: streams[0].sampleRate, streamChannels: streams.map((s) => s.channels) } }
          : {}),
        ...(sourceColor ? { sourceColor } : {}),
        ...(probe.pixelAspectRatio ? { pixelAspectRatio: probe.pixelAspectRatio } : {}),
        ...(probe.fieldOrder ? { fieldOrder: probe.fieldOrder } : {}),
      };
    },
    async probeShape(blob: Blob) {
      if (!media?.nativeProbe) return null;
      const path = pathOfBlob(bridge, blob);
      if (!path) return null;
      const probe = await media.nativeProbe({ path });
      if (!probe) return null;
      return {
        ...(probe.pixelAspectRatio ? { pixelAspectRatio: probe.pixelAspectRatio } : {}),
        ...(probe.fieldOrder ? { fieldOrder: probe.fieldOrder } : {}),
      };
    },
    async getFrame(source: NativeSourceInfo, time: number, request: NativeFrameRequest): Promise<NativeFrame | null> {
      if (!media?.nativeFrame) return null;
      const wide = request.precision === 16;
      const key = `${source.id}|${request.quality}|${request.width ?? 0}|${Math.round(time * source.frameRate * 4)}${wide ? "|16" : ""}`;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const started = performance.now();
      const job = (async (): Promise<NativeFrame | null> => {
        const frame = await media.nativeFrame({ path: source.id, time, width: request.width, quality: request.quality, ...(wide ? { bitDepth: 16 as const } : {}) });
        if (!frame) return null;
        const ms = performance.now() - started;
        record({ ms, quality: request.quality });
        if (wide && frame.bitDepth === 16) {
          // Structured-clone IPC hands the bytes over in an ArrayBuffer of their own (2-byte aligned): view it.
          const codes = new Uint16Array(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.rgba.byteLength / 2);
          return {
            canvas: toCanvas16(frame, codes),
            timestamp: frame.timestamp,
            duration: frame.duration,
            codes16: { data: codes, width: frame.width, height: frame.height },
          };
        }
        return { canvas: toCanvas(frame), timestamp: frame.timestamp, duration: frame.duration };
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, job);
      return job;
    },
  };
}

/** Wire the sidecar decoder into core. Call once at desktop startup. */
export function installDesktopNativeDecode(): void {
  const bridge = window.openreel;
  if (bridge?.platform !== "desktop" || !bridge.media?.nativeFrame) return;
  registerNativeFrameProvider(createDesktopNativeFrameProvider(bridge));
}
