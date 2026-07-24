# Desktop Native Pro Redesign + Slimming — Design

**Date:** 2026-06-02
**Status:** Proposed (awaiting review)
**Relates to:** `2026-06-02-electron-desktop-native-offload-design.md` (Phase 0–4 Electron app), `2026-06-02-desktop-gpu-cloud-jobs-design.md`.

## 1. Goal

Make the OpenReel desktop app (a) feel like a **properly designed native video editor** rather than the web app in a window, in a **DaVinci Resolve-style** aesthetic, and (b) **lightweight** in size and performance. Stay on Electron (no runtime rewrite); deliver both the redesign and the slimming as one combined effort.

## 2. Decisions (locked with the user)

| Decision | Choice |
|---|---|
| Runtime | **Stay on Electron, optimize** (no Tauri/native rewrite; keep the entire Phase 0–4 main process) |
| Native depth | **Full pro restyle** — NLE shell + restyle every panel |
| Restyle scope | **Desktop-only design layer** — the web app is untouched |
| Aesthetic | **DaVinci Resolve-style** — charcoal + teal, dense, flat controls, prominent scopes + bottom timeline |
| Fork model | **Full component fork, bounded to presentation** — desktop gets its own *view* component tree; all logic (stores/engines/bridges/hooks/services/actions) stays shared and unchanged |
| Project scope | **One combined effort** — native UI + size/perf together |
| Platforms | **All three, mac-primary** — macOS arm64+x64, Windows x64, Linux x64; develop/test primarily on macOS |

## 3. Architecture & fork boundary

The single most important rule: **fork the views, never the logic.**

- **Shared (never forked), in `apps/web/src` and `packages/core`:** `stores/` (project, engine, timeline, ui), `bridges/`, core engines, `hooks/`, `services/` (gpu-jobs, export, native bridges, secure-storage), `actions/` (the undo system), `packages/core` entirely. Desktop views import and use these directly — same state, same undo, same engines.
- **Forked (desktop-only views):** a new `apps/web/src/desktop/` tree:
  - `DesktopApp.tsx` — desktop entry/root.
  - `shell/` — `DesktopTitleBar`, `DesktopMenuBar` (renderer side of the native menu), `StatusBar`, `Workspace` (page router), window-control buttons.
  - `panels/` — Resolve-style **view** components: `MediaPool`, `Viewer`, `ResolveTimeline`, `Inspector`, `Scopes`, `ColorWheels`, `DeliverPanel`.
  - `theme/` — the `.openreel-desktop` charcoal/teal token layer.
  - `pages/` — `EditPage`, `ColorPage`, `DeliverPage` (compositions of the panels).
- **Lives in `apps/web`** so it rides the same Vite build and reuses the shared modules without cross-package gymnastics, but it is **gated** and **tree-shaken out of the web bundle** (the web entry never imports `desktop/`).
- **Boot:** `apps/web/src/main.tsx` checks `window.openreel?.platform === "desktop"`. Desktop → mount `<DesktopApp/>`; web → mount the existing `<App/>`. Both wrap the same store providers. The web code path is 100% unchanged (no regression risk).

**Why view-only fork (not full duplication):** a fork of the editor *logic* (timeline engine, project state, playback, export, color pipeline, the GPU/AI work) would be unmaintainable and would discard tested, expensive code. The desktop view components are thin presentational shells over the shared stores/hooks — total visual freedom, zero logic duplication.

## 4. Native shell & chrome (per-platform, mac-primary)

- **Frameless window** (main process, `createWindow`):
  - macOS: `titleBarStyle: "hiddenInset"`, `vibrancy: "under-window"` (or `"sidebar"`), `visualEffectState: "active"`, traffic lights inset to align with the custom title bar.
  - Windows/Linux: `titleBarStyle: "hidden"` with **custom** min/max/close controls rendered in React, backed by new window-control IPC channels (`window:minimize|maximize|unmaximize|close|isMaximized`) in the main process.
- **`DesktopTitleBar`** — a draggable (`-webkit-app-region: drag`) unified bar embedding the app title, the **workspace page tabs** (Edit/Color/Deliver), and global transport/export entry points; interactive controls opt out with `no-drag`.
- **Native application menu** — `Menu.buildFromTemplate` (File / Edit / Clip / View / Window / Help) wired to renderer actions through IPC + accelerators (mac gets the proper app menu; Win/Linux get an in-window menu bar mirroring it). Reuses the existing keyboard-shortcut service for action dispatch.
- **Native context menus** for clips/media/timeline (right-click → `Menu.popup` via IPC, or a desktop-styled in-renderer menu — chosen at plan time per consistency).

## 5. DaVinci Resolve-style UI

