# AE Ergonomics Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the AE-parity review's 8 quick wins: text tracking/leading/box + stroke, P/S/R/T/A/U reveal shortcuts (AE grammar), drag undo coalescing, the web ProRes/alpha guardrail, the Add blend-mode family, star/polygon params, and N-stop gradient editing.

**Architecture:** Small bounded changes: UI wiring in PropertiesPanel for engine features that already exist (1, 7, 8), one small text-style engine addition (2), a keyboard-grammar swap in StageCanvas + timeline reveal filter (3), a preview-vs-commit gesture protocol in StageCanvas/project-store (4), an export-UI guardrail (5), and blend-mode additions in the video/motion composite paths (6).

**Tech Stack:** TypeScript strict, React, Vitest + RTL, Canvas2D.

## Global Constraints

- Do NOT git commit/add/stash/revert — leave changes in the working tree.
- NO line comments, NO docstrings. TS strict, NEVER `any`/unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates.
- TDD per task: failing test → run-fail → implement → run-pass.
- Match surrounding code style. Read the actual code before editing — the file:line references below are from a fresh audit but verify them.
- Reveal shortcuts must not fire while an input/textarea/contenteditable has focus.
- Undo coalescing must preserve the everything-undoable architecture: the single committed action's inverse restores the exact pre-gesture state.
- Gate per task: `cd packages/core && npx tsc --noEmit --ignoreDeprecations 6.0` → 0; `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0` → 0; task's tests green; `pnpm --filter @openreel/core test:run src/motion` no regressions.

**Execution note (controller):** File-overlap tracks — Track P (PropertiesPanel chain, sequential): T1 → T7 → T8 → T2 (T2 also touches motion-renderer, so it runs after T6 completes). Track S (StageCanvas chain, sequential): T3 → T4. Singles (parallel with tracks): T5 (export UI), T6 (blend modes). T9 gates.

---

### Task 1: Text tracking / leading / box-width fields

**Files:**
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (Text section, ~1018-1140)
- Test: `apps/web/src/motion/components/PropertiesPanel.text-metrics.test.tsx` (new)

The renderer + `set_motion_text_style` already honor `style.letterSpacing`, `style.lineHeight`, `style.maxWidth` (word wrap). Add three controls to the Text section using the existing `patchLayer({ style: { ...selectedLayer.style, <field> } })` pattern and the panel's existing `NumberInput`/`Field` primitives: **Tracking** (letterSpacing, px, step 0.5), **Leading** (lineHeight, unitless multiplier, step 0.05, min 0.5), **Box width** (maxWidth, px, min 0; 0/empty clears the field to disable wrap — write `undefined`, not 0).

- [ ] **Step 1: Failing RTL test** — select a text layer; set Tracking to 12 → assert store layer `style.letterSpacing === 12`; set Leading 1.4 → `style.lineHeight === 1.4`; set Box width 600 → `style.maxWidth === 600`; clear it → `maxWidth === undefined`. Mirror the query style of `PropertiesPanel.text-shader.test.tsx` (role-scoped, `waitFor` on the store).
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: Run → pass. Step 5: web tsc 0.** No commit.

---

### Task 2: Text stroke (engine + UI + MCP) — runs AFTER T6 (shares motion-renderer)

**Files:**
- Modify: `packages/core/src/motion/types.ts` (`MotionTextLayer.style`)
- Modify: `packages/core/src/motion/motion-renderer.ts` (`renderPlainText`/`drawTextLine` ~2130-2260 and the per-glyph `renderAnimatedText` path ~2292)
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (Text section)
- Modify: `packages/agent/src/registry.ts` (`set_motion_text_style` ~23012)
- Test: `packages/core/src/motion/motion-text-stroke.test.ts` (new) + extend `PropertiesPanel.text-metrics.test.tsx`

**Interfaces — Produces:** `MotionTextLayer.style.stroke?: { readonly color: string; readonly width: number; readonly over?: boolean }`.

