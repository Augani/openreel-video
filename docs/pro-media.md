# Pro media: MXF ingest and ProRes / DNxHR delivery

## What each build does

| | Desktop (ffmpeg sidecar) | Web (browser) |
|---|---|---|
| MXF OP1a / OP-Atom with DNxHD, DNxHR, XDCAM HD422 (MPEG-2 4:2:2), AVC-Intra | Imported as-is. Probed and decoded frame by frame by the sidecar, the same path as ProRes (no proxy, no copy of the file). | No demuxer. The in-browser converter makes an H.264/VP9 proxy and the app says so ("Editing a browser proxy"). If the converter cannot read it, the error names the desktop app and the formats to convert to. |
| Multi-track PCM audio in MXF | One audio track per mono PCM stream (`audioTrackCount`), waveform and mixdown through the sidecar. | Whatever the converted proxy kept. |
| XDCAM HD422 (MPEG-2 4:2:2, 50 Mb/s) and AVC-Intra 100 in MXF OP1a / OP-Atom (or MOV) | Export dialog (codec XDCAM HD422 / AVC-Intra 100, format MXF) and the "Delivery" broadcast presets. See "Broadcast delivery" below. | Export is refused with the "requires the desktop encoder" notice; the dialog explains what is missing. |
| Per-channel mono PCM tracks and a start timecode in MXF / MOV | Export dialog "Broadcast delivery" section, delivery presets, sequence start timecode in the Preview menu. | Not written (the notice says the desktop app does). |
| ProRes 422 HQ / 4444 (with alpha), MOV | Export presets "Delivery" and the Export dialog (codec ProRes, profile, alpha switch). | Export is refused with the "requires the desktop encoder" notice and the H.264 MP4 fallback. |
| DNxHR LB / SQ / HQ / HQX / 444 in MXF or MOV | Export dialog (codec DNxHR, format MXF or MOV, profile) and "Delivery" presets (HQ, HQX). | Same notice. |
| Camera RAW | Not supported (see below). | Not supported. |

## Ingest details

- A file is routed to the sidecar when its codec is not decodable by WebCodecs (ProRes, DNxHD, MPEG-2, ...) **or** it is in a pro wrapper (`.mxf`), whatever codec it holds. AVC-Intra is H.264, which WebCodecs knows, but no browser opens the MXF around it.
- Probe (`apps/desktop/src/main/ingest/probe-media.ts`): demuxer name, every audio stream (codec, channels, sample rate), interlaced field order. `NativeSourceProbe` carries `container`, `audioStreams`, `interlaced`.
- Interlaced sources (XDCAM HD422 1080i) are decoded as stored: fields are not deinterlaced, in preview or export.
- Audio extraction for a natively decoded file reads the file where it lives; it is no longer copied to a temp file first (a multi-gigabyte camera file was copied just to pull its audio).

## Delivery export details

- Encoders: `prores_videotoolbox` / `prores_ks` (ProRes), `dnxhd` (DNxHR). ProRes 4444 and 4444 XQ always use `prores_ks` (VideoToolbox writes 4:2:2 only).
- Pixel formats: ProRes 422 family `yuv422p10le`; 4444 `yuv444p10le`, with the alpha option `yuva444p10le`; DNxHR LB/SQ/HQ `yuv422p`, HQX `yuv422p10le`, 444 `yuv444p10le`.
- Alpha: the "Write alpha channel" switch (ProRes 4444 / 4444 XQ only) renders over a transparent background and writes the alpha plane. Without it 4444 is opaque.
- Audio: 24-bit PCM (`pcm_s24le`) for ProRes, DNxHR, XDCAM / AVC-Intra and any MXF. MXF requires PCM. The default mix is stereo: QuickTime holds it as one 2-channel track, MXF as the muxer splits it. Per-channel mono tracks are the "Broadcast delivery" option below.
- MXF is always written with an explicit `-f mxf`; embedded subtitle tracks are skipped for MXF (the dialog says so, use a sidecar caption file).
- Smart render does not apply to DNxHR (only AVC/HEVC/ProRes copy runs).

## Broadcast delivery (XDCAM HD422, AVC-Intra 100, OP-Atom, mono tracks, timecode)

All of it is written by the ffmpeg sidecar (`apps/desktop/src/main/sidecar/encode-args.ts`, `export-job.ts`), configured from the Export dialog
(`ExportBroadcastOptions.tsx`) or the "Delivery" presets, and verified by `apps/desktop/test/broadcast-delivery.integration.test.ts` and the
Electron e2e in `pro-media-e2e.electron.test.ts` (both read the files back with ffprobe).

- **XDCAM HD422** (`mpeg2video`): 4:2:2 Profile @ High Level (ffprobe `profile=4:2:2`, `level=2`), `yuv422p`, 50 Mb/s CBR (min = max = 50000k, VBV 36408333 bit),
  GOP 12 (15 in the 29.97 / 30 family), 2 B frames, intra DC precision 10, intra VLC, non-linear quantiser, `qmax` 8, strict GOP, no scene-cut GOPs.
  1920x1080 or 1280x720; 23.976 to 30 fps at 1080, up to 60 fps at 720p. MXF OP1a (`-f mxf`) or MOV.
