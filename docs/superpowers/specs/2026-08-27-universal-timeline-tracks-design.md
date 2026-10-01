# Universal Timeline Tracks Design

**Date:** 2026-08-27

**Status:** Proposed — design only

**Primary scope:** Web and desktop editor, shared project schema, iOS/Android readers

## Summary

OpenReel should stop treating a track's historical type as a restriction on the clips it can contain. A normal timeline track should accept video, image, text, graphics, and audio items. The item itself determines how it is rendered, inspected, mixed, and exported.

The interaction must also solve the workflow behind the report: when an editor drops an image or other visual over an occupied video interval, OpenReel should automatically place it on a standard track immediately above the source track. The editor should not need to create and arrange an image-specific track first.

This should be delivered as a reader-first migration. Rendering, audio, export, inspection, history, and project loading must understand mixed tracks before the UI starts writing mixed-track projects.

## Problem

The current model declares five track types:

- `video`
- `audio`
- `image`
- `text`
- `graphics`

That type is used both as presentation metadata and as a content capability. The timeline UI only lets a media clip move to a track with the same type. Text and graphics use separate storage and separate movement paths. Preview and export often decide what a clip is from `track.type` instead of from the clip or its media item.

This creates unnecessary setup during fast editing. An editor has to create or locate the right kind of track before placing an item, even though the timeline can determine the item's behavior itself.

It also creates fragile internal behavior. The action executor currently permits some mixed placements, but multiple render and audio paths ignore those clips because the containing track has the "wrong" type.

## Audit findings

This is broader than drag and drop:

- The TypeScript web/core code has 141 direct `track.type` branches across 63 files.
- The shared project model is mirrored by native clients. The audit found track-type logic in 5 Swift files and 19 Android production Kotlin files.
- `Track.clips` contains media clips, while text, shapes, SVGs, and stickers live in project-level collections and refer back to a track with `trackId`.
- `ClipComponent` rejects cross-track moves when the destination type differs.
- `pasteOverlayClip` explicitly requires a text or graphics track.
- Preview, `VideoEngine`, `AudioEngine`, `PlaybackController`, and `ExportEngine` use track type as a render or audio gate.
- The inspector partly checks media type, but still treats an audio track as proof that any contained clip is audio.
- Transitions are exposed only on video tracks, even though video-to-image transitions are a valid visual operation.
- Track duplication and removal operate on `Track.clips` and do not consistently include project-level text and graphics items owned by that track.
- The JSON wrapper is still `1.0.0`; its migration method normalizes fields but does not perform a structural version migration.

Important current hotspots include:

- `packages/core/src/types/timeline.ts`
- `packages/core/src/actions/action-executor.ts`
- `packages/core/src/actions/action-validator.ts`
- `packages/core/src/video/video-engine.ts`
- `packages/core/src/audio/audio-engine.ts`
- `packages/core/src/playback/playback-controller.ts`
- `packages/core/src/export/export-engine.ts`
- `apps/web/src/components/editor/Timeline.tsx`
- `apps/web/src/components/editor/timeline/TrackLane.tsx`
- `apps/web/src/components/editor/timeline/ClipComponent.tsx`
- `apps/web/src/components/editor/Preview.tsx`
- `apps/web/src/components/editor/InspectorPanel.tsx`
- `apps/web/src/stores/project/clip-slice.ts`
- `apps/web/src/stores/project/text-graphics-slice.ts`
- `apps/web/src/stores/project/history-slice.ts`

## Product decisions

### 1. Normal tracks are universal

Every normal track accepts every timeline item:

- video
- image
- audio
- text
- shape
- SVG
- sticker or emoji
- motion or generated visual instances when those are represented on the editing timeline

"Video Track", "Image Track", "Text Track", and "Graphics Track" should become one **Track** action. Existing specialized tracks remain valid and become universal when opened by a compatible reader.

Audio roles such as dialogue, music, effects, and ambience remain useful, but they describe mixing intent rather than placement capability. A track with a music role can still accept a visual item. Dropping an item must not fail only because of that role.

### 2. Content determines capabilities

Track type must no longer answer questions such as:

- Does this item draw pixels?
- Does this item produce audio?
- Which inspector should open?
- Can this item receive a visual transition?
- Does it need a thumbnail, waveform, or text preview?

Those answers come from the item kind and its resolved media metadata.

A video item may have both visual and audio capabilities. An image has visual capability only. An audio file has audio capability only. Text and graphics have visual capability and their own authoring capabilities.

