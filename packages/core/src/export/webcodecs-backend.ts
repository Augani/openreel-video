import {
  HDR_HEVC_CODEC_STRING,
  outputColorForExport,
  rgbaToYuv420,
  toVideoColorSpace,
  type OutputColorSpec,
} from "./color-output";
import { rgbaToI420Bt709 } from "./yuv420-sdr";
import { isSoftwareGpuAdapter } from "../video/renderer-factory";
import { takeHdrPayload } from "../color/hdr-payload";
import { CODEC_MAP, type VideoExportSettings, type ExportError } from "./types";
import type { Project } from "../types/project";
import type { EncoderBackend, SmartRenderMuxer } from "./encoder-backend";
import { descriptionBytes, parameterSetKey, parseAvcC, prependParameterSets, repairEncoderAvcConfig, type AvcParameterSets } from "./avc-config";
import { browserAudioCodec } from "./browser-audio-codec";
import { getAacEncoderPriming } from "./audio-priming";
import { DOLBY_VIDEO_DESKTOP_ONLY_REASON, isDolbyFormat } from "./dolby";
import { applyMp4AudioTiming, applyMovChannelLayout } from "./mp4-audio-timing";
import { isVrProperties, normalizeVrProperties, type VrProperties } from "../vr/vr-properties";
import { CHAN_TAG_MPEG_5_1_A } from "./surround-export";
import { reorderChannels, resolveAacSurroundOrder } from "./aac-surround-order";
import { trackHasAudioItems } from "../timeline/timeline-items";
import { planEmbeddedCaptions, subtitlesForRange } from "../captions/caption-export";

type MediaBunnyModule = typeof import("mediabunny");
type AudioBufferSourceInstance = InstanceType<MediaBunnyModule["AudioBufferSource"]>;
type VideoSampleSourceInstance = InstanceType<MediaBunnyModule["VideoSampleSource"]>;
type OutputInstance = InstanceType<MediaBunnyModule["Output"]>;
type PacketSourceInstance = InstanceType<MediaBunnyModule["EncodedVideoPacketSource"]>;
type EncodedPacketInstance = InstanceType<MediaBunnyModule["EncodedPacket"]>;
type HardwarePreference = "prefer-hardware" | "prefer-software" | "no-preference";
type VideoCodecName = Parameters<
  MediaBunnyModule["getFirstEncodableVideoCodec"]
>[0][number];

interface WebCodecsBackendOptions {
  hardwareAcceleration?: HardwarePreference;
  /** An explicit Hardware or Software choice: never retry with no-preference, fail instead of silently switching encoder kind. */
  strictHardwareAcceleration?: boolean;
  videoCodecs?: VideoCodecName[];
  // The resolution clamp (export-engine) exists to bound browser-tab memory.
  // On desktop, frames stream to disk one at a time and the hardware encoder
  // handles high resolutions, so callers can opt out to export at full size.
  clampResolution?: boolean;
}

export class WebCodecsBackend implements EncoderBackend {
  readonly requiresWebCodecsClamping: boolean;
  readonly needsFrameThrottling = true;
  readonly normalizesProResToH264 = true;
  readonly audioBeforeVideo = true;

  private readonly mediabunny: MediaBunnyModule;
  private readonly hardwareAcceleration: HardwarePreference;
  private readonly strictHardwareAcceleration: boolean;
  private readonly videoCodecPreference?: VideoCodecName[];
  private output: OutputInstance | null = null;
  private videoSource: VideoSampleSourceInstance | null = null;
  private audioSource: AudioBufferSourceInstance | null = null;
  private writableStream: FileSystemWritableFileStream | null = null;
  private bytesWritten = 0;
  private audioPriming: number | null = null;
  private audioFrameCount = 0;
  private audioSampleRate = 0;
  /** QuickTime movies with six audio channels get a `chan` atom naming the L R C LFE Ls Rs layout. */
  private tagMovChannelLayout = false;
  /** Six-channel AAC: the channel order the browser's encoder reads (see aac-surround-order.ts). Null = pass buffers through. */
  private aacInputOrder: readonly number[] | null = null;
  private chapterMarkers: Project["timeline"]["markers"] = [];
  private chapterRange: VideoExportSettings["range"];
  private movieMetadata: { bytes: Uint8Array; position: number } | null = null;
  /** VR sequence in an MP4 / MOV: the trailing moov gets st3d / sv3d spherical metadata so players treat the file as 360. */
  private sphericalVr: VrProperties | null = null;
  private submittedVideoFrames = 0;
  private encodedVideoFrames = 0;
  private readonly pendingFrameReleases = new Set<() => void>();
  private captionTracks: Array<{ source: InstanceType<MediaBunnyModule["TextSubtitleSource"]>; text: string }> = [];
  embeddedCaptions: { tracks: number; warnings: string[] } | undefined;

