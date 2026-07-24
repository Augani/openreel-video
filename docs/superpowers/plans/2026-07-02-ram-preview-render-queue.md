# RAM Preview + Render Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cached green-bar real-time playback (memory-budgeted ImageBitmap frame cache) + a real render queue (range, resolution, cancel, reorder, PNG-sequence zip) + MCP queue tools.

**Architecture:** A pure `MotionFrameCache` module consumed by StageCanvas's renderer-backed preview (hit → drawImage, miss → render+store), invalidated on `composition.modifiedAt`/preview-size changes, filled by an idle pre-renderer, publishing ranges through a tiny subscribable for the timeline's green bar. Export gains `range`/`resolutionScale`/`png-sequence` (stored-entry ZIP); the queue store/panel gain range/resolution/cancel/reorder; an optional host bridge exposes the queue to MCP.

**Tech Stack:** TypeScript strict, ImageBitmap/OffscreenCanvas, Vitest + RTL.

## Global Constraints

- Do NOT git commit/add/stash/revert. NO line comments/docstrings. TS strict, NEVER `any`/unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates. TDD per task.
- Every ImageBitmap the cache owns is closed EXACTLY once (set-replacement, eviction, invalidateAll, dispose) — tests use close-counting mocks; no draw-after-close.
- Pre-render never runs during playback-with-misses, active gestures, or pointer interaction; one frame per rAF slice.
- The cache serves ONLY the renderer-backed preview path (`usesRendererPreview`); DOM-preview comps are untouched.
- Cancel must stop a running export within one frame boundary; canceled items keep partial-progress display but produce no file.
- Keep suites green: core motion 504+, web motion 192+ FULLY green, agent 392+; tsc 0 ×3 (`--ignoreDeprecations 6.0`).

**Execution note (controller):** T1 → [T2 ∥ T4] → [T3 ∥ T5] → T6 → T7. (T2/T3 share StageCanvas+timeline surfaces sequentially; T4/T5 share export/queue surfaces sequentially; the two chains are disjoint.)

---

### Task 1: `MotionFrameCache` module

**Files:**
- Create: `apps/web/src/motion/frame-cache.ts`
- Test: `apps/web/src/motion/frame-cache.test.ts` (new)

**Interfaces — Produces:**
```ts
interface FrameBitmapLike { readonly width: number; readonly height: number; close(): void; }
interface MotionFrameCacheOptions { readonly maxBytes?: number; }          // default 384 * 1024 * 1024
class MotionFrameCache<T extends FrameBitmapLike = ImageBitmap> {
  getFrame(index: number): T | undefined;                                   // marks access point
  setFrame(index: number, bitmap: T): void;                                 // closes replaced bitmap; evicts to budget
  has(index: number): boolean;
  cachedRanges(): ReadonlyArray<{ start: number; end: number }>;            // merged inclusive runs, sorted
  invalidateAll(): void;                                                    // closes all
  dispose(): void;
  readonly frameCount: number; readonly byteEstimate: number;
}
```
Byte cost per frame = `width*height*4`. Eviction: when over budget after a set, remove frames ordered by distance from the last accessed/set index (farthest first) until under budget; never evict the just-set frame. Non-integer/negative indices → throw. Generic over the bitmap type so tests use `{width,height,close}` mocks.

- [ ] **Step 1: Failing tests** — hit/miss; set-replace closes the old bitmap exactly once; budget eviction (small maxBytes, assert farthest-from-access evicted and near frames kept); `cachedRanges` merges [1,2,3,7,8] → [{1,3},{7,8}]; invalidateAll/dispose close every bitmap once; double-dispose safe; fractional index throws.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 2: Playback + stage integration — after T1

**Files:**
- Create: `apps/web/src/motion/frame-cache-state.ts` (tiny subscribable publishing `{ ranges, filling, enabled }` — module-level store with `subscribe/get/set`, no zustand needed)
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (the renderer-backed preview effect ~4680: `renderComposition(...).then(bitmap => drawImage)`)
- Test: `apps/web/src/motion/frame-cache-integration.test.ts` (new; drive the pure decision helpers)

