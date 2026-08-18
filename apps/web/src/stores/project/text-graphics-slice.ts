import type { StoreApi } from "zustand";
import { textAnimationEngine } from "@openreel/core";
import type {
  TextStyle,
  TextAnimation,
  TextAnimationPreset,
  TextAnimationParams,
  Transform,
  Keyframe,
  ShapeType,
  ShapeStyle,
  ShapeClip,
  SVGClip,
  StickerClip,
  TextClip,
  Text3DSettings,
} from "@openreel/core";
import type { ProjectState } from "../project-store";
import type { ProjectStoreHelpers } from "./store-helpers";
import { useEngineStore } from "../engine-store";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];
type OverlayClip = TextClip | ShapeClip | SVGClip | StickerClip;
type OverlayField = "textClips" | "shapeClips" | "svgClips" | "stickerClips";
type OverlayKind = "text" | "shape" | "svg" | "sticker";
type OverlayTimingUpdates = {
  startTime?: number;
  duration?: number;
  keyframes?: Keyframe[];
};

export type TextGraphicsSlice = Pick<
  ProjectState,
  | "createTextClip"
  | "updateTextContent"
  | "updateTextStyle"
  | "updateTextAnimation"
  | "updateTextTransform"
  | "updateTextBehindSubject"
  | "updateText3D"
  | "getTextClip"
  | "getAllTextClips"
  | "updateTextClipKeyframes"
  | "applyTextAnimationPreset"
  | "getAvailableAnimationPresets"
  | "createShapeClip"
  | "updateShapeStyle"
  | "updateShapeTransform"
  | "importSVG"
  | "getShapeClip"
  | "getSVGClip"
  | "getSVGClipById"
  | "updateSVGClip"
  | "createStickerClip"
  | "duplicateOverlayClip"
  | "pasteOverlayClip"
  | "updateOverlayClipTiming"
  | "splitOverlayClip"
  | "trimOverlayToPlayhead"
  | "getStickerClip"
  | "deleteShapeClip"
  | "deleteSVGClip"
  | "deleteStickerClip"
  | "deleteTextClip"
>;