- **Workspace pages** (Resolve's signature page model), reduced to OpenReel's needs:
  - **Edit** — Media Pool (left) · Viewer (center) · Inspector (right) · Timeline (bottom).
  - **Color** — Scopes + Color Wheels · Viewer · (node/clip strip if applicable).
  - **Deliver** — export/render settings + a render queue (ties into the export engine + GPU cloud jobs).
  - Page tabs live in the title bar (Resolve places them bottom-center; we adapt to the unified top bar). State in `ui-store` (desktop-only key).
- **Visual language:** layered charcoal surfaces (a 4–5 step neutral ramp), a single teal accent, flat 1px borders that brighten to teal on hover/active, compact control density, monochrome line icons, tabbed flat panel headers, prominent scopes, a dominant bottom timeline.
- **Theme delivery:** a `.openreel-desktop` root class exposing the charcoal/teal CSS-variable set (extending the existing token names so shared sub-components inherit correctly); desktop view components are authored against these tokens.
- **Panel inventory & reuse:** each desktop panel is a new presentational component that renders shared state. The timeline rendering/interaction engine, the WebGPU/Canvas preview, the inspector's effect/transform logic, and the color pipeline are reused unchanged behind the new chrome.

## 6. Size & performance

- **Strip `ffmpeg.wasm` from the desktop bundle (~62MB, the headline win):** the desktop renderer build already sets `OPENREEL_DESKTOP=1`. Use it (Vite `define` + build-conditional + dynamic-import gating) to ensure the two `ffmpeg-core*.wasm` cores and their JS are **excluded** from the desktop bundle. Desktop already exports through `NativeFFmpegBackend` and decodes/transcodes via the native media sidecar (Phase 2–3), so the wasm path is dead weight on desktop. Verification: confirm every `ffmpeg.wasm` entry point is desktop-guarded/lazy and absent from the desktop `dist`.
- **Trim fonts (~5–6MB):** 264 self-hosted woff2 today. Curate a small default set bundled; lazy-load the font-picker catalog on demand (fetch/attach only when a font is chosen). Keep the COEP/offline self-hosting guarantees from the earlier desktop work for the bundled set.
- **Packaging — add `electron-builder`:** asar packaging, `npmRebuild`/prune of dev deps, **per-arch** targets (mac `arm64`+`x64` dmg/zip, win `x64` nsis, linux `x64` AppImage/deb), drop unused Chromium locales, bundle the **per-arch native ffmpeg binary** under `resources/bin`, and signing/notarization **config** (mac hardened-runtime + notarize; Windows Authenticode) — actual certificates/credentials are supplied by the user/CI, not committed.
- **Performance:** lazy-load heavy panels (three.js, scopes, color wheels) so cold start is fast; confirm the new shell does not reintroduce the known timeline-drag perf storm; a profiling pass for startup time + RAM (single GPU process, disable unused Chromium features); leverage the native sidecar to keep CPU off the renderer.

## 7. Error handling & resilience

- Desktop views wrap each panel in the existing `PanelErrorBoundary` so a panel crash doesn't take down the shell.
- Window-control IPC and native-menu actions validate inputs (zod, consistent with the existing IPC harness) and fail safe (a failed menu action surfaces a non-blocking error, never a dead window).
- The `DesktopApp` boot guards on bridge availability; if `window.openreel` is somehow absent at runtime it falls back to the web `<App/>` rather than rendering a broken shell.

## 8. Testing & verification

- **Automated:** component tests for desktop view components rendered against mocked shared stores; theme-token presence + workspace-routing tests; window-control + native-menu IPC handler unit tests (mocked Electron); a **CI bundle-size assertion** — the desktop `dist` must exclude `ffmpeg-core*.wasm` and stay under a size budget.
- **Human (pending, flagged in `apps/desktop/test/parity.md`):** the frameless window + traffic lights + vibrancy, the native menu behavior, the overall DaVinci-style look, and a real packaged-build size/startup measurement per platform.

## 9. Phasing (one spec; incremental & shippable)

1. **Native shell + theme + boot** — frameless window + per-platform chrome, `DesktopTitleBar`, native app menu, charcoal/teal theme tokens, `DesktopApp` boot + page-tab `Workspace` scaffold rendering current panels as placeholders. *Outcome: the app immediately feels native.*
2. **Slim down** — strip `ffmpeg.wasm` on desktop, trim fonts, add `electron-builder` packaging. *Outcome: the app gets small.* (Sequenced early — high value, low risk, independent of the UI work.)
3. **Resolve view components** — build the forked desktop panels page by page: Viewer → Timeline → Inspector → Media Pool → Scopes/Color → Deliver, each consuming shared stores. *The bulk of the work; grown panel by panel.*
4. **Polish + packaging finalize** — per-arch builds, signing/notarization config, CI bundle-size gate, perf/RAM/startup pass.

## 10. Non-goals / out of scope

- No runtime migration (Tauri/native) — explicitly rejected.
- No changes to the **web app's** appearance or the shared stores/engines beyond what's needed to gate desktop boot and theme inheritance.
- No new editing *features* — this is shell, skin, layout, packaging, and slimming only. (The forked panels expose existing capabilities in a new UI.)
- Code-signing certificates/credentials are not produced here (config only).
- A full Resolve feature surface (Fusion, Fairlight, node graph) is not in scope; the page set is Edit/Color/Deliver.

## 11. Open items to resolve during planning

- Exact charcoal/teal token values (the concrete ramp + accent) — pinned in the plan's Phase-1 theme task.
- Context-menu mechanism: native `Menu.popup` via IPC vs. a desktop-styled in-renderer menu — chosen in the plan for consistency.
- Whether `desktop/` stays in `apps/web` (recommended, simplest build) or graduates to its own `apps/desktop-ui` package if it grows large — start in `apps/web`, revisit only if needed.
- The exact desktop bundle size budget for the CI gate (set after the first slimmed build measurement).
