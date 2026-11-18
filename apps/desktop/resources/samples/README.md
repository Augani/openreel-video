# Practice clips (Learn path)

Three short video clips and one music track used by the first-run "Learn to edit" path. They are served to the
renderer over the `openreel:samples:list` / `openreel:samples:get` IPC channels (`src/main/ipc/samples.ts`) and
shipped as electron-builder `extraResources` (`samples/`), never inside the renderer bundle.

## Provenance and license

Everything here is original and generated locally with ffmpeg `lavfi` sources by
`scripts/generate-samples.mjs` (gradients, mandelbrot, life, and summed sine waves). Nothing was downloaded.
License: CC0-1.0. Total size is about 5 MB.

| id | what | length |
|---|---|---|
| `practice-aurora` | slow colour gradients, 1280x720 25 fps H.264 | 6 s |
| `practice-fractal` | Mandelbrot zoom, 1280x720 25 fps H.264 | 6 s |
| `practice-cells` | cellular automaton, 1280x720 25 fps H.264 | 6 s |
| `practice-music` | soft chord pad over a slow pulse, 96 kbps MP3 | 20 s |

Regenerate with `node apps/desktop/scripts/generate-samples.mjs` (needs `ffmpeg` and `ffprobe` on PATH, or
`FFMPEG` / `FFPROBE`). The `drawtext` filter is not required.

## Replacing them with real footage

Drop files in this folder and list them in `manifest.json` (`id`, `name`, `kind` video|audio, `file`,
`mimeType`, `durationSec`, `sizeBytes`, optional `width`/`height`, `license`). The lessons work with any
footage. If the pack is removed (for example while licensing is being cleared), the Learn sheet offers
"Use my own clip" only.
