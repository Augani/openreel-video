# Long-form soak and crash recovery (wave 10)

Everything before this wave was measured on short synthetic fixtures. This report is the first run on
feature-length material: a 110-minute, 787-clip, 9-video / 11-audio-track timeline built through the real
store paths, a 31-minute scripted session on it, and kill-the-app recovery tests in real Chrome and real
Electron. Machine: MacBook Pro, Apple M2 Pro, 16 GB, shared with other agents' builds, Chrome (stable
channel) with `--use-angle=metal`.

The harness is opt-in and not part of `pnpm test:e2e`:

```bash
pnpm --filter @openreel/web test:soak                       # generates sources, builds a prod bundle, runs everything
pnpm --filter @openreel/web test:soak -- soak.spec.ts       # one spec
SOAK_MINUTES=60 SOAK_MEDIA_DIR=/big/disk pnpm --filter @openreel/web test:soak
node apps/web/e2e/soak/gen-media.mjs <dir>                  # only the sources
pnpm --filter @openreel/desktop test:soak-e2e               # Electron (needs VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build)
```

Knobs: `SOAK_MINUTES` (30), `SOAK_CLIPS` (800), `SOAK_TIMELINE_MINUTES` (100), `SOAK_EXPORT_EVERY` /
`SOAK_AUTOSAVE_EVERY` (cycles), `SOAK_SOURCES` (regex on source names), `SOAK_CRASH_DIR` (keep a persistent
profile with crash reporting on), `SOAK_OUT` (JSON results).

## Material (`e2e/soak/gen-media.mjs`, ffmpeg only)

A 30 s seed with real motion, sensor-like noise and speech-like audio (amplitude-modulated pink noise over a
tone) is encoded once per profile and stream-copied in a loop to the target length. That keeps the GOP
structure, keyframe cadence, bitrate and moov size of a long file without an hour of x264 time per source.

| Source | Format | Length | Size | Notes |
|---|---|---|---|---|
| hd-h264-longgop | 1080p30 H.264 | 12 min | 372 MB | 250-frame GOP (8 s) |
| hd-h264-varkf | 1080p25 H.264 | 10 min | 274 MB | irregular forced keyframes (~7.3 s) plus scenecut |
| uhd-h264-longgop | 2160p30 H.264 | 10 min | 684 MB | 300-frame GOP (10 s) |
| uhd-hevc | 2160p24 HEVC | 10 min | 463 MB | |
| hd-hevc-vfr | 1080p HEVC | 10 min | 156 MB | variable frame rate (19.25 fps average) |
| odd-h264 | 1278x718 H.264 | 10 min | 198 MB | odd dimensions |
| hd-prores-422proxy | 1080p30 ProRes 422 Proxy | 3 min | 1107 MB | desktop only |

Timeline (`e2e/soak/build-timeline.ts`; each clip is one `clip/add`, each effect, transition, title, caption,
nest, bus the same store command the UI issues): 6630 s (110.5 min), 466 video + 321 audio = 787 clips, 9
video + 11 audio tracks plus Captions/Titles/Multicam-audio tracks, 53 transitions, 80 effects, 80 colour
grades, 40 titles, 27 graphics templates, 267 captions (SRT import), 3 nests, 1 multicam source, 3 audio
buses, 2 repair racks. Import of the six web sources (2.15 GB): 11.1 s. Building the timeline: 16.5 s on the
production bundle (90 s on the dev server). `clip/add` cost does not grow with the timeline: 3.8 ms for the
first 100 clips, 5.7 ms for the last 100. The undo stack was full (1000 entries) before the session began.

## Session (31.0 min, 149 cycles, production bundle)

Each cycle: 6 random scrubs, 6 s of playback from a random point, a burst of 5 edits (each verified to be
exactly one undo step; undo x5 and redo x5 compared against the pre-edit state digest), an auto-save every 3rd
cycle, a 3 s range export (640x360 H.264) every 4th cycle. A forced GC precedes each memory sample.

