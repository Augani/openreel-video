# Timeline interchange

Formats: Premiere Pro projects (`.prproj`, import only; see below), XMEML (Final Cut Pro 7 XML v5, what Premiere Pro and DaVinci Resolve
read), FCPXML 1.10, CMX3600 EDL, OpenTimelineIO (OTIO) and AAF (edit only). The pure code lives
in `packages/core/src/interchange`; the editor (File > Export timeline) and the
agent (`export_timeline_xml`, `import_timeline_xml`) share it.

## Which sequence is exported

Any sequence, open or not. `exportTimeline(project, format, { sequenceId })`
activates the chosen sequence on a copy (`projectForSequence`) and exports that;
without `sequenceId` the active sequence is exported. The file is named after
the sequence. UI: File > Export timeline > Choose sequence. Agent:
`export_timeline_xml { sequence: "<id or name>" }`.

## Nested sequences

| Format  | Nest clip (export)                                               | Import |
|---------|------------------------------------------------------------------|--------|
| XMEML   | `clipitem` that carries a full nested `<sequence>`; further instances of the same nest and the audio clipitems reference it by id (`<sequence id="sequence-2"/>`). A nest on an audio track writes the sequence in full there. | Rebuilt as a nested sequence: the `<sequence>` of a clipitem (inline or by id) becomes a real nest, one shared definition per id, in its own rate and size. |
| OTIO    | A `Stack.1` of the nested sequence's tracks inside the parent track, in the nested sequence's own rate (`metadata.openreel.nestedSequence` carries id, name, rate, size). | Rebuilt as a nested sequence. A `Stack` (or a bare `Track`) inside a track is a nest even from other tools: no `source_range` means the nest plays its whole length; a different rate than the parent is converted by time. Instances with the same `nestedSequence.id` share one definition. |
| FCPXML  | Compound clip: `<media><sequence>` + `<ref-clip>`, one `media` per nested sequence (shared between instances), retime as `timeMap`. | Rebuilt as a nested sequence. |
| EDL     | Flattened in place (EDL has no nesting). One report entry per nest. | n/a |

