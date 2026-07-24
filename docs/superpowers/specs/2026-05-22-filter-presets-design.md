# Filter Presets v1 — Design Spec

**Date:** 2026-05-22
**Status:** Approved (brainstorming complete, ready for implementation plan)
**Scope:** First subsystem of the broader CapCut-parity filter/effect work. Strictly LUT-based color-grade presets. Procedural effects (vignette, grain, particles, blur), AR/face effects, body effects, transitions, stickers, text animations, and background effects are explicit non-goals here; each gets its own spec.

## Goals

Take the current ~20 parameter-driven filter presets up to a curated, code-generated catalog of ~60 LUT-based filters, available on both iOS and Android, served from existing Cloudflare R2 infrastructure, with a CapCut-style filter picker that shows dynamic per-frame thumbnails and a 0–100% intensity slider.

Success criteria:

- 60 filters live across 6 categories, deployable without an app release.
- Picker opens to a populated catalog with ≤ 250 ms to first painted tile on a warm cache.
- Intensity slider blends source and filtered output per-clip.
- Cross-platform render parity: iOS and Android outputs differ by ≤ 1 LSB / channel on the same `(source, filter, intensity)` triple.
- Existing user projects that reference the legacy `filterPreset` effect migrate transparently.

## Non-Goals

- Vignette, grain, blur, light leaks, particles — not expressible as a 3D LUT, belong to a separate "procedural effects" spec.
- AR/face beauty, body slim, makeup, face stickers.
- User-imported `.cube` files (deferrable to v2, trivial to add later).
- "Favorites" UX (Recents only in v1).
- Project-level global look (per-clip only in v1).
- Paid/Pro filter tier (no entitlement system in this design).

## Architecture Overview

Three independently testable pieces.

```
 ┌──────────────────────────┐        ┌────────────────────────────┐
 │  Build-time tool         │        │  Cloudflare R2 (public)    │
 │  ─────────────────       │  push  │  ──────────────────        │
 │  scripts/filters/        │ ─────▶ │  R2 bucket:                │
 │   - recipes/*.yaml       │        │   openreel-filters/        │
 │   - generate.py          │        │     manifest.json          │
 │   - manifest writer      │        │     cube/<id>.cube         │
 │                          │        │  Custom domain:            │
 │  Outputs:                │        │   filters.openreel.video   │
 │   - 60 × .cube           │        │   /manifest.json           │
 │   - manifest.json        │        │   /cube/<id>.cube          │
 │                          │        │  (R2 native ETag + cache)  │
 └──────────────────────────┘        └────────────┬───────────────┘
                                                  │
                                                  ▼
                  ┌────────────────────────────────────────────────┐
                  │  Mobile (iOS Swift  &  Android Kotlin)         │
                  │  ──────────────────────────────────────        │
                  │  • FilterCatalogService                        │
                  │  • FilterLutCache                              │
                  │  • FilterRenderer                              │
                  │  • FilterPickerViewModel + view                │
                  │  • Clip model: filterId? + intensity           │
                  └────────────────────────────────────────────────┘
```

**Boundaries**:

- Tool boundary: input = `recipes/*.yaml`, output = `.cube` + manifest. Pure function; golden-file tests.
- Hosting boundary: R2 public bucket fronted by a Cloudflare custom domain. ETags + immutable cache come from R2 directly — no Worker in the path.
- Mobile boundary: four classes per platform with the same surface, each with one job.

**Slots into existing code**:

- iOS `Core/Effects/CubeLUTParser.swift` and `Core/Rendering/VideoEffectRenderer.swift` already parse `.cube` and run a CIFilter chain.
- Android `core/effects/CubeLUTParser.kt` and `core/effects/ClipEffectPipeline.kt` are the equivalents.
- Filter delivery is a static-content workload; we serve it from R2 directly. The existing `apps/cloud` Worker is left untouched (it handles templates/shares/AI on its own and is gitignored by repo convention).

## Recipe Toolchain

**Location**: `scripts/filters/` in the repo.

```
scripts/filters/
├── generate.py              # main tool
├── transforms.py            # individual color ops
├── manifest_schema.json
├── tests/
│   ├── transforms_test.py
│   └── fixtures/sample.yaml + sample.cube  (golden)
├── recipes/
│   ├── cinematic/*.yaml
│   ├── portrait/*.yaml
│   ├── vlog/*.yaml
│   ├── retro/*.yaml
│   ├── mood/*.yaml
│   └── bw/*.yaml
└── out/                     # generated, .gitignored
    ├── cube/                # 60 × .cube files
    └── manifest.json
```

