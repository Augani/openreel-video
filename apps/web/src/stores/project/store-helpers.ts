import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type {
  Action,
  Project,
  ShapeClip,
  TextClip,
  SVGClip,
  StickerClip,
} from "@openreel/core";
import {
  calculateProjectDuration,
  withUniversalTracksCapability,
} from "@openreel/core";
import type { ProjectState } from "../project-store";
import type { ClipHistoryEntryType } from "./index";
import { useEngineStore } from "../engine-store";
import { getLoadedOptionalEngineModules, loadOptionalEngineModules, whenEngineModulesLoaded } from "../../services/lazy-engines";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

type OverlayField = "textClips" | "shapeClips" | "svgClips" | "stickerClips";

export interface ProjectStoreHelpers {
  applyClipDataSnapshot(
    type: ClipHistoryEntryType,
    clipId: string,
    data: ShapeClip | TextClip | SVGClip | StickerClip,
  ): boolean;
  cloneClipSnapshot<T>(clip: T): T;
  recordOverlayCreate(
    prefix: string,
    field: OverlayField,
    clip: { id: string; trackId: string },
  ): void;
  recordOverlayUpdate(
    prefix: string,
    field: OverlayField,
    clipId: string,
    updatedClip: { id: string },
    before: { id: string } | undefined,
  ): void;
  recordOverlayRemove(
    prefix: string,
    field: OverlayField,
    clipId: string,
    before: { id: string } | undefined,
  ): void;
  syncOverlayEnginesFromProject(project?: Project): void;
}

