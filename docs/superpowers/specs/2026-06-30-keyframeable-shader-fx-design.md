# Keyframeable Shader Fills & Effects (v1)

**Date:** 2026-06-30
**Status:** Design approved (brainstorming) — ready for implementation plan
**Sub-project:** 2 of 4 in the Figma-Config-2026 gap roadmap (see memory `figma-gap-3d-exposure`)

## Goal

Match Figma Motion's headline: a curated **library of parameterized procedural
shaders** — both **fills** (procedural materials used as a layer's fill: liquid
metal, watercolor) and **effects** (transform a layer's output: dither, gradient
map, pixelate) — whose every parameter is **keyframeable on the motion
timeline**. No code editor (Figma has none; that and AI-generation are later
sub-projects).

Unlike sub-project 1 (which exposed an existing engine), this **builds** the
missing engine: the motion app's 2D render is Canvas2D with **no GPU
fragment-shader pass for 2D layers** today.

## Scope (v1)

- **Substrate:** a WebGL2 fullscreen-quad fragment-shader pass, reusing the
  proven scene3d "render GL → bitmap → composite into the 2D canvas" pattern
  (works in both live preview and export).
- **Library:** effects — Dither, Gradient Map, Pixelate, Halftone; fills —
  Liquid Metal, Watercolor, Gradient Noise. (Concrete count: 4 effects + 3 fills.)
- **Parameterized + keyframeable:** each shader exposes named numeric/color
  params in the inspector; numeric params keyframe via `effect.<id>.<param>`.
- **Inspector:** EffectsPanel "Add Effect" gallery gains a Shaders category;
  fill controls gain a Shader fill type.
- **Preview parity:** shader layers reuse scene3d's renderer-backed preview.
- **OUT:** GLSL code editor; AI-generated shaders; input/cursor-reactive
  shaders; per-glyph text shaders (that is the separate shader-text sub-project).

## Architecture

### 1. Shader library — `packages/core/src/motion/shaders/`
A registry of definitions, the single source of truth for both rendering and UI:
```ts
type MotionShaderParamType = "number" | "color";
interface MotionShaderParamDef {
  readonly name: string;          // uniform key, e.g. "scale"
  readonly label: string;         // inspector label
  readonly type: MotionShaderParamType;
  readonly default: number | string;
  readonly min?: number; readonly max?: number; readonly step?: number;
}
interface MotionShaderDef {
  readonly id: string;            // stable, e.g. "liquid-metal"
  readonly name: string;
  readonly category: "fill" | "effect";
  readonly glsl: string;          // fragment shader body/source
  readonly params: readonly MotionShaderParamDef[];
}
```
`MOTION_SHADER_LIBRARY: readonly MotionShaderDef[]` + `getMotionShaderDef(id)`.
Effects sample `u_input` (the layer texture); fills generate from `vUv`/params.
Every shader receives uniforms `u_time`, `u_resolution`, plus its params.

### 2. `MotionShaderRenderer` — `packages/core/src/motion/motion-shader-renderer.ts`
A lightweight WebGL2 renderer (one shared offscreen GL context + a unit quad).
`render(def, params, { width, height, time, inputCanvas? }) → OffscreenCanvas`.
Compiles+caches a program per shader id (compile is one-time; render is sync,
mirroring `motion-three-renderer.ts` lifecycle). Degrades safely if WebGL2 is
unavailable (returns the input unchanged for effects / a flat fallback for
fills) — never a blank layer.

### 3. Effect integration
- Types (`packages/core/src/motion/types.ts`): add `"shader"` to
  `MotionEffectType` (l.28-43); add
  `MotionShaderEffect extends MotionEffectBase { type: "shader"; shaderId: string; params: Record<string, number>; }`
  to the `MotionEffect` union (l.370-385).
- Render: in `renderVisualLayerWithAdvancedMasks`
  (`motion-renderer.ts:726-793`), where pixel effects already do
  getImageData → mutate → putImageData (l.765-773), add a shader-effect pass:
  for each enabled shader effect in stack order, run `MotionShaderRenderer` with
  the layer temp canvas as `inputCanvas`, then draw the result back. Classify
  shader effects alongside pixel effects so the temp-canvas path triggers.

### 4. Fill integration
- Types: extend `FillStyle` (`packages/core/src/graphics/types.ts:191-211`) with
  a `"shader"` variant `{ type: "shader"; shaderId: string; params: Record<string, number> }`;
  add a parallel `fillShader?` override to `MotionTextLayer.style`
  (`types.ts:659-660`, since text uses `fillGradient`, not a `FillStyle`
  discriminator).
