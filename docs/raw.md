# Camera RAW

OpenReel imports camera RAW stills and CinemaDNG sequences, develops them with an editable set of RAW Source Settings, and renders them identically in the preview and in export.

## What is supported

| Format | Web | Desktop | How |
| --- | --- | --- | --- |
| DNG (Adobe Digital Negative) stills | yes | yes | Decoded and developed by OpenReel (`packages/core/src/raw/`). RAW Source Settings apply. |
| CinemaDNG sequences (numbered `.dng` frames) | yes (needs WebCodecs H.264 encode) | yes | Every frame is developed with one set of settings and baked into an MP4 that imports as ordinary video. |
| CR2, CR3 (Canon), NEF/NRW (Nikon), ARW/SRF/SR2 (Sony), RAF (Fujifilm), ORF (Olympus), RW2 (Panasonic), PEF (Pentax), SRW (Samsung), 3FR/FFF (Hasselblad), IIQ (Phase One) | no, refused with "convert to DNG" | macOS only | Developed by Apple ImageIO through `sips` into a PNG. Apple's engine chooses white balance and tone; RAW Source Settings cannot change it. |
| BRAW (Blackmagic RAW) | no | no | Needs Blackmagic's proprietary SDK. |
| R3D (RED) | no | no | Needs RED's proprietary SDK. |
| ARRIRAW (.ari, .arx) | no | no | Needs ARRI's proprietary SDK. |

### Why the proprietary formats are not decoded by OpenReel

The investigation (what is realistically available):

- **LibRaw / dcraw to WASM.** No LibRaw or dcraw package is in `node_modules`, and no maintained, well-known WASM build was vendored. LibRaw is LGPL/CDDL and a WASM build is a large dependency (several MB) whose per-camera support tables change every release, so it was not added here. This is the one change that would add CR2/CR3/NEF/ARW/RAF/ORF/RW2 support on web and Windows/Linux desktop.
- **ffmpeg.** Its `dng`/`tiff` support does not demosaic a CFA DNG (it exposes the mosaic as gray or a pre-rendered thumbnail), and it has no decoders for the vendor stills. It was not used.
- **macOS ImageIO / `sips`.** Reads the vendor stills and gives a developed image. It is used on desktop macOS for the proprietary stills (above). It cannot be driven with OpenReel's settings, so those items are flagged "developed by macOS" and the dialog explains why the controls are unavailable. ImageIO also rejected the synthetic DNGs the tests generate, so the macOS path was verified only with a plain image through the real `sips` handler (see Verification).
- **DNG is an open specification**, so a TypeScript reader plus demosaic works the same on every platform. That is what OpenReel ships.
- **BRAW / R3D / ARRIRAW** are only decodable with the vendors' closed SDKs, which cannot be redistributed in a web build.

Camera makers that offer a DNG export (Adobe DNG Converter is free; many cameras shoot DNG directly; Resolve and REDCINE-X export CinemaDNG) work everywhere.

### DNG coverage

Supported: 2x2 Bayer CFA (all four layouts) and LinearRaw (3 samples per pixel); uncompressed 8 to 16 bit (bit-packed 10/12/14 included) and lossless JPEG (compression 7, predictors 1 to 7, 1 to 4 components); strips and tiles; LinearizationTable; ActiveArea and DefaultCrop; TIFF orientation; ColorMatrix1/2, ForwardMatrix1/2, CameraCalibration1/2, AnalogBalance, AsShotNeutral, AsShotWhiteXY, CalibrationIlluminant1/2, BaselineExposure, black and white levels per CFA cell.

Refused with a specific message (never silently wrong): lossy JPEG and deflate DNG (compression 34892 / 8), floating-point DNG, X-Trans (6x6) and other non-2x2 CFAs, four-colour sensors, predictor-coded data, point-transformed lossless JPEG. Not applied: DNG opcode lists (lens corrections), noise profiles, profile tone curves / LookTables, per-camera "baseline tone curve".

## Pipeline

`packages/core/src/raw/develop.ts`, streamed through a 5-row window (no full float image, so 60 MP files fit):

1. Black subtract, normalise to the white level, white balance (temperature and tint go through the DNG colour model: the colour matrices are interpolated by illuminant temperature in inverse kelvin, exactly as the DNG specification describes).
2. Demosaic: **Draft** (2x2 binning to half resolution), **Standard** (bilinear), **High** (Malvar-He-Cutler gradient-corrected).
3. Highlight recovery, part 1: pixels near the sensor clip point are pulled toward the brightest channel so clipped highlights go neutral instead of magenta.
4. Camera RGB to XYZ (D50) to linear primaries of the output space (sRGB/Rec.709, Display P3 or Rec.2020), Bradford adapted.
5. Exposure gain `2^(exposure + BaselineExposure)` in linear light. `developRawLinear` stops here and returns unbounded scene-linear Float32.
6. Highlight recovery, part 2: hue-preserving exponential shoulder, knee 1.0 (hard clip) at 0 % down to 0.6 at 100 %.
7. sRGB OETF to 8-bit.