- **AVC-Intra 100** (`libx264`): libx264's `avcintra-class=100` mode, so the stream is `h264` profile `High 4:2:2 Intra`, level 4.1, `yuv422p10le`, all intra
  frames, BT.709 tagged. MXF OP1a or MOV, 1920x1080 / 1280x720. It needs an ffmpeg with libx264: the shipped GPL ffmpeg has it; an `OPENREEL_FFMPEG_PATH`
  build without it gets the message "This ffmpeg build has no libx264 encoder, which AVC-Intra 100 needs". Only class 100 is offered (no AVC-Intra 50 / 200).
- **Scan**: progressive, or top-field-first interlaced (`field_order=tt`; XDCAM `+ildct+ilme -top 1`, x264 `-field_order tt -flags +ildct`). The timeline is
  rendered progressive: 1080i25 is delivered as 25 segmented frames flagged top-field-first (the usual workflow for 1080i from a progressive edit). No field-rate rendering.
- **MXF OP-Atom**: one `mxf_opatom` file per essence track beside the chosen name: `name_V01.mxf` for the picture and `name_A01.mxf`, `name_A02.mxf`, ... one per mono
  audio track. Every file carries the start timecode. Without an explicit track count, OP-Atom writes the stereo mix as two mono files.
- **Mono PCM tracks** (MXF OP1a and MOV): 2, 4, 8 or 16 tracks of 24-bit PCM, each its own mono stream (`asplit` + `pan=mono`). Tracks 1 and 2 are the stereo mix (left,
  right); tracks 3 and up are silence, or the mono Essential Sound stems (Dialogue, Music, FX, Ambience, Untyped, in that order, the same isolation the stem export uses)
  rendered from the same offline mixdown. Stems cannot be combined with loudness normalisation (the dialog says so; use silent extra tracks with it).
- **Timecode out**: `-timecode` writes a QuickTime timecode track (`tmcd`, also on the video stream's `timecode` tag) or the MXF timecode component (ffprobe `format.tags.timecode`).
  The value is the dialog's Start timecode, else the sequence start timecode (Preview menu, "Sequence start timecode": 00:00:00:00, 01:00:00:00, 10:00:00:00; a project setting
  changed through `project/updateSettings`, so it is one undo step and saved with the project). A range export offsets it by the In point. `;` before the frames (29.97 / 59.94)
  writes drop frame. Smart-render MOV exports get the timecode too; a delivery with mono tracks, OP-Atom or a broadcast codec is always rendered in full.
- **Timecode in**: the probe reads the MOV timecode track / MXF timecode component (`MediaProbe.startTimecode`). On import it is stored as
  `metadata.startTimecode` (seconds) and `startTimecodeText` (as read), shown in the Project panel list ("Start TC" column, optional), and in the Inspector
  clip header as `SRC <in> -> <out>` (the file's start timecode plus the clip's In and Out). Read for `.mov`, `.mxf`, `.mp4`, `.m4v` on the desktop build.
- **Interchange**: EDL source columns are source timecode (file start + In / Out) and the record columns start at the sequence start timecode (01:00:00:00 stays the default
  when none is set); XMEML writes the file `<timecode>` and the sequence `<timecode>`; FCPXML writes the asset `start` and offsets the clip `start` by it.
- **Preview**: the playhead timecode readout shows the sequence timecode (start plus position, drop-frame aware) and accepts a typed sequence timecode, so the preview matches the exported file.

## Not done / out of scope

- BWF / AS-11 metadata (the BWF `bext` chunk, AS-11 UK DPP / AS-10 descriptive metadata, `time_reference`), MXF user-comment / clip metadata, SMPTE ST 2067 / IMF, and the
  MXF audio channel-layout labelling (mono tracks are plain PCM, not tagged as L / R / dialogue sub-descriptors).
- XDCAM HD 35 / 18, XDCAM HD422 at 1440x1080, AVC-Intra 50 / 200 and AVC-Intra long-GOP.
- True field-based interlaced rendering (the timeline is progressive; 1080i is segmented-frame delivery).
- Sequence start timecode in FCPXML (`tcStart`), the OTIO `source_range` start, reading the file `<timecode>` back from XMEML on import, and AAF (not exported at all).
- The timeline ruler and the Source Monitor still count from 00:00:00:00; the playhead readout, Inspector, exports and file tags carry the timecodes.
- Timecode of audio-only files (WAV `bext` time reference), and of MP4 (no timecode track is written in MP4 / WebM).

- **Camera RAW**: REDCODE R3D, ARRIRAW, Blackmagic RAW, Sony X-OCN, CinemaDNG. They need the vendors' SDKs (licensing, binaries). Debayer to ProRes or DNxHR first and import that. The web build says so for those extensions.
- Deinterlacing of interlaced MXF sources.
- Audio is exported from the 16-bit PCM mix the renderer hands the sidecar and stored as 24-bit.
