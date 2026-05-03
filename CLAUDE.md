# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo overview

OpenReel Video is a fully client-side, browser-based video editor (a CapCut/DaVinci alternative). All editing, rendering, and exporting runs in the browser using **WebCodecs**, **WebGPU**, **Web Audio API**, **Web Workers**, and **WASM** (AssemblyScript). No server-side video processing.

It's a **pnpm workspace monorepo** with two packages:

- `apps/web` (`@openreel/web`) — React 18 + TypeScript + Vite frontend (~66k LOC). Contains UI, Zustand stores, and bridges.
- `packages/core` (`@openreel/core`) — Headless engines for video, audio, graphics, text, export, storage (~59k LOC). No React. Source-only package consumed via `workspace:*` (no build step for TS — `main` points at `./src/index.ts`).
- `packages/ui` (`@openreel/ui`) — shared UI primitives.

Cloudflare Pages is the deploy target (`wrangler.toml`, `apps/web/functions`).

## Commands

Run from repo root unless noted. Always use `pnpm` (required by `engines`).

```bash
# Install (also needed once after pulling new deps)
pnpm install

# Dev server (Vite, http://localhost:5173). start.sh uses :5174.
pnpm dev

# Build everything (WASM first, then web bundle). The web build runs `tsc --noEmit` as a typecheck gate.
pnpm build

# Build WASM modules only (FFT, WAV, beat-detection — AssemblyScript → .wasm)
pnpm build:wasm

# Tests — Vitest in every workspace package
pnpm test           # watch mode (-r recursive)
pnpm test:run       # single run, used by `pnpm test` at root

# Run a single test file (cd into the package first, since vitest is per-package)
cd packages/core && pnpm vitest run src/timeline/clip-manager.test.ts
cd apps/web      && pnpm vitest run src/stores/project-store.test.ts

# Lint (web app only — core has no lint script)
pnpm lint

# Typecheck both packages
pnpm typecheck

# Preview production build / deploy to Cloudflare Pages
pnpm preview
pnpm deploy
pnpm deploy:preview
```

WASM artifacts live in `packages/core/src/wasm/{fft,wav,beat-detection}/build/*.wasm` and **must exist before `pnpm dev` works** — `start.sh` checks this and runs `pnpm build:wasm` if missing. After editing any `wasm/**/assembly/*.ts` source, rerun `pnpm build:wasm`.

## Architecture

### Three-layer separation

```
React UI  ──►  Zustand stores  ──►  Bridges  ──►  Core engines
(apps/web/         (apps/web/        (apps/web/      (packages/core/
 components)        src/stores)       src/bridges)    src/{video,audio,...})
```

The **bridge layer** is the critical seam. Bridges (in `apps/web/src/bridges/`) are singletons with `getXBridge()` / `initializeXBridge()` / `disposeXBridge()` lifecycle helpers re-exported from `bridges/index.ts`. They translate Zustand state changes into engine commands and engine events back into store updates. When wiring a new core feature into the UI, **add or extend a bridge** rather than calling engines directly from components — keeps React decoupled from imperative engine state. Examples: `playback-bridge`, `media-bridge`, `effects-bridge`, `audio-bridge`, `text-bridge`, `graphics-bridge`, `transition-bridge`, `motion-tracking-bridge`, `beat-sync-bridge`, `silence-cut-bridge`.

### AgentBridge (`apps/web/src/bridges/agent-bridge.ts`)

Dev-only bridge that lets an **external agent** (e.g. a Python process using the Anthropic SDK) drive the editor over a local WebSocket (`ws://localhost:8765` by default). Enabled when `VITE_ENABLE_AGENT_BRIDGE=true` is set; initialized in `EditorInterface.tsx`.

**Protocol (JSON frames over WS):**

