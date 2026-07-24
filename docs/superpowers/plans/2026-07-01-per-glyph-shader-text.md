# Per-Glyph Shader Text Animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a text layer carry a shader animator whose GPU shader runs per glyph, driven by the glyph's existing staggered animator progress (`u_progress`), so text can dissolve/glow/materialize letter-by-letter.

**Architecture:** Reuse the WebGL2 `MotionShaderRenderer` substrate and the mature `getMotionTextAnimatorRuns` per-glyph system. Add a `category:"text"` shader library, extend `MotionTextAnimator` with an optional `shader`, add a `u_progress` uniform, and in the renderer's per-glyph loop render each glyph to an offscreen and pass it through the shader with that glyph's progress. Falls back to plain `fillText` when no shader animator / no WebGL2.

**Tech Stack:** TypeScript strict, WebGL2, Vitest + RTL.

## Global Constraints

- Do NOT git commit/add/stash/revert — leave changes in the working tree.
- NO line comments, NO docstrings. TS strict, NEVER `any` or unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates.
- Reuse the existing single lazy `MotionShaderRenderer` (`this.shaderRenderer` on `MotionRenderer`) — do NOT create a second GL context.
- Text shaders are the exactly-4 v1 set (glyph-dissolve, glyph-glow-wave, chromatic-cascade, scanline-materialize), `category:"text"`, each `#version 300 es`, sampling `u_input` (the glyph pixels) and reading `uniform float u_progress;` (per-glyph 0..1) + `uniform float u_time;`.
- The per-glyph shader pass runs ONLY when an enabled shader animator is present; never regress the plain-text/fillText path; cap at `MAX_SHADER_GLYPHS = 120` (glyphs beyond render plain, emit one console note — no silent truncation).
- v1 honors ONE active shader animator per layer (first enabled with a `shader`); extras ignored.
- New MCP tools follow the `add_motion_text_animator` / `add_motion_effect` scaffold and shader-tool param clamping (`resolveShaderParams`).
- Gate per task: core+web+agent `tsc --noEmit --ignoreDeprecations 6.0` → 0; the task's Vitest test green; `pnpm --filter @openreel/core test:run src/motion` no regressions.

**Execution note (for the controller):** Tasks 1→4 are the core track and are ordered (Task 4 needs 1,2,3). Tasks 5/6/7 touch disjoint files (`stage-preview-mode.ts` / `PropertiesPanel.tsx` / `registry.ts`) and may run in parallel after the core track. Task 8 is the final gate.

---

### Task 1: Text shader library

**Files:**
- Modify: `packages/core/src/motion/shaders/types.ts` (add `"text"` to `MotionShaderCategory`)
- Create: `packages/core/src/motion/shaders/text-shaders.ts`
- Modify: `packages/core/src/motion/shaders/index.ts` (add `TEXT_SHADERS` to `MOTION_SHADER_LIBRARY`; add `getMotionShaderTextDefs`)
- Test: `packages/core/src/motion/shaders/shader-library.test.ts` (extend)

**Interfaces — Produces:** `TEXT_SHADERS: readonly MotionShaderDef[]` (category `"text"`), `getMotionShaderTextDefs(): readonly MotionShaderDef[]`. Reuses `MotionShaderDef`/`MotionShaderParamDef`.

v1 text shader ids/params (all numeric; `control` per Plan B convention — 0..1 fractions `"slider"`, else `"number"`):
- `glyph-dissolve` — `edgeWidth` (0..1, default .15, step .01, slider), `scale` (2..40, default 12, step 1, number). Reveal glyph alpha where `u_progress` crosses a per-fragment value-noise threshold, soft edge `edgeWidth`.
- `glyph-glow-wave` — `glow` (0..3, default 1.4, step .1, number), `softness` (0..1, default .5, step .05, slider). Emissive bloom that peaks near `u_progress≈0.5` and settles by 1; adds glow around glyph coverage.
- `chromatic-cascade` — `amount` (0..0.1, default .03, step .005, slider). Per-glyph RGB channel split of width `amount*(1-u_progress)` that converges to 0 as `u_progress→1`.
- `scanline-materialize` — `lines` (10..200, default 80, step 5, number), `jitter` (0..1, default .3, step .05, slider). Horizontal scanline wipe: reveal rows below `u_progress` with `u_time`-driven flicker of strength `jitter`.

