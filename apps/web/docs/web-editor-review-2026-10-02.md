# OpenReel web editor review and improvements

Screenshots, test footage, and local QA evidence are retained outside Git; this report records their findings and validation limits.

Reviewed on October 2, 2026. This review covers opening the browser editor, importing footage, editing on the timeline, recovering work, using shortcuts, and choosing export settings. The aim is to make dependable browser editing easier for a first-time user while retaining the controls experienced editors need.

OpenReel already has a broad feature set. The highest-value improvements are dependable playback, safe saves, responsive timelines, and clearer defaults. This initial pass implements those foundations and adds range looping. A [follow-up implementation report](web-editor-next-priorities-2026-10-02.md) records the subsequent proxy workflow, common editing shortcuts, responsive touch workspace, and completed browser export checks. The observations and test counts below describe the initial pass.

## Changes implemented

| Area | Result |
| --- | --- |
| Timeline performance | Playback ticks no longer serialize settings or write local storage. Stable lanes, headers, clips, and captions avoid rendering on every playback frame. Thumbnails and waveform repetitions are limited to the viewport with overscan. |
| Startup | Optional dialogs, templates, and recent-project views load on demand. Background editor preloading waits for idle time and respects data saving and slow connections. Engine startup survives state changes and reports failures with a retry action. Effects initialization and disposal handle remounts and pending GPU work safely. |
| Editing | Frame stepping uses the project frame rate and pauses playback. Bulk edits run sequentially in one undo group. Locked clips and linked captions survive keyboard edits. Dragging several clips retains their original spacing. |
| Keyboard controls | Save, Export, Add Text, markers, and help are wired to actions. Mac and Windows modifiers, Option punctuation, shortcut conflicts, text entry, dialogs, and focused timeline navigation are handled. Handlers read current state without reinstalling on every playback tick. |
| Range playback | I marks the start, O marks the end, and Shift+L toggles looping. The preview also has an accessible loop button. The shared clock detects missed loop cycles; audio seeks reschedule immediately during playback, while paused scrubbing stays silent. Empty portions of the marked range remain part of the loop. |
| Saving and recovery | Autosaves are serialized and wait for database transaction completion. Edits made during a save remain dirty. Storage failures surface a warning, failed initialization can retry, and clearing recovery snapshots preserves media and templates. Project saves distinguish cancellation from write failures. |
| Media import and relinking | Asynchronous imports preserve edits made in the meantime and stay within their project. Newer relink requests win; replacement blobs persist; failures preserve the original asset. |
| Export and workspace | Export opens settings with the current canvas and frame rate selected. Empty or invalid exports are blocked. Recommendations avoid accidental upscaling and native-only encoders in the browser. Smaller initial side panels give laptop previews more room. |

## Browser workflow evidence

The screenshots below were captured and inspected during this review. The editing fixture is a generated four-second H.264/AAC video at 640 by 360 and 24 fps. It contains no personal footage. The welcome screen was captured during the development run; the editing screens use the production build in the Codex browser at a 1228 by 954 viewport.

1. **Open and choose a format — healthy, with accessibility follow-up.** The welcome screen states that editing happens in the browser and offers three clear formats. The smaller secondary controls and subdued explanatory text should receive a contrast and target-size review. Their appearance alone does not establish compliance.

2. **Import and select footage — healthy on the tested desktop browser.** Importing the fixture and adding it to the timeline produced a visible preview and editing controls. The first capture showed side panels taking most of the width; the changed defaults leave a larger preview. The inspector still presents many sections, so a beginner could benefit from a shorter set of common tasks. The canvas selection handles need further keyboard and screen-reader testing.

3. **Recover after reloading — healthy in the tested recovery path.** Recovery restored the test project's clip and stored media, and the preview rendered again. Unit tests also cover preserving media when clearing snapshots and retrying failed database initialization. Recovery from an abrupt process crash or an exhausted real device is not verified by this browser check.

4. **Navigate frames and mark a loop — healthy, with discoverability follow-up.** A focused timeline clip accepted frame and one-second navigation. I and O changed the loop bounds, and the loop button reported its pressed state and bounds. Help opened with the question-mark key. A description was added to the help dialog after a browser accessibility warning. Visible range handles on the timeline would make I/O marks easier to discover.

5. **Choose export settings — healthy; file delivery unverified.** Export opened a dialog with 640 by 360 at 24 fps selected. For this small source, the recommendation view offered the project preset rather than upscaled alternatives. The displayed size and time are estimates. Attempting final export reached a native save picker that browser automation could not control, so a completed encoded file was not verified. Mocked write-failure tests cover the separate project-save path.

