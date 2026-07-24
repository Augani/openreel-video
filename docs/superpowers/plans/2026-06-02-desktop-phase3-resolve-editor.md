# Desktop Phase 3 — Resolve Editor (functional Edit/Color/Deliver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app a usable, DaVinci-Resolve-style editor: a project-start surface, then Edit (media pool · viewer · timeline · inspector), Color (viewer · scopes · grading), and Deliver (export + render queue) pages — each a bespoke desktop layout that **reuses the existing engine-bound panels** (Preview, Timeline, AssetsPanel, InspectorPanel) and shared stores, themed charcoal/teal.

**Architecture:** Reuse the heavy self-wired panels wholesale (they take zero props and bind to Zustand stores; the `.openreel-desktop` token layer already restyles them). Build the bespoke shell: a project gate + start screen, a reused **editor engine/bridge bootstrap**, and Resolve-style docked page layouts under `apps/web/src/desktop/`. No engine/renderer rewrite; desktop performance comes from the already-wired native FFmpeg sidecar + GPU cloud jobs.

**Tech Stack:** React 18 + Zustand + Tailwind (apps/web), the existing core engines/bridges, Vitest/RTL.

**Reference spec:** `docs/superpowers/specs/2026-06-02-desktop-native-pro-redesign-design.md` (§5 Resolve UI). Builds on Phases 1–2 (shell, theme, boot) already merged.

**Conventions (CLAUDE.md):** no line comments / no JSDoc except public API; explicit return types; avoid `any`; defensive guards; Conventional Commits; run typecheck + tests before each commit. The desktop shell lives in `apps/web/src/desktop/` and is gated on `window.openreel?.platform === "desktop"`; the web app and the web `EditorInterface` are NOT modified except to extract shared, reused logic (and only in a behavior-preserving way).

## Key facts (verified by recon 2026-06-02)
- **Reusable panels (zero props, store-bound, drop into any layout):** `Preview` (`components/editor/Preview.tsx:435` — the viewer canvas + WebGPU compositor + master-clock playback loop), `Timeline` (`components/editor/Timeline.tsx:56`), `AssetsPanel` (`components/editor/AssetsPanel.tsx:582` — the media library), `InspectorPanel` (`components/editor/InspectorPanel.tsx:75`), `AIPanel`, `AudioMixer` (takes `{visible,onClose}`), `KeyframeEditorPanel` (prop-driven). All wrap in `PanelErrorBoundary`.
- **Engine/bridge bootstrap** lives in `EditorInterface.tsx` (`useEngineInitialization` ~:81-184): it runs `useEngineStore().initialize()` then sequences bridge init **Media→Playback→Render→Effects(w,h)→Transition(w,h)** (imports at :18-37, init at :116-174) and renders a loading spinner until `initialized` (391-404). Panels must mount UNDER this initialized state.
- **Project lifecycle (store, UI-agnostic):** `useProjectStore` — `createNewProject(name?, settings?)` (project-store.ts:1481), `loadProject(project)` (:1505), `updateSettings(partial)` (:1623), `getFullProject()` (:4191), `recoverFromAutoSave(saveId)` (:4119), `initializeAutoSave()` (:4087). `project` selector is the source of truth. Presets: `SOCIAL_MEDIA_PRESETS` + `createProjectSettingsFromPreset` from `@openreel/core`; `createEmptyProject` from `stores/project/project-helpers.ts`.
- **Recent/persistence:** auto-save (`autoSaveManager`) is the live path; `services/project-manager.ts` is already desktop-aware (`window.openreel?.fs` native open/save) but only `addToRecent` is wired today.
- **Selection:** `useUIStore.getSelectedClipIds()` (ui-store.ts:103); inspector activates for exactly one selected clip.
- **Color page reusables:** `ColorGradingSection` (`inspector/ColorGradingSection.tsx:65`, clipId prop), `ScopesPanel` (`inspector/ScopesPanel.tsx:406`, takes a frame `ImageBitmap`), fed by `getRenderBridge().renderCurrentFrame()` (render-bridge.ts:231) + `getEffectsBridge().generateWaveform/Vectorscope/Histogram`.
- **Deliver reusables:** `ExportDialog` (`components/editor/ExportDialog.tsx:120`, emits `VideoExportSettings`); the actual export trigger is `runExport(...)` + `showSavePicker(...)` buried in `Toolbar.tsx:211/249` (must be extracted to a shared service). GPU cloud: `submitClipJob` (services/gpu-jobs.ts), `useGpuJobStore`, `useGpuJobPoller`.
- **ui-store seam:** `desktopPage: "edit"|"color"|"deliver"` + `setDesktopPage` already drive `desktop/shell/Workspace.tsx` (placeholders today). Dead PanelIds (`colorGrading`,`subtitles`,`effects`,`mediaLibrary`) are free to repurpose.

