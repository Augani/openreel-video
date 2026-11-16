import { cloneProjectForEdit } from "./clone-project-for-edit";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import { ActionHistory, type Action, type ActionResult } from "@openreel/core";
import { LazyActionExecutor } from "../../services/lazy-action-executor";
import { useUIStore } from "../ui-store";
import { useTimelineStore } from "../timeline-store";
import { planCloseGapBeforeClip, planRippleDelete, prepareClipSplit } from "@openreel/core";
import type { ProjectState } from "../project-store";
import { calculateTimelineDuration } from "./index";
import { extractAudioTracks } from "../../services/separate-audio";
import { saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

type ClipSlice = Pick<
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
  | "rippleDeleteClips"
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
      const { project, actionExecutor } = get();
      const blocked = () => useUIStore.getState().exportState.isExporting || Boolean(useTimelineStore.getState().playbackLockedReason);
      const failure = (message: string): ActionResult => ({ success: false, error: { code: "INVALID_PARAMS", message } });
      if (blocked()) return failure("Wait for the current operation before adding a clip.");
      const mediaItem = project.mediaLibrary.items.find(item => item.id === mediaId);
      if (!mediaItem) return { success: false, error: { code: "MEDIA_NOT_FOUND", message: "Media item not found" } };
      const sourceType = mediaItem.type;
      const sourceDuration = mediaItem.metadata.duration;
      const clipStartTime = startTime ?? calculateTimelineDuration(project);
      if (!Number.isFinite(clipStartTime) || clipStartTime < 0) return failure("Clip start time must be finite and non-negative.");
      const trackType = sourceType === "audio" ? "audio" : sourceType === "image" ? "image" : "video";
      const createdTrackId = `track-${uuidv4()}`;
      const history = actionExecutor.getHistory();
      // Membership belongs to this invocation, including an enclosing recipe.
      // Preparing the edit must never open or close another command's group.
      const groupId = history.getCurrentGroupId() ?? `placement-${uuidv4()}`;
      const owns = () => get().project.id === project.id && get().actionExecutor === actionExecutor && !blocked();
      const changed = () => failure("The project or source changed while the clip was being prepared. Try again.");
      // Both core actions only modify their new track. Existing tracks, source
      // Blobs, handles, waveforms and overlay data remain shared read-only data.
      const draft = { ...project, timeline: { ...project.timeline, tracks: [...project.timeline.tracks] } };
      const prepared = new LazyActionExecutor(new ActionHistory());
      const actions: Action[] = [
        { type: "track/add", id: uuidv4(), timestamp: Date.now(), params: { trackType, trackId: createdTrackId } },
        { type: "clip/add", id: uuidv4(), timestamp: Date.now(), params: { clipId: uuidv4(), trackId: createdTrackId, mediaId, startTime: clipStartTime } },
      ];
      let result: ActionResult = { success: true };
      for (const action of actions) {
        result = await prepared.execute(action, draft);
        if (!result.success) return result;
        if (!owns()) return changed();
      }
      const current = get().project;
      const source = current.mediaLibrary.items.find(item => item.id === mediaId);
      if (!source || source.type !== sourceType || !Object.is(source.metadata.duration, sourceDuration)) return changed();
      if (current.timeline.tracks.some(track => track.id === createdTrackId)) return changed();
      const newTrack = draft.timeline.tracks.find(track => track.id === createdTrackId)!;
      const prefix = trackType === "audio" ? "Audio" : trackType === "image" ? "Image" : "Video";
      const name = `${prefix} ${current.timeline.tracks.filter(track => track.type === trackType).length + 1}`;
      const tracks = [...current.timeline.tracks, { ...newTrack, name }];
      const next = { ...current, timeline: { ...current.timeline, tracks }, modifiedAt: Date.now() };
      // Record the already validated pair synchronously, then publish once.
      // Merge into the latest project so intervening edits are preserved.
      for (const entry of prepared.getHistory().getHistoryEntries()) {
        const forward = entry.action.type === "track/add" ? { ...entry.action, params: { ...entry.action.params, name } } : entry.action;
        history.push(forward, entry.inverseAction, groupId);
      }
      set({ project: { ...next, timeline: { ...next.timeline, duration: calculateTimelineDuration(next) } } });
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
        (clip) => (clip.metadata?.separatedFromClipId === clipId ||
          clip.metadata?.separatedFromClipId === (sourceClip.metadata?.splitSourceClipId ?? clipId)) &&
          Math.abs(clip.startTime - sourceClip.startTime) < 0.01 &&
          Math.abs(clip.inPoint - sourceClip.inPoint) < 0.01,
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
                  metadata: { separatedFromClipId: videoClip.metadata?.splitSourceClipId ?? clipId, sourceAudioTrackIndex: index },
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
      // A ripple-type edit: sync-locked tracks close the same gap (or block it).
      try {
        const state = get();
        return state.commitTimelineToolEdit(planCloseGapBeforeClip(state.getFullProject(), clipId, uuidv4()));
      } catch (error) {
        return { success: false, error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : "The gap could not be closed." } };
      }
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
      try {
        const state = get();
        return state.commitTimelineToolEdit(prepareClipSplit(state.getFullProject(), clipId, time, uuidv4()));
      } catch (error) {
        return { success: false, error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : "The clip could not be split." } };
      }
    },

    rippleDeleteClip: async (clipId: string) => get().rippleDeleteClips([clipId]),

    rippleDeleteClips: async (clipIds: readonly string[]) => {
      try {
        const state = get();
        return state.commitTimelineToolEdit(
          planRippleDelete(state.getFullProject(), clipIds, uuidv4()),
        );
      } catch (error) {
        return { success: false, error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : "The clips could not be deleted." } };
      }
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
      const current = get();
      if (current.project.id !== project.id || current.actionExecutor !== actionExecutor) return { success: false, error: { code: "INVALID_PARAMS", message: "The project changed before the slip finished." } };
      if (result.success) set({ project: { ...current.project } });
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
