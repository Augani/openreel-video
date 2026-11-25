export {
  planInvalidation,
  diffPixelModels,
  isEmptyPlan,
  NO_INVALIDATION,
  INVALIDATE_ALL,
} from "./invalidation-planner";
export type { InvalidationPlan } from "./invalidation-planner";
export { buildPixelModel, stableStringify } from "./pixel-entities";
export type { PixelEntity, PixelModel } from "./pixel-entities";
export {
  normalizeRanges,
  unionRanges,
  subtractRanges,
  intersectRanges,
  rangesContain,
  rangesOverlap,
  rangesEqual,
  framesInRange,
  framesToRuns,
  runsToTimeRanges,
} from "./time-ranges";
export type { TimeRange as RenderTimeRange, FrameRange } from "./time-ranges";
export { FrameIndex } from "./frame-index";
export { MemoryChunkStore, IndexedDbChunkStore } from "./chunk-store";
export { OpfsChunkStore, opfsWritable } from "./opfs-chunk-store";
export type { OpfsDirectoryLike, OpfsFileLike } from "./opfs-chunk-store";
export { createSegmentHasher, hashString, RENDER_PIXEL_VERSION } from "./segment-hash";
export type { SegmentHasher } from "./segment-hash";
export { createChunkIndexStore, parseIndex, serializeIndex } from "./persistent-index";
export type { PersistedIndex, IndexStore } from "./persistent-index";
export type { ChunkStore } from "./chunk-store";
export {
  createFrameCodec,
  ImageFrameCodec,
  WebCodecsIntraCodec,
} from "./frame-codec";
export type { FrameCodec, FrameCodecOptions, EncodedCacheFrame } from "./frame-codec";
export {
  RenderCache,
  cacheFrameSize,
  DEFAULT_CACHE_BYTES,
} from "./render-cache-engine";
export type {
  RenderCacheDeps,
  RenderCacheOptions,
  RenderCacheSnapshot,
  RenderPhase,
  RenderProgress,
  RenderSummary,
  RenderRangeOptions,
  RenderCachePersistence,
  RestoreSummary,
} from "./render-cache-engine";
export {
  buildRenderStatusSegments,
  classifyCost,
  estimateEffectMs,
  PlaybackFrameStats,
} from "./render-status";
export type {
  RenderStatusLevel,
  RenderStatusSegment,
  RenderStatusOptions,
} from "./render-status";
export { IdleRenderScheduler, pickIdleChunk, hasIdleCacheRoom, IDLE_RENDER_DELAY_MS, IDLE_RENDER_CHUNK_SECONDS } from "./idle-render-scheduler";
export type {
  IdleRenderDeps,
  IdleRenderState,
  IdleRenderPause,
  IdleChunkResult,
} from "./idle-render-scheduler";
