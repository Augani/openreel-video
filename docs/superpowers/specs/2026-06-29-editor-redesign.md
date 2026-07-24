# Editor Redesign — Claude Design "Editor.dc.html"

Source mock: `creating-views/project/Editor.dc.html` (Video lines ~41–304, Motion lines ~306–591).
Goal: restyle the web + desktop editor and motion app to match the mock. Preserve ALL functionality.

## Design system (already wired into the app)

The app styles via Tailwind utilities backed by CSS variables in `apps/web/src/index.css`.
The foundation has already been retuned to the mock (light default, indigo accent, Inter font).
Reskin work = align each component's structure/detail to the mock USING THESE TOKENS.

Tailwind utilities → meaning (mock hex):
- `bg-bg` window/app bg (#f4f4f6) · `bg-bg-1` white card · `bg-bg-2` inset/pill (#f0f0f3) · `bg-bg-3` segmented track (#ececed)
- `border-border` (#e7e7ea) · `border-border-strong` (#d4d4d8)
- `text-fg` (#1d1d1f) · `text-fg-2` (#3a3a3c) · `text-fg-3` (#7c7c82 labels) · `text-fg-muted` (#9a9a9f)
- `bg-accent`/`text-accent` indigo (#6366f1) · `text-accent-fg` on-accent white · `bg-selected`/`bg-accent-soft` selected (#eef0fe)
- shadows `shadow-sm|md|lg` · radius `rounded-md|lg|xl|2xl` (card ≈ `rounded-xl` 12px)
- clip colors `bg-clip-video|audio|music` (follow existing codebase usage)
- Font: Inter is the default sans (already set). macOS traffic lights #ff5f57/#febc2e/#28c840 (desktop window chrome only — NOT web).

## Reskin rules (every component)

1. STYLING ONLY. Change `className` strings, inline `style` objects, and purely-presentational wrapper JSX. Do NOT touch handlers, hooks, state, props, exports, data flow, or imported logic symbols.
2. Prefer tokens over raw hex so dark mode keeps working. Use a raw mock hex only when no token fits.
3. Keep all existing features/buttons/menus — the mock is a simplified ideal; do not delete functionality the component has beyond the mock.
4. Keep Lucide icons (`@/icons/lucide-compat`) and the SF `Icon` (`@/icons/Icon`); swap icon glyphs only to better match the mock's line-icon look.
5. The file MUST still compile: never remove/rename an imported symbol, hook, prop, or handler.
6. Match the mock's spacing, radii, typography weights (500/600/700), borders, and the indigo selected/active states.

## Component → mock mapping

- `Toolbar.tsx` → top bar (mock 45–67 video / 310–332 motion): centered project title; right cluster = undo/redo, zoom dropdown, play, **Export split-button** (indigo, white, chevron). No fake traffic lights on web.
- `WorkspaceModeTabs.tsx` → segmented Video/Motion pill (mock 52–55): track `bg-bg-3`, 3px pad, `rounded-lg`; selected = white pill + `shadow-sm` + `text-fg`; idle = transparent + `text-fg-3`.
- `AssetsPanel.tsx` → left icon-rail + media panel (mock 72–178): rail items = stacked icon+label; selected = `bg-selected text-accent`; idle `text-fg-3`. Panel: 700/18 title, Import/Record buttons (`bg-bg-2 border-border`), 2-col media grid w/ rounded thumbs + duration badge + filename.
- `Preview.tsx` → preview card + transport (mock 180–203): timecode left, centered transport (skip/●play/skip/end), right = Fit dropdown + settings, all `bg-bg-2`/`rounded` pills.
- `InspectorPanel.tsx` → tabs + property rows (mock 205–229): tab row w/ active indigo underline; section headers 600/14 + chevrons; property rows = `text-fg-3` label + bordered value chips; sliders indigo fill + white knob; pill toggles.
- `Timeline.tsx` → timeline card (mock 232–302): 48px toolbar of line-icon tools + zoom slider; track-label column; ruler; clips; indigo/dark playhead.
- `motion/MotionCreatorShell.tsx` → motion top bar + comp tabs + canvas toolbars/bottom bar (mock 306–461).
- `motion/components/PropertiesPanel.tsx` → Design/Animate/Inspect tabs + Align/Distribute/Transform/Text/Layer (mock 463–512).
- `motion/components/LayerPanel.tsx` + `motion/components/MotionTimeline.tsx` → layers tree (selected `bg-selected`) + keyframe ruler/rows/playhead (mock 515–589).
- `motion/components/AssetPanel.tsx` + `motion/components/MotionToolRail.tsx` + `motion/components/StageCanvas.tsx` → assets panel (mock 338–376), tool rails (339–348, 386–403), canvas overlays (405–445).

Verification: `apps/web` must pass `tsc --noEmit` and existing vitest suites after reskinning.
