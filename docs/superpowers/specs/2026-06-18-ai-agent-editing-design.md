# AI Agent Video Editing — Design Spec

- **Date:** 2026-06-18
- **Status:** Design (architecture approved; pending spec review)
- **Surfaces:** Web app (`apps/web`), Desktop app (`apps/desktop`), shared core (`packages/core`), cloud (`apps/cloud`)
- **Goal:** Let users edit their OpenReel projects by chatting with an AI agent of their choice (BYOK). Built-in chat on web and desktop; desktop additionally exposes an MCP server so external agents (Claude Desktop, Cursor, Cline, …) can drive the editor; a headless/cloud agent can edit projects with no app open. The agent has near-unlimited reach over the editing surface — everything a professional editor can do.

## Resolved decisions (driving this design)
1. **Surfaces:** built-in BYOK chat on web + desktop (one chat UI; desktop reuses the web app) **plus** a desktop MCP server (stdio **and** HTTP) for external agents.
2. **Tool surface:** ~40 curated domain tools **+ a generic `execute_action` escape hatch** + compact read tools (nothing off-limits, but discoverable and token-efficient).
3. **Safety:** every agent turn is one undoable unit; destructive/expensive ops are confirm-gated; dry-run available.
4. **Text/graphics source-of-truth:** **move overlays onto real timeline tracks**; engines become stateless renderers; `project` is authoritative.
5. **Execution model:** **live editor host AND headless/server-side host** (the `EditingHost` abstraction). Full Node-compat is therefore a Phase-0 hard prerequisite.
6. **Editor scope:** **video editor only** (`apps/web` + the action system). The image editor (`apps/image`, separate command pattern) is out of scope; revisit later.
7. **Completeness:** programmatic completeness of existing features first; verified competitive gaps are a later backlog.

---

## 1. Summary

OpenReel already implements the entire video-editing surface — ~140 store methods plus a typed, namespaced, serializable, **undoable** JSON action system (`packages/core/src/actions/`). Four capability families (video effects, color grading, transitions, core subtitles) already prove the target pattern: **data is the source of truth → edits flow through actions → the engine is a stateless renderer.** No new editing capability is required for the agent itself.

However, a verified readiness audit (8 auditors + 4 adversarial verifiers) found the app is **not yet plug-and-play**. Three classes of problem would make an agent silently lose edits, desync history, or read wrong state:
- **Unsound read path:** text/shape/SVG/sticker clips are authoritative in engine memory (`TitleEngine.textClips`, `GraphicsEngine.*Clips` Maps), not in `project`. `store.project` returns stale data; naive save drops overlays.
- **Undo/redo bug:** `undo()` arbitrates by newest timestamp, `redo()` by fixed priority — interleaved edits replay redo in the wrong order (`project-store.ts:3729` vs `3943`).
- **Unreachable capabilities:** speed, speed-ramp/freeze-frame (not serialized at all), stabilization, chroma-key are written via raw `setState` in React components or trapped in engine Maps; nine more store methods bypass existing actions and escape undo; slip/slide/roll aren't in the typed action union.

Plus structural gaps that block "plug-and-play" extension: no action-handler **registry** (adding an op edits 4 files with no compiler sync), scattered enums (`BlendMode` defined 5×), and a headless bootstrap that hard-crashes in Node.

The plan therefore starts with **Phase 0: App Readiness** — surgical, moderate refactoring that pulls stragglers onto the proven action seam, makes `project` authoritative, builds the registry + capability manifest, fixes undo, and makes the core run headless. Then the agent layer (registry, host abstraction, loop), then web chat, desktop MCP, and the cloud/headless agent.

The only reusable LLM plumbing today is the BYOK proxy (`apps/web/src/services/api-proxy.ts` + `apps/web/functions/api/proxy/[[catchall]].ts`, keys never persisted) and the single-completion Anthropic/OpenAI pattern in `enhanceViaLlm` (`useElevenLabsApi.ts:212`). There is **no** agent, MCP, tool-use, or chat code in the repo.

---

## 2. Architecture