**Implementation:** Extract a pure decision helper into frame-cache.ts or a sibling: `resolvePreviewFrame(cache, time, fps)` → `{ index, cached? }`. StageCanvas keeps a `MotionFrameCache` in a ref; the preview draw path quantizes `safeTime` to the frame grid and, on `cache.has(index)`, draws the cached bitmap WITHOUT calling `renderComposition`; on miss, renders live and `setFrame(index, bitmap)` — NOTE the current code calls `bitmap.close()` after drawing (line ~4690-4695): a cached bitmap must NOT be closed after draw (the cache owns it); restructure ownership so only cache-owned bitmaps persist. **Invalidation:** an effect watching `composition.id + composition.modifiedAt + previewSize.width/height + preview quality` → `invalidateAll` + publish empty ranges; comp switch/unmount → `dispose`. **Idle pre-render:** when `!isPlaying` and no gesture refs active, a rAF-chained filler renders one missing frame per slice starting at the playhead frame, wrapping at comp end, stopping when all frames cached or budget-evicting would thrash (stop after the first eviction pass); publishes ranges each fill; aborts on any pointer/gesture/play state change. Publish ranges after every set/invalidate via frame-cache-state.

- [ ] **Step 1: Failing tests** — pure: `resolvePreviewFrame` quantization; ownership rule (a helper `drawAndMaybeCache(cache, index, bitmap, draw)` that closes ONLY uncached bitmaps — assert close counts both paths); invalidation trigger predicate (given prev/next {id,modifiedAt,w,h,quality} pairs → boolean). Integration-ish: after simulated fills, frame-cache-state publishes merged ranges.
- [ ] **Step 2: Run → fail. Step 3: Implement (helpers first, wire StageCanvas). Step 4: pass. Step 5: web tsc 0; full web motion suite green.** No commit.

---

### Task 3: Green cached-bar + RAM-preview control — after T2 (shares StageCanvas/timeline)

**Files:**
- Modify: `apps/web/src/motion/components/MotionTimeline.tsx` (ruler area)
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (transport indicator/button)
- Test: `apps/web/src/motion/components/MotionTimeline.cache-bar.test.tsx` (new)

