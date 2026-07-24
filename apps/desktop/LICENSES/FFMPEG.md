# FFmpeg — license & attribution

OpenReel Desktop bundles a prebuilt **FFmpeg** binary (one per platform/arch
under `resources/bin/<platform>-<arch>/`) which it invokes **as a separate
process** for video/audio export, transcoding, and stream probing. FFmpeg is not
linked into the OpenReel application; it is executed across the OS process
boundary.

## License

All bundled FFmpeg builds are configured with `--enable-gpl` (they include
`libx264` and `libx265`) and are therefore distributed under the **GNU General
Public License**. None are built `--enable-nonfree` — this is enforced at fetch
time by `scripts/fetch-ffmpeg.mjs`, which refuses any non-redistributable build.

- The macOS x64, Linux, and Windows builds are additionally configured with
  `--enable-version3` → **GPL-3.0-or-later**.
- The macOS arm64 build is **GPL-2.0-or-later**.

The full license texts are bundled alongside this file: `GPL-3.0.txt` and
`GPL-2.0.txt`.

- FFmpeg project: <https://ffmpeg.org> · license overview: <https://ffmpeg.org/legal.html>

FFmpeg is © the FFmpeg developers. `libx264` is © VideoLAN; `libx265` is
© MulticoreWare / the x265 project. All are used under the GPL.

## Build provenance (per platform)

There is no single immutable, GPL-clean, statically-linked source that covers
every target, so the slots come from two sources. Exact versions + SHA-256
digests are recorded in `resources/bin/MANIFEST.json` and verified on every
fetch.

| Slot | FFmpeg | Source |
|---|---|---|
| `darwin-arm64` | 7.1 | OSXExperts — <https://www.osxexperts.net> (GPL static) |
| `darwin-x64` | 6.1.1 | ffmpeg-static `b6.1.1` (Evermeet build) — <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1> |
| `linux-x64` | 6.1.1 | ffmpeg-static `b6.1.1` |
| `win32-x64` | 6.1.1 | ffmpeg-static `b6.1.1` |

(ffmpeg-static's own `darwin-arm64` asset is built `--enable-nonfree` and is
therefore **not** used.)

## Written offer for source code

In accordance with the GPL, the complete corresponding source code for each
bundled FFmpeg version — together with the build configuration used — is
available from the upstream FFmpeg repository at the matching release tag:

- <https://github.com/FFmpeg/FFmpeg> — tags `n7.1` (macOS arm64) and `n6.1.1`
  (all other slots).
- Build definitions: <https://github.com/eugeneware/ffmpeg-static> and
  <https://www.osxexperts.net>.

You may also obtain the corresponding source from OpenReel for three years from
the date of distribution by contacting **support@openreel.video** *(replace with
the real contact before shipping)*; we will provide it by download link or on a
physical medium for no more than our reasonable cost of distribution.

## Separation from OpenReel

OpenReel Desktop (the Electron application and its own source) is **not** a
derivative work of FFmpeg and is licensed separately. Only the FFmpeg binaries in
`resources/bin/` are covered by the GPL terms above.
