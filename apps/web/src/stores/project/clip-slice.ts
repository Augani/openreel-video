import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, ActionResult } from "@openreel/core";
import type { ProjectState } from "../project-store";
import { calculateTimelineDuration } from "./index";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type ClipSlice = Pick<
  ProjectState,
  | "addClip"
  | "addClipToNewTrack"
  | "separateAudio"
  | "removeClip"
  | "moveClip"
  | "closeGapBeforeClip"
  | "moveClips"
  | "trimClip"
  | "splitClip"
  | "rippleDeleteClip"
  | "slipClip"
  | "slideClip"
  | "rollEdit"
  | "trimToPlayhead"
  | "getClip"
>;

export function createClipSlice(set: Set, get: Get): ClipSlice {
  return {
    addClip: async (trackId: string, mediaId: string, startTime: number) => {
      const { project, actionExecutor } = get();
      const projectCopy = structuredClone(project);
      const action: Action = {
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, mediaId, startTime },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    addClipToNewTrack: async (mediaId: string, startTime?: number) => {
      const { project, addTrack, getMediaItem } = get();
      const mediaItem = getMediaItem(mediaId);
      if (!mediaItem) {
        return {
          success: false,
          error: {
            code: "MEDIA_NOT_FOUND" as const,
            message: "Media item not found",
          },
        };
      }

      let trackType: "video" | "audio" | "image" | "text" | "graphics";
      if (mediaItem.type === "video") trackType = "video";
      else if (mediaItem.type === "audio") trackType = "audio";
      else if (mediaItem.type === "image") trackType = "image";
      else trackType = "video";

      const clipStartTime =
        startTime !== undefined ? startTime : calculateTimelineDuration(project);

      const trackResult = await addTrack(trackType);
      if (!trackResult.success) return trackResult;

      const { project: updatedProject, actionExecutor: exec } = get();
      const newTrack = updatedProject.timeline.tracks.find(
        (t) => t.clips.length === 0 && t.type === trackType,
      );
      if (!newTrack) {
        return {
          success: false,
          error: {
            code: "TRACK_NOT_FOUND" as const,
            message: "Could not find newly created track",
          },
        };
      }

      const projectCopy = structuredClone(updatedProject);
      const action: Action = {
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId: newTrack.id, mediaId, startTime: clipStartTime },
      };
      const result = await exec.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    separateAudio: async (clipId: string) => {
      const { project, actionExecutor } = get();
      const videoClip = project.timeline.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!videoClip) {
        return {
          success: false,
          error: { code: "CLIP_NOT_FOUND" as const, message: "Clip not found" },
        };
      }

      const mediaItem = project.mediaLibrary.items.find(
        (m) => m.id === videoClip.mediaId,
      );
      if (
        !mediaItem ||
        mediaItem.type !== "video" ||
        !mediaItem.metadata?.channels ||
        mediaItem.metadata.channels === 0
      ) {
        return {
          success: false,
          error: {
            code: "MEDIA_NOT_FOUND" as const,
            message: "Media has no audio to separate",
          },
        };
      }

      let audioTrackCount = mediaItem.metadata.audioTrackCount ?? 1;
      if (audioTrackCount <= 1 && mediaItem.blob) {
        try {
          const { getFFmpegFallback } = await import("@openreel/core/media");
          const ffmpeg = getFFmpegFallback();
          const probeResult = await ffmpeg.probeAudioStreams(mediaItem.blob);
          if (probeResult.audioStreamCount > 1) {
            audioTrackCount = probeResult.audioStreamCount;
          }
        } catch {
          // FFmpeg probe unavailable — proceed with count of 1
        }
      }

      const projectCopy = structuredClone(project);
      const existingAudioCount = projectCopy.timeline.tracks.filter(
        (t) => t.type === "audio",
      ).length;

      const newTrackIds: string[] = [];
      for (let i = existingAudioCount; i < audioTrackCount; i++) {
        const newTrackId = uuidv4();
        newTrackIds.push(newTrackId);
        const trackAction: Action = {
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { trackType: "audio", trackId: newTrackId },
        };
        const trackResult = await actionExecutor.execute(
          trackAction,
          projectCopy,
        );
        if (!trackResult.success) {
          return {
            success: false,
            error: {
              code: "TRACK_NOT_FOUND" as const,
              message: "Failed to create audio track",
            },
          };
        }
      }

      const audioTimelineTracks = projectCopy.timeline.tracks.filter(
        (t) => t.type === "audio",
      );
      if (audioTimelineTracks.length === 0) {
        return {
          success: false,
          error: {
            code: "TRACK_NOT_FOUND" as const,
            message: "Could not find or create audio track",
          },
        };
      }

      let lastResult: ActionResult = { success: true };
      for (let trackIdx = 0; trackIdx < audioTrackCount; trackIdx++) {
        const targetTrack = audioTimelineTracks[trackIdx];
        if (!targetTrack) break;
        const action: Action = {
          type: "clip/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackId: targetTrack.id,
            mediaId: videoClip.mediaId,
            startTime: videoClip.startTime,
            duration: videoClip.duration,
            inPoint: videoClip.inPoint,
            outPoint: videoClip.outPoint,
            speed: videoClip.speed,
            reversed: videoClip.reversed,
            audioTrackIndex: trackIdx,
          },
        };
        lastResult = await actionExecutor.execute(action, projectCopy);
        if (!lastResult.success) break;
      }

      if (lastResult.success) {
        for (const track of projectCopy.timeline.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex !== -1) {
            (track.clips[clipIndex] as unknown as { volume: number }).volume = 0;
            break;
          }
        }
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return lastResult;
    },

    removeClip: async (clipId: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/remove",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    moveClip: async (clipId: string, startTime: number, trackId?: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/move",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId, startTime, trackId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    closeGapBeforeClip: async (clipId: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/closeGapBefore",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    moveClips: async (moves) => {
      if (moves.length === 0) return { success: true };
      if (moves.length === 1) {
        return get().moveClip(
          moves[0].clipId,
          moves[0].startTime,
          moves[0].trackId,
        );
      }
      const { actionExecutor } = get();
      const history = actionExecutor.getHistory();
      history.beginGroup("Move clips");
      try {
        let lastResult: ActionResult = { success: true };
        for (const move of moves) {
          const { project } = get();
          const action: Action = {
            type: "clip/move",
            id: uuidv4(),
            timestamp: Date.now(),
            params: {
              clipId: move.clipId,
              startTime: move.startTime,
              trackId: move.trackId,
            },
          };
          lastResult = await actionExecutor.execute(action, project);
          if (!lastResult.success) break;
          set({ project: { ...project } });
        }
        return lastResult;
      } finally {
        history.endGroup();
      }
    },

    trimClip: async (clipId: string, inPoint?: number, outPoint?: number) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/trim",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId, inPoint, outPoint },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    splitClip: async (clipId: string, time: number) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/split",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId, time },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    rippleDeleteClip: async (clipId: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/rippleDelete",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    slipClip: async (clipId: string, delta: number) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/slip",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId, delta },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    slideClip: async (clipId: string, delta: number) => {
      const { project, actionExecutor, getClip } = get();
      const clip = getClip(clipId);
      if (!clip) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "Clip not found" },
        };
      }
      const track = project.timeline.tracks.find((t) =>
        t.clips.some((c) => c.id === clipId),
      );
      if (!track) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "Track not found" },
        };
      }
      const sortedClips = [...track.clips].sort(
        (a, b) => a.startTime - b.startTime,
      );
      const clipIndex = sortedClips.findIndex((c) => c.id === clipId);
      const prevClip = clipIndex > 0 ? sortedClips[clipIndex - 1] : undefined;
      const nextClip =
        clipIndex < sortedClips.length - 1
          ? sortedClips[clipIndex + 1]
          : undefined;

      const action: Action = {
        type: "clip/slide",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          clipId,
          delta,
          prevClipId: prevClip?.id,
          nextClipId: nextClip?.id,
        },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    rollEdit: async (leftClipId: string, rightClipId: string, delta: number) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/roll",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { leftClipId, rightClipId, delta },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    trimToPlayhead: async (
      clipId: string,
      playheadTime: number,
      trimStart: boolean,
    ) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/trimToPlayhead",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId, playheadTime, trimStart },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    getClip: (clipId: string) => {
      const { project } = get();
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) return clip;
      }
      return undefined;
    },
  };
}
