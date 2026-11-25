import { createMediaImageBitmap, initializeMediaEngine, SpeedEngine, type Clip, type MediaItem, type Project, type Rectangle, type TrackingFrameProvider } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";

export function motionTrackingSourceSignature(project: Project, clip: Clip, media: MediaItem): string {
  return JSON.stringify({ mediaId: media.id, sourceFile: media.sourceFile, metadata: media.metadata,
    frameRate: project.settings.frameRate, inPoint: clip.inPoint, outPoint: clip.outPoint, duration: clip.duration,
    speed: clip.speed, reversed: clip.reversed, speedKeyframes: clip.speedKeyframes, freezeFrames: clip.freezeFrames });
}

export function createTrackingTimeMapper(clip: Clip): (time: number) => number {
  const speed = new SpeedEngine();
  const span = clip.outPoint - clip.inPoint;
  speed.initializeClip(clip.id, span);
  speed.setClipSpeed(clip.id, clip.speed ?? 1, span);
  speed.setReverse(clip.id, clip.reversed ?? false, span);
  for (const key of clip.speedKeyframes ?? []) speed.addSpeedKeyframe(clip.id, key.time, key.speed, key.easing);
  for (const freeze of clip.freezeFrames ?? []) speed.createFreezeFrame(clip.id, freeze.sourceTime, freeze.startTime, freeze.duration);
  return time => Math.max(clip.inPoint, Math.min(clip.outPoint - .000001,
    clip.inPoint + speed.getSourceTimeAtPlaybackTime(clip.id, Math.max(0, time))));
}

function trackingSourceTarget(clipId: string) {
  const { project } = useProjectStore.getState();
  const track = project.timeline.tracks.find(track => track.clips.some(clip => clip.id === clipId));
  const clip = track?.clips.find(clip => clip.id === clipId);
  const media = project.mediaLibrary.items.find(media => media.id === clip?.mediaId);
  if (!clip || !track || track.type === "audio" || !media || (media.type !== "video" && media.type !== "image")) throw new Error("Select a video or image clip to track");
  if (track.locked || useUIStore.getState().exportState.isExporting || useUIStore.getState().effectApplicationClipId !== null || useTimelineStore.getState().playbackLockedReason) throw new Error("Unlock the clip and finish exporting before tracking");
  if (!media.blob || typeof media.blob.arrayBuffer !== "function") throw new Error("Relink the source media before tracking");
  return { project, clip, media };
}

/** One bounded decoder per job, independent of export/preview decoder ownership. */
/** `frameOffset` shifts where inside a frame's interval the footage is sampled (0 = its start, the default; 0.5 = its middle, what the Program monitor shows). */
export function createMotionTrackingSource(clipId: string, region: Rectangle, signal: AbortSignal, range?: { startFrame: number; endFrame: number }, frameOffset = 0) {
  const { project, clip, media } = trackingSourceTarget(clipId);
  const signature = motionTrackingSourceSignature(project, clip, media);
  const frameRate = project.settings.frameRate;
  if (!Number.isFinite(frameRate) || frameRate <= 0 || clip.duration <= 0 || clip.outPoint <= clip.inPoint) throw new Error("The clip has an invalid frame range");
  if (media.metadata.width <= 0 || media.metadata.height <= 0) throw new Error("The source dimensions are unavailable");
  const analysisScale = Math.min(1, 480 / Math.max(media.metadata.width, media.metadata.height));
  const width = Math.max(1, Math.round(media.metadata.width * analysisScale)), height = Math.max(1, Math.round(width * media.metadata.height / media.metadata.width));
  const sourceRegion = { x: Math.max(0, Math.min(media.metadata.width - 1, region.x)), y: Math.max(0, Math.min(media.metadata.height - 1, region.y)),
    width: Math.min(region.width, media.metadata.width - Math.max(0, region.x)), height: Math.min(region.height, media.metadata.height - Math.max(0, region.y)) };
  if (![sourceRegion.x, sourceRegion.y, sourceRegion.width, sourceRegion.height].every(Number.isFinite) || sourceRegion.width < 1 || sourceRegion.height < 1) throw new Error("Choose a region inside the source image");
  const sourceTime = createTrackingTimeMapper(clip);
  const decoderId = `tracking-${crypto.randomUUID()}`;
  type TrackingMediaEngine = Awaited<ReturnType<typeof initializeMediaEngine>>;
  let engine: TrackingMediaEngine | null = null;
  let decoder: Awaited<ReturnType<TrackingMediaEngine["createExportDecoder"]>> = null;
  let image: ImageBitmap | null = null, disposed = false;
  let still: ImageData | null = null;
  const assertCurrent = () => {
    if (signal.aborted || disposed) throw new DOMException("Tracking cancelled", "AbortError");
    const current = trackingSourceTarget(clipId);
    if (current.project.id !== project.id || current.media.blob !== media.blob
      || motionTrackingSourceSignature(current.project, current.clip, current.media) !== signature) throw new Error("The tracking source changed; analyze it again");
  };
  const readFrame: TrackingFrameProvider = async frame => {
    assertCurrent();
    let pixels: ImageData;
    if (media.type === "image") {
      if (!still) {
        image = await createMediaImageBitmap(media);
        if (signal.aborted || disposed) image.close();
        assertCurrent();
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not read tracking pixels");
        context.drawImage(image, 0, 0, width, height);
        still = context.getImageData(0, 0, width, height);
      }
      pixels = still;
    } else {
      if (!decoder) {
        engine = await initializeMediaEngine();
        assertCurrent();
        decoder = await engine.createExportDecoder(decoderId, media.blob!, width);
        if (signal.aborted || disposed) engine.disposeExportDecoder(decoderId);
        assertCurrent();
        if (!decoder) throw new Error("Could not decode this video for tracking");
      }
      const canvas = await decoder.getFrame(sourceTime((frame + frameOffset) / frameRate));
      assertCurrent();
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !context) throw new Error("Could not read tracking pixels");
      pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    }
    // The frame is transferred to the tracking worker, so a still must hand out a copy of its cached pixels.
    return { width: pixels.width, height: pixels.height, data: media.type === "image" ? new Uint8ClampedArray(pixels.data) : pixels.data, sourceWidth: media.metadata.width, sourceHeight: media.metadata.height };
  };
  const lastFrame = Math.max(0, Math.ceil(clip.duration * frameRate - 1e-8) - 1);
  const startFrame = Math.max(0, Math.min(lastFrame, Math.round(range?.startFrame ?? 0))), endFrame = Math.max(startFrame, Math.min(lastFrame, Math.round(range?.endFrame ?? lastFrame)));
  return { projectId: project.id, clipId, signature, region: sourceRegion, frameRate, startFrame, endFrame, lastFrame, readFrame, assertCurrent,
    dispose: () => { disposed = true; engine?.disposeExportDecoder(decoderId); image?.close(); still = null; } };
}
