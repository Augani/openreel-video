# AI-Generated Shaders — Design

**Date:** 2026-07-01
**Status:** Design (pending user review)
**Branch:** feat/new-design-update
**Figma-gap sub-project:** 4 of 4 (AI-generate shaders) — the last one

## Problem

Figma Config-2026's headline is **AI-built parameterized shaders**: describe a look in words, get a working shader with tweakable params. OpenReel now has the full shader substrate (fill/effect/text libraries, `MotionShaderRenderer`, params, keyframing, MCP) — but the library is a fixed set of built-ins. There's no way to author a *new* shader from a prompt. This sub-project closes that: let AI generate a new shader (GLSL + param manifest), validate it, register it at runtime, and persist it with the project so it's usable everywhere the built-ins are.

## Goals

Generate a working, parameterized shader from a natural-language prompt, targeting a category (fill / effect / text), validated by real compilation with a repair loop, registered into the live library, and saved per-project. Two phases: (1) core + agent tool (generation works through the existing in-app AI agent); (2) a dedicated "Generate shader" box in the shader gallery.

## Non-Goals

- No shared/global or marketplace shader library (per-project only; global is a follow-up).
- No visual node editor or hand GLSL editor (AI-authored + param tweaking only).
- No server-side/GPU-worker shader compilation; validation is browser/renderer-side.
- No new LLM provider plumbing — reuse the existing `packages/agent/src/llm.ts` + web `settings-store`/`llm-transport`.

## Architecture

### 1. Runtime-extensible shader registry
`packages/core/src/motion/shaders/index.ts` currently exposes a static `MOTION_SHADER_LIBRARY`. Add a runtime registry (module-level, in `shaders/registry.ts`):
- `registerMotionShader(def: MotionShaderDef): void` (validates shape, dedupes by id, marks origin).
- `unregisterMotionShader(id: string): void`, `clearGeneratedMotionShaders(): void`, `listGeneratedMotionShaders(): readonly MotionShaderDef[]`.
- `getMotionShaderDef(id)` and the category getters (`getMotionShaderFillDefs`/`EffectDefs`/`TextDefs`) resolve over **built-ins ∪ runtime**.
- `MotionShaderDef` gains `readonly origin?: "builtin" | "generated"` (optional; built-ins omit or set "builtin", generated set "generated") so UI can label them and persistence can select them. A generated def is otherwise a normal `MotionShaderDef` (`id, name, category, glsl, params`) — nothing else to store.
- Generated ids are namespaced (e.g. `ai-<slug>-<shorthash>`) to avoid collisions with built-ins; `registerMotionShader` refuses to overwrite a built-in id.

### 2. GLSL validation
`packages/core/src/motion/motion-shader-validator.ts`: `validateMotionShaderSource(glsl: string, category: MotionShaderCategory): { ok: true } | { ok: false; error: string }`. Compiles the fragment shader via a `MotionShaderRenderer` (reusing its `compileShader`/link path — extract a `compileFragmentForValidation(glsl)` that returns the GL info-log on failure). Requires WebGL2: in a WebGL2 environment (browser/electron renderer) it truly compiles and returns the driver error log; where WebGL2 is unavailable (headless node) it returns `{ ok: true }` with the understanding that the renderer's existing null-fallback prevents breakage (a genuinely broken shader simply renders nothing). Also enforces the uniform/version contract by string-check before compile (`#version 300 es`, presence of `out vec4 fragColor`, and for effect/text that `u_input` is declared, for text that `u_progress` is declared) so obvious contract violations fail fast with a clear message even without a GPU.