6. **Open project tools — healthy for the inspected behavior.** The Project JSON dialog opens on demand and retains its selected Import tab after closing and reopening. It defers project serialization while closed. A portable project with all original media needs a separate product workflow; the JSON view should not be treated as a media archive.

## Performance evidence

These are deterministic regression results and production asset measurements. They are not measurements of playback FPS, Core Web Vitals, or network latency.

| Check | Result |
| --- | --- |
| 120 playhead updates | Zero timeline preference serializations and local-storage writes. |
| 60 separate playback frames | Zero commits for the profiled lane, media clip, caption, and track header between boundaries; a track-height change still updates them. |
| One-hour clip at 500 pixels per second in a 1000-pixel viewport | At most 22 thumbnail elements or 208 waveform bars. The previous full-width repetition would allocate about 30,000 thumbnails or 300,000 bars. |
| Main production JavaScript entry | 1,985,495 to 1,934,415 bytes, a reduction of 51,080 bytes or about 2.6 percent. The large core entry and preloaded Three.js still warrant work. |
| Initial scripts and module preloads using gzip | 1,018,917 to 1,007,226 bytes, about 11.7 KB less compressed code. |

The build measurements (local QA evidence) include entry and initial preload sizes using the same gzip calculation before and after. The build still reports large chunks. More code splitting needs an import-boundary review of the core package; simply changing chunk names would not remove downloaded code. The initial page also requests many font families, which should be loaded as needed without changing existing text rendering.

## Competitive priorities

Browser creators expect useful automation as part of a short editing flow. CapCut documents browser editing with captions and text-to-speech; Premiere documents transcript editing and searching footage by its content. These are useful reference points for workflow quality, rather than a reason to add controls indiscriminately. [CapCut online editor](https://www.capcut.com/tools/online-video-editor), [Adobe text based editing](https://helpx.adobe.com/premiere/desktop/edit-projects/edit-video-using-text-based-editing/overview-of-text-based-editing.html), [Adobe media intelligence search](https://www.adobe.com/learn/premiere-pro/web/media-intelligence-search-ai).

| Priority | Proposed work | Acceptance target |
| --- | --- | --- |
| 1 | Browser export and codec validation | Automated completed-file checks on Chromium, Safari, and Firefox with representative video, audio, captions, effects, cancellation, and longer projects. Confirm metadata, duration, synchronization, and visible output. Give users actionable unsupported-codec feedback. |
| 2 | Visible proxies and adaptive preview | Offer proxy generation, progress, disk usage, and an original/proxy toggle. Reuse existing core proxy support and always export originals. Adapt preview resolution to actual rendering pressure, with bounded decoded-frame memory. Current Auto quality is based on dimensions. |
| 3 | A shorter path to the first finished video | Put trim, captions, dialogue cleanup, aspect ratio, and export in a clear selected-clip flow. Reuse the existing local captions, silence cutting, highlights, and reframing tools. Check discoverability with first-time editors. |
| 4 | Tablet and phone editing | Build touch targets and a responsive single-panel workspace, then replace the current mobile blocker with capability-based access. Merely removing the blocker would expose a desktop layout; the app currently blocks mobile/tablet user agents and windows below 768 pixels. |
| 5 | Portable projects and storage clarity | Let users package originals with a project, show storage consumption, and validate missing assets before export. Preserve recovery and relinking across browser storage eviction and device changes. |
| 6 | Transcript and media search | Extend existing transcription into reversible, source-linked transcript edits and searchable footage. Keep the existing timeline, captions, trims, and undo history consistent. Local and optional remote processing should have clear progress and cancellation. |
| 7 | Optional review and collaboration | Add dependable review links, comments tied to time, and project versions before simultaneous editing. This requires backend, permissions, and storage design beyond the local reliability changes in this pass. |

## Validation and limits

The full web suite passes 977 tests across 178 files, with 7 skipped. The full core suite passes 1,281 tests across 166 files, with 20 skipped. The web production build passes, including its TypeScript check; the core TypeScript check also passes. Targeted lint and whitespace checks pass. Existing lint warnings remain in other inspected source sections, and the production build still warns about large chunks and stale browser-target metadata.

Browser checks cover the generated fixture, project recovery, selected-clip navigation, loop marking, shortcut help, dialog retention, and export settings. They do not establish mobile readiness, full accessibility compliance, codec parity across browsers, long-project memory stability, or completed file export. No runtime performance trace was available for this run, so no FPS or Core Web Vitals improvement is claimed.