- Paint: in the shape fill path (`renderShape` ~`motion-renderer.ts:1423-1463`,
  `createShapeFillStyle`) and text fill path (`resolveTextFillStyle`), when the
  fill is a shader, render it with `MotionShaderRenderer` (no input texture) and
  set `ctx.fillStyle = ctx.createPattern(shaderCanvas, "no-repeat")` before
  filling the path. Factory + guards in `motion-shape-style.ts` (l.116-150).

### 5. Keyframeable params (data-driven branch + bug fix)
The current effect-param system is hard-coded (a 23-name `MotionEffectNumericParameter`
enum + per-effect get/set switches in `motion-effects.ts`), and
`isMotionEffectNumericParameter` (l.869-884) whitelists only 10 of 23 — so 13
existing params silently can't keyframe.
- Add a **data-driven `"shader"` branch**: `getMotionEffectParameterValue` /
  `setMotionEffectParameterValue` (`motion-effects.ts:540-69x`) read/write from
  the shader effect's `params` bag generically (any param name) instead of the
  enum switch; `getMotionLayerEffectPropertyDescriptors`
  (`motion-keyframes.ts:668-682`) reflects the shader def's numeric param defs
  into the graph-picker/timeline; the path validator accepts shader param names.
- **Fix** `isMotionEffectNumericParameter` to stop dropping the 13 already-declared
  params (verified bug) — adjacent correctness win, covered by a regression test.

### 6. Inspector UI
- Effects: `EffectsPanel.tsx` "Add Effect" gallery gains a **Shaders** group
  listing `MOTION_SHADER_LIBRARY` effect entries; adding one creates a
  `MotionShaderEffect` with default params; the effect's controls render each
  param def as a `Slider`/`NumberInput`/`ColorInput`, written via the existing
  effect-update + auto-keyframe path.
- Fills: the shape/text fill controls gain a **Shader** fill type → shader
  picker + the same param controls.

### 7. Live-preview parity
Shader fills/effects produce no CSS/Canvas2D output for the DOM preview. Reuse
scene3d's `usesRendererPreview` mechanism (`StageCanvas.tsx:392`): a layer with
any shader fill/effect forces the renderer-backed bitmap preview + 2D hit-test
(already how scene3d previews). `MotionShaderRenderer` runs inside `MotionRenderer`,
so preview and export share one path.

## Key decisions
- **WebGL2, not WebGPU** — universal availability (no fallback branch), and the
  scene3d WebGL→bitmap pattern already works in preview + export.
- **One shared GL context** for all shader passes (compile-once cache), created
  lazily, disposed with the renderer.
- **Params as a generic `Record<string,number>` bag** (+ a color sub-set) so the
  keyframe/descriptor system is data-driven for shaders without enumerating
  every param.

## Risks
- **Async compile vs sync render:** compile each program on first use and cache;
  the per-frame render must be synchronous. First-frame-after-add may need a
  one-time compile; guard so it never throws mid-render.
- **GL context lifecycle / loss:** handle `webglcontextlost`; recreate the
  context + clear the program cache; never crash the 2D render tree.
- **Preview parity:** must force `usesRendererPreview` whenever a shader fill or
  effect is present, or the editor shows the un-shaded layer (silent divergence
  from export).
- **Param-system refactor blast radius:** the data-driven `"shader"` branch must
  not regress the existing hard-coded effects; the 10/23 fix changes which
  existing params keyframe — both need regression tests.
- **Fill `createPattern` cost:** a shader fill re-renders the pattern per frame;
  cache by (shaderId, params, size) within a frame where possible.

## Testing
- Shader library: every `MotionShaderDef` has valid params (defaults within
  min/max), unique ids, glsl non-empty (unit).
- `MotionShaderRenderer`: compiles a library shader and renders a non-blank
  canvas at a given size; falls back safely with no WebGL2 (unit, mock GL).
- Effect: adding a `MotionShaderEffect`, resolving its params at a keyframed
  time, returns the interpolated value via `effect.<id>.<param>` (unit); the
  10/23 bug fix has a regression test asserting the 13 params now keyframe.
- Fill: a shader `FillStyle` round-trips through the factory + paint guard.
- Inspector: EffectsPanel Shaders group adds a shader effect; param edits write
  to the effect; a numeric param shows in the graph-picker (RTL).
- Visual: add a Dither effect + a Liquid-Metal fill to layers; verify they
  render in the live preview (renderer-backed) and animate when a param is
  keyframed; light + dark themes; tsc + eslint clean.
