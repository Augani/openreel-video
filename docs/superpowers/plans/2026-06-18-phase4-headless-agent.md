# Phase 4: Headless / Cloud Agent — Status

**Branch:** `feat/agent-phase0-readiness` · **Status:** ✅ Complete (GPU export E2E needs live infra — noted below)
**Verification:** `@openreel/agent-runner` typecheck clean; 16 runner tests green; `tsup` builds a standalone CLI (227 KB, agent+core submodules bundled, no WebGPU barrel); built `openreel-agent` binary runs (usage + missing-key paths verified).

Implements §8 of [the design spec](../specs/2026-06-18-ai-agent-editing-design.md): an agent edits a stored project with **no app/renderer open**, delegating render/export to the GPU worker, with per-request BYOK keys.

## Delivered — new package `@openreel/agent-runner` (Node)

| # | Deliverable | Where |
|---|---|---|
| 1 | **Headless run orchestrator** — `runHeadlessEdit` (in-memory) and `runHeadlessEditFile` (load → multi-tool turn → save) over `HeadlessHost` + the Phase 1 loop | `src/run.ts` |
| 2 | **Project IO** — `loadProjectFile` / `saveProjectFile` / `createEmptyProject` via the core `ProjectSerializer`'s pure JSON methods (no browser storage engine) | `src/project-io.ts` |
| 3 | **Node BYOK transport** — `makeNodeLLMClient` / `makeNodeLLMSend` (fetch-based Anthropic/OpenAI); the API key is used per-request for the auth header only and is **never stored or logged** | `src/node-llm.ts` |
| 4 | **GPU `runJob` delegate** — `createGpuJobRunner` + `GpuTokenProvider`: mints a short-lived JWT via the auth broker's open (unattested) leg, submits to `ai.openreel.video/jobs`, polls to a terminal state, returns the job/manifest ref | `src/gpu-job-runner.ts` |
| 5 | **CLI** `openreel-agent` — `--project --prompt [--provider --model --out --dry-run]`; key from `OPENREEL_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | `src/cli.ts` |
| 6 | **Tests** — headless multi-tool turn edits an in-memory project (2 tools, committed); atomic rollback on LLM error; load→edit→save round-trip with no app; project-io round-trip + validation; BYOK key-in-headers-only; GPU mint/submit/poll success + failure + submit-rejected | `src/*.test.ts` |

## Acceptance criteria (§8)
- **A server-side run loads a stored project, performs a multi-tool editing turn headlessly, and saves — no app/renderer.** ✅ (`runHeadlessEditFile` test: loads JSON, runs a 1-tool turn via the loop, saves; the multi-tool case is covered by the in-memory test).
- **Exports via the GPU worker.** ✅ at the code level — `runJob` delegates to the GPU worker via the broker; unit-tested with mocked fetch (mint → submit → poll). Live export needs the GPU/broker/R2 infra (see below).
- **Keys never persisted; GPU jobs authorized via the broker.** ✅ — per-request key in the auth header only (test asserts it never appears in the request body); GPU calls carry a broker-minted `Authorization: Bearer` JWT.

## Deviations / scope notes
- **No web tool triggers `runJob` yet** — the headless runner (or CLI) drives export via `host.runJob`; an agent-invokable export tool + render queue is the Phase 5 deliverable ("Render/export queue + batch export"). In the web/MCP `LiveEditorHost`, `runJob` returns a graceful "not available" until wired.
- **Cloudflare Worker vs Node CLI** — the spec allowed either; a Node CLI/library is the tractable, verifiable choice and avoids bundling `@openreel/core` into the Workers runtime.

## Not verifiable in this environment
- A live GPU export (needs `ai.openreel.video` + the auth broker + R2, and the project's media available to the worker).
- A real LLM round-trip (needs a BYOK key); the loop/orchestrator is covered with `MockLLMClient`.

## Next
- **Phase 5** — token/cost ceilings, rate-limit/backoff, MCP HTTP auth finalization + desktop nav hardening, destructive-op policy config, eval suite (cheap on `HeadlessHost`), render/export queue + batch export, observability, auto-generated capability docs.
