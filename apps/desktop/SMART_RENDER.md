# Native smart render (desktop)

Exports that run on the ffmpeg sidecar (`encodeMode: "smallest"`, 10-bit / non-4:2:0, AV1 and ProRes always do) stream-copy
the untouched, GOP-aligned spans of the sources and re-encode only what was touched. The planner is the same pure code the
browser uses (`packages/core/src/export/smart-render.ts`, `engine: "native"`); the muxer is `src/main/sidecar/smart-export.ts`.

## What gets copied

| Source | Copied when |
| --- | --- |
| H.264 | export codec H.264, MP4/MOV, same size and frame rate, 8-bit 4:2:0 Baseline/Main/High, closed GOPs, constant frame rate, not rotated, not full range, BT.709/BT.601/untagged colour |
| HEVC | export codec H.265 (`hvc1`), Main 8-bit 4:2:0, same rules |
| ProRes | export codec ProRes into MOV, source ProRes 422 (Proxy / LT / Standard / HQ) whose profile equals the export profile, 4:2:2 10-bit, SDR. All-intra: every frame is a cut point, so the copy runs right up to the edit (no GOP rounding). The renderer scans the packet index (Mediabunny lists ProRes packets and names the profile from the sample-entry fourcc). ProRes 4444 / 4444 XQ sources are declined (the encoder writes 4:2:2) |

Never copied: any clip with effects, colour grading, transform/crop/opacity, blend mode, keyframes, speed/reverse/ramps/freeze,
stabilisation, chroma key, masks, particles, transitions, nested sequences, or with text/shape/sticker/adjustment/motion items
or captions over it. Frames under those are re-rendered, and so are the partial GOPs on either side. Proxies are never read: the
plan and the copy use the full-resolution item. Multicam cuts are ordinary clips; a cut inside a GOP re-encodes that GOP.

## Pipeline

```
renderer                         main (ffmpeg sidecar)
plan (planSmartRender)           
prepare: probeSource(file) ----> ffmpeg -frames:v 1 -vf showinfo   (real pixel format + colour tags; may decline)
copyRun  ----------------------> ffmpeg -copyts -ss K -i src -c copy -frames:v N -f mpegts   -> appended to video.ts
frames (RGBA) between endRun --> ffmpeg rawvideo -> libx264/x265/VideoToolbox (source profile/level/colour) -> mpegts -> video.ts
finish   ----------------------> ffmpeg -i video.ts -i audio.wav -c:v copy -c:a aac -video_track_timescale N out.mp4
```

* Every run is MPEG-TS with `-output_ts_offset` pinning its first frame to the output frame grid (exact rationals: 29.97 is
  30000/1001), so a byte-wise append is a valid, gap-free, duplicate-free concatenation. TS carries SPS/PPS in-band at every
  key frame, so runs whose parameter sets differ from the camera's join without a decoder reset problem.
* The re-encoded runs convert RGB to YUV with the source's matrix (BT.709 for untagged HD) in limited range and carry the
  source's colour tags, so a copy/encode boundary does not shift colour.
* Audio is always re-rendered from the mixdown and encoded once in the final pass.
* If the sources cannot be matched (10-bit, 4:2:2, full range, HDR, different colour tags between sources, a file ffmpeg cannot
  read) the plan is declined and the export is a normal full re-encode; the reason is in the job's smart-render report
  (`Smart render: 0% copied (reason)`), the export queue row and `list_export_jobs`.
* ProRes cannot ride in MPEG-TS, so a ProRes job writes one MOV per run (`<tmp>.run<N>.mov`; copy runs are `-c copy` with
  `-ss` half a frame past the wanted frame and `-avoid_negative_ts make_zero`, re-encoded runs use the export's ProRes
  encoder and profile) and the final pass joins them with the concat demuxer (`-f concat -c:v copy`) next to the audio.
* Sources are read in place when they came from a picked or dropped file (`webUtils.getPathForFile`); an in-memory Blob is
  copied once to an app temp file for the export and deleted after. A file that no longer matches the imported Blob is
  staged instead (see below).

## Changed-source guard

The plan is made from the Blob the project imported; ffmpeg copies from the file on disk. Every copy run is checked
(`src/main/sidecar/source-guard.ts`, fingerprint rule in `packages/core/src/export/source-fingerprint.ts`):

1. size equals the Blob's size,
2. modification time equals the File's `lastModified` (2 s tolerance; not checked for a temp copy of an in-memory Blob),
3. SHA-256 of the first and last 64 KiB equals the Blob's (whole file when it is under 128 KiB),
4. a key frame really sits at the copy start (`ffmpeg -skip_frame nokey -ss <start> -vf showinfo`, one decoded frame), so a
   file with a different GOP structure or key frame index cannot be cut at the plan's times.

Any miss throws `SOURCE_CHANGED: <path>: <reason>`; the renderer then stages a temp copy of the Blob and retries once. A
change in the unsampled middle of the file with identical size, mtime and key frame index is not detected (it would need a
full read of the source, which defeats the point of a stream copy).

## Output tags

HEVC is always written as `hvc1` (`-tag:v hvc1` on the final pass, also when every run is a stream copy of an `hev1`
source) so QuickTime/Safari play it; `export-check --only smart-hevc` and `smart-render-sources.integration.test.ts` assert
`codec_tag_string == hvc1` for MP4 and MOV.

## Declined sources (reported, never silent)

10-bit, 4:2:2 / 4:4:4, HDR (PQ / HLG), BT.2020 and full-range sources are not copied. The export is a normal full re-encode
and the report (`Smart render: 0% copied`, the export queue row, `list_export_jobs`) names the format, e.g.
`clip.mov: source is 10-bit (HEVC Main 10); smart render copies 8-bit 4:2:0 SDR sources only`. The planner reads the
profile from the stream (Main 10, High 10, High 4:2:2, range extensions) and the colour tags it can see; the ffmpeg probe
at export time (`nativeProbeMismatch`) catches what only the SPS says: pixel format (`10-bit 4:2:2`), PQ/HLG transfer.

## Checking it

* `pnpm --filter @openreel/desktop test:run` (`smart-export.integration.test.ts` runs the whole join on real ffmpeg for BT.709,
  BT.601 and HEVC sources).
* `smart-render-sources.integration.test.ts` (real ffmpeg): ProRes join with `prores_ks` and VideoToolbox, copy-only ProRes
  is the source's packets, the guard (mtime, tail hash, truncation, wrong key frame), hvc1 on a copied `hev1` stream,
  10-bit / 4:2:2 / HDR probe messages. `packages/core/src/export/smart-render-real-sources.test.ts` scans and plans real files.
* `node scripts/export-check.mjs --only smart,smart-hevc,smart-prores,smart-decline` in real Electron: exports a lightly edited timeline with and without
  smart render and asserts frame count, first pts, frame spacing, strictly increasing DTS, key frames at the run starts, decode
  and seek decodes, bit-exact copied frames and PSNR of re-encoded frames against the full re-encode.
* CI: `.github/workflows/desktop-readiness.yml`, job `suites` (macOS), runs all of the above plus the Electron and ingest
  suites; it sets `OPENREEL_REQUIRE_SIDECAR=1` so a missing sidecar fails instead of skipping the real-ffmpeg tests.
* `node scripts/export-check.mjs --only smart-timing --minutes 10` times a 10-minute 1280x720 timeline.
