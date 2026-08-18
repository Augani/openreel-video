import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Project,
  ProjectSettings,
  MediaItem,
  Track,
  Clip,
  AutomationPoint,
  Transition,
  Action,
  ActionResult,
  TextClip,
  TextStyle,
  TextAnimation,
  TextAnimationPreset,
  TextAnimationParams,
  ShapeClip,
  ShapeType,
  ShapeStyle,
  SVGClip,
  StickerClip,
  PhotoProject,
  CreateLayerOptions,
  PhotoBlendMode,
  Effect,
  Keyframe,
  Transform,
  AppliedEditingTemplate,
  EditingTemplate,
  EditingTemplateApplicationSource,
  EditingTemplatePrimitive,
  ResolvedEditingTemplateApplication,
  ClipColorGrading,
  MotionComposition,
  MotionCompositionInstance,
} from "@openreel/core";
import {
  ActionExecutor,
  ActionHistory,
  getBuiltInEditingTemplate,
  getBuiltInEditingTemplates,
  getMotionPreset,
  motionEngine,
  normalizeGeneratedShaders,
  normalizeProjectMotionFields,
  reflowMotionAutoLayoutGroups,
  registerProjectGeneratedShaders,
  resolveEditingTemplate,
} from "@openreel/core";
import { createMarkerSlice } from "./project/marker-slice";
import { createSubtitleSlice } from "./project/subtitle-slice";
import { createTrackSlice } from "./project/track-slice";
import { createMediaSlice } from "./project/media-slice";
import { createProjectStoreHelpers } from "./project/store-helpers";
import { createTextGraphicsSlice } from "./project/text-graphics-slice";
import { createHistorySlice } from "./project/history-slice";
import { createClipSlice } from "./project/clip-slice";
import { v4 as uuidv4 } from "uuid";
import type {
  VideoEffect,
  VideoEffectType,
  ColorGradingSettings,
} from "../bridges/effects-bridge";
import { getEffectsBridge } from "../bridges/effects-bridge";
import { getTransitionBridge } from "../bridges/transition-bridge";
import {
  autoSaveManager,
  initializeAutoSave,
  type AutoSaveMetadata,
} from "../services/auto-save";
import { useEngineStore } from "./engine-store";
import {
  createEmptyProject,
  calculateTimelineDuration,
  type AudioDuckingSettings,
  type EditingTemplateApplicationState,
  type ClipHistoryEntry,
  type EditingTemplateHistoryEntry,
  type TimelineClipboardItem,
} from "./project/index";
import {
  saveMediaBlob,
  loadProjectMedia,
  loadFileHandle,
  loadDirectoryHandle,
} from "../services/media-storage";
import { restoreMediaItem } from "../utils/media-recovery";
import { projectManager } from "../services/project-manager";
import {
  planCreationObjectEdit,
  type CreationObjectEditPatch,
} from "../motion/creation-object-editing";
import {
  planCreationCameraEdit,
  type CreationCameraEditPatch,
} from "../motion/creation-camera-editing";
import { planRecoverMotionScene3DLayer } from "../motion/creation-recovery";

/**
 * ProjectState - Complete state interface for project management
 *
 * Provides comprehensive API for:
 * - Project CRUD operations
 * - Media library management
 * - Track and clip manipulation
 * - Text clip and animation handling
 * - Graphics (shapes, SVG, stickers) management
 * - Video and audio effects
 * - Subtitle handling
 * - Photo editing
 * - Undo/redo functionality
 *
 * All async methods return ActionResult with success status and error details.
 */
export interface ProjectState {
  // Project data
  project: Project;
  hasOpenProject: boolean;

  // Photo projects
  photoProjects: Map<string, PhotoProject>;

  // Action system
  actionExecutor: ActionExecutor;
  actionHistory: ActionHistory;

  // Clip history for graphics/text clips (outside main timeline)
  clipUndoStack: ClipHistoryEntry[];
  clipRedoStack: ClipHistoryEntry[];
  templateUndoStack: EditingTemplateHistoryEntry[];
  templateRedoStack: EditingTemplateHistoryEntry[];
  redoJournal: Array<"action" | "clip" | "template">;

  // Loading state
  isLoading: boolean;
  error: string | null;

  createNewProject: (
    name?: string,
    settings?: Partial<ProjectSettings>,
  ) => void;
  loadProject: (project: Project) => void;
  renameProject: (name: string) => Promise<ActionResult>;
  updateSettings: (settings: Partial<ProjectSettings>) => Promise<ActionResult>;
  setCanvasBackground: (
    mode: "color" | "blur" | undefined,
    color: string | undefined,
  ) => Promise<ActionResult>;

  // Media library actions
  importMedia: (file: File) => Promise<ActionResult>;
  deleteMedia: (mediaId: string) => Promise<ActionResult>;
  replaceMediaAsset: (mediaId: string, file: File, sourceFolder?: string) => Promise<ActionResult>;
  renameMedia: (mediaId: string, name: string) => Promise<ActionResult>;
  getMediaItem: (mediaId: string) => MediaItem | undefined;
  /** Add a pending placeholder for a background KieAI task */
  addPlaceholderMedia: (item: MediaItem) => void;
  /** Replace a pending placeholder with the actual result blob */
  replacePlaceholderMedia: (mediaId: string, blob: Blob, name: string) => Promise<void>;
  /** Flip isPending / kieaiError flags on a placeholder without full replacement */
  setKieAIItemState: (mediaId: string, isPending: boolean, kieaiError: boolean) => void;

  // Track actions
  addTrack: (
    trackType: "video" | "audio" | "image" | "text" | "graphics",
    position?: number,
  ) => Promise<ActionResult>;
  duplicateTrack: (trackId: string) => Promise<ActionResult>;
  removeTrack: (trackId: string) => Promise<ActionResult>;
  reorderTrack: (trackId: string, newPosition: number) => Promise<ActionResult>;
  lockTrack: (trackId: string, locked: boolean) => Promise<ActionResult>;
  hideTrack: (trackId: string, hidden: boolean) => Promise<ActionResult>;
  muteTrack: (trackId: string, muted: boolean) => Promise<ActionResult>;
  soloTrack: (trackId: string, solo: boolean) => Promise<ActionResult>;
  groupTracks: (trackId: string, partnerTrackId?: string) => boolean;
  renameTrack: (trackId: string, name: string) => Promise<ActionResult>;
  getTrack: (trackId: string) => Track | undefined;

  // Clip actions
  addClip: (
    trackId: string,
    mediaId: string,
    startTime: number,
  ) => Promise<ActionResult>;
  addClipToNewTrack: (
    mediaId: string,
    startTime?: number,
  ) => Promise<ActionResult>;
  removeClip: (clipId: string) => Promise<ActionResult>;
  moveClip: (
    clipId: string,
    startTime: number,
    trackId?: string,
  ) => Promise<ActionResult>;
  moveClips: (
    moves: Array<{ clipId: string; startTime: number; trackId?: string }>,
  ) => Promise<ActionResult>;
  beginHistoryGroup: (description?: string) => void;
  endHistoryGroup: () => void;
  closeGapBeforeClip: (clipId: string) => Promise<ActionResult>;
  consolidateTrack: (trackId: string) => Promise<ActionResult>;
  trimClip: (
    clipId: string,
    inPoint?: number,
    outPoint?: number,
  ) => Promise<ActionResult>;
  splitClip: (clipId: string, time: number) => Promise<ActionResult>;
  rippleDeleteClip: (clipId: string) => Promise<ActionResult>;
  slipClip: (clipId: string, delta: number) => Promise<ActionResult>;
  slideClip: (clipId: string, delta: number) => Promise<ActionResult>;
  rollEdit: (
    leftClipId: string,
    rightClipId: string,
    delta: number,
  ) => Promise<ActionResult>;
  trimToPlayhead: (
    clipId: string,
    playheadTime: number,
    trimStart: boolean,
  ) => Promise<ActionResult>;
  getClip: (clipId: string) => Clip | undefined;
  addClipTransition: (transition: Transition) => Promise<Transition | null>;
  updateClipTransition: (
    transitionId: string,
    updates: Partial<Pick<Transition, "type" | "duration" | "params">>,
  ) => Promise<Transition | null>;
  removeClipTransition: (transitionId: string) => Promise<boolean>;
  getClipTransition: (transitionId: string) => Transition | undefined;
  getClipTransitionBetweenClips: (
    clipAId: string,
    clipBId: string,
  ) => Transition | undefined;
  separateAudio: (clipId: string) => Promise<ActionResult>;
  updateClipTransform: (
    clipId: string,
    transform: Partial<Transform>,
  ) => Promise<ActionResult>;
  updateClipBlendMode: (
    clipId: string,
    blendMode: import("@openreel/core").BlendMode,
  ) => Promise<ActionResult>;
  updateClipBlendOpacity: (
    clipId: string,
    opacity: number,
  ) => Promise<ActionResult>;
  updateClipRotate3D: (
    clipId: string,
    rotate3d: { x: number; y: number; z: number },
  ) => boolean;
  updateClipPerspective: (clipId: string, perspective: number) => boolean;
  updateClipTransformStyle: (
    clipId: string,
    transformStyle: "flat" | "preserve-3d",
  ) => boolean;
  updateClipEmphasisAnimation: (
    clipId: string,
    emphasisAnimation: import("@openreel/core").EmphasisAnimation,
  ) => Promise<ActionResult>;

  // Clipboard actions
  clipboard: TimelineClipboardItem[];
  lastPastedClipIds: string[];
  copyClips: (clipIds: string[]) => void;
  pasteClips: (trackId: string, startTime: number) => Promise<ActionResult[]>;
  duplicateClip: (clipId: string) => Promise<ActionResult>;
  copyEffects: (clipId: string) => void;
  pasteEffects: (clipId: string) => Promise<ActionResult>;
  copiedEffects: Effect[];

  getEditingTemplates: () => EditingTemplate[];
  getEditingTemplate: (templateId: string) => EditingTemplate | undefined;
  applyEditingTemplate: (
    templateId: string,
    clipId: string,
    overrides?: Record<string, EditingTemplatePrimitive>,
  ) => string | null;
  updateEditingTemplateApplication: (
    clipId: string,
    applicationId: string,
    overrides?: Record<string, EditingTemplatePrimitive>,
  ) => boolean;
  removeEditingTemplateApplication: (
    clipId: string,
    applicationId: string,
  ) => boolean;

  // Motion Creator actions
  createMotionComposition: (
    name?: string,
    presetId?: string,
  ) => Promise<MotionComposition | null>;
  upsertMotionComposition: (
    composition: MotionComposition,
  ) => Promise<ActionResult>;
  updateMotionCompositionPreview: (composition: MotionComposition) => void;
  commitMotionCompositionGesture: (
    before: MotionComposition,
    after: MotionComposition,
  ) => Promise<ActionResult | null>;
  updateCreationObject: (
    sceneId: string,
    objectId: string,
    patch: CreationObjectEditPatch,
  ) => Promise<ActionResult>;
  updateCreationCamera: (
    sceneId: string,
    cameraId: string | undefined,
    patch: CreationCameraEditPatch,
  ) => Promise<ActionResult>;
  recoverMotionScene3DLayer: (
    compositionId: string,
    layerId: string,
  ) => Promise<ActionResult>;
  insertMotionInstance: (
    compositionId: string,
    placement?: Partial<
      Pick<MotionCompositionInstance, "startTime" | "duration" | "trackId" | "name">
    >,
  ) => Promise<MotionCompositionInstance | null>;
  removeMotionInstance: (instanceId: string) => Promise<ActionResult>;
  getMotionComposition: (compositionId: string) => MotionComposition | undefined;
  getMotionInstance: (
    instanceId: string,
  ) => MotionCompositionInstance | undefined;

  // Text clip actions
  createTextClip: (
    trackId: string,
    startTime: number,
    text: string,
    duration?: number,
    style?: Partial<TextStyle>,
    metadata?: import("@openreel/core").ClipMetadata,
  ) => TextClip | null;
  updateTextContent: (clipId: string, text: string) => TextClip | null;
  updateTextStyle: (
    clipId: string,
    style: Partial<TextStyle>,
  ) => TextClip | null;
  updateTextAnimation: (
    clipId: string,
    animation: TextAnimation,
  ) => TextClip | null;
  updateTextTransform: (
    clipId: string,
    transform: Partial<Transform>,
  ) => TextClip | null;
  updateTextBehindSubject: (
    clipId: string,
    behindSubject: boolean,
  ) => TextClip | null;
  updateText3D: (
    clipId: string,
    text3d: import("@openreel/core").Text3DSettings | undefined,
  ) => TextClip | null;
  getTextClip: (clipId: string) => TextClip | undefined;
  getAllTextClips: () => TextClip[];
  updateTextClipKeyframes: (
    clipId: string,
    keyframes: Keyframe[],
  ) => TextClip | null;

  // Text animation actions
  applyTextAnimationPreset: (
    clipId: string,
    preset: TextAnimationPreset,
    inDuration?: number,
    outDuration?: number,
    params?: Partial<TextAnimationParams>,
  ) => TextClip | null;
  getAvailableAnimationPresets: () => TextAnimationPreset[];

  // Subtitle actions - subtitles are created as text clips on a Captions track
  addSubtitle: (
    subtitle: import("@openreel/core").Subtitle,
    metadata?: import("@openreel/core").ClipMetadata,
  ) => Promise<void>;
  removeSubtitle: (subtitleId: string) => void;
  updateSubtitle: (
    subtitleId: string,
    updates: Partial<import("@openreel/core").Subtitle>,
  ) => void;
  getSubtitle: (
    subtitleId: string,
  ) => import("@openreel/core").Subtitle | undefined;
  importSRT: (
    srtContent: string,
    options?: { sourceClipId?: string; maxWordsPerLine?: number },
  ) => Promise<{ success: boolean; errors: string[] }>;
  exportSRT: () => Promise<string>;
  applySubtitleStylePreset: (presetName: string) => Promise<boolean>;
  getSubtitleStylePresets: () => Promise<string[]>;

