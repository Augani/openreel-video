/**
 * The one time -> frame quantisation the preview and the export share.
 *
 * A video frame N of a project at `fps` is on screen for [N / fps, (N + 1) / fps) and is rendered at its first
 * instant, N / fps (the export loop does exactly that). The preview must sample the same instant for any playhead
 * inside that interval, otherwise a playhead half way into a frame would show transition progress, keyframes and
 * effect animation up to a frame ahead of what the export holds for that frame.
 */

/** Sub-frame slack so a playhead stored as 61 / 30 = 2.0333... still lands on frame 61, not 60. */
const FRAME_EPSILON = 1e-6;

const NTSC_RATES = [24000 / 1001, 30000 / 1001, 48000 / 1001, 60000 / 1001, 120000 / 1001] as const;

/** Resolve conventional NTSC labels to their exact rate when comparing the sequence and export grids. */
export function snapFrameRate(fps: number): number {
  return NTSC_RATES.find((rate) => Math.abs(fps - rate) < 0.005) ?? fps;
}

/** The frame on screen at `time` (floor), never negative. */
export function frameIndexAt(time: number, fps: number): number {
  if (!(fps > 0) || !Number.isFinite(time) || time <= 0) return 0;
  return Math.floor(time * fps + FRAME_EPSILON);
}

/** The instant frame `frame` is rendered at. */
export function frameStartTime(frame: number, fps: number): number {
  return fps > 0 ? frame / fps : 0;
}

/** The instant the export samples for a playhead at `time`: the start of the frame that is on screen. */
export function frameSampleTime(time: number, fps: number): number {
  if (!(fps > 0) || !Number.isFinite(time)) return time;
  if (time <= 0) return time;
  return frameStartTime(frameIndexAt(time, fps), fps);
}

/**
 * The project time the export renders for export frame `frame`, and how export-fps and project-fps differ.
 *
 * Like Premiere, the sequence is rendered at its own frame rate and the result is conformed to the export
 * rate: export frame `frame` (stamped `frame / exportFps`) shows the sequence frame on screen at that instant
 * (the one the preview shows for the same playhead), so a 24 fps sequence exported at 30 fps repeats a frame
 * now and then and one exported at 12 fps skips every other frame. Keyframes, transitions and effects are never
 * evaluated between two sequence frames. At the sequence rate the instant is `offset + frame / exportFps`
 * unchanged. `offset` is the export range start.
 */
export function exportRenderTime(frame: number, exportFps: number, projectFps: number, offset = 0): number {
  const time = offset + frameStartTime(frame, exportFps);
  if (!(projectFps > 0) || !(exportFps > 0) || Math.abs(snapFrameRate(exportFps) - snapFrameRate(projectFps)) < 1e-6) return time;
  return frameSampleTime(time, projectFps);
}
