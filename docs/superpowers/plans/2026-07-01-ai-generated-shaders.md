# AI-Generated Shaders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let AI author a new parameterized shader (GLSL + params) from a prompt, compile-validate it with a repair loop, register it into the live shader library at runtime, and persist it per-project — usable everywhere the built-in shaders are.

**Architecture:** Phase 1 (core + agent): a runtime-extensible shader registry (built-ins ∪ runtime), a GLSL validator (real compile in-browser + a headless contract check), per-project persistence via a new `project/registerGeneratedShader` action, and `create_ai_shader`/`list_ai_shaders`/`remove_ai_shader` MCP tools — so agent-driven generation works end to end. Phase 2 (UI): a `generateAiShader` service (user's configured provider + a category-specific authoring prompt + repair loop) and a "Generate shader" box in the shader galleries.

**Tech Stack:** TypeScript strict, WebGL2, Vitest + RTL, the existing `@openreel/agent` LLM stack.

## Global Constraints

- Do NOT git commit/add/stash/revert — leave changes in the working tree.
- NO line comments, NO docstrings. TS strict, NEVER `any`/unsafe casts. Validate inputs, guard nulls, fail fast, immutable updates.
- Reuse the existing `MotionShaderRenderer` for validation (no second GL context beyond a dedicated validation context) and the existing `@openreel/agent` `llm.ts`/web `llm-transport` for the LLM call — do NOT add a new provider client.
- Generated shader ids are namespaced `ai-<slug>-<shorthash>`; `registerMotionShader` MUST refuse to overwrite a built-in id.
- Generated defs carry `origin: "generated"`; built-ins are `"builtin"` (or undefined). A generated def is a normal `MotionShaderDef` (`id, name, category, glsl, params`).
- Shader authoring contract (the prompt + the validator enforce it): `#version 300 es`; `in vec2 vUv; uniform vec2 u_resolution; uniform float u_time; uniform float u_<param>; out vec4 fragColor;`; effect/text also declare `uniform sampler2D u_input;`; text also `uniform float u_progress;`; fills MUST NOT sample `u_input`; no unbounded loops.
- The generated runtime registry is cleared + rehydrated on project switch/close — never leak shaders across projects.
- Gate per task: core+web+agent `tsc --noEmit --ignoreDeprecations 6.0` → 0; the task's Vitest test green; `pnpm --filter @openreel/core test:run src/motion` no regressions.

**Execution note:** Phase 1 = Tasks 1–5, Phase 2 = Tasks 6–8. Task 1 (registry) and Task 2 (validator) touch disjoint files and can run in parallel; Task 3 needs Task 1; Task 4 needs 1+2+3; Task 6 needs 1+2+3; Task 7 needs 6. Task 5 gates Phase 1; Task 8 gates Phase 2.

---

### Task 1: Runtime-extensible shader registry

**Files:**
- Modify: `packages/core/src/motion/shaders/types.ts` (add `origin` to `MotionShaderDef`)
- Create: `packages/core/src/motion/shaders/registry.ts`
- Modify: `packages/core/src/motion/shaders/index.ts` (route `getMotionShaderDef` + category getters through the registry; export the registry API)
- Test: `packages/core/src/motion/shaders/registry.test.ts` (new)

**Interfaces — Produces:**
```ts
registerMotionShader(def: MotionShaderDef): void;      // throws if id collides with a built-in
unregisterMotionShader(id: string): void;
clearGeneratedMotionShaders(): void;
listGeneratedMotionShaders(): readonly MotionShaderDef[];
```
`MotionShaderDef` gains `readonly origin?: "builtin" | "generated";`. `getMotionShaderDef(id)` and `getMotionShaderFillDefs/EffectDefs/TextDefs` resolve over built-ins ∪ generated (generated filtered by category).

- [ ] **Step 1: Failing test** (`registry.test.ts`):
```ts
import { registerMotionShader, unregisterMotionShader, clearGeneratedMotionShaders, listGeneratedMotionShaders } from "./registry";
import { getMotionShaderDef, getMotionShaderFillDefs } from "./index";
const def = { id: "ai-test-1", name: "AI Test", category: "fill" as const, glsl: "x", params: [], origin: "generated" as const };
afterEach(() => clearGeneratedMotionShaders());
it("registers a runtime shader resolvable via getMotionShaderDef + category getters", () => {
  registerMotionShader(def);
  expect(getMotionShaderDef("ai-test-1")?.name).toBe("AI Test");
  expect(getMotionShaderFillDefs().some((d) => d.id === "ai-test-1")).toBe(true);
  expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual(["ai-test-1"]);
  unregisterMotionShader("ai-test-1");
  expect(getMotionShaderDef("ai-test-1")).toBeUndefined();
});
it("refuses to overwrite a built-in id", () => {
  expect(() => registerMotionShader({ ...def, id: "liquid-metal" })).toThrow();
});
```
- [ ] **Step 2: Run → fail. Step 3: Implement.** `registry.ts` holds a module-level `Map<string, MotionShaderDef>` for generated shaders; `registerMotionShader` guards `MOTION_SHADER_LIBRARY.some(d => d.id === def.id)` → throw `Error("Cannot overwrite built-in shader: " + def.id)`, else `set`. In `index.ts`, keep `MOTION_SHADER_LIBRARY` as the built-ins; change `getMotionShaderDef` to check built-ins then `generatedShaderById(id)`; change the category getters to `[...BUILTINS_OF_CATEGORY, ...listGeneratedMotionShaders().filter(d => d.category === cat)]`. Export the registry API through `index.ts` (and the motion barrel). Avoid an import cycle: `registry.ts` imports only the `MotionShaderDef` type + the built-in id set (put the built-in id guard data where it doesn't cycle — e.g. registry imports `MOTION_SHADER_LIBRARY` from index only if no cycle; otherwise pass the built-in ids in).
- [ ] **Step 4: Run → pass. Step 5: core tsc 0; full motion suite no regressions.** No commit.

---

### Task 2: GLSL validator

**Files:**
- Modify: `packages/core/src/motion/motion-shader-renderer.ts` (expose a compile-only validation entry)
- Create: `packages/core/src/motion/motion-shader-validator.ts`
- Test: `packages/core/src/motion/motion-shader-validator.test.ts` (new)

**Interfaces — Produces:**
```ts
validateMotionShaderSource(glsl: string, category: MotionShaderCategory):
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };
```

**Implementation:** First a headless CONTRACT check (works in jsdom): reject with a specific message when `glsl` lacks `#version 300 es`, lacks `out vec4 fragColor`, when `category !== "fill"` and it lacks `uniform sampler2D u_input`, when `category === "text"` and it lacks `uniform float u_progress`, or when `category === "fill"` and it references `u_input`. Then, if WebGL2 is available, a real COMPILE via `MotionShaderRenderer`: add a method `validateFragmentSource(glsl: string): { ok: true } | { ok: false; error: string }` that ensures the context, calls `gl.createShader(FRAGMENT_SHADER)` + `shaderSource` + `compileShader`, and on `!COMPILE_STATUS` returns `gl.getShaderInfoLog(shader) ?? "shader compile failed"` (delete the shader after). When `MotionShaderRenderer.isSupported()` is false (jsdom/headless), skip the compile and return `{ ok: true }` after the contract check passes. Use a single shared validation renderer instance in the validator module (dispose not required; it's tiny).

- [ ] **Step 1: Failing test:**
```ts
import { validateMotionShaderSource } from "./motion-shader-validator";
it("passes a contract-valid fill shader (compile skipped in jsdom)", () => {
  const glsl = "#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(vUv, 0.0, 1.0); }";
  expect(validateMotionShaderSource(glsl, "fill").ok).toBe(true);
});
it("rejects a fill shader that samples u_input", () => {
  const glsl = "#version 300 es\nin vec2 vUv;\nuniform sampler2D u_input;\nout vec4 fragColor;\nvoid main(){ fragColor = texture(u_input, vUv); }";
  const r = validateMotionShaderSource(glsl, "fill");
  expect(r.ok).toBe(false);
});
it("rejects an effect shader missing u_input and a text shader missing u_progress", () => {
  const noInput = "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(1.0); }";
  expect(validateMotionShaderSource(noInput, "effect").ok).toBe(false);
  const noProgress = "#version 300 es\nin vec2 vUv;\nuniform sampler2D u_input;\nout vec4 fragColor;\nvoid main(){ fragColor = texture(u_input, vUv); }";
  expect(validateMotionShaderSource(noProgress, "text").ok).toBe(false);
});
```
- [ ] **Step 2: Run → fail. Step 3: Implement. Step 4: pass. Step 5: core tsc 0.** No commit.

---

### Task 3: Per-project persistence + project action

**Files:**
- Modify: `packages/core/src/types/project.ts` (`Project` gains `generatedShaders`)
- Modify: `packages/core/src/types/actions.ts` (`ProjectAction` gains two variants)
- Modify: the project action executor (find it: `grep -rl "project/updateSettings" packages/core/src/actions`) — handle the two new actions immutably
- Modify: `packages/core/src/storage/project-serializer.ts` (normalize `generatedShaders` on import/export)
- Create: `packages/core/src/motion/shaders/project-shaders.ts` (`registerProjectGeneratedShaders(project)` load helper)
- Test: `packages/core/src/storage/project-serializer.test.ts` (extend) + `packages/core/src/motion/shaders/project-shaders.test.ts` (new)

**Interfaces — Consumes:** `registerMotionShader`/`clearGeneratedMotionShaders` (Task 1). **Produces:**
- `Project.generatedShaders?: readonly MotionShaderDef[]`.
- `ProjectAction |= { type: "project/registerGeneratedShader"; params: { def: MotionShaderDef } } | { type: "project/removeGeneratedShader"; params: { shaderId: string } }`.
- `registerProjectGeneratedShaders(project: Project): void` — `clearGeneratedMotionShaders()` then `registerMotionShader` each `project.generatedShaders`, skipping any that collide with a built-in (try/catch).

- [ ] **Step 1: Failing tests.** (a) `project-serializer`: a project with `generatedShaders: [validDef]` round-trips (import→export preserves it); a malformed def (missing glsl / bad category) is dropped. (b) `project-shaders`: `registerProjectGeneratedShaders({ generatedShaders: [def] })` makes `getMotionShaderDef(def.id)` resolve, and a second call with a different set clears the first.
- [ ] **Step 2: Run → fail. Step 3: Implement.** Add the field; in `project-serializer` add a `normalizeGeneratedShaders(value)` (validate id/name/category ∈ fill|effect|text/glsl string/params array of the `MotionShaderParamDef` shape; drop invalid) called in the importer and preserved in the exporter, mirroring `normalizeMotionComposition`. Add the two `ProjectAction` variants + executor handlers: `registerGeneratedShader` appends `def` to `project.generatedShaders` (immutably, dedupe by id) AND calls `registerMotionShader(def)`; `removeGeneratedShader` filters it out AND calls `unregisterMotionShader(shaderId)`. Implement `project-shaders.ts`.
- [ ] **Step 4: pass. Step 5: core tsc 0; full motion suite + storage suite no regressions.** No commit.

---

### Task 4: `create_ai_shader` / `list_ai_shaders` / `remove_ai_shader` MCP tools

**Files:**
- Modify: `packages/agent/src/registry.ts`
- Test: `packages/agent/src/registry.ai-shader.test.ts` (new)

**Interfaces — Consumes:** `validateMotionShaderSource` (Task 2), `registerMotionShader`/`listGeneratedMotionShaders`/`unregisterMotionShader` (Task 1), the `project/registerGeneratedShader`/`removeGeneratedShader` actions (Task 3) via `host.applyAction`. Reuses `resolveShaderParams`-style clamping and the `str`/`num`/`obj`/`ok`/`fail` helpers.

**Implementation:** `create_ai_shader` (domain `motion`): input `name, category, glsl, params` (params is an array of `{name,label,min,max,default,step,type?,control?}`). Handler: `host.requireOpenProject()`; validate `category ∈ {fill,effect,text}` else `fail(...,"INVALID_PARAMS")`; normalize/validate each param (coerce numbers, require name/label, default `type:"number"`) → `fail` on malformed; `const v = validateMotionShaderSource(glsl, category); if (!v.ok) return fail("Shader failed to compile: " + v.error, "INVALID_PARAMS");` (this is the repair signal the agent reads); build `MotionShaderDef` with a namespaced id (`ai-<kebab(name)>-<short hash of glsl>`), `origin:"generated"`; `await host.applyAction({ type: "project/registerGeneratedShader", id: genId(), timestamp: <from host if provided else 0>, params: { def } })`; return `ok("Created shader " + def.id, { shaderId: def.id, category })`. `list_ai_shaders` (readOnly): returns `listGeneratedMotionShaders()` shaped like `list_motion_shaders`. `remove_ai_shader`: `host.applyAction({ type:"project/removeGeneratedShader", params:{ shaderId } })`; `fail("NOT_FOUND")` if absent. Also: `list_motion_shaders` already reads the category getters (which now include generated) — confirm generated shaders appear there.

- [ ] **Step 1: Failing test** — `create_ai_shader` with a contract-valid fill GLSL → `ok`, `data.shaderId` namespaced `ai-`, and it appears in `list_ai_shaders` + `list_motion_shaders` fills. A fill GLSL that samples `u_input` → `fail` `INVALID_PARAMS` with a compile/contract error message. `remove_ai_shader` removes it. Invalid category → `INVALID_PARAMS`. Use the headless host + `executeTool` like `registry.text-shader.test.ts`.
- [ ] **Step 2-5:** fail → implement → pass → agent tsc 0. No commit.

---

### Task 5: Phase 1 verification

- [ ] **Step 1:** core+agent tsc → 0. **Step 2:** `pnpm --filter @openreel/core test:run src/motion` + core storage tests + `packages/agent` vitest (the new ai-shader test + existing shader tests) → all pass. **Step 3:** confirm no cross-project leak: a `project-shaders` test that switching projects clears the prior set. **Step 4:** record minors. No commit.

---

### Task 6: `generateAiShader` service + authoring prompt (Phase 2)

**Files:**
- Create: `apps/web/src/services/ai-shader.ts` (service + repair loop)
- Create: `apps/web/src/services/ai-shader-prompt.ts` (`buildShaderAuthoringPrompt(category)`)
- Test: `apps/web/src/services/ai-shader.test.ts` (new)

**Interfaces — Produces:**
```ts
generateAiShader(prompt: string, category: MotionShaderCategory, deps: {
  send: (messages: LlmMessage[]) => Promise<string>;   // injected LLM transport (testable)
  maxRepairs?: number;
}): Promise<{ ok: true; def: MotionShaderDef } | { ok: false; error: string }>;
buildShaderAuthoringPrompt(category: MotionShaderCategory): string;
```
Read `apps/web/src/services/agent/llm-transport.ts` + `settings-store` to see how the app builds an LLM `send` from the configured provider/model/key; the service takes `send` INJECTED (the caller — the UI in Task 7 — wires the real transport; tests pass a mock). This keeps the service pure/testable and avoids new provider plumbing.

**Implementation:** compose `buildShaderAuthoringPrompt(category)` (the exact contract from Global Constraints + "respond with ONLY strict JSON `{name, glsl, params:[{name,label,type:'number',min,max,default,step,control}]}`"). Loop up to `maxRepairs+1`: call `send([{role:'user', content: prompt + (lastError ? "\nThe previous attempt failed to compile:\n" + lastError + "\nReturn corrected JSON." : "") }])`; parse JSON (tolerate ```json fences — strip them; on parse failure treat as a repairable error); `validateMotionShaderSource(parsed.glsl, category)`; on `{ok:false}` set `lastError` and continue; on success build the `MotionShaderDef` (namespaced id, `origin:"generated"`, clamped params) and return it. After exhausting retries return `{ ok:false, error }`. The service does NOT persist — the caller registers + dispatches the project action (so persistence stays in one place).

- [ ] **Step 1: Failing test** (mock `send`):
```ts
it("returns a def when the model emits valid JSON", async () => {
  const glsl = "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(vUv,0.0,1.0); }";
  const send = async () => JSON.stringify({ name: "Foil", glsl, params: [] });
  const r = await generateAiShader("holographic foil", "fill", { send });
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.def.category).toBe("fill"); expect(r.def.origin).toBe("generated"); }
});
it("repairs after a compile/contract failure", async () => {
  const bad = "#version 300 es\nvoid main(){}";  // missing fragColor
  const good = "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(1.0); }";
  let n = 0; const send = async () => JSON.stringify({ name: "X", glsl: n++ === 0 ? bad : good, params: [] });
  const r = await generateAiShader("x", "fill", { send, maxRepairs: 1 });
  expect(r.ok).toBe(true);
});
it("fails after exhausting retries", async () => {
  const send = async () => JSON.stringify({ name: "X", glsl: "nonsense", params: [] });
  expect((await generateAiShader("x", "fill", { send, maxRepairs: 1 })).ok).toBe(false);
});
```
- [ ] **Step 2-5:** fail → implement → pass → web tsc 0; eslint clean. No commit.

---

### Task 7: Gallery "Generate shader" UI (Phase 2)

**Files:**
- Modify: `apps/web/src/motion/components/EffectsPanel.tsx` (Shaders gallery, `Section title="Shaders"` ~line 179)
- Modify: `apps/web/src/motion/components/PropertiesPanel.tsx` (fill + text shader pickers)
- Create: `apps/web/src/motion/components/GenerateShaderBox.tsx` (shared prompt box)
- Test: `apps/web/src/motion/components/GenerateShaderBox.test.tsx` (new)

**Implementation:** `GenerateShaderBox` (props `{ category, onGenerated: (def) => void }`): a text input + "Generate" button + inline status (generating / repairing / error). On submit it builds the real `send` from `settings-store` (provider/model/key) via the `llm-transport` (read the existing agent chat wiring for how a `send` is constructed; if no provider/key configured, show "Configure an AI provider in settings" and don't call). Calls `generateAiShader(prompt, category, { send })`; on `{ok:true}` it `registerMotionShader(def)` + dispatches `project/registerGeneratedShader` through the project store (mirror how motion tools/UI persist), then `onGenerated(def)` (the gallery selects/adds it). Generated cards render alongside built-ins (they already come from the category getters) with an "AI" marker (`def.origin === "generated"`). Add the box to the effect Shaders gallery and the fill/text shader pickers.

- [ ] **Step 1: Failing RTL test** — render `GenerateShaderBox` with a mocked generate path (inject or mock `generateAiShader`/transport), type a prompt, submit, assert `onGenerated` fires with a def and the "generating" state showed. Assert the "configure a provider" guard when no key. Use role-scoped queries.
- [ ] **Step 2-5:** fail → implement → pass → web tsc 0; eslint clean. No commit.

---

### Task 8: Integration verification + live visual

- [ ] **Step 1:** core+web+agent tsc → 0. **Step 2:** `pnpm --filter @openreel/core test:run src/motion`, core storage tests, `packages/agent` vitest, `apps/web && npx vitest run src/motion src/services` → all new tests pass; only the 2 known pre-existing `PropertiesPanel.scene3d.test.tsx` failures remain.
- [ ] **Step 3:** Live visual (dev server, Playwright, if a provider/key is configured): open the shader gallery, generate a fill shader from a prompt (e.g. "holographic foil"), confirm it compiles + registers + appears as an "AI" card + renders on a shape; reload and confirm it persisted with the project. 0 console errors. If no provider/key or the app can't launch, document that unit tests (incl. the mocked repair loop) fully cover the pipeline and mark the live gen a manual follow-up.
- [ ] **Step 4:** record minors for the final review.

---

## Self-Review

- **Spec coverage:** registry (T1), validator (T2), persistence+action (T3), tools (T4), Phase-1 gate (T5), service+prompt (T6), UI (T7), verify (T8) — matches spec §Architecture 1–6. ✓
- **Placeholders:** every task has interfaces + test code + concrete implementation direction (GLSL contract, action variants, repair loop); GLSL samples are literal. ✓
- **Type consistency:** `registerMotionShader`/`listGeneratedMotionShaders`/`unregisterMotionShader`/`clearGeneratedMotionShaders`, `MotionShaderDef.origin`, `validateMotionShaderSource`, `Project.generatedShaders`, `project/registerGeneratedShader`, `registerProjectGeneratedShaders`, `generateAiShader`/`buildShaderAuthoringPrompt` consistent across tasks; reuse `MOTION_SHADER_LIBRARY`, `MotionShaderRenderer`, `resolveShaderParams`, `settings-store`/`llm-transport`. ✓
- **Ordering:** T1∥T2 → T3 → T4 (Phase 1); T6 → T7 (Phase 2); gates T5/T8. ✓
