# Paper Design Shader Library Integration — Design

**Date:** 2026-07-03
**Status:** Approved scope (both editors, phased: Motion first, video second)
**Branch:** feat/new-design-update

## Problem

Paper Design open-sourced their shader catalog (`@paper-design/shaders@0.0.76`, Apache-2.0, installed as a dependency of packages/core; `@paper-design/shaders-react` installed in apps/web) — ~29 production-quality WebGL2 fragment shaders: ~20 generative (mesh/radial gradients, smoke ring, neuro noise, metaballs, god rays, spiral, swirl, warp, voronoi, simplex/perlin noise, grain gradient, pulsing border, dot orbit/grid, waves, color panels, dithering) and ~9 image filters (water, paper texture, fluted glass, image dithering, halftone dots/CMYK, heatmap, liquid metal, gem smoke). Users should be able to use these in their editing. Our Motion Creator already has a complete WebGL2 shader subsystem (`MotionShaderDef` registry → fills/effects/text, keyframable params, deterministic export); the video editor has a separate effects engine with an existing inline-WebGL2 path but no shader-plugin seam.

## Goals

1. **Motion (phase 1):** every viable Paper shader becomes a first-class `MotionShaderDef` — generative ones as `fill` presets, image filters as `effect` presets — flowing automatically into the three existing pickers, `list_motion_shaders`, keyframable `u_<param>` uniforms, and both preview + export render paths.
2. **Runtime extensions** (in `MotionShaderRenderer`), needed by the catalog and useful generally:
   - `color` params upload as **vec4** (fixes the latent bug where color params upload as `uniform1f`),
   - color-array uniforms (`u_colors: vec4[N]` + `u_colorsCount`) for multi-color shaders,
   - optional per-def **custom vertex shader** + auto-supplied Paper sizing uniforms,
   - optional noise-texture upload (`getShaderNoiseTexture`) for shaders that sample one,
   - per-def time scaling so Paper motion speed matches our `u_time` = seconds convention.
3. **Video editor (phase 2):** a new `Effect.type: "shader"` branch in `video-effects-engine.applyEffects` that runs any `effect`-category motion shader (incl. the Paper image filters) on clip frames — preview + export + CPU-fallback story — surfaced in the video Effects UI and reachable via the existing `add_video_effect` MCP tool.
4. **Attribution:** keep `@paper-design/shaders` as an npm dependency (imports, not vendored copies) so Apache-2.0 attribution/licensing travels with the lockfile; adapter file headers note the source.

## Non-Goals

Their React components in our canvas pipeline (`shaders-react` stays only for potential preview cards later); their `ShaderMount` runtime (ours renders deterministically already); image-input shaders as *fills* (contract forbids fills sampling `u_input`); a new "shader clip" GraphicType for the video editor (deferred — phase 2 covers clip *effects*); shader thumbnails in pickers (follow-up polish).

## Design

### 1. Renderer extensions (`packages/core/src/motion/motion-shader-renderer.ts` + `shaders/types.ts`)

`MotionShaderDef` gains optional fields (all absent for existing shaders — zero behavior change):

```ts
vertexShader?: string;                       // compile with this instead of the shared vUv triangle
staticUniforms?: Record<string, number | readonly number[]>;  // uploaded verbatim each render (floats, vec2/3/4 by length)
colorArrayParams?: { uniform: string; countUniform: string; max: number };  // params color1..colorN -> u_colors[i], u_colorsCount
needsNoiseTexture?: string;                  // uniform name; upload getShaderNoiseTexture() as a texture
timeScale?: number;                          // u_time uploaded as localTime * timeScale (default 1)
```

