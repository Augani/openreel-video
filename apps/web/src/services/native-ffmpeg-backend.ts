import {
  broadcastAudioTrackCount,
  effectiveRateControl,
  exportStartTimecode,
  exportWritesAlpha,
  isDolbyFormat,
  resolveDialnorm,
  fingerprintBlob,
  nativeProbeMismatch,
  outputColorForExport,
  rgbaToYuv420,
  rgbaToYuv444,
  takeHdrPayload,
  snapFrameRate,
  withBitDepth10,
  type OutputColorSpec,
} from "@openreel/core";
import type {
  EncoderBackend,
  SmartRenderMuxer,
  SmartRenderPlan,
  SourceFingerprint,
  VideoExportSettings,
  Project,
} from "@openreel/core";
import { NativeSourceFiles } from "./native-source-staging";

type ExportPortMessage =
  | { type: "progress"; frame: number }
  | { type: "credit"; credits?: number }
  | { type: "done" }
  | { type: "runDone"; frames?: number }
  | { type: "error"; message?: string };

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const PCM_FORMAT_TAG = 1;
const BITS_PER_SAMPLE = 16;
const INT16_MAX = 0x7fff;
const INT16_MIN = -0x8000;

function buildWavHeader(
  totalFrames: number,
  channelCount: number,
  sampleRate: number,
): ArrayBuffer {
  const blockAlign = channelCount * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const dataLength = totalFrames * blockAlign;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT_TAG, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  return buffer;
}

export function encodeAudioBufferToPcm16(
  buffer: AudioBuffer,
  channelCount: number,
): ArrayBuffer {
  const outputChannels = Math.max(1, channelCount);
  const length = buffer.length;
  const out = new ArrayBuffer(length * outputChannels * BYTES_PER_SAMPLE);
  // Int16Array uses platform endianness; WAV needs little-endian, which every
  // platform Electron and browsers target is.
  const pcm16 = new Int16Array(out);
  const sources: Float32Array[] = [];
  for (let channel = 0; channel < outputChannels; channel++) {
    sources.push(buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)));
  }

  for (let channel = 0; channel < outputChannels; channel++) {
    const source = sources[channel];
    let index = channel;
    for (let frame = 0; frame < length; frame++) {
      const raw = source[frame] ?? 0;
      const sample = raw < -1 ? -1 : raw > 1 ? 1 : raw;
      const pcm = Math.round(sample < 0 ? sample * -INT16_MIN : sample * INT16_MAX);
      pcm16[index] = pcm < INT16_MIN ? INT16_MIN : pcm > INT16_MAX ? INT16_MAX : pcm;
      index += outputChannels;
    }
  }

  return out;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/** Broadcast delivery fields of the start request (scan, OP-Atom, mono tracks, start timecode); nothing for a plain export. */
export interface BroadcastStartFields {
  scan?: "interlaced-tff";
  mxfPattern?: "opatom";
  audioTrackCount?: number;
  startTimecode?: string;
}

export function broadcastStartFields(settings: VideoExportSettings): BroadcastStartFields {
  const broadcast = settings.broadcast;
  if (!broadcast) return {};
  const fields: BroadcastStartFields = {};
  if (broadcast.scan === "interlaced-tff") fields.scan = "interlaced-tff";
  if (broadcast.mxfPattern === "opatom" && settings.format === "mxf") fields.mxfPattern = "opatom";
  const tracks = broadcastAudioTrackCount(broadcast);
  if (tracks) fields.audioTrackCount = tracks;
  if (broadcast.startTimecode && (settings.format === "mxf" || settings.format === "mov")) {
    const timecode = exportStartTimecode(broadcast.startTimecode, settings.frameRate, settings.range?.startTime ?? 0);
    if (timecode) fields.startTimecode = timecode;
  }
  return fields;
}

