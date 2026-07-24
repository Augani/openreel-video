# Phase 5: Hardening, Polish & Agent-Relevant Features — Status

**Branch:** `feat/agent-phase0-readiness` · **Status:** ✅ Complete
**Verification:** all four packages typecheck clean; **48 agent + 22 runner + 118 desktop + 333 web tests** green (incl. ~30 new Phase-5 tests); desktop tsup, runner CLI, and web vite builds all succeed.

Implements §9 of [the design spec](../specs/2026-06-18-ai-agent-editing-design.md): the cross-cutting hardening + agent-relevant features that finish the agent-editing initiative.

## Delivered (maps 1:1 to §9 bullets)

| § bullet | Deliverable | Where |
|---|---|---|
| Token/cost controls | **Per-turn token ceiling** (`limits.maxTokens` → `StopReason "budget"`) + **paged `list_clips`** (`offset`/`limit`) + cost meter (usage already threaded) | `loop.ts`, `serialize.ts`, `registry.ts` |
| Rate limiting | **`LLMHttpError` + `withRetry`** (429/5xx exponential backoff), wired into web + node transports | `llm.ts`, `llm-transport.ts`, `node-llm.ts` |
| MCP auth + nav hardening | Token rotation (Phase 3) + **`isAllowedNavigation` / `installNavigationGuard`** (deny-by-default `will-navigate` + `setWindowOpenHandler`, external https → `shell.openExternal`) | `nav-guard.ts`, `index.ts` |
| Destructive-op policy | **`agentAutoConfirm` + `agentDryRun`** (persisted) wired into the chat loop (auto-approve gate / dry-run) + ChatPanel toggles | `settings-store.ts`, `chat-store.ts`, `ChatPanel.tsx` |
| Eval suite | **Headless eval harness** (NL prompt → tool-sequence + project-state assertions over `HeadlessHost`) + deterministic corpus; real-LLM mode gated | `evals/harness.ts`, `evals/cases.ts` |
| Render/export queue | **`runExportQueue`** — bounded-concurrency batch export via a `JobRunner` ("export these N variants") | `agent-runner/export-queue.ts` |
| Observability | **`createEventLogger` / `collectEvents` / `toLogRecord`** — structured tool-call/error records from loop events | `observability.ts` |
| Docs | **`generateCapabilityMarkdown()`** → committed [AGENT-CAPABILITIES.md](../../AGENT-CAPABILITIES.md) (72 tools, auto-generated) + [AGENT-GUIDE.md](../../AGENT-GUIDE.md) user guide | `gen-docs.ts`, `gen-docs-cli.ts` |

## Acceptance criteria (§9)
- **Eval suite passes a baseline pass-rate** — `runEvals(SCRIPTED_CASES)` → passRate 1.0; harness also proves it catches assertion + tool-sequence mismatches. ✅
- **Cost ceiling + rate limits enforced** — budget test stops a turn at the ceiling (`stoppedReason: "budget"`); `withRetry` retries 429/5xx and gives up after the budget (tested). ✅
- **Nav hardening verified** — `isAllowedNavigation` allows only the `app://openreel` origin and denies external/file/other-scheme/malformed URLs (tested); guard installed in `createWindow`. ✅
- **Export queue drives ≥2 concurrent/queued exports** — `runExportQueue` runs 5 jobs at concurrency 2 (max-active ≤2, all complete), preserves order, isolates failures (tested). ✅

## New tests (~30)
- agent: `retry` (5), `loop-budget` (2), `serialize-paging` (4), `observability` (4), `gen-docs` (1)
- agent-runner: `export-queue` (3), `evals` (3)
- desktop: `nav-guard` (4)
- web: chat-store policy (auto-approve + dry-run) (2)

## Not verifiable in this environment
- Real-LLM eval-corpus pass-rate (needs a BYOK key); the harness + assertions run deterministically with `MockLLMClient`.
- Live GPU batch export (needs the GPU/broker/R2 infra); the queue is tested against a mock `JobRunner`.

## The initiative, end to end
Phase 0 app-readiness → Phase 1 shared tool layer → Phase 2 web BYOK chat →
Phase 3 desktop MCP → Phase 4 headless runner → **Phase 5 hardening**. The agent
can now edit OpenReel projects from the browser, the desktop app, external MCP
clients, and headless servers — through one capability set, undoably, with
cost/rate/destructive-op guardrails.
