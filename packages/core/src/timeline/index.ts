export {
  TrackManager,
  createTrack,
  cloneTrack,
  getTrackClips,
  canAcceptMediaType,
  type TrackManagerOptions,
  type CreateTrackParams,
  type TrackOperationResult,
} from "./track-manager";

export {
  ClipManager,
  createClip,
  cloneClip,
  getClipEndTime,
  clipsOverlap,
  getGapBetweenClips,
  type ClipManagerOptions,
  type AddClipParams,
  type MoveClipParams,
  type ClipOperationResult,
  type SnapResult,
} from "./clip-manager";

export {
  AutoEditService,
  getAutoEditService,
  DEFAULT_AUTO_EDIT_OPTIONS,
  type AutoEditOptions,
  type AutoEditCut,
  type AutoEditResult,
  type CutMode,
} from "./auto-edit-service";

export {
  NestedSequenceEngine,
  getNestedSequenceEngine,
  resetNestedSequenceEngine,
  type CompoundClip,
  type CompoundClipContent,
  type CompoundClipInstance,
  type CreateCompoundClipOptions,
  type FlattenResult,
} from "./nested-sequence-engine";