  // Marker actions
  addMarker: (
    time: number,
    label?: string,
    color?: string,
  ) => Promise<ActionResult>;
  removeMarker: (markerId: string) => Promise<ActionResult>;
  updateMarker: (
    markerId: string,
    updates: Partial<import("@openreel/core").Marker>,
  ) => Promise<ActionResult>;
  getMarker: (markerId: string) => import("@openreel/core").Marker | undefined;
  getMarkers: () => import("@openreel/core").Marker[];

  // Graphics actions
  createShapeClip: (
    trackId: string,
    startTime: number,
    shapeType: ShapeType,
    duration?: number,
    style?: Partial<ShapeStyle>,
  ) => ShapeClip | null;
  updateShapeStyle: (
    clipId: string,
    style: Partial<ShapeStyle>,
  ) => ShapeClip | null;
  updateShapeTransform: (
    clipId: string,
    transform: Partial<Transform>,
  ) => ShapeClip | SVGClip | StickerClip | null;
  importSVG: (
    svgContent: string,
    trackId: string,
    startTime: number,
    duration?: number,
  ) => SVGClip | null;
  getShapeClip: (clipId: string) => ShapeClip | undefined;
  deleteShapeClip: (clipId: string) => boolean;
  getSVGClip: (clipId: string) => SVGClip | undefined;
  getSVGClipById: (clipId: string) => SVGClip | undefined;
  updateSVGClip: (
    clipId: string,
    updates: {
      startTime?: number;
      duration?: number;
      transform?: Partial<Transform>;
      entryAnimation?: import("@openreel/core").GraphicAnimation;
      exitAnimation?: import("@openreel/core").GraphicAnimation;
      colorStyle?: import("@openreel/core").SVGColorStyle;
    },
  ) => SVGClip | null;
  deleteSVGClip: (clipId: string) => boolean;
  createStickerClip: (clip: StickerClip) => StickerClip | null;
  duplicateOverlayClip: (
    clipId: string,
  ) => TextClip | ShapeClip | SVGClip | StickerClip | null;
  pasteOverlayClip: (
    kind: "text" | "shape" | "svg" | "sticker",
    clip: TextClip | ShapeClip | SVGClip | StickerClip,
    startTime: number,
    trackId?: string,
  ) => TextClip | ShapeClip | SVGClip | StickerClip | null;
  updateOverlayClipTiming: (
    clipId: string,
    updates: {
      startTime?: number;
      duration?: number;
      keyframes?: Keyframe[];
    },
  ) => TextClip | ShapeClip | SVGClip | StickerClip | null;
  splitOverlayClip: (
    clipId: string,
    time: number,
  ) => {
    left: TextClip | ShapeClip | SVGClip | StickerClip;
    right: TextClip | ShapeClip | SVGClip | StickerClip;
  } | null;
  trimOverlayToPlayhead: (
    clipId: string,
    playheadTime: number,
    trimStart: boolean,
  ) => TextClip | ShapeClip | SVGClip | StickerClip | null;
  getStickerClip: (clipId: string) => StickerClip | undefined;
  deleteStickerClip: (clipId: string) => boolean;
  deleteTextClip: (clipId: string) => boolean;

  // Photo editing actions
  createPhotoProject: (
    width?: number,
    height?: number,
    name?: string,
  ) => PhotoProject | null;
  importPhotoForEditing: (
    image: ImageBitmap,
    name?: string,
  ) => PhotoProject | null;
  addPhotoLayer: (
    projectId: string,
    options?: CreateLayerOptions,
  ) => PhotoProject | null;
  removePhotoLayer: (projectId: string, layerId: string) => PhotoProject | null;
  reorderPhotoLayers: (
    projectId: string,
    fromIndex: number,
    toIndex: number,
  ) => PhotoProject | null;
  setPhotoLayerVisibility: (
    projectId: string,
    layerId: string,
    visible?: boolean,
  ) => PhotoProject | null;
  setPhotoLayerOpacity: (
    projectId: string,
    layerId: string,
    opacity: number,
  ) => PhotoProject | null;
  setPhotoLayerBlendMode: (
    projectId: string,
    layerId: string,
    blendMode: PhotoBlendMode,
  ) => PhotoProject | null;
  getPhotoProject: (projectId: string) => PhotoProject | null;

  // Video effects actions
  addVideoEffect: (
    clipId: string,
    effectType: VideoEffectType,
    params?: Record<string, unknown>,
  ) => Promise<VideoEffect | null>;
  duplicateVideoEffect: (
    clipId: string,
    effectId: string,
  ) => Promise<VideoEffect | null>;
  replaceVideoEffects: (
    clipId: string,
    effects: VideoEffect[],
  ) => Promise<boolean>;
  updateVideoEffect: (
    clipId: string,
    effectId: string,
    params: Record<string, unknown>,
  ) => Promise<VideoEffect | null>;
  removeVideoEffect: (clipId: string, effectId: string) => Promise<boolean>;
  reorderVideoEffects: (clipId: string, effectIds: string[]) => boolean;
  toggleVideoEffect: (
    clipId: string,
    effectId: string,
    enabled: boolean,
  ) => Promise<VideoEffect | null>;
  getVideoEffects: (clipId: string) => VideoEffect[];
  getVideoEffect: (clipId: string, effectId: string) => VideoEffect | undefined;

  // Color grading actions
  updateColorGrading: (
    clipId: string,
    settings: Partial<ColorGradingSettings>,
  ) => Promise<boolean>;
  getColorGrading: (clipId: string) => ColorGradingSettings;
  resetColorGrading: (clipId: string) => Promise<boolean>;

  // Audio effects actions
  addAudioEffect: (clipId: string, effect: Effect) => Promise<boolean>;
  updateAudioEffect: (
    clipId: string,
    effectId: string,
    params: Record<string, unknown>,
  ) => Promise<boolean>;
  removeAudioEffect: (clipId: string, effectId: string) => Promise<boolean>;
  toggleAudioEffect: (
    clipId: string,
    effectId: string,
    enabled: boolean,
  ) => Promise<boolean>;
  setAudioEffectPreviewBypass: (
    clipId: string,
    effectId: string,
    bypassed: boolean,
  ) => boolean;
  getAudioEffects: (clipId: string) => Effect[];
  setClipAudioDucking: (
    clipId: string,
    settings: AudioDuckingSettings,
    points: AutomationPoint[],
  ) => boolean;
  clearClipAudioDucking: (clipId: string) => boolean;

  // Keyframe actions
  updateClipKeyframes: (clipId: string, keyframes: Keyframe[]) => boolean;

  // Undo/Redo
  undo: () => Promise<ActionResult>;
  redo: () => Promise<ActionResult>;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Execute arbitrary action
  executeAction: (action: Action) => Promise<ActionResult>;

  // Computed values
  getTimelineDuration: () => number;

  // Auto-save
  initializeAutoSave: () => Promise<void>;
  checkForRecovery: () => Promise<AutoSaveMetadata[]>;
  recoverFromAutoSave: (saveId: string) => Promise<boolean>;
  forceSave: () => Promise<void>;
  getFullProject: () => Project;
}