| Metric | Result |
|---|---|
| Scrub latency (feature timeline, 886 seeks) | p50 216 ms, p95 596 ms, max 1049 ms |
| Playback (149 runs, 52,375 frames) | 0.963x real time; 739 frames >25 ms (1.4%), 57 >50 ms (0.11%); worst frame 600 ms; 14.2 s of long tasks in 894 s of playback (1.6%) |
| Edit (one action) | p50 62 ms, p95 87 ms; undo p95 54 ms; redo p95 49 ms |
| Auto-save (49 forced saves) | p50 8 ms, max 234 ms; newest record 1.31 MB; 3 slots kept |
| Range exports (37, 3 s each) | p50 1.6 s, max 36.8 s |
| JS heap after GC | 111 MB after build, 128 MB at the end, drift +0.40 MB/min (limit 5) |
| Renderer RSS | 1.4 GB after build, 1.9 GB at the end, drift -40 MB/min (it falls after the first 4K warm-up) |
| Peak | renderer 5.6 GB and all browser processes 6.6 GB total, in the first minutes of 4K long-GOP playback; steady state 1.7-2.5 GB total |
| Undo history | 1000 entries (the cap), retains ~44 MB of JS heap |
| DOM nodes / listeners | 6.9k / 1844 at 2.5 min, 10.4k / 2040 at the end (fluctuates with the timeline viewport, no monotonic climb) |

Leak counters (probes installed before the app loads wrap `VideoFrame`, `createImageBitmap`, `Worker`,
`AudioContext`, `VideoDecoder`/`VideoEncoder`, OPFS handles, blob URLs): over the whole session 1,179,387
`VideoFrame`s were produced and 1,186,047 closed (0 live at the end); 14,287 decoders opened and closed; 37
encoders and 37 OPFS writables opened and closed; 0 OPFS sync handles live; 1 worker, constant; 5
`AudioContext`s live, constant (79 created, 74 closed); 60 blob URLs, constant. The soak asserts all of these.

Not leaks, but noted: 561 `ImageBitmap`s created by the app were never explicitly `close()`d (of 46,510),
growing slowly (342 at 2.5 min, 500 at 24 min) while the JS heap stays flat, so they are reclaimed by GC;
and 52,275 Web Audio nodes were dropped without `disconnect()` (73,955 created) which GC reclaims once
the source node ends. Both are cheap to tighten later; neither grows memory in 31 minutes.

### 4K long-GOP scrubbing, with and without proxies (`scrub-4k-proxy.spec.ts`)

4-minute stream-copied cut of the 4K H.264 source (10 s keyframes), 20 random seeks each:

| | p50 | p95 | max |
|---|---|---|---|
| Original (Toggle Proxies off) | 351 ms | 549 ms | 549 ms |
| 540p proxy (Toggle Proxies on) | 81 ms | 84 ms | 84 ms |

Proxy build: 24 s for 4 minutes of 4K H.264.

## What the soak found and what was fixed

1. **Export decoded each long-GOP source once per layer per frame (fixed).** The first soak export died:
   a 3 s range at 1580 s into the timeline was 26% done after 165 s (~8 s per output frame) and the renderer
   grew and shrank by gigabytes as decoders restarted. `ExportFrameDecoder` kept one forward iterator per
   source; when two layers showed the same file at different source times (stacked B-roll, split screens, a
   nest or multicam angle reusing a clip) every request looked like "time went backwards" and restarted decode
   at the previous keyframe, hundreds of 4K frames each. It now keeps up to 4 forward cursors per source and
   continues the nearest one behind the requested time (`packages/core/src/media/mediabunny-engine.ts`, 3 new
   tests in `mediabunny-export-decoder.test.ts`). After the fix the same export takes 8 s, and 12 random
   3 s ranges across the timeline took 3-10 s each (`e2e/soak/export-range.spec.ts` now guards <90 s).
2. **A slow frame is not a stuck export (fixed).** The per-frame render watchdog was 30 s; on the dense
   timeline a legitimately slow frame under machine load exceeded it and failed the job with "stopped
   responding". It is now `RENDER_FRAME_WATCHDOG_MS` = 120 s; a truly hung decoder still fails the export
   (two tests in `export-engine.test.ts`).
3. **The export queue copied the whole media library into IndexedDB on every first enqueue (fixed).** A
   feature project holds gigabytes of sources; the snapshot now references bytes the project store already
   holds (same size and type) and copies only what it does not. A crash during the copy used to leave an
   `interrupted` job with no snapshot to retry from. `loadSnapshot` fails cleanly (returns null) when the
   referenced bytes were replaced or removed (`export-queue-storage.ts`, 3 new tests).
4. **Exports and project saves are atomic on desktop (fixed).** The export writer opened the final path with
   `"w"`, truncating a good existing file at once, and a kill left a truncated file under the real name.
   It now writes `<path>.part`, `fsync`s and renames over the target on close; abort removes the part file.
   `writeTextFile` (project saves) already used temp-and-rename; it now `fsync`s the file and the directory.
   `openreel-*.part` and stale `*.<uuid>.tmp` files from a killed run are swept at startup and after saves
   (`apps/desktop/src/main/ipc/fs.ts`, `fs-writer.test.ts`).
