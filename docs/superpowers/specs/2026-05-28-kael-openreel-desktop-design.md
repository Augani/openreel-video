# OpenReel Desktop — Design Spec

> **⚠️ SUPERSEDED (2026-06-02).** This native Rust + wgpu + kael plan has been superseded by
> [`2026-06-02-electron-desktop-native-offload-design.md`](./2026-06-02-electron-desktop-native-offload-design.md),
> which reuses the existing `apps/web` React editor as an Electron renderer and offloads heavy
> media work (encode / decode / capture / hardware probing) to a native FFmpeg sidecar in the
> Node main process. The decision to abandon the from-scratch Rust rewrite was made because the
> Electron path reuses the entire shipped web editor instead of rebuilding it. This document is
> retained for its feature inventory and parity invariants only.

**Status:** Superseded — see Electron design
**Date:** 2026-05-28
**Replaces:** `desktop/DESKTOP-VIDEO-EDITOR-GUIDE.md` (the previous Tauri+React plan)
**Builds on:** `docs/MOBILE-PARITY.md`, `STUDIO_PLAN.md`, `MOTION-GRAPHICS-PLAN.md`, `EDITING-TEMPLATES-PLAN.md`

## 1. Context

OpenReel already ships a native iOS app and a native Android app, and runs a TypeScript editor in the browser via `apps/web` + `packages/core`. The mobile apps are in real users' hands and define the feature floor the desktop must match. The previously written desktop plan recommended **Tauri 2 + React** to reuse the web editor. This spec replaces that plan: the desktop is being rebuilt **natively in Rust on top of the `kael` UI framework** (just published as 0.1.2) with a single **wgpu** render graph. The decision is irreversible at the architectural level — there is no WebView fallback path in any phase.

The goal of this document is to be the canonical build guide for OpenReel Desktop, sequenced from Phase 0 through Phase 6. It is intentionally agnostic to team size: the order of phases and the dependencies between them apply whether one engineer or ten are working on them.

## 2. Goal & positioning

### Goal

Build **OpenReel Desktop**, a native Rust video editor on top of **kael 0.1.2+**, that ships in stages from a minimum-viable editor loop to a tool that can replace DaVinci Resolve and CapCut for desktop users. The public beta target is **feature parity with the iOS app**, since iOS's `TimelineSourceMapper` is the cross-platform reference for timeline math. The long-term target is to combine DaVinci's pro density with CapCut's creator-grade AI features (transcription, auto-caption, background removal, object tracking, beat detection) inherited from the existing OpenReel mobile feature set.

### Why kael + wgpu (not Tauri + React)

- **Single render path = no preview/export drift.** iOS proved that one Metal pipeline beats two pipelines for parity. The Rust desktop gets the same property with one wgpu graph driving preview, export, thumbnails, and cover frames.
- **No WebView ceiling.** No JS/GPU bridge overhead, no Web Audio approximations, no `.wasm` ffmpeg, no Electron-class memory floor. Native window, native menus, native file I/O.
- **One language stack.** Schema, render, UI, IPC, jobs — all Rust. Easier to refactor across layers as the engine matures.
- **It pushes kael.** A video editor is the hardest thing you can ask a young UI framework to do. Either kael grows up fast or we learn early that it can't, while the cost of switching is still cheap.

### Positioning

- **Pro-density timeline** (DaVinci/Premiere style) from v1 — signals "serious tool" on first open.
- **Single workspace v1, workspace tabs in v2** (Edit / Color / Audio / Captions / Deliver) — the panel system is designed for workspace switching from day one.
- **CapCut-tier AI features inherited from mobile** — runs through the existing OpenReel cloud, never bundled credentials.
- **Cross-platform `.openreel` round-trip** — a project authored on desktop opens and renders identically on iOS, Android, and web within tolerance.

## 3. Non-goals (across all phases)

- **No new project format.** Reuse `.openreel` JSON 1:1 with iOS/Android/web. Schema additions are additive and namespaced as desktop-specific metadata.
- **No WebView fallback.** If a feature can't be built in kael/Rust, it gets descoped or sequenced for later, not bolted on as HTML.
- **No bundled cloud credentials.** Every AI / cloud feature uses short-lived scoped tokens, same rule mobile enforces.
- **No detachable / floating panels.** Panels dock inside one main window. Multi-monitor preview output (Phase 4) is a separate render target, not a tear-off panel. May be revisited post-Phase 6 if user feedback demands it.
- **Single timeline interpretation, always.** Preview = export = thumbnails = cover frames. No optimization is allowed to fork rendering paths.

