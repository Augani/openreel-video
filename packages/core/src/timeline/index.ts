export { ClipManager } from "./clip-manager";

export {
  getAutoEditService,
  type AutoEditOptions,
  type AutoEditResult,
  type CutMode,
} from "./auto-edit-service";

export {
  NestedSequenceEngine,
  getNestedSequenceEngine,
  type CompoundClip,
  type CompoundClipInstance,
} from "./nested-sequence-engine";

export { calculateProjectDuration } from "./project-duration";

export {
  getTimelineItems,
  getTrackItems,
  resolveTimelineItem,
  getMediaItemCapabilities,
  getCompoundClipId,
  createTimelineClipCapabilityResolver,
  getProjectClipCapabilities,
  getVisibleTrackRenderOrder,
  trackHasVisualItems,
  trackHasAudioItems,
  withUniversalTracksCapability,
  type TimelineItemKind,
  type ResolvedTimelineItem,
} from "./timeline-items";

export { resolveTimelinePlacement } from "./timeline-placement";

export {
  MAIN_SEQUENCE_ID,
  activateSequence,
  closeSequenceTab,
  countSequenceInstances,
  createSequence,
  createSequenceFromMedia,
  cycleMessage,
  deleteSequence,
  descendantSequenceIds,
  duplicateSequence,
  ensureSequences,
  getSequence,
  insertSequenceAsNest,
  isNestClip,
  listSequences,
  moveSequencesToBin,
  nestClips,
  nestedSequenceIds,
  projectForSequence,
  renameSequence,
  reorderOpenSequences,
  sequenceContentDuration,
  sequenceForNestClip,
  setSequenceRange,
  syncActiveSequence,
  withNestProjection,
  wouldCreateSequenceCycle,
  type NewSequenceOptions,
  type SequenceEditResult,
} from "./sequences";
