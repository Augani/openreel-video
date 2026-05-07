# OpenReel Image Technical Task List

OpenReel Image is currently a strong editor prototype with React UI, Canvas2D rendering, Zustand stores, artboards, layers, text, shapes, uploads, templates, basic export, and background removal. To reach a Canva + Photoshop style product, the next work should focus on engine foundations first, then design workflows, photo workflows, AI, cloud, and quality.

## 0. Baseline Stabilization ✓

- [x] Keep `pnpm --filter @openreel/image typecheck` passing.
- [x] Keep `pnpm --filter @openreel/image test:run` passing.
- [x] Replace the placeholder test in `apps/image/src/app.test.ts` with real smoke tests.
- [x] Add project creation tests.
- [x] Add layer add/remove/duplicate/reorder tests.
- [x] Add artboard add/remove/update tests.
- [x] Add export service tests for PNG, JPG, and WebP.
- [x] Add project schema validation before loading `.orimg` files.
- [x] Add project migration support with explicit `version` handling.
- [x] Audit all tool panels and mark whether each is fully implemented, partially wired, or UI-only.
- [x] Add a feature status matrix for tools, panels, and export formats.

Tech:

- Vitest
- React Testing Library
- Zod or Valibot for project validation
- Playwright for browser smoke tests

## 1. Extract Image Core ✓

- [x] Create `packages/image-core`.
- [x] Move shared image document types out of `apps/image/src/types`.
- [x] Move pure layer operations out of Zustand stores.
- [x] Define a stable document model:
  - [x] Document
  - [x] Artboard/page
  - [x] Layer tree
  - [x] Group layer
  - [x] Image layer
  - [x] Text layer
  - [x] Shape/vector layer
  - [x] Adjustment layer
  - [x] Mask
  - [x] Smart object
  - [x] Asset reference
  - [x] Effects stack
  - [x] Selection state
  - [x] Export preset
- [x] Add pure functions for add, remove, duplicate, group, ungroup, reorder, rename, lock, hide, transform, and style updates.
- [x] Add invariant checks for invalid layer trees.
- [x] Add serialization and deserialization tests.

Tech:

- TypeScript strict mode
- Vitest
- fast-check for property tests
- Zod or Valibot

## 2. Command-Based Editing And History

- [ ] Replace snapshot-first history with a command/action system.
- [ ] Define command interface with `apply`, `invert`, and `merge` support.
- [ ] Implement commands:
  - [ ] `CreateProject`
  - [ ] `AddArtboard`
  - [ ] `RemoveArtboard`
  - [ ] `UpdateArtboard`
  - [ ] `AddLayer`
  - [ ] `RemoveLayer`
  - [ ] `DuplicateLayer`
  - [ ] `ReorderLayer`
  - [ ] `UpdateLayerTransform`
  - [ ] `UpdateLayerStyle`
  - [ ] `UpdateText`
  - [ ] `ApplyAdjustment`
  - [ ] `ApplyMask`
  - [ ] `RasterEdit`
- [ ] Add command coalescing for drag, resize, brush strokes, and slider scrubbing.
- [ ] Add checkpoint snapshots for large raster edits.
- [ ] Add undo/redo tests for every command.
- [ ] Update `HistoryPanel` to show meaningful command names.

Tech:

- Zustand or a dedicated command store
- Immer
- IndexedDB/OPFS for large raster checkpoints

## 3. Storage And Project Files

- [ ] Replace `localStorage` auto-save with IndexedDB metadata storage.
- [ ] Store large binary image assets in OPFS.
- [ ] Store thumbnails separately from original assets.
- [ ] Add asset deduplication by content hash.
- [ ] Add blob URL lifecycle management.
- [ ] Add project recovery after tab crash or refresh.
- [ ] Add import/export for `.orimg` as a zipped package.
- [ ] Include `project.json`, assets, thumbnails, fonts, and metadata in `.orimg`.
- [ ] Add migration tests from older project versions.

Tech:

- IndexedDB
- OPFS
- JSZip or fflate
- Web Workers for packaging

## 4. Rendering Engine

