# OpenReel Studio — Ground-Up Redesign

**Date:** 2026-05-27
**Status:** Draft — sections walked through and approved in brainstorming; awaiting final review of this written spec
**Author:** Augustus Otu (with Claude)
**Supersedes (UX only):** `STUDIO_PLAN.md` §9, §9A, §14 (the Studio UI sections)
**Does not change:** `packages/fxpkg` interface, `STUDIO_PLAN.md` Part II (Contract), Part V (Runtime Internals), Part VI (Cross-Platform), Part VII (Marketplace)

---

## 1. Context

The current studio (`apps/studio`, branch `feat/studio-app`) is built around a raw node-graph canvas as its primary authoring surface. In practice this is too low-level — creators land on the editor and don't know how to start, and even the project's own author can't build a working effect or filter without friction. The complaint isn't about missing features; it's about navigation, discoverability, and mental model.

The reference point is Snap Lens Studio's authoring experience, where creators think in terms of "track this subject, apply these behaviors". The output of OpenReel Studio is still `.fxpkg` video-VFX artifacts (per `STUDIO_PLAN.md`), but the **authoring experience** is being redesigned to be subject-first instead of graph-first.

`packages/fxpkg`, `apps/cloud`, and `infra/gpu-worker` are out of scope structurally — the redesign generates the same `.fxpkg` format the existing infrastructure consumes. The change is the studio UX and the new internal scene-store that drives it.

## 2. Goals

1. **A creator with no prior exposure can ship a useful effect in under 5 minutes.** The default flow from `studio.openreel.video` → published effect must be obvious.
2. **Subject tracking is a first-class concept**, not buried inside graph nodes. A creator thinks "what do I want to track?" then "what should happen to it?"
3. **Hide complexity behind polished presets**, while leaving an atomic-block escape hatch for power users — without exposing the raw graph.
4. **Reuse the existing `.fxpkg` runtime contract verbatim.** The redesign compiles a high-level Scene model to the same `Graph` the runtime, compiler, and validator already understand.
5. **Real-video preview with real detection.** Preview never uses mock content; the creator sees actual MediaPipe output on actual sample (or uploaded) footage.

## 3. Non-goals (v1)

