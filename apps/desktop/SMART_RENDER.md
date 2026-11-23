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

## Smart cut and merged razor cuts

* **Partial GOP before an edit (H.264 / HEVC).** A copy used to stop at the last key frame before an edit and re-encode the
  rest of that GOP. Now `prepareSmartRender` asks ffmpeg for the picture types of that GOP (`probeGopTypes`: decode from the
  key frame, `showinfo`, display order) and `cleanTailFrames` / `extendCopyTails` (core, pure) lengthen the copy to the last
  anchor (I or P) frame before the edit. Cutting a GOP after an anchor is clean: every B-frame before an anchor references only
  that anchor or earlier frames, so the kept frames are a prefix in both display and decode order and `-frames:v N` copies exactly
  them. Only the frames after that anchor (at most the B-frames before the edit, plus nothing after it) are re-encoded.
  The head side of an edit cannot be cut mid-GOP (the copy would start on a frame without its references), so a copy still
  starts at the first key frame after the edit and the frames in between are re-encoded.
* **Razor cuts that change nothing.** Two untouched clips on one track that play the same source back to back (same
  timeline-to-source offset) are merged by the planner into one copy, so a cut in the middle of a GOP no longer re-encodes that
  GOP. A ripple delete (different offset) or a transition at the cut is not merged.
* **Report.** `SmartRenderReport` and the queue job carry `copiedSeconds` / `encodedSeconds`; the queue row reads
  `Smart render: 83% copied (99.6 s copied, 20.4 s re-encoded)`. The export dialog has a "Smart render when possible" switch
  (on by default, remembered per browser/profile); off sends `smartRender: false`.
* **Audio** is copied where it can be exact (see "Audio copy" below) and otherwise rendered from the mixdown and encoded once in the
  final pass (the video never waits for it and is never re-encoded because of it).
* **Multichannel audio and channel maps.** Because smart render only ever copies picture, a clip's channel map, audio stream
  (`audioTrackIndex`) or source-patch slot cannot change the video plan and cannot be lost by a copy. The audio plan agrees: a clip with a
  channel map, an alternate stream or an import channel preset is "touched", so any project with channel-patched sound clips is rendered by
  the same mixdown as a full re-encode (it is copied only when one untouched clip is the source's first stream). The plan does not decline for them. The sound clips of a video source placed on audio
  tracks (multichannel patching, an audio-only patch) are fully transparent; they are ignored as picture, so they neither cover
  nor block the clip that really shows the frames. Verified in Electron (`node scripts/export-check.mjs --only smart-multichannel`):
  a 4-channel H.264/PCM MOV added with Add to timeline (picture + four mono channel clips), two channels deleted, an effect on
  the middle; smart and full export both carry exactly the two kept tones in every window, the smart export copies the untouched GOPs.

## Audio copy

The audio plan (`packages/core/src/export/smart-render-audio.ts`, pure) runs after the video plan, only when the native smart render is
active. It copies where the mixer leaves the source alone and decides everything else is rendered:

| Export audio | Copied when |
| --- | --- |
| AAC (H.264 / HEVC into MP4 / MOV) | one untouched AAC-LC source (1024-sample frames) is the audio of the **whole** export, same sample rate, stereo, source bitrate not above the export's, and both cut points sit on the source's own frame grid |
| PCM (ProRes MOV masters, 24-bit) | any span where one untouched 16- or 24-bit PCM source (WAV, MOV `lpcm`) plays alone; the other spans come from the rendered mixdown |

"Untouched" is a whitelist: clip volume 1, no fade, effects, audio keyframes or automation, speed 1 and not reversed, no channel
mapping or ducking, no transition, normal track (no rack, plug-ins, sends, bus output, automation, solo), no master rack, no buses, no
nested sequence, no loudness target, no Dolby audio, no other audible clip over the span. The clip must start on a whole sample and the
source must start at time 0. Anything the mixer gains later is therefore rendered, not copied.

* **AAC mechanics** (`src/main/sidecar/smart-audio.ts`). A copy that starts at the source's first sample is its own packet sequence,
  edit-list delay included. A copy that starts later needs the packet before the cut as decoder pre-roll (an AAC frame overlaps the
  previous one): the output carries that frame as 1024 samples of encoder delay, which the MP4 muxer writes into the edit list. The
  movie timescale is the sample rate so the edit list is exact to the sample. A cut must start on a frame of the source's own grid
  (packet `i` starts at `i * 1024 - encoderDelay`, so a source with Apple's 2112 samples of delay has a different grid) and end on one,
  because ffmpeg and most decoders ignore a trim inside the last frame; any other cut is re-encoded. AAC is never joined with rendered
  AAC (the seam would not be seamless), so it is copied for the whole export or not at all.
* **Proof before use.** `begin` (right after the job starts, before any frame is encoded) writes the AAC packets and, for a cut inside
  the stream, decodes the copy and the same window of the source and compares them. A stream whose decoder carries state beyond the previous
  frame (noise substitution, prediction) fails the comparison and the audio is rendered instead. A copy from the first sample cannot differ.
* **PCM mechanics.** Each copied span is extracted by sample count (`atrim=start_sample`, not a time seek, whose rounding differs between
  ffmpeg versions) to raw 24-bit; 16-bit sources are exactly their samples shifted into the top of the word, the same conversion the full render
  applies to its 16-bit mixdown. The final track is the spans in order, copied ones from those files and rendered ones from the mixdown WAV.
  The mixdown skips the 15-second chunks that lie entirely inside copied spans.
* **Report.** `stats.smartRender.audio` and the queue job carry `audioCopiedSeconds` / `audioEncodedSeconds` and the mode
  (`whole`, `spans`, `none`) with the reasons; the queue row adds `audio 8.0 s copied, 0.0 s encoded`.
* ProRes smart exports now write 24-bit PCM audio like the normal ProRes export (they used to get AAC).
* Not copied: mono sources or exports, 5.1, a different sample rate (a copy cannot resample), HE-AAC, MP3, Opus, float or 32-bit PCM, an
  audio stream that does not start at the file start, and source files whose audio the planner cannot probe.

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
* Audio is copied (AAC packets, PCM spans) or re-rendered from the mixdown and encoded once in the final pass; see "Audio copy".
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
* `smart-render-audio.integration.test.ts` (real ffmpeg): AAC whole copy and mid-stream copy with pre-roll are bit-identical to the source
  decode and as long as a full render, with the same stream start and packet times; a 2112-sample encoder delay; a noise-substitution stream
  declined mid-stream; PCM spans joined with a rendered mixdown are bit-identical to the full render of the same mixdown and a 24-bit source
  keeps its 24 bits. `packages/core/src/export/smart-render-audio.test.ts` covers the planner.
* `node scripts/export-check.mjs --only smart-timing --minutes 10` times a 10-minute 1280x720 timeline.
* `node scripts/export-check.mjs --only smart-4k` times a 2-minute 3840x2160 H.264 timeline (three razor cuts, one effect) with and
  without smart render and runs the frame-accuracy assertions on the result; `smart-render-tail.integration.test.ts` checks the partial-GOP copy.
