# Multi-camera editing

Premiere-style multicam: sync 2 to 9 camera clips into a **multicam source**, cut between angles live with the number keys, switch an angle after the fact, flatten.

## Workflow

1. **Sequence > Create multi-camera source...** Pick the angles (the first is the sync reference), choose a sync method, then *Create source*. Methods:
   - **Audio waveform**: FFT cross-correlation (GCC-PHAT, parabolic peak refinement) of each camera's audio against the first. Verified in a real browser to recover known offsets to well under a frame. The dialog shows each angle's offset and match confidence; a weak match is flagged.
   - **Timecode**: type each camera's start timecode (or `MediaMetadata.startTimecode` when an importer provides it).
   - **In points**: the Source monitor In mark of each clip, else its In point on the timeline.
   - **Markers**: the first timeline marker over each angle's clip.
2. The **Multicam** tab of the monitor shows every angle in a 2x2 / 3x3 grid (Auto picks by angle count) with the active angle highlighted.
3. **Place on timeline** puts the source on a video track as one multicam clip (overwrite semantics; no time is added).
4. **Record**: plays the timeline; keys `1`-`9` cut to that angle at the playhead. Stopping (Stop, Space, end of timeline) commits the whole pass as **one undo step**. Cuts only land where there is footage on the chosen angle.
5. Parked on a cut, **click an angle** (or press its number) to switch that cut after the fact.
6. **Audio**: *Audio follows video* (default) or *Fixed audio: angle N* (the video clips are silenced and one audio clip from that angle runs under the whole cut on a "Multicam Audio" track).
7. **Flatten** turns every multicam clip into a plain clip of its active angle (one undo step).

Number keys 1-9 are unbound in every shortcut preset (a test guards this) and are only captured while the Multicam tab is active and no text field/dialog has focus.

## Model

`project.multicamSources` (optional) holds the angles and their offsets (`MulticamAngle.offset` = shared-timeline time at which that media's time 0 plays). A multicam clip is an ordinary clip of one angle's media tagged `metadata.multicam = { sourceId, angleId }`; its shared time at the clip start is `inPoint + offset`. Switching changes `mediaId`/`inPoint` only. Code: `packages/core/src/multicam/source.ts`, `audio-sync.ts`.

Because the cut is plain clips:

- **Sync lock / ripple**: edits that add or remove time run through the existing sync-lock planners; multicam edits themselves never change time.
- **Nests**: tags travel into a nest; open the nest and the monitor works on it.
- **Smart render**: a segment is stream-copied only if the existing frame-grid test proves it identical, otherwise it is re-encoded (a segment whose source frames fall between output frames is re-encoded).
- **Render cache**: an angle switch changes `mediaId`/`inPoint`, so exactly the switched span is invalidated.
- **Export queue**: exports the cut like any timeline.
- **Interchange**: XMEML writes a `multiclip` (every angle, offsets, active angle) on each cut and import rebuilds the multicam source; FCPXML writes `mc-clip` (import keeps the active angle only); OTIO and EDL export the cut flattened to the active angle and the report lists a "Multicam clip" entry per clip. See [interchange.md](interchange.md).

## Agent tools

`list_multicam_sources`, `create_multicam`, `switch_angle`, `record_multicam_cuts`, `flatten_multicam` (packages/agent). Each is one undo step. `create_multicam` audio sync needs a host that can decode audio (the live editor); otherwise pass `offsets`.

## Known limits

- During a recording pass the Program monitor and audio update when the pass is committed; the grid shows the live angle choice immediately.
- Angles can be switched at constant speed or reverse; ramped or frozen multicam clips cannot be cut. See [known-limitations.md](known-limitations.md).
- Audio sync analyses the first 180 s of each camera and searches +-120 s.