Renderer: in every place glyph text is painted (plain line drawing AND the per-glyph animated path, including the glyph-offscreen used by shader animators), when `style.stroke` present with `width > 0`: set `ctx.lineWidth = width * 2` (Canvas strokes centered — ×2 matches AE's outer feel), `ctx.strokeStyle = color`, `ctx.lineJoin = "round"`, and call `strokeText` BEFORE `fillText` by default, AFTER when `over === true`. Guard non-finite width. UI: Stroke color (`ColorInput`) + width (`NumberInput`, min 0) fields; width 0 removes the `stroke` key. MCP: `set_motion_text_style` accepts `stroke { color, width, over? }` (validate color string + finite width ≥ 0; `width: 0` clears).

- [ ] **Step 1: Failing core test** — build a text layer with `stroke: { color: "#ff0000", width: 4 }`; spy a mock 2d context (the motion suite has canvas-mocking precedent — see existing renderer tests) and assert `strokeText` is called before `fillText`; with `over: true` assert the reverse; without stroke assert `strokeText` never called.
- [ ] **Step 2: Run → fail. Step 3: Implement (types → renderer → UI → MCP). Step 4: pass. Step 5: core+web+agent tsc 0; full motion suite.** No commit.

---

### Task 3: AE keyboard grammar — P/S/R/T/A reveal + U animated + tool remap

**Files:**
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (tool shortcut handling ~511-534)
- Modify: `apps/web/src/motion/components/MotionTimeline.tsx` (property-lane reveal)
- Modify: `apps/web/src/motion/stores/motion-store.ts` (reveal state)
- Modify: `apps/web/src/motion/components/MotionToolRail.tsx` (tooltip key hints)
- Test: `apps/web/src/motion/motion-reveal-shortcuts.test.tsx` (new)

Remap tools to AE-style keys: **V** select, **H** hand, **Z** zoom, **G** pen, **Q** shape, **Cmd/Ctrl+T** text (read the current tool-key map first and keep any non-conflicting keys). Free keys become reveal toggles operating on the selected layer(s): **P** position, **S** scale, **R** rotation, **T** opacity, **A** anchor, **U** all animated (keyframed) properties. Store: `revealedProperties: { layerId: string; properties: string[] } | null` (or a Set keyed per layer) in motion-store with a `togglePropertyReveal(propertyIds | "animated")` action — pressing the same key again clears that reveal. MotionTimeline: when a reveal is active for a layer, auto-expand its lane rows to exactly those properties (reuse the existing per-property lane machinery; for U derive the list via `getMotionLayerPropertyKeyframes`-bearing properties). Shortcuts must no-op when `document.activeElement` is an input/textarea/contenteditable (there is existing guard precedent in the shortcut handling — reuse it). Update MotionToolRail tooltips to the new keys.

- [ ] **Step 1: Failing test** — RTL: with a layer selected, dispatch keydown "p" → store reveal contains `transform.position.x/y`; press "p" again → cleared; keydown "u" on a layer with scale keyframes → reveal lists the keyframed properties; keydown "p" while an `<input>` has focus → no change; keydown "v" → active tool becomes select.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 4: Undo coalescing for canvas/timeline drags — runs AFTER T3 (shares StageCanvas)

**Files:**
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (`scheduleComposition` ~328-340 + gesture handlers)
- Modify: `apps/web/src/motion/stores/motion-store.ts` (preview/commit protocol)
- Modify: `apps/web/src/motion/components/MotionTimeline.tsx` (keyframe/trim drag commits, if they use the same per-tick commit)
- Test: `apps/web/src/motion/motion-drag-undo.test.ts` (new)

Design: add `updateMotionCompositionPreview(composition)` to the store — updates the in-memory composition WITHOUT dispatching an undoable action (no `actionExecutor.execute`), plus `commitMotionCompositionGesture(before, after)` which dispatches exactly ONE undoable `upsertMotionComposition` whose inverse restores `before`. StageCanvas gesture lifecycle: pointerdown captures `gestureStartComposition` (structural snapshot); every rAF tick routes through the preview update; pointerup calls the single commit (skip if unchanged). Read how `actionExecutor.execute`/`upsertMotionComposition` build inverses (project-store ~2982 + the everything-undoable architecture) so the inverse uses the captured `before`, not the last preview tick. Apply the same protocol to MotionTimeline keyframe/bar drags if they commit per-move. CRITICAL: preview updates must still re-render the stage (they update the store state) — only the undo/history entry is skipped.

- [ ] **Step 1: Failing test** — drive the store directly: snapshot → 5 preview updates → one gesture commit → assert the undo stack grew by exactly 1 and a single undo restores the snapshot state; assert preview updates alone add 0 undo entries while the composition state visibly changes.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0; full web motion suite.** No commit.

---

### Task 5: Web ProRes/alpha export guardrail

**Files:**
- Modify: `apps/web/src/motion/components/RenderQueuePanel.tsx` (+ the main editor export dialog if it offers ProRes/alpha — grep `ProRes|prores|transparent|alpha` under apps/web/src/components/editor to find it)
- Modify (read first): `packages/core/src/export/export-engine.ts` (~153-158) / `webcodecs-backend.ts` (`normalizesProResToH264`) — expose a capability flag if one isn't already exported
- Test: `apps/web/src/motion/components/RenderQueuePanel.guardrail.test.tsx` (new)

Behavior: in the web build (no native ffmpeg backend), when the user selects a ProRes format or transparent/alpha output, render a blocking inline warning: "Web export can't produce ProRes or alpha — this will encode H.264 without transparency. Use the desktop app for ProRes/alpha." with an explicit "Export as H.264 anyway" confirm; the queue/export button stays disabled until acknowledged. Detection: derive `isNativeExportAvailable` from the existing backend-selection logic (the desktop path checks for the native backend — grep `NativeFFmpegBackend|window.__openreel` in apps/web) rather than user-agent sniffing. After export, if the backend normalized the format, the job's result row states what was actually encoded ("Encoded H.264 (ProRes unavailable on web)").

- [ ] **Step 1: Failing RTL test** — mock native backend absent; choose a ProRes/alpha option → assert the warning renders and the export action is blocked; acknowledge → unblocked; mock native available → no warning.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 6: Blend modes — Add family

**Files:**
- Modify: `packages/core/src/video/types.ts` (`BLEND_MODES` ~18-35)
- Modify: `packages/core/src/motion/motion-renderer.ts` (layer composite — where `globalCompositeOperation` is set from the layer blend mode)
- Modify (check): the export/GPU composite path if it maps blend modes separately (grep `globalCompositeOperation|blendMode` in packages/core/src/motion and src/video)
- Test: `packages/core/src/motion/motion-blend-modes.test.ts` (new)

Required scope: **add** and **linear-dodge** as new `BLEND_MODES` entries, both mapping to Canvas2D `"lighter"` (they are the same operation; keep both names for AE familiarity). Verify the motion renderer passes unknown-to-canvas modes through a mapping table (read how `blendMode` currently reaches `globalCompositeOperation`) and extend that table. UI: whatever picker lists `BLEND_MODES` (motion layer blend-mode dropdown + `set_motion_layer_blend_mode` MCP validation) must automatically include the new entries — confirm the MCP tool validates against `BLEND_MODES` and not a duplicated list.
Stretch (feasibility-gated): **subtract, divide, linear-burn, linear-light, vivid-light, pin-light, hard-mix** via a per-pixel blend in the existing buffered-layer composite path. Before implementing, measure: a 1920×1080 `getImageData`+blend+`putImageData` per frame per blended layer. If it costs >8ms on a single layer, DO NOT implement — ship the required scope and state the measurement in your report. If implemented, gate it behind the buffered path only when one of these modes is active.

- [ ] **Step 1: Failing test** — `BLEND_MODES` contains `add` and `linear-dodge`; renderer maps a layer with `blendMode: "add"` to `globalCompositeOperation === "lighter"` (spy on a mock ctx like existing renderer tests).
- [ ] **Step 2: Run → fail. Step 3: Implement required scope; evaluate stretch with the measurement. Step 4: pass. Step 5: core tsc 0; full motion suite.** No commit.

---

### Task 7: Star/polygon parameters — runs AFTER T1 (shares PropertiesPanel)

**Files:**
- Modify: `packages/core/src/motion/motion-shape-modifiers.ts` (~599-600 hardcoded `points`/`innerRadius` defaults)
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (Shape section)
- Test: extend `packages/core/src/motion/` shape tests (find the existing shape-path/modifier test file) + `apps/web` RTL if the panel test file exists

Engine: where star/polygon geometry is built, read `layer.style.points` (int, clamp 3..24, default 5) and `layer.style.innerRadius` (0.05..0.95, default 0.45) instead of constants — verify the `MotionShapeLayer.style` type already carries these fields (the audit says the type + `set_motion_shape_style` schema exist; if the type lacks them, add optional fields). UI: when `shapeType` is `star` show **Points** + **Inner radius**; when `polygon` show **Points**; both via `patchLayer` on style.

- [ ] **Step 1: Failing core test** — build a star layer with `points: 7, innerRadius: 0.3`; assert the generated polyline/path has 14 outer+inner vertices (7-point star) and the inner-vertex radius ≈ 0.3 × outer (inspect `buildMotionShapePolyline` output for the star case).
- [ ] **Step 2: Run → fail. Step 3: Implement engine + UI. Step 4: pass. Step 5: core+web tsc 0; full motion suite.** No commit.

---

### Task 8: Gradient editing — N stops + stroke gradient UI — runs AFTER T7 (shares PropertiesPanel)

**Files:**
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (gradient controls ~2380-2391 — currently `updateStop` caps at index 0/1; and the stroke controls)
- Test: `apps/web/src/motion/components/PropertiesPanel.gradient.test.tsx` (new)

Replace the two-stop editor with a stop list: each row = color (`ColorInput`) + offset (`NumberInput` 0..1 step 0.01) + remove button (min 2 stops — hide remove at 2); an "Add stop" button inserts a stop midway between the last two offsets with an interpolated color (reuse `resolveMotionGradientStops`/`normalizeMotionGradientStops` from core for ordering/normalization — write stops sorted by offset). Apply the same editor to the stroke gradient: expose a stroke fill-mode toggle (solid | gradient) in the shape stroke controls writing `style.stroke.gradient` (the renderer already consumes it via `createShapeStrokeStyle`).

- [ ] **Step 1: Failing RTL test** — a gradient-filled shape shows its stops; click Add stop → store gradient has 3 stops, sorted by offset; edit the middle stop's offset/color → persisted; remove → back to 2; enable stroke gradient → `style.stroke.gradient` present.
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: web tsc 0.** No commit.

---

### Task 9: Integration verification

- [ ] **Step 1:** core+web+agent tsc (`--ignoreDeprecations 6.0`) → 0.
- [ ] **Step 2:** `pnpm --filter @openreel/core test:run src/motion` (all pass) + `cd apps/web && npx vitest run src/motion` (green except the 2 known pre-existing `PropertiesPanel.scene3d.test.tsx` failures) + agent tests for `set_motion_text_style`/blend-mode validation.
- [ ] **Step 3:** Live spot-check (dev server, Playwright): P reveals the position lane on a selected layer and U reveals animated; text tracking field changes render; a star with Points=7 renders 7 points; one canvas drag → single undo. If the app can't launch, unit coverage stands and the live check is a manual follow-up.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** items 1-8 → Tasks 1-8; verify → Task 9. ✓
- **Placeholders:** each task carries concrete field names, ranges, behaviors, and test assertions; implementers read code first for exact line anchors. ✓
- **Type consistency:** `style.stroke {color,width,over?}` (T2), `revealedProperties`/`toggglePropertyReveal`→ spelled `togglePropertyReveal` (T3), `updateMotionCompositionPreview`/`commitMotionCompositionGesture` (T4), `isNativeExportAvailable` (T5), `BLEND_MODES` entries `add`/`linear-dodge` (T6), `style.points`/`style.innerRadius` (T7), sorted-stop invariant (T8). ✓
- **Ordering:** PropertiesPanel chain T1→T7→T8→T2 (T2 also after T6 for renderer); StageCanvas chain T3→T4; singles T5, T6; gate T9. ✓
