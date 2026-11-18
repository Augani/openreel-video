import type {
  Track,
  Clip,
  TextClip,
  ShapeClip,
  SVGClip,
  StickerClip,
  Effect,
  Keyframe,
  AppliedEditingTemplate,
  ResolvedEditingTemplateOverlay,
} from "@openreel/core";

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

export type {
  Clip,
  TextClip,
  ShapeClip,
  SVGClip,
  StickerClip,
  Effect,
  Keyframe,
};