Images larger than 6144 px on the long edge are box-downscaled by an integer factor (`DEFAULT_MAX_LONG_EDGE`) so memory stays bounded; the same cap applies in preview and export.

## RAW Source Settings

`MediaItem.raw.settings` holds:

| Setting | Range | Notes |
| --- | --- | --- |
| Temperature | 2000 to 25000 K | Describes the assumed illuminant (higher = warmer picture), like Lightroom. Defaults to the camera's as-shot white balance. |
| Tint | -150 to +150 | Positive pushes the picture toward magenta. |
| Exposure | -5 to +5 EV | On top of the file's BaselineExposure. |
| Highlight recovery | 0 to 100 % | See pipeline steps 3 and 6. |
| Demosaic | Draft / Standard / High | |
| Output colour space | sRGB / Display P3 / Rec.2020 | Primaries of the developed image (sRGB transfer). |

Where to find them: Project panel > media context menu or actions menu > **RAW Source Settings…** (items with a RAW badge), and Inspector > Color tab > **RAW Source** for a selected clip. The dialog previews with the draft values while you drag; **Apply** commits every change as **one undoable step** (`media/organize` with `itemPatches[id].rawSettings`, label "RAW Source Settings"). The same action is available to agent tools. Undo/redo also refresh the library thumbnail (`services/raw-thumbnails.ts`).

## Integration

- **Import** (`apps/web/src/services/raw-import.ts`, `stores/project/media-slice.ts`): any file picker, drop or timeline drop. The camera file is kept as the item's blob (stored in IndexedDB like any media). The library shows a **RAW** badge.
- **Rendering**: every image consumer calls `createMediaImageBitmap(item)` (Preview scrub and playback, `VideoEngine` for export and frame rendering, the Source monitor, motion tracking). It develops from the stored settings and caches per settings, so a settings change cannot serve stale pixels, and the preview and the exporter call the same function and get the same bytes. Development runs in a Web Worker (`workers/raw-develop.worker.ts`); without Worker support it runs in-thread.
- **Colour pipeline**: the developed image is tagged through `inputSpaceForItem` with the primaries of the chosen output space (sRGB transfer), so the existing input transform converts Display P3 / Rec.2020 RAW into the working image in preview and export. `developRawLinear` exposes the scene-linear Float32 result.
- **Proxies / thumbnails**: stills need no proxy. The library thumbnail is a 320 px draft development made at import and refreshed whenever the settings change.
- **CinemaDNG** (`services/cinemadng-sequence.ts`): numbered `.dng` files imported together (`name_000001.dng`, ...) are grouped (`groupCinemaDng`); a group is baked only when its first frame carries the CinemaDNG FrameRate or TimeCodes tag (`looksLikeCinemaDngFrame`), so numbered photos from a stills camera (`IMG_0001.dng`, ...) stay editable stills. Sequences are developed as shot, and baked into one MP4 at the file's frame rate tag (default 24 fps), capped at 3840 px. The settings are fixed at import (the dialog shows them read-only); to change the look, import the frames again.

## Performance

Measured once under Node (vitest) on this Mac for a 6000 x 4000 (24 MP) 14-bit mosaic, single thread: decode of uncompressed packed data 0.11 s; develop Draft 0.31 s (3000 x 2000), Standard 0.80 s, High 1.01 s. Lossless-JPEG decode and 45 MP+ files were not timed. In the browser the work happens in a worker, and each distinct settings value is developed once (then cached for preview, playback and export).

## Known gaps

See `docs/known-limitations.md` (Camera RAW).

## Verification

- `packages/core/src/raw/raw.test.ts`, `raw-actions.test.ts`: synthetic DNGs with known Bayer patterns, decoded and compared numerically (storage layouts sample-exact; flat chart patches recover known linear sRGB to within 0.02 with a ForwardMatrix and within 0.05 relative to white without; neutrals equal to 0.01; exposure doubles per stop to 5 digits; all four CFA layouts agree; demosaic error on smooth gradients; orientation; determinism; one-undo-step settings action).
- `apps/web/src/services/raw-import.test.ts`: import behaviour.
- `apps/desktop/test/raw-still-integration.test.ts`: the `sips` handler.
- `apps/web/e2e/raw-import.spec.ts`: import, RAW badge, dialog, one undo step, preview vs `VideoEngine.renderFrame`, CinemaDNG bake, refused formats.
