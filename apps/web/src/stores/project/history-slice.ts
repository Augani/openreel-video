import type { StoreApi } from "zustand";
import type {
  Project,
  ShapeClip,
  TextClip,
  SVGClip,
  StickerClip,
} from "@openreel/core";
import type { ProjectState } from "../project-store";
import type { ProjectStoreHelpers } from "./store-helpers";
import type {
  EditingTemplateHistoryEntry,
  EditingTemplateApplicationState,
} from "./index";
import { useEngineStore } from "../engine-store";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export interface HistoryDeps {
  applyClipDataSnapshot: ProjectStoreHelpers["applyClipDataSnapshot"];
  syncOverlayEnginesFromProject: ProjectStoreHelpers["syncOverlayEnginesFromProject"];
  syncProjectEffectsBridge: (next: Project, prev?: Project) => void;
  syncProjectTransitionsBridge: (next: Project, prev?: Project) => void;
  getEditingTemplateApplicationState: (
    entry: EditingTemplateHistoryEntry,
  ) => EditingTemplateApplicationState;
  removeEditingTemplateApplicationStateFromProject: (
    project: Project,
    applicationState: EditingTemplateApplicationState,
    removeEmptyTracks?: boolean,
  ) => Project;
  restoreEditingTemplateApplicationState: (
    project: Project,
    applicationState: EditingTemplateApplicationState,
  ) => Project | null;
}

export type HistorySlice = Pick<
  ProjectState,
  | "beginHistoryGroup"
  | "endHistoryGroup"
  | "undo"
  | "redo"
  | "canUndo"
  | "canRedo"
>;