### 3. Per-project persistence
`Project` (`packages/core/src/types/project.ts:25`) gains `readonly generatedShaders?: MotionShaderDef[]`. `project-serializer.ts` normalizes it (validate each def's shape/category/params; drop malformed) on import and includes it on export, mirroring `normalizeMotionComposition`. On project load, the app registers each via `registerMotionShader`; on generate, the new def is both registered and appended to `project.generatedShaders` (through the existing project-store update path). Switching/closing a project clears the generated registry and re-registers the incoming project's set, so runtime shaders never leak across projects.

### 4. `create_ai_shader` MCP tool (Phase 1)
`packages/agent/src/registry.ts`, domain `motion`. Input: `name: string, category: "fill"|"effect"|"text", glsl: string, params: Array<{name,label,type?,min,max,default,step,control?}>`. Handler: validate category + param shapes (clamp/normalize like `resolveShaderParams`); `validateMotionShaderSource(glsl, category)` → on `{ok:false}` return `fail(error, "INVALID_PARAMS")` **with the GL log in the message** so the agent can repair and retry; on success build a `MotionShaderDef` (namespaced id, `origin:"generated"`), `registerMotionShader`, append to the project's `generatedShaders` via the host, return `{ shaderId, category }`. Companions: `list_ai_shaders` (returns generated defs) and `remove_ai_shader` (unregister + drop from project). `list_motion_shaders` already returns built-ins by category; it now also includes generated defs. This makes agent-driven generation work end-to-end: the LLM authors GLSL+params and calls `create_ai_shader`; a compile error comes back; the agent fixes and retries (the repair loop is the agent itself).

### 5. `generateAiShader` service + shader-authoring prompt (Phase 2)
`apps/web/src/services/ai-shader.ts`: `generateAiShader(prompt: string, category, opts): Promise<{ ok: true; def: MotionShaderDef } | { ok: false; error: string }>`. Runs the user's configured provider/model (via `settings-store` + the existing `llm-transport`) with a **category-specific system prompt** stating the exact contract:
- fill: `#version 300 es`, `in vec2 vUv; uniform vec2 u_resolution; uniform float u_time; uniform float u_<param>; out vec4 fragColor;` — output color from `vUv`/params, NO `u_input`.
- effect / text: same + `uniform sampler2D u_input;` (sample the layer/glyph pixels); text also `uniform float u_progress;` (per-glyph 0..1).
- Ask for strict JSON `{ name, glsl, params:[{name,label,type:"number",min,max,default,step,control:"slider"|"number"}] }`; forbid unbounded loops; keep it performant.
Parse → `validateMotionShaderSource` → on error re-prompt with the GL log (bounded retries, e.g. 2) → on success `registerMotionShader` + persist. Returns the def or a user-facing error. Reuses the same registry/validator/persistence as the tool.

### 6. Gallery "Generate shader" UI (Phase 2)
In the shader galleries (`EffectsPanel` `Section title="Shaders"` at line 179; the fill/text shader pickers in `PropertiesPanel`), add a **Generate** affordance: a prompt input + (implicit) category → calls `generateAiShader` → shows a spinner/repair state → on success the new card appears in the gallery (marked "AI") and is immediately selectable; on failure shows the error. Generated shaders appear alongside built-ins in every picker via the runtime registry.

## Data Flow

prompt → LLM (category system prompt) → `{name,glsl,params}` → validate (compile) → [error → re-prompt with GL log, retry] → `MotionShaderDef{origin:"generated"}` → `registerMotionShader` → append to `project.generatedShaders` (persist) → appears in fill/effect/text pickers → usable + keyframeable like any shader. Agent path: same, but the LLM is the in-app agent and the validate/return-error/retry is mediated by `create_ai_shader`.

## Error Handling & Safety

- **Compile failure:** surfaced (tool `fail` with GL log; service returns error) and drives the repair loop; after max retries, a clear "couldn't generate a valid shader" result — never registers an invalid def.
- **Contract violation** (missing `#version`, `fragColor`, required uniforms): caught by the pre-compile string check with a specific message.
- **Runaway shader (GPU hang):** low risk (browser-sandboxed fragment shader, user's own prompt/GPU, no memory/data access). Mitigated by the existing `webglcontextlost` recovery in `MotionShaderRenderer` and the null-fallback (a failing render yields nothing, not a crash). Unbounded-loop discouragement is in the prompt; hard static analysis is a follow-up.
- **Cross-project leakage:** the generated registry is cleared + rehydrated on project switch.
- **Missing provider/key (Phase 2):** `generateAiShader` returns a clear "configure an AI provider in settings" error.

## Testing

- Registry: static∪runtime resolution; register/unregister/list; refuses to overwrite a built-in id; category getters include generated defs.
- Validator: valid GLSL → ok (in a WebGL2 test env or via the string-contract path in jsdom); malformed/missing-contract → `{ok:false}` with a message.
- Persistence: `project-serializer` round-trips `generatedShaders`, drops malformed; load registers them; project switch clears + rehydrates.
- `create_ai_shader` tool: happy path (valid → registered + in project + shows in `list_motion_shaders`); invalid category/params → `INVALID_PARAMS`; bad GLSL → error surfaced (contract-check path in jsdom).
- `generateAiShader`: with a **mocked llm transport** — success on first try; a compile-error-then-fixed repair sequence; exhausted-retries failure; missing-provider error.
- Live visual (browser): generate a real shader from a prompt (e.g. "holographic foil fill"), confirm it compiles, registers, appears in the picker, and renders on a shape; 0 console errors. Deferred-if-app-down like prior sub-projects.

## Risks

- **Validation only where WebGL2 exists.** The desktop-MCP node host can't truly compile-check; it registers optimistically (renderer null-fallback prevents breakage) and the agent loses the repair signal on that path. The web gallery box and web chat agent (both in-browser) validate fully. Real desktop renderer-side validation is a documented follow-up.
- **LLM GLSL quality varies.** The repair loop (re-prompt with the GL log) is the main mitigation; a small, contract-heavy system prompt improves first-try success.
- **Project bloat** if many shaders are generated — acceptable for v1 (they're small GLSL strings); pruning/`remove_ai_shader` is provided.

## Rollout / Phasing

Phase 1 (core + agent) is independently shippable and testable: registry + validator + persistence + `create_ai_shader`/`list`/`remove` tools. Phase 2 (service + gallery UI) layers on top. Uncommitted on `feat/new-design-update` (commit when the user asks). This completes the 4-part Figma-gap set.
