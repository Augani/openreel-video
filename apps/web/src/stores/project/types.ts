import type {
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
  Effect,
  Keyframe,
  Transform,
  Subtitle,
} from "@openreel/core";
import { ActionExecutor, ActionHistory } from "@openreel/core";
import type {
  VideoEffect,
  VideoEffectType,
  ColorGradingSettings,
} from "../../bridges/effects-bridge";
import type { AutoSaveMetadata } from "../../services/auto-save";

export type ClipHistoryEntryType = "shape" | "text" | "svg" | "sticker";

export interface ClipHistoryEntry {
  type: ClipHistoryEntryType;
  clipId: string;
  trackId: string;
  clipData: ShapeClip | TextClip | SVGClip | StickerClip;
  hadEmptyTrackUndo?: boolean;
  trackType?: "video" | "audio" | "image" | "text" | "graphics";
}

export interface ProjectState {
  project: Project;
  photoProjects: Map<string, PhotoProject>;
  actionExecutor: ActionExecutor;
  actionHistory: ActionHistory;
  clipUndoStack: ClipHistoryEntry[];
  clipRedoStack: ClipHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  clipboard: Clip[];
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
  removeTrack: (trackId: string) => Promise<ActionResult>;
  reorderTrack: (trackId: string, newPosition: number) => Promise<ActionResult>;
  lockTrack: (trackId: string, locked: boolean) => Promise<ActionResult>;
  hideTrack: (trackId: string, hidden: boolean) => Promise<ActionResult>;
  muteTrack: (trackId: string, muted: boolean) => Promise<ActionResult>;
  soloTrack: (trackId: string, solo: boolean) => Promise<ActionResult>;
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
  updateClipTransform: (
    clipId: string,
    transform: Partial<Transform>,
  ) => boolean;

  copyClips: (clipIds: string[]) => void;
  pasteClips: (trackId: string, startTime: number) => Promise<ActionResult[]>;
  duplicateClip: (clipId: string) => Promise<ActionResult>;
  copyEffects: (clipId: string) => void;
  pasteEffects: (clipId: string) => Promise<ActionResult>;

  createTextClip: (
    trackId: string,
    startTime: number,
    text: string,
    duration?: number,
    style?: Partial<TextStyle>,
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

  addSubtitle: (subtitle: Subtitle) => Promise<void>;
  removeSubtitle: (subtitleId: string) => void;
  updateSubtitle: (subtitleId: string, updates: Partial<Subtitle>) => void;
  getSubtitle: (subtitleId: string) => Subtitle | undefined;
  importSRT: (srtContent: string) => { success: boolean; errors: string[] };
  exportSRT: () => string;
  applySubtitleStylePreset: (presetName: string) => boolean;
  getSubtitleStylePresets: () => string[];

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
  ) => ShapeClip | null;
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
  ) => VideoEffect | null;
  updateVideoEffect: (
    clipId: string,
    effectId: string,
    params: Record<string, unknown>,
  ) => VideoEffect | null;
  removeVideoEffect: (clipId: string, effectId: string) => boolean;
  reorderVideoEffects: (clipId: string, effectIds: string[]) => boolean;
  toggleVideoEffect: (
    clipId: string,
    effectId: string,
    enabled: boolean,
  ) => VideoEffect | null;
  getVideoEffects: (clipId: string) => VideoEffect[];
  getVideoEffect: (clipId: string, effectId: string) => VideoEffect | undefined;

  updateColorGrading: (
    clipId: string,
    settings: Partial<ColorGradingSettings>,
  ) => boolean;
  getColorGrading: (clipId: string) => ColorGradingSettings;
  resetColorGrading: (clipId: string) => boolean;

  addAudioEffect: (clipId: string, effect: Effect) => boolean;
  updateAudioEffect: (
    clipId: string,
    effectId: string,
    params: Record<string, unknown>,
  ) => boolean;
  removeAudioEffect: (clipId: string, effectId: string) => boolean;
  toggleAudioEffect: (
    clipId: string,
    effectId: string,
    enabled: boolean,
  ) => boolean;
  getAudioEffects: (clipId: string) => Effect[];

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
  Effect,
  Keyframe,
  Transform,
  Subtitle,
  VideoEffect,
  VideoEffectType,
  ColorGradingSettings,
  AutoSaveMetadata,
};
