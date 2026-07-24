# Inspector Redesign — Real Tabbed Inspector

Date: 2026-05-30
Status: Approved design, pending spec review
Area: `apps/web` (@openreel/web) — editor inspector panel

## 1. Problem

The right-side inspector (`apps/web/src/components/editor/InspectorPanel.tsx`, 2,268 lines)
exposes ~40 per-clip sections, but its "tabs" (Video / Audio / Speed / Animation / Adjust /
AI stylize) are **scroll anchors**, not real tabs: clicking one smooth-scrolls a single endless
column to a `data-inspector-tab` marker. Every section for the selected clip is stacked in one
scroll view. Users cannot find a control quickly, and the all-in-one file is hard to maintain.

Reference target (a Google AI Studio "Flowcut" prototype the user supplied, NOT openreel code):
a clean top tab strip where each tab shows **only its own controls** with simple sliders.

## 2. Goals

- Replace scroll-anchor navigation with **real isolated tabs**: selecting a tab swaps the panel
  to show only that tab's controls.
- **Preserve all existing functionality** — every section currently rendered in the clip
  inspector is kept and re-parented under a tab. No features removed.
- **Reuse existing section components and their store wiring unchanged** — this is a
  re-parenting + navigation-shell change, not a rewrite of the ~40 sections.
- Break the 2,268-line `InspectorPanel.tsx` into focused, independently-testable units.
- Tabs adapt to the selected clip's type.
- Improve slider ergonomics minimally for the "just move the slider" goal.

## 3. Non-goals

- No change to any section's editing semantics, store actions, or engine wiring.
- No change to effect/filter data models (the two filter systems stay as-is).
- No redesign of the subtitle inspector path beyond routing it through the new shell unchanged.
- Panels rendered **outside** the clip inspector are untouched: `MusicLibraryPanel`,
  `TextToSpeechPanel`, `TemplatesBrowserPanel`, `TemplateVariablesPanel`, `HistoryPanel`,
  `MarkersPanel`, `SceneNavigatorPanel`, `MultiCameraPanel`, `PhotoLayersSection`,
  `RetouchingSection`, `StickerPicker`/`StickerPickerPanel`, `SVGImporter`, `ScopesPanel`,
  `TransitionInspector`.
- Surfacing always-on Brightness/Contrast/Saturation sliders in the Color tab is a future
  enhancement (would change effect semantics) — explicitly out of scope.

## 4. Navigation architecture (decided)

**Horizontal top tabs**, underline-active style matching the reference. Icon + label per tab,
in a single horizontally-scrollable row. A **persistent clip header** above the strip shows
thumbnail + name + duration (the "Details" info) so it is always visible without a tab slot.

Media-clip tab set, left→right by workflow:

`Transform · Color · Effects · Audio · Speed · Animate · AI`

In-tab layout: most-used controls render immediately; secondary groups are **collapsible**
(via a single `InspectorGroup` primitive). Each tab's body is wrapped in an error boundary so a
single failing section cannot blank the whole inspector.

## 5. Component architecture

New/changed files under `apps/web/src/components/editor/`:

```
InspectorPanel.tsx          (slimmed) selection → <ClipInspector clipId> | <SubtitleInspector> | <EmptyState>
inspector/
  ClipInspector.tsx         owns active-tab state; derives visible tabs from clip type; renders active tab panel
  clip-tabs.config.ts       SINGLE SOURCE OF TRUTH: clipType → ordered tab ids → sections per tab
  shell/
    InspectorTabs.tsx       horizontal tab strip: icon+label, active underline, overflow-scroll, keyboard a11y
    InspectorClipHeader.tsx persistent header (thumbnail, name, duration, type badge)
    InspectorGroup.tsx      standardized collapsible sub-section (label, optional enable toggle, defaultOpen)
    InspectorTabErrorBoundary.tsx  wraps tab body
  tabs/
    TransformTab.tsx ColorTab.tsx EffectsTab.tsx AudioTab.tsx
    SpeedTab.tsx AnimateTab.tsx AiTab.tsx StyleTab.tsx
```

Each `*Tab.tsx` is a thin composition of existing section components, each wrapped in
`InspectorGroup`. Tabs receive `clipId` (and `clip` where a section needs the object) exactly as
sections receive them today.

### Component contracts

- **`InspectorTabs`** — props: `tabs: InspectorTabDef[]`, `activeId: string`,
  `onSelect(id)`. Renders icon+label buttons; active underline; horizontal overflow scroll;
  `role="tablist"`, arrow-key navigation, `aria-selected`. No store access.
- **`ClipInspector`** — props: `clipId: string`. Resolves `clip` + `clipType`; computes
  `visibleTabs` from `clip-tabs.config`; reads/writes active tab (see §6); renders
  `<InspectorClipHeader/>`, `<InspectorTabs/>`, and the active `*Tab` inside the error boundary.
- **`InspectorGroup`** — props: `title`, `defaultOpen?`, `enabled?`, `onEnabledChange?`,
  `children`. Replaces the ad-hoc `Section`/`SubSection` blocks; consistent styling.
- **`clip-tabs.config.ts`** — exports `getTabsForClipType(clipType): InspectorTabDef[]` and the
  canonical section→tab assignment used to render each tab.

## 6. State & behavior

- Active tab id is held in `ClipInspector` via `useState`, **seeded from and synced to `ui-store`**
  (new `inspectorActiveTab: string`) so switching clips of the same type keeps the chosen tab.
