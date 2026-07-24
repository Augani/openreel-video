import type {
  EncoderBackend,
  VideoExportSettings,
  Project,
} from "@openreel/core";

type ExportPortMessage =
  | { type: "progress"; frame: number }
  | { type: "credit"; credits?: number }
  | { type: "done" }
  | { type: "error"; message?: string };

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const PCM_FORMAT_TAG = 1;
const BITS_PER_SAMPLE = 16;
const INT16_MAX = 0x7fff;
const INT16_MIN = -0x8000;
const MAX_INITIAL_FRAME_CREDITS = 10;
const MAX_IN_FLIGHT_FRAME_BYTES = 128 * 1024 * 1024;

export function initialNativeFrameCredits(width: number, height: number): number {
  const frameBytes = Math.max(1, width * height * 4);
  return Math.max(
    1,
    Math.min(MAX_INITIAL_FRAME_CREDITS, Math.floor(MAX_IN_FLIGHT_FRAME_BYTES / frameBytes)),
  );
}

export function buildWavHeader(
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
  const out = new ArrayBuffer(buffer.length * outputChannels * BYTES_PER_SAMPLE);
  const view = new DataView(out);
  let offset = 0;

  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < outputChannels; channel++) {
      const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1);
      const source = buffer.getChannelData(sourceChannel);
      const sample = Math.max(-1, Math.min(1, source[frame] ?? 0));
      const pcm = Math.round(sample < 0 ? sample * -INT16_MIN : sample * INT16_MAX);
      view.setInt16(offset, Math.max(INT16_MIN, Math.min(INT16_MAX, pcm)), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return out;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export class NativeFFmpegBackend implements EncoderBackend {
  readonly requiresWebCodecsClamping = false;
  // Native FFmpeg applies backpressure through frame credits. Clearing the
  // decoder caches every five frames forces repeated seeks and can duplicate
  // frames in the output, which appears as brief pauses in exported video.
  readonly needsFrameThrottling = false;
  readonly normalizesProResToH264 = false;
  readonly audioBeforeVideo = true;

  private readonly resolveOutputPath: () => string;

  private width = 0;
  private height = 0;
  private timelineDurationSec = 0;

  private audioSampleRate = 48000;
  private audioChannelCount = 2;
  private audioHeaderWritten = false;
  private audioDataOffset = WAV_HEADER_BYTES;
  private audioFramesWritten = 0;

  private jobId: string | null = null;
  private port: MessagePort | null = null;
  private credits = 0;
  private bytesSent = 0;
  private failed = false;
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
    this.timelineDurationSec = project.timeline.duration;
    this.audioSampleRate = settings.audioSettings.sampleRate;
    this.audioChannelCount = settings.audioSettings.channels;
    this.audioHeaderWritten = false;
    this.audioDataOffset = WAV_HEADER_BYTES;
    this.audioFramesWritten = 0;
    this.credits = 0;
    this.bytesSent = 0;
    this.failed = false;
    this.readbackMsTotal = 0;
    this.creditWaitMsTotal = 0;
    this.frameCount = 0;

    const totalFrames = Math.max(
      1,
      Math.ceil(this.timelineDurationSec * settings.frameRate),
    );

    const outputPath = this.resolveOutputPath();
    if (!outputPath) {
      throw new Error("No output path resolved for native export");
    }

    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });

    const portPromise = this.awaitExportPort();

    const session = await bridge.export.start({
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      codec: settings.codec,
      format: settings.format,
      bitrateKbps: settings.bitrate,
      outputPath,
      totalFrames,
      audioSampleRate: settings.audioSettings.sampleRate,
      audioChannels: settings.audioSettings.channels,
      encodeMode: settings.encodeMode ?? "balanced",
      quality: settings.quality,
      proresProfile: settings.proresProfile,
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
          break;
        case "done":
          this.resolveDone?.();
          break;
        case "error":
          this.failed = true;
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

  async addVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
  ): Promise<void> {
    const port = this.port;
    if (!port) {
      throw new Error("NativeFFmpegBackend not started");
    }

    const waitStart = performance.now();
    await this.waitForFrameCredit();
    this.creditWaitMsTotal += performance.now() - waitStart;

    let rgba: ArrayBuffer;
    try {
      rgba = this.readbackFrame(frame);
    } finally {
      frame.close();
    }

    this.frameCount += 1;
    this.credits -= 1;
    this.bytesSent += rgba.byteLength;

    // The renderer<->MessagePortMain bridge does not deliver a message whose
    // payload is sent in the transfer list (it arrives as null on the main
    // side), so the RGBA buffer is structured-cloned rather than transferred.
    port.postMessage({ type: "frame", ts: timestampSec, buffer: rgba });
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
    }
  }

  async abort(): Promise<void> {
    if (this.jobId && window.openreel) {
      await window.openreel.export.cancel(this.jobId);
    }
    this.releaseReadbackBuffers();
  }

  private async waitForFrameCredit(): Promise<void> {
    while (this.credits <= 0) {
      if (this.failed) {
        throw new Error("Native export failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
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
