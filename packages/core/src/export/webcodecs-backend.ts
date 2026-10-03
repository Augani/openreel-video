import { CODEC_MAP, type VideoExportSettings, type AudioExportSettings, type ExportError } from "./types";
import type { Project } from "../types/project";
import type { EncoderBackend } from "./encoder-backend";
import { trackHasAudioItems } from "../timeline/timeline-items";

type MediaBunnyModule = typeof import("mediabunny");
type AudioBufferSourceInstance = InstanceType<MediaBunnyModule["AudioBufferSource"]>;
type VideoSampleSourceInstance = InstanceType<MediaBunnyModule["VideoSampleSource"]>;
type OutputInstance = InstanceType<MediaBunnyModule["Output"]>;
type HardwarePreference = "prefer-hardware" | "prefer-software" | "no-preference";
type VideoCodecName = Parameters<
  MediaBunnyModule["getFirstEncodableVideoCodec"]
>[0][number];

export interface WebCodecsBackendOptions {
  hardwareAcceleration?: HardwarePreference;
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
  private readonly videoCodecPreference?: VideoCodecName[];
  private output: OutputInstance | null = null;
  private videoSource: VideoSampleSourceInstance | null = null;
  private audioSource: AudioBufferSourceInstance | null = null;
  private writableStream: FileSystemWritableFileStream | null = null;
  private bytesWritten = 0;

  constructor(mediabunny: MediaBunnyModule, options?: WebCodecsBackendOptions) {
    this.mediabunny = mediabunny;
    this.hardwareAcceleration = options?.hardwareAcceleration ?? "prefer-hardware";
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

    const {
      Output,
      StreamTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      MovOutputFormat,
      VideoSampleSource,
      AudioBufferSource,
      getFirstEncodableVideoCodec,
      getFirstEncodableAudioCodec,
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

    let outputFormat;
    switch (settings.format) {
      case "webm":
        outputFormat = new WebMOutputFormat();
        break;
      case "mov":
        outputFormat = new MovOutputFormat();
        break;
      case "mp4":
      default:
        outputFormat = new Mp4OutputFormat({ fastStart: false });
        break;
    }

    const target = new StreamTarget(chunkWriter, {
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
    });
    const output = new Output({ format: outputFormat, target });

    const supportedVideoCodecs = outputFormat.getSupportedVideoCodecs();
    const requestedVideoCodec = CODEC_MAP[settings.codec] as VideoCodecName | undefined;
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
    const audioCodecResult = hasAudio ? await this.findSupportedAudioCodec(
      outputFormat,
      settings.audioSettings,
      getFirstEncodableAudioCodec,
    ) : null;

    const videoSource = new VideoSampleSource({
      codec: videoCodec,
      bitrate: targetVideoBitrate,
      keyFrameInterval: settings.keyframeInterval / settings.frameRate,
      hardwareAcceleration: selectedHardwareAcceleration,
      bitrateMode: settings.bitrateMode === "cbr" ? "constant" : "variable",
    });
    const audioSource = audioCodecResult ? new AudioBufferSource({
      codec: audioCodecResult.codec as "aac" | "opus" | "mp3",
      bitrate: audioCodecResult.bitrate,
    }) : null;
    output.addVideoTrack(videoSource);
    if (audioSource) output.addAudioTrack(audioSource);
    output.setMetadataTags({
      title: project.name,
      date: new Date(),
    });

    this.output = output;
    this.videoSource = videoSource;
    this.audioSource = audioSource;
    await output.start();
  }

  async addAudioBuffer(buffer: AudioBuffer): Promise<void> {
    if (!this.audioSource) return;
    await this.audioSource.add(buffer);
  }

  async closeAudio(): Promise<void> {
    this.audioSource?.close();
  }

  async addVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
    durationSec: number,
  ): Promise<void> {
    if (!this.videoSource) {
      throw new Error("Encoder backend not started");
    }
    const { VideoSample } = this.mediabunny;
    const videoSample = new VideoSample(frame, {
      timestamp: timestampSec,
      duration: durationSec,
    });

    try {
      await this.videoSource.add(videoSample);
    } finally {
      videoSample.close();
      frame.close();
    }
  }

  async finalize(): Promise<void> {
    this.videoSource?.close();
    await this.output?.finalize();
    await this.writableStream?.close();
  }

  async abort(): Promise<void> {
    try { await this.output?.cancel(); } catch {}
    this.videoSource?.close();
    this.audioSource?.close();
    try {
      await this.writableStream?.abort();
    } catch {}
  }

  private async findSupportedAudioCodec(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputFormat: { getSupportedAudioCodecs: () => any[] },
    audioSettings: AudioExportSettings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getFirstEncodableAudioCodec: (codecs: any[]) => Promise<string | null>,
  ): Promise<{ codec: string; bitrate: number }> {
    const supportedCodecs = outputFormat.getSupportedAudioCodecs();
    const requestedBitrate = audioSettings.bitrate * 1000;

    const bitrateFallbacks = [requestedBitrate, 192000, 128000, 96000].filter(
      (b, i, arr) => arr.indexOf(b) === i,
    );

    for (const bitrate of bitrateFallbacks) {
      const codec = await getFirstEncodableAudioCodec(supportedCodecs);
      if (codec) {
        const isSupported = await this.isAudioConfigSupported(
          codec,
          bitrate,
          audioSettings.channels,
          audioSettings.sampleRate,
        );
        if (isSupported) {
          return { codec, bitrate };
        }
      }
    }

    for (const fallbackCodec of ["aac", "mp3", "opus"]) {
      if (
        supportedCodecs.some((c: string) =>
          String(c).toLowerCase().includes(fallbackCodec) ||
          (fallbackCodec === "aac" && String(c).toLowerCase().includes("mp4a")),
        )
      ) {
        for (const bitrate of bitrateFallbacks) {
          const isSupported = await this.isAudioConfigSupported(
            fallbackCodec,
            bitrate,
            audioSettings.channels,
            audioSettings.sampleRate,
          );
          if (isSupported) {
            return { codec: fallbackCodec, bitrate };
          }
        }
      }
    }

    throw { code: "UNSUPPORTED_CODEC", message: `No supported audio encoder for ${outputFormat.constructor.name}. Try WebM or another browser.`, phase: "preparing", recoverable: true } satisfies ExportError;
  }

  private async isAudioConfigSupported(
    codec: string,
    bitrate: number,
    channels: number,
    sampleRate: number,
  ): Promise<boolean> {
    if (typeof AudioEncoder === "undefined") {
      return true;
    }

    try {
      let codecString: string;
      if (codec === "aac" || codec.includes("mp4a")) {
        codecString = "mp4a.40.2";
      } else if (codec === "opus") {
        codecString = "opus";
      } else if (codec === "mp3") {
        codecString = "mp3";
      } else {
        codecString = codec;
      }

      const config: AudioEncoderConfig = {
        codec: codecString,
        sampleRate,
        numberOfChannels: channels,
        bitrate,
      };

      const support = await AudioEncoder.isConfigSupported(config);
      return support.supported === true;
    } catch {
      return false;
    }
  }
}