- [ ] Create `packages/image-renderer`.
- [ ] Separate interactive viewport rendering from final export rendering.
- [ ] Move renderer logic out of `Canvas.tsx`.
- [ ] Add a renderer interface:
  - [ ] `renderViewport`
  - [ ] `renderArtboard`
  - [ ] `renderLayer`
  - [ ] `renderThumbnail`
  - [ ] `hitTest`
  - [ ] `measureLayerBounds`
- [ ] Add Canvas2D renderer as baseline.
- [ ] Add OffscreenCanvas rendering in a worker.
- [ ] Add dirty-region invalidation.
- [ ] Add layer thumbnail generation.
- [ ] Add tile-based rendering for large canvases.
- [ ] Add high-DPI rendering support.
- [ ] Add pixel-diff tests for renderer output.

Tech:

- Canvas2D
- OffscreenCanvas
- Web Workers
- Pixelmatch or similar pixel-diff library

## 5. WebGPU Rendering And Pixel Processing

- [ ] Add WebGPU feature detection.
- [ ] Add Canvas2D fallback path.
- [ ] Implement GPU blend mode compositor.
- [ ] Implement GPU filter pipeline.
- [ ] Implement GPU mask compositing.
- [ ] Implement GPU adjustment layers.
- [ ] Implement GPU Gaussian blur.
- [ ] Implement GPU sharpen.
- [ ] Implement GPU curves/levels.
- [ ] Implement GPU HSL/selective color.
- [ ] Implement GPU gradient/noise fills.
- [ ] Implement GPU displacement map for liquify/warp.
- [ ] Add WASM fallback for browsers without WebGPU.

Tech:

- WebGPU
- WGSL shaders
- WASM fallback modules
- Workerized processing

## 6. Selection System

- [ ] Create a dedicated selection model.
- [ ] Implement rectangular selection.
- [ ] Implement elliptical selection.
- [ ] Implement lasso selection.
- [ ] Implement polygon lasso selection.
- [ ] Implement magic wand selection with tolerance.
- [ ] Implement add/subtract/intersect selection modes.
- [ ] Implement feather.
- [ ] Implement smooth.
- [ ] Implement expand/contract.
- [ ] Implement invert selection.
- [ ] Implement save/load selection.
- [ ] Implement selection to mask.
- [ ] Implement mask to selection.
- [ ] Implement selection-aware delete, fill, copy, cut, paste, and transform.

Tech:

- Mask buffers
- WebGPU/WASM flood fill
- Canvas overlay renderer

## 7. Layer Masks And Clipping

- [ ] Finish per-layer mask data model.
- [ ] Add mask preview in layer panel.
- [ ] Add enable/disable mask.
- [ ] Add unlink mask from layer transform.
- [ ] Add apply mask.
- [ ] Add delete mask.
- [ ] Add mask painting.
- [ ] Add clipping masks.
- [ ] Add clipping groups.
- [ ] Add group masks.
- [ ] Add export support for masks and clipping.

Tech:

- Alpha mask buffers
- Renderer mask compositing
- Command history integration

## 8. Photo Editing Tools

- [ ] Finish brush engine integration.
- [ ] Add brush stroke persistence.
- [ ] Add brush spacing, hardness, opacity, flow, and blend mode.
- [ ] Add stylus pressure support.
- [ ] Finish eraser as raster edit and mask edit.
- [ ] Finish paint bucket with selection support.
- [ ] Finish gradient tool.
- [ ] Finish clone stamp.
- [ ] Finish healing brush.
- [ ] Finish spot healing.
- [ ] Finish dodge/burn.
- [ ] Finish sponge.
- [ ] Finish smudge.
- [ ] Finish blur/sharpen brush.
- [ ] Finish crop with aspect presets.
- [ ] Add straighten crop.
- [ ] Add perspective crop.
- [ ] Finish free transform.
- [ ] Finish perspective transform.
- [ ] Finish warp transform.
- [ ] Finish liquify.

Tech:

- Pointer Events
- Pointer pressure/tilt
- OffscreenCanvas
- WebGPU/WASM raster edits
- Command checkpoints for brush strokes

