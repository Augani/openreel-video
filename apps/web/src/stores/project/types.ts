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
  Subtitle,
  AppliedEditingTemplate,
  EditingTemplate,
  EditingTemplatePrimitive,
  ResolvedEditingTemplateOverlay,
  MotionComposition,
  MotionCompositionInstance,
} from "@openreel/core";
import { ActionExecutor, ActionHistory } from "@openreel/core";
import type {
  VideoEffect,
  VideoEffectType,
  ColorGradingSettings,
} from "../../bridges/effects-bridge";
import type { AutoSaveMetadata } from "../../services/auto-save";

export type ClipHistoryEntryType = "shape" | "text" | "svg" | "sticker";

export type TimelineClipboardItem =
  | { kind: "media"; clip: Clip }
  | { kind: "text"; clip: TextClip }
  | { kind: "shape"; clip: ShapeClip }
  | { kind: "svg"; clip: SVGClip }
  | { kind: "sticker"; clip: StickerClip };

export interface ClipHistoryEntry {
  type: ClipHistoryEntryType;
  /**
   * "create" (default when omitted) — undo deletes the clip from its engine,
   * redo recreates it. "update" — a property edit; undo restores `clipData`
   * (the before snapshot) and redo restores `afterData`, without ever
   * deleting the clip.
   */
  op?: "create" | "update";
  timestamp: number;
  clipId: string;
  trackId: string;
  clipData: ShapeClip | TextClip | SVGClip | StickerClip;
  /** After-edit snapshot, present only for op === "update" (used by redo). */
  afterData?: ShapeClip | TextClip | SVGClip | StickerClip;
  hadEmptyTrackUndo?: boolean;
  trackType?: "video" | "audio" | "image" | "text" | "graphics";
}

export interface EditingTemplateTrackSnapshot {
  track: Track;
  position: number;
}

export interface EditingTemplateOverlayPlacement {
  trackId: string;
  overlay: ResolvedEditingTemplateOverlay;
}

export interface EditingTemplateApplicationState {
  ownerClipId: string;
  templateId: string;
  applicationId: string;
  appliedTemplate: AppliedEditingTemplate;
  addedEffects: Effect[];
  addedAudioEffects: Effect[];
  addedKeyframes: Keyframe[];
  overlays: EditingTemplateOverlayPlacement[];
  trackSnapshots: EditingTemplateTrackSnapshot[];
}

export interface EditingTemplateHistoryEntry
  extends EditingTemplateApplicationState {
  type: "editing-template";
  mode: "apply" | "update";
  timestamp: number;
  description: string;
  previousState?: EditingTemplateApplicationState;
}

export interface AudioDuckingSettings {
  enabled: boolean;
  sourceTrackId: string | null;
  threshold: number;
  reduction: number;
  attack: number;
  release: number;
  holdTime: number;
}

export interface ProjectState {
  project: Project;
  photoProjects: Map<string, PhotoProject>;
  actionExecutor: ActionExecutor;
  actionHistory: ActionHistory;
  clipUndoStack: ClipHistoryEntry[];
  clipRedoStack: ClipHistoryEntry[];
  templateUndoStack: EditingTemplateHistoryEntry[];
  templateRedoStack: EditingTemplateHistoryEntry[];
  /** Order in which stacks were undone, so redo replays in the exact reverse
   * order across the action/clip/template stacks (fixes redo asymmetry). */
  redoJournal: Array<"action" | "clip" | "template">;
  isLoading: boolean;
  error: string | null;
  clipboard: TimelineClipboardItem[];
  lastPastedClipIds: string[];
  copiedEffects: Effect[];

  createNewProject: (
    name?: string,
    settings?: Partial<ProjectSettings>,
  ) => void;
  loadProject: (project: Project) => void;
  renameProject: (name: string) => Promise<ActionResult>;
  updateSettings: (settings: Partial<ProjectSettings>) => Promise<ActionResult>;