---

## File Structure
- Create `apps/web/src/desktop/editor/useDesktopEditorBootstrap.ts` — reuse/extract the engine+bridge init + ready gate.
- Create `apps/web/src/desktop/editor/EditorBootstrapGate.tsx` — renders a themed loading state until ready, then children.
- Create `apps/web/src/desktop/start/DesktopStartScreen.tsx` — Resolve-styled new-project + recent surface.
- Create `apps/web/src/desktop/start/desktop-project-actions.ts` — pure helpers binding to project-store/presets.
- Create `apps/web/src/desktop/pages/EditPage.tsx`, `ColorPage.tsx`, `DeliverPage.tsx`.
- Create `apps/web/src/services/export-runner.ts` — extracted `runExport`/`showSavePicker` shared by Toolbar + Deliver.
- Modify `apps/web/src/desktop/DesktopApp.tsx` — project gate (start vs workspace) + bootstrap.
- Modify `apps/web/src/desktop/shell/Workspace.tsx` — render EditPage/ColorPage/DeliverPage instead of placeholders.
- Modify `apps/web/src/components/editor/Toolbar.tsx` — use the extracted `export-runner` (behavior-preserving).
- Tests alongside.

---

# MILESTONE A — Functional Edit page (the usable editor)

### Task 1: Reuse the editor engine/bridge bootstrap (TDD where possible)

**Files:** Create `apps/web/src/desktop/editor/useDesktopEditorBootstrap.ts`, `apps/web/src/desktop/editor/EditorBootstrapGate.tsx`, `apps/web/src/desktop/editor/EditorBootstrapGate.test.tsx`.