**Recipe format** (one file per filter):

```yaml
id: cinematic.teal_orange
name: Teal & Orange
category: cinematic
accent: "#38BDF8"
sort: 10
steps:
  - temperature: -8
  - tint: +3
  - contrast:
      curve: s_curve
      amount: 1.15
  - split_tone:
      shadows: "#1E3A5F"
      highlights: "#FFA94D"
      balance: 0.0
  - saturation: 1.10
  - hue_shift:
      reds: -5
```

**Supported `steps`** (v1, all per-pixel RGB→RGB so they fit in a 3D LUT):

`temperature`, `tint`, `exposure`, `contrast` (linear / gamma / s_curve), `saturation`, `vibrance`, `hue_shift` (per-channel or global), `split_tone` (shadows / highlights / balance), `lift_gamma_gain`, `channel_mixer` (3×3 RGB matrix), `tone_curve` (control points), `clip` (black/white levels), `monochrome` (with channel weights).

**Explicitly out of v1**: `vignette`, `grain`, `blur`, `light_leak` — non-LUT, deferred to procedural effects subsystem.

**Generator algorithm**:

1. Build a 33³ identity LUT in NumPy.
2. Apply each `step` as a vectorized color transform on the LUT samples (~5 ms per LUT).
3. Write `.cube` in Adobe standard format (compatible with both existing parsers).
4. Append `{ id, name, category, accent, sort, sha256, bytes }` to `manifest.json`.

**Categories at v1** (6 × ~10):

| Category | Filters (representative; final list locked in Phase 2) |
|---|---|
| Cinematic | Teal & Orange, Blockbuster, Movie, Noir, Hollywood, Drama, Bleach Bypass |
| Portrait | Soft, Warm, Golden, Porcelain, Natural |
| Vlog | Crisp, Vibrant, Punchy, Soft Pop |
| Retro | 70s, 80s, Polaroid, VHS, Sepia, Faded Film, Old Photo |
| Mood | Dreamy, Moody, Golden Hour, Cold Blue, Stormy, Soft Mist |
| B&W | Classic, High Contrast, Matte, Faded, Soft Mono, Gritty |

**Deploy step**: `python generate.py && aws s3 sync out/ s3://openreel-filters/ --cache-control "public, max-age=31536000, immutable" --delete`. Manifest gets a shorter TTL so clients pick up new filters fast.

## Hosting + Delivery

**R2 bucket**: `openreel-filters` (separate from `openreel-templates` and `openreel-shares` for clean lifecycle/permissions).

```
openreel-filters/
├── manifest.json
└── cube/
    ├── cinematic.teal_orange.cube
    ├── cinematic.blockbuster.cube
    └── ... (60 files)
```

**Manifest shape**:

```json
{
  "version": "2026-05-22T1",
  "minClientVersion": "1.0.0",
  "filters": [
    {
      "id": "cinematic.teal_orange",
      "name": "Teal & Orange",
      "category": "cinematic",
      "accent": "#38BDF8",
      "sort": 10,
      "cubeUrl": "https://filters.openreel.video/cube/cinematic.teal_orange.cube",
      "sha256": "abc123...",
      "bytes": 154832,
      "oldIds": []
    }
  ],
  "categories": [
    { "id": "cinematic", "name": "Cinematic", "sort": 1 },
    { "id": "portrait",  "name": "Portrait",  "sort": 2 },
    { "id": "vlog",      "name": "Vlog",      "sort": 3 },
    { "id": "retro",     "name": "Retro",     "sort": 4 },
    { "id": "mood",      "name": "Mood",      "sort": 5 },
    { "id": "bw",        "name": "B&W",       "sort": 6 }
  ]
}
```

Per-filter `sha256` and `bytes` enable post-download integrity check and reuse decisions across manifest versions. `oldIds` lets the client remap a renamed filter without orphaning user clips.

**Public delivery** (R2 custom domain, no Worker):

```
GET https://filters.openreel.video/manifest.json    → Cache-Control: public, max-age=300, s-maxage=3600
GET https://filters.openreel.video/cube/<id>.cube   → Cache-Control: public, max-age=31536000, immutable
```

R2 serves with native ETag + 304 semantics; we set the cache-control headers on upload via `wrangler r2 object put --cache-control`. CORS is configured on the bucket once (PUT/GET/HEAD, `*` origin) so the web editor can fetch directly. The manifest's `cubeUrl` fields hold absolute URLs so any future migration (back to a Worker, or to a different host) doesn't require a client release.

