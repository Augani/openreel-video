import { cloneProjectForEdit } from "./clone-project-for-edit";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, ActionResult } from "@openreel/core";
import type { ProjectState } from "../project-store";
import { calculateTimelineDuration } from "./index";
import { extractAudioTracks } from "../../services/separate-audio";
import { saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";

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
  const separatingClips = new Set<string>();
  return {
    addClip: async (trackId: string, mediaId: string, startTime: number) => {
      const { project, actionExecutor } = get();
      const projectCopy = cloneProjectForEdit(project);
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

      const projectCopy = cloneProjectForEdit(updatedProject);
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
      const { project } = get();
      const sourceTrack = project.timeline.tracks.find((track) =>
        track.clips.some((clip) => clip.id === clipId),
      );
      const sourceClip = sourceTrack?.clips.find((clip) => clip.id === clipId);
      if (!sourceClip) {
        return {
          success: false,
          error: { code: "CLIP_NOT_FOUND" as const, message: "Clip not found" },
        };
      }
      const mediaItem = project.mediaLibrary.items.find((m) => m.id === sourceClip.mediaId);
      if (sourceTrack?.type === "audio" || mediaItem?.type !== "video" ||
          (!mediaItem.metadata.hasAudio && !mediaItem.metadata.channels)) {
        return {
          success: false,
          error: { code: "MEDIA_NOT_FOUND" as const, message: "Media has no audio to separate" },
        };
      }
      if (sourceTrack?.locked) {
        return {
          success: false,
          error: { code: "TRACK_LOCKED" as const, message: "Unlock the video track before separating audio." },
        };
      }
      const requestKey = `${project.id}:${clipId}`;
      if (separatingClips.has(requestKey)) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "Audio separation is already in progress." },
        };
      }
      if (project.timeline.tracks.some((track) => track.clips.some(
        (clip) => clip.metadata?.separatedFromClipId === clipId,
      ))) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "This clip's audio has already been separated." },
        };
      }

      separatingClips.add(requestKey);
      const persistedIds: string[] = [];
      let committed = false;
      try {
        const sources = await extractAudioTracks(mediaItem);
        for (const source of sources) {
          persistedIds.push(source.id);
          await saveMediaBlob(project.id, source.id, source.blob!, source.metadata);
        }

        // Extraction can take a while. Apply to the latest timeline so edits
        // made during decoding survive, and never reopen a previous project.
        const current = get();
        const currentSourceTrack = current.project.timeline.tracks.find((track) =>
          track.clips.some((clip) => clip.id === clipId),
        );
        const videoClip = currentSourceTrack?.clips.find((clip) => clip.id === clipId);
        if (current.project.id !== project.id || !videoClip ||
            videoClip.mediaId !== mediaItem.id ||
            current.project.mediaLibrary.items.find((m) => m.id === mediaItem.id)?.blob !== mediaItem.blob) {
          return {
            success: false,
            error: { code: "INVALID_PARAMS" as const, message: "The video or project changed during audio separation. Try again." },
          };
        }
        if (currentSourceTrack?.locked) {
          return {
            success: false,
            error: { code: "TRACK_LOCKED" as const, message: "Unlock the video track before separating audio." },
          };
        }

        const projectCopy = cloneProjectForEdit(current.project);
        projectCopy.mediaLibrary.items.push(...sources);
        const availableTracks = projectCopy.timeline.tracks.filter((track) =>
          track.type === "audio" && !track.locked && !track.muted && !track.hidden &&
          track.clips.every((clip) => clip.startTime + clip.duration <= videoClip.startTime ||
            clip.startTime >= videoClip.startTime + videoClip.duration),
        );
        const { actionExecutor } = current;
        const history = actionExecutor.getHistory();
        const undoSizeBefore = history.getUndoStackSize();
        history.beginGroup("Separate audio");
        let lastResult: ActionResult = { success: true };
        try {
          for (let index = 0; index < sources.length; index++) {
            const source = sources[index];
            const trackId = availableTracks[index]?.id ?? uuidv4();
            if (!availableTracks[index]) {
              lastResult = await actionExecutor.execute({
                type: "track/add", id: uuidv4(), timestamp: Date.now(),
                params: { trackType: "audio", trackId, name: source.name.replace(/\.wav$/, "") },
              }, projectCopy);
              if (!lastResult.success) return lastResult;
            }
            lastResult = await actionExecutor.execute({
              type: "clip/add", id: uuidv4(), timestamp: Date.now(),
              params: {
                trackId, mediaId: source.id, startTime: videoClip.startTime,
                sourceClip: {
                  ...videoClip,
                  id: uuidv4(), trackId, mediaId: source.id,
                  // Each extracted file contains exactly one audio stream.
                  audioTrackIndex: 0,
                  effects: [], keyframes: [],
                  metadata: { separatedFromClipId: clipId, sourceAudioTrackIndex: index },
                },
              },
            }, projectCopy);
            if (!lastResult.success) return lastResult;
          }
          lastResult = await actionExecutor.execute({
            type: "audio/setVolume", id: uuidv4(), timestamp: Date.now(),
            params: { clipId, volume: 0 },
          }, projectCopy);
          if (!lastResult.success) return lastResult;
          set({ project: { ...projectCopy, modifiedAt: Date.now() } });
          committed = true;
          return lastResult;
        } finally {
          history.endGroup();
          if (!committed && history.getUndoStackSize() > undoSizeBefore) {
            await actionExecutor.undo(projectCopy);
          }
        }
      } catch (error) {
        return {
          success: false,
          error: {
            code: "DECODE_ERROR" as const,
            message: error instanceof Error ? error.message : "Could not separate audio.",
          },
        };
      } finally {
        separatingClips.delete(requestKey);
        if (!committed) {
          await Promise.allSettled(persistedIds.map((id) => deleteMediaBlob(id)));
        }
      }
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
