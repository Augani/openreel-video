# OpenReel — Feature Roadmap & Gap Analysis

> Generated 2026-05-31 from a code-grounded audit of the editor benchmarked against
> DaVinci Resolve, Premiere Pro, Final Cut Pro, and CapCut.
> Audience: browser-based creator / social-video editor.
> Load-bearing claims were spot-checked against the actual source.

The dominant theme: a lot of capability is **built in the engine but stranded** (no UI),
**faked** (heuristic/synthetic), or **silently broken** (UI advertises behavior the code
doesn't deliver). Many "gaps" are therefore *finish-what-we-started*, not build-from-scratch.

---

## 1. Where we're already strong (not a toy)

- **Color grading is pro-tier** — real WebGL2 primary wheels, RGB + per-channel curves with spline interpolation, 8-band HSL, 3D LUT import (.cube/.3dl, trilinear), full scopes (waveform / RGB parade / vectorscope / histogram). Matches/beats CapCut, rivals the NLEs.
- **Deep audio DSP** — Web Audio mixing console, parametric biquad EQ, dynamics compressor, convolution reverb/delay, FFT spectral noise reduction with learned profiles, ducking, keyframeable volume/pan.
- **Solid compositing** — 12 separable blend modes, vector + freehand masks (feather/keyframes), track mattes, two chroma-key engines with spill suppression, AI background removal, real optical-flow stabilization.
- **Text & motion graphics breadth** — custom-font upload, ~50 in/out + emphasis animation presets, true 3D extruded text (Three.js), GSAP motion paths, word-level karaoke captions.
- **Modern export** — WebCodecs + mediabunny (H.264/265, VP9/AV1, MOV), streaming-to-disk, device-aware codec recommendation, rich social-preset library.

## 2. The "stranded / faked / misleading" backlog (highest ROI — finish what exists)

| Item | State | Fix |
|---|---|---|
| **Slip / slide / roll** | Full store actions, **zero UI triggers** | Add drag handles + shortcuts |
| **Proxy pipeline** | Complete core engine (`generateProxy`, presets, thresholds), **zero app usage** | Wire to import + playback, add full/proxy toggle |
| **Compound/nested clips & multicam** | Engines exist but live in-memory, don't persist to timeline, don't render/export | Add nested clip to Clip/Timeline types + render path |
| **Motion tracking** | Full UI, but `MotionTrackingEngine.simulateTracking()` returns synthetic `Math.sin`/random | Swap in the existing optical-flow tracker |
| **Caption export** | `exportSRT()` in core+store, **no download UI**, no VTT, captions always hard-burned | Add SRT/VTT download + burn-in on/off toggle |
| **Background export** | `export-worker.ts` exists but **never instantiated**; export blocks the main thread | Instantiate worker, move encode off-thread |
| **Keyframes** | Engine animates transform + brightness/contrast/saturation/blur + a real graph editor, but UI only keyframes **6 transform props** | Expose "keyframe any parameter" (effects/color/audio/crop) |

**Honesty / correctness bugs (misleading UI — fix now):**
- Picking **ProRes** silently exports **H.264** (`export-engine.ts:239`).
- The **"Hardware accelerated" badge is shown but not honored** — export forces `prefer-software` (`export-engine.ts:382`); the unused worker already uses `prefer-hardware`.
- **cbr/vbr** and **colorDepth** options are accepted but never passed to the encoder.
- 4 blend modes (Hue/Sat/Color/Luminosity) are listed but render as **Normal** (no cases in `applyBlendMode`).

## 3. Top genuinely-missing features

- **Transcript-based editing** (edit by deleting/reordering words) — *Resolve/Premiere/CapCut.* We have word-level timestamps + captions but no word→clip-range edit model. **#1 table-stakes miss** for the social/podcast audience. Unlocks filler-word ("um/uh") removal.
- **ML audio/video now treated as baseline** — voice isolation / enhance-speech (we have spectral, not ML), per-object **smart roto mask** (Magic Mask / Roto Brush).
- **Secondaries / qualifiers + power windows** — grades are whole-clip only; can't do tracked skin/sky/product grades (mask + tracker exist, not wired into the grade path). Plus **Hue-vs-Hue/Sat/Luma** warper curves.
- **Render/export queue + batch** (export to YouTube + TikTok + Reels in one pass).
- **Bins / folders / smart bins + editable clip metadata** (tags, ratings, color labels) — media is a flat array with name-search only.
- **3-point editing**: insert/overwrite edit modes, source-side in/out marking, magnetic/auto-ripple timeline (CapCut-style).

## 4. Quick wins (high impact, low effort)

- Honor hardware encode (≈1-line) and **drop the fake ProRes/cbr/colorDepth options**
- SRT/VTT sidecar download + burn-in on/off toggle
- Wire slip/slide/roll into the UI
- Implement the 4 missing blend modes (Hue/Sat/Color/Luminosity)
- Gradient / image-filled title text; rounded/pill text backgrounds
- Surface one-click "Normalize to LUFS" + "Enhance speech" (already in `audio-bridge.ts`)
- ½/¼ preview-resolution toggle + cache-size control
- Bundled starter LUT/look pack with thumbnails
- "Used in timeline" badge + delete-unused media; Duplicate project

## 5. Big bets (architectural)

1. **Transcript-based editing** model + sync UI — highest strategic ROI (data foundation exists).
2. **Wire the proxy pipeline + a composited-timeline render-ahead cache** — fixes the core "smooth 4K in a browser" ceiling.
3. **Real ML** for the faked AI: optical-flow tracker for motion tracking, MediaPipe FaceDetector for reframe, SAM/MODNet for per-object roto.
4. **Local grade engine** — secondaries/qualifiers + power windows (reuse mask + tracking engines).
5. **Render/export queue + true background export.**
6. **Cloud projects + realtime collaboration + review/comment** (no backend today; the action-log is a reasonable op-log foundation).
7. **Lottie / MoGRT template import** — the importer already has a `lottie` branch that warns "unsupported"; wire `lottie-web`.

## 6. Inherent browser limits (don't chase)

VST/AU/CLAP plugin hosting · genuine ProRes encode · HDR/10-bit/wide-gamut grade & delivery (8-bit SDR today) · alpha-channel video export · true multichannel/surround audio.
(Service-worker precache of the engine + ffmpeg.wasm bundles *is* addressable — currently only the app shell is precached, so cold-load/new-deploy can fail offline.)

---

### Bottom line

OpenReel is already credible on grading, audio DSP, compositing, and text. The decisive moves:
1. **Claim the quick wins + fix the misleading UI now** (hardware encode, SRT sidecar + burn-in toggle, drop fake codec options).
2. **Bet on transcript-based editing** — the clearest table-stakes gap for the target audience.
3. **Finish the proxy + render-ahead performance story** — the real ceiling on a browser editor.
4. **Upgrade the "AI" features that are currently faked/heuristic** to the ML the UI already implies.
