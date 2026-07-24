import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action } from "@openreel/core";
import type { ProjectState } from "../project-store";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type MarkerSlice = Pick<
  ProjectState,
  "addMarker" | "removeMarker" | "updateMarker" | "getMarker" | "getMarkers"
>;

export function createMarkerSlice(set: Set, get: Get): MarkerSlice {
  return {
    addMarker: async (time, label = "Marker", color = "#3b82f6") => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "marker/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { time, label, color },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project, modifiedAt: Date.now() } });
      }
      return result;
    },

    removeMarker: async (markerId) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "marker/remove",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { markerId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project, modifiedAt: Date.now() } });
      }
      return result;
    },

    updateMarker: async (markerId, updates) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "marker/update",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { markerId, updates },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project, modifiedAt: Date.now() } });
      }
      return result;
    },

    getMarker: (markerId) =>
      get().project.timeline.markers.find((m) => m.id === markerId),

    getMarkers: () => get().project.timeline.markers,
  };
}