## 4. Architecture

### The three layers

```
┌──────────────────────────────────────────────────────────┐
│  openreel-app  ── kael UI ── menus ── shortcuts ── OS    │
├──────────────────────────────────────────────────────────┤
│           openreel-export  (queue, jobs)                 │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ openreel-render  │  │ openreel-audio   │              │
│  │   wgpu frame     │  │   mixer graph    │              │
│  │   graph          │  │   effects        │              │
│  └────────┬─────────┘  └────────┬─────────┘              │
│           │                     │                        │
│           └──────────┬──────────┘                        │
├──────────────────────┼───────────────────────────────────┤
│  openreel-timeline   │  openreel-cache  ── disk cache    │
│  source mapping ─────┤  openreel-media  ── FFmpeg probe  │
│  openreel-project    │  openreel-ai-client ── cloud      │
│  schema + I/O        │                                   │
└──────────────────────┴───────────────────────────────────┘
```

Three rings: schema and I/O at the bottom (no rendering, no UI), engines in the middle (render + audio + export, no UI), app at the top (kael UI, OS integration, glue). No cycles.

### The 9 crates

All live in a new Cargo workspace at `apps/desktop/` inside the existing openreel monorepo.

| Crate | Owns | Depends on |
|---|---|---|
| **openreel-project** | `.openreel` JSON schema (serde types), `.openreelzip` archive read/write, migrations between schema versions, project state model (`Project`, `Track`, `Clip`, `Effect`, `Caption`, `Template`) | serde, anyhow only |
| **openreel-timeline** | Pure timeline math: `sourceTime = inPoint + localTime * speed`, reverse/boomerang sampling, split-on-speed math, snapping, overlay z-order resolution, the mobile-parity invariants in code | openreel-project |
| **openreel-media** | Media probing (codec, resolution, fps, HDR, rotation, audio tracks, timecode), thumbnail extraction, waveform peaks, proxy generation, offline-media detection and relink | openreel-project, ffmpeg-next |
| **openreel-cache** | Disk cache: thumbnails, waveforms, decoded frames, render previews, AI results. Per-project keys, fingerprinted by media hash + project version, size limits, GC policy, diagnostics surface | openreel-project (for keys) |
| **openreel-render** | wgpu render graph: video composition, track z-order, blend modes, color grading, LUT, filters, text rendering, graphics (shapes/SVG), transitions, keyframe interpolation, headless render mode, golden-frame harness | openreel-project, openreel-timeline, openreel-media, openreel-cache, wgpu |
| **openreel-audio** | Audio decode (FFmpeg), mixer graph, multi-track mixdown, EQ/comp/reverb/delay/automation/ducking/fades/loudness analysis, waveform + beat detection, transcript alignment hooks | openreel-project, openreel-timeline, openreel-cache, ffmpeg-next, symphonia |
| **openreel-export** | Durable export queue (pause/cancel/resume), frame extraction from openreel-render, audio mixdown from openreel-audio, hardware encoder selection (VideoToolbox / NVENC / QSV / AMF / software), social presets, progress / ETA / logs | openreel-render, openreel-audio, openreel-cache, ffmpeg-next |
| **openreel-ai-client** | Desktop auth flow (short-lived JWT via OAuth-style browser handoff, mirroring Play Integrity / App Attest semantics), GPU job submit/poll/cancel, result caching, integration with existing cloud (transcription, auto-caption, multilang, background removal, object tracking, beat detection, photo enhance) | openreel-project, openreel-cache, reqwest |
| **openreel-app** | The kael binary. Views, view state, services wiring, menu bar, command palette, keymap, OS integration (file dialogs, Finder/Explorer reveal, drag-drop, dock, recent-projects, sleep/wake, updater hooks) | kael, openreel-* (everything) |

### How kael displays wgpu-rendered frames

Two paths, sequenced:

- **v1 (Phases 0–3): GPU readback.** `openreel-render` renders to an offscreen `wgpu::Texture`, reads back to a CPU pixel buffer, hands to kael as a `Surface` element each frame. Simple, portable, costs a frame copy. Acceptable up to ~30 fps preview.
- **v2 (Phase 5): texture sharing.** Share GPU resources between wgpu and kael's blade-graphics renderer — on macOS via `MTLTexture` handles, on Windows via DXGI shared handles, on Linux via DMA-BUF / Vulkan external memory. Zero-copy 60 fps preview, required for serious-density timelines and multi-monitor output. Treated as an optimization phase, not a v1 commitment.