function motionCompositionsEqual(
  a: MotionComposition,
  b: MotionComposition,
): boolean {
  const strip = ({ modifiedAt: _modifiedAt, ...rest }: MotionComposition) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// Guards against re-running auto-save setup (which subscribes to the store and
// starts the interval) more than once across editor mount/unmount cycles, which
// would otherwise leak a store subscription and fire markDirty repeatedly.
let autoSaveInitialized = false;

/**
 * Create the project store
 */
export const useProjectStore = create<ProjectState>()(
  subscribeWithSelector((set, get) => {
    const actionHistory = new ActionHistory();
    const actionExecutor = new ActionExecutor(actionHistory);

    const getProjectClipIds = (project: Project): string[] => [
      ...project.timeline.tracks.flatMap((track) =>
        track.clips.map((clip) => clip.id),
      ),
      ...(project.textClips ?? []).map((clip) => clip.id),
      ...(project.shapeClips ?? []).map((clip) => clip.id),
      ...(project.svgClips ?? []).map((clip) => clip.id),
      ...(project.stickerClips ?? []).map((clip) => clip.id),
    ];

    const mapClipEffectsToVideoEffects = (effects: Effect[]): VideoEffect[] =>
      effects.map((effect, order) => ({
        id: effect.id,
        type: effect.type as VideoEffectType,
        enabled: effect.enabled,
        params: effect.params,
        order,
      }));

    const updateProjectClip = (
      project: Project,
      clipId: string,
      updater: (clip: Clip) => Clip,
    ): Project | null => {
      let hasUpdatedClip = false;

      const updatedTracks = project.timeline.tracks.map((track) => {
        let trackUpdated = false;

        const updatedClips = track.clips.map((clip) => {
          if (clip.id !== clipId) {
            return clip;
          }

          hasUpdatedClip = true;
          trackUpdated = true;
          return updater(clip);
        });

        return trackUpdated ? { ...track, clips: updatedClips } : track;
      });

      if (!hasUpdatedClip) {
        return null;
      }

      return {
        ...project,
        timeline: { ...project.timeline, tracks: updatedTracks },
        modifiedAt: Date.now(),
      };
    };

    const buildSerializedColorGrading = (clipId: string): ClipColorGrading => {
      const effectsBridge = getEffectsBridge();
      if (!effectsBridge.isInitialized()) {
        return {};
      }

      const colorGrading = effectsBridge.getColorGrading(clipId);

      return {
        ...(colorGrading.colorWheels
          ? { colorWheels: colorGrading.colorWheels }
          : {}),
        ...(colorGrading.curves ? { curves: colorGrading.curves } : {}),
        ...(colorGrading.lut
          ? {
              lut: {
                data: Array.from(colorGrading.lut.data),
                size: colorGrading.lut.size,
                intensity: colorGrading.lut.intensity,
              },
            }
          : {}),
        ...(colorGrading.hsl ? { hsl: colorGrading.hsl } : {}),
        ...(colorGrading.temperature !== undefined
          ? { temperature: colorGrading.temperature }
          : {}),
        ...(colorGrading.tint !== undefined ? { tint: colorGrading.tint } : {}),
      };
    };

    const syncClipEffectsBridge = (project: Project, clipId: string): void => {
      const effectsBridge = getEffectsBridge();
      if (!effectsBridge.isInitialized()) {
        return;
      }

      const timelineClip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
      const overlayClip = [
        ...(project.textClips ?? []),
        ...(project.shapeClips ?? []),
        ...(project.svgClips ?? []),
        ...(project.stickerClips ?? []),
      ].find((candidate) => candidate.id === clipId);
      const clip = timelineClip ?? overlayClip;

      if (!clip) {
        effectsBridge.clearEffects(clipId);
        return;
      }

      const effects = mapClipEffectsToVideoEffects(clip.effects ?? []);
      effectsBridge.deserializeEffects(clipId, {
        effects: effects.map((effect) => ({
          id: effect.id,
          type: effect.type,
          enabled: effect.enabled,
          params: effect.params,
          order: effect.order,
        })),
        // The clip is the source of truth for color grading; pushing it into
        // the bridge here is what makes undo/redo (and project load) restore
        // the graded look.
        colorGrading: timelineClip?.colorGrading ?? {},
      });
    };

    const syncProjectEffectsBridge = (
      nextProject: Project,
      previousProject?: Project,
    ): void => {
      const effectsBridge = getEffectsBridge();
      if (!effectsBridge.isInitialized()) {
        return;
      }

      const nextClipIds = new Set(getProjectClipIds(nextProject));

      for (const clipId of previousProject ? getProjectClipIds(previousProject) : []) {
        if (!nextClipIds.has(clipId)) {
          effectsBridge.clearEffects(clipId);
        }
      }

      for (const clipId of nextClipIds) {
        syncClipEffectsBridge(nextProject, clipId);
      }
    };

    const syncTrackTransitionsBridge = (
      project: Project,
      trackId: string,
    ): void => {
      const transitionBridge = getTransitionBridge();
      if (!transitionBridge.isInitialized()) {
        return;
      }

      const track = project.timeline.tracks.find(
        (candidate) => candidate.id === trackId,
      );

      if (!track) {
        transitionBridge.clearTransitionsForTrack(trackId);
        return;
      }

      transitionBridge.setTransitionsForTrack(trackId, track.transitions);
    };

    const syncProjectTransitionsBridge = (
      nextProject: Project,
      previousProject?: Project,
    ): void => {
      const transitionBridge = getTransitionBridge();
      if (!transitionBridge.isInitialized()) {
        return;
      }

      const nextTrackIds = new Set(
        nextProject.timeline.tracks.map((track) => track.id),
      );

      for (const trackId of previousProject
        ? previousProject.timeline.tracks.map((track) => track.id)
        : []) {
        if (!nextTrackIds.has(trackId)) {
          transitionBridge.clearTransitionsForTrack(trackId);
        }
      }

      for (const track of nextProject.timeline.tracks) {
        syncTrackTransitionsBridge(nextProject, track.id);
      }
    };

    // Restore a full clip snapshot into the owning engine (used by undo/redo
    // of text/shape property edits). Never creates or deletes the clip — it
    // merges the saved fields back onto the existing engine clip.
    const helpers = createProjectStoreHelpers(set, get);
    const { applyClipDataSnapshot, syncOverlayEnginesFromProject } = helpers;

    type OverlayEffectOwner = TextClip | ShapeClip | SVGClip | StickerClip;
    type OverlayEffectLocation = {
      readonly prefix: "text" | "shape" | "svg" | "sticker";
      readonly field: "textClips" | "shapeClips" | "svgClips" | "stickerClips";
      readonly clip: OverlayEffectOwner;
    };

    const findOverlayEffectOwner = (
      project: Project,
      clipId: string,
    ): OverlayEffectLocation | null => {
      const locations = [
        { prefix: "text", field: "textClips", clips: project.textClips ?? [] },
        { prefix: "shape", field: "shapeClips", clips: project.shapeClips ?? [] },
        { prefix: "svg", field: "svgClips", clips: project.svgClips ?? [] },
        {
          prefix: "sticker",
          field: "stickerClips",
          clips: project.stickerClips ?? [],
        },
      ] as const;
      for (const location of locations) {
        const clip = location.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
          return {
            prefix: location.prefix,
            field: location.field,
            clip,
          } as OverlayEffectLocation;
        }
      }
      return null;
    };

    const updateOverlayEffectOwner = (
      clipId: string,
      updater: (effects: Effect[]) => Effect[],
    ): OverlayEffectOwner | null => {
      const location = findOverlayEffectOwner(get().project, clipId);
      if (!location) return null;
      const before = structuredClone(location.clip);
      const updated = {
        ...location.clip,
        effects: updater([...(location.clip.effects ?? [])]),
      } as OverlayEffectOwner;
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (location.prefix === "text") {
        titleEngine?.updateTextClip(clipId, updated as TextClip);
      } else if (location.prefix === "shape") {
        graphicsEngine?.updateShapeClip(clipId, updated as ShapeClip);
      } else if (location.prefix === "svg") {
        graphicsEngine?.updateSVGClip(clipId, updated as SVGClip);
      } else {
        graphicsEngine?.updateStickerClip(clipId, updated as StickerClip);
      }
      helpers.recordOverlayUpdate(
        location.prefix,
        location.field,
        clipId,
        updated,
        before,
      );
      syncClipEffectsBridge(get().project, clipId);
      return updated;
    };

    const buildEditingTemplateTrack = (
      trackType: "text" | "graphics",
    ): Track => ({
      id: `track-${uuidv4()}`,
      type: trackType,
      name: trackType === "text" ? "Recipe Text" : "Recipe Graphics",
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    });

    const insertEditingTemplateTrack = (
      project: Project,
      snapshot: EditingTemplateHistoryEntry["trackSnapshots"][number],
    ): Project => {
      if (project.timeline.tracks.some((track) => track.id === snapshot.track.id)) {
        return project;
      }

      const tracks = [...project.timeline.tracks];
      const position = Math.max(0, Math.min(snapshot.position, tracks.length));
      tracks.splice(position, 0, snapshot.track);

      return {
        ...project,
        timeline: { ...project.timeline, tracks },
        modifiedAt: Date.now(),
      };
    };

    const removeTrackFromProjectState = (
      project: Project,
      trackId: string,
    ): Project => {
      const nextTracks = project.timeline.tracks.filter((track) => track.id !== trackId);

      if (nextTracks.length === project.timeline.tracks.length) {
        return project;
      }

      return {
        ...project,
        timeline: { ...project.timeline, tracks: nextTracks },
        modifiedAt: Date.now(),
      };
    };

    const trackHasAnyClips = (project: Project, trackId: string): boolean => {
      const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
      if (!track) {
        return false;
      }

      if (track.clips.length > 0) {
        return true;
      }

      if (track.type === "text") {
        const titleEngine = useEngineStore.getState().getTitleEngine();
        return titleEngine?.getAllTextClips().some((clip) => clip.trackId === trackId) ?? false;
      }

      if (track.type === "graphics") {
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (!graphicsEngine) {
          return false;
        }

        return [
          ...graphicsEngine.getAllShapeClips(),
          ...graphicsEngine.getAllSVGClips(),
          ...graphicsEngine.getAllStickerClips(),
        ].some((clip) => clip.trackId === trackId);
      }

      return false;
    };

    const buildEditingTemplateKeyframes = (
      prefix: string,
      keyframes: readonly {
        time: number;
        property: string;
        value: unknown;
        easing: Keyframe["easing"];
      }[],
    ): Keyframe[] =>
      keyframes.map((keyframe, index) => ({
        id: `${prefix}-keyframe-${index + 1}`,
        time: keyframe.time,
        property: keyframe.property,
        value: keyframe.value,
        easing: keyframe.easing,
      }));

    const buildEditingTemplateSource = (
      templateId: string,
      applicationId: string,
      ownerClipId: string,
      ownerTrackId: string,
      controlValues: Record<string, unknown> | undefined,
    ): EditingTemplateApplicationSource => ({
      templateId,
      applicationId,
      ownerClipId,
      ownerTrackId,
      controlValues,
    });

    const buildAppliedEditingTemplate = (
      resolvedTemplate: ResolvedEditingTemplateApplication,
      applicationId: string,
      appliedAt: number = Date.now(),
    ): AppliedEditingTemplate => ({
      templateId: resolvedTemplate.template.id,
      applicationId,
      name: resolvedTemplate.template.name,
      category: resolvedTemplate.template.category,
      appliedAt,
      controlValues: resolvedTemplate.controlValues,
    });

    const getEditingTemplateApplicationState = (
      entry: EditingTemplateHistoryEntry,
    ): EditingTemplateApplicationState => ({
      ownerClipId: entry.ownerClipId,
      templateId: entry.templateId,
      applicationId: entry.applicationId,
      appliedTemplate: entry.appliedTemplate,
      addedEffects: entry.addedEffects,
      addedAudioEffects: entry.addedAudioEffects,
      addedKeyframes: entry.addedKeyframes,
      overlays: entry.overlays,
      trackSnapshots: entry.trackSnapshots,
    });

    const getEditingTemplatePreferredTrackIds = (
      applicationState: EditingTemplateApplicationState,
    ): Partial<Record<"text" | "graphics", string>> =>
      applicationState.overlays.reduce<Partial<Record<"text" | "graphics", string>>>(
        (trackIds, placement) => {
          trackIds[placement.overlay.trackType] = placement.trackId;
          return trackIds;
        },
        {},
      );

    const findEditingTemplateHistoryEntry = (
      clipId: string,
      applicationId: string,
    ): EditingTemplateHistoryEntry | undefined => {
      const { templateUndoStack, templateRedoStack } = get();

      return [...templateUndoStack, ...templateRedoStack]
        .reverse()
        .find(
          (entry) =>
            entry.ownerClipId === clipId && entry.applicationId === applicationId,
        );
    };

    const applyEditingTemplateApplicationToProject = (
      project: Project,
      templateId: string,
      clipId: string,
      overrides: Record<string, EditingTemplatePrimitive> = {},
      options: {
        applicationId?: string;
        appliedAt?: number;
        preferredTrackIds?: Partial<Record<"text" | "graphics", string>>;
        preservedTrackSnapshots?: EditingTemplateApplicationState["trackSnapshots"];
      } = {},
    ):
      | {
          project: Project;
          applicationState: EditingTemplateApplicationState;
        }
      | null => {
      const template = getBuiltInEditingTemplate(templateId);
      if (!template) {
        return null;
      }

      const track = project.timeline.tracks.find((candidate) =>
        candidate.clips.some((clip) => clip.id === clipId),
      );
      const ownerClip = track?.clips.find((clip) => clip.id === clipId);

      if (!track || !ownerClip) {
        return null;
      }

      const targetType =
        track.type === "image"
          ? "image"
          : track.type === "video"
            ? "video"
            : null;

      if (!targetType) {
        return null;
      }

      if (
        template.supportedTargets &&
        !template.supportedTargets.includes(targetType)
      ) {
        return null;
      }

      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      const needsTextTrack = template.recipe.overlays.some(
        (overlay) => overlay.trackType === "text",
      );
      const needsGraphicsTrack = template.recipe.overlays.some(
        (overlay) => overlay.trackType === "graphics",
      );

      if (
        (needsTextTrack && !titleEngine) ||
        (needsGraphicsTrack && !graphicsEngine)
      ) {
        return null;
      }

      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === ownerClip.mediaId,
      );
      const assetUrls = project.mediaLibrary.items.reduce<Record<string, string>>(
        (urls, item) => {
          const url = item.originalUrl ?? item.thumbnailUrl ?? undefined;
          if (url) {
            urls[item.id] = url;
          }
          return urls;
        },
        {},
      );

      const resolvedTemplate = resolveEditingTemplate(
        template,
        {
          clip: {
            id: ownerClip.id,
            startTime: ownerClip.startTime,
            duration: ownerClip.duration,
            name: mediaItem?.name,
          },
          assetUrls,
        },
        overrides,
      );

      const applicationId = options.applicationId || `editing-template-${uuidv4()}`;
      const appliedTemplate = buildAppliedEditingTemplate(
        resolvedTemplate,
        applicationId,
        options.appliedAt,
      );
      const templateSource = buildEditingTemplateSource(
        template.id,
        applicationId,
        ownerClip.id,
        ownerClip.trackId,
        appliedTemplate.controlValues,
      );

      const addedEffects = resolvedTemplate.effects.map((effect, index) => ({
        id: `template-effect-${applicationId}-${index + 1}-${effect.id}`,
        type: effect.type,
        params: effect.params,
        enabled: effect.enabled,
        metadata: { templateSource },
      }));
      const addedAudioEffects = resolvedTemplate.audioEffects.map((effect, index) => ({
        id: `template-audio-effect-${applicationId}-${index + 1}-${effect.id}`,
        type: effect.type,
        params: effect.params,
        enabled: effect.enabled,
        metadata: { templateSource },
      }));
      const addedKeyframes = [
        ...resolvedTemplate.effects.flatMap((effect, index) =>
          buildEditingTemplateKeyframes(
            `template-keyframe-${applicationId}-video-${index + 1}`,
            effect.keyframes,
          ),
        ),
        ...resolvedTemplate.audioEffects.flatMap((effect, index) =>
          buildEditingTemplateKeyframes(
            `template-keyframe-${applicationId}-audio-${index + 1}`,
            effect.keyframes,
          ),
        ),
      ];

      let updatedProject = project;
      const trackSnapshots = [
        ...((options.preservedTrackSnapshots || []).filter((snapshot) =>
          updatedProject.timeline.tracks.some((track) => track.id === snapshot.track.id),
        )),
      ];
      const resolvedTrackIds: Partial<Record<"text" | "graphics", string>> = {};

      for (const snapshot of trackSnapshots) {
        if (snapshot.track.type === "text" || snapshot.track.type === "graphics") {
          resolvedTrackIds[snapshot.track.type] = snapshot.track.id;
        }
      }

      const ensureOverlayTrack = (trackType: "text" | "graphics"): string => {
        const existingTrackId = resolvedTrackIds[trackType];
        if (
          existingTrackId &&
          updatedProject.timeline.tracks.some((track) => track.id === existingTrackId)
        ) {
          return existingTrackId;
        }

        const preferredTrackId = options.preferredTrackIds?.[trackType];
        if (
          preferredTrackId &&
          updatedProject.timeline.tracks.some((track) => track.id === preferredTrackId)
        ) {
          resolvedTrackIds[trackType] = preferredTrackId;
          return preferredTrackId;
        }

        const existingTrack = updatedProject.timeline.tracks.find(
          (candidate) => candidate.type === trackType,
        );
        if (existingTrack) {
          resolvedTrackIds[trackType] = existingTrack.id;
          return existingTrack.id;
        }

        const snapshot = {
          track: buildEditingTemplateTrack(trackType),
          position: 0,
        };
        trackSnapshots.push(snapshot);
        updatedProject = insertEditingTemplateTrack(updatedProject, snapshot);
        resolvedTrackIds[trackType] = snapshot.track.id;
        return snapshot.track.id;
      };

      const overlays: EditingTemplateApplicationState["overlays"] =
        resolvedTemplate.overlays.map((overlay, index) => ({
          trackId: ensureOverlayTrack(overlay.trackType),
          overlay: {
            ...overlay,
            id: `template-overlay-${applicationId}-${index + 1}-${overlay.id}`,
          },
        }));

      const nextProject = updateProjectClip(updatedProject, clipId, (clip) => ({
        ...clip,
        effects: [...clip.effects, ...addedEffects],
        audioEffects: [...clip.audioEffects, ...addedAudioEffects],
        keyframes: [...clip.keyframes, ...addedKeyframes],
        metadata: {
          ...(clip.metadata || {}),
          appliedTemplates: [
            ...(clip.metadata?.appliedTemplates || []),
            appliedTemplate,
          ],
        },
      }));

      if (!nextProject) {
        return null;
      }

      updatedProject = nextProject;

      for (const placement of overlays) {
        if (!createEditingTemplateOverlay(placement, templateSource)) {
          removeEditingTemplateApplicationFromProject(
            updatedProject,
            clipId,
            applicationId,
            trackSnapshots.map((snapshot) => snapshot.track.id),
          );
          return null;
        }
      }

      syncClipEffectsBridge(updatedProject, clipId);

      return {
        project: {
          ...updatedProject,
          modifiedAt: Date.now(),
        },
        applicationState: {
          ownerClipId: clipId,
          templateId: template.id,
          applicationId,
          appliedTemplate,
          addedEffects,
          addedAudioEffects,
          addedKeyframes,
          overlays,
          trackSnapshots,
        },
      };
    };

    const canRestoreEditingTemplateOverlays = (
      overlays: EditingTemplateHistoryEntry["overlays"],
    ): boolean => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      for (const placement of overlays) {
        if (placement.overlay.type === "text" && !titleEngine) {
          return false;
        }

        if (placement.overlay.type !== "text" && !graphicsEngine) {
          return false;
        }

        if (placement.overlay.type === "image" && !placement.overlay.content.imageUrl) {
          return false;
        }
      }

      return true;
    };

    const createEditingTemplateOverlay = (
      placement: EditingTemplateHistoryEntry["overlays"][number],
      source: EditingTemplateApplicationSource,
    ): boolean => {
      const metadata = {
        templateSource: source,
        templateManaged: true,
        templateTrackType: placement.overlay.trackType,
      };

      if (placement.overlay.type === "text") {
        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (!titleEngine) {
          return false;
        }

        if (titleEngine.getTextClip(placement.overlay.id)) {
          return true;
        }

        titleEngine.createTextClip({
          id: placement.overlay.id,
          trackId: placement.trackId,
          startTime: placement.overlay.timing.startTime,
          duration: placement.overlay.timing.duration,
          text: placement.overlay.content.text,
          style: placement.overlay.content.style,
          transform: placement.overlay.transform,
          animation: placement.overlay.content.animation
            ? {
                preset: placement.overlay.content.animation.preset,
                params: placement.overlay.content.animation.params || {},
                inDuration: placement.overlay.content.animation.inDuration,
                outDuration: placement.overlay.content.animation.outDuration,
                stagger: placement.overlay.content.animation.stagger,
                unit: placement.overlay.content.animation.unit,
              }
            : undefined,
          metadata,
        });

        return Boolean(
          titleEngine.updateTextClip(placement.overlay.id, {
            keyframes: buildEditingTemplateKeyframes(
              placement.overlay.id,
              placement.overlay.keyframes,
            ),
            blendMode: placement.overlay.blendMode,
            blendOpacity: placement.overlay.blendOpacity,
            emphasisAnimation: placement.overlay.emphasisAnimation,
            metadata,
          }),
        );
      }

      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        return false;
      }

      if (placement.overlay.type === "shape") {
        if (graphicsEngine.getShapeClip(placement.overlay.id)) {
          return true;
        }

        graphicsEngine.createShape(
          {
            id: placement.overlay.id,
            shapeType: placement.overlay.content.shapeType,
            width: placement.overlay.content.width,
            height: placement.overlay.content.height,
            style: placement.overlay.content.style,
            metadata,
          },
          placement.trackId,
          placement.overlay.timing.startTime,
          placement.overlay.timing.duration,
        );

        return Boolean(
          graphicsEngine.updateShapeClip(placement.overlay.id, {
            transform: placement.overlay.transform,
            keyframes: buildEditingTemplateKeyframes(
              placement.overlay.id,
              placement.overlay.keyframes,
            ),
            blendMode: placement.overlay.blendMode,
            blendOpacity: placement.overlay.blendOpacity,
            emphasisAnimation: placement.overlay.emphasisAnimation,
          }),
        );
      }

      if (graphicsEngine.getStickerClip(placement.overlay.id)) {
        return true;
      }

      if (!placement.overlay.content.imageUrl) {
        return false;
      }

      graphicsEngine.addStickerClip({
        id: placement.overlay.id,
        trackId: placement.trackId,
        startTime: placement.overlay.timing.startTime,
        duration: placement.overlay.timing.duration,
        type: "sticker",
        imageUrl: placement.overlay.content.imageUrl,
        name: placement.overlay.content.name,
        transform: placement.overlay.transform,
        keyframes: buildEditingTemplateKeyframes(
          placement.overlay.id,
          placement.overlay.keyframes,
        ),
        blendMode: placement.overlay.blendMode,
        blendOpacity: placement.overlay.blendOpacity,
        emphasisAnimation: placement.overlay.emphasisAnimation,
        metadata,
      });

      return true;
    };

    const hasEditingTemplateArtifacts = (
      project: Project,
      ownerClipId: string,
      applicationId: string,
    ): boolean => {
      const ownerClip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === ownerClipId);

      if (ownerClip) {
        if ((ownerClip.metadata?.appliedTemplates || []).some(
          (template) => template.applicationId === applicationId,
        )) {
          return true;
        }

        if (ownerClip.effects.some(
          (effect) => effect.metadata?.templateSource?.applicationId === applicationId,
        )) {
          return true;
        }

        if (ownerClip.audioEffects.some(
          (effect) => effect.metadata?.templateSource?.applicationId === applicationId,
        )) {
          return true;
        }

        if (ownerClip.keyframes.some(
          (keyframe) => keyframe.id.startsWith(`template-keyframe-${applicationId}-`),
        )) {
          return true;
        }
      }

      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (titleEngine?.getAllTextClips().some(
        (clip) => clip.metadata?.templateSource?.applicationId === applicationId,
      )) {
        return true;
      }

      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        return false;
      }

      return [
        ...graphicsEngine.getAllShapeClips(),
        ...graphicsEngine.getAllSVGClips(),
        ...graphicsEngine.getAllStickerClips(),
      ].some((clip) => clip.metadata?.templateSource?.applicationId === applicationId);
    };

    const removeEditingTemplateApplicationFromProject = (
      project: Project,
      ownerClipId: string,
      applicationId: string,
      trackIdsToRemoveIfEmpty: string[] = [],
    ): Project => {
      let updatedProject = project;
      const currentOwnerClip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === ownerClipId);

      if (currentOwnerClip) {
        const nextProject = updateProjectClip(project, ownerClipId, (clip) => {
          const appliedTemplates = (clip.metadata?.appliedTemplates || []).filter(
            (template) => template.applicationId !== applicationId,
          );
          const metadata: Record<string, unknown> = {
            ...(clip.metadata || {}),
          };

          if (appliedTemplates.length > 0) {
            metadata.appliedTemplates = appliedTemplates;
          } else {
            delete metadata.appliedTemplates;
          }

          return {
            ...clip,
            effects: clip.effects.filter(
              (effect) => effect.metadata?.templateSource?.applicationId !== applicationId,
            ),
            audioEffects: clip.audioEffects.filter(
              (effect) => effect.metadata?.templateSource?.applicationId !== applicationId,
            ),
            keyframes: clip.keyframes.filter(
              (keyframe) => !keyframe.id.startsWith(`template-keyframe-${applicationId}-`),
            ),
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          };
        });

        if (nextProject) {
          updatedProject = nextProject;
        }
      }

      const titleEngine = useEngineStore.getState().getTitleEngine();
      for (const textClip of titleEngine?.getAllTextClips() || []) {
        if (textClip.metadata?.templateSource?.applicationId === applicationId) {
          titleEngine?.deleteTextClip(textClip.id);
        }
      }

      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (graphicsEngine) {
        for (const shapeClip of graphicsEngine.getAllShapeClips()) {
          if (shapeClip.metadata?.templateSource?.applicationId === applicationId) {
            graphicsEngine.deleteShapeClip(shapeClip.id);
          }
        }

        for (const svgClip of graphicsEngine.getAllSVGClips()) {
          if (svgClip.metadata?.templateSource?.applicationId === applicationId) {
            graphicsEngine.deleteSVGClip(svgClip.id);
          }
        }

        for (const stickerClip of graphicsEngine.getAllStickerClips()) {
          if (stickerClip.metadata?.templateSource?.applicationId === applicationId) {
            graphicsEngine.deleteStickerClip(stickerClip.id);
          }
        }
      }

      for (const trackId of trackIdsToRemoveIfEmpty) {
        if (!trackHasAnyClips(updatedProject, trackId)) {
          updatedProject = removeTrackFromProjectState(updatedProject, trackId);
        }
      }

      syncClipEffectsBridge(updatedProject, ownerClipId);

      return {
        ...updatedProject,
        modifiedAt: Date.now(),
      };
    };

    const removeEditingTemplateApplicationStateFromProject = (
      project: Project,
      applicationState: EditingTemplateApplicationState,
      removeEmptyTracks: boolean = true,
    ): Project =>
      removeEditingTemplateApplicationFromProject(
        project,
        applicationState.ownerClipId,
        applicationState.applicationId,
        removeEmptyTracks
          ? applicationState.trackSnapshots.map((snapshot) => snapshot.track.id)
          : [],
      );

    const restoreEditingTemplateApplicationState = (
      project: Project,
      applicationState: EditingTemplateApplicationState,
    ): Project | null => {
      if (!canRestoreEditingTemplateOverlays(applicationState.overlays)) {
        return null;
      }

      let updatedProject = project;
      for (const snapshot of applicationState.trackSnapshots) {
        updatedProject = insertEditingTemplateTrack(updatedProject, snapshot);
      }

      const ownerClip = updatedProject.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === applicationState.ownerClipId);
      if (!ownerClip) {
        return null;
      }

      const templateSource = buildEditingTemplateSource(
        applicationState.templateId,
        applicationState.applicationId,
        applicationState.ownerClipId,
        ownerClip.trackId,
        applicationState.appliedTemplate.controlValues,
      );

      const nextProject = updateProjectClip(
        updatedProject,
        applicationState.ownerClipId,
        (clip) => {
        const effectIds = new Set(clip.effects.map((effect) => effect.id));
        const audioEffectIds = new Set(clip.audioEffects.map((effect) => effect.id));
        const keyframeIds = new Set(clip.keyframes.map((keyframe) => keyframe.id));
        const appliedTemplates = clip.metadata?.appliedTemplates || [];
        const hasAppliedTemplate = appliedTemplates.some(
          (template) =>
            template.applicationId === applicationState.applicationId,
        );

        return {
          ...clip,
          effects: [
            ...clip.effects,
            ...applicationState.addedEffects.filter(
              (effect) => !effectIds.has(effect.id),
            ),
          ],
          audioEffects: [
            ...clip.audioEffects,
            ...applicationState.addedAudioEffects.filter(
              (effect) => !audioEffectIds.has(effect.id),
            ),
          ],
          keyframes: [
            ...clip.keyframes,
            ...applicationState.addedKeyframes.filter(
              (keyframe) => !keyframeIds.has(keyframe.id),
            ),
          ],
          metadata: {
            ...(clip.metadata || {}),
            appliedTemplates: hasAppliedTemplate
              ? appliedTemplates
              : [...appliedTemplates, applicationState.appliedTemplate],
          },
        };
      },
      );

      if (!nextProject) {
        return null;
      }

      updatedProject = nextProject;

      for (const placement of applicationState.overlays) {
        if (!createEditingTemplateOverlay(placement, templateSource)) {
          return null;
        }
      }

      syncClipEffectsBridge(updatedProject, applicationState.ownerClipId);

      return {
        ...updatedProject,
        modifiedAt: Date.now(),
      };
    };

    return {
      // Initial state - create empty project (Requirement 1.1)
      project: createEmptyProject(),
      hasOpenProject: false,
      photoProjects: new Map(),
      actionExecutor,
      actionHistory,
      clipUndoStack: [] as ClipHistoryEntry[],
      clipRedoStack: [] as ClipHistoryEntry[],
      templateUndoStack: [] as EditingTemplateHistoryEntry[],
      templateRedoStack: [] as EditingTemplateHistoryEntry[],
      redoJournal: [] as Array<"action" | "clip" | "template">,
      isLoading: false,
      error: null,
      clipboard: [] as TimelineClipboardItem[],
      lastPastedClipIds: [] as string[],
      copiedEffects: [] as Effect[],

      createNewProject: (
        name?: string,
        settings?: Partial<ProjectSettings>,
      ) => {
        const newHistory = new ActionHistory();
        const newExecutor = new ActionExecutor(newHistory);
        const previousProject = get().project;
        const nextProject = createEmptyProject(name, settings);

        syncProjectEffectsBridge(nextProject, previousProject);
        syncProjectTransitionsBridge(nextProject, previousProject);

        registerProjectGeneratedShaders(nextProject);

        useEngineStore.getState().getTitleEngine()?.loadTextClips([]);
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        graphicsEngine?.loadShapeClips([]);
        graphicsEngine?.loadSVGClips([]);
        graphicsEngine?.loadStickerClips([]);

        set({
          project: nextProject,
          hasOpenProject: true,
          actionHistory: newHistory,
          actionExecutor: newExecutor,
          clipUndoStack: [],
          clipRedoStack: [],
          templateUndoStack: [],
          templateRedoStack: [],
          clipboard: [],
          lastPastedClipIds: [],
          error: null,
        });
      },

      loadProject: (incomingProject: Project) => {
        const motionNormalized = normalizeProjectMotionFields(incomingProject);
        const project: Project = {
          ...motionNormalized,
          generatedShaders: normalizeGeneratedShaders(
            motionNormalized.generatedShaders,
          ),
        };
        const previousProject = get().project;
        const titleEngine = useEngineStore.getState().getTitleEngine();
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

        titleEngine?.loadTextClips(project.textClips ?? []);
        if (graphicsEngine) {
          graphicsEngine.loadShapeClips(project.shapeClips ?? []);
          graphicsEngine.loadSVGClips(project.svgClips ?? []);
          graphicsEngine.loadStickerClips(project.stickerClips ?? []);
        }

        const newHistory = new ActionHistory();
        const newExecutor = new ActionExecutor(newHistory);

        // Fix legacy projects where timeline.duration was never persisted
        const computedDuration = calculateTimelineDuration(project);
        const fixedProject = computedDuration !== project.timeline.duration
          ? { ...project, timeline: { ...project.timeline, duration: computedDuration } }
          : project;

        syncProjectEffectsBridge(fixedProject, previousProject);
        syncProjectTransitionsBridge(fixedProject, previousProject);

        registerProjectGeneratedShaders(fixedProject);

        set({
          project: fixedProject,
          hasOpenProject: true,
          actionHistory: newHistory,
          actionExecutor: newExecutor,
          clipUndoStack: [],
          clipRedoStack: [],
          templateUndoStack: [],
          templateRedoStack: [],
          clipboard: [],
          lastPastedClipIds: [],
          error: null,
        });

        // Auto-restore placeholder assets from saved FileSystemFileHandles (same machine)
        const placeholders = fixedProject.mediaLibrary.items.filter(
          (item) => item.isPlaceholder && item.sourceFile,
        );
        if (placeholders.length > 0 && "FileSystemFileHandle" in window) {
          (async () => {
            let restored = 0;
            const stillMissing: typeof placeholders = [];

            // Tier 1: try individual file handles (follow file across folder moves)
            for (const item of placeholders) {
              if (!item.sourceFile) continue;
              try {
                const handle = await loadFileHandle(item.sourceFile.name, item.sourceFile.size);
                if (!handle) { stillMissing.push(item); continue; }
                const file = await handle.getFile();
                await get().replaceMediaAsset(item.id, file, item.sourceFile.folder);
                restored++;
              } catch {
                stillMissing.push(item); // stale handle
              }
            }

            // Tier 2: scan the stored relink folder for files not found via handle
            if (stillMissing.length > 0) {
              try {
                const dirInfo = await loadDirectoryHandle(fixedProject.id);
                if (dirInfo) {
                  const fileMap = new Map<string, { file: File; folder: string }>();
                  const entries = (dirInfo.handle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
                  for await (const [, fh] of entries) {
                    if ((fh as FileSystemHandle).kind === "file") {
                      const f = await (fh as FileSystemFileHandle).getFile();
                      fileMap.set(`${f.name.toLowerCase()}:${f.size}`, { file: f, folder: dirInfo.folderName });
                    }
                  }
                  for (const item of stillMissing) {
                    if (!item.sourceFile) continue;
                    const entry = fileMap.get(`${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`);
                    if (entry) {
                      try {
                        await get().replaceMediaAsset(item.id, entry.file, entry.folder);
                        restored++;
                      } catch { /* skip */ }
                    }
                  }
                }
              } catch { /* dir handle stale or unavailable */ }
            }

            if (restored > 0) {
              console.info(`[ProjectStore] Auto-restored ${restored} asset(s) from file handles`);
            }
          })();
        }
      },

      // Rename project
      renameProject: async (name: string) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "project/rename",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { name },
        };
        const result = await actionExecutor.execute(action, project);
        if (result.success) {
          set({ project: { ...project } });
        }
        return result;
      },

      // Update project settings
      updateSettings: async (settings: Partial<ProjectSettings>) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "project/updateSettings",
          id: uuidv4(),
          timestamp: Date.now(),
          params: settings,
        };
        const result = await actionExecutor.execute(action, project);
        if (result.success) {
          set({ project: { ...project } });
        }
        return result;
      },

      setCanvasBackground: async (mode, color) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "project/setCanvasBackground",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            backgroundFillMode: mode,
            layoutBackgroundColor: color,
          },
        };
        const result = await actionExecutor.execute(action, project);
        if (result.success) {
          set({ project: { ...project } });
        }
        return result;
      },

      // Media library actions
      ...createMediaSlice(set, get),

      addPlaceholderMedia: (item: MediaItem) => {
        const { project } = get();
        set({
          project: {
            ...project,
            mediaLibrary: {
              ...project.mediaLibrary,
              items: [...project.mediaLibrary.items, item],
            },
            modifiedAt: Date.now(),
          },
        });
      },

      setKieAIItemState: (mediaId: string, isPending: boolean, kieaiError: boolean) => {
        const { project } = get();
        const updatedItems = project.mediaLibrary.items.map((item) =>
          item.id === mediaId ? { ...item, isPending, kieaiError } : item,
        );
        set({
          project: {
            ...project,
            mediaLibrary: { ...project.mediaLibrary, items: updatedItems },
            modifiedAt: Date.now(),
          },
        });
      },

      replacePlaceholderMedia: async (mediaId: string, blob: Blob, name: string) => {
        const { project } = get();

        // For images use createImageBitmap (no mediaBridge dependency).
        // This avoids WASM initialisation races and works immediately in any context.
        let thumbnailUrl: string | null = null;
        let width = 0;
        let height = 0;

        if (blob.size > 0 && blob.type.startsWith("image/")) {
          try {
            const bitmap = await createImageBitmap(blob);
            width = bitmap.width;
            height = bitmap.height;

            const THUMB_SIZE = 320;
            const scale = Math.min(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height, 1);
            const tw = Math.round(bitmap.width * scale);
            const th = Math.round(bitmap.height * scale);

            const canvas = new OffscreenCanvas(tw, th);
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0, tw, th);
            bitmap.close();

            const thumbBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
            thumbnailUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(thumbBlob);
            });
          } catch (thumbErr) {
            console.warn("[ProjectStore] KieAI thumbnail generation failed:", thumbErr);
          }
        }

        const file = new File([blob], name, { type: blob.type || "image/png" });

        const updatedItem: MediaItem = {
          id: mediaId,
          name,
          type: "image",
          fileHandle: null,
          blob: file,
          metadata: {
            duration: 0,
            width,
            height,
            frameRate: 0,
            codec: "",
            sampleRate: 0,
            channels: 0,
            fileSize: file.size,
          },
          thumbnailUrl,
          waveformData: null,
          isPlaceholder: false,
          isPending: false,
        };

        const updatedItems = project.mediaLibrary.items.map((item) =>
          item.id === mediaId ? updatedItem : item,
        );

        set({
          project: {
            ...project,
            mediaLibrary: { ...project.mediaLibrary, items: updatedItems },
            modifiedAt: Date.now(),
          },
        });

        try {
          await saveMediaBlob(project.id, mediaId, file, updatedItem.metadata);
        } catch (err) {
          console.error("[ProjectStore] Failed to persist KieAI result blob:", err);
        }
      },

      // Track actions
      ...createTrackSlice(set, get),

      // Clip actions
      ...createClipSlice(set, get),

      addClipTransition: async (transition: Transition) => {
        const { project, actionExecutor } = get();
        const clip = project.timeline.tracks
          .flatMap((track) => track.clips)
          .find((candidate) => candidate.id === transition.clipAId);

        if (!clip) {
          return null;
        }

        const action: Action = {
          type: "transition/set",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { transition },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to add transition:", result.error?.message);
          return null;
        }

        set({ project: { ...project, modifiedAt: Date.now() } });
        syncTrackTransitionsBridge(get().project, clip.trackId);
        return transition;
      },

      updateClipTransition: async (
        transitionId: string,
        updates: Partial<Pick<Transition, "type" | "duration" | "params">>,
      ) => {
        const { project, actionExecutor } = get();
        const ownerTrack = project.timeline.tracks.find((track) =>
          track.transitions.some((t) => t.id === transitionId),
        );
        if (!ownerTrack) {
          return null;
        }

        const action: Action = {
          type: "transition/update",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            transitionId,
            ...(updates.type !== undefined ? { type: updates.type } : {}),
            ...(updates.duration !== undefined
              ? { duration: updates.duration }
              : {}),
            ...(updates.params !== undefined ? { params: updates.params } : {}),
          },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to update transition:", result.error?.message);
          return null;
        }

        set({ project: { ...project, modifiedAt: Date.now() } });
        syncTrackTransitionsBridge(get().project, ownerTrack.id);
        return (
          get()
            .project.timeline.tracks.flatMap((track) => track.transitions)
            .find((t) => t.id === transitionId) ?? null
        );
      },

      removeClipTransition: async (transitionId: string) => {
        const { project, actionExecutor } = get();
        const ownerTrack = project.timeline.tracks.find((track) =>
          track.transitions.some((t) => t.id === transitionId),
        );
        if (!ownerTrack) {
          return false;
        }

        const action: Action = {
          type: "transition/remove",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { transitionId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to remove transition:", result.error?.message);
          return false;
        }

        set({ project: { ...project, modifiedAt: Date.now() } });
        syncTrackTransitionsBridge(get().project, ownerTrack.id);
        return true;
      },

      getClipTransition: (transitionId: string) => {
        const { project } = get();
        for (const track of project.timeline.tracks) {
          const transition = track.transitions.find(
            (candidate) => candidate.id === transitionId,
          );
          if (transition) {
            return transition;
          }
        }
        return undefined;
      },

      getClipTransitionBetweenClips: (clipAId: string, clipBId: string) => {
        const { project } = get();
        for (const track of project.timeline.tracks) {
          const transition = track.transitions.find(
            (candidate) =>
              candidate.clipAId === clipAId && candidate.clipBId === clipBId,
          );
          if (transition) {
            return transition;
          }
        }
        return undefined;
      },

      copyClips: (clipIds: string[]) => {
        const state = get();
        const items = clipIds
          .map((clipId): TimelineClipboardItem | null => {
            const mediaClip = state.getClip(clipId);
            if (mediaClip) {
              return { kind: "media", clip: structuredClone(mediaClip) };
            }
            const textClip = state.getTextClip(clipId);
            if (textClip) {
              return { kind: "text", clip: structuredClone(textClip) };
            }
            const shapeClip = state.getShapeClip(clipId);
            if (shapeClip) {
              return { kind: "shape", clip: structuredClone(shapeClip) };
            }
            const svgClip = state.getSVGClip(clipId);
            if (svgClip) {
              return { kind: "svg", clip: structuredClone(svgClip) };
            }
            const stickerClip = state.getStickerClip(clipId);
            if (stickerClip) {
              return { kind: "sticker", clip: structuredClone(stickerClip) };
            }
            return null;
          })
          .filter((item): item is TimelineClipboardItem => item !== null);
        set({ clipboard: items, lastPastedClipIds: [] });
      },

      pasteClips: async (trackId: string, startTime: number) => {
        const { clipboard, actionExecutor } = get();
        const results: ActionResult[] = [];
        const pastedIds: string[] = [];

        if (clipboard.length === 0) {
          return [
            {
              success: false,
              error: {
                code: "INVALID_PARAMS" as const,
                message: "Clipboard is empty",
              },
            },
          ];
        }

        const minStartTime = Math.min(
          ...clipboard.map((item) => item.clip.startTime),
        );
        actionExecutor.getHistory().beginGroup("Paste timeline clips");
        try {
          for (const item of clipboard) {
            const currentProject = get().project;
            const newStartTime = Math.max(
              0,
              startTime + item.clip.startTime - minStartTime,
            );
            const sourceTrack = currentProject.timeline.tracks.find(
              (track) => track.id === item.clip.trackId,
            );
            const expectedTrackType =
              item.kind === "text"
                ? "text"
                : item.kind === "media"
                  ? sourceTrack?.type
                  : "graphics";
            const isCompatible = (track: Track) =>
              !track.locked &&
              (!expectedTrackType || track.type === expectedTrackType);
            const destinationTrack =
              (sourceTrack && isCompatible(sourceTrack)
                ? sourceTrack
                : undefined) ??
              currentProject.timeline.tracks.find(
                (track) => track.id === trackId && isCompatible(track),
              ) ??
              currentProject.timeline.tracks.find(isCompatible);

            if (!destinationTrack) {
              results.push({
                success: false,
                error: {
                  code: "TRACK_NOT_FOUND",
                  message: `No compatible unlocked track for ${item.kind} clip`,
                },
              });
              continue;
            }

            if (item.kind !== "media") {
              const pasted = get().pasteOverlayClip(
                item.kind,
                item.clip,
                newStartTime,
                destinationTrack.id,
              );
              if (pasted) {
                results.push({ success: true });
                pastedIds.push(pasted.id);
              } else {
                results.push({
                  success: false,
                  error: {
                    code: "INVALID_PARAMS",
                    message: `Failed to paste ${item.kind} clip`,
                  },
                });
              }
              continue;
            }

            const beforeIds = new Set(
              destinationTrack.clips.map((clip) => clip.id),
            );
            const action: Action = {
              type: "clip/add",
              id: uuidv4(),
              timestamp: Date.now(),
              params: {
                trackId: destinationTrack.id,
                mediaId: item.clip.mediaId,
                startTime: newStartTime,
                sourceClip: item.clip,
              },
            };
            const result = await actionExecutor.execute(action, currentProject);
            results.push(result);
            if (result.success) {
              const pasted = destinationTrack.clips.find(
                (clip) => !beforeIds.has(clip.id),
              );
              if (pasted) pastedIds.push(pasted.id);
            }
          }
        } finally {
          actionExecutor.getHistory().endGroup();
        }

        set({
          project: { ...get().project, modifiedAt: Date.now() },
          lastPastedClipIds: pastedIds,
        });
        return results;
      },

      duplicateClip: async (clipId: string) => {
        const { getClip, project, actionExecutor } = get();
        const clip = getClip(clipId);
        if (!clip) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS" as const,
              message: "Clip not found",
            },
          };
        }

        const track = project.timeline.tracks.find((t) =>
          t.clips.some((c) => c.id === clipId),
        );
        if (!track) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS" as const,
              message: "Track not found",
            },
          };
        }

        // Place the duplicate immediately after the original on the same
        // track. If there's a clip already starting at that time, scan
        // forward until we find the next gap large enough for the
        // duplicate's full duration.
        const sortedClips = [...track.clips].sort(
          (a, b) => a.startTime - b.startTime,
        );
        let candidate = clip.startTime + clip.duration;
        const epsilon = 0.0001;
        for (const other of sortedClips) {
          if (other.id === clip.id) continue;
          if (other.startTime + other.duration <= candidate + epsilon) continue;
          if (other.startTime >= candidate + clip.duration - epsilon) break;
          candidate = other.startTime + other.duration;
        }

        const projectCopy = structuredClone(project);
        const action: Action = {
          type: "clip/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackId: track.id,
            mediaId: clip.mediaId,
            startTime: candidate,
            duration: clip.duration,
            inPoint: clip.inPoint,
            outPoint: clip.outPoint,
            volume: clip.volume,
            effects: structuredClone(clip.effects),
            audioEffects: clip.audioEffects
              ? structuredClone(clip.audioEffects)
              : undefined,
            keyframes: clip.keyframes ? structuredClone(clip.keyframes) : undefined,
            transform: clip.transform ? structuredClone(clip.transform) : undefined,
            ...(clip.fade ? { fade: clip.fade } : {}),
            ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
            ...(clip.reversed !== undefined ? { reversed: clip.reversed } : {}),
            ...(clip.audioTrackIndex !== undefined
              ? { audioTrackIndex: clip.audioTrackIndex }
              : {}),
          },
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

      copyEffects: (clipId: string) => {
        const { getClip } = get();
        const clip = getClip(clipId);
        if (clip) {
          const copiedEffects = JSON.parse(JSON.stringify(clip.effects));
          set({ copiedEffects });
        }
      },

      pasteEffects: async (clipId: string) => {
        const { copiedEffects, project, actionExecutor } = get();
        if (copiedEffects.length === 0) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS" as const,
              message: "No effects in clipboard",
            },
          };
        }

        const results: ActionResult[] = [];
        for (const effect of copiedEffects) {
          const action: Action = {
            type: "effect/add",
            id: uuidv4(),
            timestamp: Date.now(),
            params: {
              clipId,
              effectType: effect.type,
              params: effect.params,
            },
          };
          const result = await actionExecutor.execute(action, project);
          results.push(result);
        }

        set({ project: { ...project } });
        return (
          results[0] || {
            success: false,
            error: { code: "UNKNOWN" as const, message: "No results" },
          }
        );
      },

      updateClipTransform: async (
        clipId: string,
        transformUpdate: Partial<Transform>,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        const mergeTransform = (base: Transform): Transform => ({
          ...base,
          ...transformUpdate,
          position: { ...base.position, ...(transformUpdate.position || {}) },
          scale: { ...base.scale, ...(transformUpdate.scale || {}) },
          anchor: { ...base.anchor, ...(transformUpdate.anchor || {}) },
        });

        // Timeline clips are undoable via the action system (the deep-merge of
        // nested axes happens in the transform/update apply handler).
        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "transform/update",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, transform: transformUpdate },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        // Text clips live in the title engine (not project.timeline); they use
        // the separate clip-history mechanism, so keep the direct engine update.
        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: mergeTransform(textClip.transform),
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        // Shape / SVG clips live in the graphics engine.
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: mergeTransform(shapeClip.transform),
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: mergeTransform(svgClip.transform),
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipBlendMode: async (
        clipId: string,
        blendMode,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        // Timeline clips are undoable via the action system.
        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "clip/setBlendMode",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, blendMode },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        // Text clips live in the title engine.
        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, { blendMode });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        // Shape / SVG clips live in the graphics engine.
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, { blendMode });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, { blendMode });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipBlendOpacity: async (
        clipId: string,
        opacity: number,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        if (opacity < 0 || opacity > 100) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: "Blend opacity must be between 0 and 100",
            },
          };
        }

        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "clip/setBlendOpacity",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, opacity },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, { blendOpacity: opacity });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, { blendOpacity: opacity });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, { blendOpacity: opacity });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipEmphasisAnimation: async (
        clipId: string,
        emphasisAnimation,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "clip/setEmphasisAnimation",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, emphasisAnimation },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const stickerClip = graphicsEngine.getStickerClip(clipId);
          if (stickerClip) {
            graphicsEngine.updateStickerClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipRotate3D: (
        clipId: string,
        rotate3d: { x: number; y: number; z: number },
      ) => {
        const { project } = get();

        let found = false;
        const newTracks = project.timeline.tracks.map((track) => {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex === -1) return track;

          found = true;
          const clip = track.clips[clipIndex];
          const newClips = [...track.clips];
          newClips[clipIndex] = {
            ...clip,
            transform: { ...clip.transform, rotate3d },
          };

          return { ...track, clips: newClips };
        });

        if (found) {
          set({
            project: {
              ...project,
              timeline: { ...project.timeline, tracks: newTracks },
              modifiedAt: Date.now(),
            },
          });
          return true;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: { ...textClip.transform, rotate3d },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: { ...shapeClip.transform, rotate3d },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: { ...svgClip.transform, rotate3d },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        return false;
      },

      updateClipPerspective: (clipId: string, perspective: number) => {
        const { project } = get();

        if (perspective < 0) {
          console.error("Perspective must be non-negative");
          return false;
        }

        let found = false;
        const newTracks = project.timeline.tracks.map((track) => {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex === -1) return track;

          found = true;
          const clip = track.clips[clipIndex];
          const newClips = [...track.clips];
          newClips[clipIndex] = {
            ...clip,
            transform: { ...clip.transform, perspective },
          };

          return { ...track, clips: newClips };
        });

        if (found) {
          set({
            project: {
              ...project,
              timeline: { ...project.timeline, tracks: newTracks },
              modifiedAt: Date.now(),
            },
          });
          return true;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: { ...textClip.transform, perspective },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: { ...shapeClip.transform, perspective },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: { ...svgClip.transform, perspective },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        return false;
      },

      updateClipTransformStyle: (
        clipId: string,
        transformStyle: "flat" | "preserve-3d",
      ) => {
        const { project } = get();

        let found = false;
        const newTracks = project.timeline.tracks.map((track) => {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex === -1) return track;

          found = true;
          const clip = track.clips[clipIndex];
          const newClips = [...track.clips];
          newClips[clipIndex] = {
            ...clip,
            transform: { ...clip.transform, transformStyle },
          };

          return { ...track, clips: newClips };
        });

        if (found) {
          set({
            project: {
              ...project,
              timeline: { ...project.timeline, tracks: newTracks },
              modifiedAt: Date.now(),
            },
          });
          return true;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: { ...textClip.transform, transformStyle },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: { ...shapeClip.transform, transformStyle },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: { ...svgClip.transform, transformStyle },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        return false;
      },

      // Undo/Redo
      ...createHistorySlice(set, get, {
        applyClipDataSnapshot,
        syncOverlayEnginesFromProject,
        syncProjectEffectsBridge,
        syncProjectTransitionsBridge,
        getEditingTemplateApplicationState,
        removeEditingTemplateApplicationStateFromProject,
        restoreEditingTemplateApplicationState,
      }),

      // Execute arbitrary action
      executeAction: async (action: Action) => {
        const { project, actionExecutor, hasOpenProject } = get();
        if (!hasOpenProject) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: "No project is open",
            },
          };
        }
        const result = await actionExecutor.execute(action, project);
        if (result.success) {
          set({ project: { ...project } });
        }
        return result;
      },

      // Computed values
      getTimelineDuration: () => {
        const { project } = get();
        return calculateTimelineDuration(project);
      },

      // Auto-save methods
      initializeAutoSave: async () => {
        if (autoSaveInitialized) return;
        autoSaveInitialized = true;
        await initializeAutoSave();
        autoSaveManager.start(() => {
          const { project } = get();
          const titleEngine = useEngineStore.getState().getTitleEngine();
          const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

          return {
            ...project,
            textClips: titleEngine?.getAllTextClips() || [],
            shapeClips: graphicsEngine?.getAllShapeClips() || [],
            svgClips: graphicsEngine?.getAllSVGClips() || [],
            stickerClips: graphicsEngine?.getAllStickerClips() || [],
          };
        });

        // Subscribe to project state changes to mark as dirty for auto-save
        // Uses Zustand's subscribeWithSelector middleware to detect changes to project object only
        // Trigger auto-save when any project field changes (timeline, media, settings, etc.)
        useProjectStore.subscribe(
          (state) => state.project,
          () => {
            autoSaveManager.markDirty(get().getFullProject());
          },
        );
      },

      checkForRecovery: async () => {
        const { project } = get();
        return autoSaveManager.checkForRecovery(project.id);
      },

      recoverFromAutoSave: async (saveId: string) => {
        const recoveredProject = await autoSaveManager.recover(saveId);
        if (recoveredProject) {
          const storedMedia = await loadProjectMedia(recoveredProject.id);
          const blobMap = new Map(storedMedia.map((m) => [m.id, m.blob]));

          const restoredItems = await Promise.all(
            recoveredProject.mediaLibrary.items.map((item) =>
              restoreMediaItem(item, blobMap.get(item.id)),
            ),
          );

          const projectWithMedia: Project = {
            ...recoveredProject,
            generatedShaders: normalizeGeneratedShaders(
              recoveredProject.generatedShaders,
            ),
            mediaLibrary: {
              ...recoveredProject.mediaLibrary,
              items: restoredItems,
            },
          };

          const titleEngine = useEngineStore.getState().getTitleEngine();
          const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

          if (titleEngine && recoveredProject.textClips) {
            titleEngine.loadTextClips(recoveredProject.textClips);
          }
          if (graphicsEngine) {
            if (recoveredProject.shapeClips) {
              graphicsEngine.loadShapeClips(recoveredProject.shapeClips);
            }
            if (recoveredProject.svgClips) {
              graphicsEngine.loadSVGClips(recoveredProject.svgClips);
            }
            if (recoveredProject.stickerClips) {
              graphicsEngine.loadStickerClips(recoveredProject.stickerClips);
            }
          }

          const newHistory = new ActionHistory();
          const newExecutor = new ActionExecutor(newHistory);

          registerProjectGeneratedShaders(projectWithMedia);

          set({
            project: projectWithMedia,
            hasOpenProject: true,
            actionHistory: newHistory,
            actionExecutor: newExecutor,
            clipUndoStack: [],
            clipRedoStack: [],
            templateUndoStack: [],
            templateRedoStack: [],
            error: null,
          });

          await projectManager.addToRecent(projectWithMedia);
          return true;
        }
        return false;
      },

      forceSave: async () => {
        const { project } = get();
        const titleEngine = useEngineStore.getState().getTitleEngine();
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

        const fullProject: Project = {
          ...project,
          textClips: titleEngine?.getAllTextClips() || [],
          shapeClips: graphicsEngine?.getAllShapeClips() || [],
          svgClips: graphicsEngine?.getAllSVGClips() || [],
          stickerClips: graphicsEngine?.getAllStickerClips() || [],
        };
        await autoSaveManager.forceSave(fullProject);
      },

      getFullProject: (): Project => {
        const { project } = get();
        const titleEngine = useEngineStore.getState().getTitleEngine();
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

        return {
          ...project,
          textClips: titleEngine?.getAllTextClips() || [],
          shapeClips: graphicsEngine?.getAllShapeClips() || [],
          svgClips: graphicsEngine?.getAllSVGClips() || [],
          stickerClips: graphicsEngine?.getAllStickerClips() || [],
        };
      },

      getEditingTemplates: () => [...getBuiltInEditingTemplates()],

      getEditingTemplate: (templateId: string) =>
        getBuiltInEditingTemplate(templateId),

      applyEditingTemplate: (
        templateId: string,
        clipId: string,
        overrides: Record<string, EditingTemplatePrimitive> = {},
      ) => {
        const { project, templateUndoStack } = get();
        const applied = applyEditingTemplateApplicationToProject(
          project,
          templateId,
          clipId,
          overrides,
        );

        if (!applied) {
          return null;
        }

        const historyEntry: EditingTemplateHistoryEntry = {
          type: "editing-template",
          mode: "apply",
          timestamp: Date.now(),
          description: `Apply ${applied.applicationState.appliedTemplate.name}`,
          ...applied.applicationState,
        };

        set({
          project: applied.project,
          templateUndoStack: [...templateUndoStack, historyEntry],
          templateRedoStack: [],
        });

        return applied.applicationState.applicationId;
      },

      updateEditingTemplateApplication: (
        clipId: string,
        applicationId: string,
        overrides: Record<string, EditingTemplatePrimitive> = {},
      ) => {
        const { project, templateUndoStack } = get();
        const matchingEntry = findEditingTemplateHistoryEntry(clipId, applicationId);
        if (!matchingEntry) {
          return false;
        }

        const previousState = getEditingTemplateApplicationState(matchingEntry);
        const projectWithoutCurrent = removeEditingTemplateApplicationStateFromProject(
          project,
          previousState,
          false,
        );
        const updated = applyEditingTemplateApplicationToProject(
          projectWithoutCurrent,
          previousState.templateId,
          clipId,
          overrides,
          {
            applicationId,
            appliedAt: previousState.appliedTemplate.appliedAt,
            preferredTrackIds: getEditingTemplatePreferredTrackIds(previousState),
            preservedTrackSnapshots: previousState.trackSnapshots,
          },
        );

        if (!updated) {
          const restoredProject = restoreEditingTemplateApplicationState(
            projectWithoutCurrent,
            previousState,
          );

          if (restoredProject) {
            set({ project: restoredProject });
          }

          return false;
        }

        const historyEntry: EditingTemplateHistoryEntry = {
          type: "editing-template",
          mode: "update",
          timestamp: Date.now(),
          description: `Update ${updated.applicationState.appliedTemplate.name}`,
          previousState,
          ...updated.applicationState,
        };

        set({
          project: updated.project,
          templateUndoStack: [...templateUndoStack, historyEntry],
          templateRedoStack: [],
        });

        return true;
      },

      removeEditingTemplateApplication: (
        clipId: string,
        applicationId: string,
      ) => {
        const {
          project,
          templateUndoStack,
          templateRedoStack,
        } = get();

        if (!hasEditingTemplateArtifacts(project, clipId, applicationId)) {
          return false;
        }

        const matchingEntry = findEditingTemplateHistoryEntry(clipId, applicationId);

        const updatedProject = removeEditingTemplateApplicationFromProject(
          project,
          clipId,
          applicationId,
          matchingEntry?.trackSnapshots.map((snapshot) => snapshot.track.id) || [],
        );

        set({
          project: updatedProject,
          templateUndoStack: templateUndoStack.filter(
            (entry) =>
              !(entry.ownerClipId === clipId && entry.applicationId === applicationId),
          ),
          templateRedoStack: templateRedoStack.filter(
            (entry) =>
              !(entry.ownerClipId === clipId && entry.applicationId === applicationId),
          ),
        });

        return true;
      },

      createMotionComposition: async (name?: string, presetId?: string) => {
        const { project, actionExecutor } = get();
        const preset = presetId ? getMotionPreset(presetId) : undefined;
        const composition = preset
          ? { ...preset.create(), name: name ?? preset.name }
          : motionEngine.createStarterComposition({
              name,
              width: project.settings.width,
              height: project.settings.height,
              frameRate: project.settings.frameRate,
            });

        const projectCopy = structuredClone(project);
        const action: Action = {
          type: "motion/createComposition",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { composition },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) {
          console.error("Failed to create motion composition:", result.error?.message);
          return null;
        }

        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
        return composition;
      },

      upsertMotionComposition: async (composition: MotionComposition) => {
        const { project, actionExecutor } = get();
        const projectCopy = structuredClone(project);
        const reflowed = reflowMotionAutoLayoutGroups(composition);
        const action: Action = {
          type: "motion/upsertComposition",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { composition: { ...reflowed, modifiedAt: Date.now() } },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (result.success) {
          set({ project: { ...projectCopy, modifiedAt: Date.now() } });
        }
        return result;
      },

      updateMotionCompositionPreview: (composition: MotionComposition) => {
        if (typeof composition.id !== "string" || composition.id.length === 0) {
          return;
        }
        const { project } = get();
        const reflowed = reflowMotionAutoLayoutGroups(composition);
        const previewComposition = { ...reflowed, modifiedAt: Date.now() };
        const existing = project.motionCompositions ?? [];
        const nextCompositions = existing.some(
          (candidate) => candidate.id === previewComposition.id,
        )
          ? existing.map((candidate) =>
              candidate.id === previewComposition.id
                ? previewComposition
                : candidate,
            )
          : [...existing, previewComposition];
        set({
          project: {
            ...project,
            motionCompositions: nextCompositions,
            modifiedAt: Date.now(),
          },
        });
      },

      commitMotionCompositionGesture: async (
        before: MotionComposition,
        after: MotionComposition,
      ) => {
        if (typeof after.id !== "string" || after.id.length === 0) {
          return null;
        }
        if (before.id !== after.id) {
          return null;
        }
        const reflowedBefore = reflowMotionAutoLayoutGroups(before);
        const reflowedAfter = reflowMotionAutoLayoutGroups(after);
        if (motionCompositionsEqual(reflowedBefore, reflowedAfter)) {
          return null;
        }
        const { project, actionExecutor } = get();
        const cloned = structuredClone(project);
        const existing = cloned.motionCompositions ?? [];
        const projectBefore: Project = {
          ...cloned,
          motionCompositions: existing.some(
            (candidate) => candidate.id === reflowedBefore.id,
          )
            ? existing.map((candidate) =>
                candidate.id === reflowedBefore.id ? reflowedBefore : candidate,
              )
            : [...existing, reflowedBefore],
        };
        const action: Action = {
          type: "motion/upsertComposition",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { composition: { ...reflowedAfter, modifiedAt: Date.now() } },
        };
        const result = await actionExecutor.execute(action, projectBefore);
        if (result.success) {
          set({ project: { ...projectBefore, modifiedAt: Date.now() } });
        }
        return result;
      },

      updateCreationObject: async (sceneId, objectId, patch) => {
        const { project, actionExecutor } = get();
        const now = Date.now();
        const plan = planCreationObjectEdit(project, sceneId, objectId, patch, now);
        if ("error" in plan) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: plan.error,
            },
          };
        }

        const projectCopy = structuredClone(project);
        for (const operation of plan.operations) {
          const action: Action = {
            type: "creation/applyOperation",
            id: uuidv4(),
            timestamp: now,
            params: { operation },
          };
          const result = await actionExecutor.execute(action, projectCopy);
          if (!result.success) return result;
        }

        if (plan.composition) {
          const action: Action = {
            type: "motion/upsertComposition",
            id: uuidv4(),
            timestamp: now,
            params: { composition: plan.composition },
          };
          const result = await actionExecutor.execute(action, projectCopy);
          if (!result.success) return result;
        }

        set({ project: { ...projectCopy, modifiedAt: now } });
        return { success: true, actionId: `creation-object-edit-${now}` };
      },

      updateCreationCamera: async (sceneId, cameraId, patch) => {
        const { project, actionExecutor } = get();
        const now = Date.now();
        const plan = planCreationCameraEdit(project, sceneId, cameraId, patch, now);
        if ("error" in plan) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: plan.error,
            },
          };
        }

        const projectCopy = structuredClone(project);
        for (const operation of plan.operations) {
          const action: Action = {
            type: "creation/applyOperation",
            id: uuidv4(),
            timestamp: now,
            params: { operation },
          };
          const result = await actionExecutor.execute(action, projectCopy);
          if (!result.success) return result;
        }

        if (plan.composition) {
          const action: Action = {
            type: "motion/upsertComposition",
            id: uuidv4(),
            timestamp: now,
            params: { composition: plan.composition },
          };
          const result = await actionExecutor.execute(action, projectCopy);
          if (!result.success) return result;
        }

        set({ project: { ...projectCopy, modifiedAt: now } });
        return { success: true, actionId: `creation-camera-edit-${now}` };
      },

      recoverMotionScene3DLayer: async (compositionId, layerId) => {
        const { project, actionExecutor } = get();
        const now = Date.now();
        const plan = planRecoverMotionScene3DLayer(
          project,
          compositionId,
          layerId,
          now,
        );
        if ("error" in plan) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: plan.error,
            },
          };
        }

        const projectCopy = structuredClone(project);
        for (const operation of plan.operations) {
          const action: Action = {
            type: "creation/applyOperation",
            id: uuidv4(),
            timestamp: now,
            params: { operation },
          };
          const result = await actionExecutor.execute(action, projectCopy);
          if (!result.success) return result;
        }

        set({ project: { ...projectCopy, modifiedAt: now } });
        return { success: true, actionId: `creation-recover-scene3d-${now}` };
      },

      insertMotionInstance: async (compositionId, placement = {}) => {
        const { project, actionExecutor } = get();
        const composition = (project.motionCompositions ?? []).find(
          (candidate) => candidate.id === compositionId,
        );
        if (!composition) {
          return null;
        }

        const startTime =
          placement.startTime ?? calculateTimelineDuration(project);
        const instance = motionEngine.createInstance(composition, {
          trackId: placement.trackId,
          startTime,
          duration: placement.duration,
          name: placement.name,
        });

        const projectCopy = structuredClone(project);
        const action: Action = {
          type: "motion/insertInstance",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { instance },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) {
          console.error("Failed to insert motion instance:", result.error?.message);
          return null;
        }

        const inserted = (projectCopy.motionInstances ?? []).find(
          (candidate) => candidate.id === instance.id,
        );
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
        return inserted ?? instance;
      },

      removeMotionInstance: async (instanceId: string) => {
        const { project, actionExecutor } = get();
        const projectCopy = structuredClone(project);
        const action: Action = {
          type: "motion/removeInstance",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { instanceId },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (result.success) {
          set({ project: { ...projectCopy, modifiedAt: Date.now() } });
        }
        return result;
      },

      getMotionComposition: (compositionId: string) =>
        (get().project.motionCompositions ?? []).find(
          (composition) => composition.id === compositionId,
        ),

      getMotionInstance: (instanceId: string) =>
        (get().project.motionInstances ?? []).find(
          (instance) => instance.id === instanceId,
        ),

      // Text clip actions

      /**
       * Create a new text clip with default styling
       * Create text clips using TitleEngine with default styling
       */
      ...createTextGraphicsSlice(set, get, helpers),

      // Subtitle actions - subtitles are now created as text clips on a "Captions" track

      /**
       * Add a subtitle as a text clip on a Captions track
       */
      ...createSubtitleSlice(set, get),

      // Marker actions

      ...createMarkerSlice(set, get),


      // Photo editing actions

      /**
       * Create a new photo project
       * Create PhotoProject with base layer using PhotoEngine
       */
      createPhotoProject: (width?: number, height?: number, name?: string) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const photoProject = photoEngine.createProject(width, height, name);
        const { photoProjects } = get();
        photoProjects.set(photoProject.id, photoProject);

        // Create new Map instance to trigger Zustand reactivity (Maps don't trigger on set operations)
        // This ensures subscribers are notified of photo project changes
        set({ photoProjects: new Map(photoProjects) });
        return photoProject;
      },

      /**
       * Import a photo and create a base layer
       * Create PhotoProject with base layer
       */
      importPhotoForEditing: (image: ImageBitmap, name?: string) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        // Create a new project with image dimensions
        const photoProject = photoEngine.createProject(
          image.width,
          image.height,
          name || "Photo Edit",
        );

        // Import the photo as base layer in the project
        const updatedProject = photoEngine.importPhoto(
          photoProject,
          image,
          name,
        );

        const { photoProjects } = get();
        photoProjects.set(updatedProject.id, updatedProject);

        // Create new Map to notify Zustand subscribers (mutation on existing Map won't trigger)
        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Add a new layer to a photo project
       * Insert layer above current layer in stack
       */
      addPhotoLayer: (projectId: string, options?: CreateLayerOptions) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        // PhotoEngine.addLayer returns updated project with new layer
        const updatedProject = photoEngine.addLayer(photoProject, options);
        photoProjects.set(projectId, updatedProject); // Update Map with new project state

        // Create new Map to notify Zustand and all subscribers of the change
        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Remove a layer from a photo project
       */
      removePhotoLayer: (projectId: string, layerId: string) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.removeLayer(photoProject, layerId);
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Reorder layers in a photo project
       * Reorder layers and update composite order
       */
      reorderPhotoLayers: (
        projectId: string,
        fromIndex: number,
        toIndex: number,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const result = photoEngine.reorderLayers(
          photoProject,
          fromIndex,
          toIndex,
        );
        if (!result.success) {
          console.error(`Failed to reorder layers: ${result.error}`);
          return null;
        }

        const updatedProject = {
          ...photoProject,
          layers: result.layers,
        };
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Toggle layer visibility
       * Toggle layer visibility
       */
      setPhotoLayerVisibility: (
        projectId: string,
        layerId: string,
        visible?: boolean,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.setLayerVisibility(
          photoProject,
          layerId,
          visible,
        );
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Set layer opacity
       * Adjust layer opacity
       */
      setPhotoLayerOpacity: (
        projectId: string,
        layerId: string,
        opacity: number,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.setLayerOpacity(
          photoProject,
          layerId,
          opacity,
        );
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Set layer blend mode
       * Adjust layer blend mode
       */
      setPhotoLayerBlendMode: (
        projectId: string,
        layerId: string,
        blendMode: PhotoBlendMode,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.setLayerBlendMode(
          photoProject,
          layerId,
          blendMode,
        );
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Get a photo project by ID
       */
      getPhotoProject: (projectId: string) => {
        const { photoProjects } = get();
        return photoProjects.get(projectId) || null;
      },

      // Video effects actions

      /**
       * Add a video effect to a clip
       * Apply video effect within 200ms
       */
      addVideoEffect: async (
        clipId: string,
        effectType: VideoEffectType,
        params?: Record<string, unknown>,
      ) => {
        const { project, actionExecutor } = get();
        const effectId = `effect-${uuidv4()}`;
        if (findOverlayEffectOwner(project, clipId)) {
          updateOverlayEffectOwner(clipId, (effects) => [
            ...effects,
            {
              id: effectId,
              type: effectType,
              enabled: true,
              params: params ?? {},
            },
          ]);
          return get().getVideoEffect(clipId, effectId) ?? null;
        }
        const action: Action = {
          type: "effect/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectType, params, effectId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to add video effect:", result.error?.message);
          return null;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      duplicateVideoEffect: async (clipId: string, sourceEffectId: string) => {
        const { project, actionExecutor, getVideoEffects } = get();
        const effects = getVideoEffects(clipId);
        const sourceIndex = effects.findIndex(
          (effect) => effect.id === sourceEffectId,
        );
        if (sourceIndex < 0) return null;
        const source = effects[sourceIndex]!;
        const effectId = `effect-${uuidv4()}`;
        const copy: VideoEffect = {
          ...source,
          id: effectId,
          params: structuredClone(source.params),
        };

        if (findOverlayEffectOwner(project, clipId)) {
          updateOverlayEffectOwner(clipId, (currentEffects) => {
            const next = [...currentEffects];
            next.splice(sourceIndex + 1, 0, copy);
            return next;
          });
          return get().getVideoEffect(clipId, effectId) ?? null;
        }

        const action: Action = {
          type: "effect/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            clipId,
            effectType: source.type,
            params: structuredClone(source.params),
            effectId,
            index: sourceIndex + 1,
            enabled: source.enabled,
          },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) return null;

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      replaceVideoEffects: async (
        clipId: string,
        effects: VideoEffect[],
      ) => {
        const { project, actionExecutor } = get();
        const nextEffects = structuredClone(effects);
        if (findOverlayEffectOwner(project, clipId)) {
          return Boolean(
            updateOverlayEffectOwner(clipId, () => nextEffects),
          );
        }

        const action: Action = {
          type: "effect/setStack",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effects: nextEffects },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) return false;

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return true;
      },

      /**
       * Update a video effect's parameters
       * Apply changes within 200ms
       */
      updateVideoEffect: async (
        clipId: string,
        effectId: string,
        params: Record<string, unknown>,
      ) => {
        const { project, actionExecutor } = get();
        if (findOverlayEffectOwner(project, clipId)) {
          const updated = updateOverlayEffectOwner(clipId, (effects) =>
            effects.map((effect) =>
              effect.id === effectId
                ? { ...effect, params: { ...effect.params, ...params } }
                : effect,
            ),
          );
          return updated ? get().getVideoEffect(clipId, effectId) ?? null : null;
        }
        const action: Action = {
          type: "effect/update",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, params },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to update video effect:",
            result.error?.message,
          );
          return null;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      /**
       * Remove a video effect from a clip
       * Restore clip to previous state when effect removed
       */
      removeVideoEffect: async (clipId: string, effectId: string) => {
        const { project, actionExecutor } = get();
        if (findOverlayEffectOwner(project, clipId)) {
          return Boolean(
            updateOverlayEffectOwner(clipId, (effects) =>
              effects.filter((effect) => effect.id !== effectId),
            ),
          );
        }
        const action: Action = {
          type: "effect/remove",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to remove video effect:",
            result.error?.message,
          );
          return false;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return true;
      },

      /**
       * Reorder video effects in the processing chain
       * Update effect order in clip's effect list
       */
      reorderVideoEffects: (clipId: string, effectIds: string[]) => {
        const { project, getClip } = get();
        const overlayLocation = findOverlayEffectOwner(project, clipId);
        const clip = getClip(clipId) ?? overlayLocation?.clip;
        if (!clip) {
          console.error("Failed to reorder video effects: clip not found");
          return false;
        }

        const currentEffects = clip.effects ?? [];
        const effectMap = new Map(currentEffects.map((effect) => [effect.id, effect]));
        const reorderedIds = new Set(effectIds);
        if (
          effectIds.length !== currentEffects.length ||
          reorderedIds.size !== currentEffects.length ||
          effectIds.some((effectId) => !effectMap.has(effectId))
        ) {
          console.error("Failed to reorder video effects: invalid effect order");
          return false;
        }

        const priorOrder = currentEffects.map((effect) => effect.id);

        if (overlayLocation) {
          return Boolean(
            updateOverlayEffectOwner(clipId, () =>
              effectIds.map((effectId) => effectMap.get(effectId)!),
            ),
          );
        }

        const updatedProject = updateProjectClip(project, clipId, (currentClip) => ({
          ...currentClip,
          effects: effectIds.map((effectId) => effectMap.get(effectId)!),
        }));

        if (!updatedProject) {
          console.error("Failed to reorder video effects: clip not found");
          return false;
        }

        syncClipEffectsBridge(updatedProject, clipId);
        set({ project: updatedProject, clipRedoStack: [], templateRedoStack: [] });
        const actionId = uuidv4();
        get().actionExecutor.getHistory().push(
          {
            type: "effect/setOrder",
            id: actionId,
            timestamp: Date.now(),
            params: { clipId, effectIds },
          },
          {
            type: "effect/setOrder",
            id: `inverse-${actionId}`,
            timestamp: Date.now(),
            params: { clipId, effectIds: priorOrder },
          },
        );
        return true;
      },

      /**
       * Toggle a video effect's enabled state
       * Toggle effect enabled state
       */
      toggleVideoEffect: async (
        clipId: string,
        effectId: string,
        enabled: boolean,
      ) => {
        const { project, actionExecutor } = get();
        if (findOverlayEffectOwner(project, clipId)) {
          const updated = updateOverlayEffectOwner(clipId, (effects) =>
            effects.map((effect) =>
              effect.id === effectId ? { ...effect, enabled } : effect,
            ),
          );
          return updated ? get().getVideoEffect(clipId, effectId) ?? null : null;
        }
        const action: Action = {
          type: "effect/toggle",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, enabled },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to toggle video effect:",
            result.error?.message,
          );
          return null;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      /**
       * Get all video effects for a clip
       */
      getVideoEffects: (clipId: string) => {
        const { project } = get();
        const clip = project.timeline.tracks
          .flatMap((track) => track.clips)
          .find((candidate) => candidate.id === clipId) ??
          findOverlayEffectOwner(project, clipId)?.clip;
        const timelineEffects = clip
          ? mapClipEffectsToVideoEffects(clip.effects ?? [])
          : [];

        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          return timelineEffects;
        }

        const bridgeEffects = effectsBridge.getEffects(clipId);
        if (bridgeEffects.length === 0 && timelineEffects.length > 0) {
          syncClipEffectsBridge(project, clipId);
          return effectsBridge.getEffects(clipId);
        }

        return bridgeEffects.length > 0 ? bridgeEffects : timelineEffects;
      },

      /**
       * Get a specific video effect by ID
       */
      getVideoEffect: (clipId: string, effectId: string) => {
        return get()
          .getVideoEffects(clipId)
          .find((effect) => effect.id === effectId);
      },

      // Color grading actions

      /**
       * Update color grading settings for a clip
       * Apply color grading adjustments
       */
      updateColorGrading: async (
        clipId: string,
        settings: Partial<ColorGradingSettings>,
      ): Promise<boolean> => {
        const { project, actionExecutor } = get();
        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          console.error("EffectsBridge not initialized");
          return false;
        }

        // Apply each setting type to the live bridge for immediate rendering.
        if (settings.colorWheels) {
          const result = effectsBridge.applyColorWheels(
            clipId,
            settings.colorWheels,
          );
          if (!result.success) {
            console.error("Failed to apply color wheels:", result.error);
            return false;
          }
        }

        if (settings.curves) {
          const result = effectsBridge.applyCurves(clipId, settings.curves);
          if (!result.success) {
            console.error("Failed to apply curves:", result.error);
            return false;
          }
        }

        if (settings.lut) {
          const result = effectsBridge.applyLUT(clipId, settings.lut);
          if (!result.success) {
            console.error("Failed to apply LUT:", result.error);
            return false;
          }
        }

        if (settings.hsl) {
          const result = effectsBridge.applyHSL(clipId, settings.hsl);
          if (!result.success) {
            console.error("Failed to apply HSL:", result.error);
            return false;
          }
        }

        if (
          settings.temperature !== undefined ||
          settings.tint !== undefined
        ) {
          const result = effectsBridge.applyWhiteBalance(clipId, {
            temperature: settings.temperature,
            tint: settings.tint,
          });
          if (!result.success) {
            console.error("Failed to apply white balance:", result.error);
            return false;
          }
        }

        // Persist the merged result onto the clip so it is undoable + saved.
        const action: Action = {
          type: "clip/setColorGrading",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, colorGrading: buildSerializedColorGrading(clipId) },
        };
        const actionResult = await actionExecutor.execute(action, project);
        if (!actionResult.success) {
          console.error(
            "Failed to persist color grading:",
            actionResult.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Get color grading settings for a clip
       */
      getColorGrading: (clipId: string) => {
        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          return {};
        }
        return effectsBridge.getColorGrading(clipId);
      },

      /**
       * Reset color grading to defaults for a clip
       */
      resetColorGrading: async (clipId: string): Promise<boolean> => {
        const { project, actionExecutor } = get();
        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          console.error("EffectsBridge not initialized");
          return false;
        }

        const result = effectsBridge.resetColorGrading(clipId);
        if (!result.success) {
          console.error("Failed to reset color grading:", result.error);
          return false;
        }

        const action: Action = {
          type: "clip/setColorGrading",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, colorGrading: undefined },
        };
        const actionResult = await actionExecutor.execute(action, project);
        if (!actionResult.success) {
          console.error(
            "Failed to persist color grading reset:",
            actionResult.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      // Audio effects actions

      /**
       * Add an audio effect to a clip
       * Apply audio effects
       */
      addAudioEffect: async (clipId: string, effect: Effect) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/addEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effect },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to add audio effect:", result.error?.message);
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Update an audio effect on a clip
       * Update audio effect parameters
       */
      updateAudioEffect: async (
        clipId: string,
        effectId: string,
        params: Record<string, unknown>,
      ) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/updateEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, params },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to update audio effect:",
            result.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Remove an audio effect from a clip
       */
      removeAudioEffect: async (clipId: string, effectId: string) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/removeEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to remove audio effect:",
            result.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Toggle an audio effect's enabled state
       */
      toggleAudioEffect: async (
        clipId: string,
        effectId: string,
        enabled: boolean,
      ) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/toggleEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, enabled },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to toggle audio effect:",
            result.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      setAudioEffectPreviewBypass: (
        clipId: string,
        effectId: string,
        bypassed: boolean,
      ) => {
        const { project } = get();

        for (const track of project.timeline.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex !== -1) {
            const clip = track.clips[clipIndex];
            const audioEffects = clip.audioEffects || [];
            const effectIndex = audioEffects.findIndex(
              (effect) => effect.id === effectId,
            );

            if (effectIndex === -1) {
              return false;
            }

            const effect = audioEffects[effectIndex];
            const nextMetadata = { ...(effect.metadata ?? {}) } as Record<
              string,
              unknown
            >;

            if (bypassed) {
              nextMetadata.previewBypass = true;
            } else {
              delete nextMetadata.previewBypass;
            }

            const updatedEffect = {
              ...effect,
              metadata:
                Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
            };

            const updatedAudioEffects = [...audioEffects];
            updatedAudioEffects[effectIndex] = updatedEffect;

            const updatedClip = {
              ...clip,
              audioEffects: updatedAudioEffects,
            };
            const updatedClips = [...track.clips];
            updatedClips[clipIndex] = updatedClip;
            const updatedTrack = { ...track, clips: updatedClips };
            const updatedTracks = project.timeline.tracks.map((candidate) =>
              candidate.id === track.id ? updatedTrack : candidate,
            );
            const updatedProject = {
              ...project,
              timeline: { ...project.timeline, tracks: updatedTracks },
              modifiedAt: Date.now(),
            };
            set({ project: updatedProject });
            return true;
          }
        }

        return false;
      },

      /**
       * Get all audio effects for a clip
       */
      getAudioEffects: (clipId: string) => {
        const { project } = get();

        for (const track of project.timeline.tracks) {
          const clip = track.clips.find((c) => c.id === clipId);
          if (clip) {
            return clip.audioEffects || [];
          }
        }
        return [];
      },

      setClipAudioDucking: (
        clipId: string,
        settings: AudioDuckingSettings,
        points: AutomationPoint[],
      ) => {
        const { project } = get();
        const updatedProject = updateProjectClip(project, clipId, (clip) => ({
          ...clip,
          automation: {
            ...(clip.automation ?? {}),
            volume: points.map((point) => ({ ...point })),
          },
          metadata: {
            ...(clip.metadata ?? {}),
            audioDucking: { ...settings },
          },
        }));

        if (!updatedProject) {
          return false;
        }

        set({ project: updatedProject });
        return true;
      },

      clearClipAudioDucking: (clipId: string) => {
        const { project } = get();
        const updatedProject = updateProjectClip(project, clipId, (clip) => {
          const nextMetadata = { ...(clip.metadata ?? {}) } as Record<
            string,
            unknown
          >;
          delete nextMetadata.audioDucking;

          const nextAutomation = { ...(clip.automation ?? {}) };
          delete nextAutomation.volume;

          return {
            ...clip,
            automation:
              Object.keys(nextAutomation).length > 0 ? nextAutomation : undefined,
            metadata:
              Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
          };
        });

        if (!updatedProject) {
          return false;
        }

        set({ project: updatedProject });
        return true;
      },

      /**
       * Update keyframes for a clip
       * Keyframe animation support
       */
      updateClipKeyframes: (clipId: string, keyframes: Keyframe[]) => {
        const { project } = get();

        for (const track of project.timeline.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex !== -1) {
            const clip = track.clips[clipIndex];
            const priorKeyframes = clip.keyframes;
            const updatedClip = { ...clip, keyframes };
            const updatedClips = [...track.clips];
            updatedClips[clipIndex] = updatedClip;
            const updatedTrack = { ...track, clips: updatedClips };
            const updatedTracks = project.timeline.tracks.map((t) =>
              t.id === track.id ? updatedTrack : t,
            );
            const updatedProject = {
              ...project,
              timeline: { ...project.timeline, tracks: updatedTracks },
              modifiedAt: Date.now(),
            };
            set({
              project: updatedProject,
              clipRedoStack: [],
              templateRedoStack: [],
            });
            const actionId = uuidv4();
            get().actionExecutor.getHistory().push(
              {
                type: "keyframe/setAll",
                id: actionId,
                timestamp: Date.now(),
                params: { clipId, keyframes },
              },
              {
                type: "keyframe/setAll",
                id: `inverse-${actionId}`,
                timestamp: Date.now(),
                params: { clipId, keyframes: priorKeyframes },
              },
            );
            return true;
          }
        }
        return false;
      },
    };
  }),
);