## 9. Adjustment Layers And Filters

- [ ] Convert destructive adjustment controls into nondestructive adjustment layers.
- [ ] Add adjustment layer type.
- [ ] Add adjustment stack ordering.
- [ ] Add clipped adjustment layers.
- [ ] Finish levels.
- [ ] Finish curves.
- [ ] Finish color balance.
- [ ] Finish selective color.
- [ ] Finish black and white.
- [ ] Finish photo filter.
- [ ] Finish channel mixer.
- [ ] Finish gradient map.
- [ ] Finish posterize.
- [ ] Finish threshold.
- [ ] Add LUT import.
- [ ] Add filter presets.
- [ ] Add nondestructive smart filters.

Tech:

- Adjustment layer renderer
- WebGPU shaders
- LUT parser
- Preset JSON schema

## 10. Text Engine

- [ ] Move text layout to image core.
- [ ] Add robust multiline text layout.
- [ ] Add text boxes with overflow behavior.
- [ ] Add auto-fit text.
- [ ] Add vertical alignment.
- [ ] Add paragraph spacing.
- [ ] Add letter spacing.
- [ ] Add text transform controls.
- [ ] Add text-on-path.
- [ ] Add editable text cursor/selection on canvas.
- [ ] Add font loading and missing font fallback.
- [ ] Add Google Fonts or curated font catalog.
- [ ] Add text style presets.

Tech:

- FontFace API
- Canvas text metrics
- Optional HarfBuzz WASM later for advanced layout

## 11. Vector And Shape Tools

- [ ] Finish pen tool editing.
- [ ] Add anchor point selection.
- [ ] Add bezier handles.
- [ ] Add boolean path operations.
- [ ] Add compound paths.
- [ ] Add SVG import normalization.
- [ ] Add SVG export for vector layers.
- [ ] Add shape-specific controls for polygon/star/arrow/line.
- [ ] Add custom icon elements instead of disabled placeholders.
- [ ] Add vector hit testing.

Tech:

- SVG path parser
- Path boolean library or custom WASM later
- Renderer support for vector paths

## 12. Canva-Style Design Workflows

- [ ] Build real template objects with editable layers.
- [ ] Add template thumbnails.
- [ ] Add template search.
- [ ] Add template categories:
  - [ ] Instagram post
  - [ ] Instagram story
  - [ ] YouTube thumbnail
  - [ ] TikTok/Reels cover
  - [ ] Poster
  - [ ] Flyer
  - [ ] Presentation
  - [ ] Logo
  - [ ] Business card
  - [ ] Ad banners
- [ ] Add brand kits.
- [ ] Add reusable colors.
- [ ] Add reusable fonts.
- [ ] Add reusable logos.
- [ ] Add style presets.
- [ ] Add frames and image placeholders.
- [ ] Add drag-to-replace image frames.
- [ ] Add smart guides.
- [ ] Add distribute/tidy layout.
- [ ] Add magic resize across artboard sizes.
- [ ] Add batch export for social formats.

Tech:

- Template JSON schema
- Asset catalog
- IndexedDB/R2 asset storage
- Search indexing with Fuse.js or Minisearch

## 13. Asset Library

- [ ] Add local asset folders.
- [ ] Add asset tagging.
- [ ] Add asset search.
- [ ] Add asset metadata extraction.
- [ ] Add image thumbnail generation.
- [ ] Add SVG thumbnail generation.
- [ ] Add favorite assets.
- [ ] Add recent assets.
- [ ] Add stock asset integration later.
- [ ] Add drag/drop from OS into canvas.
- [ ] Add drag/drop from asset panel into canvas.

Tech:

- IndexedDB
- OPFS
- Web Workers
- Optional Cloudflare R2 for synced assets

## 14. AI Features

- [ ] Keep local background removal working.
- [ ] Add server-side AI gateway.
- [ ] Add text-to-image generation.
- [ ] Add image variations.
- [ ] Add generative fill.
- [ ] Add object removal.
- [ ] Add background replacement.
- [ ] Add product photo background generation.
- [ ] Add prompt-to-template.
- [ ] Add prompt-to-social-post.
- [ ] Add smart crop/reframe.
- [ ] Add image upscaling.
- [ ] Add AI-generated layer metadata.
- [ ] Add usage limits and error handling.