  importMedia: (file: File) => Promise<ActionResult>;
  deleteMedia: (mediaId: string) => Promise<ActionResult>;
  renameMedia: (mediaId: string, name: string) => Promise<ActionResult>;
  getMediaItem: (mediaId: string) => MediaItem | undefined;

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
  getTrack: (trackId: string) => Track | undefined;

  addClip: (
    trackId: string,
    mediaId: string,
    startTime: number,
  ) => Promise<ActionResult>;
  removeClip: (clipId: string) => Promise<ActionResult>;
  moveClip: (
    clipId: string,
    startTime: number,
    trackId?: string,
  ) => Promise<ActionResult>;
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
  updateClipTransform: (
    clipId: string,
    transform: Partial<Transform>,
  ) => Promise<ActionResult>;

  copyClips: (clipIds: string[]) => void;
  pasteClips: (trackId: string, startTime: number) => Promise<ActionResult[]>;
  duplicateClip: (clipId: string) => Promise<ActionResult>;
  copyEffects: (clipId: string) => void;
  pasteEffects: (clipId: string) => Promise<ActionResult>;

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

  createMotionComposition: (
    name?: string,
    presetId?: string,
  ) => Promise<MotionComposition | null>;
  upsertMotionComposition: (
    composition: MotionComposition,
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
  deleteTextClip: (clipId: string) => boolean;

  applyTextAnimationPreset: (
    clipId: string,
    preset: TextAnimationPreset,
    inDuration?: number,
    outDuration?: number,
    params?: Partial<TextAnimationParams>,
  ) => TextClip | null;
  getAvailableAnimationPresets: () => TextAnimationPreset[];

  addSubtitle: (
    subtitle: Subtitle,
    metadata?: import("@openreel/core").ClipMetadata,
  ) => Promise<void>;
  removeSubtitle: (subtitleId: string) => void;
  updateSubtitle: (subtitleId: string, updates: Partial<Subtitle>) => void;
  getSubtitle: (subtitleId: string) => Subtitle | undefined;
  importSRT: (
    srtContent: string,
    options?: { sourceClipId?: string; maxWordsPerLine?: number },
  ) => Promise<{ success: boolean; errors: string[] }>;
  exportSRT: () => Promise<string>;
  applySubtitleStylePreset: (presetName: string) => Promise<boolean>;
  getSubtitleStylePresets: () => Promise<string[]>;

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

  createPhotoProject: (
    width?: number,
    height?: number,
    name?: string,
  ) => PhotoProject | null;
  importPhotoForEditing: (
    image: ImageBitmap,
    projectId?: string,
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

  updateColorGrading: (
    clipId: string,
    settings: Partial<ColorGradingSettings>,
  ) => Promise<boolean>;
  getColorGrading: (clipId: string) => ColorGradingSettings;
  resetColorGrading: (clipId: string) => Promise<boolean>;

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

  updateClipKeyframes: (clipId: string, keyframes: Keyframe[]) => boolean;

  undo: () => Promise<ActionResult>;
  redo: () => Promise<ActionResult>;
  canUndo: () => boolean;
  canRedo: () => boolean;

  executeAction: (action: Action) => Promise<ActionResult>;
  getTimelineDuration: () => number;

  initializeAutoSave: () => Promise<void>;
  checkForRecovery: () => Promise<AutoSaveMetadata[]>;
  recoverFromAutoSave: (saveId: string) => Promise<boolean>;
  forceSave: () => Promise<void>;
  getFullProject: () => Project;
}

export type {
  Project,
  ProjectSettings,
  MediaItem,
  Track,
  Clip,
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
  MotionComposition,
  MotionCompositionInstance,
  Effect,
  Keyframe,
  Transform,
  Subtitle,
  VideoEffect,
  VideoEffectType,
  ColorGradingSettings,
  AutoSaveMetadata,
};
