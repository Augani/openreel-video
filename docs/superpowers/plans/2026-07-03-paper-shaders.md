# Paper Shaders Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (workflow-orchestrated). Spec: docs/superpowers/specs/2026-07-03-paper-shaders-design.md — the semantic authority. Grounding facts below are verified with file:line refs; trust them over assumptions, and re-read the cited code before editing.

**Goal:** Ship Paper Design's ~29 shader catalog as first-class presets in the Motion Creator (fills + effects, keyframable, exportable) and as clip shader-effects in the video editor.

**Architecture:** Extend `MotionShaderRenderer` with type-driven uniform upload (vec4 colors, arrays, textures, custom vertex shader, static sizing uniforms, time scale); a data-driven adapter module maps each Paper fragment source to a `MotionShaderDef`; the library aggregation + pickers + MCP flow unchanged; video editor gains an `Effect.type:"shader"` branch reusing the same renderer.

**Tech stack:** TypeScript strict, WebGL2 `#version 300 es`, Vitest, `@paper-design/shaders@0.0.76` (dep of packages/core — already declared), `@paper-design/shaders-react` (dep of apps/web, UI-only, may stay unused this phase).

## Global Constraints

- Do NOT git commit/add/stash/revert. NO line comments/docstrings (exception: the adapter file may carry a one-line Apache-2.0 attribution header pointing at the package). TS strict — never `any`, unsafe casts, or non-null assertions. Fail fast, immutable updates.
- TDD per task: failing test → run → implement → green.
- **Zero behavior change for existing shaders**: all new `MotionShaderDef` fields optional; the 11 built-in + generated AI shaders render byte-identically (existing suites are the net).
- Determinism: shader rendering stays a pure function of (def, width, height, time, params) — no wallclock anywhere.
- WebGL2-dependent tests must skip cleanly (`describe.skipIf`) when `OffscreenCanvas`/`webgl2` is unavailable in the test env — but pure logic (param mapping, def shape, GLSL string assembly) is testable everywhere and MUST be.
- Typecheck: plain `pnpm exec tsc --noEmit` per package. Suites stay FULLY green: core motion 586+, web motion 261+, agent 445+.
- Baseline refs (verified): `MotionShaderDef` at packages/core/src/motion/shaders/types.ts:16-23; renderer WebGL2 ctx at motion-shader-renderer.ts:197; uniform upload (uniform1f-only today) at :106-123; u_input flip-Y at :348-357; library aggregation shaders/index.ts:26-48; fill pattern createMotionShaderFillPattern motion-renderer.ts:2235-2282 (frame-cache key :2248); effect pass applyMotionShaderEffectsToBuffer :924-973; keyframe bridges effect.<id>.<param> (motion-effects.ts:672) and shape.fill.shader.<param> (motion-keyframes.ts:155); pickers PropertiesPanel.tsx:2266/2350, EffectsPanel.tsx:238; video effects switch video-effects-engine.ts:601+860-950 (inline WebGL2 GLSL already at :28+); Effect type open (types/timeline.ts:146-152).

---

### Task 1: Renderer extensions + type-driven uniforms

**Files:** Modify `packages/core/src/motion/shaders/types.ts`, `packages/core/src/motion/motion-shader-renderer.ts`; Create `packages/core/src/motion/motion-shader-renderer.uniforms.test.ts`.