- [ ] **Step 1: Write the failing test** — extend `shader-library.test.ts`:
```ts
import { getMotionShaderTextDefs, getMotionShaderFillDefs, getMotionShaderEffectDefs, MOTION_SHADER_LIBRARY } from "./index";
it("has the four v1 text shaders, disjoint from fills+effects", () => {
  const textIds = getMotionShaderTextDefs().map((d) => d.id);
  expect(textIds).toEqual(expect.arrayContaining(["glyph-dissolve", "glyph-glow-wave", "chromatic-cascade", "scanline-materialize"]));
  for (const d of getMotionShaderTextDefs()) {
    expect(d.category).toBe("text");
    expect(d.glsl).toContain("u_progress");
    expect(d.glsl).toContain("#version 300 es");
  }
  const others = new Set([...getMotionShaderFillDefs(), ...getMotionShaderEffectDefs()].map((d) => d.id));
  expect(textIds.some((id) => others.has(id))).toBe(false);
  expect(new Set(MOTION_SHADER_LIBRARY.map((d) => d.id)).size).toBe(MOTION_SHADER_LIBRARY.length);
});
```
- [ ] **Step 2: Run → fail** (`pnpm --filter @openreel/core test:run src/motion/shaders/shader-library.test.ts`).
- [ ] **Step 3: Implement.** In `types.ts`: `export type MotionShaderCategory = "fill" | "effect" | "text";`. Create `text-shaders.ts` with the 4 defs. Each GLSL is a valid `#version 300 es` fragment shader: `in vec2 vUv; uniform sampler2D u_input; uniform vec2 u_resolution; uniform float u_time; uniform float u_progress; uniform float u_<param>; out vec4 fragColor;`. Sample the glyph with `vec4 src = texture(u_input, vUv);` and modulate by `u_progress`. Full reference for **glyph-dissolve** (write the other three in the same shape, valid GLSL):
```glsl
#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform float u_time;
uniform float u_progress;
uniform float u_edgeWidth;
uniform float u_scale;
out vec4 fragColor;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
void main(){
  vec4 src = texture(u_input, vUv);
  float n = vnoise(vUv * u_scale + u_time * 0.05);
  float edge = max(u_edgeWidth, 0.001);
  float reveal = smoothstep(n - edge, n + edge, u_progress);
  fragColor = vec4(src.rgb, src.a * reveal);
}
```
In `index.ts`: `import { TEXT_SHADERS } from "./text-shaders";`, `export const MOTION_SHADER_LIBRARY = [...EFFECT_SHADERS, ...FILL_SHADERS, ...TEXT_SHADERS];`, `export const getMotionShaderTextDefs = () => MOTION_SHADER_LIBRARY.filter((d) => d.category === "text");`. Export through the motion barrel if the others are.
- [ ] **Step 4: Run → pass. Step 5: core tsc 0.** No commit.

---

### Task 2: `u_progress` uniform in `MotionShaderRenderer`

**Files:**
- Modify: `packages/core/src/motion/motion-shader-renderer.ts`
- Test: `packages/core/src/motion/motion-shader-renderer.test.ts` (extend)

**Interfaces — Produces:** `MotionShaderRenderInput.progress?: number` bound to `u_progress`.

- [ ] **Step 1: Failing test.** In jsdom WebGL2 is unavailable so `render` returns null; assert the type/contract instead: `new MotionShaderRenderer().render(def, { width: 4, height: 4, time: 0, progress: 0.5, params: {} })` returns `null` without throwing, and that `MotionShaderRenderInput` accepts `progress` (a `tsc`-level guarantee — add a typed call in the test). Keep it a compile+no-throw test consistent with the existing renderer test.
- [ ] **Step 2: Run → fail** (type error until `progress` is added).
- [ ] **Step 3: Implement.** Add `readonly progress?: number;` to `MotionShaderRenderInput`. Add `progressLocation: WebGLUniformLocation | null` to `CompiledProgram`; in `compileProgram` set `progressLocation: gl.getUniformLocation(program, "u_progress")`. In `render`, after the `timeLocation` block: `if (compiled.progressLocation) { const p = isFiniteNumber(input.progress) ? input.progress : 0; gl.uniform1f(compiled.progressLocation, p); }`.
- [ ] **Step 4: Run → pass. Step 5: core tsc 0.** No commit.

