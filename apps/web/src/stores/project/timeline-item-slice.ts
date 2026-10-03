import { cloneProjectForEdit } from "./clone-project-for-edit";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, ActionResult } from "@openreel/core";
import {
  resolveTimelineItem,
  resolveTimelinePlacement,
  withUniversalTracksCapability,
} from "@openreel/core";
import type { ProjectState } from "../project-store";
import type { ProjectStoreHelpers } from "./store-helpers";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type TimelineItemSlice = Pick<
  ProjectState,
  "placeMediaClip" | "moveTimelineItem"
>;

const failure = (
  code: "INVALID_PARAMS" | "TRACK_NOT_FOUND" | "TRACK_LOCKED" | "OVERLAP_DETECTED",
  message: string,
): ActionResult => ({ success: false, error: { code, message } });

export function createTimelineItemSlice(
  set: Set,
  get: Get,
  helpers: ProjectStoreHelpers,
): TimelineItemSlice {
  const executePlacement = async (
    actions: Action[],
    description: string,
  ): Promise<ActionResult> => {
    const { project, actionExecutor } = get();
    const projectCopy = cloneProjectForEdit(project);
    const history = actionExecutor.getHistory();
    history.beginGroup(description);
    let results: ActionResult[] = [];
    try {
      results = await actionExecutor.executeMany(actions, projectCopy);
    } finally {
      history.endGroup();
    }
    const failed = results.find((result) => !result.success);
    if (failed) return failed;

    const nextProject = withUniversalTracksCapability({
      ...projectCopy,
      modifiedAt: Date.now(),
    });
    set({ project: nextProject });
    helpers.syncOverlayEnginesFromProject();
    return results.at(-1) ?? { success: true };
  };

  return {
    placeMediaClip: async (mediaId, targetTrackId, startTime) => {
      const { project } = get();
      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === mediaId,
      );
      if (!mediaItem) return failure("INVALID_PARAMS", "Media item not found");

      const duration =
        mediaItem.metadata.duration > 0 ? mediaItem.metadata.duration : 5;
      const newTrackId = uuidv4();
      const placement = targetTrackId
        ? resolveTimelinePlacement(project, {
            targetTrackId,
            startTime,
            duration,
            policy: "stack-above",
            newTrackId,
          })
        : {
            ok: true as const,
            trackId: newTrackId,
            startTime: Math.max(0, startTime),
            createdTrack: {
              id: newTrackId,
              position: project.timeline.tracks.length,
            },
          };

      if (!placement.ok) {
        if (placement.reason === "track-not-found") {
          return failure("TRACK_NOT_FOUND", "Destination track not found");
        }
        if (placement.reason === "track-locked") {
          return failure("TRACK_LOCKED", "Destination track is locked");
        }
        return failure("OVERLAP_DETECTED", "The destination interval is occupied");
      }

      const actions: Action[] = [];
      if (placement.createdTrack) {
        actions.push({
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackType: "video",
            trackId: placement.createdTrack.id,
            position: placement.createdTrack.position,
            mode: "standard",
          },
        });
      }
      actions.push({
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          clipId: uuidv4(),
          trackId: placement.trackId,
          mediaId,
          startTime: placement.startTime,
          duration,
        },
      });
      return executePlacement(actions, "Place media");
    },

    moveTimelineItem: async (itemId, startTime, targetTrackId) => {
      const { project } = get();
      const resolved = resolveTimelineItem(project, itemId);
      if (!resolved) return failure("INVALID_PARAMS", "Timeline item not found");
      const sourceTrack = project.timeline.tracks.find(
        (track) => track.id === resolved.trackId,
      );
      if (sourceTrack?.locked) {
        return failure("TRACK_LOCKED", "Source track is locked");
      }

      const requestedTrackId = targetTrackId ?? resolved.trackId;
      const placement = resolveTimelinePlacement(project, {
        targetTrackId: requestedTrackId,
        startTime,
        duration: resolved.duration,
        policy: targetTrackId ? "stack-above" : "gap",
        excludeItemIds: [itemId],
        newTrackId: uuidv4(),
      });
      if (!placement.ok) {
        if (placement.reason === "track-not-found") {
          return failure("TRACK_NOT_FOUND", "Destination track not found");
        }
        if (placement.reason === "track-locked") {
          return failure("TRACK_LOCKED", "Destination track is locked");
        }
        return failure("OVERLAP_DETECTED", "The destination interval is occupied");
      }

      const actions: Action[] = [];
      if (placement.createdTrack) {
        actions.push({
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackType: "video",
            trackId: placement.createdTrack.id,
            position: placement.createdTrack.position,
            mode: "standard",
          },
        });
      }
      if (resolved.kind === "media") {
        actions.push({
          type: "clip/move",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            clipId: itemId,
            startTime: placement.startTime,
            trackId: placement.trackId,
          },
        });
      } else if (
        resolved.kind === "text" ||
        resolved.kind === "shape" ||
        resolved.kind === "svg" ||
        resolved.kind === "sticker"
      ) {
        actions.push({
          type: `${resolved.kind}/update`,
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            clipId: itemId,
            updates: {
              startTime: placement.startTime,
              trackId: placement.trackId,
            },
          },
        });
      } else {
        return failure(
          "INVALID_PARAMS",
          "This timeline item cannot be moved from the timeline yet",
        );
      }

      return executePlacement(actions, "Move timeline item");
    },
  };
}