  // Smart render: the video track is fed by an EncodedVideoPacketSource that
  // alternates between source packets (copy runs) and our own VideoEncoder
  // output (encode runs). Each run announces its SPS/PPS in-band when they
  // differ from the previous run's, so one avcC in the container is enough.
  private smartEnabled = false;
  private packetSource: PacketSourceInstance | null = null;
  private settings: VideoExportSettings | null = null;
  /** Non-null when the export converts to and tags a BT.2020 / HDR colour space (see color-output.ts). */
  private outputColor: OutputColorSpec | null = null;
  private useCpuFrames = false;
  private colorCanvas: OffscreenCanvas | null = null;
  private encoder: VideoEncoder | null = null;
  private encoderOpening: Promise<void> | null = null;
  private forceKeyFrame = false;
  private runNeedsParams = false;
  private runFrames = 0;
  private runPackets = 0;
  private activeParamKey: string | null = null;
  /** Parameter sets the muxer's avcC describes (the first run's); a seek into any other run needs them in-band. */
  private fileParamKey: string | null = null;
  private runSets: AvcParameterSets | null = null;
  private runParamKey: string | null = null;
  private metaSent = false;
  private packetChain: Promise<void> = Promise.resolve();
  private packetError: unknown = null;

  readonly smartRender: SmartRenderMuxer = {
    enable: () => { this.smartEnabled = true; },
    beginEncodeRun: () => {
      this.forceKeyFrame = true;
      this.runNeedsParams = true;
      this.runSets = null;
      this.runParamKey = null;
      this.runFrames = 0;
      this.runPackets = 0;
    },
    endEncodeRun: () => this.endEncodeRun(),
    copyRun: (source, start, end, outputStart) => this.copyRun(source, start, end, outputStart),
  };

  constructor(mediabunny: MediaBunnyModule, options?: WebCodecsBackendOptions) {
    this.mediabunny = mediabunny;
    this.hardwareAcceleration = options?.hardwareAcceleration ?? "prefer-hardware";
    this.strictHardwareAcceleration = options?.strictHardwareAcceleration === true;
    this.videoCodecPreference = options?.videoCodecs;
    this.requiresWebCodecsClamping = options?.clampResolution ?? true;
  }

  getBytesWritten(): number {
    return this.bytesWritten;
  }

