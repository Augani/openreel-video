# Editor fixes — 11 October 2026

Screenshots, test footage, and local QA evidence are retained outside Git; this report records their findings and validation limits.

The reported transition failure was a rejected adjacency/duration check. The screenshot does not include the project or original request, so the exact user's timeline cannot be reproduced from it.

## Changes

- AI editing can inspect adjacent clip pairs and their maximum transition duration. Reversed clip IDs are normalized chronologically and overly long transitions are shortened to fit both clips. Clip positions remain unchanged unless an authorized editing request moves them.
- Mutation-free transition preflight failures can be corrected within the same isolated turn, using an explicit failed-call reference. Every pending failure must be repaired before commit. Other failures, cancellation, stale projects and budget exhaustion still discard pending edits. Correction opportunities are limited to three.
- Corrected tool cards display “Corrected.” Unresolved failures display “Failed” after rollback.
- The project menu uses the shared portaled popover, so timeline controls and scrollbars remain underneath. Option titles, supporting text and recent-project timestamps have separate lines.
- A failed lazy load of the backup dialog is contained without unmounting the editor; dismissing the error allows editing to continue.
- Export progress is sized to the preview workspace, independently of project aspect ratio and canvas zoom. Compact states remove unnecessary decoration, preserve the progress indicator, and constrain the card to available space.
- Portable edit JSON now retains standard track mode, role and grouping metadata, including media placed on standard tracks. Closed-schema validation remains in place.

## Browser evidence

The in-app Chromium browser was tested at the existing 917 × 954 viewport. Test media was a local synthetic H.264/AAC source; no user footage or API key was sent to an external model. AI responses came from a deterministic local HTTP fixture, while imports, tools, transactions, preview rendering, Undo, Redo and exports used the real app.

1. Imported a six-second portrait project. Requested joining two shots with a crossfade. The fixture first submitted a transition across a one-second gap, then inspected options, moved the incoming clip as authorized, and explicitly retried the failed call. The final duration was 2.5 seconds with a 0.5-second crossfade. The rejected card became “Corrected.”
2. One Undo restored the original six-second project. Redo restored both clips and the transition. The timeline showed “crossfade · 0.5s.”
3. Exported the corrected project. FFprobe reported H.264 at 360 × 640, 75 frames / 2.5 seconds, plus 2.5-second AAC audio. Full FFmpeg decoding succeeded. The decoded transition frame was visually inspected.
4. Repeated an invalid request while keeping the gap. The whole turn rolled back, the original six-second duration remained, and the timeline retained its single source clip. Unit tests separately compare exact before/after project data for rollback.
5. Opened the project menu over the timeline controls. DOM inspection confirmed that it is portaled outside the header and receives pointer targeting above the timeline. “New Project” and its subtitle occupy distinct rows.
6. Started and cancelled a real export of a ten-minute, 100-clip portrait fixture at 50% canvas zoom. The original progress card collapsed into a narrow column and spilled outside the project canvas. The replacement is checked against this same workflow.
7. Verified the rebuilt card during rendering at 50% canvas zoom. At the 917 × 954 viewport the workspace measured 907 × 251 pixels and the card measured 360 × 88 pixels, with no horizontal overflow. At a temporary 480 × 760 viewport the workspace was 470 × 110 and the compact card was 360 × 80. At 480 × 600 the workspace was only 470 × 33 and the minimal card was 360 × 22; the progress bar remained visible without scrolling. Temporary viewport overrides were reset and export cancellation restored the normal controls.
8. Exported portable edit JSON from the imported six-second project, imported it as one undo step, and exported again. Both JSON documents were exactly equal, including caption track mode, role and grouping metadata. All local media references remained linked.

Screenshots and local fixtures are in `.codex-audit/ai-transition-2026-10-10/`, including `chat-correction-success.png`, `chat-rollback.png`, `transition-preview.png`, `export-transition-frame.png`, `after-project-menu.png`, `before-export-progress.png`, `after-export-progress.png` and `compact-export-progress.png`.

## Limits

This tests deterministic tool recovery rather than the planning quality of a production model. It does not recreate the reporting user's exact project. Safari and Firefox export/audio checks were completed in the preceding release; this pass adds Chromium UI checks for the new overlays and menu.

## Validation

- Web: 203 files, 1,140 tests passed; 7 existing skips.
- Core: 174 files, 1,351 tests passed; 20 existing skips.
- Agent: 36 files, 486 tests passed.
- Core and agent type checks passed. The web production build includes its TypeScript check.
- Scoped ESLint completed with zero errors. Preview retains 18 existing hook warnings.
- Exact retry references, ignored failures, wrong references, correction limits, cancellation, budget and stale-project rollback are covered by automated tests.
- Git whitespace checks passed.

The final build passed after tightening the minimal progress state. Remaining build warnings concern existing large chunks and browser compatibility database age.

## Deployment

Deployed to production as `86cfce68`: https://86cfce68.openreel-3pq.pages.dev. The live app is https://app.openreel.video/#/editor.

Both deployment and live HTML reference `/assets/index-Bkm-hWWD.js`. Both served bundles match the tested local build, SHA-256 `3336f829d765a6e606f2fd64dc1f76d1b70362c409b456aab03b5b085bde226f`. HTTPS certificate validation stayed enabled. COOP `same-origin` and COEP `require-corp` headers were verified on both hosts. Local QA packages were absent from the deployment output.

Reloaded the live editor and recovered the prior synthetic captioned project. Verified the project menu and exported the six-second portrait video at 50% preview zoom with the new progress card. The download contains 180 H.264 frames at 360 × 640, six-second AAC audio, and fully decodes without errors. Screenshots: `live-project-menu.png` and `live-export-progress.png` in the audit folder. Preview zoom was restored afterward.