Param type `"color"` now uploads **vec4** (`uniform4f`, parsed from `#RRGGBB`/`#RRGGBBAA` — reuse Paper's `getShaderColorFromString` semantics). Params whose GLSL uniform is a float stay `uniform1f`; the uploader inspects the uniform's type via `getActiveUniform` rather than guessing (robust for both). Existing built-in shaders keep working (their color params are floats-in-disguise today; the type-driven uploader keeps them correct either way).

**Verification duties in this area:** confirm Paper's `u_time` unit by reading `shader-mount.js` (their `currentFrame` is ms; check what lands in `u_time`) and set `timeScale` accordingly (one global constant for the adapter); confirm their vertex shader export (`dist/vertex-shader.js`) and the exact sizing uniforms it needs (`u_pixelRatio,u_originX/Y,u_worldWidth/Height,u_fit,u_scale,u_rotation,u_offsetX/Y,u_imageAspectRatio`), supplying `defaultPatternSizing`/`defaultObjectSizing` values via `staticUniforms`.

### 2. Adapter (`packages/core/src/motion/shaders/paper-shaders.ts`, new)

One data-driven module importing fragment sources from `@paper-design/shaders`. Per shader: an entry `{ id: "paper-<name>", name, category, glsl: <name>FragmentShader, vertexShader, staticUniforms, params, colorArrayParams?, needsNoiseTexture?, timeScale }` with a **curated** param list (sliders with sane min/max/default from their `<name>Meta`/Params types; 2–4 exposed colors for multi-color shaders). Category: generative → `"fill"`; image filters → `"effect"` (their image uniform bound to our `u_input` — verify name mapping; if their sampler is e.g. `u_image`, add `inputUniform?: string` to the def and bind TEXTURE0 to that name). Registered by appending to `MOTION_SHADER_LIBRARY` via a new export `PAPER_SHADER_DEFS` in `shaders/index.ts` — flows to pickers/MCP automatically. A new optional `collection?: string` field ("Paper") lets the pickers group them under a header.

Launch set: all ~20 generative + all ~9 image filters that pass a compile+render smoke test in CI (a test compiles every def via `validateFragmentSource` and renders one 8×8 frame asserting non-uniform output; any shader failing adaptation is EXCLUDED from the launch list with a code comment-free registry note in the test's expected-exclusions list).

### 3. Motion UI + MCP (small)

Pickers in PropertiesPanel/EffectsPanel group defs by `collection` (plain `<optgroup>`/section header). `list_motion_shaders` gains an optional `collection` filter param and mentions the Paper collection in its description. `set_motion_shader_fill`/`add_motion_shader_effect`/keyframing work unchanged (ids are just new library entries).

### 4. Video editor (phase 2)

`Effect { type: "shader", params: { shaderId, ...paramValues } }`:
- New branch in `video-effects-engine.applyEffects` (the engine already owns an inline WebGL2 GLSL path): instantiate/reuse one `MotionShaderRenderer`, look up the def (`getMotionShaderDef`), require category `"effect"`, render with `inputCanvas` = current frame buffer, `time` = clip-local time already available in the engine, params from `effect.params`; blit result back. Unknown/`fill` ids: skip gracefully (current behavior for unknown types).
- CPU fallback: none — when WebGL2 is unavailable the shader effect no-ops (documented), matching the graceful-skip convention.
- UI: video Effects panel gains a "Shader" effect whose inspector shows a shader select (effect-category defs incl. Paper) + param sliders.
- MCP: `add_video_effect` already accepts open `type`/params; extend its description documenting `type:"shader"` + params shape; validation for shaderId existence.

## Testing

Core: uploader type-driven tests (float/vec2/vec4/color/array/noise-texture via a mock GL or real OffscreenCanvas in jsdom-skip mode); every Paper def compiles (`validateFragmentSource`) and renders an 8×8 frame with non-constant pixels at t=0 vs t=1 for animated ones (real WebGL2 — skip suite gracefully when unavailable in CI env, but it runs in Electron/dev); param → uniform mapping per def (spot-check 5 defs); time determinism (same t → identical pixels). Agent: list_motion_shaders returns paper ids + collection filter; set_motion_shader_fill with a paper id round-trips; add_video_effect type shader validates shaderId. Web: pickers render group headers; video Effects panel adds shader effect. Gates: tsc 0×3; core motion 586+, web motion 261+, agent 445+ FULLY green.
Live visual: apply `paper-mesh-gradient` fill to a shape on stage (animated preview), keyframe one of its params, apply `paper-halftone-dots` as a shader effect on a text layer, render_motion_frame at two times → visibly different; phase 2: shader effect on a video clip in the editor preview.

## Risks

- **Sizing/vertex adaptation** is the load-bearing unknown: if their vertex shader can't be reused directly, fallback is per-shader `main()` coordinate shims — cap launch set to shaders that adapt cleanly rather than shipping broken visuals (the smoke test enforces this).
- **u_time unit mismatch** would make everything animate 1000× slow/fast — the adapter constant is verified against `shader-mount.js` and covered by the t=0-vs-t=1 pixel-difference test.
- **Uniform-array/texture uploads** are new renderer surface — type-driven upload keyed off `getActiveUniform` avoids guessing.
- **Perf**: Paper shaders are fragment-heavy; fills are frame-cached by `shaderId|WxH|time|params` already, and the RAM-preview cache absorbs playback cost.
- **ESM-only dep in core**: consumed via Vite/Vitest (both handle ESM); core has no node build step (raw TS source consumption per repo convention).