---

### Task 3: Data model + text-shader-animator helpers

**Files:**
- Modify: `packages/core/src/motion/types.ts` (`MotionTextAnimator`, ~586)
- Modify: `packages/core/src/motion/motion-text-animators.ts`
- Test: `packages/core/src/motion/motion-text-shader-animator.test.ts` (new)

**Interfaces — Consumes:** `getMotionShaderDef`, `getMotionShaderTextDefs` (`./shaders`). **Produces:**
```ts
interface MotionTextShaderRef { readonly shaderId: string; readonly params: Record<string, number>; }
// added to MotionTextAnimator: readonly shader?: MotionTextShaderRef;
getMotionTextShaderAnimator(layer: MotionTextLayer): MotionTextAnimator | undefined;
getMotionTextAnimatorGlyphProgress(animator: MotionTextAnimator, unitIndex: number, unitCount: number, localTime: number): number;
layerHasMotionShaderTextAnimator(layer: MotionLayer): boolean;
```

- [ ] **Step 1: Failing test** (`motion-text-shader-animator.test.ts`):
```ts
import { createMotionTextAnimator, addMotionTextAnimator, getMotionTextShaderAnimator,
  getMotionTextAnimatorGlyphProgress, sanitizeMotionTextAnimator, layerHasMotionShaderTextAnimator } from "./motion-text-animators";
// build a text layer with an animator carrying shader { shaderId: "glyph-dissolve", params: { edgeWidth: 0.2, scale: 12 } }
it("finds the shader animator and validates its shader", () => {
  const anim = { ...createMotionTextAnimator("text-reveal-up"), shader: { shaderId: "glyph-dissolve", params: { edgeWidth: 0.2 } } };
  const layer = /* text layer */ withAnimator(anim);
  expect(getMotionTextShaderAnimator(layer)?.shader?.shaderId).toBe("glyph-dissolve");
  expect(layerHasMotionShaderTextAnimator(layer)).toBe(true);
  const bad = sanitizeMotionTextAnimator({ ...anim, shader: { shaderId: "nope", params: {} } });
  expect(bad.shader).toBeUndefined();
});
it("computes staggered per-glyph progress", () => {
  const anim = createMotionTextAnimator("text-reveal-up");
  const first = getMotionTextAnimatorGlyphProgress(anim, 0, 5, anim.timing.startTime + anim.timing.duration * 0.5);
  const last = getMotionTextAnimatorGlyphProgress(anim, 4, 5, anim.timing.startTime + anim.timing.duration * 0.5);
  expect(first).toBeGreaterThan(last);
});
```
- [ ] **Step 2: Run → fail. Step 3: Implement.**
  - `types.ts`: add `readonly shader?: MotionTextShaderRef;` to `MotionTextAnimator`; define `interface MotionTextShaderRef { readonly shaderId: string; readonly params: Record<string, number>; }` near it.
  - `motion-text-animators.ts`: in `sanitizeMotionTextAnimator`, if `animator.shader` present and `getMotionShaderTextDefs().some(d => d.id === animator.shader.shaderId)`, keep it clamping params to the def ranges (drop unknown names, default missing); else strip the `shader` field. Add `getMotionTextShaderAnimator(layer)` = first enabled animator with a `shader` (after sanitize). Export `getMotionTextAnimatorGlyphProgress` as a thin wrapper over the existing internal `getAnimatorProgress(animator, unitIndex, unitCount, localTime)` (line ~346). Add `layerHasMotionShaderTextAnimator(layer)` = `layer.type === "text" && getMotionTextShaderAnimator(layer) !== undefined`.
- [ ] **Step 4: Run → pass. Step 5: core tsc 0; full motion suite no regressions.** No commit.

---

### Task 4: Renderer per-glyph shader pass

**Files:**
- Modify: `packages/core/src/motion/motion-renderer.ts` (`renderAnimatedText`, ~2292; imports)
- Test: `packages/core/src/motion/motion-text-shader-animator.test.ts` (extend)