5. **A soak against `vite dev` cannot run (harness finding, not a product bug).** React's DEV build
   structured-clones each component's props into `performance.measure` for its Performance track; with an
   800-clip project that fails with "Data cannot be cloned, out of memory" and the renderer crashes after
   about five minutes (seen in five runs, 1080p-only runs included; with no exports at all). The soak
   therefore only runs against a production bundle (`scripts/soak.mjs` builds one; the config refuses to run
   on the dev server unless `SOAK_ALLOW_DEV=1`). Editing also feels 4x faster in production (62 ms vs 250 ms).
6. Harness fixes: captions are text clips, so the build report counted 0 of them; fixed and asserted.

## Crash recovery

Real Chrome (`crash-recovery.spec.ts`, 120-clip, 12-minute project; renderer killed with `Page.crash`, the
signal an OOM or GPU-driver kill produces), all green:

* **Mid-edit.** 5 edits, wait for the auto-save, crash, fresh page in the same profile: the newest
  auto-save is found (2 slots), recovered in 150 ms, and the timeline is byte-identical (JSON compare) and
  has the same state digest. The recovered session starts a new undo history; the edits survive.
* **Inside the debounce window.** 3 more edits saved, 3 more not yet, crash: the page recovers the previous
  complete save, never a mixture (checked against both candidate states). Edits made in the last debounce
  window before a crash are lost by design.
* **Save storm x6.** 60 un-awaited edit + `forceSave` calls, crash at a pseudo-random 20-245 ms, six
  rounds: every auto-save record parses and the newest recovers every time.
* **Mid-export.** 6 s export at 10% progress, crash: the reloaded queue shows the job `interrupted` with
  "The editor was closed or reloaded while this export was running.", paused; Retry renders from the
  persisted snapshot and finishes (6.000 s H.264 640x360 + AAC, verified with ffprobe).

Real Electron (`apps/desktop/test/soak-electron.test.ts`, built app, `SIGKILL` of the main process, relaunch on
the same profile): mid-edit SIGKILL restores the newest auto-save (restored in 158 ms); mid-export SIGKILL
(native ffmpeg sidecar) relaunches with the job `interrupted` and paused, and Retry produces a full-length
file (>115 s, ffprobe). Atomic writes are covered by unit tests (`fs-writer.test.ts`: the export target appears only on
close and the old file survives until then; abort leaves an existing target alone; a failed rename removes
the temp file; stale `.part` / orphaned temp files are swept but young ones and other files are not).
These are not a kill-during-write test: the SIGKILL tests above kill during an export and during edits. A ProRes 422 Proxy source imports and plays on the desktop timeline at 0.64-0.79x real time (see gaps).

## Not run, or not good enough (honest list)

* The web session was 31 minutes, not 60, and ran once to completion on the production bundle. The runs on
  the dev server and an earlier partial run (before fix 1) are not in the numbers above.
* No long session in Electron. The desktop variant covers SIGKILL recovery, atomic writes and ProRes, not a
  30-minute memory soak; its memory behaviour is assumed to match the web renderer's.
* Project **load time** for the full 787-clip timeline was not measured (recovery was measured on a
  120-clip project: 150-158 ms). Auto-save serialisation was measured (8 ms p50) but not a cold open.
* The peak (renderer 5.6 GB, 6.6 GB total) happens in the first minutes of 4K playback and is not tuned;
  on an 8 GB machine that would be a problem. Steady state is 1.7-2.5 GB.
* Original ProRes playback is 0.64-0.79x real time at 1080p on desktop (Chromium has no ProRes decoder);
  proxies are the intended path, the soak does not exercise them for ProRes.
* Scrubbing 4K long-GOP originals is 351 ms p50 / 549 ms p95; only proxies bring it to ~80 ms.
* The `ImageBitmap` and Web Audio node counts above are GC-reclaimed, not closed; not changed.
* Playwright's `crash` event carries no reason, and Chrome produced no minidump under automation, so the
  dev-server crash was attributed from the console error (`DataCloneError ... out of memory`), not a dump.
* `project-preview-cache.test.ts` ("retries a failed encoding") failed once in a full web run under load and
  passes alone and on rerun; it is a file this wave did not touch.