Add the optional `MotionShaderDef` fields from spec §Design.1 (`vertexShader`, `staticUniforms`, `colorArrayParams`, `needsNoiseTexture`, `timeScale`, `inputUniform`, `collection`). Renderer changes:
- Program compile uses `def.vertexShader ?? VERTEX_SHADER_SOURCE`; program cache key must include a vertex marker (def.id is enough since defs are immutable, but a re-registered generated shader with same id needs the existing invalidation path — check how generated-shader recompiles are handled today and keep that behavior).
- Replace the uniform1f-only upload with **type-driven upload**: after link, enumerate `getActiveUniform` info; upload params by matching uniform type (FLOAT → `uniform1f`; FLOAT_VEC4 + param type "color" → parse `#RRGGBB[AA]` → `uniform4f`; FLOAT_VEC2/3 from `staticUniforms` arrays; FLOAT arrays via `uniform1fv`, VEC4 arrays via `uniform4fv`).
- `staticUniforms`: numbers → `uniform1f`, length-2/3/4 arrays → `uniform2f/3f/4f`, uploaded every render before params (params may override same-named uniforms — params win).
- `colorArrayParams`: collect params named `color1..colorN` (present in `params`), parse each, pack into a flat Float32Array → `uniform4fv(<uniform>)`, and `uniform1i/1f(<countUniform>)` per the GLSL type.
- `needsNoiseTexture`: import `getShaderNoiseTexture` from `@paper-design/shaders`, upload once per program to TEXTURE1 (u_input stays TEXTURE0), cached.
- `u_time` upload becomes `time * (def.timeScale ?? 1)`.
- `inputUniform`: bind the input canvas texture to `def.inputUniform ?? "u_input"`.
- FIRST verify Paper's time unit: read `node_modules/.pnpm/@paper-design+shaders@0.0.76/node_modules/@paper-design/shaders/dist/shader-mount.js` — find how `u_time` derives from `currentFrame` (ms). Record the finding in your report; Task 2 sets the adapter's timeScale from it.