**Interfaces — Consumes:** `getMotionTextShaderAnimator`, `getMotionTextAnimatorGlyphProgress`, `layerHasMotionShaderTextAnimator` (Task 3); `getMotionShaderDef`, `getMotionShaderTextDefs` (shaders); the shared `this.shaderRenderer` + `MotionShaderRenderInput.progress` (Task 2). Read `renderAnimatedText` fully first: it iterates lines then `for (const run of line)` and draws each glyph with `ctx.fillText(run.character, 0, 0)` under a per-glyph transform.

**Implementation:** Before the glyph loop, resolve `const shaderAnimator = getMotionTextShaderAnimator(layer)` and `const def = shaderAnimator?.shader ? getMotionShaderDef(shaderAnimator.shader.shaderId) : undefined` (must be `category:"text"`), and the total glyph/unit count `unitCount`. Add a module const `const MAX_SHADER_GLYPHS = 120;`. Per glyph, inside the existing transform:
- If `!def || glyphIndex >= MAX_SHADER_GLYPHS` → keep `ctx.fillText(...)` (existing path). If truncating, emit `console.warn` once per render (guard with a boolean).
- Else: draw the single glyph to a glyph-sized `OffscreenCanvas` (size from `ctx.measureText(run.character)` width + font ascent/descent + padding; guard >0 finite), lazily create via a small helper `renderGlyphToOffscreen(layer, run.character, metrics)`; call `this.shaderRenderer.render(def, { width, height, time: localTime, progress: getMotionTextAnimatorGlyphProgress(shaderAnimator, run.unitIndex, unitCount, localTime), params: shaderAnimator.shader.params, inputCanvas: glyphOffscreen })`; if non-null, `ctx.drawImage(result, ...)` at the glyph origin honoring `run.opacity`; if null, fall back to `ctx.fillText(...)`.

Ensure the lazy `this.shaderRenderer` is the SAME field used by fills/effects; `dispose()` already tears it down.

- [ ] **Step 1: Failing test.** Since GL is null in jsdom, test the SELECTION + progress logic, not pixels: expose (or test through a small pure helper) that for a layer with a `glyph-dissolve` shader animator, the renderer resolves `def.category === "text"` and computes distinct progress per glyph — assert via `getMotionTextAnimatorGlyphProgress` monotonicity already covered in Task 3, and add a renderer-level test that `layerHasMotionShaderTextAnimator(layer)` gates a new private/pure path (extract a pure `resolveTextShaderPass(layer, localTime)` returning `{ def, animator } | null` and unit-test it: returns non-null with the right def for a shader-animator layer, null otherwise).
- [ ] **Step 2: Run → fail. Step 3: Implement** (`resolveTextShaderPass` pure helper + wire into `renderAnimatedText`). **Step 4: pass. Step 5:** core tsc 0; full motion suite no regressions. No commit. (Pixels validated in Task 8.)

---

### Task 5: Preview parity

**Files:**
- Modify: `apps/web/src/motion/stage-preview-mode.ts`
- Test: `apps/web/src/motion/components/StageCanvas.shader-preview.test.tsx` (extend)

**Implementation:** OR `layerHasMotionShaderTextAnimator(layer)` (Task 3) into the combined `layerHasMotionShader` predicate used by `layerUsesRendererPreview` / `compositionHasMotionShaderLayers`, so a text layer with a shader animator uses the renderer-backed bitmap preview.

- [ ] **Step 1: Failing test** — the predicate returns `true` for a text layer with a shader animator, `false` for a plain text layer. **Step 2-5:** fail → implement → pass → web tsc 0. No commit.

---

### Task 6: Inspector UI — text shader animator

**Files:**
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (text section, near the text-animator controls)
- Test: `apps/web/src/motion/components/PropertiesPanel.text-shader.test.tsx` (new)

