# Phase 0: App Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenReel's editing surface fully reachable through one undoable, serialized action seam with a plug-and-play action registry, a single capability manifest, a correct unified undo facade, headless-capable core, and `project` as the single source of truth — the prerequisites for the AI agent / MCP layer.

**Architecture:** Introduce an action-handler **registry** that the executor/validator/inverse-generator consult first (legacy `switch` as fallback), so new and migrated actions live in one place. Add the missing actions and persisted clip schema there. Build a typed **capability manifest**. Replace `project-store`'s tri-stack undo arbitration with a single timestamp-ordered **HistoryFacade**. Make the core run in pure Node. Migrate text/graphics/overlay state out of engine memory onto real timeline tracks so `project` is authoritative.

**Tech Stack:** TypeScript (strict), `@openreel/core` (pure TS, Vitest), `apps/web` (React + Zustand + Immer), pnpm workspaces, Vitest.

## Global Constraints

- TypeScript strict mode; avoid `any`; explicit return types on exported functions (project + global rules).
- NO inline comments / docstrings except on public API needing them (global rule).
- Conventional Commits (`feat:`/`fix:`/`refactor:`/`test:`); frequent, focused commits.
- Behavior-preserving refactors MUST keep the existing suite green: `pnpm --filter @openreel/core test:run` (baseline: `src/actions/action-executor.test.ts` = 27 passing).
- Time units in the project model are **seconds (float)**.
- `Action` shape is `{ readonly type: string; readonly id: string; readonly timestamp: number; readonly params: Record<string, unknown> }` (`packages/core/src/types/actions.ts:15`).
- `ActionResult` is `{ readonly success: boolean; error?: ActionError; warnings?: string[]; actionId?: string }`.
- Run `pnpm --filter @openreel/core typecheck` (and `pnpm typecheck` for web-touching tasks) before each commit; fix all errors/warnings.
- Cross-platform JSON schema parity: any new persisted `Clip`/`Timeline` field is part of the shared iOS/Android schema — additive + optional only.

## Execution order (dependency-sequenced)

1. **WS1 — Type-soundness** (no behavior change): add executor-handled clip ops to the typed union.
2. **WS2 — Action registry** (registry-first, switch fallback).
3. **WS3 — New actions + persisted schema** (speed, reverse, stabilization, chroma-key, speed-ramp/freeze) via the registry.
4. **WS4 — Capability manifest + enum consolidation**.
5. **WS5 — Quick-win wiring** (route `project-store` bypass methods through actions).
6. **WS6 — Headless core + Node-compat + `requireOpenProject`**.
7. **WS7 — HistoryFacade** (single ordered undo/redo; fix redo asymmetry).
8. **WS8 — Overlays → timeline** (text/shape/SVG/sticker become real clips; engines stateless). Largest; depends on WS2/WS3.
9. **WS9 — Engine-feature persistence** (adjustment/nested/multicam/mask/motion).
10. **WS10 — `project-store` slicing** (incremental; non-blocking).

---

## WS1 — Type-soundness: complete the `ClipAction` union

**Context:** The executor already handles `clip/merge`, `clip/slip`, `clip/slide`, `clip/roll`, `clip/trimToPlayhead`, `clip/closeGapBefore`, `clip/duplicate`, `clip/consolidate`-style ops, but the typed `ClipAction` union in `types/actions.ts` stops at `clip/setColorGrading`. Callers cast through the loose `Action` base, which is a type-unsound footgun for the agent. This task adds the missing members with their real param shapes (read from the executor cases) — pure types, zero runtime change.

**Files:**
- Modify: `packages/core/src/types/actions.ts` (ClipAction union)
- Test: `packages/core/src/actions/action-types.test.ts` (new — compile-time + dispatch smoke)

**Interfaces:**
- Produces: typed members `clip/merge`, `clip/slip`, `clip/slide`, `clip/roll`, `clip/trimToPlayhead`, `clip/closeGapBefore`, `clip/duplicate` on `ClipAction`. Param shapes must match the executor's destructuring exactly.