/** The Dolby fields of the start request: the audio codec and the dialnorm to write; nothing for AAC / Opus / PCM audio. */
export function dolbyStartFields(settings: VideoExportSettings): { audioCodec?: "ac3" | "eac3"; dialnorm?: number } {
  const audio = settings.audioSettings;
  if (!isDolbyFormat(audio.format)) return {};
  return { audioCodec: audio.format, dialnorm: resolveDialnorm(audio) };
}

export class NativeFFmpegBackend implements EncoderBackend {
  readonly requiresWebCodecsClamping = false;
  // Native FFmpeg applies backpressure through frame credits. Clearing the
  // decoder caches every five frames forces repeated seeks and can duplicate
  // frames in the output, which appears as brief pauses in exported video.
  readonly needsFrameThrottling = false;
  readonly normalizesProResToH264 = false;
  readonly audioBeforeVideo = true;
  // The credit window bounds in-flight frames, and frames are posted in call
  // order through frameChain, so the export loop may queue a few frames.
  readonly supportsPipelining = true;

  /**
   * Native smart render: untouched GOP-aligned spans of the sources are
   * stream-copied by ffmpeg (main process) and only the other spans are
   * rendered here and encoded with the source's stream parameters.
   */
  readonly smartRender: SmartRenderMuxer = {
    engine: "native",
    prepare: (plan, blobFor) => this.prepareSmartRender(plan, blobFor),
    enable: (plan) => {
      this.smartPlan = plan?.encodeMatch ? plan : null;
    },
    beginEncodeRun: () => undefined,
    endEncodeRun: () => this.endEncodeRun(),
    copyRun: (source, start, end, outputStart) => this.copyRun(source, start, end, outputStart),
  };

  private smartPlan: SmartRenderPlan | null = null;
  private readonly sourceFiles = new NativeSourceFiles();
  private frameRate = 30;
  private runWaiter: { resolve: (frames: number) => void; reject: (error: Error) => void } | null = null;
  private readonly resolveOutputPath: () => string;
  embeddedCaptions: { tracks: number; warnings: string[] } | undefined;

  private width = 0;
  private height = 0;
  private timelineDurationSec = 0;
  /**
   * Colour-managed export (Rec.2020 working space or HDR): frames are converted to planar YCbCr in this
   * space here, in the renderer, and ffmpeg only tags and encodes them.
   */
  private colorOutput: { spec: OutputColorSpec; chroma: "420" | "444" } | null = null;

  private audioSampleRate = 48000;
  private audioChannelCount = 2;
  private audioHeaderWritten = false;
  private audioDataOffset = WAV_HEADER_BYTES;
  private audioFramesWritten = 0;

  private jobId: string | null = null;
  private port: MessagePort | null = null;
  private credits = 0;
  private creditWaiter: (() => void) | null = null;
  private bytesSent = 0;
  private failed = false;
  private aborted = false;
  private frameChain: Promise<void> = Promise.resolve();
  private readbackMsTotal = 0;
  private creditWaitMsTotal = 0;
  private frameCount = 0;

  private done: Promise<void> = Promise.resolve();
  private resolveDone: (() => void) | null = null;
  private rejectDone: ((reason: Error) => void) | null = null;

  private readback: OffscreenCanvas | null = null;
  private readbackCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(resolveOutputPath: () => string) {
    this.resolveOutputPath = resolveOutputPath;
  }

  getBytesWritten(): number {
    return this.bytesSent;
  }