export function createTextGraphicsSlice(
  set: Set,
  get: Get,
  helpers: ProjectStoreHelpers,
): TextGraphicsSlice {
  const {
    recordOverlayCreate,
    recordOverlayUpdate,
    recordOverlayRemove,
    cloneClipSnapshot,
  } = helpers;
  void set;

  const duplicateOverlay = <T extends OverlayClip>(
    source: T,
    prefix: OverlayKind,
    placement?: OverlayTimingUpdates,
  ): T => {
    const duplicateId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const duplicate = structuredClone(source);
    const titleEngine = useEngineStore.getState().getTitleEngine();
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    const projectTrack = get().project.timeline.tracks.find(
      (track) => track.id === source.trackId,
    );
    const occupied = [
      ...(projectTrack?.clips ?? []),
      ...(titleEngine?.getAllTextClips() ?? []),
      ...(graphicsEngine?.getAllShapeClips() ?? []),
      ...(graphicsEngine?.getAllSVGClips() ?? []),
      ...(graphicsEngine?.getAllStickerClips() ?? []),
    ]
      .filter((clip) => clip.trackId === source.trackId && clip.id !== source.id)
      .sort((a, b) => a.startTime - b.startTime);

    let candidate = source.startTime + source.duration;
    const epsilon = 0.0001;
    for (const clip of occupied) {
      if (clip.startTime + clip.duration <= candidate + epsilon) continue;
      if (clip.startTime >= candidate + source.duration - epsilon) break;
      candidate = clip.startTime + clip.duration;
    }

    return {
      ...duplicate,
      id: duplicateId,
      startTime: placement?.startTime ?? candidate,
      duration: placement?.duration ?? duplicate.duration,
      keyframes: (placement?.keyframes ?? duplicate.keyframes).map((keyframe, index) => ({
        ...keyframe,
        id: `${duplicateId}-keyframe-${index}`,
      })),
    } as T;
  };

  const resolveOverlayClip = (
    clipId: string,
  ): { kind: OverlayKind; field: OverlayField; clip: OverlayClip } | null => {
    const titleEngine = useEngineStore.getState().getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return { kind: "text", field: "textClips", clip: textClip };

    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return { kind: "shape", field: "shapeClips", clip: shapeClip };
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return { kind: "svg", field: "svgClips", clip: svgClip };
    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) {
      return { kind: "sticker", field: "stickerClips", clip: stickerClip };
    }
    return null;
  };

  const updateOverlayTiming = (
    clipId: string,
    updates: OverlayTimingUpdates,
  ): OverlayClip | null => {
    const resolved = resolveOverlayClip(clipId);
    if (!resolved) return null;

    const startTime =
      updates.startTime === undefined
        ? resolved.clip.startTime
        : Math.max(0, updates.startTime);
    const duration =
      updates.duration === undefined
        ? resolved.clip.duration
        : Math.max(0.1, updates.duration);
    const keyframes =
      updates.keyframes ??
      (duration !== resolved.clip.duration
        ? resolved.clip.keyframes.map((keyframe) =>
            keyframe.id.startsWith("kf-exit-")
              ? {
                  ...keyframe,
                  time: duration + (keyframe.time - resolved.clip.duration),
                }
              : keyframe,
          )
        : resolved.clip.keyframes);
    const normalizedUpdates = { startTime, duration, keyframes };
    const before = cloneClipSnapshot(resolved.clip);
    const titleEngine = useEngineStore.getState().getTitleEngine();
    const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
    let updated: OverlayClip | undefined;

    if (resolved.kind === "text") {
      updated = titleEngine?.updateTextClip(clipId, normalizedUpdates);
    } else if (resolved.kind === "shape") {
      updated = graphicsEngine?.updateShapeClip(clipId, normalizedUpdates);
    } else if (resolved.kind === "svg") {
      updated = graphicsEngine?.updateSVGClip(clipId, normalizedUpdates);
    } else {
      updated = graphicsEngine?.updateStickerClip(clipId, normalizedUpdates);
    }

    if (!updated) return null;
    recordOverlayUpdate(
      resolved.kind,
      resolved.field,
      clipId,
      updated,
      before,
    );
    return updated;
  };

  return {
    createTextClip: (
      trackId,
      startTime,
      text,
      duration = 5,
      style,
      metadata,
    ) => {
      const titleEngine = useEngineStore.getState().titleEngine;
      if (!titleEngine) {
        console.error("TitleEngine not available yet");
        return null;
      }
      const { project } = get();
      const track = project.timeline.tracks.find((t) => t.id === trackId);
      if (!track) {
        console.error(`Track ${trackId} not found`);
        return null;
      }
      const textClip = titleEngine.createTextClip({
        trackId,
        startTime,
        text,
        duration,
        style,
        metadata,
      });
      recordOverlayCreate("text", "textClips", textClip);
      return textClip;
    },

    updateTextContent: (clipId: string, text: string) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateText(clipId, text);
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    updateTextStyle: (clipId: string, style: Partial<TextStyle>) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateStyle(clipId, style);
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    updateTextAnimation: (clipId: string, animation: TextAnimation) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateTextClip(clipId, { animation });
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    updateTextTransform: (clipId: string, transform: Partial<Transform>) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateTextClip(clipId, { transform });
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    updateTextBehindSubject: (clipId: string, behindSubject: boolean) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateTextClip(clipId, { behindSubject });
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    updateText3D: (clipId: string, text3d: Text3DSettings | undefined) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateTextClip(clipId, { text3d });
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    getTextClip: (clipId: string) =>
      useEngineStore.getState().getTitleEngine()?.getTextClip(clipId),

    getAllTextClips: () =>
      useEngineStore.getState().getTitleEngine()?.getAllTextClips() ?? [],

    updateTextClipKeyframes: (clipId: string, keyframes: Keyframe[]) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateTextClip(clipId, { keyframes });
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    applyTextAnimationPreset: (
      clipId: string,
      preset: TextAnimationPreset,
      inDuration = 0.5,
      outDuration = 0.5,
      params?: Partial<TextAnimationParams>,
    ) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return null;
      const animation = textAnimationEngine.createAnimationPreset(
        preset,
        inDuration,
        outDuration,
        params,
      );
      const before = titleEngine.getTextClip(clipId);
      const beforeSnapshot = before ? cloneClipSnapshot(before) : undefined;
      const updatedClip = titleEngine.updateTextClip(clipId, { animation });
      if (updatedClip) {
        recordOverlayUpdate("text", "textClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip || null;
    },

    getAvailableAnimationPresets: () =>
      textAnimationEngine.getAvailablePresets(),

    createShapeClip: (trackId, startTime, shapeType: ShapeType, duration = 5, style) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        console.error("GraphicsEngine not initialized");
        return null;
      }
      const { project } = get();
      const track = project.timeline.tracks.find((t) => t.id === trackId);
      if (!track) {
        console.error(`Track ${trackId} not found`);
        return null;
      }
      const shapeClip = graphicsEngine.createShape(
        { shapeType, width: 200, height: 200, style },
        trackId,
        startTime,
        duration,
      );
      recordOverlayCreate("shape", "shapeClips", shapeClip);
      return shapeClip;
    },

    updateShapeStyle: (clipId: string, style: Partial<ShapeStyle>) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) return null;
      const shapeClip = graphicsEngine.getShapeClip(clipId);
      if (!shapeClip) {
        console.error(`Shape clip ${clipId} not found`);
        return null;
      }
      const beforeSnapshot = cloneClipSnapshot(shapeClip);
      const updatedClip = graphicsEngine.updateShapeStyle(shapeClip, style);
      if (updatedClip) {
        recordOverlayUpdate("shape", "shapeClips", clipId, updatedClip, beforeSnapshot);
      }
      return updatedClip;
    },

    updateShapeTransform: (clipId: string, transform: Partial<Transform>) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) return null;
      const shapeClip = graphicsEngine.getShapeClip(clipId);
      if (shapeClip) {
        const before = cloneClipSnapshot(shapeClip);
        const updatedClip = graphicsEngine.updateShapeClip(clipId, { transform });
        if (updatedClip) {
          recordOverlayUpdate("shape", "shapeClips", clipId, updatedClip, before);
        }
        return updatedClip || null;
      }
      const svgClip = graphicsEngine.getSVGClip(clipId);
      if (svgClip) {
        const before = cloneClipSnapshot(svgClip);
        const updatedClip = graphicsEngine.updateSVGClip(clipId, { transform });
        if (updatedClip) {
          recordOverlayUpdate("svg", "svgClips", clipId, updatedClip, before);
        }
        return updatedClip || null;
      }
      const stickerClip = graphicsEngine.getStickerClip(clipId);
      if (stickerClip) {
        const before = cloneClipSnapshot(stickerClip);
        const updatedClip = graphicsEngine.updateStickerClip(clipId, { transform });
        if (updatedClip) {
          recordOverlayUpdate("sticker", "stickerClips", clipId, updatedClip, before);
        }
        return updatedClip || null;
      }
      console.error(`Graphic clip ${clipId} not found`);
      return null;
    },

    importSVG: (svgContent: string, trackId, startTime, duration = 5) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        console.error("GraphicsEngine not initialized");
        return null;
      }
      const { project } = get();
      const track = project.timeline.tracks.find((t) => t.id === trackId);
      if (!track) {
        console.error(`Track ${trackId} not found`);
        return null;
      }
      try {
        const svgClip = graphicsEngine.importSVG(
          svgContent,
          trackId,
          startTime,
          duration,
        );
        recordOverlayCreate("svg", "svgClips", svgClip);
        return svgClip;
      } catch (error) {
        console.error("Failed to import SVG:", error);
        return null;
      }
    },

    getShapeClip: (clipId: string) =>
      useEngineStore.getState().getGraphicsEngine()?.getShapeClip(clipId),

    getSVGClip: (clipId: string) =>
      useEngineStore.getState().getGraphicsEngine()?.getSVGClip(clipId),

    getSVGClipById: (clipId: string) => get().getSVGClip(clipId),

    updateSVGClip: (clipId: string, updates) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        console.error("[ProjectStore] GraphicsEngine not initialized");
        return null;
      }
      const existing = graphicsEngine.getSVGClip(clipId);
      const before = existing ? cloneClipSnapshot(existing) : undefined;
      const updatedClip = graphicsEngine.updateSVGClip(clipId, updates);
      if (updatedClip) {
        recordOverlayUpdate("svg", "svgClips", clipId, updatedClip, before);
      } else {
        console.error(`[ProjectStore] Failed to update SVG clip ${clipId}`);
      }
      return updatedClip || null;
    },

    createStickerClip: (clip: StickerClip) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        console.error("GraphicsEngine not initialized");
        return null;
      }
      const { project } = get();
      const track = project.timeline.tracks.find((t) => t.id === clip.trackId);
      if (!track) {
        console.error(`Track ${clip.trackId} not found`);
        return null;
      }
      graphicsEngine.addStickerClip(clip);
      recordOverlayCreate("sticker", "stickerClips", clip);
      return clip;
    },

    duplicateOverlayClip: (clipId: string) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      const textClip = titleEngine?.getTextClip(clipId);
      if (titleEngine && textClip) {
        const duplicate = duplicateOverlay(textClip, "text");
        titleEngine.loadTextClips([...titleEngine.getAllTextClips(), duplicate]);
        recordOverlayCreate("text", "textClips", duplicate);
        return duplicate;
      }

      const shapeClip = graphicsEngine?.getShapeClip(clipId);
      if (graphicsEngine && shapeClip) {
        const duplicate = duplicateOverlay(shapeClip, "shape");
        graphicsEngine.loadShapeClips([
          ...graphicsEngine.getAllShapeClips(),
          duplicate,
        ]);
        recordOverlayCreate("shape", "shapeClips", duplicate);
        return duplicate;
      }

      const svgClip = graphicsEngine?.getSVGClip(clipId);
      if (graphicsEngine && svgClip) {
        const duplicate = duplicateOverlay(svgClip, "svg");
        graphicsEngine.loadSVGClips([
          ...graphicsEngine.getAllSVGClips(),
          duplicate,
        ]);
        recordOverlayCreate("svg", "svgClips", duplicate);
        return duplicate;
      }

      const stickerClip = graphicsEngine?.getStickerClip(clipId);
      if (graphicsEngine && stickerClip) {
        const duplicate = duplicateOverlay(stickerClip, "sticker");
        graphicsEngine.loadStickerClips([
          ...graphicsEngine.getAllStickerClips(),
          duplicate,
        ]);
        recordOverlayCreate("sticker", "stickerClips", duplicate);
        return duplicate;
      }

      return null;
    },

    pasteOverlayClip: (kind, clip, startTime, trackId) => {
      const destinationTrackId = trackId ?? clip.trackId;
      const destinationTrack = get().project.timeline.tracks.find(
        (track) => track.id === destinationTrackId,
      );
      const expectedTrackType = kind === "text" ? "text" : "graphics";
      if (
        !destinationTrack ||
        destinationTrack.locked ||
        destinationTrack.type !== expectedTrackType
      ) {
        console.warn("[ProjectStore] Cannot paste overlay to destination track", {
          kind,
          destinationTrackId,
          destinationTrackType: destinationTrack?.type,
          destinationTrackLocked: destinationTrack?.locked,
        });
        return null;
      }

      const pasted = {
        ...duplicateOverlay(clip, kind, { startTime }),
        trackId: destinationTrackId,
      } as OverlayClip;
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      if (kind === "text" && titleEngine) {
        titleEngine.loadTextClips([
          ...titleEngine.getAllTextClips(),
          pasted as TextClip,
        ]);
      } else if (kind === "shape" && graphicsEngine) {
        graphicsEngine.loadShapeClips([
          ...graphicsEngine.getAllShapeClips(),
          pasted as ShapeClip,
        ]);
      } else if (kind === "svg" && graphicsEngine) {
        graphicsEngine.loadSVGClips([
          ...graphicsEngine.getAllSVGClips(),
          pasted as SVGClip,
        ]);
      } else if (kind === "sticker" && graphicsEngine) {
        graphicsEngine.loadStickerClips([
          ...graphicsEngine.getAllStickerClips(),
          pasted as StickerClip,
        ]);
      } else {
        console.warn("[ProjectStore] Overlay engine unavailable during paste", {
          kind,
          hasTitleEngine: Boolean(titleEngine),
          hasGraphicsEngine: Boolean(graphicsEngine),
        });
        return null;
      }

      const field: OverlayField =
        kind === "text"
          ? "textClips"
          : kind === "shape"
            ? "shapeClips"
            : kind === "svg"
              ? "svgClips"
              : "stickerClips";
      recordOverlayCreate(kind, field, pasted);
      return pasted;
    },

    updateOverlayClipTiming: (clipId, updates) =>
      updateOverlayTiming(clipId, updates),

    splitOverlayClip: (clipId, time) => {
      const resolved = resolveOverlayClip(clipId);
      if (!resolved) return null;

      const splitOffset = time - resolved.clip.startTime;
      const rightDuration = resolved.clip.duration - splitOffset;
      if (splitOffset < 0.1 || rightDuration < 0.1) return null;

      const actionHistory = get().actionExecutor.getHistory();
      actionHistory.beginGroup("Split overlay clip");
      try {
        const left = updateOverlayTiming(clipId, { duration: splitOffset });
        if (!left) return null;

        const right = duplicateOverlay(resolved.clip, resolved.kind, {
          startTime: time,
          duration: rightDuration,
        });
        const titleEngine = useEngineStore.getState().getTitleEngine();
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

        if (resolved.kind === "text" && titleEngine) {
          titleEngine.loadTextClips([...titleEngine.getAllTextClips(), right as TextClip]);
        } else if (resolved.kind === "shape" && graphicsEngine) {
          graphicsEngine.loadShapeClips([
            ...graphicsEngine.getAllShapeClips(),
            right as ShapeClip,
          ]);
        } else if (resolved.kind === "svg" && graphicsEngine) {
          graphicsEngine.loadSVGClips([
            ...graphicsEngine.getAllSVGClips(),
            right as SVGClip,
          ]);
        } else if (resolved.kind === "sticker" && graphicsEngine) {
          graphicsEngine.loadStickerClips([
            ...graphicsEngine.getAllStickerClips(),
            right as StickerClip,
          ]);
        } else {
          return null;
        }

        recordOverlayCreate(resolved.kind, resolved.field, right);
        return { left, right };
      } finally {
        actionHistory.endGroup();
      }
    },

    trimOverlayToPlayhead: (clipId, playheadTime, trimStart) => {
      const resolved = resolveOverlayClip(clipId);
      if (!resolved) return null;
      const clipEnd = resolved.clip.startTime + resolved.clip.duration;
      if (
        playheadTime <= resolved.clip.startTime + 0.1 ||
        playheadTime >= clipEnd - 0.1
      ) {
        return null;
      }

      return trimStart
        ? updateOverlayTiming(clipId, {
            startTime: playheadTime,
            duration: clipEnd - playheadTime,
          })
        : updateOverlayTiming(clipId, {
            duration: playheadTime - resolved.clip.startTime,
          });
    },

    getStickerClip: (clipId: string) =>
      useEngineStore.getState().getGraphicsEngine()?.getStickerClip(clipId),

    deleteShapeClip: (clipId: string) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) return false;
      const before = graphicsEngine.getShapeClip(clipId);
      const deleted = graphicsEngine.deleteShapeClip(clipId);
      if (deleted) recordOverlayRemove("shape", "shapeClips", clipId, before);
      return deleted;
    },

    deleteSVGClip: (clipId: string) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) return false;
      const before = graphicsEngine.getSVGClip(clipId);
      const deleted = graphicsEngine.deleteSVGClip(clipId);
      if (deleted) recordOverlayRemove("svg", "svgClips", clipId, before);
      return deleted;
    },

    deleteStickerClip: (clipId: string) => {
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) return false;
      const before = graphicsEngine.getStickerClip(clipId);
      const deleted = graphicsEngine.deleteStickerClip(clipId);
      if (deleted) recordOverlayRemove("sticker", "stickerClips", clipId, before);
      return deleted;
    },

    deleteTextClip: (clipId: string) => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (!titleEngine) return false;
      const before = titleEngine.getTextClip(clipId);
      const deleted = titleEngine.deleteTextClip(clipId);
      if (deleted) recordOverlayRemove("text", "textClips", clipId, before);
      return deleted;
    },
  };
}