**Tests (≥10):** pure param-parse helpers (hex→vec4 incl. #RRGGBBAA, invalid→fallback); def-shape acceptance (new fields optional, old defs unchanged); WebGL2-gated (`describe.skipIf(no webgl2)`): float param uploads, color param lands as vec4 (render 1×1 with passthrough shader outputting the color → readPixels equals it), static vec2 upload, color-array pack (shader outputs u_colors[1] → matches color2 param), timeScale (shader outputs fract(u_time) with timeScale 2 → t=0.25 reads as 0.5), custom vertex shader compiles and draws, existing built-in `liquid-metal` def still renders non-black.

**Produces:** the extended def fields + the guarantee that params upload by GL type.

### Task 2: Paper adapter module

**Files:** Create `packages/core/src/motion/shaders/paper-shaders.ts`, `packages/core/src/motion/shaders/paper-shaders.test.ts`; Modify `packages/core/src/motion/shaders/index.ts` (append `PAPER_SHADER_DEFS` to `MOTION_SHADER_LIBRARY`, export it).

Import fragment sources + metas from `@paper-design/shaders`. Read their `dist/vertex-shader.js`/`shader-sizing.js` exports FIRST and wire: shared vertex source (export it from the adapter for def.vertexShader), sizing `staticUniforms` from `defaultPatternSizing`/`defaultObjectSizing` (map: u_fit via `ShaderFitOptions`, u_scale 1, u_rotation 0, u_offsetX/Y 0, u_originX/Y 0.5, u_worldWidth/Height 0, u_pixelRatio 1 — VERIFY exact names/values against their d.ts, do not guess).
Build `PAPER_SHADER_DEFS: readonly MotionShaderDef[]` data-driven from a curated table. Launch set (exclude any that fail the smoke test, listing exclusions in the test):
- fills (generative): mesh-gradient, static-mesh-gradient, static-radial-gradient, smoke-ring, neuro-noise, metaballs, god-rays, spiral, swirl, warp, voronoi, simplex-noise, perlin-noise, grain-gradient, pulsing-border, dot-orbit, dot-grid, waves, color-panels, dithering.
- effects (image filters, `inputUniform` mapped to their image sampler name — read each shader's uniforms to find it): water, paper-texture, fluted-glass, image-dithering, halftone-dots, halftone-cmyk, heatmap, liquid-metal (name it `paper-liquid-metal`; a builtin `liquid-metal` exists — ids must not collide), gem-smoke.
Ids `paper-<kebab-name>`, `collection: "Paper"`, `origin: "builtin"`. Params: 2-5 curated numeric sliders per shader from their Params types (sensible min/max/default; read each shader's `.d.ts`) + colors: single-color shaders get color params; multi-color (u_colors array) get color1..color4 + `colorArrayParams`. `needsNoiseTexture` where the fragment samples a noise sampler (grep each fragment source for `sampler2D`). `timeScale` from Task 1's verified unit.

**Tests (≥8):** every def id unique + prefixed; every def compiles via `validateFragmentSource` (WebGL2-gated, else skip); every fill def does NOT reference the input uniform; every effect def's inputUniform exists in its GLSL; smoke render 8×8 at t=0 vs t=1 differs for a sampled animated subset (mesh-gradient, smoke-ring, spiral) and is non-constant for static ones (dot-grid); params all have finite defaults within [min,max]; library aggregation exposes them via getMotionShaderFillDefs/EffectDefs.

### Task 3: Motion UI grouping + MCP surface

**Files:** Modify `apps/web/src/motion/components/PropertiesPanel.tsx` (fill + text pickers), `apps/web/src/motion/components/EffectsPanel.tsx`, `packages/agent/src/registry.ts` (`list_motion_shaders`); Create `packages/agent/src/registry.paper-shaders.test.ts`.

Pickers group defs by `collection ?? "Built-in"` using `<optgroup>` (or the panel's existing select idiom — match it). `list_motion_shaders` gains optional `collection` filter; description documents the Paper collection. Verify `set_motion_shader_fill` + `add_motion_shader_effect` + `effect.<id>.<param>` keyframes work with paper ids end-to-end in the agent test (headless host — the shader def lookup is pure; rendering not required).

**Tests (≥6, agent):** list returns paper defs with collection field; collection filter; set_motion_shader_fill with `paper-mesh-gradient` stores fill (shaderId + defaults); add_motion_shader_effect with `paper-halftone-dots`; add_motion_keyframe on `effect.<id>.<param>` for a paper param; unknown collection filter → empty list not error. Web: extend an existing panel test only if one covers the picker; else tsc+suites.

### Task 4: Video editor shader effects (phase 2)

**Files:** Modify `packages/core/src/video/video-effects-engine.ts`, `packages/core/src/types/timeline.ts` (only if the open `Effect` type needs a documented shape — prefer no type change), `apps/web/src/components/editor/` effects UI (locate the panel listing video effects and its add-effect flow first), `packages/agent/src/registry.ts` (`add_video_effect` description + shaderId validation); Create `packages/core/src/video/video-effects-engine.shader.test.ts`.

New branch in `applyEffects` for `effect.type === "shader"`: params `{ shaderId: string, ...numeric/color params }`; look up via `getMotionShaderDef`, require category `"effect"`, lazily create one shared `MotionShaderRenderer`, render with inputCanvas = the current frame canvas/buffer the engine already holds at that point (READ the engine's buffer flow at :601-950 first and integrate where other whole-frame effects composite), time = the clip-local time value the engine already threads (find it — if absent for effects, derive from the frame timestamp param), blit result. WebGL2 unavailable or def missing/wrong category → skip the effect (return input unchanged). UI: add "Shader" to the video effects menu with a def select (effect-category, incl. collection groups) + sliders for its params, following the existing effect-inspector pattern exactly. MCP: extend `add_video_effect` description + validate shaderId when type === "shader".

**Tests (≥6):** engine unit (WebGL2-gated): shader effect transforms a solid-color frame (halftone output ≠ input); unknown shaderId no-ops; fill-category id no-ops; determinism same t same pixels. Agent: add_video_effect type shader happy + invalid shaderId. Web: effects menu contains Shader entry (RTL if the menu has tests; else tsc).

### Task 5 (gate): full verification

`pnpm exec tsc --noEmit` in packages/core, apps/web, packages/agent (0 each); `pnpm --filter @openreel/core test:run src/motion` (586+) AND `pnpm --filter @openreel/core test:run src/video` (all green); `cd apps/web && pnpm exec vitest run src/motion` (261+ FULLY green); `pnpm --filter @openreel/agent test:run` (445+). Report verbatim.

**Execution note (controller):** T1 → T2 → [T3 ∥ T4] → T5. T2 needs T1's fields; T3/T4 touch disjoint packages/files (T3: registry+motion panels; T4: video engine+editor UI+registry — BOTH touch registry.ts, so run T3 before T4 if the workflow can't isolate; safer: T3 ∥ T4 with T4 instructed to append its registry changes independent of T3's `list_motion_shaders` edit — different tools, low collision risk; controller may serialize if a conflict appears).