  async start(
    settings: VideoExportSettings,
    project: Project,
    writableStream?: FileSystemWritableFileStream,
  ): Promise<void> {
    if (!writableStream) {
      throw new Error("No writable stream provided. Export requires a file destination.");
    }
    if (settings.format === "mkv") throw new Error("MKV export needs the desktop app. Choose MP4, MOV or WebM.");
    if (isDolbyFormat(settings.audioSettings.format)) throw new Error(DOLBY_VIDEO_DESKTOP_ONLY_REASON);

    const {
      Output,
      StreamTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      MovOutputFormat,
      VideoSampleSource,
      AudioBufferSource,
      getFirstEncodableVideoCodec,
      QUALITY_MEDIUM,
    } = this.mediabunny;

    this.writableStream = writableStream;
    const diskWriter = writableStream;
    const self = this;
    const chunkWriter = new WritableStream<{ data: Uint8Array; position: number }>({
      async write(chunk) {
        await diskWriter.seek(chunk.position);
        await diskWriter.write(chunk.data as unknown as FileSystemWriteChunkType);
        self.bytesWritten += chunk.data.byteLength;
      },
    });

    this.audioPriming = null;
    this.audioFrameCount = 0;
    this.audioSampleRate = settings.audioSettings.sampleRate;
    this.tagMovChannelLayout = settings.format === "mov" && settings.audioSettings.channels === 6;
    this.movieMetadata = null;
    this.chapterMarkers = settings.embedChapters && (settings.format === "mp4" || settings.format === "mov")
      ? project.timeline.markers.filter((marker) => marker.kind === "chapter") : [];
    this.chapterRange = settings.range;
    this.sphericalVr = (settings.format === "mp4" || settings.format === "mov") && isVrProperties(project.settings.vr) ? normalizeVrProperties(project.settings.vr) : null;
    this.submittedVideoFrames = 0;
    this.encodedVideoFrames = 0;
    const captureMovie = (bytes: Uint8Array, position: number) => { this.movieMetadata = { bytes, position }; };
    let outputFormat;
    switch (settings.format) {
      case "webm":
        outputFormat = new WebMOutputFormat();
        break;
      case "mov":
        outputFormat = new MovOutputFormat({ fastStart: false, onMoov: captureMovie });
        break;
      case "mp4":
      default:
        outputFormat = new Mp4OutputFormat({ fastStart: false, onMoov: captureMovie });
        break;
    }

    const target = new StreamTarget(chunkWriter, {
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
    });
    const output = new Output({ format: outputFormat, target });

    const supportedVideoCodecs = outputFormat.getSupportedVideoCodecs();
    const requestedVideoCodec = (CODEC_MAP as Record<string, string | undefined>)[settings.codec] as VideoCodecName | undefined;
    const requestedVideoCodecs =
      this.videoCodecPreference ?? (requestedVideoCodec ? [requestedVideoCodec] : []);
    const preferredVideoCodecs = requestedVideoCodecs.filter((codec) =>
      supportedVideoCodecs.includes(codec),
    );
    const videoCodecCandidates = preferredVideoCodecs;
    const targetVideoBitrate = settings.bitrate ? settings.bitrate * 1000 : QUALITY_MEDIUM;
    const hardwarePreferences: HardwarePreference[] =
      this.hardwareAcceleration === "no-preference"
        ? ["no-preference"]
        : this.strictHardwareAcceleration
          ? [this.hardwareAcceleration]
          : [this.hardwareAcceleration, "no-preference"];
    let selectedHardwareAcceleration: HardwarePreference = "no-preference";
    let videoCodec: VideoCodecName | null = null;

    for (const hardwareAcceleration of hardwarePreferences) {
      const encodeOptions = {
        width: settings.width,
        height: settings.height,
        bitrate: targetVideoBitrate,
        hardwareAcceleration,
        bitrateMode: settings.bitrateMode === "cbr" ? "constant" : "variable",
      } as unknown as Parameters<typeof getFirstEncodableVideoCodec>[1];
      videoCodec = await getFirstEncodableVideoCodec(videoCodecCandidates, encodeOptions);
      // getFirstEncodableVideoCodec only checks dimensions/bitrate in 1.25.
      // Check the acceleration hint separately before committing to it.
      if (videoCodec && this.mediabunny.canEncodeVideo && !(await this.mediabunny.canEncodeVideo(videoCodec, encodeOptions))) videoCodec = null;
      if (videoCodec) {
        selectedHardwareAcceleration = hardwareAcceleration;
        break;
      }
    }

    if (!videoCodec) {
      const error: ExportError = {
        code: "UNSUPPORTED_CODEC",
        message: `This browser cannot encode ${settings.codec.toUpperCase()} in ${settings.format.toUpperCase()} at ${settings.width}×${settings.height}. Try H.264 / MP4 or VP9 / WebM.`,
        phase: "preparing",
        recoverable: false,
      };
      throw error;
    }

    const hasAudio = project.timeline.tracks.some((track) => trackHasAudioItems(project, track.id));
    const audioCodecResult = hasAudio
      ? await browserAudioCodec(this.mediabunny, settings, outputFormat.getSupportedAudioCodecs())
      : null;
    if (hasAudio && !audioCodecResult) {
      throw { code: "UNSUPPORTED_CODEC", message: `Cannot encode audio for ${settings.format.toUpperCase()} with these settings.`, phase: "preparing", recoverable: true } satisfies ExportError;
    }

    if (audioCodecResult?.codec === "aac" && settings.format !== "webm") {
      // The bundled FFmpeg AAC-LC encoder primes one 1024-sample frame. It
      // accepts standard PCM channel order even on systems with no AAC decoder.
      this.audioPriming = audioCodecResult.softwareAac ? 1024 : await getAacEncoderPriming(this.mediabunny, {
        sampleRate: settings.audioSettings.sampleRate,
        channels: settings.audioSettings.channels,
        bitrate: audioCodecResult.bitrate,
      });
    }

    this.aacInputOrder = audioCodecResult?.codec === "aac" && !audioCodecResult.softwareAac && settings.audioSettings.channels === 6
      ? await resolveAacSurroundOrder(this.mediabunny, settings.audioSettings.sampleRate, audioCodecResult.bitrate)
      : null;

    // WebKit's quality encoder can buffer more frames than its message queue
    // accepts, deadlocking before the first packet. Realtime avoids that queue
    // deadlock; finalization still requires a packet for every submitted frame.
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const isWebKit = /AppleWebKit\//.test(userAgent) && !/(?:Chrome|Chromium|Edg)\//.test(userAgent);
    this.settings = settings;
    this.metaSent = false;
    this.activeParamKey = null;
    this.fileParamKey = null;
    this.runSets = null;
    this.runParamKey = null;
    this.packetError = null;
    this.packetChain = Promise.resolve();
    if (this.smartEnabled && videoCodec !== "avc") {
      throw { code: "UNSUPPORTED_CODEC", message: "Smart render needs H.264 output.", phase: "preparing", recoverable: false } satisfies ExportError;
    }
    const adapter = await globalThis.navigator?.gpu?.requestAdapter?.({ powerPreference: "high-performance" }).catch(() => null);
    this.useCpuFrames = !!adapter && isSoftwareGpuAdapter(adapter);
    this.outputColor = outputColorForExport(project, settings.hdr);
    if (this.outputColor && this.smartEnabled) {
      throw { code: "INVALID_SETTINGS", message: "Smart render copies untagged source packets, so it cannot be combined with Rec.2020 or HDR output.", phase: "preparing", recoverable: false } satisfies ExportError;
    }
    const isHdr = this.outputColor?.bitDepth === 10;
    if (isHdr) {
      if (videoCodec !== "hevc" || settings.format === "webm") {
        throw { code: "UNSUPPORTED_CODEC", message: "HDR (PQ or HLG) export needs H.265 in an MP4 or MOV container.", phase: "preparing", recoverable: false } satisfies ExportError;
      }
      const hdrSupport = await VideoEncoder.isConfigSupported({
        codec: HDR_HEVC_CODEC_STRING,
        width: settings.width,
        height: settings.height,
        bitrate: typeof targetVideoBitrate === "number" ? targetVideoBitrate : 20_000_000,
        framerate: settings.frameRate,
        hardwareAcceleration: selectedHardwareAcceleration,
      }).catch(() => ({ supported: false }));
      if (!hdrSupport.supported) {
        throw { code: "UNSUPPORTED_CODEC", message: "This browser cannot encode 10-bit HEVC (H.265 Main10) at the export size, which HDR files need.", phase: "preparing", recoverable: false } satisfies ExportError;
      }
    }
    if (this.outputColor && (settings.width % 2 !== 0 || settings.height % 2 !== 0)) {
      throw { code: "INVALID_SETTINGS", message: "Rec.2020 and HDR export need an even width and height.", phase: "preparing", recoverable: false } satisfies ExportError;
    }
    const outputColor = this.outputColor;
    const videoSource = this.smartEnabled ? null : new VideoSampleSource({
      codec: videoCodec,
      bitrate: targetVideoBitrate,
      keyFrameInterval: settings.keyframeInterval / settings.frameRate,
      hardwareAcceleration: selectedHardwareAcceleration,
      bitrateMode: settings.bitrateMode === "cbr" ? "constant" : "variable",
      latencyMode: isWebKit ? "realtime" : "quality",
      ...(isHdr ? { fullCodecString: HDR_HEVC_CODEC_STRING } : {}),
      onEncodedPacket: (_packet, meta) => {
        repairEncoderAvcConfig(meta);
        this.encodedVideoFrames++;
        // The container's colr box is written from the first packet's decoder config.
        if (outputColor && meta?.decoderConfig) {
          (meta.decoderConfig as { colorSpace?: unknown }).colorSpace = toVideoColorSpace(outputColor);
        }
      },
    });
    const packetSource = this.smartEnabled ? new this.mediabunny.EncodedVideoPacketSource("avc") : null;
    const audioSource = audioCodecResult ? new AudioBufferSource({
      codec: audioCodecResult.codec,
      ...(audioCodecResult.codec === "aac" ? { fullCodecString: "mp4a.40.2" } : {}),
      bitrate: audioCodecResult.bitrate,
    }) : null;
    output.addVideoTrack((videoSource ?? packetSource)!);
    if (audioSource) output.addAudioTrack(audioSource);
    this.captionTracks = [];
    this.embeddedCaptions = undefined;
    if (settings.captions) {
      const plan = planEmbeddedCaptions(
        subtitlesForRange(project.timeline.subtitles, settings.range),
        settings.captions,
        {
          format: settings.format,
          engine: "web",
          frameRate: settings.frameRate,
          webSubtitleCodecs: outputFormat.getSupportedSubtitleCodecs(),
        },
      );
      for (const payload of plan.payloads) {
        const source = new this.mediabunny.TextSubtitleSource("webvtt");
        output.addSubtitleTrack(source, { languageCode: payload.language });
        this.captionTracks.push({ source, text: payload.data });
      }
      this.embeddedCaptions = { tracks: this.captionTracks.length, warnings: plan.warnings };
    }
    output.setMetadataTags({
      title: project.name,
      date: new Date(),
    });

    this.output = output;
    this.videoSource = videoSource;
    this.packetSource = packetSource;
    this.audioSource = audioSource;
    await output.start();
    for (const track of this.captionTracks) {
      await track.source.add(track.text);
      track.source.close();
    }
  }