**Versioning + cache invalidation**:

- `version` field is an ISO timestamp + counter (`2026-05-22T1`).
- Clients store last-seen version. On launch and on picker open, refetch manifest with `If-None-Match`. 304 → use cache. 200 → reconcile.
- LUT URLs are stable per id; cache layer verifies `sha256` so changed recipes auto-invalidate downstream caches.

**Client prefetch strategy**:

- App launch: fetch manifest in background, low priority.
- Picker open: download visible-tile LUTs first (~10), continue rest in background.
- Wi-Fi: prefetch all 60 (~9 MB).
- Cellular: on-demand only; configurable in settings.
- LRU disk cache, 50 MB cap.

## Mobile Data Model + Cache + Render Integration

**Clip data model** (both platforms):

```kotlin
data class AppliedFilter(
    val id: String,        // matches manifest.filters[].id
    val intensity: Float,  // 0.0 .. 1.0
)
// clip.filter: AppliedFilter? = null
```

Stored next to existing `effects: []`. Existing projects deserialize with `filter = null` and behave identically to today.

**Four classes, identical surface on both platforms**:

```
FilterCatalogService          singleton, reactive
  state: StateFlow<FilterCatalog>   ← .loading | .ready(filters, categories) | .error
  refresh() async                   ← fetch manifest, reconcile against on-disk snapshot
  Persists last good manifest so the picker is never empty after first successful launch.

FilterLutCache
  fun get(id: String): LutData?              ← memory hit
  suspend fun fetch(id: String): LutData     ← disk hit → network fetch → sha verify
  fun prefetch(ids: List<String>)            ← background, queued, cancellable
  LRU 50MB on disk. Parsed LutData (33³ float array) memoized in memory.

FilterRenderer
  fun apply(image, filterId, intensity): image
  Looks up LUT via FilterLutCache.get (synchronous, must already be cached).
  If not cached: returns source unmodified and signals caller to await fetch.
  Mix: out = lerp(srcPixel, lutSample(srcPixel), intensity).

FilterPickerViewModel
  state: StateFlow<{ categories, filters, selectedId, intensity, thumbnails }>
  onSelect(id), onIntensityChange(value), onCategoryChange(catId)
```

Boundaries are tight: renderer doesn't know about HTTP, catalog doesn't know about Metal/GL, cache doesn't know about UI.

**iOS integration** — slots into `Core/Rendering/VideoEffectRenderer.swift`.

- `FilterCatalogService` is an `actor`; UI binds via a `@MainActor` snapshot wrapper.
- `FilterLutCache.fetch` uses `URLSession.downloadTask`. Files land in `Caches/openreel-filters/{id}.cube`.
- LUT becomes a `CIFilter` named `CIColorCube` (`inputCubeDimension: 33`, `inputCubeData: Data`).
- Intensity uses `CIBlendWithMask`: source CIImage and LUT-applied CIImage, masked by a flat-alpha image whose value = `intensity`. One CIFilter, GPU-fused.

**Android integration** — slots into `core/effects/ClipEffectPipeline.kt`.

- `FilterCatalogService` exposes `StateFlow<FilterCatalog>`. Cache uses OkHttp + `withContext(Dispatchers.IO)`.
- Renderer adds a Media3 `GlEffect` that uploads the 33³ LUT as a `GL_TEXTURE_3D` and samples per-pixel in the fragment shader. Intensity is a uniform; `mix(src, lut, intensity)` in GLSL.

**Order of operations in the clip render chain** (locked, both platforms):

```
source → LUT (filter @ intensity) → user color adjustments → spatial effects → output
```