### 3. A row is one editorial lane

A single track should not contain unrelated items that overlap in time. This keeps selection, transitions, trim behavior, and visual ordering predictable. A transition may temporarily consume handles from two adjacent items, but it is not an arbitrary overlap.

This matches the useful part of traditional NLE behavior: tracks accept different visual item types, while simultaneous layers occupy different rows.

### 4. Dropping over content automatically stacks above it

When a user drops a new item onto an occupied time range:

1. Show a placement ghost on a row immediately above the occupied track.
2. Reuse the nearest unlocked standard track above when it has room.
3. Otherwise create a new standard track immediately above.
4. Place the item there in the same undoable transaction.

This is the fast path for "put an image on a video clip." The editor does not need to create or arrange a track first.

Dropping into an empty interval stays on the selected track. Insert and overwrite editing can be added as explicit tools later; they should not be hidden side effects of the default drop.

### 5. Track order remains the layer order

The top timeline row composites above lower rows. Rendering should traverse lower rows first and composite higher rows last. A new auto-stacked track is inserted immediately above the target so its visual relationship is obvious.

### 6. Controls reflect contributions, not a type badge

Every standard track header shows:

- visibility control for visual contributions
- mute and solo controls for audio contributions
- lock control for all items
- name and optional semantic role

Hiding a track does not mute its audio. Muting a track does not hide its visuals. Solo only participates in audio resolution for tracks that currently contribute audio.

Clip colors and icons identify item type. The row itself uses a neutral standard-track appearance.

## Compatibility-first data model

The first release should not move every item into a new `Track.items` array. That would combine a storage migration, every engine refactor, and the interaction change into one high-risk release.

Instead, preserve the current serialized locations and add a unified read model over them.

### Unified timeline item view

Introduce a shared discriminated union similar to:

```ts
type TimelineItemKind =
  | "media"
  | "text"
  | "shape"
  | "svg"
  | "sticker"
  | "adjustment"
  | "motion";

interface TimelineItemRef {
  id: string;
  trackId: string;
  kind: TimelineItemKind;
  startTime: number;
  duration: number;
}

interface TimelineItemCapabilities {
  visual: boolean;
  audio: boolean;
  transformable: boolean;
  trimSource: boolean;
  transitionSource: boolean;
  textEditable: boolean;
  graphicEditable: boolean;
}
```

Core selectors should become the only supported way to ask for items and capabilities:

```ts
getTimelineItems(project): TimelineItemRef[]
getTrackItems(project, trackId): TimelineItemRef[]
resolveTimelineItem(project, itemId): ResolvedTimelineItem | null
getTimelineItemCapabilities(project, item): TimelineItemCapabilities
trackHasVisualItems(project, trackId): boolean
trackHasAudioItems(project, trackId): boolean
```

Media capability resolution should preserve optional `hasVideo` and `hasAudio` values from import metadata. Until those fields exist on older projects, use safe fallbacks from `MediaItem.type`, dimensions, sample rate, and channels.

### Track fields

Keep the existing `Track.type` field during the migration so older project readers do not fail on an unknown enum value. Treat it as a deprecated compatibility hint, not an acceptance rule.

Add optional, additive metadata:

```ts
interface Track {
  // Existing compatibility field. Do not use for item capability checks.
  type: "video" | "audio" | "image" | "text" | "graphics";

  // New clients default missing values to "standard".
  mode?: "standard";

  // Optional editorial meaning, independent from capability.
  role?: "general" | "captions" | "dialogue" | "music" | "effects" | "ambience";
}
```

New tracks can serialize with `type: "video"` plus `mode: "standard"` until all clients can safely read a new canonical schema. Existing track types do not need an eager destructive rewrite.

### Cross-platform rollout

The project schema is shared with iOS and Android, so writers must not get ahead of readers.

Use this rollout order:

1. Add the unified selectors, optional fields, and capability marker to TypeScript, Swift, and Kotlin readers.
2. Make all preview and export readers render mixed assignments correctly.
3. Add a project capability such as `universal-tracks-v1` and a minimum-reader guard. An incompatible app must ask the user to update instead of silently omitting items.
4. Only then enable the UI paths that write mixed assignments.

The web serializer needs real version fixtures and migrations before the writer flag is enabled. A version mismatch cannot continue to be treated as normalization only.

## Engine behavior

### Preview and export

For every visible track at a frame time:

1. Resolve active items through the unified item view.
2. Render items with visual capability using the renderer for the item kind.
3. Composite by track order.
4. Do not infer item kind from the track.

