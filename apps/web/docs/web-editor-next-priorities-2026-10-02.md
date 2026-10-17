# OpenReel next priorities: implementation and verification

Screenshots, test footage, and local QA evidence are retained outside Git; this report records their findings and validation limits.

Completed locally on October 2, 2026, following the [initial editor review](web-editor-review-2026-10-02.md). This pass implements preview proxies, a shorter selected-clip editing flow, a responsive workspace, and safer browser export delivery. Deployed to [app.openreel.video](https://app.openreel.video) on October 3, 2026. The live HTML and entry JavaScript match the verified production build, isolation headers are present, and the live editor opens successfully.

## What changed

| Priority | Delivered behavior |
| --- | --- |
| Preview performance | Selected video assets offer 540p, 720p, and 1080p proxy generation, progress, cancellation, cache usage, and an original/proxy toggle. Proxies are capped at source dimensions, queued one at a time, and held in a bounded 256 MB tab cache. Playback can use the smaller video; audio and export retain originals. Failed generation falls back to the original. The software fallback cancels loader downloads and releases its core/wasm Blob URLs on success, failure, and cancellation. |
| Common editing tasks | A selected media clip exposes Split here, Trim start, Trim end, Add captions, Clean audio, Reframe, and Export. Trim and split respect the project frame rate and track locks, pause playback, and form one undo step. Caption and reframe shortcuts open the existing relevant inspector section. Audio-only clips can reach caption tools. |
| Phone and tablet workspace | Compact layouts keep the preview visible and switch between Timeline, Media, Edit, and AI. Panels stay mounted to preserve state. Touch controls use larger targets, timeline clips have a move grip and trim handles, and the ruler accepts touch scrubbing. Access depends on browser capabilities rather than device names or screen width. |
| Browser export | Download to this device is the default, with choosing a file location still available. Unsupported codec/container combinations, unavailable encoders, and missing originals receive actionable errors. Native-only export fallback requires explicit acknowledgement and produces an accurately named MP4. Cancellation, failed writes, generator cleanup, and temporary-file cleanup are covered by regressions. |

Integration defects were fixed during verification. Project edits previously cloned immutable media blobs, invalidating a generated proxy after timeline changes; edit cloning now preserves media identity while copying editable data. Trim-to-playhead previously lacked a complete inverse action; undo now restores source and timeline bounds, including linked captions in the same history group. Explicit frame rates in new-project links also take precedence over matching canvas presets. Proxy controls now appear below the media grid so selecting a thumbnail does not move it during a double-click. Common-action buttons adapt their column count to keep labels readable in narrow inspectors. The WAV shortcut now shares cancellation and operation locking with video export, including generator cleanup before a retry.

Opening the editor directly now waits for the recovery check and creates a real open project when the user starts fresh. This enables autosave and proxy generation for that entry path. Recovering an existing project retains it, and an explicit new-project link preserves its requested dimensions and frame rate after the recovery choice. Saved recovery snapshots are preserved.

## Browser flow evidence

The source footage is synthetic local test media. These screenshots were captured and inspected in the production preview. Viewport checks establish layout behavior; they do not establish physical-device readiness or full accessibility compliance.

1. **Import and choose a preview proxy — healthy in the tested path.** A 1920×1080, 24 fps source generated a 960×540 preview copy of approximately 0.2 MB. Adding and duplicating timeline clips, then undoing, preserved the proxy. The subsequent export retained the source resolution. Final browser checks also confirmed first-double-click insertion and completed proxy generation after opening the editor directly and choosing Start Fresh. The cache is temporary and regenerates after a reload.

2. **Edit on a phone-sized viewport — healthy for the inspected actions.** At 390×844, the preview remained visible while Timeline and Edit tabs exposed their tools. Common editing actions remained reachable. The caption shortcut opened and focused the local caption section. A transcription model was not downloaded, so generated captions and their exported appearance remain unverified.

3. **Trim and undo on a tablet-sized viewport — healthy in the tested path.** At 820×1180, selecting the clip and trimming its end at the one-second playhead reduced its duration from two seconds to one. Undo restored the two-second clip. Pointer cancellation and touch movement have automated regression coverage; no physical touchscreen was available.

4. **Export a finished file — healthy for three tested combinations.** The editor delivered actual MP4 and WebM downloads. Each downloaded file passed codec, dimensions, frame rate, duration, required audio-stream, and full-file decode checks. Decoded MP4 frames were also inspected visually. These checks do not establish perceptual audio/video synchronization or cross-browser codec parity.

| Browser surface | Actual downloaded output | Result and evidence |
| --- | --- | --- |
| Codex in-app browser | H.264/AAC MP4, 1920×1080, 24 fps, 2 seconds of video; 540p proxy enabled | Passed original-resolution validation (local QA evidence). |
| Codex in-app browser | VP9/Opus WebM, 640×360, 24 fps, approximately 2 seconds | Passed WebM validation (local QA evidence). |
| Chrome | H.264/AAC MP4, 360×640, 60 fps, 2 seconds of video | Passed portrait validation (local QA evidence). |

The [export validation guide](browser-export-validation.md) documents repeatable synthetic fixtures and verification commands. The connected browser surfaces are both Chromium-based. Safari and Firefox, long projects, mixed edits with titles/effects/captions, and the native file-picker delivery path still need real-browser checks.

## Validation and performance limits

The final full web suite passes 1,042 tests across 190 files, with 7 skipped. The final full core suite passes 1,315 tests across 171 files, with 20 skipped. The production build and web/core TypeScript checks pass. Scoped lint reports no errors; six existing hook-dependency warnings in the inspector and five existing empty-block warnings in the FFmpeg fallback remain. Whitespace checks pass. The verification summary (local QA evidence) records the final counts and completed-download checks.

The proxy check proves that preview video can be reduced from 1920×1080 to 960×540 while export retains the original resolution. It does not measure playback FPS, Core Web Vitals, or device memory. The production build still reports large chunks; this pass adds functionality and makes no additional bundle-size improvement claim.

## Remaining major priorities

1. Complete the export matrix on Safari, Firefox, and physical mobile devices, including long projects, cancellation, titles, effects, generated captions, and audio/video synchronization.
2. Add portable project packages and clear storage usage, missing-media recovery, and browser-storage eviction guidance.
3. Measure preview pressure across the separate playback paths before implementing adaptive resolution. Current Auto quality still chooses from dimensions; static proxy generation is available now.
4. Extend the existing caption/transcription workflow into source-linked transcript editing and searchable footage, with clear model-download costs, progress, cancellation, and reversible edits.
5. Review core import boundaries and load fonts on demand to reduce startup downloads, then validate gains with real browser traces.
