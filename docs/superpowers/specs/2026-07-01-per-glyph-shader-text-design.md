# Per-Glyph Shader Text Animation — Design

**Date:** 2026-07-01
**Status:** Design (pending user review)
**Branch:** feat/new-design-update
**Figma-gap sub-project:** 3 of 4 (shader-based text)

## Problem

The prior work made text layers shader-capable at the *layer* level: a procedural `fillShader`, GPU shader *effects* that sample rendered glyph pixels, and keyframeable params. What's still missing — and what Figma's shader-text demos showcase — is **per-glyph shader animation**: each character animated independently by a shader with a staggered progress, e.g. text that dissolves in letter-by-letter or a glow that waves across the glyphs. Today the text-animator system does per-glyph *transforms* (reveal/cascade) but nothing shader-driven.

## Goals

Let a text layer carry a **shader animator** whose shader runs per glyph, driven by the glyph's existing staggered animator progress, composing with the mature timing/stagger/selector/transform machinery already in `getMotionTextAnimatorRuns`. Ship a small library of progress-driven text shaders, wire them into the inspector, and expose them over the MCP.

## Non-Goals

- No new easing/selector/stagger machinery — reuse the animator system as-is.
- v1 renders **one shader pass per glyph** (R1). The single-pass progress-map optimization (R2) is a documented follow-up, not built now.
- No AI-generated text shaders (sub-project 4).
- No change to layer-level `fillShader` / shader effects (already shipped).

## Architecture

A text animator gains an optional shader. In the renderer's existing per-glyph loop (`renderAnimatedText`), when an enabled shader animator is present, each glyph is rendered to a small offscreen, passed through `MotionShaderRenderer` with a per-glyph `u_progress` (that glyph's animator progress) plus `u_time` and the shader's params, and the shader output is composited at the glyph's transform instead of a plain `fillText`. The shader **samples the glyph pixels** (`u_input`) and modulates them by `u_progress`. Everything else (stagger, direction, selector, per-glyph transform) is unchanged and composes with the shader.

### Data model