Preview and export must use the same ordering and capability rules. Golden-frame tests should compare both paths for mixed projects.

The blurred canvas backdrop should choose the lowest active visual media item, not the lowest item on a track whose type happens to be video or image.

### Audio

Audio scheduling should include every media clip whose resolved source has audio, regardless of its track type. This includes video clips on formerly image, text, or graphics tracks and audio-only clips on a standard track.

Mute and solo resolution operates at the track level. Clip volume, automation, effects, speed, reverse state, and source audio-track selection remain clip properties.

### Inspector

The inspector should resolve the selected item first and then build sections from item capabilities:

- image: transform, crop, color, visual effects
- video without audio: visual sections only
- video with audio: visual and audio sections
- audio-only: audio sections only
- text: text, transform, animation, compatible visual effects
- graphics: graphic-specific controls, transform, compatible visual effects

The track is only consulted for lock, visibility, mute, solo, and role state.

### Transitions

For the first universal-track release:

- Preserve transitions between adjacent video and image media items, including video-to-image and image-to-video.
- Determine eligibility from both items' visual capabilities, not the track type.
- Keep text and graphics entry/exit animation behavior unchanged.
- Do not silently offer a transition between item kinds that the renderer cannot rasterize consistently.

A later generalized transition pass can render any visual item into an intermediate frame and transition between those frames.

## Editing command model

Media and overlays currently have separate move, copy, paste, delete, split, and undo paths. Universal tracks need commands that work on a timeline item union.

Add command-level operations such as:

```ts
placeTimelineItem(itemId, targetTrackId, startTime, policy)
moveTimelineItems(moves, policy)
duplicateTimelineItems(itemIds, destination)
removeTimelineItems(itemIds)
splitTimelineItems(itemIds, time)
duplicateTrackWithItems(trackId)
removeTrackWithItems(trackId)
```

`policy` should initially support:

- `gap`: place only when the destination interval is clear
- `stack-above`: resolve or create a row above when occupied

Insert and overwrite policies can be added later with explicit UI.

Each command must:

- validate source and destination locks
- update `trackId` for media, text, and graphics items
- update engine caches after project data changes
- preserve linked captions and grouped items
- recalculate duration once
- create one deterministic history transaction
- restore both the item and any auto-created track on undo

Track duplicate and remove must include every project-level item whose `trackId` matches the track, not only `Track.clips`.

## Timeline interaction

### Add track

Replace the five primary add-track entries with:

- **Track**
- optional role shortcuts: Dialogue, Music, Captions

Role shortcuts create a standard track with a role; they do not restrict content.

### Drag and drop

While dragging:

- Every unlocked track is a valid destination.
- The ghost uses the dragged item's icon and color.
- Empty interval: show the ghost in that row.
- Occupied interval: show the ghost in the resolved row above and label it "Place above."
- Locked row: skip to the nearest valid row above or show a clear locked state.
- Never show an invalid state solely because item and legacy track types differ.

External file drops and asset-panel drops use the same placement resolver as internal clip moves.

### Selection and trimming

Selection, box selection, snapping, trimming, and keyboard movement should enumerate the unified item view. Timeline rendering should choose the clip component from item kind, not from the row type.

### Overlap rules

The command layer enforces the non-overlap invariant for unrelated items in one row. Existing projects containing accidental overlaps remain readable; load normalization should preserve them and surface a repair action rather than silently moving content.

## Implementation sequence

### Phase 0 — Characterization and schema safety

- Add mixed-project fixtures and lock current preview/export/audio behavior for normal projects.
- Add true schema version and minimum-reader tests across TypeScript, Swift, and Kotlin.
- Preserve `hasVideo` and `hasAudio` import metadata.
- Inventory every direct track-type branch and assign it to capability, role, or presentation.

Exit condition: old projects round-trip without visual, audio, timing, or ordering changes.

### Phase 1 — Unified read model

- Add timeline item and capability selectors in core.
- Replace track-type gates in preview, native playback, audio, export, inspectors, duration calculation, captions, multicam, and templates.
- Add mixed-track read fixtures, while the UI still writes legacy placements.
- Land equivalent reader behavior on iOS and Android.

Exit condition: a hand-authored mixed project renders and exports correctly everywhere.

### Phase 2 — Universal commands and history

- Add union-aware item placement and mutation commands.
- Make track duplicate, remove, undo, and redo include media and overlay collections.
- Centralize overlap resolution and automatic track creation.
- Add transaction and deterministic-ID tests.

