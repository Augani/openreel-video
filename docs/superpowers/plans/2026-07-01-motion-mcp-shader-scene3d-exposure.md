# Motion MCP Exposure: Shaders + Scene3D + Fill-Param Keyframing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose the shader-fill, shader-effect, and shader-library capabilities as MCP tools; add motion-native scene3d object editing; and make shader **fill** params keyframeable (shader **effect** params already are).

**Architecture:** New `domain:"motion"` plain-object tools appended to the `TOOLS` array in `packages/agent/src/registry.ts`, following the established scaffold (`getMotionComposition` → `getMotionLayer` → build immutable next layer via core pure-functions → `commitMotionComposition`). One net-new core feature: fill-shader-param keyframe property paths (`shape.fill.shader.<param>`, `text.fillShader.<param>`) recognized by the keyframe system and sampled per-frame by the renderer.

**Tech Stack:** TypeScript strict, Vitest. Core subpath imports (`@openreel/core/motion/...`).

## Global Constraints

- Do NOT git commit/add/stash/revert — leave changes in the working tree.
- NO line comments, NO docstrings. TS strict, NEVER `any` or unsafe casts. Validate inputs, guard nulls, fail fast.
- New tools follow the EXACT scaffold of `add_motion_effect` (registry.ts:23199) / `add_scene_object` (registry.ts:25585): `host.requireOpenProject()`; `getMotionComposition`/`getMotionLayer` → `fail(msg,"NOT_FOUND")` on miss; coerce args with `optionalString`/`optionalNumber`/`asRecord`; enum-check with `Set` membership; `fail(msg,"INVALID_PARAMS")` on bad input; mutate via `commitMotionComposition(host, replaceMotionLayer(...))`; return `ok(summary, data)`.
- Registry tools use JSON-Schema shorthands `str`/`num`/`bool`/`obj(props, required)` (registry.ts:285-291).
- Gate per task: `cd packages/core && npx tsc --noEmit --ignoreDeprecations 6.0` → 0; `cd apps/web && npx tsc --noEmit --ignoreDeprecations 6.0` → 0; the task's Vitest test green; no regression in `pnpm --filter @openreel/core test:run src/motion` and the agent package tests.
- Shader ids/params are validated against the live library — never hard-code shader ids in logic (descriptions may name examples).

---

### Task 1: `list_motion_shaders` tool (introspection)

**Files:**
- Modify: `packages/agent/src/registry.ts` (add tool to `TOOLS`; add imports)
- Test: `packages/agent/src/registry.shaders.test.ts` (new)

**Interfaces — Produces:** tool `list_motion_shaders`. Consumes core: `getMotionShaderFillDefs`, `getMotionShaderEffectDefs` from `@openreel/core/motion/shaders`.

- [ ] **Step 1: Failing test.** Use the existing test host helper (see `packages/agent/src/executor.test.ts` / `test-fixtures.ts` for how tools are invoked in tests). Assert `list_motion_shaders` returns `ok` with `data.fills` containing an entry `{ id:"liquid-metal", params:[…] }` and `data.effects` containing `{ id:"pixelate", … }`, and that each param has `name/label/min/max/default/step`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Add imports `import { getMotionShaderFillDefs, getMotionShaderEffectDefs } from "@openreel/core/motion/shaders";`. Add tool:
```ts
{
  name: "list_motion_shaders",
  domain: "motion",
  title: "List motion shaders",
  description:
    "Enumerate the built-in GPU shader library for Motion Creator. Returns fill shaders (procedural fills for shape/text layers) and effect shaders (post-process effects on any visual layer), each with its parameters (name, label, min, max, default, step). Use before set_motion_shader_fill / add_motion_shader_effect to pick a valid shaderId and know its params. Optional category filter: 'fill' or 'effect'.",
  inputSchema: obj({ category: str }, []),
  readOnly: true,
  destructive: false,
  expensive: false,
  handler: (args) => {
    const toInfo = (def) => ({
      id: def.id,
      name: def.name,
      category: def.category,
      params: def.params.map((p) => ({
        name: p.name, label: p.label, min: p.min, max: p.max,
        default: p.default, step: p.step, control: p.control ?? null,
      })),
    });
    const category = optionalString(args.category);
    const fills = getMotionShaderFillDefs().map(toInfo);
    const effects = getMotionShaderEffectDefs().map(toInfo);
    if (category === "fill") return ok(`${fills.length} fill shaders`, { fills });
    if (category === "effect") return ok(`${effects.length} effect shaders`, { effects });
    return ok(`${fills.length} fill + ${effects.length} effect shaders`, { fills, effects });
  },
}
```
(Match the surrounding handler style; `def`/`p` are typed by the core return types — add explicit param types if tsc requires, no `any`.)
- [ ] **Step 4: Run → pass. Step 5: core+web+agent tsc 0.** No commit.