  async addAudioBuffer(buffer: AudioBuffer): Promise<void> {
    if (!this.audioSource) return;
    const order = this.aacInputOrder;
    if (order && buffer.numberOfChannels === order.length) {
      const channels = reorderChannels(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), order);
      const reordered = new AudioBuffer({ length: buffer.length, numberOfChannels: channels.length, sampleRate: buffer.sampleRate });
      channels.forEach((data, c) => reordered.copyToChannel(data as Float32Array<ArrayBuffer>, c));
      await this.audioSource.add(reordered);
      this.audioFrameCount += buffer.length;
      return;
    }
    await this.audioSource.add(buffer);
    this.audioFrameCount += buffer.length;
  }

  async closeAudio(): Promise<void> {
    this.audioSource?.close();
  }

  /**
   * Converts the rendered frame to planar YCbCr in the output colour space and
   * wraps it as an already-tagged sample, so the encoder never applies its own
   * (BT.709) RGB conversion to it.
   */
  private toColorManagedSample(
    frame: ImageBitmap,
    timestampSec: number,
    durationSec: number,
    spec: OutputColorSpec,
  ) {
    const { VideoSample } = this.mediabunny;
    // Scene-referred HDR: the engine already encoded the float image (highlights above SDR white intact).
    const payload = takeHdrPayload(frame);
    const wanted = spec.bitDepth === 10 ? "I420P10" : "I420";
    if (payload && payload.yuv.format === wanted && payload.spec.transfer === spec.transfer && payload.yuv.width === frame.width) {
      return new VideoSample(payload.yuv.data, {
        format: payload.yuv.format as VideoPixelFormat,
        codedWidth: payload.yuv.width,
        codedHeight: payload.yuv.height,
        timestamp: timestampSec,
        duration: durationSec,
        colorSpace: toVideoColorSpace(spec) as unknown as VideoColorSpaceInit,
      });
    }
    const pixels = this.readPixels(frame);
    const yuv = rgbaToYuv420(pixels.data, frame.width, frame.height, spec);
    return new VideoSample(yuv.data, {
      format: yuv.format as VideoPixelFormat,
      codedWidth: yuv.width,
      codedHeight: yuv.height,
      timestamp: timestampSec,
      duration: durationSec,
      // TypeScript's DOM lib predates the "bt2020-ncl" matrix and "pq"/"hlg" transfers browsers accept.
      colorSpace: toVideoColorSpace(spec) as unknown as VideoColorSpaceInit,
    });
  }

  private readPixels(frame: ImageBitmap): ImageData {
    if (!this.colorCanvas || this.colorCanvas.width !== frame.width || this.colorCanvas.height !== frame.height) {
      this.colorCanvas = new OffscreenCanvas(frame.width, frame.height);
    }
    const ctx = this.colorCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not read the frame for colour conversion.");
    ctx.clearRect(0, 0, frame.width, frame.height);
    ctx.drawImage(frame, 0, 0);
    return ctx.getImageData(0, 0, frame.width, frame.height);
  }

  private softwareFrame(frame: ImageBitmap, timestampSec: number, durationSec: number): VideoFrame {
    // SwiftShader can leave GPU-backed input stuck in the WebCodecs queue. A
    // CPU-backed frame also lets the social presets retain limited-range 4:2:0.
    const pixels = this.readPixels(frame);
    const init = { codedWidth: frame.width, codedHeight: frame.height, timestamp: Math.round(timestampSec * 1e6), duration: Math.round(durationSec * 1e6) };
    if (frame.width % 2 || frame.height % 2) return new VideoFrame(pixels.data, { ...init, format: "RGBA" });
    return new VideoFrame(rgbaToI420Bt709(pixels.data, frame.width, frame.height), {
      ...init, format: "I420", colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
    });
  }

  async addVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
    durationSec: number,
  ): Promise<void> {
    if (this.smartEnabled) return this.addSmartFrame(frame, timestampSec, durationSec);
    if (!this.videoSource) {
      throw new Error("Encoder backend not started");
    }
    const { VideoSample } = this.mediabunny;
    const videoSample = this.outputColor
      ? this.toColorManagedSample(frame, timestampSec, durationSec, this.outputColor)
      : this.useCpuFrames
        ? new VideoSample(this.softwareFrame(frame, timestampSec, durationSec))
        : new VideoSample(frame, { timestamp: timestampSec, duration: durationSec });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      videoSample.close();
      frame.close();
      this.pendingFrameReleases.delete(release);
    };
    this.pendingFrameReleases.add(release);

    try {
      await this.videoSource.add(videoSample);
      this.submittedVideoFrames++;
    } finally {
      release();
    }
  }

  async finalize(): Promise<void> {
    this.videoSource?.close();
    if (this.smartEnabled) {
      await this.packetChain;
      if (this.packetError) throw this.packetError;
      this.packetSource?.close();
    }
    await this.output?.finalize();
    if (!this.smartEnabled && this.encodedVideoFrames !== this.submittedVideoFrames) {
      throw new Error(`The video encoder produced ${this.encodedVideoFrames} of ${this.submittedVideoFrames} frames. Retry with a lower resolution or a different codec.`);
    }
    const patchAudio = (this.audioPriming !== null || this.tagMovChannelLayout) && this.audioFrameCount > 0;
    if (patchAudio || this.sphericalVr || this.chapterMarkers.length) {
      if (!this.movieMetadata || !this.writableStream) throw new Error("MP4 movie metadata was not written.");
      const { bytes, position } = this.movieMetadata;
      let corrected = patchAudio && this.audioPriming !== null
        ? applyMp4AudioTiming(bytes, this.audioPriming, this.audioSampleRate, this.audioFrameCount)
        : bytes;
      if (patchAudio && this.tagMovChannelLayout) corrected = applyMovChannelLayout(corrected, CHAN_TAG_MPEG_5_1_A);
      // The moov trails the media data (fastStart: false), so growing it moves no sample.
      if (this.sphericalVr) {
        const { applySphericalToMoov } = await import("./spherical-metadata");
        corrected = applySphericalToMoov(corrected, this.sphericalVr);
      }
      const chunks = this.chapterMarkers.length
        ? (await import("./mp4-chapters")).addChapterTrack(corrected, position, this.chapterMarkers, this.chapterRange)
        : [corrected];
      await this.writableStream.seek(position);
      for (const chunk of chunks) {
        await this.writableStream.write(chunk as unknown as FileSystemWriteChunkType);
        this.bytesWritten += chunk.byteLength;
      }
    }
    await this.writableStream?.close();
  }

  async abort(): Promise<void> {
    for (const release of this.pendingFrameReleases) release();
    // Output.cancel force-closes each attached source. A subsequent source.close
    // asks WebCodecs to flush that already-closed encoder.
    try { await this.output?.cancel(); } catch {}
    try { if (this.encoder && this.encoder.state !== "closed") this.encoder.close(); } catch {}
    this.encoder = null;
    try {
      await this.writableStream?.abort();
    } catch {}
  }


  /** Chain one packet into the track; resolves when it is muxed (backpressure). */
  private enqueuePacket(
    packet: EncodedPacketInstance,
    sets: AvcParameterSets | null,
    meta: EncodedVideoChunkMetadata | undefined,
  ): Promise<void> {
    const { EncodedPacket } = this.mediabunny;
    this.packetChain = this.packetChain
      .then(async () => {
        if (this.packetError) return;
        let out = packet;
        let prepended = false;
        if (sets && this.runNeedsParams) {
          this.runNeedsParams = false;
          const key = parameterSetKey(sets);
          if (this.activeParamKey === null) this.activeParamKey = key;
          else if (key !== this.activeParamKey) {
            out = new EncodedPacket(prependParameterSets(packet.data, sets), packet.type, packet.timestamp, packet.duration);
            this.activeParamKey = key;
            prepended = true;
          }
        }
        if (sets) {
          this.runSets = sets;
          this.runParamKey = parameterSetKey(sets);
          this.fileParamKey ??= this.runParamKey;
        }
        // Every key frame of a run whose parameter sets differ from the file's avcC carries them
        // in-band, so a player that seeks into the middle of the run (not only one that plays
        // through its first key frame) decodes it with the right SPS/PPS.
        if (!prepended && packet.type === "key" && this.runSets && this.runParamKey !== this.fileParamKey) {
          out = new EncodedPacket(prependParameterSets(packet.data, this.runSets), packet.type, packet.timestamp, packet.duration);
        }
        let sendMeta: EncodedVideoChunkMetadata | undefined;
        if (!this.metaSent) {
          if (!meta?.decoderConfig) throw new Error("The first video packet carried no decoder configuration.");
          sendMeta = meta;
          this.metaSent = true;
        }
        await this.packetSource!.add(out, sendMeta);
      })
      .catch((error: unknown) => { this.packetError ??= error; });
    return this.packetChain;
  }

  private async openEncoder(): Promise<void> {
    const settings = this.settings!;
    const bitrate = settings.bitrate ? settings.bitrate * 1000 : 5_000_000;
    const area = settings.width * settings.height;
    const level = area <= 414_720 ? "1e" : area <= 921_600 ? "1f" : area <= 2_097_152 ? "28" : area <= 8_912_896 ? "33" : "34";
    const codecs = [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`];
    const preferences: HardwarePreference[] =
      this.hardwareAcceleration === "no-preference"
        ? ["no-preference"]
        : this.strictHardwareAcceleration
          ? [this.hardwareAcceleration]
          : [this.hardwareAcceleration, "no-preference"];
    let chosen: VideoEncoderConfig | null = null;
    for (const hardwareAcceleration of preferences) {
      for (const codec of codecs) {
        const config: VideoEncoderConfig = {
          codec,
          width: settings.width,
          height: settings.height,
          bitrate,
          framerate: settings.frameRate,
          hardwareAcceleration,
          bitrateMode: settings.bitrateMode === "cbr" ? "constant" : "variable",
          latencyMode: "quality",
          avc: { format: "avc" },
        };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) { chosen = support.config ?? config; break; }
        } catch { /* try the next candidate */ }
      }
      if (chosen) break;
    }
    if (!chosen) throw new Error("This browser cannot encode H.264 at the export size for a smart render.");
    const { EncodedPacket } = this.mediabunny;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const packet = new EncodedPacket(data, chunk.type === "key" ? "key" : "delta", chunk.timestamp / 1e6, (chunk.duration ?? 0) / 1e6);
        repairEncoderAvcConfig(meta);
        const description = meta?.decoderConfig?.description;
        const sets = description
          ? parseAvcC(descriptionBytes(description))
          : null;
        this.runPackets++;
        void this.enqueuePacket(packet, sets, meta);
      },
      error: (error) => { this.packetError ??= error; },
    });
    encoder.configure(chosen);
    this.encoder = encoder;
  }

  private async addSmartFrame(frame: ImageBitmap, timestampSec: number, durationSec: number): Promise<void> {
    try {
      if (this.packetError) throw this.packetError;
      if (!this.encoder) {
        this.encoderOpening ??= this.openEncoder().finally(() => { this.encoderOpening = null; });
        await this.encoderOpening;
      }
      const encoder = this.encoder!;
      while (encoder.encodeQueueSize > 8) await new Promise((resolve) => setTimeout(resolve, 1));
      const videoFrame = this.useCpuFrames
        ? this.softwareFrame(frame, timestampSec, durationSec)
        : new VideoFrame(frame, { timestamp: Math.round(timestampSec * 1e6), duration: Math.round(durationSec * 1e6) });
      try {
        encoder.encode(videoFrame, { keyFrame: this.forceKeyFrame });
        this.forceKeyFrame = false;
        this.runFrames++;
      } finally {
        videoFrame.close();
      }
    } finally {
      frame.close();
    }
  }

  private async endEncodeRun(): Promise<void> {
    const encoder = this.encoder;
    if (!encoder) return;
    this.encoder = null;
    try {
      await encoder.flush();
    } finally {
      try { if (encoder.state !== "closed") encoder.close(); } catch {}
    }
    await this.packetChain;
    if (this.packetError) throw this.packetError;
    if (this.runPackets !== this.runFrames) {
      throw new Error(`The video encoder produced ${this.runPackets} of ${this.runFrames} frames for a smart-render segment.`);
    }
  }

  private async copyRun(source: Blob, start: number, end: number, outputStart: number): Promise<number> {
    const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink, EncodedPacket } = this.mediabunny;
    const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      const config = track ? await track.getDecoderConfig() : null;
      const description = config?.description;
      if (!track || !config || !description) throw new Error("The source video has no decoder configuration to copy.");
      const sets = parseAvcC(descriptionBytes(description));
      if (!sets) throw new Error("The source video has an unreadable AVC configuration.");
      const sink = new EncodedPacketSink(track);
      const first = await sink.getKeyPacket(start + 1e-4);
      if (!first || Math.abs(first.timestamp - start) > 1e-3) throw new Error("The source has no key frame at the smart-render cut point.");
      const shift = outputStart - first.timestamp;
      this.runNeedsParams = true;
      this.runSets = null;
      this.runParamKey = null;
      let copied = 0;
      for await (const packet of sink.packets(first)) {
        if (packet.timestamp >= end - 1e-4) break;
        const out: EncodedPacketInstance = copied === 0
          ? new EncodedPacket(packet.data, packet.type, packet.timestamp + shift, packet.duration)
          : packet.clone({ timestamp: packet.timestamp + shift });
        copied++;
        await this.enqueuePacket(out, copied === 1 ? sets : null, copied === 1 ? { decoderConfig: config } : undefined);
        if (this.packetError) throw this.packetError;
      }
      return copied;
    } finally {
      input.dispose();
    }
  }
}
