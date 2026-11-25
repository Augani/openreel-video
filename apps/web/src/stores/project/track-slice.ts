import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { cloneProjectForEdit } from "./clone-project-for-edit";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, ActionResult, Project } from "@openreel/core";
import { planRemoveGaps, withUniversalTracksCapability } from "@openreel/core";
import type { ProjectState } from "../project-store";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

type TrackSlice = Pick<
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
  | "setTrackSyncLock"
  | "setTrackSoloSafe"
  | "setAudioRack"
  | "applyAudioRouting"
  | "applyMixerSnapshot"
  | "setTrackAutomation"
  | "setTrackAutomationMode"
  | "recordTrackAutomation"
  | "groupTracks"
  | "getTrack"
  | "consolidateTrack"
>;

export function createTrackSlice(set: Set, get: Get): TrackSlice {
  const commitGrouping = (tracks: Project["timeline"]["tracks"]) => {
    const { project, actionHistory } = get();
    if (tracks.every((track, index) => track.groupId === project.timeline.tracks[index]?.groupId)) return;
    const next = { ...project, timeline: { ...project.timeline, tracks }, modifiedAt: Date.now() };
    // Grouping is synchronous, including caption insertion. Record both sides
    // at this boundary using the existing portable edit-snapshot action.
    const action: Action = { type: "project/applyEditSnapshot", id: uuidv4(), timestamp: Date.now(),
      params: { snapshot: editSnapshot(cloneProjectForEdit(next)) } };
    const inverse: Action = { type: "project/applyEditSnapshot", id: uuidv4(), timestamp: action.timestamp,
      params: { snapshot: editSnapshot(cloneProjectForEdit(project)) } };
    actionHistory.push(action, inverse);
    set({ project: next });
  };
  return {
    addTrack: async (trackType, position, options) => {
      const { project, actionExecutor } = get();
      const projectCopy = cloneProjectForEdit(project);
      const trackId = options?.trackId ?? `track-${uuidv4()}`;
      const action: Action = {
        type: "track/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackType, position, ...options, trackId },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        const finalProject: Project = {
          ...projectCopy,
          modifiedAt: Date.now(),
        };
        set({
          project:
            options?.mode === "standard"
              ? withUniversalTracksCapability(finalProject)
              : finalProject,
        });
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
      const projectCopy = cloneProjectForEdit(project);
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
      const projectCopy = cloneProjectForEdit(project);
      const action: Action = {
        type: "track/reorder",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, newPosition },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
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

    setTrackSyncLock: async (trackId, syncLock) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/setSyncLock",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, syncLock },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    setTrackSoloSafe: async (trackId, soloSafe) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "track/setSoloSafe",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, soloSafe },
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

    setAudioRack: async (target, rack) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "audioRack/set",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { target, rack },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    applyAudioRouting: async (plan) => {
      if (!plan.ok) {
        return { success: false, error: { code: "INVALID_PARAMS", message: plan.message } } as ActionResult;
      }
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "audioRouting/set",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { ...plan.params, label: plan.label } as unknown as Action["params"],
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    applyMixerSnapshot: async (plan) => {
      if (!plan.ok) {
        return { success: false, error: { code: "INVALID_PARAMS", message: plan.message } } as ActionResult;
      }
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "audioMixer/snapshot",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { ...plan.params, label: plan.label } as unknown as Action["params"],
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    setTrackAutomation: async (trackId, lane, points) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "trackAutomation/set",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, lane, points },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    setTrackAutomationMode: async (trackId, mode) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "trackAutomation/setMode",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, mode },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    recordTrackAutomation: async (passes) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "trackAutomation/record",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { passes } as unknown as Action["params"],
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
        commitGrouping(project.timeline.tracks.map((track) =>
          track.id === trackId || (groupMembers.length === 2 && track.groupId === source.groupId)
            ? { ...track, groupId: undefined } : track,
        ));
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
      commitGrouping(project.timeline.tracks.map((track) =>
        track.id === source.id || track.id === partner.id || (track.groupId ? mergedGroupIds.has(track.groupId) : false)
          ? { ...track, groupId } : track,
      ));
      return true;
    },

    getTrack: (trackId) =>
      get().project.timeline.tracks.find((track) => track.id === trackId),

    consolidateTrack: async (trackId) => {
      // Remove Gaps is a ripple-type edit: sync-locked tracks close the same
      // ranges (or the edit is blocked); one undo step.
      try {
        const state = get();
        return state.commitTimelineToolEdit(planRemoveGaps(state.getFullProject(), trackId, uuidv4()));
      } catch (error) {
        return { success: false, error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : "The gaps could not be removed." } };
      }
    },
  };
}