Committing an import (`applyTimelineImport`, one `project/applyEditSnapshot` = one undo step, used by File > Import timeline and the agent's `import_timeline_xml`) adds one project sequence per distinct nested definition (named after the nest, de-duplicated) and an instance record per nest clip, so a re-imported nest is an ordinary editable compound clip. A nest that contains itself is skipped with a warning; a nest that references a sequence missing from an XMEML file is skipped with a warning. A nest whose sequence has no clips is skipped with a warning.

Flattening for EDL (`nest-flatten.ts`) lays the nested tracks on extra tracks directly above the track that held the nest, converts frames to the parent's rate and clips them to the span the nest clip shows. Retimed nests (speed, reverse) are reported as approximated there.

Not carried through XMEML/OTIO nests: effects on the nest clip other than retime, opacity and level (they are dropped by the exporter and reported like any other clip).

## Multicam

| Format  | Multicam cut |
|---------|--------------|
| XMEML   | The clipitem stays an ordinary clip of the active angle's file (any reader plays it) and carries a `<multiclip id>` with one `<angle id>` per synchronised angle: `name`, `syncoffset` (frames), `offsetseconds` (exact seconds), `activevideo` / `activeaudio` and the angle's `<file>`. Import rebuilds the multicam source (angles, offsets, media relinked or offline placeholders, one `multicamSources` entry per distinct multiclip id, fresh ids) and tags each cut with its angle, so Angle switching and the multicam monitor work on the imported cut. Sync method is set to "manual" and audio to "follow". |
| FCPXML  | `<media><multicam>` with every angle and `<mc-clip>` per cut. Import reads the selected angle only (the other angles are not kept; reported). |
| OTIO, EDL | Flattened to the active angle's clip; one report entry per cut. |

The XMEML multiclip layout follows Final Cut Pro 7's `multiclip > angle` shape from memory; `offsetseconds` is an OpenReel addition (sub-frame sync offsets must survive). It was validated structurally (`validateXmeml`, `xmllint`) and by a round trip, but NOT opened in Premiere Pro or Resolve. If a host ignores the multiclip, it still gets the correct active-angle clips.

## Retime (OTIO)

A retimed clip or nest is written with a `LinearTimeWarp.1` effect (`time_scalar`, signed: negative plays backwards, never 0). A clip's `source_range` starts in the media's time (frames at the media rate; a nest: in the nested sequence's own time) and its `duration` is the length the item occupies in the parent track (timeline time), so the media consumed is `duration * |time_scalar|`. OTIO's core does not feed time effects into `Item.duration()` / `range_in_parent`, so occupying the timeline length is the convention readers lay out by. The exact end point is also kept in `metadata.openreel.outFrames`, so OpenReel round-trips exactly.
`validateOtio` rejects a missing, non-finite or zero `time_scalar`.

## Retime (XMEML)

A Time Remap filter (`speed` as percent, `reverse`) on the clipitem, nests included; nested audio clipitems carry the same filter. On read, a missing filter falls back to the ratio of source frames to timeline frames.

## Verification status

Read this before relying on an export in another editor.

| Format | Verified | NOT verified |
|--------|----------|--------------|
| XMEML | OpenReel's own importer (round trip, `nest-roundtrip.test.ts`); `validateXmeml`; `xmllint --noout` well-formedness | Opening in Adobe Premiere Pro or DaVinci Resolve. The multiclip layout follows Final Cut Pro 7 from memory. |
| FCPXML | OpenReel's own importer (round trip) and structural tests | Opening in Final Cut Pro or Resolve. No DTD validation is run. |
| OTIO | OpenReel's own importer; `validateOtio`; the reference `opentimelineio` Python reader (0.18.1, one manual run on a developer machine, 7 nest/retime files; not in CI) | Opening in an NLE that reads OTIO. |
| EDL (CMX3600) | OpenReel's own importer and format tests | Importing in Premiere, Resolve or Avid. |
| AAF | OpenReel's own AAF reader and structural tests | Opening in Avid Media Composer, Premiere Pro or Resolve. |

In short: every format is checked against OpenReel's own importer and our spec validators. Round-trip through other NLEs (Premiere Pro, DaVinci Resolve, Final Cut Pro, Avid) has NOT been verified. The export dialog shows the same note. When an NLE round trip is actually tested, record the application, version and result here before changing the wording.

## Round-trip tests

`nest-roundtrip.test.ts` exports a project, re-imports it and compares the neutral sequence structure (names, ranges, retimes, volume/opacity, nested sequences recursively, multicam angles and offsets; ids excluded) for XMEML and OTIO: plain nests, nests with audio, retimed nests (2x, 0.5x, reverse, reverse 2x), retimed clips inside a nest, shared instances, a nest at another frame rate, nests on an audio track, foreign OTIO stacks, and XMEML multiclips (including inside a nest and with a sub-frame offset). It also commits the import to a project and exports again to prove the structure is stable through the project.

## Validation in tests

`xmllint --noout` (well-formedness) runs in the XMEML tests and the e2e specs; a missing `xmllint` fails them. `validateXmeml` / `validateOtio` check the structural contract (nested sequences and multiclips included).

### Reference OTIO validation

`packages/core/scripts/validate-otio.py` loads the OTIO output with the real `opentimelineio` Python package and checks it:

```
python3 -m venv /path/to/otio-venv && /path/to/otio-venv/bin/pip install opentimelineio
OTIO_DUMP_DIR=/tmp/otio-out pnpm --filter @openreel/core exec vitest run src/interchange/nest-roundtrip.test.ts
/path/to/otio-venv/bin/python packages/core/scripts/validate-otio.py /tmp/otio-out
```

Per file: the reference reader loads it, a write/read cycle through the library is lossless, tracks lay out gap-free by item duration, nested Stacks hold Tracks and a `source_range`, every `LinearTimeWarp` `time_scalar` equals metadata speed (negative when reversed), the media a clip or nest consumes (`source_range.duration * |time_scalar|`) ends at `outFrames`, and `flatten_stack` accepts the video tracks.

Result (opentimelineio 0.18.1, Python 3.13, 7 files: plain nest, nest retimed 2x / 0.5x / reverse / reverse 2x, a retimed clip inside a nest, a nest at 24 fps in a 30 fps timeline): all pass. The reference confirms the convention above: `Item.duration()` equals the occupied timeline length and does not apply the time warp. The reference library was only run on a developer machine, not in CI (it needs `pip install`); the vitest tests use `validateOtio`.

## AAF

File > Export timeline > AAF (Avid/Premiere/Resolve) writes an `.aaf`; File > Import timeline > AAF… reads one
(the "Timeline XML…" picker accepts `.aaf` too). Both go through the same pipeline as the other formats: export
through `exportTimeline(project, "aaf")` (binary bytes in `files[0].bytes`), import through `importAaf` /
`importTimelineFile`, committed as ONE undoable `project/applyEditSnapshot` (replace or append), with media
relinked to the bin by file name and unmatched media added as offline placeholders. The desktop app uses the same
renderer code, menu and download / file-chooser path as the web app. The agent text tools do not return AAF (it is
binary).

Code: `packages/core/src/interchange/aaf/`

* `cfb.ts`: Microsoft Compound File Binary reader and writer (v3/v4, mini stream, DIFAT on read; writes v4,
  4096-byte sectors, like pyaaf2 and the AAF SDK's "4K" files). Hand written: no CFB npm package is used.
* `objects.ts`, `ids.ts`: the AAF structured-storage object layer (a storage per object, CLSID = class AUID,
  a `properties` stream, strong references as child storages, vector / set index streams, weak references through
  the `referenced properties` table) and the property, class, data definition and operation ids.
* `template.ts` (generated by `packages/core/scripts/gen-aaf-template.py`), `inflate.ts`: an AAF file carries the
  full ~1,900-entry AAF meta dictionary plus the Header, Dictionary and Identification. The writer starts from an
  empty pyaaf2 file (pyaaf2 output is read by Avid, Premiere and Resolve; 45 KB deflated, base64 in the source)
  and replaces the Content storage with the edit. `inflate.ts` unpacks it (dependency free, synchronous).
* `aaf-writer.ts`, `aaf-reader.ts`: the neutral `Sequence` to and from AAF.

### What is written

One Composition MOB (UsageCode TopLevel) with: a timecode slot (start 01:00:00:00 by default, fps and drop-frame
flag), one picture slot per video track and one sound slot per audio track (a stereo track becomes an L and an R
slot, as Premiere does), each a Sequence of SourceClips and Fillers; the edit rate is the project rate (23.976,
29.97 etc. as the exact rational). A video clip that plays its own sound gets a paired audio slot, like the XMEML
writer. Every media file becomes a MasterMob that refers to a SourceMob whose ImportDescriptor holds a
NetworkLocator `file://` URL (path and file name) and one slot per picture / sound channel; media is never
embedded. Source in/out are SourceClip StartTime and Length (composition edit units). Clip speed and reverse: an
OperationGroup VideoSpeedControl with a constant SpeedRatio (negative = reverse). Dissolves: a Transition (video
dissolve OperationGroup) between the clips with the AAF overlap semantics (the neighbours borrow the transition's
frames from their handles; a sequence is as long as its segments minus its transitions); the dissolve is
shortened, and reported, when there are not enough source frames. Clip level and track level (the track fader):
OperationGroup MonoAudioGain with a constant Amplitude. Markers: an EventMobSlot of DescriptiveMarkers (Position,
Length for range markers, Comment = name, then a newline and the comment).

Import reads those and what pyaaf2 writes for the same things: it follows Composition slots -> SourceClip ->
MasterMob -> SourceMob (summing StartTime offsets) to the file location, folds stereo mono pairs and a video
clip's identical audio slot back into one, and imports constant speed, constant gain, dissolves (cut point
respected), CommentMarkers / DescriptiveMarkers and the start timecode (reported, not stored).

### Not carried

* Effects, colour, keyframes, titles, graphics, transforms and opacity (the export report lists them per clip; AAF
  effect parameters are not interoperable between hosts anyway). Effect operation groups on import are dropped with
  a warning.
* Nested sequences: flattened on export (reported); a clip that refers to another composition on import is dropped
  with a warning. Multicam: flattened to the active angle.
* Embedded media (essence): never written, and not extracted on import; media is relinked by name or added as an
  offline placeholder.
* Audio retiming (audio speed), fades, pan, audio dissolves, keyframed speed and gain (only constants).
* Marker colour; track lock, targeting, sync lock and track mute / hide flags; EssenceGroup, Selector and
  NestedScope components on import (left as gaps with a warning).
* The start timecode on import (OpenReel sequences have none).

### How it was checked

* `aaf/aaf.test.ts`: CFB writer / reader round trip (512 and 4096 byte sectors), the DEFLATE decoder against node
  zlib, AUID byte layout against bytes copied from a pyaaf2 file, a committed pyaaf2-written fixture
  (`__fixtures__/pyaaf2-cut.aaf.gz`) read by the importer, export -> import round trips of the shared interchange
  project at 8 frame rates (clips, speed, reverse, levels, dissolve, markers), timecode / drop-frame, track level
  and handle clamping.
* `aaf/aaf-pyaaf2.test.ts`: **pyaaf2 1.7.1** (an independent AAF implementation) reads the exported file through
  `scripts/aaf-read.py` (composition, edit rate, timecode, slots, clip names and source ranges, transition cut
  point, speed ratio, gain, markers, media mobs and locators) and writes the fixture the importer must read
  (`scripts/aaf-make-fixture.py`). It needs `pip install pyaaf2` and is skipped, not run, without it; point
  `OPENREEL_PYAAF2_PYTHON` at the Python that has it. A second container check, `olefile`, opened an export and read
  every stream (one-off, not in the tests).
* e2e `apps/web/e2e/interchange-aaf.spec.ts`: real editor, export to `.aaf`, read back with the core reader and
  (when installed) pyaaf2, re-import with Replace (one undo step restores it), import of the pyaaf2 fixture with
  placeholders.
* **Not verified**: the files were not opened in Avid Media Composer, Premiere Pro or DaVinci Resolve (none is
  available here). They follow the pyaaf2 layout those tools read, but host-specific behaviour (how a host
  resolves linked media from an ImportDescriptor, how it reads a dissolve at a clip boundary, stereo as two mono
  slots) is untested.

## Premiere Pro project (.prproj), import only

File > Import timeline > Premiere project (.prproj)..., the "Timeline XML..." picker and dropping a `.prproj` on the Project panel all open the same import dialog (sequence picker, import report, offline media list), then commit one undoable `project/applyEditSnapshot` (replace or append). The parser is loaded on demand (`@openreel/core/interchange/prproj`), so it is not part of the editor's first load. There is no `.prproj` export and no agent tool.

A `.prproj` is gzip-compressed XML (`<PremiereData Version="3">`) of flat objects linked by `ObjectID`/`ObjectRef` and `ObjectUID`/`ObjectURef`. The importer walks:

```
RootProjectItem / BinProjectItem > ProjectItemContainer > Items > Item        bins and project items
ClipProjectItem > MasterClip > Clips > Clip (VideoClip | AudioClip)
  > Clip > Source (VideoMediaSource | AudioMediaSource) > MediaSource > Media  FilePath, ActualMediaFilePath, RelativePath, VideoStream, AudioStream
Sequence > TrackGroups > TrackGroup (First 0 video / 1 audio, Second) > VideoTrackGroup | AudioTrackGroup
  > TrackGroup > Tracks > Track > VideoClipTrack | AudioClipTrack
  > ClipTrack > ClipItems > TrackItems > TrackItem > VideoClipTrackItem | AudioClipTrackItem
  > ClipTrackItem > TrackItem > Start / End (ticks), SubClip > Clip (InPoint / OutPoint),
    ComponentOwner > Components > VideoComponentChain > VideoFilterComponent > Params > VideoComponentParam
Sequence > Markers > Marker (Start, Duration, Name, Comment, Type)
ClipTrack > TransitionItems > VideoTransitionItem
```

Times are ticks: 254016000000 per second, parsed as BigInt so a 10 hour sequence keeps its frames (`ticksToFrames` is exact rational arithmetic, rounded to the nearest frame). A stream or track group `FrameRate` is ticks per frame. Out points beyond 2^60 (Premiere's "whole clip" sentinels) are treated as missing. Speed is `(out - in) / (end - start)` unless the item states `Speed` / `PlaybackSpeed`; `Reversed` / `PlayBackwards` or a negative speed reverse.

What each piece becomes is listed in `docs/PREMIERE-GAPS.md` ("`.prproj` import"). The report (`importReport` on the import result) counts dropped and approximated items per clip and carries notes for what is never read.

Verification status: OpenReel's own tests with hand-authored fixtures only (`__fixtures__/main-cut.prproj`, generated by `packages/core/scripts/gen-prproj-fixture.py`; the readable XML sits next to it). A project written by Adobe Premiere Pro has NOT been opened with this importer.
