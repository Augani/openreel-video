# Android hardware release checklist

Target: **1.0.19, version code 20**. All physical checks below remain **PENDING**. A limited signed-release emulator smoke passed; the expanded device matrix is still pending. The reported Vivo V2055 is unavailable, and no physical phone is connected. Do not assume that the Vivo supports HDR.

`RC hash` in the tables means APK SHA-256 `a004a3b74b6664fd35d0a0035a0f5abefefaa1e6124577eeca87eea9c750f2a4`. Confirm that exact artifact before each run; record a new hash if the candidate changes.

The preceding debug validation passed 382 JVM tests, reported zero Android lint issues, and passed all 21 core device cases on API 33 and API 37.2 emulators. Each emulator's HDR run had one capability-probe pass and four unsupported skips. **No successful HDR export or physical HDR/display qualification is established.** See [the reliability review](ANDROID_RELIABILITY_REVIEW.md) for those debug measurements and evidence. They do not establish full qualification of the signed, minified 1.0.19 (20) artifact. The separate exact-APK API 33 smoke and artifact hashes are in [the local release handoff](ANDROID_RELEASE_1.0.19.md).

## Prepare a private local run

- [ ] Obtain the signed, minified RC APK; verify its signing certificate, package version and version code. Record its SHA-256 using `shasum -a 256 /path/to/app-release.apk` or `sha256sum`. Confirm it matches the defined `RC hash` above and record it with the device evidence.
- [ ] Record device model, Android version/API, firmware/build, RAM, available storage, display settings, date and operator. Use a new private evidence folder per device and APK.
- [ ] Use expendable fixture projects and preserve existing projects first. **Do not fill a user's storage, delete their files, force-stop their app or reboot their device without explicit operator consent.** Use a spare test device for disruptive checks. If consent or suitable hardware is unavailable, leave the relevant check PENDING.
- [ ] With consent, disable Wi-Fi/mobile data and enable airplane mode; verify there is no active default network. Keep inputs, exports, archives, logs and measurements local. Caption packs may be installed only through an explicit operator action; no automatic font, model or voice downloads are expected.
- [ ] Obtain the customer's failing SRT/media only with their consent, including the originally used app version if known. Keep their files private; redact names, file paths, caption/spoken text and identifiers before sharing an agreed diagnostic summary. No uploads or cloud processing are required.

The host script `scripts/run-android-checklist.sh` **refuses physical devices**. Its automatic storage filling and reboot phases are emulator-only. Do not adapt those actions onto a user's phone.

## Vivo V2055 / Android 13

Use the customer's files if obtained, then controlled fixtures. Record unavailable inputs as PENDING rather than substituting a successful fixture result for the original report.

| Status | Device | OS | APK SHA-256 | Action | Pass criteria | Local evidence |
| --- | --- | --- | --- | --- | --- | --- |
| PENDING | Vivo V2055 | Android 13; record build | RC hash | Import the reported movie SRT and large media. | Completes or gives a useful recoverable format/storage error; no crash, ANR, unexplained close or damaged saved project. | Consented input hashes, steps, result, redacted logcat. |
| PENDING | Vivo V2055 | Android 13 | RC hash | Import a two-hour timeline and 12,000 cues, including Unicode UTF-8 and UTF-16/BOM SRT. Open Text/Transcript; undo/redo. | Correct cue count/text/times; responsive progress and cancellation; panels remain usable. | Counts, timings, UI recording, memory samples. |
| PENDING | Vivo V2055 | Android 13 | RC hash | At the end of the movie, use fine zoom, scrub and move/trim by one project frame near a neighbour. | Playhead remains stationary during zoom; one-frame edits are possible without an unwanted snap; ruler, thumbnails and all lanes agree. | Requested FPS, before/after timecodes, UI recording. |
| PENDING | Vivo V2055 | Android 13 | RC hash | Import a real file larger than 2 GiB through SAF, including a provider that omits SIZE. Save, close and reopen it. | Full readable duration/size, usable waveform/preview, preserved clip and footage after reopen. If SIZE omission cannot be exercised, leave that subcase pending. | Source/imported or archived media hashes, provider/size behaviour, counts, PSS. |
| PENDING | Vivo V2055 | Android 13 | RC hash | Cancel known- and unknown-size imports partway through, then retry. | Partial work is reclaimed; no extra media item or unexplained retained storage; retry works; previous save remains intact. | Before/after storage, project/archive comparison, progress/error recording. |
| PENDING | Spare Vivo V2055 only | Android 13 | RC hash | Exercise low storage using an existing low-space state or an explicitly consented expendable setup; import, cancel and reopen. | Useful storage rejection, retained save capacity, no partial publication and unchanged saved project/assets. Restore test storage afterward. | Consent/setup, real free bytes, exact error, before/after archive hashes and storage. |
| PENDING | Vivo V2055 | Android 13 | RC hash | Export forward/reverse audio, animated captions, a local LUT and PIP/transition footage. Cancel/retry; background the app during a second export. | Correct picture/audio/timing; background export finishes; cancellation cleans up; subsequent export and editor reopen work. | Export metadata, decoded samples, redacted logs, scratch/storage observations. |
| PENDING | Vivo V2055 | Android 13 | RC hash | Compare short/long exports with equal effect density; sample baseline, peak and post-cleanup memory. With consent, force-stop after saving and cold-reopen. | No OOM/ANR or sustained memory growth proportional to frames/duration; saved cues, clips, timing, local LUT and footage survive. | PSS plus Java/native/GPU metrics where available, duration/effect counts, hashes and cold-reopen result. |

