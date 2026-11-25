import type { VideoExportSettings } from "./types";
import type { Project } from "../types/project";
import type { SmartRenderEngine, SmartRenderPlan } from "./smart-render";
import type { SmartAudioPlan, SmartAudioSourceInfo } from "./smart-render-audio";

/** Stream-copy capability: a backend that can splice source packets between re-encoded runs. */
export interface SmartRenderMuxer {
  /** Which codecs and parameter rules the planner applies; absent means the WebCodecs (H.264 only) rules. */
  readonly engine?: SmartRenderEngine;
  /**
   * Optional last check before the plan is committed, with access to the
   * sources: the native muxer reads the real colour and format of the files
   * ffmpeg will copy from. Resolve `{ decline }` to export without smart render
   * (the reason lands in the export report) or the plan to use.
   */
  prepare?(
    plan: SmartRenderPlan,
    blobFor: (mediaId: string) => Blob | undefined,
  ): Promise<{ plan: SmartRenderPlan } | { decline: string }>;
  /** Call before start(): the video track will be fed by copy runs and encode runs. */
  enable(plan?: SmartRenderPlan): void;
  /** Open an encode run; its first frame is forced to a key frame. */
  beginEncodeRun(): void;
  /** Flush the encoder for the open run; every frame of the run is muxed when this resolves. */
  endEncodeRun(): Promise<void>;
  /**
   * Copy the packets of `source` presenting in [sourceStart, sourceEnd) (starting on a
   * key frame) to output time `outputStart`. Returns the number of frames copied.
   */
  copyRun(source: Blob, sourceStart: number, sourceEnd: number, outputStart: number): Promise<number>;
  /**
   * Native muxer only: audio that is copied from the sources instead of being rendered and encoded (AAC packets of a
   * single untouched source, or untouched PCM spans). Absent on muxers that always take the rendered mixdown.
   */
  readonly audio?: {
    /** Describe the first audio stream of a source file for the planner, or null when it cannot be copied. */
    probe(mediaId: string, blob: Blob): Promise<SmartAudioSourceInfo | null>;
    /**
     * After start(): hand over the plan. The muxer builds and proves the copies; resolves to null when they are accepted,
     * else why the audio has to be rendered and encoded instead.
     */
    begin(plan: SmartAudioPlan, blobFor: (mediaId: string) => Blob | undefined): Promise<string | null>;
    /** The mixdown leaves out `frames` samples the copies cover (they are not rendered). */
    skip(frames: number): Promise<void>;
  };
}

export interface EncoderBackend {
  /** Present on backends that can mix stream-copied and re-encoded video (WebCodecs/MediaBunny). */
  readonly smartRender?: SmartRenderMuxer;
  readonly requiresWebCodecsClamping: boolean;
  readonly needsFrameThrottling: boolean;
  readonly normalizesProResToH264: boolean;
  readonly audioBeforeVideo: boolean;
  /**
   * True when addVideoFrame may be called again before the previous call
   * resolves. The backend must then accept frames in call order, own and
   * close every frame it is given, and reject queued frames after an abort.
   */
  readonly supportsPipelining?: boolean;
  /**
   * True when frames are handed to an external encoder process (native ffmpeg)
   * whose drain time at finalize() is unbounded: a slow software encoder can
   * need minutes to flush buffered frames and rewrite the file. The engine
   * then skips its stalled-encoder watchdog around finalize(); cancellation
   * still applies and the backend reports failures by rejecting.
   */
  readonly drivesExternalEncoder?: boolean;
  /** Set by start(): subtitle tracks written into the container and what was refused. */
  embeddedCaptions?: { tracks: number; warnings: string[] };
  start(
    settings: VideoExportSettings,
    project: Project,
    writableStream?: FileSystemWritableFileStream,
  ): Promise<void>;
  addVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
    durationSec: number,
  ): Promise<void>;
  addAudioBuffer(buffer: AudioBuffer): Promise<void>;
  closeAudio(): void | Promise<void>;
  getBytesWritten(): number;
  /**
   * PQ exports: the MaxCLL / MaxFALL measured from the rendered frames, offered just before finalize(). A backend that
   * writes the file itself (native ffmpeg) puts them into the content light level metadata; others ignore it.
   */
  setHdrLightLevel?(level: { maxCll: number; maxFall: number }): void;
  finalize(): Promise<void>;
  abort(): Promise<void>;
}

export type EncoderBackendFactory = (
  mediabunny: typeof import("mediabunny") | null,
) => EncoderBackend;

// Held here (not in export-engine) so the app entry can register a native
// backend without statically pulling the whole export engine.
let encoderBackendFactory: EncoderBackendFactory | null = null;

export function setEncoderBackendFactory(
  factory: EncoderBackendFactory | null,
): void {
  encoderBackendFactory = factory;
}

export function getEncoderBackendFactory(): EncoderBackendFactory | null {
  return encoderBackendFactory;
}