export function createProjectStoreHelpers(
  set: Set,
  get: Get,
): ProjectStoreHelpers {
  const cloneClipSnapshot = <T,>(clip: T): T =>
    JSON.parse(JSON.stringify(clip)) as T;

  const overlayList = (
    project: Project,
    field: OverlayField,
  ): Array<{ id: string }> =>
    ((project as unknown as Record<string, Array<{ id: string }>>)[field] ??
      []) as Array<{ id: string }>;

  const applyClipDataSnapshot = (
    type: ClipHistoryEntryType,
    clipId: string,
    data: ShapeClip | TextClip | SVGClip | StickerClip,
  ): boolean => {
    if (type === "text") {
      const engine = useEngineStore.getState().getTitleEngine();
      return engine
        ? Boolean(engine.updateTextClip(clipId, data as Partial<TextClip>))
        : false;
    }
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    if (!graphicsEngine) return false;
    if (type === "shape") {
      return Boolean(
        graphicsEngine.updateShapeClip(clipId, data as Partial<ShapeClip>),
      );
    }
    if (type === "svg") {
      return Boolean(
        graphicsEngine.updateSVGClip(clipId, data as Partial<SVGClip>),
      );
    }
    return Boolean(
      graphicsEngine.updateStickerClip(clipId, data as Partial<StickerClip>),
    );
  };

  const recordOverlayCreate = (
    prefix: string,
    field: OverlayField,
    clip: { id: string; trackId: string },
  ): void => {
    const { project, actionExecutor } = get();
    const actionId = uuidv4();
    const snap = cloneClipSnapshot(clip);
    const action: Action = {
      type: `${prefix}/create`,
      id: actionId,
      timestamp: Date.now(),
      params: { clip: snap },
    };
    const inverse: Action = {
      type: `${prefix}/remove`,
      id: `inverse-${actionId}`,
      timestamp: Date.now(),
      params: { clipId: clip.id },
    };
    const rawNextProject = {
      ...project,
      [field]: [...overlayList(project, field), snap],
      modifiedAt: Date.now(),
    } as Project;
    const ownerTrack = project.timeline.tracks.find(
      (track) => track.id === clip.trackId,
    );
    const expectedTrackType = prefix === "text" ? "text" : "graphics";
    const nextProject =
      ownerTrack?.mode === "standard" || ownerTrack?.type !== expectedTrackType
        ? withUniversalTracksCapability(rawNextProject)
        : rawNextProject;
    set({
      project: {
        ...nextProject,
        timeline: {
          ...nextProject.timeline,
          duration: calculateProjectDuration(nextProject),
        },
      },
      clipRedoStack: [],
    });
    actionExecutor.getHistory().push(action, inverse);
  };

  const recordOverlayUpdate = (
    prefix: string,
    field: OverlayField,
    clipId: string,
    updatedClip: { id: string },
    before: { id: string } | undefined,
  ): void => {
    const { project, actionExecutor } = get();
    const actionId = uuidv4();
    const after = cloneClipSnapshot(updatedClip);
    const action: Action = {
      type: `${prefix}/update`,
      id: actionId,
      timestamp: Date.now(),
      params: { clipId, updates: after },
    };
    const inverse: Action = {
      type: `${prefix}/update`,
      id: `inverse-${actionId}`,
      timestamp: Date.now(),
      params: {
        clipId,
        updates: before ? cloneClipSnapshot(before) : {},
        unset: before
          ? Object.keys(after).filter((key) => !Object.prototype.hasOwnProperty.call(before, key))
          : [],
      },
    };
    const list = overlayList(project, field);
    const next = list.some((c) => c.id === clipId)
      ? list.map((c) => (c.id === clipId ? after : c))
      : [...list, after];
    const nextProject = {
      ...project,
      [field]: next,
      modifiedAt: Date.now(),
    } as Project;
    set({
      project: {
        ...nextProject,
        timeline: {
          ...nextProject.timeline,
          duration: calculateProjectDuration(nextProject),
        },
      },
      clipRedoStack: [],
    });
    actionExecutor.getHistory().push(action, inverse);
  };

  const recordOverlayRemove = (
    prefix: string,
    field: OverlayField,
    clipId: string,
    before: { id: string } | undefined,
  ): void => {
    const { project, actionExecutor } = get();
    const actionId = uuidv4();
    const action: Action = {
      type: `${prefix}/remove`,
      id: actionId,
      timestamp: Date.now(),
      params: { clipId },
    };
    const inverse: Action | null = before
      ? {
          type: `${prefix}/create`,
          id: `inverse-${actionId}`,
          timestamp: Date.now(),
          params: { clip: cloneClipSnapshot(before) },
        }
      : null;
    const nextProject = {
      ...project,
      [field]: overlayList(project, field).filter((c) => c.id !== clipId),
      modifiedAt: Date.now(),
    } as Project;
    set({
      project: {
        ...nextProject,
        timeline: {
          ...nextProject.timeline,
          duration: calculateProjectDuration(nextProject),
        },
      },
      clipRedoStack: [],
    });
    actionExecutor.getHistory().push(action, inverse);
  };

  /**
   * Pushes the project into the (lazily loaded) engines. Runs synchronously
   * when the engine modules are already resolved; on a cold start it replays,
   * against the then-current project, as soon as they are.
   */
  const syncOverlayEnginesFromProject = (explicitProject?: Project): void => {
    whenEngineModulesLoaded((engines) => {
    const project = explicitProject ?? get().project;
    useEngineStore
      .getState()
      .getTitleEngine()
      ?.loadTextClips(project.textClips ?? []);
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    if (graphicsEngine) {
      graphicsEngine.loadShapeClips(project.shapeClips ?? []);
      graphicsEngine.loadSVGClips(project.svgClips ?? []);
      graphicsEngine.loadStickerClips(project.stickerClips ?? []);
    }
    const speedEngine = engines.getSpeedEngine();
    for (const track of project.timeline.tracks) {
      for (const c of track.clips) {
        const sourceSpan = c.outPoint - c.inPoint;
        speedEngine.setClipSpeed(c.id, Math.abs(c.speed ?? 1), sourceSpan);
        speedEngine.setReverse(c.id, c.reversed === true || (c.speed ?? 1) < 0, sourceSpan);
      }
    }
    const chromaClips = project.timeline.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.chromaKey);
    if (chromaClips.length > 0) {
      void useEngineStore
        .getState()
        .getChromaKeyEngine()
        .then((engine) => {
          for (const c of chromaClips) {
            if (c.chromaKey) engine.setSettings(c.id, c.chromaKey);
          }
        });
    }
    engines.getAdjustmentLayerEngine().loadLayers(project.adjustmentLayers ?? []);
    if (project.masks) {
      void useEngineStore
        .getState()
        .getMaskEngine()
        .then((engine) => engine.loadMasks(project.masks ?? []));
    }
    // Multicam is not a first-paint feature: its engine is only loaded for a project that has groups (or once it was
    // loaded earlier in the session, so switching to a project without groups clears the old ones).
    const multicamGroups = project.multicamGroups ?? [];
    const loadedOptional = getLoadedOptionalEngineModules();
    if (loadedOptional) loadedOptional.multicamEngine.loadGroups(multicamGroups);
    else if (multicamGroups.length > 0) {
      void loadOptionalEngineModules().then((optional) => optional.multicamEngine.loadGroups(multicamGroups));
    }
    if (project.compoundClips || project.nestedInstances) {
      engines.getNestedSequenceEngine().loadState(
        project.compoundClips ?? [],
        project.nestedInstances ?? [],
      );
    }
    });
  };

  return {
    applyClipDataSnapshot,
    cloneClipSnapshot,
    recordOverlayCreate,
    recordOverlayUpdate,
    recordOverlayRemove,
    syncOverlayEnginesFromProject,
  };
}