Exit condition: mixed item moves, automatic stacking, undo, redo, save, and reload are lossless through headless commands.

### Phase 3 — Timeline user experience

- Replace typed add-track controls with the standard track action.
- Remove same-type drag rejection.
- Add placement ghosts and automatic stacking.
- Derive row controls from actual visual/audio contributions.
- Derive clip component, color, icon, and inspector from item kind.

Exit condition: the complete workflow is usable by mouse, trackpad, keyboard, and screen reader.

### Phase 4 — Hardening and rollout

- Enable `universal-tracks-v1` project writes only for compatible readers.
- Run preview/export golden tests and long mixed-timeline playback tests.
- Test autosave recovery, shared project files, templates, nested sequences, captions, multicam, transitions, and desktop native export.
- Roll out behind a feature flag, then make it the default after compatibility telemetry is clean.

## Acceptance criteria

1. A user can place video, image, text, graphics, or audio on any unlocked standard track.
2. A row can contain a video followed by an image followed by text without manual track setup.
3. Dropping an image over an occupied video interval creates or reuses a row immediately above and composites the image above the video.
4. Moving an existing text or graphic item between rows is one undoable action.
5. The selected item's inspector is correct regardless of its row's legacy type.
6. Video audio and audio-only items play, mute, solo, and export correctly from any row.
7. Hiding a mixed row affects its visuals but not its audio; muting affects audio but not visuals.
8. Adjacent video and image items can use supported transitions on the same row.
9. Duplicate track, delete track, undo, redo, autosave recovery, save, and reload preserve every item kind.
10. Existing projects render and export identically before and after the reader migration.
11. An older incompatible client is prevented from silently opening a mixed-track project.
12. Web preview, web export, desktop preview, desktop native export, iOS, and Android agree on track order and active items.

## Test matrix

At minimum, cover these combinations:

| Scenario | Preview | Export | Audio | History | Round trip |
| --- | --- | --- | --- | --- | --- |
| Video then image on one row | Yes | Yes | Video audio | Yes | Yes |
| Text then video on one row | Yes | Yes | Video audio | Yes | Yes |
| Graphic on former audio row | Yes | Yes | N/A | Yes | Yes |
| Audio on former text row | No visual | Yes | Yes | Yes | Yes |
| Video with audio on any row | Yes | Yes | Yes | Yes | Yes |
| Image stacked above video | Correct z-order | Correct z-order | Video audio | One undo | Yes |
| Mixed row hidden | No visual | No visual | Audio remains | Yes | Yes |
| Mixed row muted | Visual remains | Visual remains | No audio | Yes | Yes |
| Video-to-image transition | Yes | Yes | Continuous | Yes | Yes |
| Delete or duplicate mixed row | Correct | Correct | Correct | Yes | Yes |

## Risks and mitigations

### Silent content loss in older clients

Mitigation: reader-first rollout, explicit capability marker, minimum-reader guard, and cross-platform fixtures before enabling writes.

### Preview and export disagree

Mitigation: shared capability and ordering selectors plus golden-frame tests that exercise both paths.

### Audio disappears from mixed tracks

Mitigation: resolve audio from media capability, not row type, and use the same resolver for realtime playback and offline export.

### Overlay history becomes inconsistent

Mitigation: replace parallel media and overlay movement paths with union-aware transactional commands before changing drag behavior.

### Same-row overlaps produce undefined z-order

Mitigation: enforce one-lane non-overlap for new edits and automatically stack above. Preserve and explicitly repair legacy accidental overlaps.

### Scope expands into a full NLE rewrite

Mitigation: preserve existing serialized item collections for the first release, keep text/graphics animations as-is, and defer generalized cross-kind transitions, insert/overwrite tools, folders, and nested lanes.

## Not in the first release

- Arbitrary overlapping items within one row
- Full insert/overwrite/replace editing modes
- Generalized transitions between every visual item kind
- Track folders or nested lanes
- A destructive migration to one `Track.items` storage array
- Removal of the legacy `Track.type` field before all clients have migrated

## Recommendation

Proceed with the reader-first four-phase plan. Do not implement this by only loosening the current drag check. That would create projects that appear correct in the timeline but lose visuals or audio in preview, export, history, or another platform.

The first implementation commit should contain only shared item-capability selectors, metadata preservation, and characterization tests. The UI should not write mixed assignments until the read paths and command transactions are complete.
