import type { VideoExportSettings } from "./types";
import type { Project } from "../types/project";
import type { SmartRenderEngine, SmartRenderPlan } from "./smart-render";

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