  async start(
    settings: VideoExportSettings,
    project: Project,
  ): Promise<void> {
    const bridge = window.openreel;
    if (!bridge) {
      throw new Error("NativeFFmpegBackend requires the desktop bridge");
    }

    this.width = settings.width;
    this.height = settings.height;
    this.frameRate = snapFrameRate(settings.frameRate);
    this.timelineDurationSec = project.timeline.duration;
    this.audioSampleRate = settings.audioSettings.sampleRate;
    // Mono-track delivery: the WAV carries one channel per track (stereo mix on 1-2, then stems or silence).
    const monoTracks = broadcastAudioTrackCount(settings.broadcast);
    this.audioChannelCount = monoTracks || settings.audioSettings.channels;
    this.audioHeaderWritten = false;
    this.audioDataOffset = WAV_HEADER_BYTES;
    this.audioFramesWritten = 0;
    this.credits = 0;
    this.bytesSent = 0;
    this.failed = false;
    this.aborted = false;
    this.frameChain = Promise.resolve();
    this.readbackMsTotal = 0;
    this.creditWaitMsTotal = 0;
    this.frameCount = 0;

    this.colorOutput = await this.resolveColorOutput(settings, project);

    const smart = this.smartPlan?.encodeMatch ? this.smartPlan : null;
    const totalFrames = smart
      ? smart.totalFrames
      : Math.max(1, Math.ceil(this.timelineDurationSec * settings.frameRate));

    const outputPath = this.resolveOutputPath();
    if (!outputPath) {
      throw new Error("No output path resolved for native export");
    }

    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });

    const portPromise = this.awaitExportPort();
    // If the start request is refused, the port never arrives; its timeout must not surface as an unhandled rejection.
    portPromise.catch(() => undefined);

    this.embeddedCaptions = undefined;
    let captions: Array<{ kind: "mov_text" | "cea608"; data: string; language?: string }> | undefined;
    if (settings.captions) {
      const { planEmbeddedCaptions, subtitlesForRange } = await import(
        "@openreel/core/captions/caption-export"
      );
      const plan = planEmbeddedCaptions(
        subtitlesForRange(project.timeline.subtitles, settings.range),
        settings.captions,
        { format: settings.format, engine: "native", frameRate: settings.frameRate },
      );
      captions = plan.payloads.map((p) => ({ kind: p.kind === "cea608" ? "cea608" : "mov_text", data: p.data, language: p.language }));
      this.embeddedCaptions = { tracks: captions.length, warnings: plan.warnings };
    }

    const rateControl = effectiveRateControl(settings);
    const session = await bridge.export.start({
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      codec: settings.codec,
      format: settings.format,
      bitrateKbps: settings.bitrate,
      ...(rateControl !== "quality" ? { rateControl } : {}),
      ...(rateControl !== "quality" && settings.maxBitrate ? { maxBitrateKbps: settings.maxBitrate } : {}),
      outputPath,
      totalFrames,
      audioSampleRate: settings.audioSettings.sampleRate,
      audioChannels: monoTracks || settings.audioSettings.channels,
      encodeMode: settings.encodeMode ?? "balanced",
      ...(settings.encoderChoice && settings.encoderChoice !== "auto" ? { encoderChoice: settings.encoderChoice } : {}),
      quality: settings.quality,
      proresProfile: settings.proresProfile,
      ...(settings.codec === "dnxhr" ? { dnxhrProfile: settings.dnxhrProfile ?? "hq" } : {}),
      ...(exportWritesAlpha(settings) ? { alpha: true } : {}),
      keyframeInterval: settings.keyframeInterval,
      audioBitrateKbps: settings.audioSettings.bitrate,
      ...dolbyStartFields(settings),
      ...broadcastStartFields(settings),
      ...(this.colorOutput
        ? {
            color: {
              primaries: this.colorOutput.spec.primaries,
              transfer: this.colorOutput.spec.transfer,
              bitDepth: this.colorOutput.spec.bitDepth,
              chroma: this.colorOutput.chroma,
            },
          }
        : {}),
      ...(captions && captions.length ? { captions } : {}),
      ...(smart?.encodeMatch
        ? {
            smartRender: {
              match: {
                codec: smart.encodeMatch.codec,
                proresProfile: smart.encodeMatch.proresProfile,
                profile: smart.encodeMatch.profile,
                level: smart.encodeMatch.level,
                color: smart.encodeMatch.color,
                frameRate: settings.frameRate,
              },
            },
          }
        : {}),
    });

    const port = await portPromise;
    this.jobId = session.jobId;
    this.port = port;
    this.credits = 0;

    port.onmessage = (event: MessageEvent<ExportPortMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "credit":
          this.credits += message.credits ?? 0;
          this.wakeCreditWaiter();
          break;
        case "done":
          this.resolveDone?.();
          break;
        case "runDone":
          this.runWaiter?.resolve(message.frames ?? 0);
          this.runWaiter = null;
          break;
        case "error":
          this.failed = true;
          this.runWaiter?.reject(new Error(message.message ?? "Native export failed"));
          this.runWaiter = null;
          this.wakeCreditWaiter();
          this.rejectDone?.(
            new Error(message.message ?? "Native export failed"),
          );
          break;
        case "progress":
          break;
      }
    };
    port.start();
  }

  /**
   * The output colour space of this export, or null for the classic RGBA / BT.709 path. Checked here, before the
   * job starts, so a build without a 10-bit encoder fails with a message instead of waiting on a channel that
   * never opens.
   */
  private async resolveColorOutput(
    settings: VideoExportSettings,
    project: Project,
  ): Promise<{ spec: OutputColorSpec; chroma: "420" | "444" } | null> {
    const spec = outputColorForExport(project, settings.hdr);
    if (!spec) return null;
    const hdr = spec.transfer !== "bt709";
    const prores = settings.codec === "prores";
    if (hdr && settings.codec !== "h265" && !prores) {
      throw new Error("HDR export needs H.265 (HEVC Main10) or ProRes 4444 XQ.");
    }
    if (hdr) {
      const hardware = await window.openreel?.probeHardware?.().catch(() => null);
      const encoders = hardware?.encoders ?? [];
      const ok = prores ? encoders.includes("prores_ks") : encoders.includes("libx265") || encoders.includes("hevc_videotoolbox");
      if (!ok) {
        throw new Error(
          prores
            ? "This desktop build's ffmpeg has no prores_ks encoder, which HDR ProRes needs."
            : "This desktop build's ffmpeg has no 10-bit HEVC encoder (libx265 or hevc_videotoolbox), which HDR export needs.",
        );
      }
    }
    const chroma = prores ? "444" : "420";
    if (chroma === "420" && (settings.width % 2 !== 0 || settings.height % 2 !== 0)) {
      throw new Error("Colour-managed export needs even frame dimensions.");
    }
    return { spec: prores ? withBitDepth10(spec) : spec, chroma };
  }

  /**
   * Read the real format and colour of every file ffmpeg will copy from. The
   * re-encoded runs are tagged with exactly what those files decode as, so
   * they cannot shift colour at a copy/encode boundary; anything the encoder
   * cannot reproduce turns smart render off, with the reason.
   */
  private async prepareSmartRender(
    plan: SmartRenderPlan,
    blobFor: (mediaId: string) => Blob | undefined,
  ): Promise<{ plan: SmartRenderPlan } | { decline: string }> {
    const bridge = window.openreel;
    const match = plan.encodeMatch;
    if (!bridge?.export.probeSource || !match) {
      return { decline: "this build cannot verify the source files for smart render" };
    }
    const mediaIds = [...new Set(plan.segments.flatMap((segment) => (segment.kind === "copy" ? [segment.mediaId] : [])))];
    let color: { matrix?: string; transfer?: string; primaries?: string } | null = null;
    let colorKey = "";
    for (const mediaId of mediaIds) {
      const blob = blobFor(mediaId);
      if (!blob) return { decline: "a source file is no longer available" };
      // Hash the whole file in the background (cached per file identity); the first copy awaits it.
      this.fingerprintOf(blob).catch(() => undefined);
      let probe: Awaited<ReturnType<NonNullable<typeof bridge.export.probeSource>>>;
      try {
        probe = await bridge.export.probeSource((await this.sourceFiles.resolve(blob)).path);
      } catch {
        return { decline: "ffmpeg could not open a source file" };
      }
      if (!probe) return { decline: "ffmpeg could not read a source file" };
      const mismatch = nativeProbeMismatch(probe, match.codec);
      if (mismatch) return { decline: mismatch };
      const tags = { matrix: probe.color.matrix, transfer: probe.color.transfer, primaries: probe.color.primaries };
      const key = JSON.stringify(tags);
      if (color && key !== colorKey) return { decline: "sources carry different colour tags" };
      color = tags;
      colorKey = key;
    }
    return { plan: { ...plan, encodeMatch: { ...match, color: color ?? undefined } } };
  }

  private endEncodeRun(): Promise<void> {
    const port = this.port;
    if (!port) return Promise.reject(new Error("NativeFFmpegBackend not started"));
    return this.frameChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.runWaiter = { resolve: () => resolve(), reject };
          port.postMessage({ type: "endRun" });
        }),
    );
  }

  /**
   * Full-content fingerprint of a source. Core caches it per file identity (name, size, last-modified), so the
   * hash of a large file is paid once, not per export; prepareSmartRender starts it early so it runs under the
   * leading re-encoded segment instead of ahead of the first copy.
   */
  private fingerprintOf(blob: Blob): Promise<SourceFingerprint> {
    return fingerprintBlob(blob).catch((error) => {
      throw new Error(`SOURCE_CHANGED: the source file can no longer be read (${error instanceof Error ? error.message : String(error)})`);
    });
  }

  private async copyRun(source: Blob, start: number, end: number, outputStart: number): Promise<number> {
    const bridge = window.openreel;
    if (!bridge || !this.jobId) throw new Error("NativeFFmpegBackend not started");
    const jobId = this.jobId;
    const frames = Math.round((end - start) * this.frameRate);
    const outputStartFrame = Math.round(outputStart * this.frameRate);
    let file = await this.sourceFiles.resolve(source);
    // Size, modification time and a hash of every byte of the imported Blob: the main process refuses to copy from a file that differs.
    const fingerprint = await this.fingerprintOf(source);
    const run = () =>
      bridge.export.copyRun(jobId, {
        sourcePath: file.path,
        sourceStart: start,
        outputStartFrame,
        frames,
        sourceSize: source.size,
        sourceContentHash: fingerprint.contentHash,
        // A temp copy of an in-memory Blob has its own modification time.
        ...(!file.copied && fingerprint.mtimeMs !== undefined ? { sourceMtimeMs: fingerprint.mtimeMs } : {}),
      });
    try {
      return (await run()).frames;
    } catch (error) {
      // The file the media was imported from changed or vanished: copy the Blob instead.
      if (file.copied || !/SOURCE_CHANGED/.test(String(error))) throw error;
      file = await this.sourceFiles.resolve(source, true);
      return (await run()).frames;
    }
  }

  private awaitExportPort(): Promise<MessagePort> {
    return new Promise<MessagePort>((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("message", handler);
        reject(new Error("Timed out waiting for the native export channel"));
      }, 15000);

      const handler = (event: MessageEvent) => {
        const data = event.data as { __openreelExportPort?: boolean } | null;
        if (data?.__openreelExportPort && event.ports.length > 0) {
          clearTimeout(timeout);
          window.removeEventListener("message", handler);
          resolve(event.ports[0]);
        }
      };

      window.addEventListener("message", handler);
    });
  }

  async addAudioBuffer(buffer: AudioBuffer): Promise<void> {
    await this.ensureAudioHeader(buffer);
    const bridge = window.openreel;
    if (!bridge || !this.jobId) {
      throw new Error("NativeFFmpegBackend not started");
    }

    const pcm = encodeAudioBufferToPcm16(buffer, this.audioChannelCount);
    await bridge.export.writeAudioChunk(this.jobId, pcm, this.audioDataOffset);
    this.audioDataOffset += pcm.byteLength;
    this.audioFramesWritten += buffer.length;
  }

  async closeAudio(): Promise<void> {
    if (!this.jobId) {
      throw new Error("NativeFFmpegBackend not started");
    }
    const bridge = window.openreel;
    if (!bridge) {
      throw new Error("NativeFFmpegBackend requires the desktop bridge");
    }

    await this.ensureAudioHeader();
    if (this.audioFramesWritten === 0) {
      await this.writeSilentAudio();
    }

    await bridge.export.writeAudioChunk(
      this.jobId,
      buildWavHeader(
        this.audioFramesWritten,
        this.audioChannelCount,
        this.audioSampleRate,
      ),
      0,
    );
    await bridge.export.finishAudio(this.jobId);
  }

  addVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
  ): Promise<void> {
    // Serialise so concurrent callers post frames in call order and never
    // compete for the single credit waiter.
    const run = this.frameChain.then(() =>
      this.sendVideoFrame(frame, timestampSec),
    );
    this.frameChain = run.catch(() => undefined);
    return run;
  }

  private async sendVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
  ): Promise<void> {
    try {
      const port = this.port;
      if (!port) {
        throw new Error("NativeFFmpegBackend not started");
      }

      const waitStart = performance.now();
      await this.waitForFrameCredit();
      this.creditWaitMsTotal += performance.now() - waitStart;
      if (this.aborted) {
        throw new Error("Native export cancelled");
      }

      // Scene-referred HDR: the engine already encoded the float image to this export's planes, so the 8-bit
      // canvas read-back (which cannot hold highlights above SDR white) is skipped.
      const hdr = this.colorOutput ? this.hdrPlanes(frame, this.colorOutput) : null;
      const rgbaBuffer = hdr ? null : this.readbackFrame(frame);
      const rgba = hdr ?? (this.colorOutput ? this.convertFrame(rgbaBuffer!, this.colorOutput) : rgbaBuffer!);
      this.frameCount += 1;
      this.credits -= 1;
      this.bytesSent += rgba.byteLength;

      // The renderer<->MessagePortMain bridge does not deliver a message whose
      // payload is sent in the transfer list (it arrives as null on the main
      // side), so the RGBA buffer is structured-cloned rather than transferred.
      port.postMessage({ type: "frame", ts: timestampSec, buffer: rgba });
    } finally {
      frame.close();
    }
  }

  /** The float-derived planes the engine rendered with this frame, when they match what this export sends. */
  private hdrPlanes(frame: ImageBitmap, color: { spec: OutputColorSpec; chroma: "420" | "444" }): ArrayBuffer | null {
    const payload = takeHdrPayload(frame);
    if (!payload) return null;
    const { yuv, spec } = payload;
    const format = color.chroma === "444" ? "I444P10" : color.spec.bitDepth === 10 ? "I420P10" : "I420";
    if (yuv.format !== format || spec.bitDepth !== color.spec.bitDepth || spec.transfer !== color.spec.transfer) return null;
    if (yuv.width !== this.width || yuv.height !== this.height) return null;
    return yuv.data.buffer.slice(yuv.data.byteOffset, yuv.data.byteOffset + yuv.data.byteLength) as ArrayBuffer;
  }

  /** RGBA (sRGB code values) to the planar YCbCr the colour-managed ffmpeg pipe expects. */
  private convertFrame(rgba: ArrayBuffer, color: { spec: OutputColorSpec; chroma: "420" | "444" }): ArrayBuffer {
    const pixels = new Uint8ClampedArray(rgba);
    const yuv =
      color.chroma === "444"
        ? rgbaToYuv444(pixels, this.width, this.height, color.spec)
        : rgbaToYuv420(pixels, this.width, this.height, color.spec);
    return yuv.data.buffer as ArrayBuffer;
  }

  async finalize(): Promise<void> {
    if (!this.port) {
      throw new Error("NativeFFmpegBackend not started");
    }
    this.port.postMessage({ type: "finish" });
    try {
      await this.done;
      if (this.frameCount > 0) {
        console.info(
          `[export] frames=${this.frameCount} ` +
            `readback=${(this.readbackMsTotal / this.frameCount).toFixed(1)}ms/f ` +
            `creditWait=${(this.creditWaitMsTotal / this.frameCount).toFixed(1)}ms/f ` +
            `bytes=${this.bytesSent}`,
        );
      }
    } finally {
      this.releaseReadbackBuffers();
      this.smartPlan = null;
      this.colorOutput = null;
      await this.sourceFiles.release();
    }
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.runWaiter?.reject(new Error("Native export cancelled"));
    this.runWaiter = null;
    this.smartPlan = null;
    this.wakeCreditWaiter();
    if (this.jobId && window.openreel) {
      await window.openreel.export.cancel(this.jobId);
    }
    this.releaseReadbackBuffers();
    await this.sourceFiles.release();
  }

  private wakeCreditWaiter(): void {
    const waiter = this.creditWaiter;
    this.creditWaiter = null;
    waiter?.();
  }

  private async waitForFrameCredit(): Promise<void> {
    while (this.credits <= 0) {
      if (this.failed || this.aborted) {
        throw new Error(
          this.aborted ? "Native export cancelled" : "Native export failed",
        );
      }
      await new Promise<void>((resolve) => {
        this.creditWaiter = resolve;
      });
    }
  }

  private readbackFrame(frame: ImageBitmap): ArrayBuffer {
    if (!this.readback || !this.readbackCtx) {
      this.readback = new OffscreenCanvas(this.width, this.height);
      const ctx = this.readback.getContext("2d", {
        willReadFrequently: true,
      });
      if (!ctx) {
        throw new Error("Failed to acquire 2D context for frame readback");
      }
      this.readbackCtx = ctx;
    }

    this.readbackCtx.clearRect(0, 0, this.width, this.height);
    const readStart = performance.now();
    this.readbackCtx.drawImage(frame, 0, 0);
    const imageData = this.readbackCtx.getImageData(
      0,
      0,
      this.width,
      this.height,
    );
    this.readbackMsTotal += performance.now() - readStart;
    const { data } = imageData;
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      return data.buffer as ArrayBuffer;
    }
    return data.slice().buffer as ArrayBuffer;
  }

  private async ensureAudioHeader(buffer?: AudioBuffer): Promise<void> {
    if (buffer && this.audioFramesWritten === 0) {
      this.audioSampleRate = buffer.sampleRate;
      this.audioChannelCount = Math.max(1, buffer.numberOfChannels);
    }
    if (this.audioHeaderWritten) return;

    const bridge = window.openreel;
    if (!bridge || !this.jobId) {
      throw new Error("NativeFFmpegBackend not started");
    }

    await bridge.export.writeAudioChunk(
      this.jobId,
      buildWavHeader(0, this.audioChannelCount, this.audioSampleRate),
      0,
    );
    this.audioHeaderWritten = true;
  }

  private async writeSilentAudio(): Promise<void> {
    const bridge = window.openreel;
    if (!bridge || !this.jobId) {
      throw new Error("NativeFFmpegBackend not started");
    }

    const totalFrames = Math.max(
      1,
      Math.ceil(this.timelineDurationSec * this.audioSampleRate),
    );
    const maxChunkFrames = Math.max(1, this.audioSampleRate);
    let remaining = totalFrames;

    while (remaining > 0) {
      const frames = Math.min(maxChunkFrames, remaining);
      const silence = new ArrayBuffer(
        frames * this.audioChannelCount * BYTES_PER_SAMPLE,
      );
      await bridge.export.writeAudioChunk(this.jobId, silence, this.audioDataOffset);
      this.audioDataOffset += silence.byteLength;
      this.audioFramesWritten += frames;
      remaining -= frames;
    }
  }

  private releaseReadbackBuffers(): void {
    if (this.readback) {
      this.readback.width = 0;
      this.readback.height = 0;
    }
    this.readback = null;
    this.readbackCtx = null;
  }
}
