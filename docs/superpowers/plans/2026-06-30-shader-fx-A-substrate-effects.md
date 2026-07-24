# Shader FX — Plan A: Substrate + Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build a WebGL2 fragment-shader substrate for the motion app and ship a library of keyframeable **shader effects** (Dither, Gradient Map, Pixelate, Halftone) end-to-end. (Shader fills are Plan B.)

**Architecture:** A self-contained shader library (GLSL + param descriptors) + a `MotionShaderRenderer` (fullscreen-quad WebGL2 pass, render GL→bitmap) that mirrors the scene3d renderer pattern. A new `"shader"` effect type plugs into the existing per-layer effect render hook; its params live in a generic bag made keyframeable via a data-driven branch in the effect-param system (which also fixes an existing 10-of-23 whitelist bug). Inspector + preview-parity follow.

**Tech Stack:** TypeScript (strict), WebGL2, Vitest + @testing-library/react. Reference pattern: `packages/core/src/motion/motion-three-renderer.ts` (GL→bitmap).

## Global Constraints

- No line comments in code; no docstrings except public-API exports. TS strict, no `any`.
- Reuse the scene3d "render GL → OffscreenCanvas → drawImage into the 2D canvas" pattern; do NOT introduce WebGPU (WebGL2 only, universal availability).
- Shader params are a generic `Record<string, number>` bag keyed by the shader def's param names; the keyframe path is `effect.<effectId>.<paramName>`.
- Spec: `docs/superpowers/specs/2026-06-30-keyframeable-shader-fx-design.md` — v1 effect library is exactly Dither, Gradient Map, Pixelate, Halftone.
- Gates per task: `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0 -p tsconfig.json` → 0; `npx eslint <files> --quiet` clean; the task's vitest test green. (Core package: `pnpm --filter @openreel/core test:run <file>`.)
- Do NOT git commit (the branch has unrelated WIP; leave changes in the working tree).

---

### Task 1: Shader library — types + registry (4 effect shaders)

**Files:**
- Create: `packages/core/src/motion/shaders/types.ts`
- Create: `packages/core/src/motion/shaders/effect-shaders.ts`
- Create: `packages/core/src/motion/shaders/index.ts`
- Test: `packages/core/src/motion/shaders/shader-library.test.ts`

**Interfaces — Produces:**
```ts
export type MotionShaderParamType = "number" | "color";
export interface MotionShaderParamDef {
  readonly name: string;
  readonly label: string;
  readonly type: MotionShaderParamType;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}
export interface MotionShaderDef {
  readonly id: string;
  readonly name: string;
  readonly category: "fill" | "effect";
  readonly glsl: string;
  readonly params: readonly MotionShaderParamDef[];
}
export declare const MOTION_SHADER_LIBRARY: readonly MotionShaderDef[];
export declare function getMotionShaderDef(id: string): MotionShaderDef | undefined;
export declare function getMotionShaderEffectDefs(): readonly MotionShaderDef[];
export declare function defaultMotionShaderParams(def: MotionShaderDef): Record<string, number>;
```
Each effect shader's GLSL is a WebGL2 `#version 300 es` fragment shader with: `in vec2 vUv; uniform sampler2D u_input; uniform vec2 u_resolution; uniform float u_time; uniform float u_<param>…; out vec4 fragColor;` — for v1, `u_time` may be unused by static effects. v1 ids/params (all numeric):
- `dither` — params: `levels` (2..16, default 4, step 1), `scale` (1..8, default 1, step 1). Ordered 4×4 Bayer dithering of `texture(u_input, vUv)`.
- `gradient-map` — params: `mix` (0..1, default 1, step .01). Map input luminance to a 2-stop ramp (dark→light) and blend by `mix`.
- `pixelate` — params: `size` (1..64, default 8, step 1). Quantize `vUv` to `size`-px blocks before sampling.
- `halftone` — params: `dotSize` (2..32, default 8, step 1), `angle` (0..90, default 15, step 1). CMYK-ish dot screen on input luminance.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { MOTION_SHADER_LIBRARY, getMotionShaderDef, defaultMotionShaderParams } from "./index";

