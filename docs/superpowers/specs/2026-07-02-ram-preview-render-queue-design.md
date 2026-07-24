# RAM Preview + Real Render Queue — Design

**Date:** 2026-07-02
**Status:** Approved scope (full rock)
**Source:** AE-parity review big rock #4 (docs/reviews/2026-07-01-ae-parity-review.md §4.4)
**Branch:** feat/new-design-update

## Problem

Playback re-renders every frame live on a wallclock tick (`use-motion-playback` → `advanceMotionPlayhead` → `renderComposition` per tick) — heavy comps drop frames with no way to guarantee real-time review. The render queue holds items (format/progress/status) but offers no frame range, no resolution choice, no cancel, no reorder, and only three video formats; the core PNG-frame path exists but no image-sequence export.

## Goals

1. **RAM-preview frame cache**: a memory-budgeted `ImageBitmap` cache keyed by frame index; playback draws cached frames when present (real-time), renders-and-caches when not; background pre-render fills forward from the playhead when idle; a green cached-bar in the timeline; full invalidation on any composition edit; hard memory budget with eviction; bitmaps disposed properly.
2. **Real render queue**: per-job frame range + resolution scale (1 / 0.5 / 0.25), cancel (mid-render), reorder; a `png-sequence` export format delivering a single .zip of numbered PNGs.
3. **MCP queue tools**: `queue_motion_render`, `run_motion_render_queue`, `list_motion_render_queue`, `cancel_motion_render_item` via an optional host bridge (graceful headless failure), completing the deferral from the parity wave.

## Non-Goals

Partial/segment-level cache invalidation (v1 invalidates the whole cache on any edit — correct and simple); disk-backed cache; caching the DOM-preview path (it composites via DOM transforms and is already cheap — the cache serves the renderer-backed canvas path); audio pre-render; multi-job parallel rendering (queue stays sequential).

## Design

### 1. Frame cache (`apps/web/src/motion/frame-cache.ts`)
`MotionFrameCache` class: `getFrame(index)`, `setFrame(index, bitmap)` (closes any replaced bitmap), `has(index)`, `cachedRanges(): Array<{start,end}>` (merged consecutive indices, for the green bar), `invalidateAll()` (closes all), `dispose()`, `frameCount`/`byteEstimate`. Budget: constructor `{ maxBytes }` (default 384 MB); per-frame cost estimated `width*height*4` from the bitmap; eviction removes frames farthest from the most-recent access point until under budget (keeps the loop region hot). Pure enough to unit-test with mock bitmap objects ({width,height,close}).

### 2. Playback + stage integration
The cache lives per renderer-preview instance (a ref in StageCanvas keyed by composition id), storing frames at the CURRENT preview resolution (what's actually drawn — not full comp resolution). Draw path: quantize the playhead to the frame grid (`Math.round(time*fps)`); on cache hit, `drawImage(cached)` and skip `renderComposition`; on miss, render live then `setFrame`. **Invalidation:** any change to `composition.modifiedAt` (or preview-size/quality change) → `invalidateAll`. **Pre-render fill:** while idle (not playing, no active gesture), fill forward from the playhead one frame per scheduled slice (rAF-chunked, yields to interaction; stops at budget or comp end, wraps to comp start). Cache state (ranges + enabled) published through a tiny subscribable (module-level emitter or a dedicated zustand slice) so the timeline can render the bar without coupling to StageCanvas.

### 3. Green cached-bar + controls
MotionTimeline renders a 2px green strip above the time ruler spanning `cachedRanges` (converted frame→time→px). Transport gains a small "RAM preview" indicator/button: click = force-fill from playhead (explicit AE-style RAM preview); the button shows fill progress. Cache clears visibly on edits (bar disappears).

### 4. Export range/resolution + PNG sequence (`export-motion-frame.ts`)
`exportMotionCompositionScene` gains `range?: {startTime, endTime}` (clamped to comp duration; default full) and `resolutionScale?: 1|0.5|0.25` (scales encoder width/height, even-rounded). New format `"png-sequence"`: render each frame in range at scale → PNG blob (path exists: `imageBitmapToPngBlob`) → package into a single uncompressed ZIP (minimal stored-entry ZIP writer — PNGs are already compressed; check for an existing zip dep first and reuse it if present) → download `name.zip`. `MOTION_EXPORT_FORMATS` gains the entry (transparent: true, extension "zip"); the web ProRes guardrail is untouched (png-sequence needs no native backend).

### 5. Render queue upgrades
`MotionRenderQueueItem` gains `range?`, `resolutionScale?`, `status: … | "canceled"`, plus store ops `moveRenderQueueItem(id, direction)` and `cancelRenderQueueItem(id)` (sets a cancel flag; the runner checks it per frame via an `isCanceled` callback threaded into `exportMotionCompositionScene`'s per-frame loop — export aborts cleanly, item marked canceled). RenderQueuePanel: range inputs (start/end seconds, defaulting to comp), resolution select, per-item cancel + up/down reorder buttons, and the png-sequence format option.

### 6. MCP queue tools
Optional `EditingHost.motionRenderQueue?: { add(input): string; run(): Promise<…summary>; list(): items; cancel(id): boolean }` implemented in the live web host over the motion-store; registry tools validate params (format incl. png-sequence, range within duration, scale ∈ {1,0.5,0.25}) and fail gracefully (`"render queue not supported by this host"`) when absent. `run` is `expensive: true` and reports per-item outcomes incl. what was actually encoded (guardrail semantics reused from export_motion_video).

## Testing

Frame cache: hit/miss, replacement closes bitmaps, budget eviction keeps near-playhead frames, ranges merging, invalidateAll/dispose close everything. Integration: modifiedAt change invalidates; playback draw uses cache on hit (spy on renderComposition NOT called); pre-render fills and publishes ranges. Export: range clamps; scale rounds even; png-sequence zip contains N correctly-named entries (parse the ZIP central directory in the test); cancel mid-run marks canceled and stops rendering (frame-count spy). Queue store: reorder/cancel semantics. MCP: param validation + graceful headless + queue round-trip. Gate: tsc 0×3; core motion 504+, web motion 192+ FULLY green, agent 392+.
Live visual: play a comp → green bar grows behind the playhead; replay over the cached span with a frame-time probe showing cache hits (no renderComposition calls); edit a layer → bar clears; queue a 1s half-res png-sequence job → zip downloads; cancel a queued mp4 job mid-run.

## Risks

- **Bitmap lifetime bugs** (leaks or draw-after-close): every set/evict/invalidate path must close exactly once; tests use close-counting mocks; StageCanvas dispose on unmount/comp-switch.
- **Pre-render starving interaction**: fill only when idle (no gesture refs active, not playing-from-live-misses), one frame per slice, abort on any user input; the existing gesture refs are the signal.
- **Cache/live visual mismatch** if preview size changes between fill and draw — the cache keys include nothing but frame index, so preview-size/quality changes must invalidate (spec'd).
- **ZIP writer correctness**: stored (no-compression) ZIP is simple but CRC32 must be right; test by parsing the output.