### Schema sync with mobile / web

- **Single source of truth: the canonical `.openreel` JSON spec.** Lives under `schema/` at the openreel monorepo root.
- **Each platform owns its own parser**: Swift on iOS, Kotlin on Android, TypeScript on web, Rust serde in `openreel-project`.
- **Golden vectors are the contract**: a shared `schema/fixtures/` directory of `.openreel` files plus expected outputs (rendered frames per timestamp, mixed audio, split results). Every platform's parity test loads these fixtures and asserts byte-equivalence within tolerance.
- **Schema changes are atomic monorepo PRs** — TypeScript types, Swift Codable, Kotlin data classes, Rust serde, and fixtures all updated together. Branch protection should require all four parser test suites to pass.
- **Recommended later (Phase 4+)**: generate Swift/Kotlin/TS types from a single schema declaration (Rust as source via `schemars` → JSON Schema → codegen). Eliminates manual drift.

## 5. UI surface

### The main window — v1 layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Title bar  │  Project name  │  Tabs (Phase 4+)  │  Export ▾    │
├─────────────────────────────────────────────────────────────────┤
│  Tool strip: Import · Record · Captions · Effects · Speed · …   │
├──────────────┬─────────────────────────────────┬────────────────┤
│              │                                 │                │
│   Media      │           Preview               │   Inspector    │
│   library    │      (wgpu render target)       │   (tabs:       │
│   (bins,     │      ┌─────────────────┐        │    Details /   │
│   search,    │      │                 │        │    Effects /   │
│   filters,   │      │   video frame   │        │    Audio /     │
│   recents)   │      │                 │        │    Speed)      │
│              │      └─────────────────┘        │                │
│              │      ⏮ ⏯ ⏭   0:00:02:18 ⌗      │                │
│              │      ╞══════════════════╡       │                │
├──────────────┴─────────────────────────────────┴────────────────┤
│  Timeline ruler: 0:00 ┊ 0:05 ┊ 0:10 ┊ 0:15 ┊ 0:20 …             │
│  V2 fx     ▓▓▓▓░░░▓▓▓▓▓▓░░░▓▓▓                                  │
│  V1 main   ████████████████████████████████ (frame thumbs)      │
│  A1 music  ░▁▂▃▄▅▆▇█▇▆▅▄▃▂▁░░▁▂▃▄▅▆▇█▇▆▅▄░  (waveform)          │
│  T1 cap    ░░░▓▓▓▓▓░░░░░▓▓▓▓░░░                                 │
├─────────────────────────────────────────────────────────────────┤
│ Status bar:  ● Auto-saved 2s ago  │  Cache 1.4 GB  │  No proxy  │
└─────────────────────────────────────────────────────────────────┘
```

### Panel system — DockLayout

Every region is a `Dock` slot containing one or more `Panel`s. v1 ships with the layout above hard-wired. v2 (Phase 4) adds workspace tabs that swap the layout — each tab simply provides a different `DockLayout` configuration.

Contract:

- A `Panel` is a self-contained kael view with no positional knowledge.
- A `DockLayout` is a serializable tree of slots: `Split(direction, ratio, [child, child])` and `Slot(panel_id)`.
- The current layout serializes to the project (per-project workspace memory) and to the app (last-used layout across projects).
- Panels can be hidden/shown via the View menu or keyboard shortcut. Floating tear-off panels are not supported in v1; reconsidered in Phase 6.

### Timeline — pro density

- **Track headers:** 56–72 px wide, type icon, name, mute/solo/lock, single-line.
- **Rows:** video 36–48 px, audio 24–32 px, text/graphics/captions 16–24 px. User-resizable.
- **Frame thumbnails on video:** sampled every ~80–120 px at current zoom; pulled from `openreel-cache`. Async load with skeleton placeholder.
- **Waveforms always on for audio tracks:** pre-computed peaks from `openreel-cache`, rendered via `openreel-render`'s line-art path or kael's path API.
- **Sub-frame ruler:** appears at zoom > 4× pixels per frame.
- **Snapping targets:** playhead, markers, clip edges, beat markers, captions, keyframes.
- **Playhead:** 1 px vertical line + tall scrub handle in the ruler.
- **Selection:** click, marquee, range, time-range select-between-markers. Multi-select with Cmd/Ctrl.

### Menu bar — uniform across platforms

Top-level menus: **File / Edit / Project / Clip / Timeline / Text / Effects / Audio / View / Export / Window / Help**. macOS uses the system menu bar (kael's existing AppKit menu integration); Windows and Linux use an in-window menu strip with the same tree and the same keybindings.

### Keyboard shortcuts and command palette

- **Default keymap** modeled on Premiere/DaVinci defaults: Space (play/pause), J/K/L, `[`/`]` (set in/out), `I`/`O` (mark), `B` (blade), `V` (select), `A` (track-select-forward), arrow keys (frame-step), Shift-arrow (large step), `Z` (zoom), `+`/`-` (zoom in/out).
- **Editable via Settings → Keymap.** Stored as JSON, users can import/export. Bundled presets: Default, CapCut-ish, Final Cut-ish, Premiere-ish.
- **Command palette:** ⌘K opens a fuzzy-searchable command list reaching every menu item, action, and panel. Required for discoverability in a feature-dense pro tool.

### Theme

- **Dark-first** (matches mobile parity rule, matches mockup, matches pro-tool norms).
- **Single accent**, OpenReel brand color by default, per-user override later.
- **Light theme deferred to Phase 5+**; not in the public-beta surface.
- **Accessibility**: AA contrast minimum, 16 px base font, focus rings always visible, full keyboard navigation across the window by Phase 3.

## 6. Phased build plan

Seven phases. Each names its goal, what it ships, and the exit criterion that unlocks the next.

### Phase 0 — Foundations & Render Parity Proof

**Goal:** Prove the kael + wgpu + FFmpeg stack can render a real `.openreel` frame that matches the iOS reference.

**Ships:**

- Cargo workspace at `apps/desktop/` with the 9 crates scaffolded (each with stub, tests, and CI).
- `openreel-project` loads an iOS-authored `.openreel` from disk.
- `openreel-media` probes and decodes one MP4 via `ffmpeg-next`.
- `openreel-timeline` resolves "what plays at t=2.0 s" for the test clip.
- `openreel-render` renders that frame through a minimal wgpu graph (decode → upload → color-convert → LUT → composite → present), reading back to a CPU pixel buffer.
- `openreel-app` opens a kael window and displays the readback as a `Surface` element.
- Golden-frame test harness: same `.openreel` rendered by iOS and by desktop; assert per-pixel ΔE within tolerance.

**Exit criterion:** `cargo test -p openreel-render --test parity` passes against at least 5 iOS-authored fixtures covering one untouched clip, one LUT, one blend-mode overlay, one speed-adjusted clip, and one reversed clip.

### Phase 1 — MVP Edit Loop (single track)

**Goal:** A user can take a raw clip, trim it, scrub it, save it, and export to MP4.

**Ships:**

- Project browser (grid of project cards from disk, last-modified sort).
- New-project flow (pick aspect ratio, name).
- Media import via drag-drop and file dialog.
- Single video track with trim handles, blade-split (B key), delete, ripple delete.
- Preview panel with playhead, scrub, J/K/L, arrow frame-step, in/out marks.
- Save / autosave to `.openreel` JSON.
- Export to MP4 H.264 via `openreel-export` (blocking single-job, no queue UI yet).
- Undo/redo for clip operations.

**Exit criterion:** A non-developer can import → trim → preview → export an MP4 in under five minutes, and the project round-trips through save and reload.

### Phase 2 — Multi-track editing

**Goal:** Real editor feel. Multi-track video, audio, and text basics.

**Ships:**

- Multi-track timeline (video, image, audio, text rows).
- Track operations: show/hide, mute/solo, lock, reorder.
- Audio import + waveform peaks (cached) + multi-track mixdown in export.
- Text track with basic text and ~5 animation presets.
- Aspect ratio presets (16:9, 9:16, 1:1, 4:5, 4:3) with preview-canvas swap.
- Project autosave, recent projects, rename/duplicate/delete.
- Archive import/export (`.openreelzip`, streamed not buffered, path-safe).
- Status bar (autosave indicator, cache size, proxy state).
- Command palette (⌘K).

**Exit criterion:** A user can build a 30-second social video with B-roll, music, and a caption fully through the kael UI.

### Phase 3 — Mobile feature parity → public beta

**Goal:** Match the iOS app feature-for-feature. **Public beta gate.**

**Ships:**

- Full effects panel: brightness, contrast, saturation, hue, temperature, tint, blur, sharpen, glow, vignette, film grain, chromatic aberration, lens distortion, pixelate, sepia, invert, posterize, chroma key.
- Color grading: wheels, HSL, curves, LUT import (`.cube`).
- Blend modes (16+).
- Audio effects: EQ, compressor, reverb, delay, fades, volume automation, pan, ducking, noise reduction hooks, reverse audio.
- Text: 20+ animation presets, gradients, shadows, outlines, custom fonts, per-character effects.
- Graphics: shapes, SVG import, stickers, emoji, fill / stroke / gradient / opacity.
- Subtitles: SRT/VTT import, AI auto-caption via `openreel-ai-client`, multilang translation (5 languages), karaoke / word-highlight styles.
- Speed: speed adjustment, reverse, boomerang (parity-preserved with mobile).
- Templates: built-in template library + apply-as-atomic-undoable-action.
- Keyframe panel with easing.
- Export queue UI (pause / cancel / resume / progress / ETA / logs).
- Hardware encoders: VideoToolbox on macOS, NVENC on NVIDIA, QSV on Intel, AMF on AMD, software fallback everywhere.
- Social presets (YouTube / TikTok / Instagram / Twitter / 4K / Custom).
- Cover frame picker, share intent (macOS Share menu, Windows Share charm, Linux xdg-open).

**Exit criterion:** Every iOS feature opens, edits, renders, and exports a project that round-trips through iOS without drift. AI cloud jobs authenticate via short-lived JWT, never bundled credentials. Cross-platform golden vectors all pass.

→ **Ship public beta to existing mobile users.**

### Phase 4 — Workspaces + advanced trim + proxies (competitive desktop)

**Goal:** Beat CapCut on desktop. Add the features serious editors expect.

**Ships:**

- Workspace tabs (Edit / Color / Audio / Captions / Deliver) realized as named `DockLayout` presets — the v1 panel system unlocks this with zero engine changes.
- Ripple, roll, slip, slide trim tools (modal cursor + keyboard shortcuts).
- Proxy generation (`openreel-cache` writes 720p ProRes/H.264 proxies; preview swaps to proxy automatically).
- Batch export matrix (one project → many presets in one queue run).
- Color scopes panel: waveform, vectorscope, parade, histogram (rendered via wgpu).
- Audio mixer panel with channel strips, sends, group buses, master limiter.
- Caption QA tools: transcript editor synced to timeline, find/replace, auto-fix common ASR errors.
- Project health panel (offline media, missing fonts, oversized cache, failed renders) with one-click fixes.
- Second-monitor preview output (separate kael window for fullscreen output; still readback path).
- Crash recovery (autosaved snapshots restored on next launch).
- Auto-updater (Sparkle on macOS, WinSparkle on Windows, AppImage check on Linux).

**Exit criterion:** A creator team builds and delivers a 5-minute polished YouTube video — color graded, mixed, captioned, batch-exported — entirely on desktop.

### Phase 5 — Pro editing (DaVinci/Premiere territory)

**Goal:** The features pros need that DaVinci/Premiere have but CapCut doesn't.

**Ships:**

- Nested sequences / compound clips (additive schema change; mobile parity preserved by lowering nested sequences to inline clips on iOS/Android render).
- Multicam editing: angle picker, multicam clip type, sync by timecode or audio.
- Transcript-based editing: delete words to delete clip ranges, jump to word, rearrange paragraphs.
- Motion graphics workspace: 2D layers with keyframable transform/opacity/effects, parented layers, pre-comps, simple graph editor (aligned with `MOTION-GRAPHICS-PLAN.md`).
- Motion tracking (`openreel-ai-client` cloud-assisted, results applied as keyframes).
- Texture sharing optimization: replace GPU readback with shared-handle path (Metal `MTLTexture`, DXGI shared handle, Vulkan external memory). Enables 60 fps preview under load and proper multi-monitor output.
- Plugin SDK foundations (Rust crate ABI for hot-loadable effects + `.fxpkg` format reader).

**Exit criterion:** A wedding videographer delivers a multicam ceremony edit; a motion designer assembles a 30 s social bumper with parented layers; preview stays at 60 fps on a 4K timeline with 6 video tracks.

### Phase 6 — Collaboration, sync, studio (platform play)

**Goal:** The features that make OpenReel a platform, not just an app.

**Ships:**

- Cloud project backup/sync (incremental, conflict-resolved by last-modified-wins per clip).
- Review/approval links: browser-based read-only render shared via short-lived URL.
- Team libraries: shared assets, templates, brand kits, LUTs, fonts, AI presets.
- Creator marketplace (aligned with `STUDIO_PLAN.md`): authors publish `.fxpkg` effects/templates from desktop; consumers install via in-app catalog; signed packages with creator royalties.
- Render farm hooks: optional cloud GPU export for long projects (existing OpenReel cloud worker pool).
- Plugin SDK v1: third-party effects, exporters, panels. Sandboxed.
- Localization (10+ languages, translation infrastructure).
- Telemetry & crash reporting (opt-in, privacy-forward).

**Exit criterion:** External creators publish and earn from `.fxpkg` effects; teams review and approve edits via shared links without leaving the app.

## 7. Cross-phase concerns

These don't get their own phase — they're built in incrementally:

- **Schema migrations:** every additive change ships with `openreel-project::migrate_vN_to_vN+1`.
- **Mobile parity tests:** every PR adds at least one golden vector per behavior changed.
- **Performance budget:** each phase carries a benchmarking gate (preview frame time, export throughput, timeline scroll latency).
- **Onboarding:** in-app tour added at end of Phase 1; rebuilt at end of Phase 3 for the public beta.
- **Documentation:** per-phase user guide updates ship alongside the feature, not "at the end".

## 8. Testing strategy

- **Frame-level parity (the contract):** `openreel-render` exposes a golden-frame harness. Every effect / blend mode / transition / text animation / speed mode adds at least one fixture covering input + expected output PNG / EXR. The test suite renders desktop + iOS reference + Android reference and asserts ΔE tolerance per pixel + L2 norm overall. PRs blocked on regressions.
- **Schema parity:** `openreel-project` validates against the canonical JSON Schema; cross-platform fixtures round-trip through Rust ↔ Swift ↔ Kotlin ↔ TypeScript without drift.
- **Engine unit tests:** `openreel-timeline` is pure functions, tested exhaustively against the parity invariants (`sourceTime`, reverse/boomerang, splits on speed-adjusted clips). `openreel-audio` tests mixer math against fixtures.
- **kael UI snapshot tests:** every panel has a snapshot test using kael's snapshot infrastructure. Layouts, focus rings, density variants.
- **Integration tests via `openreel-app`:** scriptable end-to-end (open project, perform action, assert state). Runs on CI in the kael Verify-macOS job (eventually Linux/Windows).
- **Performance benchmarks:** per-phase budgets gating merge. Preview frame time (~33 ms readback, ~16 ms texture-share). Export throughput (frames/s). Timeline scroll latency (~8 ms per frame).
- **Manual smoke matrix:** every phase ships a smoke checklist mirroring the parity invariants. Runs before each tag.

## 9. Open questions / deferred decisions

These do not block starting Phase 0. They need concrete answers no later than the phase that depends on them.

- **AI cloud auth concrete protocol.** Mobile uses App Attest (iOS) and Play Integrity (Android) to mint short-lived JWTs. Desktop equivalent likely a browser-based OAuth code-flow with the existing OpenReel cloud, then short-lived JWT swap. Needs design before Phase 3.
- **Updater strategy.** Sparkle / WinSparkle / AppImage check — needs codesign/notarisation infrastructure stand-up before Phase 4.
- **Plugin / effect format (`.fxpkg`).** Already specified in `STUDIO_PLAN.md` at a high level. Needs Rust ABI shape before Phase 5.
- **Telemetry/crash reporting choice.** Sentry vs custom — needs privacy review before Phase 6.
- **Texture sharing implementation.** Investigate kael's blade-graphics interop with wgpu before Phase 5; may require kael API additions.
- **Render farm protocol.** Reuses existing cloud workers but needs a job protocol spec before Phase 6.

## 10. References

- `desktop/DESKTOP-VIDEO-EDITOR-GUIDE.md` — superseded plan; valuable feature inventory.
- `docs/MOBILE-PARITY.md` — cross-platform parity invariants.
- `STUDIO_PLAN.md` — marketplace, `.fxpkg`, creator studio.
- `MOTION-GRAPHICS-PLAN.md` — motion graphics workspace design (Phase 5).
- `EDITING-TEMPLATES-PLAN.md` — effect-recipe template system.
- `MOBILE-APP-PLAN.md` — iOS roadmap and rationale.
- `Openreel Video/EditorView.swift` — canonical iOS editor entry.
- `Openreel Video Android/app/src/main/.../ui/editor/EditorScreen.kt` — Android editor entry.
- `apps/web/src/components/editor/EditorInterface.tsx` — web editor layout reference.
- `packages/core/src/index.ts` — feature inventory of the existing TypeScript engine.
- `/Users/augustusotu/Projects/kael` — kael UI framework (published as `kael` 0.1.2 on crates.io).
