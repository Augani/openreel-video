import {
  RawDecodeError,
  readTiff,
  decodeDng,
  defaultRawSettings,
  developedSize,
  getRawDeveloper,
  type DngRaw,
  type MediaItem,
  type RawSourceSettings,
  type RawStillInfo,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * CinemaDNG sequence import. A CinemaDNG clip is a folder of numbered DNG
 * frames. OpenReel develops every frame with one set of RAW Source Settings
 * (as shot, taken from the first frame) and bakes them into an H.264 MP4 that
 * is imported as ordinary video. The frames are not kept: changing the look
 * later means importing the sequence again with different settings.
 */

export const DEFAULT_SEQUENCE_FRAME_RATE = 24;
const BAKE_MAX_EDGE = 3840;

export interface SequenceBakeProgress {
  readonly frame: number;
  readonly total: number;
  readonly stage: "reading" | "developing" | "encoding" | "importing";
}

export interface SequenceImportOptions {
  readonly frameRate?: number;
  readonly settings?: Partial<RawSourceSettings>;
  readonly onProgress?: (progress: SequenceBakeProgress) => void;
  readonly signal?: AbortSignal;
}

export interface SequenceImportResult {
  readonly success: boolean;
  readonly mediaId?: string;
  readonly error?: string;
}

const TAG_CINEMADNG_TIMECODES = 51043;
const TAG_CINEMADNG_FRAME_RATE = 51044;

/**
 * Whether a numbered .dng is a frame of a CinemaDNG clip rather than a still from a stills camera. Cameras number
 * their photos too (IMG_0001.dng, IMG_0002.dng), and those must stay editable stills: CinemaDNG frames carry the
 * CinemaDNG FrameRate / TimeCodes tags, stills do not.
 */
export async function looksLikeCinemaDngFrame(file: Blob): Promise<boolean> {
  try {
    const tiff = readTiff(await file.arrayBuffer());
    return tiff.ifds.some((ifd) => ifd.entries.has(TAG_CINEMADNG_FRAME_RATE) || ifd.entries.has(TAG_CINEMADNG_TIMECODES));
  } catch (error) {
    if (error instanceof RawDecodeError) return false;
    throw error;
  }
}

/** Even dimensions (H.264 needs them), within the bake size cap. */
export function sequenceFrameSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, BAKE_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(2, Math.floor((width * scale) / 2) * 2), height: Math.max(2, Math.floor((height * scale) / 2) * 2) };
}

export async function importCinemaDngSequence(
  frames: readonly File[],
  prefix: string,
  options: SequenceImportOptions = {},
): Promise<SequenceImportResult> {
  if (frames.length < 2) return { success: false, error: "A CinemaDNG sequence needs at least two frames." };
  const progress = options.onProgress ?? (() => undefined);
  try {
    progress({ frame: 0, total: frames.length, stage: "reading" });
    const first: DngRaw = decodeDng(await frames[0].arrayBuffer());
    const settings: RawSourceSettings = { ...defaultRawSettings(first), ...options.settings, outputColorSpace: "srgb" };
    const size = developedSize(first, settings, { maxLongEdge: BAKE_MAX_EDGE });
    const out = sequenceFrameSize(size.width, size.height);
    const frameRate = options.frameRate ?? first.frameRate ?? DEFAULT_SEQUENCE_FRAME_RATE;

    const mb = await import("mediabunny");
    const format = new mb.Mp4OutputFormat();
    const codec = await mb.getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width: out.width, height: out.height });
    if (!codec) return { success: false, error: "This browser cannot encode video, so the sequence cannot be baked." };

    const canvas = new OffscreenCanvas(out.width, out.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { success: false, error: "Could not create a drawing surface." };
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format, target });
    const source = new mb.CanvasSource(canvas, { codec, bitrate: mb.QUALITY_VERY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate });
    await output.start();

    const developer = getRawDeveloper();
    for (let i = 0; i < frames.length; i++) {
      if (options.signal?.aborted) {
        await output.cancel();
        return { success: false, error: "Sequence import was cancelled." };
      }
      progress({ frame: i, total: frames.length, stage: "developing" });
      const file = frames[i];
      const frame = await developer.develop({
        sourceKey: `seq:${prefix}:${i}:${file.size}`,
        blob: file,
        settings,
        maxLongEdge: BAKE_MAX_EDGE,
      });
      const bitmap = await createImageBitmap(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height));
      ctx.drawImage(bitmap, 0, 0, out.width, out.height);
      bitmap.close();
      progress({ frame: i, total: frames.length, stage: "encoding" });
      await source.add(i / frameRate, 1 / frameRate);
    }
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer) return { success: false, error: "Encoding produced no data." };

    progress({ frame: frames.length, total: frames.length, stage: "importing" });
    const file = new File([buffer], `${prefix.replace(/[_\-. ]+$/, "") || "CinemaDNG"} (CinemaDNG).mp4`, { type: "video/mp4" });
    const result = await useProjectStore.getState().importMedia(file);
    if (!result.success) return { success: false, error: result.error?.message ?? "Import failed." };
    const mediaId = result.actionId;
    if (mediaId) {
      const info: RawStillInfo = {
        format: "cinemadng",
        developedBy: "openreel",
        make: first.make,
        model: first.model,
        bitDepth: first.bitsPerSample,
        sequence: { frames: frames.length, frameRate, firstFrame: frames[0].name, bakedSettings: settings },
      };
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            ...state.project.mediaLibrary,
            items: state.project.mediaLibrary.items.map((item: MediaItem) => (item.id === mediaId ? { ...item, raw: info } : item)),
          },
        },
      }));
    }
    return { success: true, mediaId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not import the sequence." };
  }
}
