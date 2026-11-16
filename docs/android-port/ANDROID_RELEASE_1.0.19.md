# Android 1.0.19 local release candidate

Prepared 18 October 2026: **1.0.19, version code 20**, package `com.pythonxi.openreelvideo`, minimum API 29, target API 37. The signed, minified AAB and APK are built and verified locally. Nothing has been uploaded or published. Physical Vivo and successful HDR qualification remain pending.

## Local handoff

Artifacts are in `Openreel Video Android/build/release-candidates/1.0.19-code20/`, which is ignored by Git. Preserve this folder with the candidate; rebuilding may produce different hashes.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `openreel-video-1.0.19-code20.aab` | 56,983,620 | `11694fa56897e2fb7fca689498ca5770d9c17ee4d0a91cc74784798ea92c69a4` |
| `openreel-video-1.0.19-code20.apk` | 137,674,275 | `a004a3b74b6664fd35d0a0035a0f5abefefaa1e6124577eeca87eea9c750f2a4` |

The folder also contains `mapping.txt`, APK metadata, release lint reports, the build log, verification reports, offline release-smoke evidence, release notes, a hardware-checklist snapshot, `release-manifest.json` and `SHA256SUMS`. No keystore or signing password is included. Run `shasum -a 256 -c SHA256SUMS` from that folder to verify its files.

Public update text: [Play release notes](../../Openreel%20Video%20Android/PLAY_RELEASE_NOTES_1.0.19.txt), a 382-character English body. [Full release notes](../../Openreel%20Video%20Android/RELEASE_NOTES_1.0.19.txt) include validation limits. Fixes cover movie SRT/large-media imports, bounded reverse/animated export memory, complete local LUT data, fine timeline zoom, project recovery, preview and export reliability, and HDR error handling. Editing and rendering retain local processing with no cloud-render fallback.

## Build and artifact checks

The existing `build-release.sh` obtained the configured upload-key password from macOS Keychain without printing it. The build's pinned certificate guard passed. From `Openreel Video Android/`, the local command was:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  ./build-release.sh \
  -Dorg.gradle.java.home='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  :app:assembleRelease :app:lintRelease --max-workers=2
```

The script also runs `:app:bundleRelease`. Gradle completed successfully in 3m 20s. Release minification and resource shrinking are enabled; the packaged manifest is non-debuggable. `lintRelease` reports **zero issues**, without a blanket lint baseline. Existing Kotlin/compiler and Gradle deprecation warnings remain in `build.log`; zero lint issues does not mean a warning-free compiler build.

- APK `apksigner verify`, 16 KB ZIP alignment and cached bundletool 1.18.3 AAB validation passed. APK and AAB manifests both report the version/package/SDK values above.
- Both signatures match the pinned upload-certificate SHA-1: `12:99:22:26:FA:67:D2:36:67:F8:97:0D:88:3A:5E:A4:68:3E:BD:87`.
- AAB JAR content-signature verification passed. Retained verifier warnings cover self-signed CA trust, no TSA timestamp, unsigned POSIX attributes and late-manifest streaming verification. The existing AGP output places the manifest near the end, so `JarInputStream` cannot verify it like `JarFile`. See `verification/jar-warning-qualification.txt`; no archive reordering or resigning was performed. Local verification does not establish Play server acceptance.
- The bundle embeds the R8 mapping, identical to the supplied 112,419,796-byte `mapping.txt`. Keep that mapping with this exact release for managed-code crash deobfuscation.
- All packaged arm64-v8a and x86_64 native LOAD segments satisfy 16 KB alignment/congruence; APK ZIP alignment also passed. The bundle contains 24 native libraries across its ABIs. This is packaging evidence, not device execution evidence for every ABI.
- **Native debug symbols are absent.** `FULL` metadata is requested, but no Android NDK is installed and vendor prebuilts lack full debug information. Neither the AAB nor the handoff contains a native-symbol ZIP. Native crash symbolication remains limited; installing an NDK alone cannot restore stripped vendor debug data.

This candidate includes the existing uncommitted audit fixes on `codex/finish-pending-work`, based on Git HEAD `b9e39ae374202702199d9675f7a97394027934b7`. It is not a build of that commit alone. No commit or tag was created. The manifest records this working-tree provenance; retain the source changes alongside the artifact.

## Validation and its limits

Earlier development-signed debug validation passed **382 JVM/Robolectric tests across 78 suites**, zero debug lint issues and **21 core device cases each on API 33 and API 37.2**. These include real imports over 2 GiB, long-caption/timeline cases, memory-bounded reverse exports, LUT fidelity, local archives and interrupted-project recovery. These results are documented in [the reliability review](ANDROID_RELIABILITY_REVIEW.md). They are not a full retest of the minified candidate.

The **exact signed APK hash above** passed a separate external UI smoke on a fresh API 33 arm64 emulator. The installed base APK was pulled and hash-matched. Airplane mode was enabled, Wi-Fi/mobile data disabled and the final active default network was `none`.

The smoke covered clean install/start and onboarding, project creation, local video import/preview, two UTF-16/BOM Unicode captions, save, export while briefly backgrounded, force-stop and cold reopen of the saved project. Both caption texts and the media timeline survived. The published local export was H.264, **854×480, 30 fps, 181 video frames, 6.033333 seconds**, with stereo 48 kHz AAC audio. A decoded frame confirmed caption rendering. The emulator crash buffer was empty. Evidence, screenshots and export metadata are in `smoke/`.

This smoke did not repeat release-mode long-media, LUT fidelity, low-storage, reverse-memory, cancellation/retry, installed-pack transcription, physical upgrade or HDR qualification. Keep those separate from the earlier debug checklist.

Each emulator's preceding HDR run had one capability-probe pass and four unsupported skips. There is still **no successful HDR-preserving export, HDR-to-SDR image qualification or physical HDR display pass**. Unsupported cases do not count as successful HDR tests.

## Remaining release decision

Use [the hardware release checklist](ANDROID_HARDWARE_RELEASE_CHECKLIST.md) to record results against this APK hash. The reported Vivo V2055 is unavailable and no physical phone was connected. Customer-file reproduction, Vivo memory/OEM-provider behavior, known HDR-capable encoding/display, installed caption packs and the expanded signed-device matrix remain PENDING. Do not assume Vivo HDR capability.

The standalone APK uses the upload key. A Play-installed app may use a different app-signing certificate and reject a direct APK upgrade. Preserve saved projects; do not uninstall a user's app to work around that mismatch. Validate the appropriate signed upgrade path before release.

Before any later upload, verify that code 20 is available for a new upload across the app’s Play tracks, resolve or explicitly accept the named hardware deferrals, and preserve the matching artifacts/mapping/evidence. Play state and release eligibility were not queried during this local preparation.