| Direction | Frame kind | Purpose |
|-----------|-----------|---------|
| agent → editor | `dispatch` | Execute one serialized Action |
| agent → editor | `dispatchMany` | Execute a list of Actions; optional `groupId` wraps all in one undo group |
| agent → editor | `getProjectState` | Request full project snapshot (includes `textClips`, `timeline.tracks`, etc.) |
| agent → editor | `undo` / `redo` | Step through action history |
| agent → editor | `importMediaByUrl` | Fetch a URL and import as media |
| agent → editor | `enterFreeze` | Take over editor: pauses playback, shows overlay, blocks user keyboard input. Optional `reason` shown in banner. |
| agent → editor | `exitFreeze` | Release editor back to user |
| agent → editor | `captureFrame` | Scrub to `time`, render frame, return base64-encoded JPEG (`maxWidth` default 512, `quality` default 0.8) |
| agent → editor | `createTextClip` | Create a text clip via `TitleEngine` (bypasses Action pipeline — no undo entry). Required: `trackId`, `startTime` (s), `text`, `duration` (s). Optional: `style` (`Partial<TextStyle>`: fontFamily, fontSize, fontWeight, color, textAlign, verticalAlign, shadowColor/Blur/OffsetX/Y, strokeColor/Width, textDecoration, etc.) |
| agent → editor | `updateTextClip` | Update an existing text clip's style, transform, and/or animation. Required: `clipId`. Optional: `style` (`Partial<TextStyle>`), `transform` (`Partial<Transform>`: position, rotation, scale, opacity, etc.), `animation` (`TextAnimation`: preset, inDuration, outDuration, stagger, unit) |
| editor → agent | `ready` | Sent on WS open; includes initial project state |
| editor → agent | `dispatchResult` | Success/failure + optional `mediaId`, `actionId` |
| editor → agent | `projectState` | Response to `getProjectState` |
| editor → agent | `projectChanged` | Debounced (50 ms) push on every project mutation |
| editor → agent | `freezeChanged` | Pushed when freeze state changes (e.g. user clicked Stop or pressed Esc) |
| editor → agent | `frame` | Response to `captureFrame`: `{ time, width, height, mimeType, dataBase64 }` |

**Freeze mode** is tracked in `apps/web/src/stores/agent-store.ts` (`useAgentStore`). While frozen: the editor renders a full-screen scrim with a Stop button; keyboard shortcuts are suppressed (Esc unfreezes); user mouse input is blocked. If the WebSocket disconnects while frozen the editor auto-unfreezes. Freeze is purely a UI gate — the action pipeline, undo history, and auto-save all remain fully functional.

**Frame capture** uses `PlaybackBridge.captureFrameAt(time)` (`apps/web/src/bridges/playback-bridge.ts`) which scrubs the playback controller and resolves the next `framerendered` event (2 s timeout → `DECODE_ERROR`). The agent bridge downscales via `OffscreenCanvas` and encodes with `convertToBlob`.

**Typical agent flow for bulk semantic edits** (e.g. "move all captions down"):
1. `enterFreeze` → 2. `getProjectState` (read `project.textClips`) → 3. optionally `captureFrame` for visual reasoning → 4. `dispatchMany` with `groupId` → 5. `exitFreeze`. The `groupId` collapses all actions into one Cmd-Z.

Actions are deserialized via `ActionSerializer` and dispatched through `useProjectStore.executeAction()` — validation, undo history, and auto-save all apply unchanged. The bridge reconnects with exponential back-off (1 s → 30 s max) when the server is unavailable.

### Action-based editing (undo/redo)

Every edit is a serializable Action processed through `packages/core/src/actions/`:

- `ActionValidator` — schema/precondition checks
- `ActionExecutor` — applies the action to project state
- `InverseActionGenerator` — produces the undo action at execute time
- `ActionHistory` — undo/redo stack with grouping (`ActionGroup`) and snapshots
- `ActionSerializer` — for persistence and project export

When adding a new edit operation, define the action type in `core/src/types/actions.ts`, implement validate/execute/inverse, and dispatch from the relevant bridge. Don't mutate project state from a component — go through the action pipeline so undo/redo and auto-save stay correct.

### Core engines (`packages/core/src/`)

Each subdomain is an independent engine. Most expose a singleton getter and event emitter:

