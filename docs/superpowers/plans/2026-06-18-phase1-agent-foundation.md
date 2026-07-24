# Phase 1: Shared Agent Foundation — Status

**Branch:** `feat/agent-phase0-readiness` · **Status:** ✅ Complete
**Commits:** `05ef3e5` (packages/agent), `62ffa10` (LiveEditorHost), `59ec192` (acceptance test)
**Verification:** 32 `@openreel/agent` tests + 4 web LiveEditorHost tests green; agent + web + core typecheck clean; web lint clean.

Implements §5 of [the design spec](../specs/2026-06-18-ai-agent-editing-design.md): the platform-agnostic tool layer both the web chat (Phase 2) and the desktop MCP server (Phase 3) build on.

## Delivered

| # | Deliverable | Where |
|---|---|---|
| 1 | `@openreel/agent` package (depends on `@openreel/core`) | `packages/agent` |
| 2 | **Tool registry** — ~65 tools across every domain (read/project/media/track/clip/transform/effect/color/speed/audio/subtitle/keyframe/transition/marker/text/graphics) + `execute_action` & `batch_actions` escape hatches; projected to Anthropic / OpenAI / MCP formats; `toCapabilityDoc()` | `registry.ts` |
| 3 | **`EditingHost` interface** + **`ToolExecutor`** (`executeTool`) with clip-ref resolution (`clipIndex`/`atSec` → `clipId`) | `host.ts`, `executor.ts` |
| 4 | **Both hosts**: `HeadlessHost` (Node, over core `ActionExecutor`; transaction = history group + undo-to-checkpoint) and `LiveEditorHost` (over the web `project-store`) | `headless-host.ts`, `apps/web/src/services/agent/live-host.ts` |
| 5 | **Agent loop** (`runTurn`): per-turn undo transaction, confirm-gating of destructive/expensive tools, dry-run, atomic rollback-on-error; **`LLMClient`** + Anthropic/OpenAI adapters (normalization; transport injected via `send`) + `MockLLMClient` | `loop.ts`, `llm.ts` |
| 6 | **Compact, blob-free read serializers** (editor state / media / tracks / clips / clip detail) | `serialize.ts` |
| 7 | **System-prompt builder** (guidance + live state + capability reference) | `system-prompt.ts` |
| 8 | **Tests** — registry validity + provider projections; serializers; executor (incl. ref-resolution, escape hatch, read tools) against a real `HeadlessHost`; transaction rollback; loop (mock-LLM multi-tool turn, dry-run, confirm-reject, 6-edit cross-domain atomic rollback); LLM adapter normalization round-trips; LiveEditorHost over the real store | `*.test.ts` |

## Key design decisions
- **One tool layer, three front doors.** Tools execute through the `EditingHost` seam; the same registry + executor + loop serve the headless host, the live renderer, and (Phase 3) the desktop MCP server.
- **Headless-safe imports.** The agent imports core via specific submodules (`@openreel/core/actions/*`, `/types/*`, `/capabilities/manifest`) — never the barrel — so it loads in pure Node and doesn't drag in DOM/WebGPU rendering code.
- **Undoable per turn.** `runTurn` wraps the whole turn in a host transaction (one history group); a fatal error rolls back every edit atomically (verified with a 6-edit cross-domain test).
- **Provider-agnostic.** `LLMClient` is the only provider seam; Anthropic/OpenAI adapters do request/response normalization and take the transport (`send`) as an injected dependency, so Phase 2 wires the BYOK proxy and Phase 4 the cloud transport without touching the loop.

## Next
- **Phase 2** — web BYOK chat panel mounting `runTurn` + `LiveEditorHost` + the existing BYOK proxy.
- **Phase 3** — desktop MCP server (stdio shim → local HTTP) over `toMcpTools()` + IPC → `LiveEditorHost`.
- **Phase 4** — cloud/headless agent over `HeadlessHost` + GPU-worker `runJob`.
- **Phase 5** — hardening, token/cost controls, export queue, eval suite.
