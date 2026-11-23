# Export queue, preview reuse and mixdown cache

## Export queue

Export dialog > **Add to queue** (next to Export Video) adds a job; the header
queue button (list icon, with a live count) opens a non-modal panel. Jobs run
one at a time after **Start queue**; **Pause queue** lets a running job finish
and then stops. Each row shows output name, sequence, preset, range, status,
progress, ETA and elapsed time, with cancel, retry (failed / cancelled /
interrupted), reorder (queued jobs), remove, and download (web) or reveal in
folder (desktop). Agent tools: `queue_export`, `list_export_jobs`,
`cancel_export_job`.

### Snapshot semantics

Enqueueing deep-copies the project (media blobs are shared, not duplicated) and
persists the copy in IndexedDB. A queued job renders that snapshot: later edits,
or switching to another project, do not change it. To export the new state, add
a new job.

The editor edits the project object in place, so a reference is not a snapshot;
the copy is what makes this work.

Limit: video effects, transitions and text/shape/SVG/sticker overlays are
rendered through engines that follow the *live* project. When the snapshot
differs visually from the live project as a job starts, those engines are
pointed at the snapshot for the job and restored afterwards. An effect or
overlay edit made *during* that run can still show up in its remaining frames.

### Persistence

The queue state, snapshots and finished browser files (OPFS) survive a reload.
A job that was running comes back `interrupted` and the queue comes back paused;
Retry re-runs it from its persisted snapshot. Desktop outputs are written to the
app's persisted export folder and revealed with the OS file manager.

## Use previews (render-cache reuse)

"Use previews" (default on) lets an export take frames from the Render In to Out
cache instead of re-rendering them, when the cache holds frames at exactly the
export size and frame rate, on the frame grid, for time ranges where the
snapshot renders identically to the project the cache follows
(`planInvalidation`), with no upscaling. Cached frames pass through the cache's
lossy intra codec, so output is **not bit-exact** with a fresh render (measured
about 50 dB PSNR per frame, visually lossless; see the e2e log). The setting
applies to queued and direct exports.

Render files survive restarts (see docs/render-cache.md), so a range rendered in an earlier session can feed an
export once the project is reopened and its files are verified. With the "Full resolution" preview setting the cache
frames are sequence-sized, which is what lets 4K exports match; with the default browser cap of 1920 wide they only
match exports at or below that size.

## Audio mixdown cache

`MixdownCache` (packages/core/src/audio/mixdown-cache.ts) caches the offline
master mix per window, keyed by an exact fingerprint of everything that can
change the window's sound: sample rate and channels, master rack, track
mute/solo/hidden/rack/transitions, every clip that can reach the window (media
and trim, volume, fades, automation, speed, audio effects, ...) and the source
media identity. Windows an edit cannot reach keep their cache entry; with
tail-producing effects or racks, earlier clips count too (the renderer pre-rolls
effect history). Visual-only edits (transform, colour, masks) do not invalidate.
Hashes are never memoised by object identity because the project is edited in
place. Used by exports (including the two-pass loudness target), "Analyze
timeline" and clip loudness measurement.
