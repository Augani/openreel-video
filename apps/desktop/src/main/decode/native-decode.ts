import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { probeMediaFile } from "../ingest/probe-media";
import { resolveFfmpegPath } from "../sidecar/ffmpeg-path";
import { probeSource } from "../sidecar/probe-source";

/**
 * Native decode service: ffmpeg (the bundled sidecar) decodes video the renderer's WebCodecs cannot
 * (ProRes, DNxHD...) on demand and streams raw RGBA frames back over IPC.
 *
 * - One ffmpeg process per "stream" decodes forward from the requested frame and pauses (pipe
 *   back-pressure) once it is `AHEAD_FRAMES` past the last frame asked for. Playback and export are
 *   sequential, so a request almost always lands on a frame the stream already produced.
 * - A request outside every live stream's window starts a new stream there (a scrub); the least
 *   recently used stream is killed, so thrashing the playhead never leaves orphan processes.
 * - Decoded frames live in a byte-budgeted LRU cache keyed by file + mtime + width + quality + frame.
 */

export type DecodeQuality = "preview" | "full";

export interface NativeSourceProbe {
  path: string;
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  /** Clockwise degrees (0/90/180/270) the file's rotation metadata turns the stored frame. width/height are already the upright size. */
  rotation: number;
  /** Frames in the video stream (duration * frame rate, rounded). */
  frameCount: number;
  /** ffmpeg's demuxer for the file (`mxf`, `mov,mp4,...`). */
  container?: string;
  /** Audio streams in file order (an MXF file usually has one mono PCM stream per channel). */
  audioStreams: Array<{ codec: string; channels: number; sampleRate: number }>;
  /** Interlaced picture: decoded as stored (no deinterlace), exactly like ProRes/DNxHD sources. */
  interlaced: boolean;
  /** Field order ffmpeg reports for an interlaced stream. */
  fieldOrder?: "upper" | "lower";
  /** Sample (pixel) aspect ratio when the stream reports a non-square one (`SAR 4:3`). */
  pixelAspectRatio?: number;
  /** Embedded start timecode (MOV timecode track / MXF timecode component), `;` before the frames for drop frame. */
  startTimecode?: string;
  /** Colour tags exactly as ffmpeg prints them (bt2020nc, smpte2084, arib-std-b67...); absent fields are untagged. */
  color?: { range?: string; matrix?: string; primaries?: string; transfer?: string };
}

export interface DecodedFrame {
  width: number;
  height: number;
  frameIndex: number;
  timestamp: number;
  duration: number;
  /** 8-bit RGBA, or little-endian 16-bit RGBA (8 bytes a pixel) when `bitDepth` is 16. */
  rgba: Buffer;
  bitDepth?: 8 | 16;
}

export interface DecodeStats {
  cacheHits: number;
  cacheMisses: number;
  streamsStarted: number;
  streamsLive: number;
  framesDecoded: number;
  /** Frames decoded for export-quality requests (never the draft preview scaler). */
  fullQualityFrames: number;
  cacheBytes: number;
  cacheFrames: number;
}

/** Codecs the renderer's WebCodecs/Chromium decodes (everything else is a native-decode candidate). */
export const WEB_DECODABLE_CODECS: ReadonlySet<string> = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);

const KNOWN_RATES: ReadonlyArray<readonly [number, number, number]> = [
  [23.976, 24000, 1001],
  [29.97, 30000, 1001],
  [47.952, 48000, 1001],
  [59.94, 60000, 1001],
  [119.88, 120000, 1001],
];

/** Snap ffmpeg's printed rate (23.98) to the exact broadcast rational so frame indices do not drift. */
export function exactFrameRate(printed: number): number {
  for (const [approx, num, den] of KNOWN_RATES) {
    if (Math.abs(printed - approx) < 0.02) return num / den;
  }
  return printed;
}

export function frameIndexAt(time: number, frameRate: number, frameCount: number): number {
  const index = Math.floor(Math.max(0, time) * frameRate + 1e-6);
  return Math.max(0, Math.min(Math.max(0, frameCount - 1), index));
}