export function createHistorySlice(
  set: Set,
  get: Get,
  deps: HistoryDeps,
): HistorySlice {
  const {
    applyClipDataSnapshot,
    syncOverlayEnginesFromProject,
    syncProjectEffectsBridge,
    syncProjectTransitionsBridge,
    getEditingTemplateApplicationState,
    removeEditingTemplateApplicationStateFromProject,
    restoreEditingTemplateApplicationState,
  } = deps;

  return {
    beginHistoryGroup: (description?: string) => {
      get().actionExecutor.getHistory().beginGroup(description);
    },

    endHistoryGroup: () => {
      get().actionExecutor.getHistory().endGroup();
    },

    undo: async () => {
      const {
        project,
        actionExecutor,
        actionHistory,
        clipUndoStack,
        clipRedoStack,
        templateUndoStack,
        templateRedoStack,
      } = get();

      const latestActionTimestamp = actionHistory.peekUndo()?.timestamp ?? -1;
      const latestClipTimestamp =
        clipUndoStack.length > 0
          ? clipUndoStack[clipUndoStack.length - 1].timestamp
          : -1;
      const latestTemplateTimestamp =
        templateUndoStack.length > 0
          ? templateUndoStack[templateUndoStack.length - 1].timestamp
          : -1;

      if (
        latestTemplateTimestamp >= 0 &&
        latestTemplateTimestamp >= latestClipTimestamp &&
        latestTemplateTimestamp > latestActionTimestamp
      ) {
        const entry = templateUndoStack[templateUndoStack.length - 1];
        const removedProject = removeEditingTemplateApplicationStateFromProject(
          project,
          getEditingTemplateApplicationState(entry),
        );
        const updatedProject = entry.previousState
          ? restoreEditingTemplateApplicationState(
              removedProject,
              entry.previousState,
            )
          : removedProject;

        if (!updatedProject) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: "Failed to undo editing template update",
            },
          };
        }

        set({
          project: updatedProject,
          templateUndoStack: templateUndoStack.slice(0, -1),
          templateRedoStack: [
            ...templateRedoStack,
            { ...entry, timestamp: Date.now() },
          ],
          redoJournal: [...get().redoJournal, "template"],
        });

        return { success: true };
      }

      if (
        latestClipTimestamp >= 0 &&
        latestClipTimestamp > latestActionTimestamp
      ) {
        const entry = clipUndoStack[clipUndoStack.length - 1];

        if (entry.op === "update") {
          const restored = applyClipDataSnapshot(
            entry.type,
            entry.clipId,
            entry.clipData,
          );
          if (restored) {
            set({
              project: { ...project, modifiedAt: Date.now() },
              clipUndoStack: clipUndoStack.slice(0, -1),
              clipRedoStack: [
                ...clipRedoStack,
                { ...entry, timestamp: Date.now() },
              ],
            });
            return { success: true };
          }
        }

        let deleted = false;

        if (entry.type === "shape") {
          deleted =
            useEngineStore.getState().getGraphicsEngine()?.deleteShapeClip(
              entry.clipId,
            ) ?? false;
        } else if (entry.type === "text") {
          deleted =
            useEngineStore.getState().getTitleEngine()?.deleteTextClip(
              entry.clipId,
            ) ?? false;
        } else if (entry.type === "svg") {
          deleted =
            useEngineStore.getState().getGraphicsEngine()?.deleteSVGClip(
              entry.clipId,
            ) ?? false;
        } else if (entry.type === "sticker") {
          deleted =
            useEngineStore.getState().getGraphicsEngine()?.deleteStickerClip(
              entry.clipId,
            ) ?? false;
        }

        if (deleted) {
          set({
            project: { ...project, modifiedAt: Date.now() },
            clipUndoStack: clipUndoStack.slice(0, -1),
            clipRedoStack: [
              ...clipRedoStack,
              { ...entry, timestamp: Date.now(), hadEmptyTrackUndo: false },
            ],
          });

          const trackId = entry.trackId;
          const updatedProject = get().project;
          const track = updatedProject.timeline.tracks.find(
            (t) => t.id === trackId,
          );

          if (track) {
            let trackHasClips = false;
            if (track.type === "text") {
              const textClips =
                useEngineStore.getState().getTitleEngine()?.getAllTextClips() ||
                [];
              trackHasClips = textClips.some((c) => c.trackId === trackId);
            } else if (track.type === "graphics") {
              const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
              const shapeClips = graphicsEngine?.getAllShapeClips() || [];
              const svgClips = graphicsEngine?.getAllSVGClips() || [];
              const stickerClips = graphicsEngine?.getAllStickerClips() || [];
              trackHasClips = [...shapeClips, ...svgClips, ...stickerClips].some(
                (c) => c.trackId === trackId,
              );
            } else {
              trackHasClips = track.clips.length > 0;
            }

            if (!trackHasClips) {
              const lastEntry = get().actionHistory.peekUndo();
              const lastAction = lastEntry?.action;
              type TrackType = "video" | "audio" | "image" | "text" | "graphics";
              const clipTypeToTrackType: Record<string, TrackType> = {
                text: "text",
                shape: "graphics",
                svg: "graphics",
                sticker: "graphics",
              };
              const expectedTrackType: TrackType =
                clipTypeToTrackType[entry.type] || (track.type as TrackType);
              const actionTrackType = lastAction?.params?.trackType as
                | string
                | undefined;

              if (
                lastAction &&
                lastAction.type === "track/add" &&
                actionTrackType === expectedTrackType
              ) {
                const trackUndoResult = await actionExecutor.undo(get().project);
                if (trackUndoResult.success) {
                  const updatedRedoStack = get().clipRedoStack;
                  if (updatedRedoStack.length > 0) {
                    const lastRedoEntry =
                      updatedRedoStack[updatedRedoStack.length - 1];
                    set({
                      project: { ...get().project },
                      clipRedoStack: [
                        ...updatedRedoStack.slice(0, -1),
                        {
                          ...lastRedoEntry,
                          hadEmptyTrackUndo: true,
                          trackType: expectedTrackType,
                        },
                      ],
                    });
                  }
                }
              }
            }
          }

          return { success: true };
        }
      }

      const result = await actionExecutor.undo(project);
      if (result.success) {
        set({
          project: { ...project, modifiedAt: Date.now() },
          redoJournal: [...get().redoJournal, "action"],
        });
        syncProjectEffectsBridge(get().project, get().project);
        syncProjectTransitionsBridge(get().project, get().project);
        syncOverlayEnginesFromProject();
      }
      return result;
    },

    redo: async () => {
      const {
        project,
        actionExecutor,
        clipUndoStack,
        clipRedoStack,
        templateUndoStack,
        templateRedoStack,
      } = get();

      const journal = [...get().redoJournal];
      let target: "action" | "clip" | "template" | null = null;
      while (journal.length > 0) {
        const stack = journal.pop();
        if (stack === "template" && templateRedoStack.length > 0) {
          target = "template";
          break;
        }
        if (stack === "clip" && clipRedoStack.length > 0) {
          target = "clip";
          break;
        }
        if (stack === "action" && actionExecutor.getHistory().canRedo()) {
          target = "action";
          break;
        }
      }
      if (!target) {
        journal.length = 0;
        target =
          templateRedoStack.length > 0
            ? "template"
            : clipRedoStack.length > 0
              ? "clip"
              : actionExecutor.getHistory().canRedo()
                ? "action"
                : null;
      }
      if (!target) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: "Nothing to redo" },
        };
      }
      const nextJournal = journal;

      if (target === "template" && templateRedoStack.length > 0) {
        const entry = templateRedoStack[templateRedoStack.length - 1];
        const cleanedProject = entry.previousState
          ? removeEditingTemplateApplicationStateFromProject(
              project,
              entry.previousState,
            )
          : project;
        const updatedProject = restoreEditingTemplateApplicationState(
          cleanedProject,
          getEditingTemplateApplicationState(entry),
        );

        if (!updatedProject) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: "Failed to restore editing template application",
            },
          };
        }

        set({
          project: updatedProject,
          templateUndoStack: [
            ...templateUndoStack,
            { ...entry, timestamp: Date.now() },
          ],
          templateRedoStack: templateRedoStack.slice(0, -1),
          redoJournal: nextJournal,
        });

        return { success: true };
      }

      if (target === "clip" && clipRedoStack.length > 0) {
        const entry = clipRedoStack[clipRedoStack.length - 1];

        if (entry.op === "update" && entry.afterData) {
          const reapplied = applyClipDataSnapshot(
            entry.type,
            entry.clipId,
            entry.afterData,
          );
          if (reapplied) {
            set({
              project: { ...get().project, modifiedAt: Date.now() },
              clipUndoStack: [
                ...clipUndoStack,
                { ...entry, timestamp: Date.now() },
              ],
              clipRedoStack: clipRedoStack.slice(0, -1),
            });
            return { success: true };
          }
        }

        let restored = false;
        let newTrackId: string | undefined;

        if (entry.hadEmptyTrackUndo && entry.trackType) {
          const trackRedoResult = await actionExecutor.redo(get().project);
          if (!trackRedoResult.success) {
            return trackRedoResult;
          }
          const updatedProject = get().project;
          const tracksOfType = updatedProject.timeline.tracks.filter(
            (t) => t.type === entry.trackType,
          );
          if (tracksOfType.length > 0) {
            newTrackId = tracksOfType[tracksOfType.length - 1].id;
          }
          set({ project: { ...updatedProject } });
        }

        const targetTrackId = newTrackId || entry.trackId;

        if (entry.type === "shape") {
          const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
          if (graphicsEngine) {
            const shapeData = entry.clipData as ShapeClip;
            graphicsEngine.createShape(
              {
                shapeType: shapeData.shapeType,
                width: 200,
                height: 200,
                style: shapeData.style,
              },
              targetTrackId,
              shapeData.startTime,
              shapeData.duration,
            );
            restored = true;
          }
        } else if (entry.type === "text") {
          const titleEngine = useEngineStore.getState().getTitleEngine();
          if (titleEngine) {
            const textData = entry.clipData as TextClip;
            titleEngine.createTextClip({
              trackId: targetTrackId,
              startTime: textData.startTime,
              text: textData.text,
              duration: textData.duration,
              style: textData.style,
            });
            restored = true;
          }
        } else if (entry.type === "svg") {
          const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
          if (graphicsEngine) {
            const svgData = entry.clipData as SVGClip;
            graphicsEngine.importSVG(
              svgData.svgContent,
              targetTrackId,
              svgData.startTime,
              svgData.duration,
            );
            restored = true;
          }
        } else if (entry.type === "sticker") {
          const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
          if (graphicsEngine) {
            const stickerData = entry.clipData as StickerClip;
            graphicsEngine.addStickerClip({
              ...stickerData,
              trackId: targetTrackId,
            });
            restored = true;
          }
        }

        if (restored) {
          const updatedEntry = newTrackId
            ? {
                ...entry,
                trackId: newTrackId,
                clipData: { ...entry.clipData, trackId: newTrackId },
              }
            : entry;

          set({
            project: { ...get().project, modifiedAt: Date.now() },
            clipUndoStack: [
              ...clipUndoStack,
              { ...updatedEntry, timestamp: Date.now() },
            ],
            clipRedoStack: clipRedoStack.slice(0, -1),
          });
          return { success: true };
        }
      }

      const result = await actionExecutor.redo(project);
      if (result.success) {
        set({
          project: { ...project, modifiedAt: Date.now() },
          redoJournal: nextJournal,
        });
        syncProjectEffectsBridge(get().project, get().project);
        syncProjectTransitionsBridge(get().project, get().project);
        syncOverlayEnginesFromProject();
      }
      return result;
    },

    canUndo: () => {
      const { actionHistory, clipUndoStack, templateUndoStack } = get();
      return (
        templateUndoStack.length > 0 ||
        clipUndoStack.length > 0 ||
        actionHistory.canUndo()
      );
    },

    canRedo: () => {
      const { actionHistory, clipRedoStack, templateRedoStack } = get();
      return (
        templateRedoStack.length > 0 ||
        clipRedoStack.length > 0 ||
        actionHistory.canRedo()
      );
    },
  };
}
