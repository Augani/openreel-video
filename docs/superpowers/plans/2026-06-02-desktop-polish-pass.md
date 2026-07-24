# Desktop Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (opus). Steps use checkbox (`- [ ]`).

**Goal:** Polish the desktop editor per user feedback: OpenReel branding (app icon + rotating-logo loading screen + title-bar logo), drop Color/Deliver tabs in favor of a single editor + an **Export** button, make the editor panels **resizable** (canvas/timeline/media/inspector), adopt the SF-Symbols icon set for desktop chrome, and improve perceived load speed.

**Architecture:** All changes are in the desktop view layer (`apps/web/src/desktop/`) + `apps/desktop` packaging; the web app and reused panels are untouched except a behavior-preserving extraction of the export runner from `Toolbar.tsx`.

**Assets (in this repo / machine):**
- App icon: `Openreel Video/Openreel Video/Assets.xcassets/AppIcon.appiconset/icon_1024.png` (1024×1024, dark square + green aperture mark) + `icon_1024_dark.png`, `icon_1024_tinted.png`.
- UI icon set: `/Users/augustusotu/Downloads/icons/` (6,430 SF-Symbols SVGs, names like `square.and.arrow.up.svg`, `play.fill.svg`, `sidebar.left.svg`, `plus.svg`, `clock.svg`).

**Reuse seams (from recon):** resize pattern = `EditorInterface.tsx:325-389` (`beginResize`, CSS vars `--media-w`/`--inspector-w`/`--tl-height`); export = `Toolbar.tsx` `runExport`(:211)/`showSavePicker`(:249) + `ExportDialog` (`components/editor/ExportDialog.tsx:120`, props `{isOpen,onClose,onExport(VideoExportSettings),duration?,projectWidth?,projectHeight?}`); bootstrap loader = `apps/web/src/desktop/editor/EditorBootstrapGate.tsx`; workspace = `apps/web/src/desktop/shell/Workspace.tsx`; title bar = `apps/web/src/desktop/shell/DesktopTitleBar.tsx`; edit page = `apps/web/src/desktop/pages/EditPage.tsx`.

**Conventions:** no line comments/JSDoc; explicit return types; avoid `any`; charcoal/teal tokens; do NOT modify reused panels/EditorInterface except the export-runner extraction (behavior-preserving, web suite must stay green).

---

### PP1: OpenReel logo SVG + desktop Icon component + curated SF-Symbols
**Files:** create `apps/web/src/desktop/brand/OpenReelMark.tsx` (the green aperture mark as an inline SVG, `currentColor`-friendly, accepts `size`/`className`); create `apps/web/src/desktop/icons/` (curated SF-Symbols SVGs copied from `~/Downloads/icons/`, fills normalized to `currentColor`) + `apps/web/src/desktop/icons/Icon.tsx` (`<Icon name="square.and.arrow.up" size={16}/>` rendering the inlined SVG via `import.meta.glob('./*.svg', {query:'?raw', eager:true})` + `dangerouslySetInnerHTML`, colored by `currentColor`).
- [ ] Recreate the OpenReel mark as an SVG (center filled circle + 8 spokes — 4 cardinal lines + 4 diagonal lines — inside a faint ring), single `currentColor` fill so it themes to the green accent. Match the icon_1024 proportions. Export `OpenReelMark({ size=24, className }): JSX.Element`.
- [ ] Curate ~14 SF-Symbols into `desktop/icons/` (copy + normalize `fill` to `currentColor`): `square.and.arrow.up` (export), `plus`, `plus.square`, `clock`, `sidebar.left`, `sidebar.right`, `rectangle.split.3x1` (timeline), `photo.on.rectangle` (media), `slider.horizontal.3` (inspector), `play.fill`, `pause.fill`, `xmark`, `minus`, `square.on.square` (maximize). Build `Icon.tsx` (explicit return type; unknown name → renders nothing/null defensively).
- [ ] Test `Icon.test.tsx`: renders an `<svg>` for a known name; renders null for unknown. `OpenReelMark.test.tsx`: renders an svg with the expected viewBox.
- [ ] Verify `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run Icon OpenReelMark`. Commit `feat(web): OpenReel logo mark + desktop SF-Symbols Icon component`.

