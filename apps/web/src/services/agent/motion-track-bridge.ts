import type { MotionTrackBridge, MotionTrackSummary } from "@openreel/agent";
import { trackQualityRuns, type TrackingData } from "@openreel/core";
import { getMotionTrackingBridge } from "../../bridges/motion-tracking-bridge";
import { readMotionTrackingAnalysis, readMotionTrackingApplication } from "../motion-tracking-edit";
import { useProjectStore } from "../../stores/project-store";

function summarize(clipId: string, data: TrackingData): MotionTrackSummary {
  const first = data.keyframes[0], last = data.keyframes[data.keyframes.length - 1];
  return {
    clipId, frameRate: data.frameRate, frames: data.keyframes.length, firstFrame: first?.frame ?? 0, lastFrame: last?.frame ?? 0,
    lostFrames: data.lostFrames.length, lowConfidence: trackQualityRuns(data), manualFrames: data.manualFrames ?? [],
    framesPerSecond: data.stats?.framesPerSecond,
    start: { frame: first?.frame ?? 0, x: first?.position.x ?? 0, y: first?.position.y ?? 0 },
    end: { frame: last?.frame ?? 0, x: last?.position.x ?? 0, y: last?.position.y ?? 0 },
  };
}

export function createMotionTrackBridge(): MotionTrackBridge {
  const bridge = () => getMotionTrackingBridge();
  return {
    async track(request) {
      const { project } = useProjectStore.getState();
      const clip = project.timeline.tracks.flatMap(track => track.clips).find(candidate => candidate.id === request.clipId);
      const media = project.mediaLibrary.items.find(item => item.id === clip?.mediaId);
      if (!clip || !media) throw new Error(`Clip ${request.clipId} was not found`);
      const { width, height } = media.metadata;
      const region = request.region ?? { x: Math.round(width / 4), y: Math.round(height / 4), width: Math.round(width / 2), height: Math.round(height / 2) };
      const anchored = request.anchorFrame !== undefined;
      const data = await bridge().track(request.clipId, region, {
        algorithm: request.algorithm, confidenceThreshold: request.confidenceThreshold,
        ...(anchored ? { anchorFrame: request.anchorFrame, direction: request.direction ?? "forward", merge: request.merge === true } : {}),
      });
      const saved = readMotionTrackingAnalysis(request.clipId)?.data ?? data;
      return summarize(request.clipId, saved);
    },
    async attach(request) {
      const saved = readMotionTrackingAnalysis(request.clipId);
      if (!saved) throw new Error("Track the clip with track_motion before attaching to it");
      const previous = readMotionTrackingApplication(request.targetId)?.options;
      await bridge().applyTrackingToClip(request.clipId, request.offset ?? previous?.offset ?? { x: 0, y: 0 }, request.targetId, {
        applyScale: request.applyScale ?? previous?.applyScale ?? true, applyRotation: request.applyRotation ?? previous?.applyRotation ?? true,
        smoothing: request.smoothing ?? previous?.smoothing ?? 0, mode: request.mode ?? previous?.mode ?? "follow",
      });
      return { keyframes: saved.data.keyframes.length };
    },
    async correct(clipId, frame, position) {
      const data = await bridge().correctPoint(clipId, frame, position);
      return summarize(clipId, data);
    },
    summary(clipId) {
      const saved = readMotionTrackingAnalysis(clipId);
      return saved ? summarize(clipId, saved.data) : null;
    },
  };
}
