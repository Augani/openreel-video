import type { VideoExportSettings } from "./types";
import type { Project } from "../types/project";

export interface EncoderBackend {
  readonly requiresWebCodecsClamping: boolean;
  readonly needsFrameThrottling: boolean;
  readonly normalizesProResToH264: boolean;
  readonly audioBeforeVideo: boolean;
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