LUT first means user color adjustments stack predictably on top of the filter (CapCut's behavior). Reversing the order makes adjustments feel inconsistent across filters.

## Filter Picker UX

**Entry point**: existing "Filter" affordance on the contextual toolbar when a video clip is selected. Existing filter panels are replaced; entry point is unchanged.

**Layout** (both platforms):

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                  ▶  preview (live updated)                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Intensity ───────●─────────────  72%      [Reset] [Apply]  │
├─────────────────────────────────────────────────────────────┤
│  Recent  Cinematic  Portrait  Vlog  Retro  Mood  B&W        │
├─────────────────────────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐             │
│ │ None│ │  ✓  │ │     │ │     │ │     │ │     │   ...       │
│ │     │ │ thmb│ │ thmb│ │ thmb│ │ thmb│ │ thmb│             │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘             │
│  None    T&O    Block.  Noir    Movie   Drama               │
└─────────────────────────────────────────────────────────────┘
```

**Interactions**:

- Tap filter → applied immediately at 100% intensity. Selected tile shows a check + colored ring (manifest `accent`).
- Tap same filter again → toggles off (returns to None).
- Drag intensity → live preview, no commit until release. Slider hidden when "None" is selected.
- "Reset" → intensity back to 100%, filter stays selected.
- "Apply" → commits and dismisses. Closing without Apply also commits (CapCut behavior; user has Undo).
- Recents tab: last 12 used across all projects, persisted in user defaults / DataStore.
- Long-press a thumbnail → "Apply to all clips" — single undoable action.
- "None" is the leftmost tile in every category.

**Thumbnail rendering pipeline**:

1. Picker opens → snapshot current preview frame at small res (144×256 portrait, 256×144 landscape). iOS pulls from `MetalVideoView.lastFrame.pixelBuffer`; Android from the latest ExoPlayer surface texture.
2. Snapshot is a single CIImage / Bitmap in memory.
3. For each visible tile (~8 initially), run `FilterRenderer.apply(snapshot, filterId, 1.0)` on a background queue.
4. As user scrolls, queue incoming tiles, cancel out-of-viewport jobs.
5. Cache `[filterID → thumbnail]` keyed by `(filterID, snapshotHash)`. Invalidate when playhead moves > 1 s.

**Per-tile state machine**:

```
unknown → pending-lut → ready → rendered
                  \─────────────▶ failed (retries on tap)
```

`pending-lut` and `failed` tiles render a placeholder (accent color + filter name). They're tappable; tap promotes the download.

**Empty / failure / offline copy**:

- No manifest ever loaded: empty state with retry.
- Offline + nothing cached: same.
- Offline + some cached: cached filters visible + banner "More filters available when you're online".

**Accessibility**:

- VoiceOver / TalkBack: `"<Filter name>, <category>, <selected | not selected>"`.
- Intensity slider increment: 5%.
- Selection state uses border + check, not just accent color (colorblind-safe).

## Error Handling + Edge Cases

- **Filter referenced by project but no longer in manifest** — if LUT still in local cache, clip renders correctly; picker shows it under an "Unavailable" section, greyed out for new application. If neither manifest nor cache has it, render with `intensity = 0` and surface a one-line warning in the inspector.
- **Schema drift** — manifest decoders ignore unknown fields. New required fields gated by `minClientVersion`; clients older than `minClientVersion` hide affected filters and prompt to update.
- **LUT corrupted on disk** — `sha256` verified on read. Mismatch → delete + refetch once → on second mismatch, tile goes to `failed`.
- **Disk full** — cache evicts 5 oldest entries on `ENOSPC` and retries. If still failing, hold LUT in memory only for current session + show one-time "Storage full" toast.
- **App backgrounded mid-download** — resumable HTTP (URLSession background config on iOS, OkHttp `Range:` on Android). Picker refreshes tiles as downloads complete on resume.
- **Concurrent picker opens for two clips** — catalog and cache are singletons; same `filterId` returns the same memoized `LutData`. No double parse, no double download.
- **Migration from legacy `filterPreset` effect** — `generate.py`'s first run bakes the existing 20 parameter presets into `.cube` files. Project-load migration in `AppState` rewrites `effects: [filterPreset(...)]` → `clip.filter: { id, intensity }`. Legacy render path stays as fallback for one app version, then removed.
- **Two clips with the same filter** — single in-memory `LutData` shared.
- **Renamed filter id** — manifest's `oldIds` array lets clients transparently remap during reconciliation.
- **Server 5xx on manifest** — last-known-good manifest from disk is served. Picker never empty after first successful launch.
- **Time-of-check vs time-of-render** — long export uses a `LutData` snapshot taken at export start; manifest changes mid-export don't affect that export.
- **Privacy / telemetry** — no PII in filter requests, no per-user tagging. Optional aggregate "filter applied" event later, no PII.

## Testing Strategy

**Tool layer** (`scripts/filters/`):

- Per-transform unit tests with ±1 LSB tolerance on known RGB triples.
- Golden-file test: fixture recipe → expected `.cube`, with diff on regen mismatch.
- Manifest validated against JSON Schema in CI.
- Per-recipe smoke test: each loads, generates without error, renders a fixed color-chart PNG deterministically. Committed expected PNGs serve as visual regression surface.

**Hosting layer** (R2 public bucket):

- Post-deploy curl smoke: `curl -sI https://filters.openreel.video/manifest.json` returns 200 + ETag + correct `Cache-Control`. Repeat with `If-None-Match: <etag>` → 304.
- Same smoke for a `.cube` URL — verifies the `immutable` cache header.

**Mobile, service-level** (no UI):

- `FilterCatalogService` reconcile tests against fixture manifests: first fetch, no-op refetch, add/remove/change/rename, unknown-field tolerance.
- `FilterLutCache`: hit (mem + disk), miss → fetch → sha verify, mismatch retry then fail, eviction at cap, concurrent fetch returns shared result.
- `FilterRenderer`: golden-image snapshot tests at intensity 0/50/100. Tolerance ≤ 1 LSB / channel.

**Cross-platform parity** (CI gate from Phase 1):

- Same `(sample.png, filterId, intensity)` triple through iOS and Android renderers, output PNGs compared. Diverge by > 1 LSB / channel anywhere → CI fails.

**UI** — light, intentional:

- One snapshot test per major picker state: empty, loading, populated, with selection, intensity moved, offline-with-cached, offline-without-cached.
- No tests on scroll/hover mechanics.

**Performance budgets**:

- Picker open → first tile painted: ≤ 250 ms (mid-tier device, warm cache). CI-enforced.
- LUT parse + GPU upload: ≤ 20 ms per filter. Profiled, not gated.
- Per-frame LUT pass at 1080p: ≤ 1 ms. Profiled, not gated.

**Explicitly out of scope**: end-to-end simulator tests (flaky, slow), network chaos fuzzing (the failure surfaces are already covered by mocked unit tests).

## Rollout Phases

**Phase 0 — Foundations (no user-visible change). ~1.5 days.**

- R2 bucket `openreel-filters` + public access via Cloudflare custom domain `filters.openreel.video`.
- Scaffold `scripts/filters/`: `generate.py`, transforms module, schema, golden-file fixtures, 1 hero recipe (Teal & Orange).
- Deploy to R2 with explicit cache-control headers via `wrangler r2 object put --cache-control`. Verify via curl.
- CI: tool unit tests (transforms, LUT writer, recipe loader, manifest, golden file).

Exit gate: manifest + Teal & Orange `.cube` live at `https://filters.openreel.video/...` with correct ETag + Cache-Control.

**Phase 1 — One filter, end-to-end. ~4 days.**

- "Teal & Orange" through the entire mobile pipeline on both platforms.
- iOS `FilterCatalogService`/`FilterLutCache`/`FilterRenderer` wired into `VideoEffectRenderer`. Picker replaces existing filter panel.
- Android same four classes; renderer slots into `ClipEffectPipeline`.
- Picker shows one filter + None. Intensity works. Apply commits. Cross-platform parity test passes.

Exit gate: TestFlight + Android internal track applying filter to real video with parity by eye.

**Phase 2 — Catalog at scale. ~5 days, parallelizable.**

- Author remaining ~55 recipes across the 6 categories.
- Bake the existing 20 `FilterPresetCatalog` parameter presets into recipes/LUTs.
- Run all 60 through `generate.py`; deploy to R2.
- Cross-platform parity test runs against all 60.
- Internal QA on real footage in every category.

Exit gate: 60 filters live, all green on parity, internal QA signoff.

**Phase 3 — Migration + ship. ~2 days.**

- Project-load migration in `AppState`: `effects: [filterPreset(...)]` → `clip.filter`. Both platforms.
- Legacy `VideoEffectType.filterPreset` render path kept as fallback for one release, removed in next.
- App Store + Play Store submission.

Exit gate: public release with new picker.

**Phase 4 — Content iteration (no engineering per drop).**

- New filters added by writing a recipe, running `generate.py`, syncing R2. Clients pick up next launch.
- Optional A/B via two manifest entries for the same logical look.
- Optional aggregate analytics on filter apply (no PII).

## Risk Register

- **Recipe quality** — biggest risk. Code-generated filters can feel "mathy" without tuning by eye. Mitigation: Phase 2 includes QA on real footage in every category. Fast iteration loop: edit YAML → `generate.py` → upload → instant client update.
- **Cross-platform color drift** between `CIColorCube` and the GLES 3D-texture sampler. Mitigation: parity test is a CI gate from Phase 1.
- **R2 cost / hotpath** — 60 LUTs × many devices is not a real scale concern, but `Cache-Control: immutable` is mandatory so we serve from edge cache, not the bucket.

## Estimate

~2 weeks for one engineer end-to-end. ~1 week with two (one per platform, parallel after Phase 0). Plus 1–2 days of color-grading taste calls during Phase 2.
