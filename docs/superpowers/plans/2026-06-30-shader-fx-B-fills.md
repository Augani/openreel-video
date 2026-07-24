# Shader FX — Plan B: Shader Fills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add procedural **shader fills** (liquid-metal, watercolor, gradient-noise) as a fill type for shape and text layers, painted via the WebGL2 substrate built in Plan A.

**Architecture:** Add `category:"fill"` shaders to the existing library; extend `FillStyle` with a `"shader"` variant (and a text `fillShader` override); in the renderer's fill paint path, render the shader to an offscreen via the existing `MotionShaderRenderer` and supply it as a `CanvasPattern`; add a Shader fill-type to the inspector fill controls; route shader-fill layers to the renderer-backed preview.

**Tech Stack:** TypeScript strict, WebGL2 (Plan A's `MotionShaderRenderer`), Vitest + RTL.

## Global Constraints

- No line comments; TS strict, no `any`.
- Reuse Plan A's `MotionShaderRenderer` (already a lazy field on `MotionRenderer`) — do NOT create a second GL context.
- v1 fill library is exactly Liquid Metal, Watercolor, Gradient Noise (category `"fill"`).
- Fill shaders are procedural (output color from `vUv` + params; NO `u_input` texture).
- **Out of v1:** per-fill-param keyframing (fills have no effect id; the keyframe path is effect-scoped — fills are inspector-parameterized for now; note as follow-up). Code editor; AI shaders.
- Gates per task: core+web `tsc --ignoreDeprecations 6.0` → 0; the task's vitest test green; `pnpm --filter @openreel/core test:run src/motion` no regressions. Do NOT git commit.

---

### Task 1: Fill shaders in the library

**Files:**
- Create: `packages/core/src/motion/shaders/fill-shaders.ts`
- Modify: `packages/core/src/motion/shaders/index.ts` (include fills in `MOTION_SHADER_LIBRARY`; add `getMotionShaderFillDefs()`)
- Test: extend `packages/core/src/motion/shaders/shader-library.test.ts`

**Interfaces — Produces:** `FILL_SHADERS: readonly MotionShaderDef[]` (category `"fill"`), and `getMotionShaderFillDefs(): readonly MotionShaderDef[]`. Reuses `MotionShaderDef` from Task-1 of Plan A. Fill GLSL is a `#version 300 es` fragment shader with `in vec2 vUv; uniform vec2 u_resolution; uniform float u_time; uniform float u_<param>;` and `out vec4 fragColor;` — it generates a color from `vUv`/params and does NOT sample `u_input`.

v1 fill ids/params (numeric; colors deferred — `MotionShaderParamType "color"` exists but v1 fills use numeric controls):
- `liquid-metal` — `scale` (1..20, default 6, step .5), `speed` (0..2, default 0, step .05), `contrast` (.5..3, default 1.4, step .1). Flowing metallic value field (fbm/sine bands → grayscale metal ramp).
- `watercolor` — `scale` (1..16, default 5, step .5), `bleed` (0..1, default .5, step .05). Soft mottled value via layered value-noise, paper-like.
- `gradient-noise` — `scale` (1..24, default 8, step .5), `warp` (0..1, default .4, step .05). Domain-warped gradient-noise field.

- [ ] **Step 1: Write the failing test** — extend the library test:
```ts
import { MOTION_SHADER_LIBRARY, getMotionShaderFillDefs, getMotionShaderEffectDefs } from "./index";
it("has the three v1 fill shaders, disjoint from effects", () => {
  const fillIds = getMotionShaderFillDefs().map((d) => d.id);
  expect(fillIds).toEqual(expect.arrayContaining(["liquid-metal", "watercolor", "gradient-noise"]));
  for (const d of getMotionShaderFillDefs()) expect(d.category).toBe("fill");
  const effectIds = new Set(getMotionShaderEffectDefs().map((d) => d.id));
  expect(fillIds.some((id) => effectIds.has(id))).toBe(false);
  expect(new Set(MOTION_SHADER_LIBRARY.map((d) => d.id)).size).toBe(MOTION_SHADER_LIBRARY.length);
});
```
- [ ] **Step 2: Run → fail** (`pnpm --filter @openreel/core test:run src/motion/shaders/shader-library.test.ts`).
- [ ] **Step 3: Implement** `fill-shaders.ts` (the 3 defs; write correct minimal GLSL — value-noise/fbm helpers are short; keep each syntactically valid `#version 300 es`). In `index.ts`: `MOTION_SHADER_LIBRARY = [...EFFECT_SHADERS, ...FILL_SHADERS]`; add `getMotionShaderFillDefs = () => MOTION_SHADER_LIBRARY.filter((d) => d.category === "fill")`. Export `getMotionShaderFillDefs` through the barrel.
- [ ] **Step 4: Run → pass. Step 5: core tsc 0.** No commit.

---

### Task 2: `FillStyle` shader variant + factories/guards + text `fillShader`

**Files:**
- Modify: `packages/core/src/graphics/types.ts` (FillStyle l.191-196)
- Modify: `packages/core/src/motion/types.ts` (MotionTextLayer.style ~l.659)
- Modify: `packages/core/src/motion/motion-shape-style.ts` (factories/guards ~l.112-150)
- Test: `packages/core/src/motion/motion-shader-fill.test.ts`

**Interfaces — Produces:**
```ts
interface MotionShaderFill { readonly shaderId: string; readonly params: Record<string, number>; }
```
`FillStyle.type` gains `"shader"`; `FillStyle` gains `readonly shader?: MotionShaderFill`. `MotionTextLayer.style` gains `readonly fillShader?: MotionShaderFill`. New `createDefaultMotionShaderFill(shaderId: string): FillStyle` (type `"shader"`, opacity 1, `shader: { shaderId, params: defaultMotionShaderParams(getMotionShaderDef(shaderId)) }`) and `isShaderFill(fill: FillStyle): boolean`.

- [ ] **Step 1: Failing test**
```ts
import { createDefaultMotionShaderFill, isShaderFill } from "./motion-shape-style";
it("builds a shader fill with default params", () => {
  const fill = createDefaultMotionShaderFill("liquid-metal");
  expect(fill.type).toBe("shader");
  expect(isShaderFill(fill)).toBe(true);
  expect(fill.shader?.shaderId).toBe("liquid-metal");
  expect(fill.shader?.params.scale).toBe(6);
});
```
- [ ] **Step 2-5:** fail → implement (add the `MotionShaderFill` interface to graphics/types.ts or motion/types.ts — pick where `FillStyle` can reference it without a cycle; `FillStyle` is in graphics so define `MotionShaderFill` in graphics/types.ts) → pass → core tsc 0. No commit.

---

### Task 3: Paint path — render shader fill as a CanvasPattern

**Files:**
- Modify: `packages/core/src/motion/motion-renderer.ts` (`createShapeFillStyle` l.1681-1695 → widen return to `string | CanvasGradient | CanvasPattern | null`; `resolveTextFillStyle` ~l.2078)
- Modify: `packages/core/src/motion/motion-effects.ts` or `motion-shape-style.ts` (add `layerHasMotionShaderFill(layer)`)
- Test: extend `motion-shader-fill.test.ts` (classification — fallback render is browser-only, Task 6 visual)

**Implementation:** in `createShapeFillStyle`, when `fill.type === "shader"` and `fill.shader`, get `getMotionShaderDef(fill.shader.shaderId)`, call the renderer's shared `this.shaderRenderer.render(def, { width: layer.width, height: layer.height, time: localTime, params: fill.shader.params })` (no `inputCanvas`), and return `ctx.createPattern(result, "no-repeat")` when non-null; if `null` (no WebGL2 / unknown shader), fall back to `fill.color ?? "#888888"` so the shape is never invisible. Same for `resolveTextFillStyle` using `layer.style.fillShader`. Ensure the shader renderer instance is the SAME lazy field added in Plan A (do not add a second). Add `layerHasMotionShaderFill(layer)` (shape with shader fill OR text with `fillShader`).

- [ ] **Step 1: Failing test** — `layerHasMotionShaderFill(shapeWithShaderFill) === true`, `false` for a solid-fill layer.
- [ ] **Step 2-5:** fail → implement → pass → core tsc 0; full motion suite no regressions. No commit. (Pattern pixels validated in Task 6.)

---

### Task 4: Fill-type UI — Shader fill option in the inspector

**Files:**
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (the shape fill controls + text fill controls / `GradientFillControls`)
- Test: `apps/web/src/motion/components/PropertiesPanel.shader-fill.test.tsx`

**Implementation:** read how the shape/text fill type is currently chosen (solid/gradient/none) in PropertiesPanel. Add a **Shader** option to the fill-type selector; choosing it sets the fill to `createDefaultMotionShaderFill(<first fill shader>)` (or opens a picker). Render a shader picker (`getMotionShaderFillDefs()`) and, for the active shader fill, a control per `getMotionShaderDef(shaderId).params` (Slider/NumberInput) that writes `fill.shader.params[name]` via the existing fill-update path (`replaceLayer`). Same for text `fillShader`. Match real control accessible names (read the components; controls derive a11y name from the astryx label, not the Field — use role-scoped queries in the test, as in Plan A).

- [ ] **Step 1: Failing RTL test** — select a shape layer, switch fill type to Shader, pick "Liquid Metal", assert `layer.style.fill.type === "shader"` + `shaderId === "liquid-metal"` via the store (async → `waitFor`); change a param, assert `fill.shader.params` updates.
- [ ] **Step 2-5:** fail → implement → pass → web tsc 0; eslint clean. No commit.

---

### Task 5: Preview parity for shader fills

**Files:**
- Modify: `apps/web/src/motion/stage-preview-mode.ts` (`layerUsesRendererPreview` + `compositionHasMotionShaderLayers` from Plan A's Task 6)
- Test: extend `apps/web/src/motion/components/StageCanvas.shader-preview.test.tsx`

**Implementation:** Plan A routed shader-EFFECT layers to the renderer-backed preview. Extend the predicate so shader-FILL layers do too: OR-in `layerHasMotionShaderFill(layer)` wherever `layerHasMotionShaderEffects(layer)` is used in `layerUsesRendererPreview`/`compositionHasMotionShaderLayers`. (Consider a single `layerHasMotionShader(layer) = effects || fill` helper to avoid drift.)

- [ ] **Step 1: Failing test** — predicate returns `true` for a layer with a shader fill. **Step 2-5:** fail → implement → pass → web tsc 0. No commit.

---

### Task 6: Integration verification

- [ ] **Step 1:** core+web tsc → 0; eslint clean on touched files.
- [ ] **Step 2:** `pnpm --filter @openreel/core test:run src/motion` + `cd apps/web && npx vitest run src/motion` → all new tests pass; only the pre-existing `PropertiesPanel.scene3d.test.tsx` case-bug fails.
- [ ] **Step 3:** Visual (dev server, Playwright, light + dark): select a shape layer, set its fill to Shader → Liquid Metal; confirm the shape renders the procedural metal fill (renderer-backed preview); change `scale`/`contrast` and see it update; try Watercolor + Gradient Noise; apply to a text layer's fill. 0 console errors.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review
- **Spec coverage:** fill library (Task 1), `FillStyle` shader variant + text `fillShader` (Task 2), `createPattern` paint path (Task 3), fill-type UI (Task 4), preview parity (Task 5), verify (Task 6) — matches spec §4 + §7. Per-fill-param keyframing deliberately deferred (fills lack an effect id; noted in Global Constraints). ✓
- **Placeholders:** GLSL + UI integration are functional specs with exact files/interfaces/tests (implementers write+test against real code, per Plan A). ✓
- **Type consistency:** `MotionShaderFill`/`createDefaultMotionShaderFill`/`isShaderFill`/`getMotionShaderFillDefs`/`layerHasMotionShaderFill` consistent across Tasks 1-5; reuses Plan A's `MotionShaderDef`, `MotionShaderRenderer`, `defaultMotionShaderParams`, `getMotionShaderDef`. ✓