---

### Task 2: `set_motion_shader_fill` tool (shape + text)

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: extend `packages/agent/src/registry.shaders.test.ts`

**Interfaces — Consumes:** `getMotionShaderFillDefs`, `getMotionShaderDef` (`@openreel/core/motion/shaders`); `createDefaultMotionShaderFill` (`@openreel/core/motion/motion-shape-style`). Reuses `getMotionComposition`/`getMotionLayer`/`commitMotionComposition`/`replaceMotionLayer` (registry-local). **Produces** the same param-clamp helper pattern reused in Tasks 3 later.

Behavior: shape layer → set `style.fill = { type:"shader", opacity:<existing ?? 1>, shader:{ shaderId, params } }`; text layer → set `style.fillShader = { shaderId, params }`. Validate `shaderId ∈ getMotionShaderFillDefs()`. Build params: start from `defaultMotionShaderParams(def)`, overlay supplied `params` clamped to each param's `[min,max]`, ignore unknown names.

- [ ] **Step 1: Failing test.** Create a comp with a shape layer + a text layer (mirror how other motion tool tests build a comp — see existing `add_motion_effect` test). Call `set_motion_shader_fill` on the shape with `{shaderId:"liquid-metal", params:{contrast:2.5, bogus:9}}`; assert the stored layer's `style.fill.type==="shader"`, `style.fill.shader.shaderId==="liquid-metal"`, `params.contrast===2.5`, no `bogus` key. Call on the text layer with `{shaderId:"watercolor"}`; assert `style.fillShader.shaderId==="watercolor"`. Call with `{shaderId:"not-a-shader"}`; assert `!result.ok` and `error.code==="INVALID_PARAMS"`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Add imports. Write a local helper (place near other motion helpers) that resolves clamped params:
```ts
const resolveShaderParams = (
  def: MotionShaderDef,
  raw: Record<string, unknown> | undefined,
): Record<string, number> => {
  const params: Record<string, number> = {};
  for (const p of def.params) {
    const supplied = raw ? optionalNumber(raw[p.name]) : undefined;
    params[p.name] = supplied === undefined ? p.default : clampNumber(supplied, p.min, p.max);
  }
  return params;
};
```
Tool handler: guard project/comp/layer; `const def = getMotionShaderDef(shaderId); if (!def || def.category !== "fill") return fail(...)`; `const params = resolveShaderParams(def, asRecord(args.params));`; branch on `layer.type`:
  - `"shape"`: `nextLayer = { ...layer, style: { ...layer.style, fill: { type:"shader", opacity: layer.style.fill.opacity ?? 1, shader:{ shaderId, params } } } }`.
  - `"text"`: `nextLayer = { ...layer, style: { ...layer.style, fillShader: { shaderId, params } } }`.
  - else `return fail("Shader fill applies only to shape or text layers", "INVALID_PARAMS")`.
Commit via `commitMotionComposition(host, replaceMotionLayer(composition, layer.id, nextLayer))`; return `ok(...)` with `{ shaderId, params, layerType: layer.type }`. Cast the layer branches to the concrete layer types the surrounding code uses (`as MotionShapeLayer`/`MotionTextLayer` if the existing style tools do — match them; no `any`).
- [ ] **Step 4: Run → pass. Step 5: tsc 0.** No commit.

---

### Task 3: `add_motion_shader_effect` tool + `update_motion_effect` shader-param check

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: extend `packages/agent/src/registry.shaders.test.ts`

**Interfaces — Consumes:** `getMotionShaderEffectDefs`, `getMotionShaderDef`; `createMotionShaderEffect` (`@openreel/core/motion/motion-effects`), `addMotionLayerEffect`. Reuse `resolveShaderParams` from Task 2.