Tech:

- Cloudflare Workers
- OpenAI Images API or selected provider
- Cloudflare R2 for generated assets
- Queues for long-running jobs
- Rate limiting

## 15. Export And Import

- [ ] Finish PNG export.
- [ ] Finish JPG export.
- [ ] Finish WebP export.
- [ ] Implement true SVG export.
- [ ] Implement PDF export.
- [ ] Implement multi-artboard PDF export.
- [ ] Add transparent background export.
- [ ] Add scale presets.
- [ ] Add print bleed.
- [ ] Add crop marks.
- [ ] Add social export bundles.
- [ ] Add zipped multi-file export.
- [ ] Add SVG import.
- [ ] Add PDF import as rasterized pages.
- [ ] Investigate limited PSD import.

Tech:

- Canvas export
- SVG serializer
- pdf-lib or server-side Playwright/Skia
- fflate/JSZip
- PDF.js for import

## 16. Cloud Product Layer

- [ ] Add account system.
- [ ] Add project dashboard.
- [ ] Add cloud save.
- [ ] Add project sync.
- [ ] Add cloud asset library.
- [ ] Add share links.
- [ ] Add comments.
- [ ] Add team folders.
- [ ] Add permissions.
- [ ] Add template publishing.
- [ ] Add version history.
- [ ] Add billing/usage tracking if AI or storage becomes paid.

Tech:

- Cloudflare Workers
- Cloudflare Pages
- Cloudflare R2
- Cloudflare D1 or external Postgres
- Auth.js, Clerk, Supabase Auth, or custom auth
- Durable Objects for realtime sessions later

## 17. Collaboration

- [ ] Add presence model.
- [ ] Add multiplayer cursors.
- [ ] Add document-level comments.
- [ ] Add layer comments.
- [ ] Add conflict-safe command sync.
- [ ] Add realtime coediting prototype.
- [ ] Add offline edits and sync reconciliation.

Tech:

- Yjs or Automerge
- Cloudflare Durable Objects
- WebSockets
- Command/event log

## 18. Performance

- [ ] Add performance benchmark suite.
- [ ] Benchmark 10, 50, 100, and 200 layer projects.
- [ ] Benchmark large 4K and print-size artboards.
- [ ] Add thumbnail cache.
- [ ] Add render cache invalidation.
- [ ] Add memory budget tracking.
- [ ] Add workerized export.
- [ ] Add workerized thumbnail generation.
- [ ] Add workerized image import.
- [ ] Add image downsample strategy for viewport rendering.
- [ ] Add full-resolution export path.

Tech:

- Playwright performance tests
- Browser Performance API
- OffscreenCanvas
- Web Workers
- WebGPU

## 19. Quality And Release Gates

- [ ] Add Playwright create/edit/export smoke test.
- [ ] Add Playwright upload image test.
- [ ] Add Playwright text editing test.
- [ ] Add Playwright layer ordering test.
- [ ] Add visual regression tests.
- [ ] Add renderer pixel tests.
- [ ] Add export pixel tests.
- [ ] Add accessibility checks.
- [ ] Add keyboard shortcut tests.
- [ ] Add file migration tests.
- [ ] Add crash recovery tests.
- [ ] Add CI jobs for image app.

Tech:

- Vitest
- Playwright
- Pixelmatch
- axe-core
- GitHub Actions

## Suggested Build Order

- [x] Stabilize tests and project schema.
- [x] Extract `packages/image-core`.
- [ ] Implement command-based undo/redo.
- [ ] Move storage to IndexedDB/OPFS.
- [ ] Extract renderer from React canvas.
- [ ] Add renderer regression tests.
- [ ] Finish masks and selections.
- [ ] Finish adjustment layers.
- [ ] Finish photo tools.
- [ ] Build real template and asset library.
- [ ] Add brand kits and magic resize.
- [ ] Add AI image editing/generation.
- [ ] Add cloud save and sharing.
- [ ] Add collaboration.