describe("motion shader library", () => {
  it("has the four v1 effect shaders with valid params", () => {
    const ids = MOTION_SHADER_LIBRARY.filter((d) => d.category === "effect").map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["dither", "gradient-map", "pixelate", "halftone"]));
    for (const def of MOTION_SHADER_LIBRARY) {
      expect(def.glsl.length).toBeGreaterThan(0);
      expect(new Set(def.params.map((p) => p.name)).size).toBe(def.params.length);
      for (const p of def.params) {
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
    expect(new Set(MOTION_SHADER_LIBRARY.map((d) => d.id)).size).toBe(MOTION_SHADER_LIBRARY.length);
  });
  it("builds default params from a def", () => {
    const dither = getMotionShaderDef("dither")!;
    expect(defaultMotionShaderParams(dither)).toEqual({ levels: 4, scale: 1 });
  });
});
```
- [ ] **Step 2: Run → fail** (`pnpm --filter @openreel/core test:run src/motion/shaders/shader-library.test.ts`) — module not found.
- [ ] **Step 3: Implement** `types.ts` (the interfaces above), `effect-shaders.ts` (the 4 `MotionShaderDef`s — write + self-check each GLSL compiles by the shape above; keep them minimal and correct), and `index.ts` (`MOTION_SHADER_LIBRARY = [...EFFECT_SHADERS]`, `getMotionShaderDef`, `getMotionShaderEffectDefs`, `defaultMotionShaderParams = (def) => Object.fromEntries(def.params.map((p) => [p.name, p.default]))`). Re-export the new public symbols from the core barrel (`packages/core/src/index.ts` or the motion barrel, matching how `motion-scene3d` is exported).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: tsc 0** (`cd apps/web && npx tsc …`). No commit.

---

### Task 2: `MotionShaderRenderer` (WebGL2 fullscreen-quad pass)

**Files:**
- Create: `packages/core/src/motion/motion-shader-renderer.ts`
- Test: `packages/core/src/motion/motion-shader-renderer.test.ts`

**Interfaces — Consumes:** `MotionShaderDef` (Task 1). **Produces:**
```ts
export interface MotionShaderRenderInput {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly params: Record<string, number>;
  readonly inputCanvas?: CanvasImageSource;
}
export declare class MotionShaderRenderer {
  static isSupported(): boolean;
  render(def: MotionShaderDef, input: MotionShaderRenderInput): OffscreenCanvas | null;
  dispose(): void;
}
```

**Implementation contract:** lazily create ONE shared `OffscreenCanvas` + `getContext("webgl2")`; compile+link+cache a program per `def.id` (vertex shader = passthrough fullscreen triangle/quad emitting `vUv`); on `render`, resize the canvas, bind the program, upload `inputCanvas` to a texture bound to `u_input` (skip if absent), set `u_resolution`/`u_time`/each `u_<param>` uniform from `input.params`, draw the quad, return the canvas. Return `null` (caller falls back to the unshaded layer) when WebGL2 is unavailable or compile fails — never throw. Add a `webglcontextlost` listener that clears the program cache.

- [ ] **Step 1: Write the failing test** (jsdom has no real WebGL2 → assert the safe-fallback contract, which is the load-bearing behavior):
```ts
import { describe, expect, it } from "vitest";
import { MotionShaderRenderer } from "./motion-shader-renderer";
import { getMotionShaderDef } from "./shaders";