### PP2: Branded rotating loading screen
**Files:** modify `apps/web/src/desktop/editor/EditorBootstrapGate.tsx` (+ test); add a keyframes rule (in `desktop-theme.css` or a tailwind `animate-spin` usage).
- [ ] Replace the plain "Loading editor…" text with a centered `<OpenReelMark>` rotating (CSS `animate-spin`, ~1.4s linear) in the accent/green, with a small "Loading editor…" label below, on the `bg` surface. Keep the same `{ready/error}` gate logic.
- [ ] Update the existing gate test to assert the mark (svg) + label render in the loading state (still child-hidden), child shown when ready.
- [ ] Verify typecheck + `test:run EditorBootstrapGate` + full suite. Commit `feat(web): rotating OpenReel logo loading screen for desktop editor`.

### PP3: Drop Color/Deliver — Workspace renders the editor directly
**Files:** modify `apps/web/src/desktop/shell/Workspace.tsx` (+ test); optionally simplify `DesktopApp`.
- [ ] Remove the Edit/Color/Deliver tab nav + `PagePlaceholder`; Workspace renders `<EditorBootstrapGate><EditPage/></EditorBootstrapGate>` directly (no page tabs). Keep it a thin component. (Leave `ui-store.desktopPage` in place but unused, OR remove it + its test — prefer leaving it to avoid churn; if removing, update ui-store + its test.)
- [ ] Update `Workspace.test.tsx`: it no longer has a tablist; assert it renders the (mocked) EditPage / a stable testid. Keep the gate mock.
- [ ] Verify typecheck + `test:run Workspace` + full suite. Commit `feat(web): desktop workspace is the editor directly (drop Color/Deliver tabs)`.

### PP4: Extract export runner + Export button + dialog (TDD the extraction)
**Files:** create `apps/web/src/services/export-runner.ts` (+ test); modify `apps/web/src/components/editor/Toolbar.tsx` (consume it, behavior-preserving); create `apps/web/src/desktop/editor/DesktopExportButton.tsx`; mount it in the desktop title bar (`DesktopTitleBar.tsx` children or EditPage top bar).
- [ ] READ `Toolbar.tsx` `runExport`(:211)/`showSavePicker`(:249)/`handleCustomExport`(:500)/`handleCancelExport`(:488). Extract `runExport`+`showSavePicker` (and a progress/state shape) into `export-runner.ts` (a `useExportRunner()` hook returning `{ run(settings,ext), showSavePicker, cancel, state:{isExporting,progress,phase,error?} }`), preserving the `getExportEngine().exportVideo(project, settings, writableStream)` async-generator loop + the desktop `window.__openreelExportPath` behavior. Unit-test the pure pieces (filename/ext resolution + the generator-progress reducer) with a mocked engine.
- [ ] Refactor `Toolbar.tsx` to consume `export-runner` (identical behavior; full web suite must stay green — proves no regression).
- [ ] `DesktopExportButton.tsx`: an `<Icon name="square.and.arrow.up"/>` + "Export" button that opens `ExportDialog`; on submit calls `useExportRunner().run(...)` with `showSavePicker`; shows progress (from `state`). Mount it in `DesktopTitleBar` (right side, before window controls) — pass it via the title bar's `children` slot from DesktopApp/EditPage, or render directly in the title bar gated to when a project is open.
- [ ] Verify typecheck + full suite + desktop build. Commit `feat(web): desktop Export button + shared export-runner (extracted from Toolbar)`.

