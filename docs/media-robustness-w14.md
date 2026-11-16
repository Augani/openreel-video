# Media robustness and workspace basics (w14)

## Native decode persistence and relink
`MediaItem.nativeSource` is saved with the project for files WebCodecs cannot decode (ProRes, DNxHD...). On
desktop `native-path-hydration.ts` re-registers each restored Blob's path with the native decoder and checks the
file is still there; a moved file becomes an offline placeholder and the normal relink controls apply. See
`apps/desktop/NATIVE_DECODE.md`.

## Rotation
Rotation metadata (display matrix / `rotate` tag) is honoured as clockwise degrees: WebCodecs via mediabunny's
CanvasSink and `VideoSample.draw`, native decode via explicit ffmpeg transpose/flip filters with autorotate off.
Probe sizes are upright, so preview, thumbnails and export agree. Spec: `apps/web/e2e/rotation.spec.ts`,
`apps/desktop/test/native-decode.test.ts` (real ffmpeg, compared with ffmpeg's own autorotated decode).

## Dock workspaces
`stores/workspace-layout-store.ts` owns the dock geometry (media/inspector/chat widths, timeline height) plus the
asset section and mixer/chat visibility. Built-ins: Editing, Color, Audio. Window > Workspaces switches,
Window > Save as new workspace... captures the current layout, Reset / Update / Delete manage them. Persisted in the
profile's localStorage (`openreel-workspaces`). Spec: `apps/web/e2e/workspaces.spec.ts`.

## Project file locking (desktop)
`apps/desktop/src/main/project-lock.ts`: `.<name>.lock` beside the project, owner = app instance + window,
5 s heartbeat, stale when the process is gone (same machine) or the heartbeat stopped (45 s, other machine).
Held elsewhere => the project opens read-only: `LazyActionExecutor` refuses edit/undo/redo (`READ_ONLY`),
saving over the file is refused, a banner offers Retry and Save a copy. Read-only filesystems (no lock possible)
open editable as before. Tests: `test/project-lock.test.ts`, `test/project-lock-processes.test.ts` (two real
processes), `src/services/project-lock.test.ts`.