describe("MotionShaderRenderer", () => {
  it("returns null (safe fallback) when WebGL2 is unavailable, without throwing", () => {
    const r = new MotionShaderRenderer();
    const out = r.render(getMotionShaderDef("dither")!, { width: 64, height: 64, time: 0, params: { levels: 4, scale: 1 } });
    expect(out).toBeNull();
    r.dispose();
  });
});
```
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** per the contract. Guard every GL call; wrap context creation in try/catch; `isSupported()` returns whether a webgl2 context could be obtained.
- [ ] **Step 4: Run → pass.** **Step 5: tsc 0; eslint clean.** No commit.

> Note: real GPU rendering is validated in Task 7's browser visual check (jsdom can't run WebGL2).

---

### Task 3: `MotionShaderEffect` type + data-driven param branch + 10/23 bug fix

**Files:**
- Modify: `packages/core/src/motion/types.ts` (MotionEffectType l.28-43; MotionEffect union l.370-385; effects on layer l.633)
- Modify: `packages/core/src/motion/motion-effects.ts` (param get/set ~l.540-700; `isMotionEffectNumericParameter` l.869-884; keyframe-property type l.521-538; numeric-param enum l.41-64)
- Test: `packages/core/src/motion/motion-effects.shader.test.ts`

**Interfaces — Produces:**
```ts
export interface MotionShaderEffect extends MotionEffectBase {
  readonly type: "shader";
  readonly shaderId: string;
  readonly params: Record<string, number>;
}
```
and the param accessors accept shader effects: reading `getMotionEffectParameterValue(shaderEffect, name)` returns `shaderEffect.params[name] ?? 0`; writing returns a new effect with `params[name]` set.

**Implementation notes (the intricate task — read the surrounding code):**
- Add `"shader"` to `MotionEffectType`; add `MotionShaderEffect` to the `MotionEffect` union.
- The keyframe-property type is `effect.${string}.${MotionEffectNumericParameter}` (a typed template, l.524). Shader param names are arbitrary, so **widen the param slot to `string`** for the property type (e.g. `effect.${string}.${string}`) OR add a parallel shader-aware builder. Keep existing call-sites compiling. Whatever you choose, `getMotionEffectKeyframeProperty`/`parseMotionEffectKeyframeProperty` must round-trip a shader param name.
- `getMotionEffectParameterValue` / `setMotionEffectParameterValue`: add a `case "shader":` that reads/writes `effect.params[param]` generically (clamp via the shader def's param descriptor when resolvable; otherwise pass through finite values).
- `isMotionEffectNumericParameter` (l.869-884): it currently whitelists only 10 of the 23 enum members — **fix it to accept all declared `MotionEffectNumericParameter` values** (so the 13 dropped params keyframe), AND accept arbitrary shader param strings when the effect is a shader (the validator may need the effect/known-shader-params in context, or simply accept any non-empty string for the shader path — choose the minimal correct option and note it).

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { getMotionEffectParameterValue, setMotionEffectParameterValue, getMotionEffectKeyframeProperty, parseMotionEffectKeyframeProperty } from "./motion-effects";
import type { MotionShaderEffect } from "./types";

const eff: MotionShaderEffect = { id: "e1", type: "shader", name: "Dither", enabled: true, shaderId: "dither", params: { levels: 4, scale: 1 } };

describe("shader effect params", () => {
  it("reads/writes generic params and round-trips the keyframe property", () => {
    expect(getMotionEffectParameterValue(eff, "levels" as never)).toBe(4);
    const next = setMotionEffectParameterValue(eff, "levels" as never, 8);
    expect(next.params.levels).toBe(8);
    const prop = getMotionEffectKeyframeProperty("e1", "levels" as never);
    expect(parseMotionEffectKeyframeProperty(prop)).toEqual({ effectId: "e1", param: "levels" });
  });
  it("no longer drops the previously-unwhitelisted levels param (10/23 bug)", () => {
    expect(parseMotionEffectKeyframeProperty("effect.x.gamma")).toEqual({ effectId: "x", param: "gamma" });
  });
});
```
- [ ] **Step 2: Run → fail.** **Step 3: Implement.** **Step 4: Run → pass.** **Step 5: full motion core tests** (`pnpm --filter @openreel/core test:run src/motion`) to confirm the param-system change didn't regress existing effects; tsc 0. No commit.

---

### Task 4: Render hook — apply shader effects per layer

**Files:**
- Modify: `packages/core/src/motion/motion-effects.ts` (classification — add shader effects to the temp-canvas trigger alongside pixel effects: `isMotionPixelEffect`/`layerHasMotionPixelEffects` or a sibling `layerHasMotionShaderEffects`)
- Modify: `packages/core/src/motion/motion-renderer.ts` (`renderVisualLayerWithAdvancedMasks` ~l.726-793, the getImageData→mutate→putImageData block ~l.765-773)
- Test: extend `motion-effects.shader.test.ts` (classification) — renderer pixel output is covered by Task 7 visual.

**Implementation:** the renderer holds one `MotionShaderRenderer` instance (lazy, disposed with the renderer). After the existing pixel-effect buffer pass, for each enabled shader effect (in stack order) resolve its params at the current time (`getMotionEffectParameterValueAtTime` per param) and call `shaderRenderer.render(def, { width, height, time, params, inputCanvas: contentBuffer.canvas })`; if it returns a canvas, clear `contentBuffer` and `drawImage` the result; if `null`, leave the buffer unchanged (graceful no-op). Ensure a layer with shader effects triggers the temp-canvas path (extend `layerHasMotionPixelEffects` → a combined `layerNeedsBufferedEffects`).