- [ ] **Step 1: Failing test.** On a shape layer call `add_motion_shader_effect` `{shaderId:"pixelate", params:{...}}`; assert `result.ok`, `data.effectId` present, and the layer now has an effect with `type:"shader"`, `shaderId:"pixelate"`. Then call the EXISTING `update_motion_effect` with that `effectId` and a shader param name + value; assert it succeeds and the stored `effect.params[<name>]` updated (this asserts update_motion_effect accepts shader params — if it fails, Step 3 widens it). Invalid `shaderId` → `INVALID_PARAMS`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Add the tool mirroring `add_motion_effect` (registry.ts:23199): validate `def = getMotionShaderDef(shaderId)` with `def.category === "effect"`; `let effect = createMotionShaderEffect(shaderId);` overlay clamped params via `resolveShaderParams` into a new effect object (`effect = { ...effect, params: { ...effect.params, ...resolveShaderParams(def, asRecord(args.params)) } }`); `nextLayer = addMotionLayerEffect(layer, effect)`; commit; return `ok` with `{ effectId: effect.id, shaderId, params: effect.params }`. **Then** read `update_motion_effect`'s handler: if it validates the `parameter` against a fixed `Set` (e.g. `MOTION_EFFECT_PARAMETERS`) that excludes shader param names, widen the guard so that when the target effect is a shader effect it accepts any `param` present in `getMotionShaderDef(effect.shaderId).params` (route through the shader-aware `setMotionEffectParameterValue`, which already handles `case "shader"`). If it already delegates generically, leave it and note so in the report.
- [ ] **Step 4: Run → pass. Step 5: tsc 0.** No commit.

---

### Task 4: Motion-native scene3d object editing tools

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.scene3d-edit.test.ts` (new)

**Interfaces — Consumes:** `MOTION_OBJECT_3D_KINDS` (`@openreel/core/motion/motion-scene3d`); the multi-object scene3d layer shape (`layer.objects[]`, each object with geometry/material/transform). Read `apps/web/src/motion/components/inspector/Scene3DInspector.tsx` for the EXACT immutable object-edit shape (field names for transform/material/geometry) and mirror it. Read `add_scene_object` (registry.ts:25585) for the object field schema already accepted.

Tools (all guard: layer.type==="scene3d" and it's a multi-object scene layer with `objects`):
- `set_motion_scene_object` — input `compositionId, layerId, objectId, transform?{position?,rotation?,scale?}, material?{color?,metalness?,roughness?,emissive?,opacity?,mapAssetId?}, geometry?{kind?,size?,depth?,cornerRadius?}`. Immutably merge supplied fields onto the matched object; validate `geometry.kind ∈ MOTION_OBJECT_3D_KINDS` when present; clamp `metalness/roughness/opacity` to [0,1]; `fail("NOT_FOUND")` if objectId absent.
- `remove_motion_scene_object` — input `compositionId, layerId, objectId`. Remove from `objects[]`; if it would leave 0 objects, `fail("Cannot remove the last object; remove the scene3d layer instead", "INVALID_PARAMS")`.
- `set_motion_scene_camera` — input `compositionId, layerId, position?{x,y,z}, target?{x,y,z}, fov?`. Immutably set the scene3d layer's own `camera` fields (static; complements `animate_scene_camera`).

- [ ] **Step 1: Failing test.** Build a comp; add a multi-object scene3d layer via `add_motion_3d_scene` then `add_scene_object` (or construct directly). Call `set_motion_scene_object` to change an object's `material.color` + `transform.position`; assert stored object reflects only those changes. Call `remove_motion_scene_object`; assert object count drops; removing the last → `INVALID_PARAMS`. Call `set_motion_scene_camera`; assert the layer `camera` updated.
- [ ] **Step 2: Run → fail. Step 3: Implement** the three tools (mirror `add_scene_object` scaffold; immutable `objects` map/ filter; `commitMotionComposition`). **Step 4: pass. Step 5: tsc 0.** No commit.

---

### Task 5: Shader effect param keyframing — verify + surface

**Files:**
- Test: `packages/agent/src/registry.effect-keyframe.test.ts` (new)
- Modify (only if needed): `packages/agent/src/registry.ts` (`list_motion_animatable_properties` handler)

**Interfaces:** `add_motion_keyframe` (registry.ts:22202) gates on `isMotionAnimatableProperty`, which already accepts `effect.<id>.<param>`. Renderer samples via `getMotionEffectParameterValueAtTime` (motion-renderer.ts:841).

- [ ] **Step 1: Failing/covering test.** Add a shader effect (via Task 3 tool), then call `add_motion_keyframe` with `property="effect.<effectId>.<param>"`, `time:0,value:<a>` and `time:1,value:<b>`; assert both succeed and `getMotionLayerPropertyKeyframes(layer, property)` has 2 entries. Then assert `list_motion_animatable_properties` for that layer INCLUDES the shader effect's param ids (so an agent can discover them).
- [ ] **Step 2: Run.** If the keyframe calls pass but `list_motion_animatable_properties` omits shader effect params, **Step 3:** extend that tool's handler to include shader-effect param descriptors (reuse the existing `getMotionEffectParameterDescriptors` / shader-aware descriptor path from Plan A). If everything already passes, record that no code change was needed. **Step 4: pass. Step 5: tsc 0.** No commit.

---

### Task 6: Fill-shader-param keyframe property system (core)

**Files:**
- Modify: `packages/core/src/motion/motion-keyframes.ts` (property type/union; `isMotionAnimatableProperty`; base-value resolver ~line 936/974; descriptors; a parse helper)
- Test: `packages/core/src/motion/motion-shader-fill-keyframe.test.ts` (new)

**Interfaces — Produces:**
```ts
type MotionShaderFillProperty = `shape.fill.shader.${string}` | `text.fillShader.${string}`;
parseMotionShaderFillKeyframeProperty(property: string):
  | { surface: "shape" | "text"; param: string }
  | undefined;
