import { COLOR_PIPELINE_ARGS, COLOR_PIPELINE_YUV_ARGS, pipePixelFormat, planOf, threadQueueSize, type ExportArgs } from "./export-job";
import { frameTime, seconds, TS_BASE_SECONDS } from "./smart-export";
import { videoEncodeArgs, withTopFieldFirst } from "./encode-args";

/**
 * ffmpeg arguments for one video-only segment of a parallel export.
 *
 * The encoder arguments are the serial export's (same filters, same colour tags, same rate control), so a segment
 * is what the serial encode would produce for those frames, with two differences that make the join lossless:
 * it starts on a key frame and ends in a closed GOP, and its timestamps carry the segment's place on the frame grid.
 * H.264 / HEVC go out as MPEG-TS, where parameter sets repeat at every key frame and a byte-wise append is a valid
 * stream; ProRes is intra-only and goes out as a MOV that the concat demuxer joins.
 */
export function buildSegmentArgs(a: ExportArgs): string[] {
  const segment = a.segment;
  if (!segment) throw new Error("buildSegmentArgs needs a segment");
  const prores = a.codec === "prores";
  const offset = TS_BASE_SECONDS + frameTime(segment.startFrame, a.frameRate);
  return [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", pipePixelFormat(a),
    "-s", `${a.width}x${a.height}`,
    "-r", String(a.frameRate),
    "-thread_queue_size", String(threadQueueSize(a.width, a.height)),
    "-i", "pipe:0",
    ...withTopFieldFirst([...(a.rawYuv420 ? COLOR_PIPELINE_YUV_ARGS : COLOR_PIPELINE_ARGS)], planOf(a)),
    ...videoEncodeArgs(planOf(a)),
    ...(a.encoder === "libx264" ? ["-flags", "+cgop"] : []),
    ...(a.encoder === "libx265" ? ["-x265-params", "open-gop=0:log-level=error"] : []),
    "-an",
    ...(prores
      ? ["-f", "mov"]
      : ["-f", "mpegts", "-muxdelay", "0", "-muxpreload", "0", "-output_ts_offset", seconds(offset)]),
    "-progress", "pipe:2",
    a.outputPath,
  ];
}
