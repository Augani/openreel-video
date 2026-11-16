# Native decode (ProRes and other non-WebCodecs codecs)

Chromium cannot decode ProRes, DNxHD, MPEG-4 part 2 and friends. On the desktop the bundled ffmpeg
sidecar decodes them on demand, straight from the original file, so they preview, scrub and export
without waiting for a proxy.

- `src/main/decode/native-decode.ts`: the service. One ffmpeg process per decode stream writes raw RGBA
  to a pipe; it pauses (pipe back-pressure) 12 frames past the last frame asked for. A request outside every
  live stream's window starts a new stream there (a scrub). At most 4 streams; frames live in a 320 MB LRU.
  Preview requests use a fast scaler at the monitor's width; export requests use bicubic at full quality.
- IPC: `media:nativeProbe`, `media:nativeFrame`, `media:nativeStats` (preload `openreel.media.native*`).
- `packages/core/src/media/native-frame-source.ts`: the provider registry the engines consult
  (`claimNativeSource(blob)`). `MediaBunnyEngine.getFrameAtTime/createExportDecoder/generateThumbnails`
  and the preview's playback/scrub paths use it, so preview, thumbnails and export share one source.
- `apps/web/src/services/native-decode.ts`: the renderer half (registered in `main.tsx` on desktop).
- Web build: no provider is registered; nothing changes except that the reason a ProRes clip cannot be
  shown is now on screen (import toast and the monitor's failure label).

## Reopened projects, moved files, rotation

- **Persisted.** A file imported through the native path keeps `MediaItem.nativeSource` (`path`, codec,
  upright size, rate, rotation) in the project, next to `sourceFile.path`. `src/services/native-path-hydration.ts`
  (started in `main.tsx` on desktop) watches the open project: it teaches the decoder the saved path of every
  Blob that came back from IndexedDB (a restored Blob has no path of its own), so a reopened, recovered or
  recent-list project decodes ProRes natively again with no re-import.
- **Moved files.** Each native item's file is `stat`-ed once per project open. A missing one becomes an offline
  placeholder (runtime state, no undo step; the saved project keeps the old path) with a toast. The usual relink
  controls apply: `reconnectKnownPaths` when the file is back at its old path, Relink from Folder, Replace asset.
  Relinking runs the import again, which refreshes `nativeSource.path`.
- **Rotation.** ffmpeg's banner (`displaymatrix: rotation of -90.00 degrees`, or the older `rotate` tag) is read as
  clockwise degrees. The probe reports the upright size (width/height swapped for 90/270) plus `rotation`, and the
  decoder runs `-noautorotate` with explicit `transpose`/`hflip,vflip` filters ahead of the scaler, so preview,
  thumbnails and export all get upright canvases of the same size. On the WebCodecs path mediabunny's CanvasSink
  applies the same rotation; the places that used `VideoSampleSink` now draw through `VideoSample.draw`
  (`packages/core/src/media/rotation.ts`).

Known limits: constant frame rate is assumed (frame index = floor(t * fps)); sources are found by the picked
File's path, the saved `nativeSource.path`, or a path remembered at relink. Reconnecting from a saved path reads
the file through the main process, so a file over 1.5 GB is not reconnected automatically: pick it with Replace
asset (the file chooser gives the real path without reading the file). Audio of a native clip still comes from
the stored Blob.

Desktop project e2e: `test/desktop-project-e2e.electron.test.ts` (`pnpm --filter @openreel/desktop test:desktop-e2e`,
needs a `VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build`). Real Electron, two app instances / relaunches,
native dialogs stubbed in the main process. It covers (1) project file locking: a second instance opens the project
read-only (banner, edits and Save refused), and quitting the first releases the lock so Retry works; (2) a ProRes
import saved, quit, relaunched and reopened decodes natively again with frames on the monitor; (3) the file moved on
disk reopens offline, "Search folder & relink" restores it and the new path persists across another relaunch.

Tests: `test/native-decode.test.ts` (real ffmpeg, ProRes fixtures generated with `prores_ks`),
`test/prores-native-decode-electron.test.ts` (`pnpm --filter @openreel/desktop test:prores-e2e`, needs a
`VITE_OPENREEL_E2E=1` build).