- [ ] **Step 1: Write failing test** — classification:
```ts
import { describe, expect, it } from "vitest";
import { getEnabledMotionEffects } from "./motion-effects";
// assert a layer with only a shader effect is detected as needing the buffered pass
```
(Use the real classification helper you add; assert `layerNeedsBufferedEffects(layerWithShaderEffect) === true`.)
- [ ] **Step 2–5:** fail → implement → pass → tsc 0; no commit. Renderer visual correctness deferred to Task 7.

---

### Task 5: EffectsPanel — Shaders group + shader param controls

**Files:**
- Modify: `apps/web/src/motion/components/EffectsPanel.tsx`
- Test: `apps/web/src/motion/components/EffectsPanel.shader.test.tsx`

**Implementation:** in the "Add Effect" gallery, add a **Shaders** group listing `getMotionShaderEffectDefs()`; selecting one calls the existing add-effect path to append a `MotionShaderEffect` with `defaultMotionShaderParams(def)`. In the effect's expanded controls, when `effect.type === "shader"`, render each `def.params` entry as a `Slider`/`NumberInput` (numeric) bound through the existing effect-param update + auto-keyframe path (same as other effects' params).

- [ ] **Step 1: Write failing RTL test** — render EffectsPanel for a layer, open the Shaders group, click "Dither", assert a `shader` effect with `shaderId:"dither"` is added to the layer via the store; expand it and assert a "levels" control renders and updating it writes `params.levels`. (Match real accessible names by reading EffectsPanel first, per sub-project-1 lessons — controls derive their a11y name from the astryx component label, not the Field.)
- [ ] **Step 2–5:** fail → implement → pass → tsc 0; eslint clean; no commit.

---

### Task 6: Live-preview parity

**Files:**
- Modify: `apps/web/src/motion/components/StageCanvas.tsx` (the `usesRendererPreview` decision ~l.392 and the effect-filter path ~l.3514-3568)
- Test: `apps/web/src/motion/components/StageCanvas.shader-preview.test.tsx` (or a focused unit on the predicate)

**Implementation:** a layer with any enabled shader effect (and, later, shader fill) must take the renderer-backed bitmap preview path (the same `usesRendererPreview` branch scene3d uses), because shader output cannot be expressed as a CSS filter. Extend the predicate that decides `usesRendererPreview` to include `layerHasMotionShaderEffects(layer)`.

- [ ] **Step 1: Write failing test** asserting the predicate returns true for a layer with a shader effect.
- [ ] **Step 2–5:** fail → implement → pass → tsc 0; no commit.

---

### Task 7: Integration verification

- [ ] **Step 1:** full `cd apps/web && npx tsc …` → 0; eslint on all touched files clean.
- [ ] **Step 2:** `pnpm --filter @openreel/core test:run src/motion` and `npx vitest run src/motion` (web) → all new tests pass; no NEW failures vs the known pre-existing `PropertiesPanel.scene3d.test.tsx` case-bug.
- [ ] **Step 3:** Visual (dev server, Playwright 1536×1024, light + dark): select a text/shape layer, Add Effect → Shaders → Dither; confirm the layer renders dithered in the live preview (renderer-backed). Keyframe the `levels` param across two times and scrub — confirm it animates. Try Gradient Map / Pixelate / Halftone. 0 console errors.
- [ ] **Step 4:** record any minors for the final review.

---

## Self-Review

- **Spec coverage:** substrate (library Task 1 + renderer Task 2), effects + data-driven keyframeable params + 10/23 fix (Task 3), render hook (Task 4), inspector (Task 5), preview parity (Task 6), verify (Task 7). Fills are Plan B (out of scope here, per the spec's sequencing). ✓
- **Placeholders:** GLSL bodies and the EffectsPanel/StageCanvas integration are specified functionally with exact files, interfaces, and tests rather than inlined verbatim — because untested inline GLSL/type-surgery is less reliable than an implementer writing+testing against the real code (sub-project 1 showed implementers integrate accurately from precise specs). Each task has a concrete failing test and pass criteria. ✓
- **Type consistency:** `MotionShaderDef`/`MotionShaderParamDef` (Task 1) consumed by `MotionShaderRenderer` (Task 2) and `defaultMotionShaderParams` (Tasks 1/5); `MotionShaderEffect` (Task 3) used by Tasks 4-6; `getMotionShaderEffectDefs`/`getMotionShaderDef` consistent across Tasks 1/4/5. ✓