- On clip/clip-type change, if the persisted tab is not in the new clip's `visibleTabs`, clamp to
  the first visible tab.
- Selection still resolves via `ui-store.getSelectedClipIds()` / `lastSelectedItem`, then
  `project-store.getClip(clipId)` — unchanged.
- No selected clip → `<EmptyState/>`. Selected subtitle → `<SubtitleInspector/>` (existing path,
  re-parented, otherwise unchanged).

## 7. Control ergonomics (bounded)

Standardize numeric controls on the existing `LabeledSlider` (`@openreel/ui`) and add two
behaviors via a thin wrapper or extension:
- **Double-click the value pill → reset to that control's default.**
- **Click the value pill → type an exact value** (commit on Enter/blur, validate to min/max).

Applied centrally so every tab benefits; no per-section changes required.

## 8. Section → tab assignment (parity map)

Canonical assignment for **media clips**. Every section currently rendered in `InspectorPanel.tsx`
appears in exactly one tab for the clip types where it currently shows. Clip-type gating mirrors
today's flags (`showVideoEffects`/`showColorGrading`/`showAudioEffects`/etc.,
`InspectorPanel.tsx:798-910`).

| Tab | Sections (existing components) | Clip types |
|---|---|---|
| **Transform** | inline Transform (Position/Scale/Rotation/Opacity/BorderRadius/Fit), `CropSection`, `AlignmentSection`, `BlendingSection`, `Transform3DSection` | video, image (+ text/shape/svg/sticker for transform/align/blend/3d) |
| **Color** | `FilterPresetsPanel`, `ColorGradingSection` (white balance, color wheels, curves, HSL, LUT) | video, image |
| **Effects** | `VideoEffectsSection`, chroma-key inline + `GreenScreenSection`, `MaskSection`, `MotionTrackingSection`, `PiPSection`, `AdjustmentLayerSection`, `NestedSequenceSection`, `ParticleEffectsSection`, `BackgroundRemovalSection`, `BehindSubjectSection` | video, image (per-section gating preserved) |
| **Audio** | audio basics (volume/fade/pan — see note), `AudioEffectsSection`, `NoiseReductionSection`, `AudioDuckingSection`, `AutoCutSilenceSection`, `BeatSyncSection`, `AudioTextSyncPanel` | video, audio |
| **Speed** | `SpeedSection`, `StabilizationSection`, `SpeedRampSection` | video (audio: speed only) |
| **Animate** | `KeyframesSection`, `ClipTransitionSection`, `MotionPresetsPanel`, `MotionPathSection`, `EmphasisAnimationSection`, `TextAnimationSection` (text) | all visual types |
| **AI** | AI Stylize content, `AutoCaptionPanel`, `AutoReframeSection`, Quick Actions (Remove Background / Dialogue Cleanup / Auto-Color), `HighlightExtractorPanel`, `AutoEditPanel` | video |
| **Style** (replaces Color for non-media) | `TextSection`, `ShapeSection`, `SVGSection` | text / shape / svg / sticker |

Clip-type → tab order (reconciled with the actual per-section clip-type guards during
implementation — every listed tab has reachable content and no tab is empty; validated by
`InspectorPanel.tabs.test.tsx`):
- **video** → Transform, Color, Effects, Audio, Speed, Animate, AI
- **image** → Transform, Color, Effects, Speed, Animate, AI
- **audio** → Audio, AI
- **text / shape / svg** → Transform, Style, Effects, Animate
- **sticker** → Transform, Effects, Animate

Notes / to confirm during implementation (not design blockers):
- "Audio basics (volume/fade/pan)": confirm whether an inline volume/fade control exists in the
  current inspector; if so it moves into the Audio tab; if not, the Audio tab groups the existing
  audio sections only (adding a new basics control would be a separate enhancement).
- `ParticleEffectsSection` and `BehindSubjectSection` placement (Effects vs Animate/Style) is the
  table's call; adjust only if a clip-type gate requires it.

## 9. Testing (Vitest + @testing-library/react)

- `clip-tabs.config`: `getTabsForClipType` returns the expected ordered tab set per clip type.
- **Parity test**: assert every section component currently rendered in the inspector is
  referenced by exactly one tab module (no orphaned/dropped section).
- `InspectorTabs`: clicking a tab calls `onSelect`; active tab has `aria-selected`; arrow keys move.
- `ClipInspector`: renders the active tab; switching tabs swaps content; persisted tab restored;
  invalid persisted tab clamps to first visible.
- Smoke: each tab renders without throwing for each applicable clip type (existing section tests
  continue to cover section internals).
- `LabeledSlider` ergonomics: double-click resets to default; typing a value commits within bounds.

## 10. Risks & migration

- **Dropping a section** during re-parenting → mitigated by the §8 parity map + the parity test.
- **Clip-type gating drift** (a section showing for the wrong type) → preserve the exact flags from
  `InspectorPanel.tsx:798-910`; encode them in `clip-tabs.config`.
- **Subtitle path regressions** → route unchanged through the new shell; covered by a smoke test.
- Migration is incremental: build the shell + config + tabs alongside, switch `InspectorPanel` to
  render `ClipInspector`, then delete the old scroll-anchor body once parity tests pass.

## 11. Acceptance

- All current per-clip sections reachable via real tabs; no scroll-anchor navigation remains.
- Each clip type shows the correct tab set; selecting a tab shows only its controls.
- `InspectorPanel.tsx` reduced to a thin router; tab/shell units independently tested.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test:run` pass.