### PP5: Resizable editor panels
**Files:** modify `apps/web/src/desktop/pages/EditPage.tsx` (+ a small `useResizable` hook, optionally `apps/web/src/desktop/editor/useResizable.ts` + test).
- [ ] Add drag handles between Media|Viewer, Viewer|Inspector, and Timeline|(top row): media width, inspector width, timeline height as state (mirror EditorInterface `beginResize` :325-378 — pointer events, min/max clamps). Drive the grid via inline `gridTemplateColumns`/`gridTemplateRows` from the state. Persist the sizes (localStorage or a desktop ui-store slice) so they survive reload. Extract the drag math into `useResizable` (pure clamp fn unit-tested).
- [ ] Test the clamp/resize-math hook (pure): `clampSize(value,min,max)` and the delta application. Verify typecheck + the hook test + full suite + desktop build. Commit `feat(web): resizable desktop editor panels (media/inspector/timeline)`.

### PP6: Adopt logo + SF-Symbols across desktop chrome + lazy-load heavy panels
**Files:** modify `DesktopTitleBar.tsx` (logo mark + window controls use `Icon`), `WindowControls.tsx` (Icon glyphs), `DesktopStartScreen.tsx` (plus/clock icons + logo), `EditPage.tsx` (panel-header icons), and lazy-load Preview/Timeline.
- [ ] Title bar: replace the "OpenReel" text with `<OpenReelMark/>` + wordmark; window controls (win/linux) use `Icon` (`minus`/`square.on.square`/`xmark`) instead of HTML entities. Start screen: format cards get an icon, recent rows get `clock`, header gets the mark. EditPage panel headers get small `Icon`s (`photo.on.rectangle`/`slider.horizontal.3`/`rectangle.split.3x1`).
- [ ] Perf: `React.lazy` the heavy panels in EditPage (Preview, Timeline) wrapped in `Suspense` (the bootstrap gate already covers engine readiness; lazy keeps the shell painting fast). Confirm the desktop main bundle still loads.
- [ ] Verify typecheck + full suite + desktop build. Commit `feat(web): OpenReel branding + SF-Symbols icons across desktop chrome; lazy-load heavy panels`.

### PP7: App icon packaging + run/verify
**Files:** copy `icon_1024.png` → `apps/desktop/build/icon.png`; modify `apps/desktop/electron-builder.yml` (`icon: build/icon.png` per-platform; electron-builder generates .icns/.ico from the 1024 png); set the dev `BrowserWindow` icon where applicable; update `apps/desktop/test/parity.md`.
- [ ] Copy the iOS 1024 icon to `apps/desktop/build/icon.png`. Add `icon: build/icon.png` to electron-builder.yml (top-level or per `mac`/`win`/`linux`). (mac/linux/win .icns/.ico auto-generated by electron-builder from the png.) For the dev window/dock, set `BrowserWindow` icon on win/linux (`icon: path.join(__dirname,"../../build/icon.png")`); mac dev dock uses the default unless packaged — note that.
- [ ] `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @openreel/desktop pack` → confirm `OpenReel.app` builds with the OpenReel icon (spot-check `release/*/OpenReel.app/Contents/Resources/*.icns` exists). Build + `pnpm --filter @openreel/desktop start` → confirm: rotating-logo loader on project open; editor with Export button; resizable panels; OpenReel icon in the dock (packaged) / window.
- [ ] Record outcome + remaining human checks in `apps/desktop/test/parity.md`. Commit `feat(desktop): OpenReel app icon (from iOS AppIcon) in electron-builder packaging`.

---

## Self-Review
**Coverage of feedback:** rotating logo loader → PP2; app logo/icon → PP1 (mark) + PP7 (packaging) + PP6 (title bar); resizable panels → PP5; export button → PP4; drop Color/Deliver → PP3; SF-Symbols icons → PP1+PP6; faster/better → PP6 lazy-load + PP2 perceived-load loader. **Non-regression:** only the export-runner extraction touches a web file (PP4) — behavior-preserving, web suite green is the gate; everything else is desktop-only. **Verifiability:** Icon/mark/export-math/resize-clamp are unit-testable; the visual chrome + packaged icon + live resize need the running/packaged app (PP7 human checks). **Order:** PP1 (assets/infra) first since PP2/PP4/PP6 depend on the Icon+mark; PP3 simplifies the shell; PP4/PP5 add the missing affordances; PP6 applies branding/icons; PP7 packages + verifies.