Read-only, operator-approved `adb shell dumpsys meminfo com.pythonxi.openreelvideo` can supplement device profiling. Record sampling frequency and measurement limits; emulator memory figures are not phone budgets. Signed release builds may prevent private-file inspection: use local archives, visible media counts and approved storage diagnostics, and record that limit.

## A separate, known HDR-capable device

Record the actual model/OS in every row. Probe display HDR10/PQ and HLG support, HEVC Main10 decoding, the relevant encoder's HDR/HLG editing feature, GLES 3 and `GL_EXT_YUV_target`. Capability claims alone are not an export or display pass.

Use the local `checklist-hdr-pq.mp4` and `checklist-hdr-hlg.mp4` assets: genuine one-second, 320×180, 30 fps HEVC Main10 BT.2020 fixtures. Their provenance is in `checklist-hdr-fixtures.json`; the offline generator is `scripts/generate-android-hdr-fixtures.py`. Choose a different output resolution, such as 480×270 or 1280×720, to force encoding. Record **requested and actual codec, HDR mode, resolution, FPS, duration, transfer, primaries and bit depth** using local stream metadata/SPS inspection. Do not infer 10-bit HDR from a filename or an HDR tag alone.

| Status | Device | OS | APK SHA-256 | Action | Pass criteria | Local evidence |
| --- | --- | --- | --- | --- | --- | --- |
| PENDING | Record HDR test phone | Record build/API | RC hash | Record display, decoder, encoder and graphics capabilities. | Probe is complete; it is labelled capability evidence only. | Capability report, exact device/display modes. |
| PENDING | Record HDR test phone | Record build/API | RC hash | PQ source, HDR on, HEVC, plain clip without SDR decorations. | Requested dimensions/FPS and duration; BT.2020/PQ, actual Main10 and 10-bit luma/chroma. Inspect shadows, highlights and colour on the HDR display. SDR fallback is not HDR preservation. | Original/output hashes, stream/SPS metadata, display observations. |
| PENDING | Record HDR test phone | Record build/API | RC hash | HLG source, HDR on, HEVC, plain clip. | Same geometry/cadence checks; BT.2020/HLG and actual 10-bit Main10; correct visible shadow/highlight/colour separation. | Metadata, decoded frames, display observations. |
| PENDING | Record HDR test phone | Record build/API | RC hash | Export PQ and HLG separately with HDR off, H.264. | Both outputs are SDR/BT.709 with expected dimensions/FPS/duration; no flat, inverted or badly clipped tone mapping. | Separate PQ/HLG metadata and visual results. |
| PENDING | Record HDR test phone | Record build/API | RC hash | Add local LUTs, captions/graphics or transitions with HDR requested. | The designed SDR path or a useful unsupported error is recorded accurately; SDR is never labelled preserved HDR. Layers, aspect, cadence and colour remain correct. | Requested/actual modes, metadata, comparison frames. |
| PENDING | Record HDR test phone | Record build/API | RC hash | Include audio; inspect aspect ratio, cuts, cadence and A/V sync during playback and export. | No cropped corners, dropped/held-frame surprises, incorrect pitch/channel order or sync drift. | FPS/timestamps, corner markers, audio/channel observations. |
| PENDING | Record unsupported device | Record build/API | RC hash | Exercise unavailable HDR decode/encode/graphics paths. | Finite, useful recoverable error; no raw shader dump, crash, stuck progress, partial published output or damaged save. Record UNSUPPORTED, never HDR PASS. | Capability/error pair, cleanup and reopen evidence. |

A screenshot, decoded SDR bitmap, probe-only pass or unsupported skip cannot qualify physical HDR display rendering.

## Installed caption packs

- [ ] On the signed RC and an identified physical device, explicitly install a supported caption pack if needed, then disable networking. Transcribe a private local audio fixture, edit/save/reopen the result, and confirm no cloud request is required. With a missing or unavailable pack, verify a clear recoverable message and no automatic download. Record pack version, language, device/OS, RC hash and local evidence. This physical check remains PENDING.

## Signed release candidate smoke and decision

- [x] Limited emulator smoke on the exact signed/minified RC: clean install/start, local video, UTF-16 captions, save, brief background H.264 export, force-stop and saved-project reopen passed offline on API 33. This does not complete the physical or expanded checks below.

- [ ] On the physical test device, install/upgrade to the **signed, minified 1.0.19 (20)** APK without erasing user data; confirm the installed version and the artifact hash. If signing prevents an upgrade, stop and investigate rather than uninstalling a user's saved projects.
- [ ] Repeat import/save/reopen, UTF-16 captions, local LUT preview/export, cancellation/retry and background export on that exact artifact. Check that minification, packaged shaders/assets and native codecs introduce no release-only failure.
- [ ] Repeat applicable HDR rows on that artifact. Record unsupported cases and unavailable hardware explicitly. Preserve private local evidence and remaining limitations with the release decision.

**Release status: PENDING physical Vivo/customer-file validation, known-capable HDR validation, installed caption packs and the expanded signed/minified device matrix. The limited offline release emulator smoke is complete.** Any accepted deferral must name the untested device/path; it must not be recorded as a passed check.
