# Phase 3: Desktop MCP Server — Status

**Branch:** `feat/agent-phase0-readiness` · **Status:** ✅ Complete (E2E with a real MCP client + packaged build noted below)
**Verification:** desktop + web typecheck clean; 114 desktop tests (incl. 28 new MCP tests) + 338 web tests green; `tsup` builds main + preload + shim (shebang + exec bit preserved); `vite build` succeeds.

Implements §7 of [the design spec](../specs/2026-06-18-ai-agent-editing-design.md): external MCP clients connect to the running desktop app and drive the open project through the same tool layer as the web chat.

## Architecture

```
MCP client (Claude Desktop / Cursor / Cline)
  └─stdio─> openreel-mcp shim ─HTTP+Bearer─> main HTTP server (127.0.0.1)
                                               └─ MCP JSON-RPC core
                                                    └─IPC (callId-correlated)─> renderer DesktopApp
                                                         └─ executeTool over the SHARED LiveEditorHost
```

The Electron **main** process is a thin MCP↔IPC bridge: it holds **no** `@openreel/agent`/`@openreel/core` code. `tools/list` and `tools/call` are forwarded to the renderer (which already has the registry), so the main bundle stays lean (765 KB) and free of the heavy bundling the SDK would require.

## Delivered

| # | Deliverable | Where |
|---|---|---|
| 1 | **MCP JSON-RPC core** (initialize / ping / tools.list / tools.call / notifications), pure + unit-tested | `apps/desktop/src/main/mcp/core.ts` |
| 2 | **Loopback HTTP transport** — `127.0.0.1`, OS-assigned free port, **bearer-token gated** (401 on bad/missing token), 4 MB body cap, batch support | `apps/desktop/src/main/mcp/http-server.ts` |
| 3 | **callId-correlated main→renderer dispatcher** (concurrent calls, timeouts, reject-all on shutdown), electron-free + unit-tested | `apps/desktop/src/main/mcp/dispatcher.ts`, `renderer-bridge.ts` |
| 4 | **Server orchestrator** — token gen, endpoint-file write (`~/.openreel/mcp-endpoint.json`, 0600), status, token rotation, loopback self-test | `apps/desktop/src/main/mcp/server.ts` |
| 5 | **stdio→HTTP shim** `openreel-mcp` — transparent newline-delimited JSON-RPC proxy reading the endpoint file; dependency-free; testable `forwardLine` | `apps/desktop/src/mcp-shim/index.ts` |
| 6 | **Lifecycle** — start on `whenReady` (after `createWindow`), stop on `will-quit` (alongside `cancelAllExports`); IPC handlers for the settings panel | `apps/desktop/src/main/index.ts` |
| 7 | **IPC seam** — `mcp:request`/`mcp:response` (+ getStatus/rotateToken/testConnection) channels; preload `mcp` namespace mirroring the lifecycle request/reply pattern | `channels.ts`, `preload/index.ts`, `global.d.ts` |
| 8 | **Renderer bridge** — `DesktopApp` installs an `mcp.onRequest` listener that runs `executeTool` over a **shared** `LiveEditorHost` singleton (chat + MCP share one undo history), gating destructive/expensive tools on the trusted-local toggle | `services/agent/host-singleton.ts`, `mcp-listener.ts`, `DesktopApp.tsx`, `chat-store.ts` |
| 9 | **Settings UX** — desktop-only MCP panel: status, URL, masked/rotatable token, copy-paste client config snippet (shim path), test-connection, trusted-local auto-allow toggle | `settings/McpPanel.tsx`, `SettingsDialog.tsx`, `settings-store.ts` |
| 10 | **Packaging** — `mcp-shim` tsup entry, `bin: { openreel-mcp }`, `asarUnpack` for the shim so external clients can spawn it | `tsup.config.ts`, `package.json`, `electron-builder.yml` |
| 11 | **Tests** — MCP core (9), dispatcher correlation/timeout/reject (7), HTTP server auth-gate + happy path (6, real requests), shim forwarder (6), renderer listener gating (5) | `*.test.ts` |

## Acceptance criteria (§7)
- **`tools/list` returns the full registry; `tools/call` edits the open project live + undoably** — list/call forward to the renderer's `executeTool` over the shared `LiveEditorHost` (same undoable path as the chat panel). ✅ (covered by unit tests; full client E2E needs a real MCP client — see below)
- **Token-gated HTTP rejects unauthenticated calls** — the HTTP server returns 401 unless `Authorization: Bearer <token>` matches. ✅
- **Server starts/stops with the app; packaged build includes the shim** — start on `whenReady`, stop on `will-quit`; shim is a tsup entry shipped via `bin` + `asarUnpack`. ✅ (build verified; packaged DMG E2E not run here)

## Deviations from the spec (deliberate)
- **No `@modelcontextprotocol/sdk` dependency.** SDK 1.29 is ESM-only with a heavy tree (express, hono, jose, cors). Bundling that into the **CJS** Electron main under the documented asar constraint (`tsup.config.ts`) is high-risk and heavyweight for the three methods we need. Instead, a ~150-line spec-compliant JSON-RPC core + a transparent stdio proxy keeps main dependency-free and fully testable. Both ends of the stdio↔HTTP contract are ours.
- **Endpoint discovery via `~/.openreel/mcp-endpoint.json`** (Electron-free) rather than Electron's `userData` path, so the standalone shim finds it without depending on Electron.

## Not verifiable in this environment
- Live connection from Claude Desktop / an external HTTP client (needs the running desktop app + a client).
- Packaged DMG with the unpacked shim + macOS signing/notarization of the new files.

## Next
- **Phase 4** — headless / cloud agent over `HeadlessHost` + GPU-worker `runJob`.
- **Phase 5** — SSE streaming for long tools (reuse the export `MessageChannelMain` pattern), cost controls, eval suite.