**Implementation:** MotionTimeline subscribes to frame-cache-state (`useSyncExternalStore`) and renders a 2px absolutely-positioned green strip per cached range above/along the time ruler (frame→time→px with the ruler's existing mapping; `data-testid="cache-bar-segment"`). Transport (StageCanvas bottom bar) gains a compact "RAM preview" button (aria-label "Fill RAM preview"): click starts/stops the pre-render fill explicitly (same filler as idle, but runs even while idle-detection would wait); while filling, show a subtle spinner/percent from published state.

- [ ] **Step 1: Failing RTL test** — with frame-cache-state seeded ({ranges:[{start:0,end:14}]}, comp 30fps/2s), the timeline renders a cache-bar segment whose width/offset matches 0→0.467s of the ruler span; empty ranges → no segments.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 4: Export range + resolution + PNG-sequence — after T1 (parallel with T2/T3 chain)

**Files:**
- Modify: `apps/web/src/motion/export-motion-frame.ts` (`exportMotionCompositionScene`, `MOTION_EXPORT_FORMATS`, `MotionExportFormat`)
- Create: `apps/web/src/motion/zip-store.ts` (minimal stored-entry ZIP writer) — FIRST grep for an existing zip dep (jszip/fflate) and reuse it if present; only create this if none exists
- Test: `apps/web/src/motion/export-range-sequence.test.ts` (new)

**Interfaces — Produces:** `exportMotionCompositionScene` options gain `range?: { startTime: number; endTime: number }` (clamped to [0, duration], start<end else INVALID), `resolutionScale?: 1 | 0.5 | 0.25` (encoder dimensions scaled and rounded to even), `isCanceled?: () => boolean` (checked each frame; on true, abort cleanly, return `{ canceled: true }`-shaped result). `MotionExportFormat |= "png-sequence"` (`extension: "zip"`, transparent true); the frame loop renders each frame in range at scale → `imageBitmapToPngBlob` → entries named `frame-00001.png` … → ZIP (stored, CRC32) → single Blob download. Video formats honor range/scale through the existing encoder config.

- [ ] **Step 1: Failing tests** — range clamped + frame count correct for a 1s@30fps range; scale 0.5 halves + even-rounds encoder dims (spy on the encoder/config path with mocks as the existing export tests do — read them first); png-sequence produces a ZIP whose central directory (parse it in the test) lists the expected N entries with valid CRCs; `isCanceled` true after 3 frames → renderer invoked ≤4 times and no file produced.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 5: Queue store + panel upgrades — after T4 (shares export/queue surfaces)

**Files:**
- Modify: `apps/web/src/motion/stores/motion-store.ts` (`MotionRenderQueueItem` + ops)
- Modify: `apps/web/src/motion/components/RenderQueuePanel.tsx`
- Test: extend `apps/web/src/motion/components/RenderQueuePanel.guardrail.test.tsx` pattern in `RenderQueuePanel.queue-ops.test.tsx` (new)

**Implementation:** Store: item gains `range?`, `resolutionScale?`, status union gains `"canceled"`, `cancelRequested?: boolean`; new ops `moveRenderQueueItem(id, "up"|"down")` and `cancelRenderQueueItem(id)` (queued item → status canceled immediately; running item → sets cancelRequested). Panel: add-form gains range inputs (start/end seconds, defaulted to 0/comp duration, validated start<end) + resolution select (Full/Half/Quarter) + the png-sequence format option; each row gains cancel (visible for queued/running) and up/down reorder (disabled while running); `runQueue` passes `range/resolutionScale` and `isCanceled: () => item.cancelRequested === true` (read fresh from the store per frame) into `exportMotionCompositionScene`, marks canceled items `"canceled"`, continues with the next item. The ProRes/alpha guardrail stays exactly as is; png-sequence bypasses it (no native backend needed).

- [ ] **Step 1: Failing RTL tests** — add a job with range/half-res/png-sequence → store item carries them; cancel a queued item → status canceled; reorder swaps; runQueue passes the options through (mock the export fn) and a mid-run cancelRequested stops the export (mock isCanceled loop).
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0; full web motion suite green.** No commit.

---

### Task 6: MCP queue tools — after T5

**Files:**
- Modify: `packages/agent/src/host.ts` (optional capability)
- Modify: `apps/web/src/services/agent/live-host.ts`
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.render-queue.test.ts` (new)

**Interfaces — Produces:**
```ts
// EditingHost gains (OPTIONAL, mirrors exportMotionScene):
motionRenderQueue?: {
  add(input: { compositionId: string; format: string; range?: {startTime:number; endTime:number}; resolutionScale?: number; filename?: string }): { itemId: string } | { error: string };
  run(): Promise<ReadonlyArray<{ itemId: string; status: string; encodedFormat?: string; filename?: string }>>;
  list(): ReadonlyArray<Record<string, unknown>>;
  cancel(itemId: string): boolean;
};
```
live-host implements it over the motion-store ops + the panel's run logic (extract the panel's runQueue core into a shared function both call — `apps/web/src/motion/render-queue-runner.ts` — so MCP-run and UI-run share one code path). Registry tools: `queue_motion_render` (validate format ∈ MOTION_EXPORT_FORMATS + png-sequence, range within comp duration, scale ∈ {1,0.5,0.25}; ProRes/alpha on web requires `acknowledgeH264Fallback` mirroring export_motion_video), `run_motion_render_queue` (expensive:true; returns per-item outcomes), `list_motion_render_queue` (readOnly), `cancel_motion_render_item`. All fail gracefully (`"render queue not supported by this host"`) when the capability is absent (headless test asserts this).

- [ ] **Step 1: Failing tests** — headless graceful failure for all four; param validation (bad format/range/scale → INVALID_PARAMS); with a mock host capability: add→list→cancel round-trip and run returns outcomes.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: agent+web tsc 0; agent suite green.** No commit.

---

### Task 7: Integration verification + live visual

- [ ] **Step 1:** tsc 0 ×3. **Step 2:** core motion (504+), web motion (192+ FULLY green), agent (392+) all pass.
- [ ] **Step 3:** Live (dev server, Playwright): play the comp → the green cache bar grows behind the playhead; pause, replay the cached span and verify cache hits (instrument: count `renderComposition` invocations via a temporary counter or assert the bar persists and playback is smooth); edit a layer property → the bar clears instantly; click "Fill RAM preview" → bar fills to 100%; queue a 1s half-res png-sequence job → a .zip downloads (verify entry count if reachable); start an mp4 job and cancel mid-run → item shows canceled. Screenshots; 0 console errors. If the app can't launch, unit coverage stands; mark manual.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** cache §1→T1, integration §2→T2, bar/controls §3→T3, export §4→T4, queue §5→T5, MCP §6→T6, verify→T7. ✓
- **Placeholders:** exact interfaces, ownership rules, eviction policy, ZIP validation strategy, and test assertions throughout. ✓
- **Type consistency:** `MotionFrameCache`/`FrameBitmapLike`/`cachedRanges` (T1) used by T2/T3; `frame-cache-state` (T2) consumed by T3; `range/resolutionScale/isCanceled` (T4) consumed by T5/T6; `render-queue-runner` shared by panel + live-host (T5/T6). ✓
- **Ordering:** T1 → [T2∥T4] → [T3∥T5] → T6 → T7; StageCanvas chain (T2→T3) and export/queue chain (T4→T5) don't overlap. ✓