- [ ] **Step 1: Read the executor cases to get exact param shapes.** Grep `action-executor.ts` for each `case "clip/slip"` etc.; record the `params` keys each reads.

Run: `grep -n 'case "clip/' packages/core/src/actions/action-executor.ts`

- [ ] **Step 2: Write a test that constructs each action with its typed params and dispatches it.**

```ts
import { describe, it, expect } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { ClipAction } from "../types/actions";
// build a minimal project with two adjacent clips on one track (reuse the
// helper pattern from action-executor.test.ts)
describe("ClipAction union completeness", () => {
  it("typechecks and dispatches slip/slide/roll/merge/trimToPlayhead/closeGapBefore", async () => {
    const slip: ClipAction = { type: "clip/slip", params: { clipId: "c1", delta: 0.5 } };
    expect(slip.type).toBe("clip/slip");
    // dispatch through executor against a fixture project; assert success
  });
});
```

- [ ] **Step 3: Run the test — expect FAIL** (TS error: members not in union).

Run: `pnpm --filter @openreel/core exec vitest run src/actions/action-types.test.ts`

- [ ] **Step 4: Add the members to `ClipAction`** with the exact param shapes confirmed in Step 1 (e.g. `| { type: "clip/slip"; params: { clipId: string; delta: number } }`, etc.). Do NOT guess — copy from the executor.

- [ ] **Step 5: Run the new test + the full action suite — expect PASS, 27 prior tests still green.**

Run: `pnpm --filter @openreel/core test:run src/actions/`

- [ ] **Step 6: typecheck + commit.**

```bash
pnpm --filter @openreel/core typecheck
git add packages/core/src/types/actions.ts packages/core/src/actions/action-types.test.ts
git commit -m "refactor(core): complete ClipAction union with executor-handled ops"
```

---

## WS2 — Action-handler registry (registry-first, switch fallback)

**Context:** Adding an undoable op today means editing 4 files (executor switch, validator switch, inverse generator, type union) with no compiler sync. Introduce a registry mapping `ActionType → { apply, validate, invert }`. The executor/validator/inverse consult the registry first and fall back to their existing `switch` for unmigrated types. New/migrated actions then live in ONE place. This is incremental and behavior-preserving — the existing suite is the guard.

**Files:**
- Create: `packages/core/src/actions/registry.ts`
- Create: `packages/core/src/actions/handlers/clip-speed.ts` (first registry handlers, used by WS3 — created empty/registered here only if convenient; otherwise WS3)
- Modify: `packages/core/src/actions/action-executor.ts` (route `execute` through registry first)
- Modify: `packages/core/src/actions/action-validator.ts` (route `validate` through registry first)
- Modify: `packages/core/src/actions/inverse-action-generator.ts` (route generation through registry first)
- Test: `packages/core/src/actions/registry.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ActionContext { /* whatever execute() already passes: project, helpers */ }
export interface ActionHandler<P = Record<string, unknown>> {
  readonly type: string;
  apply(project: Project, params: P, ctx: ActionContext): ActionResult | Promise<ActionResult>;
  validate(project: Project, params: P): ValidationResult;
  invert(project: Project, params: P, ctx: ActionContext): Action | null;
}
export function registerActionHandler(h: ActionHandler): void;
export function getActionHandler(type: string): ActionHandler | undefined;
export function listRegisteredActionTypes(): string[];
```
- Consumed by: executor `execute()`, validator `validate()`, inverse generator — each does `const h = getActionHandler(action.type); if (h) return h.<fn>(...); /* else legacy switch */`.

- [ ] **Step 1: Read `execute()`, `validate()`, and the inverse entry points** to learn the exact context each passes (project mutation contract, helper utilities, sync/async). Record signatures.

Run: `grep -n 'execute\|validate\|generateInverse\|class ActionExecutor\|class ActionValidator' packages/core/src/actions/action-executor.ts packages/core/src/actions/action-validator.ts packages/core/src/actions/inverse-action-generator.ts | head -40`

