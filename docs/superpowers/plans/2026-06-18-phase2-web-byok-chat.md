# Phase 2: Web Built-in Chat (BYOK) — Status

**Branch:** `feat/agent-phase0-readiness` · **Status:** ✅ Complete
**Verification:** 12 `chat-store` tests + 326 web tests + 32 `@openreel/agent` tests green; agent + web typecheck clean; web lint clean (touched files); `vite build` succeeds (agent package bundles into the browser).

Implements §6 of [the design spec](../specs/2026-06-18-ai-agent-editing-design.md): a chat panel in the web editor where the user picks a provider/model, brings their own key, and edits the open project by chatting — driven by the Phase 1 `runTurn` + `LiveEditorHost`.

## Delivered

| # | Deliverable | Where |
|---|---|---|
| 1 | **BYOK transport** — builds a Phase 1 `LLMClient` whose `send` routes through the existing `apiFetch` (prod Pages proxy / dev direct / desktop keychain IPC); pre-flight abort check honors Stop on every transport | `apps/web/src/services/agent/llm-transport.ts` |
| 2 | **Model registry** — tool-use-capable models per provider + `defaultModelFor`/`modelsFor` | `apps/web/src/services/agent/models.ts` (+ `components/editor/chat/models.ts` re-export) |
| 3 | **Chat orchestration store** — drives `runTurn` + `LiveEditorHost` + the BYOK client; per-turn confirm gate (`pendingConfirm`/`resolveConfirm`), `stop()` (rejects pending confirm + aborts + rolls back), `undoLastTurn()`, cumulative token usage, atomic reducer over loop events | `apps/web/src/stores/chat-store.ts` |
| 4 | **Chat UI** — `ChatPanel` (header, provider/model picker, token chip, undo-turn, clear, empty-state suggestions), `ChatComposer` (Enter-to-send, Stop), `ChatMessage`, collapsible `ToolCallCard` (name + resolved args + `ToolResult.summary`), `InlineConfirmCard` (approve / approve-all-turn / reject), `ProviderModelPicker` | `apps/web/src/components/editor/chat/` |
| 5 | **Mount** — `agentChat` `PanelId` + `DEFAULT_PANELS` + persist migrate (v2) in `ui-store`; dockable, resizable right-hand grid column in `EditorInterface` (`gridArea:'chat'` under `PanelErrorBoundary`, inspector/media offsets account for chat width); `Bot` toggle in the toolbar (web **and** desktop) | `ui-store.ts`, `EditorInterface.tsx`, `Toolbar.tsx` |
| 6 | **Settings** — `llmModel` added to `settings-store` (persisted, per provider) | `settings-store.ts` |
| 7 | **Proxy limits** — request body 1 MB → 8 MB, upstream timeout 25 s → 120 s for agent payloads (keys still never persisted) | `functions/api/proxy/[[catchall]].ts` |
| 8 | **Token usage** — `LLMUsage` threaded through `parseAnthropic/OpenAIResponse` → `RunTurnResult.usage`; accumulated in the store, shown as a header chip | `packages/agent/{llm,loop}.ts`, `chat-store.ts`, `ChatPanel.tsx` |
| 9 | **Tests** — guard (no project / locked session / empty), happy-path message recording, tool-call/result reflection, rejected-vs-error status, confirm gating, Stop, undo-once, error surfacing, reset, usage accumulation | `apps/web/src/stores/chat-store.test.ts` |

## Acceptance criteria (§6)
- **Multi-step edit in one undoable turn** — the turn runs inside one `LiveEditorHost` transaction (Phase 1); `undoLastTurn` reverts the whole turn via `project-store.undo`. ✅
- **Destructive op surfaces a confirm card first** — `runTurn` gates destructive/expensive tools through `confirmGate`; the store renders `InlineConfirmCard`. ✅
- **Tool cards render; Stop aborts cleanly; identical in the desktop shell** — `ToolCallCard` renders live; `stop()` rejects the pending confirm, aborts the request, and the loop rolls back; the panel + toolbar toggle mount on web and desktop. ✅

## Deviations from the spec
- **Panel id is `agentChat`, not `chat`** — `"ai"` was already taken by the GPU-jobs panel; `agentChat` is unambiguous.
- **Toolbar icon is `Bot`, not `Sparkles`** — `Sparkles` already marks the desktop GPU AI panel; `Bot` distinguishes the chat.
- **Non-streaming, not SSE** — Phase 1's `LLMClient.complete()` is non-streaming; a single POST through the existing path-based proxy needs no SSE/allowlist change. Full text renders on turn completion; SSE streaming is a Phase 5 enhancement.
- **Key management reuses the existing Settings → API Keys tab** (`SERVICE_REGISTRY` already lists OpenAI + Anthropic); errors deep-link users there.

## Next
- **Phase 3** — desktop MCP server (stdio shim → local HTTP) over `toMcpTools()` + IPC → `LiveEditorHost`.
- **Phase 5** — SSE streaming, cost controls, eval suite.