- `video/` — `playback-engine`, `video-engine`, `composite-engine`, `gpu-compositor` (WebGPU), `canvas2d-fallback-renderer`, `renderer-factory` (picks WebGPU vs Canvas2D), `frame-cache` + `frame-ring-buffer`, `parallel-frame-decoder` + `decode-worker`, `keyframe-engine`, `transition-engine`, `chroma-key-engine`, `mask-engine`, `color-grading-engine`, `motion-tracking-engine`, `multicam-engine`, `adjustment-layer-engine`, `speed-engine`, `unified-effects-processor`, `webgpu-effects-processor`, plus WGSL `shaders/` and `upscaling/`.
- `audio/` — `audio-engine`, `realtime-audio-graph` (Web Audio routing), `audio-effects-engine`, `effects-worklet-processor` (AudioWorklet), `beat-detection-engine` (uses WASM FFT), `noise-reduction`, `volume-automation`, `sound-library-engine`, `sound-generator`.
- `graphics/`, `text/`, `photo/` — Shapes, SVG, stickers, rich text + 20+ animations, photo-mode layers/retouching.
- `timeline/` — `clip-manager`, `track-manager`, `nested-sequence-engine`.
- `export/` — `export-engine` + `export-worker` (MP4/WebM/ProRes/audio/image-sequence). Re-exported with explicit names from `core/src/index.ts`.
- `storage/` — `storage-engine` (IndexedDB via `idb-keyval`), `project-serializer`, `cache-manager`. Backs auto-save.
- `playback/`, `animation/`, `effects/`, `media/`, `template/`, `ai/`, `device/` — supporting domains.
- `wasm/` — AssemblyScript sources for FFT, WAV decoder, beat detection. Built via `pnpm build:wasm`.

`packages/core/src/index.ts` is the single public entrypoint — anything not re-exported there shouldn't be imported by `apps/web`. Use named subpath imports (`@openreel/core/foo`) only when necessary; prefer the barrel.

### Rendering fallback

WebGPU is the primary renderer; `renderer-factory.ts` falls back to `canvas2d-fallback-renderer.ts` when WebGPU is unavailable. Keep new effects implemented in both paths (or behind a capability check) — don't assume WebGPU.

### State (apps/web/src/stores)

Zustand stores, one per domain: `project-store` (canonical project + history — has tests), `timeline-store`, `engine-store`, `recorder-store`, `settings-store`, `ui-store`, `kieai-store`, `tts-store`, `notification-store`, `theme-store`. The `project/` subfolder holds `action-helpers`, `project-helpers`, `subtitle-helpers`, and shared types — extend these rather than duplicating logic in the store file.

### Services (apps/web/src/services)

Browser-only side-effecting modules that don't belong in core: `auto-save`, `keyboard-shortcuts`, `screen-recorder`, `media-storage`, `processing-manager`, `project-manager`, `share-service`, `template-cloud-service`, `service-worker`, `secure-storage`, `api-proxy`, `kieai/`. These are the right home for things that need DOM/Browser APIs but aren't UI.

## Conventions

- TypeScript **strict mode**; avoid `any`, prefer `unknown` or proper types.
- Components `PascalCase`, functions `camelCase`, constants `UPPER_SNAKE_CASE`.
- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`).
- Tests use Vitest + (in `apps/web`) Testing Library + jsdom. Co-locate `*.test.ts(x)` next to source.
- Don't leave `console.log`s; remove debug code before committing.

## Things to know

- **WebCodecs/WebGPU/WASM** are required at runtime — Chrome/Edge/Firefox/Safari versions in README. Many features are gated on capability detection; preserve graceful fallback paths.
- **Auto-save writes to IndexedDB** continuously. Schema changes in `storage/schema-types.ts` need a migration path; don't break existing on-disk projects without versioning.
- **Heavy work goes in workers** (`decode-worker`, `export-worker`, `effects-worklet-processor`). Don't add CPU-heavy synchronous code to the main thread — it will jank playback.
- **AI-managed workflow**: issues labeled `needs-claude-review` are triaged via `scripts/` and `.github/CLAUDE_WORKFLOW.md`. `pnpm issues` / `pnpm prs` list the queue.
- `mediabunny.d.ts` at the repo root is the type surface for the `mediabunny` media library used across video/audio/export.