- [ ] **Step 2: Write `registry.test.ts`** — register a dummy handler, dispatch it through the executor, assert apply/validate/invert all route to the handler; assert a non-registered type still uses the legacy switch (e.g. `clip/add` still works).

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerActionHandler, getActionHandler } from "./registry";
describe("action registry", () => {
  it("registers and resolves a handler", () => {
    registerActionHandler({ type: "test/noop", apply: () => ({ success: true }), validate: () => ({ valid: true, errors: [] }), invert: () => null });
    expect(getActionHandler("test/noop")?.type).toBe("test/noop");
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (registry module missing).

- [ ] **Step 4: Implement `registry.ts`** (a module-level `Map`, the three functions, the interfaces above).

- [ ] **Step 5: Wire executor/validator/inverse to consult the registry first**, falling back to the existing switch. Keep mutation/clone semantics identical.

- [ ] **Step 6: Run the FULL action suite — expect all green (27 + new).** Any regression means the registry path changed behavior; fix until identical.

Run: `pnpm --filter @openreel/core test:run src/actions/`

- [ ] **Step 7: typecheck + commit.**

```bash
pnpm --filter @openreel/core typecheck
git add packages/core/src/actions/registry.ts packages/core/src/actions/registry.test.ts packages/core/src/actions/action-executor.ts packages/core/src/actions/action-validator.ts packages/core/src/actions/inverse-action-generator.ts
git commit -m "feat(core): add action-handler registry consulted before legacy switch"
```

---

## WS3 — New actions + persisted schema (speed / reverse / stabilization / chroma-key / speed-ramp)

**Context:** Speed, reverse, stabilization, chroma-key, and speed-ramp/freeze are currently written via raw `setState` in inspector components or held in engine Maps — not undoable, not (for ramp/freeze/chroma) serialized. Add them as registry handlers (WS2) and add the missing persisted `Clip` fields. `speed`/`reversed`/`stabilization` fields already exist (`types/timeline.ts:100-111`); add `speedKeyframes`, `freezeFrames`, `pitchCorrection`, `chromaKey`.

**Files:**
- Modify: `packages/core/src/types/timeline.ts` (new optional `Clip` fields)
- Create: `packages/core/src/actions/handlers/{clip-speed,clip-stabilization,clip-chromakey,speed-ramp}.ts`
- Modify: `packages/core/src/types/actions.ts` (typed members for the new actions)
- Modify (web, later sub-steps): `apps/web/src/components/editor/inspector/{SpeedSection,SpeedRampSection,StabilizationSection,GreenScreenSection}.tsx` (dispatch actions instead of raw setState)
- Modify (engines): `packages/core/src/video/{speed-engine,chroma-key-engine}.ts` (read settings from clip, not internal Map)
- Test: `packages/core/src/actions/handlers/*.test.ts`

**Interfaces:**
- Produces actions: `clip/setSpeed` `{clipId, speed, affectAudio?}`, `clip/setReverse` `{clipId, reversed}`, `clip/setStabilization` `{clipId, stabilization}`, `clip/setChromaKey` `{clipId, chromaKey}`, `speed/setRamp` `{clipId, keyframes}`, `speed/setFreezeFrames` `{clipId, freezeFrames}`.
- Produces `Clip` fields: `readonly speedKeyframes?: SpeedKeyframe[]`, `readonly freezeFrames?: FreezeFrame[]`, `readonly pitchCorrection?: boolean`, `readonly chromaKey?: ChromaKeySettings`.

Per-action TDD cycle (repeat for each): write a failing handler test (apply mutates the right clip field + returns success; validate rejects bad params; invert restores prior value) → run (FAIL) → implement the handler + register it + add the typed action member + add the `Clip` field if needed → run (PASS) → wire the inspector component to dispatch the action and delete the raw `setState` → typecheck → commit. Migrate `SpeedEngine`/`ChromaKeyEngine` to read from the clip (delete the internal authoritative Map) and add a serialization round-trip test (save→load preserves ramp/freeze/chroma).

(Detailed code per handler is produced at execution time from the read of each engine + component; each is a small, self-contained S/M task following the cycle above. Acceptance: every speed/stabilization/chroma op is an undoable action and survives save/reload.)

---

## WS4 — Capability manifest + enum consolidation

**Context:** Enums are duplicated (`BlendMode` ×5, filter-type ×3, transition-type ×2, subtitle presets divergent) and color-grading param ranges are comments-only. A `get_capabilities` tool needs one typed, machine-readable manifest. Model it on `types/effects.ts:49 EFFECT_DEFINITIONS`.

**Files:**
- Create: `packages/core/src/capabilities/manifest.ts`
- Modify: the duplicate enum definition sites to re-export from canonical homes
- Test: `packages/core/src/capabilities/manifest.test.ts`

**Interfaces:**
- Produces: `export const CAPABILITY_MANIFEST` with sections `{ blendModes, filters, transitions, easings, speedPresets, subtitlePresets, shapeTypes, colorGrading, effects }`, each enum canonical and each parameter carrying `{ min, max, step, default, unit? }` where applicable. `export type CapabilityManifest = typeof CAPABILITY_MANIFEST`.

- [ ] **Step 1: Inventory duplicate enum sites.** `grep -rn "type BlendMode\|BlendMode =\|FilterType\|TransitionType" packages/core/src apps/web/src`
- [ ] **Step 2: Write `manifest.test.ts`** asserting: all enum arrays non-empty; every effect with numeric params exposes `min<max`, `step>0`, `default` within range; no duplicate canonical enum diverges.
- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement `manifest.ts`**, importing canonical enums; convert color-grading comment ranges to data.
- [ ] **Step 5: Consolidate duplicates** — pick one canonical export per enum; replace the others with re-exports; fix imports.
- [ ] **Step 6: Run manifest test + full core suite + typecheck — PASS.**
- [ ] **Step 7: Commit** `feat(core): add machine-readable capability manifest + consolidate enums`.

---

## WS5 — Quick-win wiring (route store bypass methods through actions)

**Context:** `reorderVideoEffects` (`project-store.ts:5655`), `updateClipKeyframes` (`:6125`), `removeSubtitle` (`:4760`), `updateSubtitle` (`:4777`), `applySubtitleStylePreset` (`:4855`) mutate via bare `set()` though executor actions exist (`effect/reorder`, `keyframe/*`, `subtitle/remove`, `subtitle/update`, `subtitle/setStyle`). Route each through `executeAction(createAction(type, params))` so they record undo. Low risk, independent.

**Files:**
- Modify: `apps/web/src/stores/project-store.ts` (the 5 methods)
- Test: `apps/web/src/stores/project-store.<area>.test.ts` (add/extend)

Per-method cycle: write/extend a test asserting the method dispatches the action and is undoable (history length increments; `undo()` reverts) → run (FAIL) → replace the bare `set()` body with `get().executeAction(createAction(type, params))` → run (PASS) → typecheck → commit. Keep the public method signature unchanged.

---

## WS6 — Headless core + Node-compat + `requireOpenProject`

**Context:** Module-load `coreTitleEngine.initialize()` (`engine-store.ts:186`) and unguarded `new AudioContext()` (`audio-engine.ts:144`) crash in Node; edits silently mutate a throwaway project when none is open. Make the action system + project model run in pure Node and add a guard.

**Files:**
- Modify: `packages/core/src/audio/audio-engine.ts` (lazy/guarded `AudioContext`)
- Modify: `apps/web/src/stores/engine-store.ts` (defer module-load engine init behind `typeof window`)
- Modify: any `OffscreenCanvas`/`document`/`navigator` module-load use in the core data path
- Modify: `apps/web/src/stores/project-store.ts` (`requireOpenProject()` guard returning `ActionResult{success:false}`)
- Create: `packages/core/src/actions/headless.node.test.ts` (runs in Node env, no jsdom)

**Interfaces:**
- Produces: a pure-Node-safe import graph for `@openreel/core` actions + types; `requireOpenProject()` on the store.

- [ ] **Step 1: Write a Node-environment test** (`// @vitest-environment node`) that imports `ActionExecutor`, builds a project, applies ≥10 actions across domains, undoes/redoes, serializes — asserting no throw.
- [ ] **Step 2: Run — expect FAIL** (browser-API crash at import/exec). Record the first crashing module.
- [ ] **Step 3: Guard each crashing browser API** with `typeof window !== "undefined"` / lazy init; re-run; repeat until green.
- [ ] **Step 4: Add `requireOpenProject` guard**; test that a mutating action with no open project returns `{success:false}` instead of mutating.
- [ ] **Step 5: Full suite + typecheck — PASS. Commit** `feat(core): make action core headless/Node-safe + guard no-open-project`.

---

## WS7 — HistoryFacade (single ordered undo/redo)

**Context:** `project-store.undo()` (`:3729`) arbitrates by newest timestamp across `actionHistory`/`clipUndoStack`/`templateUndoStack`, but `redo()` (`:3943`) uses fixed priority → interleaved redo replays in the wrong order. Replace with a single timestamp-ordered facade over discriminated entries; `redo` mirrors `undo` exactly. Core `ActionHistory` already has `beginGroup`/`endGroup`/`undoGroup`/`redoGroup` to reuse.

**Files:**
- Create: `apps/web/src/stores/project/history-facade.ts`
- Modify: `apps/web/src/stores/project-store.ts` (`undo`/`redo`/`canUndo`/`canRedo`/history-panel selectors route through the facade)
- Modify: HistoryPanel component (show all entry kinds)
- Test: `apps/web/src/stores/project/history-facade.test.ts`

**Interfaces:**
- Produces:
```ts
type HistoryKind = "action" | "clip" | "template";
interface FacadeEntry { kind: HistoryKind; timestamp: number; apply(): void | Promise<void>; revert(): void | Promise<void>; label: string; groupId?: string; }
class HistoryFacade {
  record(e: FacadeEntry): void;
  undo(): Promise<void>; redo(): Promise<void>;
  canUndo(): boolean; canRedo(): boolean;
  beginGroup(label: string): void; endGroup(): void;
  list(): FacadeEntry[];
}
```

- [ ] **Step 1: Write a failing test reproducing the redo bug** — interleave an action edit and a clip-snapshot edit, undo both, redo both, assert the project matches the pre-undo state (today this FAILS due to redo ordering).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `HistoryFacade`** — single timestamp-ordered list; `undo` pops newest, `redo` pushes back symmetrically; group support delegating to `ActionHistory.begin/endGroup` for action entries.
- [ ] **Step 4: Route store `undo/redo/canUndo/canRedo`** + selectors through the facade.
- [ ] **Step 5: Run the bug test + existing undo tests — PASS.** Add group test (begin→2 edits→end→one undo reverts both).
- [ ] **Step 6: typecheck (web) + commit** `fix(web): unify undo/redo via HistoryFacade and correct redo ordering`.

---

## WS8 — Overlays → timeline (text/shape/SVG/sticker become real clips)

**Context (largest, depends on WS2/WS3):** Text/shape/SVG/sticker clips are authoritative in `TitleEngine.textClips` / `GraphicsEngine.*Clips` Maps; correct state only via `getFullProject()`. `Track.type` already allows `"text"`/`"graphics"`, so overlay tracks exist in the type — the data must move into them. Make `project` authoritative; engines become stateless renderers (like `ColorGradingEngine`).

**Files:**
- Modify: `packages/core/src/types/timeline.ts` (overlay clip representation — extend `Clip` or add overlay-specific fields under `metadata`/a typed payload)
- Modify: `packages/core/src/text/title-engine.ts`, `packages/core/src/graphics/graphics-engine.ts` (read from project clips; stop owning state)
- Create: registry handlers for overlay create/update/remove (`text/*`, `graphics/*`) replacing the engine-only store methods
- Modify: `apps/web/src/stores/project-store.ts` (`createTextClip`/`updateText*`/`createShapeClip`/`importSVG`/`createStickerClip` route through actions; remove `getFullProject` merge special-casing — `getFullProject() === project`)
- Modify: `packages/core/src/storage/project-serializer.ts` (overlays serialize with the timeline; migration for old projects)
- Modify: `apps/web/src/components/editor/Timeline.tsx:569-728` (overlay trim/move use the media `trimClip`/`moveClip` path)
- Test: serialization round-trip; overlay action handlers; migration of a legacy fixture

**Approach (TDD, staged to keep green):**
1. Define the on-timeline overlay clip shape (additive, optional, schema-parity-safe). Write a round-trip test (create text clip → serialize → deserialize → identical) — FAIL.
2. Add `text/*` + `graphics/*` registry handlers that mutate `project.tracks[].clips`; make store creators dispatch them.
3. Make `TitleEngine`/`GraphicsEngine` render from the project clips (stateless); delete the authoritative Maps.
4. Update serializer + add a versioned migration that reads legacy engine-Map-persisted overlays into timeline clips. Migration test on a legacy fixture.
5. Collapse `getFullProject()` to return `project`; remove merge sites (`project-store.ts:494/4272`).
6. Unify overlay trim/move in `Timeline.tsx` with the media path.
7. Full suite + web typecheck + manual save/reload check — PASS.

Each numbered step is its own commit. This is the highest-risk workstream — do it last among hard prerequisites, after WS2/WS3 give a clean action path, and lean on the round-trip + migration tests as the guard.

---

## WS9 — Engine-feature persistence (adjustment / nested / multicam / mask / motion)

**Context:** Adjustment layers / nested sequences / multicam / mask / motion presets are reachable via engine getters but only bump `modifiedAt`; settings live in engine singletons, not the project. Add store methods + registry actions that mutate `project` AND drive the engine, persisting settings to the clip/project.

Per feature (independent S/M tasks): add the persisted field(s) → add a registry action handler → store method dispatches it + syncs the engine → serialization round-trip test → commit. Files: `apps/web/src/components/editor/inspector/{AdjustmentLayerSection,NestedSequenceSection,MultiCameraPanel,MaskSection}.tsx`, the corresponding engines, `types/timeline.ts`.

---

## WS10 — `project-store` slicing (incremental, non-blocking)

**Context:** `project-store.ts` is 6,152 lines. The abandoned `stores/project/` slice dir should be finished: `mediaSlice`, `trackSlice`, `clipSlice`, `historySlice`, `textGraphicsSlice`. Non-blocking; do incrementally after the agent can already bind to the current methods. Each slice extraction is its own commit with the full web suite as guard. Defer unless time allows.

---

## Implementation Status (2026-06-18)

**Foundation complete and tested (9 commits; 334 core + 57 web tests green; web typecheck clean; dev server boots clean):**
- ✅ WS1 — `ClipAction` union completed (`f73788f`)
- ✅ WS2 — action-handler registry (`d89a1ff`)
- ✅ WS3-core — speed/reverse/stabilization/chroma/ramp actions + persisted schema (`da51d0d`)
- ✅ WS4 — capability manifest + const-backed enum dedup (`88ff4fd`)
- ✅ WS5 — effect/setOrder, keyframe/setAll, subtitle/replace actions (`314c3ba`); UI store-method rewiring deferred (sync→async, no agent impact)
- ✅ WS6-core — headless Node-safety proven (`bda099c`)
- ✅ WS6-web — `requireOpenProject` guard (`796ce4b`)
- ✅ WS8-core — project-authoritative overlay actions text/shape/svg/sticker create/update/remove (`055b54d`)

- ✅ WS8-web — overlays (text/shape/svg/sticker) are project-authoritative with unified action undo; engines reseeded from `project.*Clips` on undo/redo; per-edit `clipUndoStack` writes removed for overlays (`c2c2946`, `5035815`).
- ✅ WS3-web — Stabilization (`3e2a9c6`), Speed/Reverse (`4a2a13f`), Chroma-key persistence fix (`8c5768d`), Speed-ramp persistence (`07b8c11`): inspector raw-setState replaced with undoable actions; engines reseeded on undo/redo.
- ✅ WS5 — reorderVideoEffects/updateClipKeyframes/removeSubtitle/updateSubtitle/applySubtitleStylePreset routed through actions (`598e44f`).
- ✅ WS7 — redo journal fixes redo-ordering asymmetry (`377d0b7`); combined with WS8-web's clipUndoStack removal, clip/overlay undo is unified.
- ✅ WS9 — adjustment layers (`4cb009f`), masks (`528b947`), multicam + nested sequences (`8876160`) persist to project + undoable + engines reseeded on undo/redo/load. Motion presets already persist via clip keyframes/transform (covered by WS5).

- ✅ WS10 — project-store slicing COMPLETE. All 5 plan-named slices extracted into `stores/project/`: **mediaSlice, trackSlice, clipSlice, historySlice, text-graphics(textGraphics)Slice**, plus marker + subtitle slices and a shared `store-helpers` factory (clone/recordOverlay*/syncOverlayEngines/applyClipDataSnapshot). The Zustand slice pattern (`createXSlice(set, get[, helpers|deps])` composed in the store) is established and applied. History's bridge-sync + editing-template-state closures are passed as `deps`. `project-store.ts` reduced **6,311 → 3,785 lines (~40%)**. Each extraction verified (62 web store tests + 334 core tests green, web typecheck clean, editor 0 console errors) and committed atomically (commits `…` through clip-slice). Remaining in-store methods are the un-named domains (effects/color/audio/transition/template/photo/export/auto-save) which can be sliced further incrementally.

**Phase 0 outcome:** WS1–WS9 complete and verified (334 core + 62 web store tests green; web typecheck clean; editor boots with 0 console errors). The agent/MCP layer (Phase 1) is fully unblocked — every editing capability is reachable through undoable, serializable, project-authoritative actions, headlessly, with a capability manifest.

**Verified scope note:** the overlay-lifecycle map (subagent, this session) showed WS8 is larger than the audit implied — overlays live authoritatively in `titleEngine`/`graphicsEngine` Maps (plus a parallel `graphics-bridge` Map set), the render path reads engines, the Timeline filters overlays out of `track.clips` and draws them from engines, and subtitles route through `createTextClip`. The chosen low-risk migration keeps engines as render caches synced from the now-authoritative `project.*Clips`, so the render path is untouched while `project` becomes the source of truth.

## Self-review notes
- **Spec coverage:** WS1–WS10 map to spec §4 W0.1 (WS8), W0.2 (WS2), W0.3 (WS1+WS3), W0.4 (WS7), W0.5 (WS4), W0.6 (WS6), W0.7 (WS5), W0.8 (WS9), W0.9 (WS10).
- **Sequencing:** registry (WS2) precedes new actions (WS3) and overlay migration (WS8); manifest (WS4) precedes nothing hard but feeds the agent layer; HistoryFacade (WS7) is independent of WS8 but cleaner after it (clip entries fold into actions) — kept before WS8 to fix the correctness bug early, with WS8 simplifying it further.
- **Acceptance (Phase 0 done):** save/reload preserves all overlay/speed/chroma state from `project` alone; every capability has an undoable action; interleaved undo/redo correct; pure-Node script applies all-domain edits with no crash; `CAPABILITY_MANIFEST` exposes ranges; `pnpm typecheck` + `pnpm --filter @openreel/core test:run` + web tests green.