/** ffmpeg filters that turn a stored frame upright, for `-noautorotate` input. Mirrors core's `ffmpegRotationFilters`. */
export function rotationFilters(rotation: number): string[] {
  switch (((Math.round(rotation / 90) % 4) + 4) % 4) {
    case 1:
      return ["transpose=1"];
    case 2:
      return ["hflip", "vflip"];
    case 3:
      return ["transpose=2"];
    default:
      return [];
  }
}

export function evenWidth(requested: number | undefined, sourceWidth: number): number {
  const wanted = requested && requested > 0 ? Math.min(Math.round(requested), sourceWidth) : sourceWidth;
  return Math.max(2, wanted - (wanted % 2));
}

export function outputHeight(width: number, sourceWidth: number, sourceHeight: number): number {
  const h = Math.round((width * sourceHeight) / sourceWidth);
  return Math.max(2, h - (h % 2));
}

export interface DecodeArgsInput {
  srcPath: string;
  startFrame: number;
  frameRate: number;
  width: number;
  height: number;
  /** Upright source dimensions (after rotation): scaling is skipped when equal. */
  sourceWidth: number;
  sourceHeight: number;
  /** Rotation metadata, clockwise degrees. Applied explicitly (the stream's own autorotate is off). */
  rotation?: number;
  quality: DecodeQuality;
  /** 16 decodes to rgba64le (exact code values for the HDR working mode); default 8-bit rgba. */
  bitDepth?: 8 | 16;
  /** Colour matrix to assume when the stream does not say. */
  matrix: "bt709" | "bt601" | "bt2020";
  /** Upper bound on frames to emit (the stream stops at the end of the file anyway). */
  maxFrames?: number;
}

export function buildDecodeArgs(input: DecodeArgsInput): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-noautorotate"];
  // Seek a quarter frame early: the first frame with pts >= seek point is exactly startFrame.
  if (input.startFrame > 0) args.push("-ss", ((input.startFrame - 0.25) / input.frameRate).toFixed(6));
  args.push("-i", input.srcPath, "-map", "0:v:0", "-an", "-sn", "-dn");
  const turn = rotationFilters(input.rotation ?? 0);
  const scale = [`scale=${input.width}:${input.height}`, `flags=${input.quality === "full" ? "bicubic+accurate_rnd+full_chroma_int" : "fast_bilinear"}`, `in_color_matrix=${input.matrix}`];
  args.push("-vf", [...turn, scale.join(":")].join(","), "-pix_fmt", input.bitDepth === 16 ? "rgba64le" : "rgba", "-fps_mode", "passthrough");
  if (input.maxFrames) args.push("-frames:v", String(input.maxFrames));
  args.push("-f", "rawvideo", "-");
  return args;
}

interface CachedFrame {
  frame: DecodedFrame;
  bytes: number;
}

class FrameCache {
  private readonly map = new Map<string, CachedFrame>();
  bytes = 0;
  constructor(private budget: number) {}

