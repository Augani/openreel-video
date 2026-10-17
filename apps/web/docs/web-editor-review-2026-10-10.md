# OpenReel web editor review and improvements

Screenshots, test footage, and local QA evidence are retained outside Git; this report records their findings and validation limits.

Reviewed, implemented, verified, and deployed on October 10, 2026. This pass covers everyday editing, longer projects, and social videos. OpenReel already exposes many editing tools; the most valuable gaps in this review were dependable project portability, precise navigation, efficient caption correction, and agreement between preview and export.

The improvements are live at [app.openreel.video](https://app.openreel.video/#/editor). Production deployment: [0c57a7ca](https://0c57a7ca.openreel-3pq.pages.dev), branch `main`. Public HTML and the JavaScript entry match the tested build, and the required cross-origin isolation headers are present.

## Delivered improvements

| Workflow | Change | Practical result |
| --- | --- | --- |
| Save and resume | Project backups in the project menu | Download an `.oreelpack` containing the editable project and original video, image, and audio blobs. Open it as an independent copy in another browser origin. |
| Longer projects | Binary media packaging and disk delivery | Originals remain Blob references and slices rather than base64 strings or one large JavaScript buffer. Choosing a file location streams the package to disk. |
| Precise editing | Editable frame timecode | Seek using HH:MM:SS:FF, shorter timecodes, or seconds. Up/Down step one frame; Shift steps ten. Fractional frame rates use non-drop-frame labels. |
| Review a section | Visible In and Out controls | Mark, drag, nudge, and clear a preview range. The selected band is visible on the ruler. Existing I/O and loop shortcuts remain available. These controls select a preview loop and the section offered by Marked In/Out in the export dialog. |
| Caption correction | Search and batch replacement | Literal matching, case sensitivity, Unicode whole-word matching, selected/all scope, match counts, and one undo group. Timing and styling remain intact; locked tracks are skipped. |
| Large caption sets | Paged caption list | At most 50 caption editors are mounted per page. Search still reaches the entire caption set, and cue buttons seek directly to their start frames. |
| Caption export | Correct caption track placement | New caption tracks are created above footage. Older projects expose an undoable “Bring caption tracks to front” repair. New cues honor Top, Center, and Bottom placement. |
| Startup and typography | Fonts loaded on demand | The initial Google Fonts stylesheet requests three families instead of 56. Selected/project fonts load when needed; export waits for them. Paused previews and motion frame caches refresh after font loading. |
| Smaller screens | Compact header and preview controls | The compact header uses the project menu instead of displaying two project-name controls. Preview tools wrap and the preview receives more space. |

Backup restoration saves current work first, checks available storage, assigns new project/media identifiers, and persists media before switching projects. Failed restores remove newly written media and retain the current project. Imported copies detach the previous save handle so Save cannot overwrite the previously opened file. Custom uploaded fonts must be installed in the destination browser; they are not embedded in this package format.

The review also fixed a caption-input crash caused by reading `event.currentTarget` inside a deferred state update, an SRT file-control problem, and track reordering that mutated the old track-array reference. Caption drafts now survive edits to other cues.

## Browser workflow evidence

All screenshots below belong to this review run. Inputs were synthetic H.264/AAC footage at 640×360 and 24 fps, lasting two seconds, and a Portuguese SRT. The production export retained the 640×360 project size and used the project rate of 30 fps. Development and production browser origins were checked separately. Existing saved projects were preserved.

1. **Start and choose a format — healthy.** The welcome screen exposes landscape, portrait, and square formats. Secondary explanatory text is small and still warrants a contrast/readability review.

2. **Import and select footage — healthy in the tested path.** The source imported, was inserted through its thumbnail, and rendered in the preview. Selecting it exposed trim, captions, audio cleanup, and reframing actions. The large inspector remains a discoverability challenge for first-time users.

3. **Seek and mark a section — improved and verified.** A typed 15-frame timecode at 30 fps moved to 0.5 seconds. In and Out marks selected 0.5–1.5 seconds and produced visible ruler handles. Keyboard navigation is regression-tested. Physical touch dragging remains unverified.

4. **Back up and reopen — fixed and verified.** The browser delivered a 217,565-byte project package containing the 214,487-byte original video. Extracted bytes exactly matched the input. The production browser origin opened the package as a copy, restored footage, and reset the playhead and preview range. JSON project downloads remain metadata-oriented; the backup menu provides the media-inclusive workflow.

Package verification (local QA evidence) records byte equality and settings. Regression tests cover corrupt/truncated packages, missing originals, cancellation, storage failures, rollback, and independent copy identifiers.

5. **Import and correct captions — fixed and verified.** The SRT created three editable text cues. Replacing “edição” with “montagem” changed two cues, and one Undo restored both; Redo reapplied them. The browser check found that legacy caption tracks were below footage: preview showed captions, while the initial exported frames did not. The repair moved the caption track above footage and updated the visible timeline order.

6. **Export a finished video — verified for this Chromium workflow.** The repaired downloaded MP4 contains H.264 video at 640×360, 30 fps, 60 frames, and AAC audio. Full-file decoding passed. Decoded frames visibly contain the corrected caption. The AAC stream has encoder padding beyond the two-second video; these checks do not establish perceptual audio/video synchronization.

Export verification (local QA evidence) contains codec, dimensions, frame rate, duration, and decode results. Downloaded test video (local QA evidence).

7. **Use a compact workspace — reviewed at a phone breakpoint.** The 390×844 layout retains preview and Timeline/Media/Edit/AI navigation. Header overlap and clipped preview controls were corrected. Screenshot checks establish layout behavior, not physical-device readiness or full accessibility compliance.

## Verification

The current working tree, including the next range-export increment, passes 1,129 web tests across 202 files, with seven skipped, and 1,350 core tests across 174 files, with 20 skipped. The deployed audio/browser release passed 1,127 web tests and 1,342 core tests before that increment. Web and core TypeScript checks pass. The production build passes; it still reports large JavaScript chunks. Scoped checks for the new services, controls, and caption placement report no lint errors. Existing hook/type warnings remain in larger inspected components. Preview follow-up checks pass 37 tests across four files.

The 56-to-three font-family change is a stylesheet request reduction, not a measured startup-time, FPS, or memory benchmark. The backup tests prove originals are not read into whole-file JavaScript buffers; they do not establish a maximum practical project size on real devices.

## Release verification follow-up

The user authorized testing Downloads footage and deploying once checks passed. Media tests ran locally. The live smoke test used synthetic colour-bar footage; no Downloads videos are included in the deployed assets.

- **Longer project:** Imported a 577.3-second, 3840×2160/60 fps source and edited it in a 1920×1080/30 fps project. Late seeking, split/undo, In/Out controls, 120 caption clips, search reaching caption 119, and a 60-caption replacement batch passed. A 141 MB project backup reopened successfully and preserved the 140,857,173 original source bytes exactly. The final browser download contains 17,327 H.264 frames, AAC audio, and 577.566667 seconds of video; complete decoding passed. Samples near the middle and end show correct footage and edited captions. The test timeline retains its original 0.266667-second source placement.
- **Vertical video:** Reframed ten seconds of Downloads footage onto a 1080×1920/30 fps canvas. Imported test SRT captions, entered an explicit newline, replaced text in bulk, and applied Inter at 64 px to five captions. The exported 301-frame video decoded completely. Accent marks, manual line breaks, and automatic wrapping are visible in decoded frames. This validates imported and edited captions, rather than automatic transcription.
- **Additional fixes:** Fresh projects now reset playback, playhead, range, selection, and scrolling. Caption rendering draws its measured wrapped lines inside 90% of the frame, with allowance for background padding and render scale. Empty lines and long unbroken words are preserved. Maximized/full-screen preview keeps the project aspect ratio and reserves room for transport controls. CSS resizing no longer replaces drawing resources while a decoded frame is in flight.
- **Live check:** Reopened a synthetic portrait backup and exported a two-second video from the deployed application. Its 60 H.264 frames and AAC audio decoded successfully. Wrapped Portuguese text and explicit line breaks are visible. The live browser recorded no console errors or warnings.

The initial longer-project export had a consistent approximately 44 ms audio delay. The audio/browser follow-up below fixes that delay and supersedes the initial synchronization result. The 4K source was exported at the browser's 1080p/30 fps limit. Physical phones and automatic transcription remain untested.

Release evidence and deployment checks (local QA evidence).

Long project export (local QA evidence) · Vertical captioned export (local QA evidence).

## Audio synchronization and browser follow-up

The audio and browser fixes are deployed as [7c1d9fb7](https://7c1d9fb7.openreel-3pq.pages.dev). Public HTML and JavaScript match the tested build byte for byte, with COOP `same-origin` and COEP `require-corp`. A production Chromium export completed with no recorded console errors or warnings.

AAC priming is calibrated for the active sample rate, channel count, and bitrate. The tested encoder adds 2,112 PCM samples at 48 kHz, or 44 ms. Safari's `decodeAudioData` hides this padding, so calibration decodes timestamped packets through MediaBunny instead. The MP4 audio edit list skips the measured priming and limits the presentation duration to the actual mixed audio. Encoded media samples and chunk offsets are preserved.

- **Long Chromium project:** The corrected 577-second export decodes completely. Four-second comparisons at source times 30, 300, and 560 seconds find zero sample offset, with correlations above 0.99999. The timeline's original 0.266667-second footage placement is retained.
- **Safari 27.2:** The quality encoder stalled after eight frames in an isolated test. Realtime mode produced all 60 test packets. The editor now uses that mode in WebKit and verifies that every submitted frame produces a packet. The final 360×640/30 fps portrait export contains all 180 frames and AAC audio, and decodes completely.
- **Firefox 157.0.1:** Restored the backup, played and sought the preview, and exported all 180 portrait frames with H.264 and Opus audio in MP4. The file decodes completely. This browser could not encode AAC in the selected configuration.
- **Audio comparisons:** Fully decoded PCM from one-second windows at 0.5, 2.5, and 4.5 seconds has zero sample offset in Safari, Firefox, and the live Chromium export. These results concern the tested windows and do not establish universal frame-perfect synchronization.
- **Captions:** Decoded exports retain accented Portuguese text, automatic wrapping, and explicit line breaks. The frame at 2.5 seconds matches the caption shown in both native browser previews.
- **Safari recovery:** Reopening a file-backed backup slice could lose its byte offset and expose package metadata as video bytes. Backup reading now detaches these slices using 1 MiB chunks before persistence. After two reload/recovery cycles, the downloaded backup's 751,239 media bytes match the original SHA-256 exactly. Autosave also reconnects once if Safari closes a database connection before a transaction begins.
- **Cancellation:** Stalled rendering and encoding operations can be cancelled; a 30-second watchdog reports an actionable error and releases the unfinished destination. Late rendered images are closed. Regression checks cover retry after cancellation and a stall.

Complete follow-up evidence (local QA evidence) includes browser exports, audio comparisons, backup integrity, and deployment checks.

## Delivered next priority: export the marked section

Implemented and deployed as [0c57a7ca](https://0c57a7ca.openreel-3pq.pages.dev) after the synchronization fixes. The export dialog offers Entire timeline and Marked In/Out, shows the marked frame timecodes, and bases duration, size, and compression estimates on the selected section. Both the normal export action and Quick Export carry the range. Unmarked or invalid ranges are disabled.

Rendering reads the original timeline at the In point while output timestamps start at zero. Captions and effects keep their original timeline time; audio mixing starts at In and stops at Out, including across 15-second audio chunks. Missing originals outside the selected section do not block it. A small floating-point tolerance prevents an extra output frame at an exact frame boundary.

The range implementation passes 58 core export/preflight tests and 10 export-dialog tests. Full current suites, TypeScript checks, and the production build also pass. After the Mac was unlocked, the native Safari normal export and Firefox Quick Export both passed. A live Chromium export passed after deployment.

Each marked 2–4 second export contains exactly 60 frames at 30 fps, starts at output time zero, and covers source frames 60–119. Decoded first and last frames retain the same multiline caption; the caption beginning at the exclusive Out point is absent. Video comparison above the caption region has SSIM above 0.993 in Safari and Firefox, and 0.973 in live Chromium, against the corresponding source section. Nearest-source-frame comparisons identify all expected frames 60–119 in each export. Three half-second audio windows per browser have zero sample offset after subtracting the two-second In point. Full-file decoding passes. Firefox's Opus track retains approximately 13.5 ms of encoder padding at the end; video duration is exactly two seconds and source audio stops at Out.

The live HTML and entry script match the tested build byte for byte, and isolation headers remain correct. The live range smoke test recorded no console errors or warnings. Source preview trimming before insertion remains the next part of priority 1.

Range export verification (local QA evidence) · Deployment verification (local QA evidence).

## Next priorities

| Priority | Work | Acceptance target |
| --- | --- | --- |
| 1 | Source monitor and trimming before insertion | Select a source excerpt before insertion. Marked timeline range export is now delivered and verified. |
| 2 | Measured preview performance | Profile longer 4K/multilayer projects, adapt preview quality to rendering pressure, and bound decoded GPU memory. Extend proxy caching beyond the current temporary tab cache. |
| 3 | Transcript-driven editing | Source-linked word selection, reversible cuts, searchable footage, and clearer model choices/costs for smaller devices. |
| 4 | Cross-browser export coverage | Safari, Firefox, physical mobile devices, longer multilayer projects, masks, animated titles/captions, cancellation, and frame-perfect audio/video synchronization. |
| 5 | Portable resources and storage | Optional custom-font packaging, clearer persistent-storage choices, and recovery after actual browser-storage eviction. |
| 6 | Discovery and accessibility | Reduce inspector overload; audit contrast, focus order, screen-reader output, and touch targets with actual assistive technology and devices. |

The workflow references are Premiere’s [project collection](https://helpx.adobe.com/premiere/desktop/organize-media/create-projects/copy-project.html) and [source In/Out selection](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/set-in-and-out-points-in-the-source-monitor.html), and CapCut’s [batch caption editing](https://www.capcut.com/help/batch-edit-to-recognize-subtitle). They support prioritizing dependable editing and finishing workflows alongside the existing feature library.