- Raw node-graph view of any kind (no escape hatch to the canvas; deferred to v2).
- Multi-instance subjects (multiple faces or silhouettes in one scene).
- Body/pose, background/sky, and manual-mask subject types.
- Cloud sync of drafts (drafts are device-local in IndexedDB).
- Marketplace browse/install UI (link only, "Coming soon").
- Redesigning the Template editor (kept as-is — its workflow doesn't have the same navigation problem).
- Server-rendered previews for huge user clips.
- "Convert to graph" fork flow.

## 4. Approach

**Approach 1 (greenfield in-place rewrite)** was chosen over a parallel `v2/` build or strangler/phased replacement.

Rationale: the studio is on a feature branch; the existing node-graph UI is exactly the source of the navigation problem; preserving any of it would smuggle the same problems into the new design. Doing the rewrite in-place keeps the package surface and the rest of the monorepo's imports stable.

The new editor's **Scene** model is the canonical source of truth in the studio's store. The fxpkg `Graph` is **derived at compile time** by a `sceneToGraph()` function — Scene mutates, Graph regenerates. No two-way sync; eliminates a whole class of bugs the current store has.

## 5. UI conventions

- No emojis in shipped UI. Use the existing icon system at `apps/studio/src/icons.tsx` (`<Icon name="sparkle" />`, `<Icon name="face" />`, etc.). Add new entries to the `IconName` union + `PATHS` map as needed.
- Tailwind is the styling system. No inline styles in shipped code. Extend `tailwind.config.js` if a class isn't expressive enough.
- Emojis appear in this document and brainstorm mockups only — they are scaffolding for design discussion, not specs for the real UI.

## 6. Information architecture

One React/Vite app at `studio.openreel.video`. One shell, three editors, one hub.

| View (internal state) | Component | Purpose |
|---|---|---|
| `hub` | `apps/studio/src/hub/Hub.tsx` | Recent projects · Start new (Effect / Filter / Template) · Preset gallery · Tutorials link |
| `effect` | `apps/studio/src/effect/EffectEditor.tsx` | Subject-aware VFX editor (new — the hero surface) |
| `filter` | `apps/studio/src/filter/FilterEditor.tsx` | Stack-of-adjustments editor for color/stylize (new) |
| `template` | `apps/studio/src/components/template/TemplateAuthor.tsx` | Existing template/EDL editor, untouched |
| `tutorials` | existing `apps/studio/src/tutorials/Tutorials.tsx` | Existing tutorials page, untouched |

Persistent shell chrome: `TopBar` (logo · project name · view-specific actions · user menu) and `StatusBar` (perf HUD inside editor views).

Removed at this layer: the existing `Gallery.tsx` mixed gallery and the standalone `BlueprintBuilder` view (`view: "blueprint"`).

## 7. Effect editor

Three columns under a 40px top bar, with a 22px status bar at the bottom.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  TopBar (40px)                                                             │
├──────────────┬──────────────────────────────────────┬──────────────────────┤
│              │                                      │                      │
│  Scene tree  │           Preview                    │      Inspector       │
│  (240px)     │           (flex)                     │      (320px)         │
│              │                                      │                      │
├──────────────┴──────────────────────────────────────┴──────────────────────┤
│  StatusBar (22px)                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Scene tree (left column, 240px)

- Header: section label "Scene" + "+ Subject" button.
- Body: subjects at root, behaviors nested under their owning subject. Each subject row shows: icon, name (rename inline), visibility eye toggle. Each behavior row shows: icon, name, visibility eye toggle.
- Each subject has an always-visible "+ Add behavior" affordance immediately under it.
- Footer: count chip ("3 subjects · 1 behavior") + per-frame ms cost.
- Selection: one item at a time. Selecting changes the inspector. Selecting a subject also tints its mask overlay in the preview.

### 7.2 Preview (center column, flex)

- Header bar: sample-clip selector + Mask / Compare / Quality toggles.
- Canvas: real video plays with the compiled effect applied, in real time. Clicking on a tracked subject in the canvas selects the corresponding tree node.
- Footer bar: play/pause + scrub timeline + current time.
- See §10 for engine details.

### 7.3 Inspector (right column, 320px)

- Header: shows the selected node's icon + name (inline-editable), with a subtitle indicating context ("on Face" for behaviors).
- Body: generated from the selected node's `paramSchema` (see §9.5 for param renderers).
- Footer actions: Duplicate, Remove.
- Empty state (when nothing is selected): a small "Tips" panel — no orphan empty box.

### 7.4 "+ Subject" popover

A compact 3-tile popover with the v1 subject kinds: Face, Subject silhouette, Full frame. Tiles greyed out + tooltipped ("Already in scene") if already present — each kind can appear at most once in v1.

### 7.5 "+ Add behavior" sheet

Docked panel that overlays from the left edge of the preview area:

- Header shows the target subject ("Add behavior to: Face") + a search input.
- Section 1: **Effects** — preset behaviors filtered by selected subject's kind, rendered as thumbnail cards with hover-to-play GIF/MP4 previews.
- Section 2: **Adjustments** — atomic behaviors, same filtering, same card style.
- Clicking a card adds the behavior, closes the sheet, and selects the new behavior so its inspector opens immediately.

## 8. Subject taxonomy & data model

```ts
export type SubjectKind = "face" | "subject_silhouette" | "full_frame";

export interface Subject {
  id: string;
  kind: SubjectKind;
  name: string;
  visible: boolean;
  behaviors: Behavior[];
}

export interface Scene {
  subjects: Subject[];
  sampleClipId: string;
}
```

Each kind appears at most once per scene in v1 (no multi-instance).

**Subject capability registry** (`apps/studio/src/effect/subjects.ts`):

| Kind | Detector | Anchors | Default name | Icon |
|---|---|---|---|---|
| `face` | MediaPipe `FaceLandmarker` | `eyes`, `eye_left`, `eye_right`, `nose`, `mouth`, `jaw`, `forehead`, `face_bbox` | "Face" | `face` |
| `subject_silhouette` | MediaPipe `ImageSegmenter` | `mask`, `mask_edge`, `bbox`, `centroid` | "Subject silhouette" | `person` |
| `full_frame` | (none) | `frame`, `center`, `corners` | "Full frame" | `monitor` |

The capability registry is the gating mechanism: a behavior in the palette declares `acceptsSubjects: SubjectKind[]` and is shown/hidden in the "+ Add behavior" sheet based on the selected subject's kind.

**Scene → Graph compile** (`apps/studio/src/effect/compile.ts`):

```
sceneToGraph(scene) →
  for each Subject:
    emit detector input nodes (deduped across subjects)
    for each Behavior (ordered):
      call behavior.emit(subject, params) → GraphFragment
      append to the scene-wide composite chain
  emit final Composite + Output
  → existing fxpkg Graph
```

Manifest's `requirements.detection` is derived: `Scene.subjects.map(s => capabilities[s.kind].detector).filter(Boolean)`. No manual flag-setting by creator.

## 9. Behavior taxonomy & palette

Behaviors are the things creators stack on subjects. Two kinds:

```ts
export type Behavior =
  | { id: string; kind: "preset"; presetId: string; params: Record<string, unknown>; name: string; visible: boolean; }
  | { id: string; kind: "atomic"; atomicKind: AtomicKind; params: Record<string, unknown>; name: string; visible: boolean; };
```

### 9.1 Preset behaviors (v1 set)

| Preset id | Accepts | Controls | Internal recipe |
|---|---|---|---|
| `fire-aura.v1` | `subject_silhouette` | Intensity · Color · Flame height · Heat distortion · Behind/Front | edge sampler → particles (back) → source → particles (front) → glow → light wrap |
| `sparkles.face.v1` | `face` | Style (Gold/Diamond/Holo) · Amount · Size · Color · Anchor | landmark emitter → sprite particles → additive glow |
| `ghost-trail.v1` | `subject_silhouette` | Trail length · Fade · Color tint | frame history × N → masked composite chain |
| `clone.three.v1` | `subject_silhouette` | Spacing · Echo opacity | cutout × 3 with x-offsets → composite |
| `aura-glow.v1` | `subject_silhouette` | Color · Pulse speed · Thickness · Softness | mask edge → blur → additive glow with pulse modulator |
| `background-replace.v1` | `subject_silhouette` | Background (color/image/blur) · Edge softness | cutout + replace bg |
| `face-tint.v1` | `face` | Tint color · Strength · Skin-only toggle | face mask → color tint blend |
| `warm-look.v1` | `full_frame` | Warmth · Vignette · Grain | LUT + vignette + grain |
| `cinematic-bars.v1` | `full_frame` | Bar height · Letterbox color | crop + composite |
| `dreamy.v1` | `full_frame` | Glow · Bloom · Soft contrast | gaussian blur + screen blend + contrast curve |

These map onto the existing preset content in `apps/studio/src/components/blueprint/` — re-exported through the new behavior registry interface.

### 9.2 Atomic behaviors (v1 set)

"all" below is shorthand for the v1 subject set: `["face", "subject_silhouette", "full_frame"]`. The registry stores the expanded list — `acceptsSubjects: SubjectKind[]` per §9.3.

| Atomic | Accepts | Controls | Notes |
|---|---|---|---|
| `glow` | all | Color · Intensity · Spread | additive bloom around the subject's mask or whole frame |
| `particles` | all | Source (edge / landmark / area) · Sprite · Rate · Gravity · Color · Lifetime | exposes particle system directly |
| `color-tint` | all | Color · Blend mode · Strength | constrained to subject's mask region |
| `blur` | `subject_silhouette`, `full_frame` | Radius · Quality | for `subject_silhouette`, applies to the background (inverted mask) |
| `replace` | `subject_silhouette`, `full_frame` | Replacement (color/image/none) · Edge softness | for silhouette = bg replace |
| `distort` | all | Type (wave/pinch/pixelate) · Strength | |
| `mask-edge` | `face`, `subject_silhouette` | Color · Thickness · Style (solid/dashed/glow) | outline-only stylize |

### 9.3 Registry interface

```ts
export interface BehaviorDef<P = unknown> {
  id: string;
  kind: "preset" | "atomic";
  label: string;
  iconName: IconName;
  acceptsSubjects: SubjectKind[];
  paramSchema: ParamSchema<P>;
  defaultParams: P;
  thumbnailUrl: string;
  emit(ctx: EmitCtx, subject: Subject, params: P): GraphFragment;
}
```

`ParamSchema<P>` is a Zod schema (`z.ZodType<P>`). The studio uses Zod's `safeParse` for pre-publish validation and its introspected shape to drive the inspector's param renderers (§9.5). The schema is the single source of truth for both validation and UI generation per behavior.

Registration is one new file per behavior plus an entry in `apps/studio/src/effect/behaviors/registry.ts`. Marketplace-loaded behaviors in v2 will use the same interface.

### 9.4 Behavior palette UX

See §7.5. Filtering by selected subject's `kind` happens against `acceptsSubjects`. Thumbnails (`thumbnailUrl`) are pre-rendered GIF/MP4 clips of the behavior on a stock face/silhouette video, served from R2.

### 9.5 Inspector param renderers (shared between editors)

| Param type | UI |
|---|---|
| `float` (min/max) | slider + numeric input + reset |
| `color` | swatch + popover (hex/HSL) |
| `enum` | segmented control (≤4 values) or dropdown |
| `bool` | switch |
| `vec2` | two linked sliders |
| `image` (asset) | thumbnail picker opening asset drawer |
| `enum<Anchor>` | dropdown populated from `subjects[parent.kind].anchors` |

## 10. Preview engine

`apps/studio/src/effect/preview/`:

- `PreviewEngine.ts` — owns the canvas, video element, detector pool, frame loop.
- `VideoSource.ts` — abstracts sample-clip URL vs. user-uploaded file (`URL.createObjectURL`); always feeds an `HTMLVideoElement`. Never mock content.
- `DetectorPool.ts` — lazily instantiates only the detectors the current Scene needs (MediaPipe Tasks Vision: `FaceLandmarker`, `ImageSegmenter`); tears down when a subject is removed.
- `RenderLoop.ts` — `requestVideoFrameCallback` (fallback `requestAnimationFrame`); each frame: pull video frame → run detectors → execute compiled pipeline → composite.

The pipeline execution itself uses the existing `packages/fxpkg` runtime — WebGPU primary path, WebGL2/Canvas2D fallback as already established for the OpenReel core. The preview engine is the studio-side host; the rendering primitives are shared with the rest of OpenReel.

**Recompile vs. uniform update:**
- Scene mutations (add/remove subject/behavior, reorder) → debounced 250ms → `sceneToGraph()` runs → pipeline rebuilt.
- Param changes (slider drags) → no recompile; hot-update uniform buffers via stable param-id binding map. Slider scrubs are jitter-free.

Verifying the hot-param path is a v1 implementation prerequisite: if `packages/fxpkg`'s current pipeline can't accept uniform updates without recompile, the implementation plan must either extend it or fall back to debounced recompile (250ms) on param changes too — with a corresponding UX note that scrubs may stutter on complex scenes. See risks table.

**Sample clip library** — curated, hosted on R2. v1 clips include portrait close-up, portrait mid-shot, full-body, multi-person, outdoor landscape, low-light, high-motion. Indexed in `apps/studio/public/samples/index.json` (committed to repo, content served from R2). Each is real footage exercising specific detection cases.

**User-uploaded clips** — one-click "Use your own": accepts `video/*` ≤ 200MB ≤ 60s; stays local (object URL); persists per-project in IndexedDB (file handles via Origin Private File System where supported, otherwise re-pick on next session).

**Preview controls** — Compare (split slider), Mask (overlay active subject's mask), Quality (Full / Balanced / Perf, controls preview resolution and optional passes).

**Performance HUD** in status bar — ms/frame · active detectors · FPS · estimated GPU memory.

**Failure modes:**
- Detector model load failure → red toast + 3 auto-retries, warning chip on subject.
- Per-frame detection failure → falls back to last-known-good mask, yellow "detection unstable" status pill.
- Sample clip 404 → fall back to next clip in index, recoverable error surface.

## 11. Filter editor

`apps/studio/src/filter/FilterEditor.tsx`. Narrower than Effect editor; no scene tree.

```
┌────────────────────────────────────────────────────────────────────────┐
│ TopBar                                                                 │
├────────────────────────────────────────────┬───────────────────────────┤
│                                            │  Adjustment stack         │
│            Preview (flex)                  │  (drag-reorderable)       │
│      real video, real-time grade           │  + Add adjustment         │
│      compare slider, before/after          │  ─────────────────────    │
│                                            │  Inspector for selected   │
│                                            │  adjustment               │
├────────────────────────────────────────────┴───────────────────────────┤
│ StatusBar                                                              │
└────────────────────────────────────────────────────────────────────────┘
```

```ts
export interface FilterDoc {
  name: string;
  sampleClipId: string;
  adjustments: Behavior[];
}
```

`filterDocToGraph()` is a thin wrapper around `sceneToGraph()` — constructs a synthetic `Scene` with a single `full_frame` subject whose `behaviors` are the filter's adjustments. **One compile path, two editors.**

"+ Add adjustment" opens the same palette sheet as Effect editor, pre-filtered to behaviors valid against `full_frame` plus the `full_frame`-only presets (Warm Look, Cinematic Bars, Dreamy).

Drag-handle reordering in both editors (order = blend order).

Publish validation for `kind: filter`: no subjects other than `full_frame` (always true by construction), `requirements.detection: []` always.

## 12. Hub

`apps/studio/src/hub/Hub.tsx` — replaces `Gallery.tsx`.

Three sections:

1. **Start something new** — three big tiles (Effect / Filter / Template). Each opens the corresponding editor with a default sample clip auto-loaded and an empty scene/stack/timeline. Project name defaults to "Untitled <kind>", renamable in top bar.

2. **Continue your work** — recent projects from IndexedDB sorted by `updatedAt`. Each card: thumbnail (regenerated on draft save by capturing the preview canvas), name, kind chip, "edited 2h ago". A "+ New" tile at the end.

3. **Start from a preset** — flat gallery of every registered preset (same registry the behavior palette reads from), with a kind filter (All · Subject · Filter · Template). Clicking a preset opens the right editor pre-filled.

Bottom: small links — Tutorials · Docs · Marketplace (coming soon).

Drafts schema (`apps/studio/src/hub/drafts.ts`):
```ts
interface DraftRecord {
  id: string;            // nanoid
  kind: "effect" | "filter" | "template";
  name: string;
  doc: Scene | FilterDoc | TemplateDoc;
  thumbnailDataUrl: string;
  updatedAt: number;
  schemaVersion: number;
}
```

Routing in `App.tsx`:
```ts
type View = "hub" | "effect" | "filter" | "template" | "tutorials";

commands: {
  goHome(): view = "hub"
  newEffect(): EffectEditor + empty Scene
  newFilter(): FilterEditor + empty FilterDoc
  newTemplate(): TemplateAuthor (unchanged)
  openPreset(id): lookup registry, open right editor pre-filled
  openRecent(id): load draft from IndexedDB, open right editor
  openTutorials(): view = "tutorials"
}
```

## 13. Publishing flow

### 13.1 Save draft (local-only)

- Auto-save 2s after idle on any mutation (debounced).
- Manual via ⌘S or Save button — flushes immediately.
- Writes to IndexedDB (`openreel-studio.drafts`).
- Thumbnail regenerated on each save: capture preview canvas at current scrub → downscale to 320×320 → encode `image/webp` data URL.

### 13.2 Publish

```
Publish click
  → 1. Validate (client-side): name set, ≥1 subject/adjustment, params satisfy schemas,
       kind-specific rules (filters: full_frame only)
  → 2. Compile (client-side): sceneToGraph() → fxpkg Graph + pipeline.json + WGSL,
       bundle referenced assets, render 3–5s preview.mp4 + cover.webp from middle frame
  → 3. Submit: POST multipart .fxpkg to apps/cloud, returns submission_id
  → 4. Server-side validation (apps/cloud → gpu-worker):
       re-compile from source/graph.json (don't trust client output),
       render against same sample clip, SSIM check ≥ 0.99 vs client preview,
       size/perf/safety checks per STUDIO_PLAN.md §38
  → 5. UI: top-bar pill cycles "Validating… → Uploading… → Reviewing… → Published";
       on error: modal with structured error, "Fix and retry" CTA
```

### 13.3 Pre-publish dialog

The only place metadata is collected (title, description, tags, license, visibility, kind confirm, version bump). No metadata fields scattered in editor panels. Includes a re-render-preview action.

### 13.4 Versioning

First publish `1.0.0`; republish auto-bumps minor unless creator opts for major in dialog. `id` stable across versions; immutable URLs per version per `STUDIO_PLAN.md` §6.4.

### 13.5 Republish vs duplicate

- "Publish" on an already-published project pre-fills last-published metadata; confirming bumps version.
- "Duplicate as new project" in the project menu creates a fresh `id` for forking.

### 13.6 Backend touchpoints

- `apps/cloud`: `POST /v1/submissions` (multipart upload, returns submission_id), `GET /v1/submissions/:id` (polled by client). Add if not present.
- `infra/gpu-worker`: new job kind `validate_fxpkg` runs server-side re-compile + render + SSIM compare.

### 13.7 Error UX

- Validation errors (client): inline red borders + toast pointing to the offending behavior; tree node gets a red dot.
- Compile errors (rare): "Couldn't compile this effect — please report" with copyable blob.
- Server validation errors: modal with diverging frame screenshot, threshold, measured value.

## 14. Migration plan

### 14.1 Deleted

| File | Why |
|---|---|
| `apps/studio/src/editor/Canvas.tsx` | Node-graph canvas — graph view dropped in v1 |
| `apps/studio/src/editor/Palette.tsx` | Node palette — replaced by behavior palette sheet |
| `apps/studio/src/editor/Inspector.tsx` | Node inspector — replaced by subject/behavior inspector |
| `apps/studio/src/editor/CompilePanel.tsx` | Compile output — folded into status bar perf HUD |
| `apps/studio/src/editor/EffectEditor.tsx` | Old shell — replaced by `effect/EffectEditor.tsx` |
| `apps/studio/src/editor/Preview.tsx` | Old preview — replaced by `effect/Preview.tsx` + the new preview engine in `effect/preview/` |
| `apps/studio/src/editor/store.tsx` | Graph store — replaced by scene store |
| `apps/studio/src/editor/nodeFields.ts` | Node field metadata |
| `apps/studio/src/editor/visuals.ts` | Node visual styles |
| `apps/studio/src/components/Gallery.tsx` | Mixed starter gallery — replaced by Hub |
| `apps/studio/src/components/blueprint/BlueprintBuilder.tsx` and dir | Standalone Blueprint view — content folds into Hub gallery + behavior palette (preset bodies repurposed into `effect/behaviors/presets/`) |

### 14.2 Touched (re-skinned or re-routed, same package interface)

- `apps/studio/src/App.tsx` — new view set: `hub` / `effect` / `filter` / `template` / `tutorials`.
- `apps/studio/src/components/TopBar.tsx` — re-skinned, same prop shape.
- `apps/studio/src/components/StatusBar.tsx` — re-skinned, gains perf HUD.
- `apps/studio/src/commands.tsx` — new command surface.
- `apps/studio/src/lib/api.ts` — adds `submitForReview()` + `getSubmissionStatus()`.

### 14.3 Untouched

- `apps/studio/src/main.tsx`, `apps/studio/src/icons.tsx` (only additions to the icon set), `apps/studio/src/components/Logo.tsx`, `Menubar.tsx`, `Button.tsx`.
- `apps/studio/src/components/template/TemplateAuthor.tsx` — Template editor unchanged in v1.
- `apps/studio/src/tutorials/`.
- `packages/fxpkg/` — Graph/manifest/compiler interfaces unchanged.
- `apps/cloud/` and `infra/gpu-worker/` — additive only.

### 14.4 New files

```
apps/studio/src/
  effect/
    EffectEditor.tsx
    SceneTree.tsx
    Preview.tsx
    Inspector.tsx
    BehaviorPaletteSheet.tsx
    SubjectPickerPopover.tsx
    SampleClipSelector.tsx
    scene.ts
    subjects.ts
    behaviors/
      registry.ts
      presets/                 # one file per preset
      atomics/                 # one file per atomic
    compile.ts                 # sceneToGraph()
    preview/
      PreviewEngine.ts
      VideoSource.ts
      DetectorPool.ts
      RenderLoop.ts
    store.ts
    sceneToGraph.test.ts

  filter/
    FilterEditor.tsx
    AdjustmentStack.tsx
    compile.ts                 # filterDocToGraph()
    store.ts

  hub/
    Hub.tsx
    RecentProjects.tsx
    PresetGallery.tsx
    drafts.ts

  publish/
    PublishDialog.tsx
    validate.ts
    submit.ts
```

### 14.5 Delivery

**Single PR** on branch `feat/studio-redesign` (forked from `feat/studio-app`). The full redesign lands together — deleting the old editor partway through would leave the studio non-functional. Internal milestones:

1. Scene/Subject/Behavior types + registry scaffolding + behavior registration.
2. `sceneToGraph()` + tests against `packages/fxpkg` validator.
3. PreviewEngine + DetectorPool (real MediaPipe) + sample clip plumbing.
4. EffectEditor shell (SceneTree, Preview, Inspector, palette sheet, popover).
5. FilterEditor + adjustment stack.
6. Hub + drafts (IndexedDB) + thumbnail capture.
7. PublishDialog + client validation + submit/status polling.
8. `apps/cloud` submission endpoints + `gpu-worker` `validate_fxpkg` job.
9. Delete old editor files + Gallery + BlueprintBuilder; update `App.tsx`, `TopBar`, `StatusBar`.
10. E2E Playwright test for the core flow.

### 14.6 Test strategy

- **Unit:** each behavior's `emit()` produces a valid `GraphFragment` (assert against `packages/fxpkg` validator).
- **Property (fast-check):** `sceneToGraph(scene)` is well-formed (DAG, type-checks) for any registry-generated scene.
- **Snapshot:** golden `pipeline.json` per preset; CI fails on unintended drift.
- **Component:** SceneTree drag/drop, behavior add/remove, palette filtering by subject kind.
- **E2E (Playwright):** hub → new Effect → add Face → add Sparkles → tune Amount → save draft → reopen → publish (mock server).

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Real-time MediaPipe detection can't hold framerate on mid-range laptops | Quality toggle drops preview resolution + skips optional passes (e.g., heat distortion); status pill flags "detection running slow"; preview is always best-effort, never blocks editing |
| Preset `emit()` functions diverge from validated graph shape over time | Snapshot tests on `pipeline.json` per preset; CI fails on unintended drift |
| Server SSIM parity check is flaky on first marketplace pass | Start in informational-only mode (warning, not blocker) for first 2 weeks, then enforce |
| User-uploaded clips trigger OOM on huge files | 200MB / 60s caps with friendly error; fallback to sample clip |
| Detector model downloads slow on first run | Cache models in IndexedDB; show skeleton state with "Loading detection models…" while preloading |
| `packages/fxpkg` pipeline can't hot-update uniforms without recompile | Confirm capability as first task of implementation; if missing, either extend fxpkg or fall back to 250ms-debounced recompile on param changes (UX caveat: scrub may stutter on complex scenes) |

## 16. Open questions

None blocking implementation. Resolved during brainstorming:
- Layout: Lens Studio (tree + preview + inspector).
- Subject scope: Face + Subject silhouette + Full frame.
- Behavior model: hybrid (presets + atomics).
- Filter as separate editor (not just an Effect mode).
- Raw graph view: cut from v1.
- Cloud sync of drafts: deferred.
- Server-side validation: in-scope, but informational-only at launch.

## 17. Glossary

- **Scene** — the canonical document the Effect editor manipulates. Contains an ordered list of Subjects, each with an ordered list of Behaviors.
- **FilterDoc** — the canonical document the Filter editor manipulates. Equivalent to a Scene with one implicit `full_frame` subject.
- **Subject** — a tracked region in the video the creator authors against (Face / Subject silhouette / Full frame in v1).
- **Behavior** — a visual effect applied to a subject. Either a preset (full curated recipe) or an atomic (small building block).
- **Preset behavior** — named, polished, hides its internal graph. Authored as one file under `effect/behaviors/presets/`.
- **Atomic behavior** — exposes a single graph operation with friendly controls. Composable.
- **Anchor** — a named attachment point a subject exposes (e.g., `face.eyes`, `subject_silhouette.mask_edge`). Behaviors reference anchors in their params.
- **sceneToGraph** — pure function converting a Scene to the existing fxpkg `Graph` representation. Runs at preview-compile and publish time.
