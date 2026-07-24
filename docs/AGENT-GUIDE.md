# OpenReel AI Agent — User Guide

OpenReel can be edited by an AI agent of your choice. The same tool layer powers
three surfaces:

- **Web BYOK chat** — chat with a model inside the browser editor.
- **Desktop MCP server** — connect external MCP clients (Claude Desktop, Cursor,
  Cline) to the running desktop app.
- **Headless runner** — edit a stored project from a server/CLI with no app open.

All three drive the same [capability set](./AGENT-CAPABILITIES.md) (72 tools +
`execute_action`/`batch_actions` escape hatches), so an agent can do anything a
professional editor can: import media, build the timeline, trim, crop,
transform, color-grade, add text/shapes, keyframe, manage transitions, and more.

## Bring Your Own Key (web & desktop chat)

1. Open **Settings → API Keys** and add an OpenAI or Anthropic key. On the web,
   keys are encrypted at rest behind a master password; on desktop they live in
   the OS keychain. **Keys are never sent to or stored on OpenReel servers** —
   in production the web app proxies requests same-origin without persisting the
   key; on desktop the request goes through the native keychain.
2. Open the **AI Editor** panel (the robot icon in the toolbar).
3. Pick a provider and model in the panel header.
4. Describe an edit in plain language, e.g.
   _"trim the first clip to 5s, add a fade-in, and put a title card at the start."_

### Controls

- **Confirm gate** — destructive or expensive actions (delete, remove, export,
  AI jobs) pause for your approval by default.
- **Auto-approve** (shield icon) — run destructive actions without prompting.
- **Dry-run** (flask icon) — plan the tool calls without applying any mutation.
- **Undo this turn** — reverts an entire AI turn as one history entry.
- **Stop** — aborts the in-flight turn and rolls back any partial edits.
- **Token meter** — shows cumulative input/output tokens for the conversation.

## Connecting external agents (desktop MCP)

The desktop app runs a local Model Context Protocol server so external clients
can drive your open project.

1. Open **Settings → MCP** (desktop only).
2. The panel shows the loopback URL and a bearer token (rotate it any time).
3. Copy the client config snippet into your MCP client. It points at the bundled
   `openreel-mcp` stdio shim, which bridges your client to the running app:

   ```json
   {
     "mcpServers": {
       "openreel": { "command": "node", "args": ["<path to openreel-mcp>"] }
     }
   }
   ```

4. By default, destructive/expensive tool calls over MCP are refused with a
   "confirmation required" notice. Enable **Trusted local — auto-allow** to let
   trusted local clients run them.
5. Use **Test connection** to verify the server is reachable.

The HTTP transport binds to `127.0.0.1` only and rejects any request without the
bearer token.

## Headless / automated edits (CLI)

The `@openreel/agent-runner` package edits a stored project with no app open —
useful for batch edits, "apply this recipe to N projects", and scheduled jobs.

```bash
openreel-agent \
  --project ./reel.json \
  --prompt "Add a title that says Welcome for the first 3 seconds" \
  --provider anthropic --model claude-sonnet-4-20250514 \
  --out ./reel.edited.json
```

- The API key is read from `OPENREEL_API_KEY` (or `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`) and is used per-request only — never stored or logged.
- `--dry-run` plans without applying mutations.
- Render/export jobs are delegated to the GPU worker, authorized by the auth
  broker; a built-in export queue can drive multiple exports concurrently
  ("export these N variants").

## Safety & limits

- **Atomic turns** — every turn is one undoable transaction; a fatal error rolls
  back the whole turn.
- **Cost ceiling** — an optional per-turn token budget stops a runaway turn.
- **Rate limiting** — provider 429/5xx responses are retried with exponential
  backoff.

## Reference

- [Capability reference](./AGENT-CAPABILITIES.md) — every tool, auto-generated
  from the registry.
- Design: `docs/superpowers/specs/2026-06-18-ai-agent-editing-design.md`.