getMotionLayerShaderFillPropertyDescriptors(layer: MotionLayer):
  readonly MotionAnimatablePropertyDescriptor[];
```
Add `MotionShaderFillProperty` to the `MotionAnimatableProperty` union (line 148); make `isMotionAnimatableProperty` return true for the two prefixes (mirror how it accepts `effect.` paths — read that branch and copy the shape). In the base-value resolver used by `getMotionLayerPropertyValueAtTime` (switch near line 936/1171), add handling: for `shape.fill.shader.<param>` return `layer.type==="shape" && isShaderFill(layer.style.fill) ? layer.style.fill.shader.params[param] ?? <def default> : 0`; for `text.fillShader.<param>` return `layer.type==="text" && layer.style.fillShader ? layer.style.fillShader.params[param] ?? <def default> : 0` (look up the def via `getMotionShaderDef`). Descriptors resolver returns, for the layer's active fill shader, one `MotionAnimatablePropertyDescriptor` per param with `{ property: \`${prefix}.${p.name}\`, label: p.label, min: p.min, max: p.max, step: p.step, defaultValue: p.default }` (match the descriptor interface at line 160).

- [ ] **Step 1: Failing test.**
```ts
import { isMotionAnimatableProperty, parseMotionShaderFillKeyframeProperty,
  getMotionLayerShaderFillPropertyDescriptors, getMotionLayerPropertyValueAtTime } from "./motion-keyframes";
it("recognizes and resolves shader fill keyframe properties", () => {
  expect(isMotionAnimatableProperty("shape.fill.shader.scale")).toBe(true);
  expect(isMotionAnimatableProperty("text.fillShader.contrast")).toBe(true);
  expect(parseMotionShaderFillKeyframeProperty("shape.fill.shader.scale"))
    .toEqual({ surface: "shape", param: "scale" });
  const shape = /* build a shape layer with a liquid-metal shader fill, params.scale=6 */;
  expect(getMotionLayerPropertyValueAtTime(shape, "shape.fill.shader.scale", 0)).toBe(6);
  const descs = getMotionLayerShaderFillPropertyDescriptors(shape);
  expect(descs.map((d) => d.property)).toContain("shape.fill.shader.scale");
});
```
(Construct the shape layer via `createDefaultMotionShaderFill("liquid-metal")` on `style.fill`; import from motion-shape-style.)
- [ ] **Step 2: Run → fail. Step 3: Implement.** **Step 4: pass. Step 5:** core tsc 0; `pnpm --filter @openreel/core test:run src/motion` no regressions. No commit.

---

### Task 7: Renderer samples keyframed fill params per frame

**Files:**
- Modify: `packages/core/src/motion/motion-renderer.ts` (`createShapeFillStyle` ~1682, `resolveTextFillStyle` ~2078, `createMotionShaderFillPattern` ~1710)
- Test: `packages/core/src/motion/motion-shader-fill-keyframe.test.ts` (extend)

**Interfaces — Consumes:** `evaluateMotionPropertyValueAtTime` (motion-expressions.ts:258; already imported in motion-renderer at line 61), `getMotionLayerPropertyKeyframes` and `parseMotionShaderFillKeyframeProperty`/base-value from Task 6.

Add a helper on the renderer (or a module function):
```ts
private resolveShaderFillParams(
  layer: MotionLayer,
  base: Record<string, number>,
  prefix: "shape.fill.shader" | "text.fillShader",
  def: MotionShaderDef,
  localTime: number,
): Record<string, number>
```
For each `p of def.params`: property = `${prefix}.${p.name}`; if `getMotionLayerPropertyKeyframes(layer, property).length > 0`, value = `evaluateMotionPropertyValueAtTime({ keyframes: layer.keyframes, property, time: localTime, baseValue: base[p.name] ?? p.default, ... })` (read the exact `evaluateMotionPropertyValueAtTime` signature and pass what it needs); else value = `base[p.name] ?? p.default`. Return the effective params. **Guard:** if the layer has NO keyframes whose property starts with `prefix`, return `base` unchanged (zero cost for non-animated fills).

Wire it: in `createShapeFillStyle`, when `fill.type==="shader" && fill.shader`, compute `const def = getMotionShaderDef(fill.shader.shaderId)` and `const params = def ? this.resolveShaderFillParams(layer, fill.shader.params, "shape.fill.shader", def, localTime) : fill.shader.params`, and pass `params` (not the raw `fill.shader.params`) into `createMotionShaderFillPattern`. Same in `resolveTextFillStyle` with prefix `"text.fillShader"` and `layer.style.fillShader`. The existing frame cache in `createMotionShaderFillPattern` already keys on the passed params (serialized) + localTime, so animated fills cache correctly per frame.

- [ ] **Step 1: Failing test.** Extend the keyframe test: build a shape with a liquid-metal fill, add two keyframes on `shape.fill.shader.scale` (t=0→2, t=1→18) using `upsertMotionLayerKeyframe`. Assert `renderer.resolveShaderFillParams(layer, base, "shape.fill.shader", def, 0).scale` ≈ 2 and at `localTime=1` ≈ 18 (expose via a tiny test seam or test the effective-params through a public method if `resolveShaderFillParams` is private — if private, test through a thin exported helper or make the sampler a module-level pure function `resolveMotionShaderFillParams(...)` and unit-test that directly; prefer the module-level pure function for testability).
- [ ] **Step 2: Run → fail. Step 3: Implement** (prefer a module-level pure `resolveMotionShaderFillParams` used by both fill helpers). **Step 4: pass. Step 5:** core tsc 0; full motion suite no regressions. No commit. (Live GPU animation confirmed in Task 8.)

---

### Task 8: Integration verification + live MCP drive

- [ ] **Step 1:** core+web tsc (`--ignoreDeprecations 6.0`) → 0; agent package tsc → 0.
- [ ] **Step 2:** `pnpm --filter @openreel/core test:run src/motion` (all pass), agent package test suite (all new tests pass), `cd apps/web && npx vitest run src/motion` (green except the 2 known pre-existing `PropertiesPanel.scene3d.test.tsx` failures).
- [ ] **Step 3:** Live MCP smoke (read `~/.openreel/mcp-endpoint.json` per [[motion-mcp-http-drive]]; POST JSON-RPC `tools/call` with Bearer): `list_motion_shaders` returns the library; `set_motion_shader_fill` paints a shape; `add_motion_shader_effect` adds an effect and returns an effectId; `add_motion_keyframe` on `shape.fill.shader.scale` at two times animates the fill (verify via a rendered frame diff or reading back the layer). If the desktop app isn't running, document that the tool-layer + unit tests fully cover it and mark the live drive as a manual follow-up.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** Part 1 → Tasks 1-3; Part 2 → Task 4; Part 3 → Task 5; Part 4 → Tasks 6-7; verify → Task 8. ✓
- **Placeholders:** tools give full handler code or exact scaffold-to-mirror + interfaces + test assertions; core tasks give interfaces + the precise functions to modify + reference implementations (effect.<id>.<param>) to copy. ✓
- **Type consistency:** `resolveShaderParams` (Tasks 2-3), `MotionShaderFillProperty`/`parseMotionShaderFillKeyframeProperty`/`getMotionLayerShaderFillPropertyDescriptors` (Task 6), `resolveMotionShaderFillParams` (Task 7) named consistently; reuse existing `getMotionComposition`/`getMotionLayer`/`commitMotionComposition`/`replaceMotionLayer`/`clampNumber`/`optionalNumber`/`asRecord`. ✓
- **Ordering:** Task 6 (property system) precedes Task 7 (renderer eval) and both precede the Task 8 live keyframe drive; MCP shader tools (1-4) are independent and can land first. ✓