```
                packages/agent  (NEW, platform-agnostic, no UI, no store deps)
                ├─ registry/     tool DEFINITIONS generated from the core CAPABILITY_MANIFEST
                │                (name, JSON schema, domain, destructive/expensive/readOnly)
                ├─ loop/         provider-agnostic agent (tool-use) loop runtime
                ├─ llm/          LLMClient interface + Anthropic/OpenAI adapters
                ├─ host/         EditingHost INTERFACE + ToolExecutor (binds tools → host)
                ├─ serialize/    compact project/timeline serializers (read tools)
                └─ types/        ToolCall, ToolResult, AgentEvent, TurnHandle
                                        ▲
                  ┌─────────────────────┼──────────────────────────────┐
                  │                     │                              │
        implements EditingHost   implements EditingHost        implements EditingHost
                  │                     │                              │
   ┌──────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐
   │ LiveEditorHost        │  │ LiveEditorHost (desktop)│  │ HeadlessHost (Node)      │
   │ apps/web renderer     │  │ same renderer, reached  │  │ apps/cloud / CLI         │
   │ project-store dispatch │  │ via openreel:agent IPC  │  │ core action system +     │
   │ + preview + undo       │  │ from the MCP server     │  │ headless history;        │
   └──────────────────────┘  └────────────────────────┘  │ load/save via storage;   │
            ▲                          ▲                   │ render/export/transcribe │
            │ in-process               │ MCP (stdio+HTTP)  │ via GPU worker           │
   ┌────────────────┐         ┌────────────────────┐      └──────────────────────────┘
   │ WEB chat panel │         │ External MCP client │                ▲
   │ BYOK loop      │         │ (Claude Desktop,    │       ┌──────────────────┐
   └────────────────┘         │  Cursor, Cline, …)  │       │ Cloud agent /     │
   ┌────────────────┐         └────────────────────┘       │ automation        │
   │ DESKTOP chat   │                                       └──────────────────┘
   │ (web app reuse)│
   └────────────────┘
```

**One tool layer, one loop, three hosts.** Tools are defined once (generated from the core capability manifest) and executed through the `EditingHost` interface; whoever implements that interface (live renderer, or headless Node) gets the full agent for free. Desktop built-in chat is free — it is the web chat panel loaded in Electron.

### `EditingHost` interface (the seam between tools and execution)
```ts
interface EditingHost {
  getProject(): Project;                    // full, AUTHORITATIVE (post-Phase-0: project == truth)
  applyAction(a: Action): Promise<ActionResult>; // through the action system; records undo
  beginTransaction(): TxnHandle;            // turn grouping
  commitTransaction(h: TxnHandle, label: string): void;
  rollbackTransaction(h: TxnHandle): void;
  runJob(kind: JobKind, params): Promise<JobResult>; // transcribe/export/upscale/bg-remove/...
  capabilities(): CapabilityManifest;       // canonical enums + machine-readable param ranges
  requireOpenProject(): void;               // throws/returns typed error if none open
}
```
- **`LiveEditorHost`** (apps/web): `applyAction` → `project-store.executeAction`; `runJob` via `gpu-web-client`/renderer; undo via the HistoryFacade; emits preview updates.
- **`HeadlessHost`** (Node): `applyAction` → core `ActionExecutor` directly; `runJob` delegates to the GPU worker / export service; undo via a headless HistoryFacade; load/save via `storage`/`ProjectSerializer`.