**Implementation:** In the text-layer branch, add a **Shader animator** control: a picker over `getMotionShaderTextDefs()` plus per-param controls (reuse the `ShaderFillControls`-style rendering). Selecting a shader ensures an animator exists (if none, `addMotionTextAnimator(layer, createMotionTextAnimator("text-reveal-up"))` then set its `shader`; if one exists, set `shader` on the first enabled animator via `updateMotionTextAnimator`). Clearing removes the `shader` field. Persist via the existing `patchLayer`/`replaceLayer` path. Read the current text-animator UI to match control naming and the store update pattern.

- [ ] **Step 1: Failing RTL test** — select a text layer, pick "Glyph Dissolve", assert (via the store, `waitFor`) the layer has an animator with `shader.shaderId === "glyph-dissolve"`; change a param, assert `shader.params` updates. Use role-scoped queries (a11y name from the astryx control, per prior sub-projects). **Step 2-5:** fail → implement → pass → web tsc 0; eslint clean. No commit.

---

### Task 7: MCP tool + `list_motion_shaders` text category

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.text-shader.test.ts` (new)

**Implementation:** Add `add_motion_text_shader_animator` (domain `motion`) mirroring `add_motion_text_animator` + the shader-tool scaffold: input `compositionId, layerId, shaderId, params?, stagger?, duration?`. Validate layer is `text`; `getMotionShaderDef(shaderId)?.category === "text"` else `INVALID_PARAMS`; build an animator (`createMotionTextAnimator("text-reveal-up")` with neutral transform), set its `shader` to `{ shaderId, params: resolveShaderParams(def, asRecord(args.params)) }`, apply optional `stagger`/`duration` onto `timing`, `addMotionTextAnimator`, commit; return `{ animatorId, shaderId, params }`. `list_motion_shaders` (registry.ts): include a `text` array (from `getMotionShaderTextDefs()`) and honor `category:"text"` in the filter. `remove_/toggle_motion_text_animator` already cover removal by id.

- [ ] **Step 1: Failing test** — `add_motion_text_shader_animator` on a text layer with `{shaderId:"glyph-dissolve"}` → `ok`, `data.animatorId`, layer gains an animator with `shader.shaderId`. Non-text layer → `INVALID_PARAMS`. Invalid id → `INVALID_PARAMS`. `list_motion_shaders` includes `data.text` with `glyph-dissolve`, and `category:"text"` filter returns only text. **Step 2-5:** fail → implement → pass → agent tsc 0. No commit.

---

### Task 8: Integration verification + live visual

- [ ] **Step 1:** core+web+agent tsc (`--ignoreDeprecations 6.0`) → 0.
- [ ] **Step 2:** `pnpm --filter @openreel/core test:run src/motion`; agent tests; `apps/web && npx vitest run src/motion` → all new tests pass; only the 2 known pre-existing `PropertiesPanel.scene3d.test.tsx` failures remain.
- [ ] **Step 3:** Live GPU visual (dev server, Playwright): a title text layer + `glyph-dissolve` shader animator reveals letter-by-letter over the timeline; scrub shows distinct per-glyph progress; try glyph-glow-wave. 0 console errors. If the app can't launch, document that unit/tool tests fully cover it and mark the live visual a manual follow-up (as in prior sub-projects).
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** library+category (Task 1), `u_progress` (Task 2), data model+helpers (Task 3), per-glyph render (Task 4), preview parity (Task 5), UI (Task 6), MCP (Task 7), verify (Task 8) — matches spec §Architecture/Components. ✓
- **Placeholders:** GLSL given in full for glyph-dissolve + exact functional contracts (uniforms, param ranges) for the other three, per the Plan A/B precedent; every tool/helper has interfaces + test assertions. ✓
- **Type consistency:** `MotionTextShaderRef`, `getMotionTextShaderAnimator`, `getMotionTextAnimatorGlyphProgress`, `layerHasMotionShaderTextAnimator`, `getMotionShaderTextDefs`, `MotionShaderRenderInput.progress`, `MAX_SHADER_GLYPHS`, `resolveTextShaderPass` consistent across tasks; reuse existing `MotionShaderRenderer`, `getMotionShaderDef`, `addMotionTextAnimator`/`updateMotionTextAnimator`/`sanitizeMotionTextAnimator`, `resolveShaderParams`. ✓
- **Ordering:** core 1→4 sequential; 5/6/7 parallel (disjoint files) after core; 8 gate. ✓