- [ ] **Step 1: READ `apps/web/src/components/editor/EditorInterface.tsx`** lines ~18-184 to capture the EXACT bootstrap: is `useEngineInitialization` an imported hook or defined inline? What is the precise bridge init sequence + args (the 5 `initialize*Bridge` calls with project width/height) and the readiness flag(s) (`initialized`/`initializing`)? Note the imports (`initializeMediaBridge`, `initializePlaybackBridge`, `initializeRenderBridge`, `initializeEffectsBridge`, `initializeTransitionBridge` from `bridges/`, and `useEngineStore`).
- [ ] **Step 2: Implement `useDesktopEditorBootstrap.ts`** reusing the SAME init path. If `useEngineInitialization` is an importable hook (not inline JSX-coupled), re-export/use it directly. Otherwise replicate its exact sequence in a new hook that returns `{ ready: boolean; error: Error | null }`:
  - call `useEngineStore.getState().initialize()`; on success, in order, `await initializeMediaBridge(...)`, `initializePlaybackBridge(...)`, `initializeRenderBridge(...)`, `initializeEffectsBridge(width,height)`, `initializeTransitionBridge(width,height)` using `useProjectStore.getState().project.settings.width/height`; set `ready=true`. Guard against double-init (a module-level `let started` or the engine-store's own `initialized` flag). Dispose is owned by the existing web path; the desktop gate should NOT dispose on unmount of a single page (engines persist for the session) — only init-once.
  - Do NOT modify EditorInterface's behavior; if you extract a shared hook, EditorInterface must keep working identically (verify by running the web suite).
- [ ] **Step 3: Implement `EditorBootstrapGate.tsx`** — `function EditorBootstrapGate({ children }: { children: React.ReactNode }): JSX.Element` that calls the hook and renders a themed loading state (`<div className="grid h-full place-items-center text-sm text-fg-muted bg-bg">Loading editor…</div>`) until `ready`, an error state on `error`, else `<>{children}</>`.
- [ ] **Step 4: Test `EditorBootstrapGate.test.tsx`** — mock `useDesktopEditorBootstrap` to return `{ready:false}` → asserts "Loading editor…" shown and children not; `{ready:true}` → children shown. (Mock the hook module via `vi.mock`.)
- [ ] **Step 5: Verify + commit** — `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run EditorBootstrapGate && pnpm --filter @openreel/web test:run` (full suite green — confirms no web-editor regression if you extracted the hook).
```bash
git add apps/web/src/desktop/editor/ ; git commit -m "feat(web): desktop editor engine/bridge bootstrap gate (reuses the EditorInterface init path)"
```

### Task 2: Project gate + Resolve-style start screen (TDD for gate + actions)

**Files:** Create `apps/web/src/desktop/start/desktop-project-actions.ts` (+ test), `apps/web/src/desktop/start/DesktopStartScreen.tsx`; modify `apps/web/src/desktop/DesktopApp.tsx`.

- [ ] **Step 1: READ** `components/welcome/WelcomeScreen.tsx` (FORMAT_OPTIONS + `handleCreateProject`) and `stores/project-store.ts` create/recover actions + how `project` is initially null/empty (does the store start with a project, or null until `createNewProject`? Determine the "no project yet" condition — e.g. `project == null` or a default empty project with no tracks). Also read `services/project-manager.ts` `getRecentProjects()` and the auto-save `checkForRecovery()` to list recents.
- [ ] **Step 2: Implement `desktop-project-actions.ts`** — pure-ish helpers over the store:
  - `export interface NewProjectFormat { id: string; label: string; width: number; height: number; frameRate: number }`
  - `export const DESKTOP_FORMATS: NewProjectFormat[]` (mirror WelcomeScreen's FORMAT_OPTIONS — vertical 1080x1920, horizontal 1920x1080, square 1080x1080, at 30fps).
  - `export function startNewProject(format: NewProjectFormat): void` → `useProjectStore.getState().createNewProject(format.label, { width: format.width, height: format.height, frameRate: format.frameRate })`.
  - `export async function listRecentProjects(): Promise<{ id: string; name: string; savedAt: number }[]>` → from `checkForRecovery()`/projectManager (pick the canonical one used by the live RecentProjects; reuse that exact source).
  - `export async function openRecentProject(saveId: string): Promise<boolean>` → `useProjectStore.getState().recoverFromAutoSave(saveId)`.
  - `export function hasOpenProject(): boolean` → returns whether a real editable project is loaded (per the condition found in Step 1).
- [ ] **Step 3: Test `desktop-project-actions.test.ts`** — mock `useProjectStore.getState` + the recovery source; assert `startNewProject` calls `createNewProject` with the right name+settings; `openRecentProject` calls `recoverFromAutoSave`; `DESKTOP_FORMATS` has the 3 expected entries with correct dims.
- [ ] **Step 4: Implement `DesktopStartScreen.tsx`** — a charcoal/teal start surface: a header ("New Project"), the `DESKTOP_FORMATS` as clickable cards (onClick → `startNewProject(fmt)`), and a "Recent" list (from `listRecentProjects`, click → `openRecentProject`). Pure presentational over the actions; explicit return type; uses the existing token utilities (`bg-bg`, `bg-bg-2`, `text-fg`, `border-border`, `bg-accent-soft`, `text-accent`).
- [ ] **Step 5: Wire the gate in `DesktopApp.tsx`** — read `const hasProject = useProjectStore((s) => /* the condition */)`. If `!hasProject`, render `<DesktopStartScreen/>` (inside the title-bar shell); else render the existing `<Workspace/>` wrapped in `<EditorBootstrapGate>`. The title bar stays in both states. Keep the `.openreel-desktop` root + ErrorBoundary.
- [ ] **Step 6: Test** — extend `DesktopApp.test.tsx`: with no project → start screen ("New Project") shown; with a project (mock the store selector) → workspace tablist shown.
- [ ] **Step 7: Verify + commit** — typecheck + `test:run DesktopApp desktop-project-actions` + full suite.
```bash
git add apps/web/src/desktop/start/ apps/web/src/desktop/DesktopApp.tsx apps/web/src/desktop/DesktopApp.test.tsx
git commit -m "feat(web): desktop project gate + Resolve-style start screen (new project + recents)"
```

### Task 3: Edit page — Resolve docked layout reusing the panels

**Files:** Create `apps/web/src/desktop/pages/EditPage.tsx`; modify `apps/web/src/desktop/shell/Workspace.tsx`.

- [ ] **Step 1: Implement `EditPage.tsx`** — a CSS-grid docked layout under `EditorBootstrapGate`, re-composing the reused panels (import the real components; each is zero-prop + store-bound). Layout: Media Pool (left) · Viewer (center) · Inspector (right) on the top row; Timeline (full-width) on the bottom row. Each panel wrapped in `PanelErrorBoundary` (from `components/ErrorBoundary`). Use the desktop tokens for the dock frame (charcoal panels, 1px teal-on-hover borders, flat panel headers).
```tsx
import { AssetsPanel } from "../../components/editor/AssetsPanel";
import { Preview } from "../../components/editor/Preview";
import { InspectorPanel } from "../../components/editor/InspectorPanel";
import { Timeline } from "../../components/editor/Timeline";
import { PanelErrorBoundary } from "../../components/ErrorBoundary";
// grid: "media viewer inspector" / "timeline timeline timeline"
```
(Confirm the exact export names/paths of `Preview`, `Timeline`, `AssetsPanel`, `InspectorPanel`, `PanelErrorBoundary` by reading them — match named vs default. Give the panels sensible flex/min-h-0 containers so the canvas + timeline size correctly.)
- [ ] **Step 2: Wire into `Workspace.tsx`** — replace the `edit` branch of `PagePlaceholder` with `<EditPage/>`. Keep `color`/`deliver` as placeholders for now (Milestones B/C). The Workspace is already inside `EditorBootstrapGate`? No — put `<EditorBootstrapGate>` around the page bodies in Workspace (so engines init once for the workspace), OR wrap each page. Simplest: wrap the page-body container in Workspace with `<EditorBootstrapGate>` so all three pages mount under initialized engines.
- [ ] **Step 3: Verify build + tests** — `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run` (full suite; the Workspace test must still pass — it asserts tablist + page testids, which remain). Then `pnpm --filter @openreel/desktop build`.
- [ ] **Step 4: Commit**
```bash
git add apps/web/src/desktop/pages/EditPage.tsx apps/web/src/desktop/shell/Workspace.tsx
git commit -m "feat(web): desktop Edit page (Resolve docked layout reusing media/viewer/timeline/inspector)"
```

### Task 4: Run the desktop app — verify the Edit page is functional (human-in-the-loop)

**Files:** none (verification + parity note).

- [ ] **Step 1:** `pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop start` (launch). Confirm: the start screen appears; creating a project transitions into the Edit page; the Media Pool, Viewer (canvas), Timeline, and Inspector all render and the editor is interactive (import a media file, drop a clip, scrub/play, select a clip → inspector shows). This is the milestone: a usable desktop editor.
- [ ] **Step 2:** Record outcome + any issues in `apps/desktop/test/parity.md` under a "Phase 3 — Edit page" subsection (what works, what needs follow-up). Note that full interaction (WebGPU preview, playback, media import via native fs) is human-verified.
- [ ] **Step 3: Commit** the parity note.

---

# MILESTONE B — Color page

### Task 5: Color page (viewer + scopes + grading)

**Files:** Create `apps/web/src/desktop/pages/ColorPage.tsx`; modify `Workspace.tsx`.

- [ ] **Step 1: READ** `inspector/ScopesPanel.tsx` (props: `frameImage?: ImageBitmap`), `inspector/ColorGradingSection.tsx` (`clipId` prop), `bridges/render-bridge.ts` `renderCurrentFrame()`/`renderFrame(time)` (returns `RenderedFrame` with an ImageBitmap), and how Preview supplies the frame.
- [ ] **Step 2: Implement `ColorPage.tsx`** — layout: `Preview` (viewer, reused) center/left; a right rail with `ScopesPanel` (fed a frame from `getRenderBridge().renderCurrentFrame()` on playhead/selection change — subscribe to `useTimelineStore` playhead + `getSelectedClipIds`) and `ColorGradingSection` for the selected clip (gate on exactly one selected clip; else a "select a clip" message). Refresh the scope `frameImage` when the playhead or selected clip changes (a small effect calling `renderCurrentFrame()` and storing the ImageBitmap in state). Charcoal/teal dock chrome.
- [ ] **Step 3: Wire** the `color` branch in `Workspace.tsx` to `<ColorPage/>`.
- [ ] **Step 4: Verify** typecheck + full suite + desktop build. **Commit:** `feat(web): desktop Color page (viewer + scopes + color grading)`.

---

# MILESTONE C — Deliver page

### Task 6: Extract the export runner (behavior-preserving refactor, TDD)

**Files:** Create `apps/web/src/services/export-runner.ts` (+ test); modify `apps/web/src/components/editor/Toolbar.tsx`.

- [ ] **Step 1: READ** `Toolbar.tsx` `runExport` (:211), `showSavePicker` (:249), `handleCustomExport` (:500), `handleCancelExport` (:488) — capture exact signatures + the `getExportEngine().exportVideo(project, settings, writableStream)` async-generator loop and the desktop `window.__openreelExportPath` side-effect.
- [ ] **Step 2: Extract** `runExport`/`showSavePicker` (and the cancel handle) into `export-runner.ts` as standalone functions/hook with the SAME behavior (a `useExportRunner()` hook returning `{ runExport, showSavePicker, cancel, state }`, or plain functions + a small store). Keep desktop `__openreelExportPath` behavior. Unit-test the pure pieces (e.g. filename/ext resolution, the generator-progress reducer) with a mocked export engine.
- [ ] **Step 3: Refactor `Toolbar.tsx`** to consume `export-runner` instead of its inline `useCallback`s — behavior must be identical (web export still works). Run the full web suite to confirm no regression.
- [ ] **Step 4: Commit** `refactor(web): extract export runner from Toolbar into shared service`.

### Task 7: Deliver page (export + render queue)

**Files:** Create `apps/web/src/desktop/pages/DeliverPage.tsx`; modify `Workspace.tsx`.

- [ ] **Step 1: Implement `DeliverPage.tsx`** — reuse `ExportDialog` (or its settings inline) for export options; a "Render" action that calls the extracted `runExport` + `showSavePicker`; a render-queue list bound to `useGpuJobStore.getJobsForProject(projectId)` (the cloud GPU jobs), and mount `useGpuJobPoller()` here (or confirm it's mounted app-root). Show export progress from the export-runner state. Charcoal/teal chrome.
- [ ] **Step 2: Wire** the `deliver` branch in `Workspace.tsx` to `<DeliverPage/>`.
- [ ] **Step 3: Verify** typecheck + full suite + desktop build + launch (human: export a short project on desktop via the native FFmpeg sidecar). **Commit:** `feat(web): desktop Deliver page (export + GPU render queue)`.

---

## Self-Review
**Spec coverage (§5 Resolve UI):** start surface → T2; Edit page (media·viewer·timeline·inspector) → T3 (+ bootstrap T1); Color page (scopes·wheels·viewer) → T5; Deliver page (export·render queue) → T6/T7; charcoal/teal applies via the Phase-1 token layer. **Reuse model:** engine-bound panels (Preview/Timeline/AssetsPanel/InspectorPanel/ScopesPanel/ColorGradingSection/ExportDialog) reused wholesale per recon; only the shell/layout/chrome + project-start + export-runner extraction are new. **Web non-regression:** the only web-file edits are behavior-preserving extractions (T1 bootstrap hook if extracted; T6 export-runner) — both gated by the full web suite staying green; Toolbar/EditorInterface must behave identically. **Risk/verification:** the layout composition + live editor interaction (WebGPU preview, playback, native import/export) are integration/visual and need the running desktop app (T4 human check) — flagged, not unit-tested. **Milestone A (T1–T4) is the first shippable: a usable desktop editor.** B and C follow.
**Placeholders:** none — every task names real files/seams; the few "READ X then match the real export/condition" steps are verification instructions (the seam is identified from recon), not deferred work.

## Execution Handoff
Subagent-driven (per current mode), all subagents on opus. Milestone A first (usable editor), then B, then C. Layout/interaction tasks verify via build + the running app (human) since they're not unit-testable; logic tasks (bootstrap gate, project actions, export-runner pure pieces) are TDD.
