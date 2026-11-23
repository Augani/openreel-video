# Render cache (Render In to Out)

What it does: renders the frames of effects-heavy stretches once, stores them, and plays them back instead of
compositing live. The render bar over the timeline ruler shows where that applies.

| Bar | Meaning |
|---|---|
| none | plain media, plays live |
| yellow | needs a render, measured or estimated cost says real time is likely |
| red | needs a render, cost says frames will probably drop |
| green | rendered, valid, and played from the cache |

Commands (Sequence menu, shortcuts, agent tools): **Render In to Out** (Enter; In/Out range or whole sequence),
**Render Effects In to Out** (Cmd/Ctrl+Enter; only the yellow and red stretches in range, plain media skipped),
**Delete render files**. Progress and Cancel show in the timeline toolbar and as a "Render previews" row in the
background-task panel. Agent tools: `render_in_to_out` (with `effectsOnly`), `delete_render_files`, `get_render_status`.

## How it stays correct

* `buildPixelModel` snapshots every pixel-affecting entity (clips with effects, keyframes, grades, masks; transitions;
  text, shapes, graphics, adjustment layers, particles, nests; media identity) with its time span plus a sequence-wide
  fingerprint. Editing diffs two snapshots and drops exactly the frames of changed spans (live, in memory).
* `createSegmentHasher` turns the same model into a **content hash per segment**: a stretch of frames with the same set of
  active entities. A frame is stored with the hash of its segment.
* The index (`frame, bytes, last used, hash`, plus codec, frame size, rate, project key) is written next to the files after
  structural changes (debounced) and immediately when a render ends. On the next start `RenderCache.restore` re-hashes
  the project and keeps a frame only if its file exists with the recorded size, the codec and frame size are unchanged
  and the hash matches. Anything else, and any orphan file, is deleted.
* Size cap: byte-budgeted LRU inside a project (order persists), plus on desktop a total cap across projects.

## Where files live

* Desktop: `<scratch>/OpenReel Render Cache/<project key>/f<N>.frm` + `index.json`. Scratch folder and cap are in
  Settings > Render cache (default: `<userData>/render-cache`). Written by the main process (`src/main/render-cache`),
  atomic temp+rename, keys validated by schema.
* Browser: OPFS directory per project (IndexedDB fallback, memory when another tab owns the project).

## Tests

* Core: `packages/core/src/render-cache/render-cache-persistence.test.ts` (hash invalidation table, index format,
  restart restore, torn/missing files, eviction and persisted LRU, multi-range render, playback switching),
  `opfs-chunk-store.test.ts`.
* Desktop: `apps/desktop/test/render-cache-disk.test.ts`; Electron e2e `render-cache-electron.test.ts`
  (`pnpm --filter @openreel/desktop test:render-cache-e2e`, needs a `VITE_OPENREEL_E2E=1` build).
* Web: `apps/web/src/services/render-cache-backends.test.ts`, Playwright `apps/web/e2e/render-cache.spec.ts`.
* Perf: `node apps/desktop/scripts/perf-harness.mjs --only renderCache` (see `apps/desktop/PERF.md`).