  get(key: string): DecodedFrame | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.frame;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, frame: DecodedFrame): void {
    const previous = this.map.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.map.delete(key);
    const bytes = frame.rgba.byteLength;
    this.map.set(key, { frame, bytes });
    this.bytes += bytes;
    this.evict();
  }

  private evict(): void {
    for (const [key, entry] of this.map) {
      if (this.bytes <= this.budget || this.map.size <= 1) break;
      this.map.delete(key);
      this.bytes -= entry.bytes;
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

interface Stream {
  id: number;
  key: string;
  quality: DecodeQuality;
  depth: 8 | 16;
  proc: ChildProcessWithoutNullStreams;
  startFrame: number;
  /** Next frame index this stream will emit. */
  nextFrame: number;
  /** Highest frame index a caller has asked for from this stream. */
  wanted: number;
  frameBytes: number;
  /** Frames this stream decodes past the last one asked for before pausing. */
  ahead: number;
  pending: Buffer[];
  pendingBytes: number;
  paused: boolean;
  done: boolean;
  /** The process ended on its own without emitting a single frame (a seek past the video's end). */
  endedEmpty: boolean;
  lastUsed: number;
  waiters: Map<number, Array<{ resolve: (frame: DecodedFrame | null) => void }>>;
}

interface Source {
  probe: NativeSourceProbe;
  rotation: number;
  mtimeMs: number;
  matrix: "bt709" | "bt601" | "bt2020";
  /** Index of the last frame the video stream really holds, once a seek past the end has revealed it. */
  lastFrame?: number;
}

export interface NativeDecodeOptions {
  /** Frames a stream decodes past the last one requested before pausing. */
  aheadFrames?: number;
  cacheBytes?: number;
  maxStreams?: number;
}

export class NativeDecodeService {
  private readonly aheadFrames: number;
  private readonly cacheBudget: number;
  private readonly maxStreams: number;
  private readonly cache: FrameCache;
  private readonly sources = new Map<string, Promise<Source | null>>();
  private readonly streams: Stream[] = [];
  private nextId = 1;
  private stats = { cacheHits: 0, cacheMisses: 0, streamsStarted: 0, framesDecoded: 0, fullQualityFrames: 0 };

  constructor(options: NativeDecodeOptions = {}) {
    this.aheadFrames = options.aheadFrames ?? 12;
    this.maxStreams = options.maxStreams ?? 4;
    this.cacheBudget = options.cacheBytes ?? 320 * 1024 * 1024;
    this.cache = new FrameCache(this.cacheBudget);
  }

  /** Describe a file when ffmpeg can decode its video; null otherwise. Cached per path. */
  async probe(srcPath: string): Promise<NativeSourceProbe | null> {
    return (await this.source(srcPath))?.probe ?? null;
  }

  private source(srcPath: string): Promise<Source | null> {
    if (!path.isAbsolute(srcPath) || srcPath.includes("\0")) return Promise.resolve(null);
    let source = this.sources.get(srcPath);
    if (!source) {
      source = this.loadSource(srcPath);
      this.sources.set(srcPath, source);
      // A file that is missing or unreadable now may be there later (relink, drive mounted): do not pin the failure.
      const pinned = source;
      void pinned.then((value) => {
        if (!value && this.sources.get(srcPath) === pinned) this.sources.delete(srcPath);
      });
    }
    return source;
  }

  private async loadSource(srcPath: string): Promise<Source | null> {
    const stat = await fs.stat(srcPath).catch(() => null);
    if (!stat?.isFile()) return null;
    const [media, colour] = await Promise.all([probeMediaFile(srcPath), probeSource(srcPath)]);
    if (!media?.hasVideo || !media.width || !media.height || !media.frameRate) return null;
    const frameRate = exactFrameRate(media.frameRate);
    const duration = media.duration ?? 0;
    const tagged = colour?.color.matrix;
    const matrix =
      tagged === "bt2020nc" || tagged === "bt2020c"
        ? "bt2020"
        : tagged === "bt470bg" || tagged === "smpte170m"
          ? "bt601"
          : tagged === "bt709"
            ? "bt709"
            : media.height >= 720
              ? "bt709"
              : "bt601";
    const rotation = media.rotation ?? 0;
    const turned = rotation === 90 || rotation === 270;
    return {
      mtimeMs: stat.mtimeMs,
      matrix,
      rotation,
      probe: {
        path: srcPath,
        codec: media.videoCodec ?? "unknown",
        // Upright size: what every consumer (preview, thumbnails, export) lays out and draws.
        width: turned ? media.height : media.width,
        height: turned ? media.width : media.height,
        rotation,
        frameRate,
        duration,
        frameCount: Math.max(1, Math.round(duration * frameRate)),
        ...(media.container ? { container: media.container } : {}),
        audioStreams: media.audioStreams ?? [],
        interlaced: media.interlaced === true,
        ...(media.fieldOrder ? { fieldOrder: media.fieldOrder } : {}),
        ...(media.pixelAspectRatio ? { pixelAspectRatio: media.pixelAspectRatio } : {}),
        ...(media.startTimecode ? { startTimecode: media.startTimecode } : {}),
        ...(colour && Object.values(colour.color).some(Boolean) ? { color: colour.color } : {}),
      },
    };
  }

  /** Decode the frame displayed at `time`; null when the file cannot be read. */
  async getFrame(srcPath: string, time: number, opts: { width?: number; quality: DecodeQuality; bitDepth?: 8 | 16 }): Promise<DecodedFrame | null> {
    const source = await this.source(srcPath);
    if (!source) return null;
    const { probe } = source;
    const width = evenWidth(opts.width, probe.width);
    const height = outputHeight(width, probe.width, probe.height);
    const index = Math.min(frameIndexAt(time, probe.frameRate, probe.frameCount), source.lastFrame ?? Number.MAX_SAFE_INTEGER);
    const depth = opts.bitDepth === 16 ? 16 : 8;
    const key = this.keyPrefix(srcPath, source, width, opts.quality, depth);
    const first = await this.fetchFrame(srcPath, source, key, index, width, height, opts.quality, depth);
    if (first.frame && first.frame.frameIndex >= index) return first.frame;
    if (first.frame) {
      // A stream ran dry before `index` and handed back the last real frame: the video is shorter than the container said.
      source.lastFrame = first.frame.frameIndex;
      return first.frame;
    }
    if (!first.pastEnd || index === 0) return null;
    // Seeking past the video's real end decodes nothing (audio tail, rounded duration): bisect for the last frame.
    let low = 0;
    let high = index;
    let best: DecodedFrame | null = null;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      const probeResult = await this.fetchFrame(srcPath, source, key, mid, width, height, opts.quality, depth);
      if (probeResult.frame) {
        best = probeResult.frame;
        low = probeResult.frame.frameIndex;
        // A stream that ran dry on the way to `mid` handed back the real last frame: that is the answer.
        if (low < mid) break;
      } else if (probeResult.pastEnd) high = mid;
      else return null;
    }
    source.lastFrame = low;
    return best && best.frameIndex === low ? best : (await this.fetchFrame(srcPath, source, key, low, width, height, opts.quality, depth)).frame;
  }

  private async fetchFrame(
    srcPath: string,
    source: Source,
    key: string,
    index: number,
    width: number,
    height: number,
    quality: DecodeQuality,
    depth: 8 | 16,
  ): Promise<{ frame: DecodedFrame | null; pastEnd: boolean }> {
    const hit = this.cache.get(`${key}|${index}`);
    if (hit) {
      this.stats.cacheHits++;
      this.touch(key, index);
      return { frame: hit, pastEnd: false };
    }
    this.stats.cacheMisses++;
    const stream = this.streamFor(key, index) ?? this.startStream(srcPath, source, key, index, width, height, quality, depth);
    stream.wanted = Math.max(stream.wanted, index);
    stream.lastUsed = performance.now();
    const frame = await new Promise<DecodedFrame | null>((resolve) => {
      const waiting = stream.waiters.get(index) ?? [];
      waiting.push({ resolve });
      stream.waiters.set(index, waiting);
      this.resume(stream);
    });
    return { frame, pastEnd: !frame && stream.endedEmpty };
  }

  private keyPrefix(srcPath: string, source: Source, width: number, quality: DecodeQuality, depth: 8 | 16): string {
    return `${srcPath}|${source.mtimeMs}|${width}|${quality}${depth === 16 ? "|16" : ""}`;
  }

  private touch(key: string, index: number): void {
    const stream = this.streams.find((candidate) => candidate.key === key && index >= candidate.startFrame && !candidate.done);
    if (!stream) return;
    stream.wanted = Math.max(stream.wanted, index);
    stream.lastUsed = performance.now();
    this.resume(stream);
  }

  /** A live stream that will reach `index` soon: it is behind it, within a short forward window. */
  private streamFor(key: string, index: number): Stream | undefined {
    return this.streams.find((s) => s.key === key && !s.done && index >= s.nextFrame && index <= s.nextFrame + s.ahead * 2);
  }

  /** Read-ahead is capped so a stream never decodes more than a quarter of the cache budget past the playhead (4K frames are 33 MB). */
  private aheadFor(frameBytes: number): number {
    return Math.max(2, Math.min(this.aheadFrames, Math.floor(this.cacheBudget / 4 / frameBytes)));
  }

  private startStream(srcPath: string, source: Source, key: string, startFrame: number, width: number, height: number, quality: DecodeQuality, depth: 8 | 16): Stream {
    while (this.streams.length >= this.maxStreams) {
      const victim = this.streams.reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b));
      this.kill(victim);
    }
    const { probe } = source;
    const args = buildDecodeArgs({
      srcPath,
      startFrame,
      frameRate: probe.frameRate,
      width,
      height,
      sourceWidth: probe.width,
      sourceHeight: probe.height,
      rotation: source.rotation,
      quality,
      bitDepth: depth,
      matrix: source.matrix,
      maxFrames: probe.frameCount - startFrame,
    });
    const proc = spawn(resolveFfmpegPath(), args, { stdio: ["pipe", "pipe", "pipe"] });
    const stream: Stream = {
      id: this.nextId++,
      key,
      quality,
      depth,
      proc,
      startFrame,
      nextFrame: startFrame,
      wanted: startFrame,
      frameBytes: width * height * 4 * (depth === 16 ? 2 : 1),
      ahead: this.aheadFor(width * height * 4 * (depth === 16 ? 2 : 1)),
      pending: [],
      pendingBytes: 0,
      paused: false,
      done: false,
      endedEmpty: false,
      lastUsed: performance.now(),
      waiters: new Map(),
    };
    this.stats.streamsStarted++;
    this.streams.push(stream);
    proc.stdin.on("error", () => undefined);
    proc.stderr.on("data", () => undefined);
    proc.stdout.on("data", (chunk: Buffer) => this.onData(stream, probe, width, height, chunk));
    const finish = (): void => {
      if (stream.done) return;
      stream.done = true;
      stream.endedEmpty = stream.nextFrame === stream.startFrame;
      this.release(stream, true);
    };
    proc.on("error", finish);
    proc.on("close", finish);
    return stream;
  }

  private onData(stream: Stream, probe: NativeSourceProbe, width: number, height: number, chunk: Buffer): void {
    stream.pending.push(chunk);
    stream.pendingBytes += chunk.length;
    while (stream.pendingBytes >= stream.frameBytes) {
      const rgba = Buffer.allocUnsafeSlow(stream.frameBytes);
      let filled = 0;
      while (filled < stream.frameBytes) {
        const head = stream.pending[0];
        const take = Math.min(head.length, stream.frameBytes - filled);
        head.copy(rgba, filled, 0, take);
        filled += take;
        if (take === head.length) stream.pending.shift();
        else stream.pending[0] = head.subarray(take);
      }
      stream.pendingBytes -= stream.frameBytes;
      const index = stream.nextFrame++;
      const frame: DecodedFrame = { width, height, frameIndex: index, timestamp: index / probe.frameRate, duration: 1 / probe.frameRate, rgba, ...(stream.depth === 16 ? { bitDepth: 16 as const } : {}) };
      this.stats.framesDecoded++;
      if (stream.quality === "full") this.stats.fullQualityFrames++;
      this.cache.set(`${stream.key}|${index}`, frame);
      const waiting = stream.waiters.get(index);
      if (waiting) {
        stream.waiters.delete(index);
        for (const w of waiting) w.resolve(frame);
      }
      // Frames nobody asked for are not dropped from the cache: they are the read-ahead.
    }
    if (stream.nextFrame > stream.wanted + stream.ahead && !stream.paused) {
      stream.paused = true;
      stream.proc.stdout.pause();
    }
  }

  private resume(stream: Stream): void {
    if (stream.paused && stream.nextFrame <= stream.wanted + stream.ahead) {
      stream.paused = false;
      stream.proc.stdout.resume();
    }
  }

  private release(stream: Stream, ended = false): void {
    const at = this.streams.indexOf(stream);
    if (at >= 0) this.streams.splice(at, 1);
    // The container reported more frames than the video stream holds (audio longer than video, rounding):
    // a request past the real last frame shows the last frame, as a player holds it, instead of failing.
    const last = ended && stream.nextFrame > stream.startFrame ? this.cache.get(`${stream.key}|${stream.nextFrame - 1}`) : undefined;
    for (const [index, waiting] of stream.waiters) for (const w of waiting) w.resolve(last && index >= stream.nextFrame ? last : null);
    stream.waiters.clear();
  }

  private kill(stream: Stream): void {
    stream.done = true;
    try {
      stream.proc.stdout.destroy();
      stream.proc.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    this.release(stream);
  }

  getStats(): DecodeStats {
    return { ...this.stats, streamsLive: this.streams.length, cacheBytes: this.cache.bytes, cacheFrames: this.cache.size };
  }

  /** Stop every stream and drop the cache (app quit, project close). */
  dispose(): void {
    for (const stream of [...this.streams]) this.kill(stream);
    this.cache.clear();
    this.sources.clear();
  }
}

let shared: NativeDecodeService | null = null;
export function nativeDecodeService(): NativeDecodeService {
  shared ??= new NativeDecodeService();
  return shared;
}
