import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, Project } from "@openreel/core";
import type { ProjectState } from "../project-store";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type TrackSlice = Pick<
  ProjectState,
  | "addTrack"
  | "duplicateTrack"
  | "removeTrack"
  | "renameTrack"
  | "reorderTrack"
  | "lockTrack"
  | "hideTrack"
  | "muteTrack"
  | "soloTrack"
  | "groupTracks"
  | "getTrack"
  | "consolidateTrack"
>;

export function createTrackSlice(set: Set, get: Get): TrackSlice {
  return {
    addTrack: async (trackType, position) => {
      const { project, actionExecutor } = get();
      const projectCopy = structuredClone(project);
      const action: Action = {
        type: "track/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackType, position },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        const finalProject: Project = {
          ...projectCopy,
          modifiedAt: Date.now(),
        };
        set({ project: finalProject });
      }
      return result;
    },

    duplicateTrack: async (trackId) => {
      const { project, actionExecutor } = get();
      const sourceIndex = project.timeline.tracks.findIndex(
        (track) => track.id === trackId,
      );
      if (sourceIndex < 0) {
        return {
          success: false,
          error: { code: "TRACK_NOT_FOUND", message: "Track not found" },
        };
      }
      const projectCopy = structuredClone(project);
      const action: Action = {
        type: "track/duplicate",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { sourceTrackId: trackId, position: sourceIndex + 1 },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    removeTrack: async (trackId) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/remove",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({
          project: {
            ...project,
            timeline: { ...project.timeline },
            modifiedAt: Date.now(),
          },
        });
      }
      return result;
    },

    renameTrack: async (trackId, name) => {
      const { project, actionExecutor } = get();
      const trimmed = name.trim();
      if (!trimmed) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS",
            message: "Track name cannot be empty",
          },
        };
      }
      const action: Action = {
        type: "track/rename",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, name: trimmed },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project, modifiedAt: Date.now() } });
      }
      return result;
    },

    reorderTrack: async (trackId, newPosition) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/reorder",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, newPosition },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project, modifiedAt: Date.now() } });
      }
      return result;
    },

    lockTrack: async (trackId, locked) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/lock",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, locked },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    hideTrack: async (trackId, hidden) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/hide",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, hidden },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    muteTrack: async (trackId, muted) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/mute",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, muted },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    soloTrack: async (trackId, solo) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/solo",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, solo },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    groupTracks: (trackId, partnerTrackId) => {
      const { project } = get();
      const source = project.timeline.tracks.find((track) => track.id === trackId);
      if (!source) return false;

      if (!partnerTrackId) {
        if (!source.groupId) return true;
        const groupMembers = project.timeline.tracks.filter(
          (track) => track.groupId === source.groupId,
        );
        set({
          project: {
            ...project,
            timeline: {
              ...project.timeline,
              tracks: project.timeline.tracks.map((track) =>
                track.id === trackId ||
                (groupMembers.length === 2 && track.groupId === source.groupId)
                  ? { ...track, groupId: undefined }
                  : track,
              ),
            },
            modifiedAt: Date.now(),
          },
        });
        return true;
      }

      const partner = project.timeline.tracks.find(
        (track) => track.id === partnerTrackId,
      );
      if (!partner || partner.id === source.id) return false;
      const groupId = source.groupId ?? partner.groupId ?? `track-group-${uuidv4()}`;
      const mergedGroupIds = new Set(
        [source.groupId, partner.groupId].filter(Boolean) as string[],
      );
      set({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            tracks: project.timeline.tracks.map((track) =>
              track.id === source.id ||
              track.id === partner.id ||
              (track.groupId ? mergedGroupIds.has(track.groupId) : false)
                ? { ...track, groupId }
                : track,
            ),
          },
          modifiedAt: Date.now(),
        },
      });
      return true;
    },

    getTrack: (trackId) =>
      get().project.timeline.tracks.find((track) => track.id === trackId),

    consolidateTrack: async (trackId) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/consolidate",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },
  };
}
