# AE Ergonomics Sprint — Design

**Date:** 2026-07-01
**Status:** Approved direction (from the AE-parity review's Quick Wins)
**Source:** docs/reviews/2026-07-01-ae-parity-review.md (§3 Quick Wins)
**Branch:** feat/new-design-update

## Problem

The AE-parity review found the Motion Creator serves social-content creators but breaks After Effects muscle memory on cheap-to-fix items: engine capabilities with no UI (text tracking/leading/box, star/polygon params, N-stop gradients), a missing text stroke, the absent P/S/R/T/A/U keyboard grammar, one-drag-sixty-undos, a silent ProRes/alpha data-corruption trap on web export, and a blend-mode set missing the Add family. Each is high pain-per-effort; together they are one sprint.

## Goals

Ship the 8 quick wins as one sprint. Every item is UI wiring or a small, bounded engine addition — no structural work (pen/path system, expressions, graph editor, RAM preview are explicitly the "big rocks," out of scope here).

## The 8 items

1. **Text tracking/leading/box-width fields.** `letterSpacing`, `lineHeight`, `maxWidth` are fully supported by the renderer and `set_motion_text_style` but have no PropertiesPanel fields (Text section ~1018-1140). Add Tracking, Leading, and Box width (enables wrap) controls.
2. **Text stroke.** Renderer only calls `fillText`. Add `stroke?: { color: string; width: number; over?: boolean }` to `MotionTextLayer.style`; renderer draws `strokeText` under the fill by default (`over: true` draws it above); works in both plain and per-glyph animated paths. UI: stroke color + width fields; extend `set_motion_text_style`.
3. **P/S/R/T/A + U reveal shortcuts (adopt AE grammar).** Today P/S/R/T/A select tools (StageCanvas ~511-534). Decision: **AE grammar wins in the Motion editor** — tools move to AE-style keys (V select, H hand, Z zoom, G pen, Q shape, Cmd/Ctrl+T text), freeing P (Position), S (Scale), R (Rotation), T (opaciTy), A (Anchor) to reveal that property's lane for selected layer(s) in the timeline, and U to reveal all animated properties. Pressing again toggles off. Reveal must not fire while typing in inputs.
4. **Undo coalescing for drags.** `scheduleComposition` commits an undoable action per rAF tick during canvas drags (StageCanvas ~328-340 → project-store ~2982), so one drag ≈ 60 undo entries. During an active gesture, updates apply as non-undoable preview state; a single undoable action commits on pointerup with the gesture's start state as its inverse. Applies to move/scale/rotate/trim drags in StageCanvas and the timeline.
5. **ProRes/alpha web guardrail.** The WebCodecs backend silently rewrites ProRes→H.264 and strips alpha (`normalizesProResToH264=true`, webcodecs-backend.ts; export-engine.ts ~153-158). In the web build's export/render-queue UI: selecting ProRes or transparent output shows a blocking warning ("web export will produce H.264 without alpha — use the desktop app for ProRes/alpha") and requires explicit acknowledgement; the export result surfaces what was actually encoded. No silent rewrite reaches the user unacknowledged. Desktop (native ffmpeg path) unaffected.
6. **Blend modes: the Add family.** `BLEND_MODES` (packages/core/src/video/types.ts ~18-35) has 16 of AE's ~38. Add: **add / linear-dodge** (Canvas2D `lighter` — native, cheap) as required scope; **subtract, divide, linear-burn, linear-light, vivid-light, pin-light, hard-mix** as a feasibility-gated stretch via the existing buffered pixel path (implement only if per-frame cost is acceptable at 1080p; otherwise ship Add and report). Stencil/Silhouette families are deferred to a big rock (compositing-pipeline change). New modes must work in preview and export paths.
7. **Star/polygon parameters.** Renderer reads hardcoded defaults (5 points, innerRadius 0.45 — motion-shape-modifiers.ts ~599-600) though `style.points`/`style.innerRadius` types and the `set_motion_shape_style` schema exist. Wire the style values through the renderer and add Points + Inner radius fields to the shape section of PropertiesPanel (visible only for star/polygon).
8. **Gradient stops beyond 2 + stroke gradient UI.** Data layer (`normalizeMotionGradientStops`) supports N stops but the UI caps editing at index 0/1 (PropertiesPanel ~2380-2391) and stroke gradients have zero UI. Add stop add/remove, per-stop color + offset editing, and expose the stroke-gradient controls.

## Non-Goals

Pen/bezier path system, expression engine, graph-editor tangent handles, RAM preview, shape groups/booleans, stencil/silhouette blend modes, on-canvas gradient handles (list editing is enough for this sprint), changing desktop export.

## Testing

Per item: Vitest unit/RTL coverage (fields write the style; stroke renders in both text paths; reveal toggles lanes; one drag → one undo entry; guardrail blocks unacknowledged ProRes; new blend modes composite; star params flow; N-stop editing). Gate: core/web/agent tsc 0; core motion suite; web motion suite green except the 2 known pre-existing scene3d failures.

## Risks

- Tool-shortcut remap (item 3) changes existing users' keys — acceptable: AE grammar is the sprint's purpose; keep the tool rail's tooltips showing the new keys.
- Undo coalescing (item 4) must not break the everything-undoable architecture — the final action must produce a correct inverse (capture gesture-start state).
- Blend-mode stretch scope is feasibility-gated to avoid a perf regression.