### Rejected alternatives
- **Renderer-locked executor (original Approach A).** Superseded: once Phase 0 makes `project` authoritative and engines stateless, headless data-editing is possible and strictly more capable. Kept as the `LiveEditorHost` implementation.
- **Headless core via a from-scratch rewrite.** Not needed — the action system is already pure; Phase 0 only has to remove browser-API module-load crashes and move overlay state into `project`.
- **Separate tool layers per surface / per editor.** Rejected: one registry, one loop. Image editor (`apps/image`) is out of scope (decision #6).

### New / touched locations
| Location | New? | Responsibility |
|---|---|---|
| `packages/core/src/actions/registry.ts` | NEW (P0) | `Map<ActionType,{apply,validate,invert}>` self-registration; compiler-enforced completeness. |
| `packages/core/src/capabilities/manifest.ts` | NEW (P0) | `CAPABILITY_MANIFEST`: canonical enums + machine-readable param ranges. |
| `packages/core/src/types/timeline.ts` | EDIT (P0) | Overlay track/clip types; new persisted `speedKeyframes`/`freezeFrames`/`pitchCorrection`/chroma fields. |
| `packages/core/src/{text/title-engine,graphics/graphics-engine,video/speed-engine,video/chroma-key-engine}.ts` | EDIT (P0) | Become stateless renderers reading from `project`. |
| `apps/web/src/stores/project-store.ts` | EDIT (P0+) | Route bypass methods through actions; HistoryFacade; transaction API; `requireOpenProject`. |
| `apps/web/src/.../bootstrap` (from `useDesktopEditorBootstrap.ts`) | EDIT (P0) | Promote to shared headless-capable bootstrap; data-only init tier. |
| `packages/agent` | NEW (P1) | Registry, loop, LLM adapters, `EditingHost` interface + `ToolExecutor`, serializers, types. |
| `apps/web/src/services/agent/live-host.ts` | NEW (P1) | `LiveEditorHost` impl over `project-store`. |
| `apps/web/src/components/editor/chat/` | NEW (P2) | Chat panel UI. |
| `apps/web/functions/api/proxy/[[catchall]].ts` | EDIT (P2) | Allowlist streaming tool-use endpoints + larger bodies. |
| `apps/desktop/src/main/mcp/` + `ipc/agent.ts` | NEW (P3) | MCP server (stdio+HTTP) + `openreel:agent:*` IPC bridge. |
| `apps/desktop/tsup.config.ts`, `package.json` (bin) | EDIT (P3) | `@modelcontextprotocol/sdk` in `noExternal`; `openreel-mcp` stdio shim binary. |
| `apps/cloud/src/...` (headless agent) + `HeadlessHost` | NEW (P4) | Server-side agent endpoint over the Node host; render/export via GPU worker. |

---

## 3. Cross-cutting design decisions

### 3.1 Single source of truth: the action registry + capability manifest
- **Action-handler registry** (`registry.ts`): every action self-registers `{ apply, validate, invert }` in one place; the executor/validator/inverse-generator iterate the registry instead of parallel switch statements. Adding an op = one file, compiler-checked. This is the highest-leverage plug-and-play change.
- **Capability manifest** (`manifest.ts`): canonical, deduplicated enums (`BlendMode`, filter types, transition types, easings, speed presets, subtitle presets, shape types) and **machine-readable parameter ranges** (min/max/step/default) following `types/effects.ts:49 EFFECT_DEFINITIONS`. The agent's tool schemas and the `get_capabilities` tool are generated from this — never hardcoded.
- The `packages/agent` registry projects itself into each consumer format: `toAnthropicTools()`, `toOpenAITools()`, `toMcpTools()`, `toCapabilityDoc()`.

### 3.2 The tool executor and `EditingHost`
`ToolExecutor.executeTool(name, args, host)`:
1. Validate `args` against the tool's zod schema (derived from the manifest).
2. **Resolve references** — accept clips/tracks/media by `id`, or `index`/`name`/`atTime`+`trackIndex`; resolve to canonical UUIDs; return both.
3. Map to `host.applyAction(action)` (post-Phase-0 nearly everything is an action) or `host.runJob(...)` for async GPU/analysis work, or a read serializer.
4. Normalize to a uniform `ToolResult { ok, summary, data?, error? }`; `summary` is the model-facing, token-cheap result string.

Because everything routes through `EditingHost`, the same executor serves the live renderer, the desktop MCP (via IPC to the live host), and the headless Node host.

### 3.3 Per-turn undo transaction (post-Phase-0)
After Phase 0 there is a single **HistoryFacade** (timestamp-ordered, discriminated entries, group support). The loop wraps each turn: `host.beginTransaction()` → edits → `host.commitTransaction(handle, turnLabel)`, so **one undo reverts the whole turn**; `rollbackTransaction` on fatal error or the chat "undo this turn" button. No tri-stack coordination remains.

### 3.4 Compact read / observe model
Read tools serialize from the now-authoritative `project`, stripping non-serializable data (blobs, `Float32Array` — reuse `stripMediaBlobs`, `project-serializer.ts:246`). Units are **seconds (float)** everywhere.

| Tool | Returns |
|---|---|
| `get_editor_state` | project settings, durationSec, track/clip/media counts, selection, playheadSec |
| `list_media` / `list_tracks` / `list_clips` | compact arrays; `list_clips` supports `{trackIndex?,fromSec?,toSec?}` filters + paging |
| `get_clip` | full detail of one clip (transform/crop/effects/color/keyframes/transitions/audio/speed) |
| `get_capabilities` | the manifest: valid enums + param ranges (min/max/step/default) |

### 3.5 Safety / autonomy posture
Auto-undoable per turn (3.3) always on. Tools flagged `destructive` (`delete_media`, `remove_track`, `remove_clip`, `ripple_delete_clip`, `replace_media`, project clear, `reset_color_grading`) or `expensive` (`export_*`, GPU jobs) pass through a `confirmGate` before executing (chat: inline card; MCP: structured "requires confirmation" or a "trusted local" auto-allow). `dryRun` mode validates + resolves + returns the would-be summary with zero mutation. Bounds: `maxSteps`, `maxToolCalls`, per-turn token ceiling (Phase 5).

### 3.6 Performance & security
- Batch multi-edit sequences via `executeMany`/a `batch_actions` tool; re-render once per committed turn (avoids the known clone-storm failure mode).
- BYOK keys keep the existing guarantee: never persisted server-side; web via same-origin Pages proxy (`x-proxy-api-key`), desktop via OS keychain (`cloud.ts` IPC).
- Desktop HTTP MCP binds `127.0.0.1` + per-session bearer token. Export/file writes stay on the existing file-picker path.

---

## 4. Phase 0 — App Readiness (HARD prerequisite)

**Outcome:** `project` is authoritative, every capability is reachable through one undoable/serialized action seam, a registry + manifest make extension plug-and-play, undo is correct, and the core runs headless. Verified worklist (all items cite audited file:line evidence; effort S/M/L).

### Hard prerequisites (must land before agent work)
| # | Workstream | What | Files | Effort |
|---|---|---|---|---|
| W0.1 | **Project = single source of truth (overlays→timeline)** | Move text/shape/SVG/sticker clips onto real timeline tracks; `TitleEngine`/`GraphicsEngine` become stateless renderers reading from `project` (like `ColorGradingEngine`). Remove the engine-Map authority + the `getFullProject` merge special-casing. Migration for existing projects. | `title-engine.ts:43`, `graphics-engine.ts:53-55`, `project-store.ts:494/4272`, `project-serializer.ts`, `types/timeline.ts` | **L** |
| W0.2 | **Action-handler registry** | Replace the 4-file switch (executor 71 / validator 49 / inverse 54 / union) with `Map<ActionType,{apply,validate,invert}>` self-registration; compiler-enforced completeness. | `packages/core/src/actions/{action-executor,action-validator,inverse-action-generator}.ts`, `types/actions.ts` | **M** |
| W0.3 | **Add missing actions (on the registry)** | `clip/setSpeed`, `clip/setReverse`, `clip/setStabilization`, `clip/setChromaKey`; `speed/*` family + **new persisted clip schema** (`speedKeyframes`, `freezeFrames`, `pitchCorrection`) migrating `SpeedEngine.clipSpeedData`; persist chroma onto the clip migrating `ChromaKeyEngine.clipSettings`; add slip/slide/roll to the typed `ClipAction` union. Replace raw `setState` paths in the inspector. | `SpeedSection.tsx:92/128`, `SpeedRampSection.tsx:400-499`, `StabilizationSection.tsx:48`, `GreenScreenSection.tsx:146-214`, `speed-engine.ts`, `chroma-key-engine.ts`, `types/timeline.ts:100-104` | **M (+L speed)** |
| W0.4 | **HistoryFacade (undo unify + redo bug fix)** | One timestamp-ordered discriminated history (action / clip-snapshot / template) with per-kind apply/revert + `beginGroup`/`endGroup` (reuse `action-history.ts:212/217`); fix the redo-ordering asymmetry; HistoryPanel shows all kinds. With W0.1 done, clip-snapshot entries largely fold into action history → opportunistic path to a true single stack. | `project-store.ts:3729/3943`, `action-history.ts:212/217`, HistoryPanel | **M** |
| W0.5 | **Capability manifest + enum consolidation** | One typed `CAPABILITY_MANIFEST` with canonical enums + machine-readable param ranges; consolidate duplicates: `BlendMode` (×5), filter-type (×3), transition-type (×2), subtitle presets (divergent); color-grading ranges from comments → data. | `packages/core/src/capabilities/manifest.ts` (new), `types/effects.ts:49` (model), scattered enum sites | **M** |
| W0.6 | **Headless core + Node-compat (decision #5)** | Promote `ensureBootstrap()`/`runBootstrap()` to a shared module; add a **data-only init tier** (project-store + ActionExecutor in pure Node); guard module-load browser-API crashes (`AudioContext` `audio-engine.ts:144`, `OffscreenCanvas`, `coreTitleEngine.initialize()` `engine-store.ts:186`) with `typeof` checks + lazy init; add `requireOpenProject` returning `ActionResult{success:false}` instead of silent mutation. | `useDesktopEditorBootstrap.ts:39/87`, `engine-store.ts:186`, `audio-engine.ts:144`, `project-store.ts` | **M** |

### Parallelizable (alongside or after; non-blocking)
| # | Workstream | Effort |
|---|---|---|
| W0.7 | **Quick-win wiring** — route `reorderVideoEffects` (5655), `updateClipKeyframes` (6125), `removeSubtitle` (4760), `updateSubtitle` (4777), `applySubtitleStylePreset` (4855) through existing executor actions; unify overlay timeline trim/move (`Timeline.tsx:569-728`) with the media `trimClip`/`moveClip` path (enabled by W0.1). Good warm-up. | S each |
| W0.8 | **Engine-feature persistence** — store methods that mutate `project` (via actions) AND drive the engine for adjustment layers / nested sequences / multicam / mask / motion presets (`AdjustmentLayerSection.tsx:160`, `NestedSequenceSection.tsx:107`, `MultiCameraPanel.tsx:239`, `MaskSection.tsx:414`). | M each |
| W0.9 | **`project-store` slicing (decision: incremental)** — finish the abandoned `stores/project/` slices (`mediaSlice`/`trackSlice`/`clipSlice`/`historySlice`/`textGraphicsSlice`); the tool layer binds to slice surfaces, not a 6,152-line monolith. Non-blocking. | L |

### Acceptance criteria
- Save → reload a project with text/shapes/SVG/stickers/speed-ramp/chroma → **all state restored** from `project` alone (no engine-memory dependence).
- Every capability in §2 has an undoable action entry; no editing path uses bare `setState`; slip/slide/roll are in the typed union.
- Interleaved undo/redo sequence replays correctly (redo bug fixed) via the HistoryFacade.
- A pure-Node script (no DOM/WebGPU/WebAudio) loads a project, applies ≥10 actions across all domains, undoes/redoes, and serializes — no browser-API crash.
- `get_capabilities`-shaped read of `CAPABILITY_MANIFEST` returns ranges for all parameterized effects/filters/color controls.
- `pnpm typecheck` + `pnpm lint` clean; existing tests pass; new Phase-0 tests cover serialization round-trip, undo/redo ordering, headless apply, and each new action's apply/invert.

---

## 5. Phase 1 — Shared agent foundation

**Outcome:** headless, fully testable agent core: registry, `EditingHost` + executor, agent loop, LLM adapters, serializers, plus both host implementations.

### Deliverables
1. `packages/agent` scaffolded (depends on `@openreel/core` only).
2. **Tool registry** (~40 curated tools + read tools + `execute_action`/`batch_actions` escape hatch) generated from the manifest, across domains: read, project, media, track, clip (add/remove/ripple/move/trim/split/merge/slip/slide/roll/duplicate/separate-audio/trim-to-playhead/close-gap), transform+crop, effect, color, **speed (incl. ramp/freeze)**, audio, text, subtitle, graphics, transition, keyframe, marker, **chroma-key/stabilization/adjustment/nested/multicam/mask**, ai (transcribe/highlights/bg-remove/upscale/music-gen/inpaint), export.
3. **`EditingHost` interface + `ToolExecutor`** (§3.2) with ref-resolution and uniform `ToolResult`.
4. **`LiveEditorHost`** (apps/web, over `project-store`) and **`HeadlessHost`** (Node, over core action system + storage + GPU-worker jobs).
5. **Agent loop runtime** + `LLMClient` interface + Anthropic & OpenAI adapters (normalization only; transport injected). Events: `text_delta | tool_call | tool_result | awaiting_confirmation | error | turn_complete`. Limits + `dryRun`.

### Testing (verification spine — runs headless)
- Registry: every schema valid; names unique; every non-`raw` tool maps to a real executor branch.
- Serializers: no blobs/typed arrays; bounded size; round-trip key fields.
- Executor + `HeadlessHost`: each domain's representative tool produces the expected mutation + correct `ToolResult`; ref-resolution works.
- Transaction: mixed multi-domain edits → one undo reverts all; redo restores.
- Loop: mock `LLMClient` scripts a multi-tool turn → asserts order, confirm-gating on destructive ops, dry-run = zero mutation, limits enforced.

### Acceptance criteria
- A scripted (mock-LLM) turn performs ≥5 edits across multiple domains against the `HeadlessHost` and the whole turn undoes/redoes atomically — with **no renderer**.
- The same turn run against `LiveEditorHost` updates the live preview.
- All Phase-1 tests pass; typecheck + lint clean.

---

## 6. Phase 2 — Web built-in chat (BYOK)

**Outcome:** a chat panel in the web editor; user picks provider/model, brings their key, edits the open project by chatting.

- **Mount:** new collapsible `chat` panel in `EditorInterface.tsx` grid (`PanelId "chat"` + `DEFAULT_PANELS` in `ui-store.ts`; grid area/column at `gridStyle:413`; render under `gridArea:'chat'` in `PanelErrorBoundary` mirroring inspector `:461`; extend resize machinery). Toolbar Sparkles toggle. Persisted.
- **Provider/model/keys:** extend `settings-store` `LlmProvider` registry (Anthropic + OpenAI first; structured for Google/OpenRouter later). Keys via `getSecret`/`secure-storage`; "Manage keys" UI.
- **BYOK transport (`LLMClient`):** reuse `apiFetch` → web prod Pages proxy / web dev direct / desktop keychain IPC. **Required proxy work:** extend `functions/api/proxy/[[catchall]].ts` to allowlist the streaming messages/chat-completions tool-use endpoints with **SSE passthrough** + larger bodies; preserve "keys never persisted"; verify streaming + tool-use for both providers.
- **Chat UI:** streaming text; collapsible tool-call cards (name, resolved args, `ToolResult.summary`); inline confirm cards (`confirmGate`); per-turn "Undo this turn"; Stop (aborts loop, rolls back in-flight transaction); basic token/cost indicator. System prompt = tool guidance + `get_capabilities` + initial `get_editor_state`. Styling: Tailwind tokens + `@openreel/ui`.

### Acceptance criteria
- With a valid key, "trim the first clip to 5s, add a fade-in, put a title card at the start" executes via tool calls; one undo reverts the whole turn.
- "delete all media" surfaces a confirm card first.
- Streaming + tool cards render; Stop aborts cleanly; identical behavior in the desktop shell.

---

## 7. Phase 3 — Desktop MCP server

**Outcome:** external MCP clients connect to the running desktop app and drive the open project through the same tool layer.

- **Host:** MCP server in Electron main (`apps/desktop/src/main/mcp/`) using `@modelcontextprotocol/sdk` — **add SDK + deps to `tsup.config.ts noExternal`** (asar gotcha).
- **Transports:** HTTP/SSE bound to `127.0.0.1` (free port, per-session bearer token), lifecycle on `whenReady`/`will-quit` (follow `sidecar/export-job.ts` + `index.ts:250`). **stdio:** ship a small `openreel-mcp` **stdio→HTTP shim binary** (registered `bin`) that clients spawn; it bridges stdio ↔ the live app's HTTP endpoint (reading URL+token from a per-user file the app writes on launch) — solving the "Electron can't be a stdio child" problem.
- **Bridge:** MCP `tools/list` = `registry.toMcpTools()`; `tools/call` → `openreel:agent:*` IPC (`ipc/agent.ts`, Zod contracts in `shared/ipc-contract.ts`, consts in `shared/channels.ts`, via `handle()`) → renderer's `LiveEditorHost`. Long tools stream progress via `MessageChannelMain` (reuse export `MessagePort` pattern). No project open → typed "no project" results/errors.
- **Confirmation over MCP:** structured "requires confirmation" result, or "trusted local" auto-allow toggle (default: gate destructive).
- **Config UX:** settings screen shows local URL+token and copy-paste snippets for Claude Desktop / Cursor / Cline (pointing at the shim); "test connection".

### Acceptance criteria
- From Claude Desktop (stdio shim) and an HTTP client, `tools/list` returns the full registry and `tools/call` edits the open project live + undoably.
- Token-gated HTTP rejects unauthenticated calls; server starts/stops with the app; packaged build includes SDK + shim.

---

## 8. Phase 4 — Headless / cloud agent (server-side)

**Outcome:** an agent edits a project with no app open — realizing decision #5.

- **`HeadlessHost` wired to a service** in `apps/cloud` (or a Node CLI): load project via `ProjectSerializer`/`storage`, run the agent loop against the core action system, persist results.
- **Render/export/transcribe** delegated to the existing **GPU worker** (`ai.openreel.video`, `gpu/job-client`) and the auth broker (`/auth` → short-lived GPU JWT) — the agent's `runJob` calls these; no browser context required for data edits.
- **BYOK:** server-side key handling consistent with the no-persist guarantee (per-request keys; never stored).
- **MCP remote (optional):** expose the headless host as a remote MCP endpoint for cloud agents (revisit; HTTP transport + auth reused).
- **Use cases:** batch/automated edits, "apply this recipe to N projects", scheduled edits.

### Acceptance criteria
- A server-side run loads a stored project, performs a multi-tool editing turn headlessly, exports via the GPU worker, and saves — with no app/renderer.
- Keys never persisted; GPU jobs authorized via the broker.

---

## 9. Phase 5 — Hardening, polish & agent-relevant features

- **Token/cost controls** (per-turn ceiling, history summarization, paged `list_clips` for huge timelines, cost meter); **rate limiting** + provider 429/5xx backoff.
- **MCP HTTP auth** finalization (token rotation) + desktop nav hardening (`will-navigate`/`setWindowOpenHandler` deny-by-default).
- **Destructive-op policy config** (per-user auto-confirm vs gate; persistent dry-run toggle).
- **Eval suite:** corpus of natural-language editing prompts → expected tool sequences / project-state assertions, run headlessly against the loop (the `HeadlessHost` makes this cheap) as a regression guard.
- **Render/export queue + batch export** — the top verified competitive gap and the most agent-relevant missing feature ("export these N variants"). Build a queue the agent can enqueue into.
- **Observability:** structured tool-call/error logging; optional telemetry via the crash-collection hook.
- **Docs:** capability reference auto-generated from the manifest (`toCapabilityDoc()`); user guide for BYOK chat + connecting external agents.

### Acceptance criteria
- Eval suite passes a baseline pass-rate; cost ceiling + rate limits enforced; nav hardening verified; export queue drives ≥2 concurrent/queued exports from an agent request.

---

## 10. Competitive backlog (P2 — verified gaps only)
| Feature | Status | Effort | Agent relevance |
|---|---|---|---|
| Render/export queue + batch export | Missing | M | **High** (built in Phase 5) |
| Batch/templated multi-clip "apply recipe across N" | Partial (auto-edit templates exist) | M | **Med-high** |
| Assisted/AI rotoscoping (segmentation exists, not wired as roto) | Partial | M-L | Med |
| Proxy/full-res editing mode | Partial (import downscale + desktop `generateProxy`) | M | Low-med |
| True HDR pipeline (Rec.2020/HLG/PQ) | Missing | L | Low |
| RGB parade as a discrete scope enum | Partial (runtime toggle exists) | S | Low |

**Refuted / already present (do NOT rebuild):** slip/slide/roll, masking, nested sequences, adjustment layers, multicam audio sync, motion blur, frame cache, audio ducking, motion tracking, scopes, karaoke captions, blend modes, frame-accurate snapping, ripple/roll, freeze frame, optical-flow retiming, keyframe curve editor.

---

## 11. Key risks & mitigations
| Risk | Mitigation |
|---|---|
| Overlay→timeline migration (W0.1) breaks existing projects | Versioned migration on load; round-trip tests; do first so the rest builds on the clean model. |
| Registry refactor (W0.2) regresses existing actions | Registry iterated by the same executor; full action test suite must stay green; incremental per-domain migration. |
| Headless Node-compat misses a browser-API crash | Data-only init tier + `typeof` guards + a pure-Node CI test that exercises all domains (Phase-0 acceptance). |
| BYOK proxy not validated for streaming tool-use | Phase-2 work item: SSE passthrough + larger bodies; verify both providers; preserve no-persist. |
| Electron can't be a stdio child | `openreel-mcp` stdio→HTTP shim (Phase 3). |
| Clone storms from rapid edits | Batch via `batch_actions`/`executeMany`; one re-render per committed turn. |
| Agent safety (delete/export/external) | Confirm gates + dry-run + per-turn undo + local-only token-gated MCP. |
| project-store god object slows tool binding | Incremental slicing (W0.9); not a blocker — bind to current methods first. |

---

## 12. Out of scope
- New editing capabilities beyond existing engines (except the Phase-5 export queue).
- The image editor (`apps/image`) and web/image command-pattern convergence.
- Multi-user / collaborative agent sessions.
- Provider billing/metering beyond client-side cost display.
- Mobile (iOS/Android) agent surfaces.

---

## 13. Load-bearing files (reference)
- `packages/core/src/actions/{action-executor,action-validator,inverse-action-generator}.ts` + `types/actions.ts` — registry + missing actions + union drift (W0.2/W0.3).
- `packages/core/src/{text/title-engine,graphics/graphics-engine,video/speed-engine,video/chroma-key-engine}.ts` — engine-resident state to move into `project` (W0.1/W0.3).
- `packages/core/src/types/{timeline,effects}.ts` — clip schema + `EFFECT_DEFINITIONS` manifest model (W0.3/W0.5).
- `apps/web/src/stores/project-store.ts` (6,152 lines) — god object, bypass methods, tri-stack undo (W0.2/W0.4/W0.7/W0.9).
- `apps/web/src/components/editor/inspector/{SpeedSection,SpeedRampSection,StabilizationSection,GreenScreenSection}.tsx` — raw-setState paths (W0.3).
- `apps/web/src/.../useDesktopEditorBootstrap.ts:39/87`, `engine-store.ts:186`, `audio-engine.ts:144` — headless bootstrap + Node-compat (W0.6).
- `apps/web/src/services/api-proxy.ts` + `functions/api/proxy/[[catchall]].ts`, `useElevenLabsApi.ts:212` — BYOK plumbing (P2).
- `apps/desktop/src/main/{index.ts,sidecar/export-job.ts,ipc/cloud.ts}` + `shared/ipc-contract.ts` — MCP host + IPC + LLM proxy precedent (P3).
- `gpu-web-client.ts` / desktop `gpu/job-client.ts` + `apps/cloud/src/auth/` — GPU jobs + broker for the headless host (P4).