Extend `MotionTextAnimator` (packages/core/src/motion/types.ts:586) with an optional field:
```ts
readonly shader?: { readonly shaderId: string; readonly params: Record<string, number> };
```
An animator with a `shader` is a "shader animator." It may still carry transform `properties` (so a reveal-up transform + glyph-dissolve shader combine). `sanitizeMotionTextAnimator` validates/clamps the shader (drops it if `shaderId` isn't a registered text shader).

Expose per-glyph progress from the shader animator. Add to `motion-text-animators.ts`:
- `getMotionTextShaderAnimator(layer: MotionTextLayer): MotionTextAnimator | undefined` — the first enabled animator with a `shader` (v1 supports one active shader animator; extra ones are ignored, logged as a follow-up).
- `getMotionTextAnimatorGlyphProgress(animator, unitIndex, unitCount, localTime): number` — a thin exported wrapper over the existing internal `getAnimatorProgress` (line 346), returning the 0..1 staggered progress for a glyph. (No change to `MotionTextGlyphRun`; the renderer already has `run.unitIndex` and the total unit count.)

### Rendering (R1 — per-glyph pass)

In `renderAnimatedText` (motion-renderer.ts:2292), before the per-glyph loop resolve `const shaderAnimator = getMotionTextShaderAnimator(layer)` and, if present, `const def = getMotionShaderDef(shaderAnimator.shader.shaderId)` (must be `category:"text"`). Inside the loop, per glyph:
1. If no shader animator / no def / no WebGL2 → current behavior (`fillText`) — never regress.
2. Else render the single glyph to a glyph-sized offscreen (reuse the existing per-glyph transform origin; size = glyph metrics + padding), then `this.shaderRenderer.render(def, { width, height, time: localTime, progress: getMotionTextAnimatorGlyphProgress(shaderAnimator, run.unitIndex, unitCount, localTime), params: shaderAnimator.shader.params, inputCanvas: glyphOffscreen })`.
3. Draw the returned offscreen at the glyph position (respecting `run.opacity`); on `null` result fall back to `fillText`.

`MotionShaderRenderer` gains one uniform: `MotionShaderRenderInput.progress?: number` → a `u_progress` float uniform (defaults 0). Reuses the same lazy shared context and dispose path.

**Perf guards:** the per-glyph pass runs only when a shader animator is enabled. Cap at a configurable `MAX_SHADER_GLYPHS` (e.g. 120); beyond it, glyphs render plain with a single `log`-style note (no silent truncation). The frame cache does not apply (per-glyph progress varies), so this is intentionally O(glyphs) GL passes per frame — acceptable for typical titles; R2 is the optimization path.

### Shader library

Add `"text"` to `MotionShaderCategory` (shaders/types.ts). New `TEXT_SHADERS` in `shaders/text-shaders.ts`, each a `#version 300 es` fragment shader sampling `u_input` (glyph pixels) and reading `uniform float u_progress; uniform float u_time;` plus numeric params:
- **glyph-dissolve** — noise-thresholded reveal: alpha appears as `u_progress` crosses a per-fragment noise value; `edgeWidth`, `scale`.
- **glyph-glow-wave** — emissive bloom that peaks mid-progress and settles; `glow`, `hue` (numeric), `softness`.
- **chromatic-cascade** — per-glyph RGB split that starts wide and converges as `u_progress`→1; `amount`.
- **scanline-materialize** — horizontal scanline wipe + flicker gated by `u_progress`; `lines`, `jitter`.

`getMotionShaderTextDefs()` added to `shaders/index.ts`; `MOTION_SHADER_LIBRARY = [...EFFECT_SHADERS, ...FILL_SHADERS, ...TEXT_SHADERS]`. Text defs are disjoint from fill/effect ids.

### UI

In `PropertiesPanel` text section, alongside the existing text-animator presets, add a **Shader animator** control: a picker over `getMotionShaderTextDefs()` that sets/clears the active animator's `shader` (creating a lightweight animator if none exists, mirroring how presets are added via `addMotionTextAnimator`), plus a param control per `def.params` (reusing `ShaderFillControls`-style rendering). Timing/stagger reuse the animator's existing timing controls.

### MCP

Add `add_motion_text_shader_animator` (domain `motion`, mirrors `add_motion_text_animator` at registry.ts + the shader-tool scaffold): input `compositionId, layerId, shaderId (text category), params?, stagger?, duration?`. Validates the layer is text and `shaderId ∈ getMotionShaderTextDefs()`; builds an animator with the shader + clamped params; commits. `list_motion_shaders` gains the `text` category in its output. Existing `remove_/toggle_motion_text_animator` already operate by id.

### Preview parity

Extend the renderer-backed-preview predicate: a text layer with an enabled shader animator forces the renderer-backed bitmap preview. Add `layerHasMotionShaderTextAnimator(layer)` and OR it into `layerHasMotionShader` / `stage-preview-mode.ts` (same pattern as fills/effects).

## Testing

- Core: `sanitizeMotionTextAnimator` keeps/drops the shader by id validity; `getMotionTextShaderAnimator` picks the first enabled shader animator; `getMotionTextAnimatorGlyphProgress` returns staggered 0→1 across glyphs; `text-shaders` library test (4 defs, `category:"text"`, disjoint ids, valid GLSL structure).
- Renderer: a unit test that with a shader animator the per-glyph path selects the def and computes distinct `u_progress` per glyph at a mid-time (progress[0] > progress[last] for a forward stagger); `MotionShaderRenderer` accepts and binds `progress`.
- Web: PropertiesPanel RTL — pick a text shader, assert the layer's active animator gains `shader.shaderId`; MCP registry test for `add_motion_text_shader_animator` (happy path, non-text layer, invalid id, clamp).
- Gate: core/web/agent tsc 0 (`--ignoreDeprecations 6.0`); `pnpm --filter @openreel/core test:run src/motion`; agent tests; web `vitest run src/motion` green except the 2 known pre-existing scene3d failures.
- Live GPU visual: a title with glyph-dissolve reveals letter-by-letter; verified via Playwright + screenshot; 0 console errors. Deferred-if-app-down like prior sub-projects.

## Risks

- **Per-glyph GL passes (R1).** O(glyphs)/frame. Mitigated by only-when-active, `MAX_SHADER_GLYPHS`, shared context. If titles are long, perf degrades — R2 (single-pass progress-map) is the documented next step; log when the cap truncates.
- **Glyph offscreen sizing.** Must include ascent/descent + padding so shaders that expand (glow, chromatic) aren't clipped; derive from font metrics with padding, guard zero/NaN sizes.
- **Multiple shader animators.** v1 honors one; extras ignored — note in the tool description and `getMotionTextShaderAnimator` doc-free contract.

## Rollout

Uncommitted on `feat/new-design-update` with the rest of the Figma-gap work (commit when the user asks). Sub-project 4 (AI-generated shaders) remains.
