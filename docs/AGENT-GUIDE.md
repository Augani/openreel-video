# OpenReel AI Agent — User Guide

OpenReel can be edited by an AI agent of your choice. The same tool layer powers
three surfaces:

- **Web BYOK chat** — chat with a model inside the browser editor.
- **Desktop MCP server** — connect external MCP clients (Claude Desktop, Cursor,
  Cline) to the running desktop app.
- **Headless runner** — edit a stored project from a server/CLI with no app open.

All three drive the same [capability set](./AGENT-CAPABILITIES.md) (the tool
count in that generated reference is always current; the MCP panel and the
`tools/list` response report it live), plus the
`execute_action`/`batch_actions` escape hatches, so an agent can perform the
full set of project-backed edits the web editor exposes: import media, build the
timeline, trim, crop, transform, color-grade, mix audio, add
text/shapes/subtitles, keyframe, manage transitions, build Motion Creator
compositions and editable 3D scenes, and export the result.

## Bring Your Own Key (web & desktop chat)

1. Open **Settings → AI** and pick a provider (**OpenAI**, **Anthropic** or an
   OpenAI-compatible endpoint), a model, and paste your API key.
2. The chat reads the connection from the in-app AI connection store. The key is
   kept in memory for the current session only: it is not written to disk, and you
   re-enter it after restarting the app. OpenReel does not store keys on its
   servers. Requests go **directly from the app to the provider** (or to your
   endpoint) using HTTPS, or HTTP on localhost; there is no OpenReel proxy in the
   path, on web or on desktop.
3. Open or create a project, then open the **AI Editor** panel (the robot icon
   in the toolbar).
4. Use the AI settings button in the panel header to pick a provider and model.
   Choose a listed model or select **Custom model ID…** and enter any
   tool-calling model ID enabled for your provider account.
5. Describe an edit in plain language, e.g.
   _"trim the first clip to 5s, add a fade-in, and put a title card at the start."_

### Any OpenAI-compatible endpoint

Choose **OpenAI-compatible** to use a hosted alternative, self-hosted model, or
local runtime that implements the OpenAI Chat Completions tool-calling format.

1. Enter its base URL, for example `https://provider.example/v1` or
   `http://localhost:11434/v1`. Pasting the complete `/chat/completions` URL is
   also supported.
2. Enter the exact model ID exposed by that endpoint.
3. If authentication is required, add the optional **OpenAI-compatible** key in
   **Settings → API Keys**. Keyless endpoints work without secure-storage setup.

Requests go directly from the renderer to the configured endpoint and are never
relayed through an OpenReel proxy. Because the renderer makes the call, the
endpoint must allow CORS for the OpenReel origin. HTTP is accepted only for
localhost. URL credentials, query strings and fragments are rejected; put bearer
credentials in the API-key field instead.

The selected model must support the standard `tools` and `tool_calls` fields.
A text-only OpenAI-compatible model can chat, but cannot control the editor.

### Controls

- **Confirm gate** — destructive or expensive actions (delete, remove, export,
  AI jobs) pause for your approval by default.
- **Auto-approve** (shield icon) — run destructive actions without prompting.
- **Dry-run** (flask icon) — plan the tool calls without applying any mutation.
- **Undo this turn** — reverts an entire AI turn as one history entry.
- **Stop** — aborts the in-flight turn and rolls back any partial edits.
- **Token meter** — shows cumulative input/output tokens for the conversation.

The chat automatically sends only the relevant portion of OpenReel's complete
tool registry on each turn. This keeps requests within provider function limits
while retaining access to every editor domain across requests. Follow-up turns
also keep tools used earlier in the conversation available.

### Troubleshooting

- **“No API key configured”** — enter a key for the provider currently selected in
  the AI settings. The key is session-only, so it is empty after a restart.
- **401 / authentication error** — replace the stored key and confirm it belongs
  to the selected provider.
- **Model not found / unavailable** — choose a listed model, or enter the exact
  model ID enabled for your provider account. Availability can differ by account.
- **Compatible endpoint cannot be reached** — verify the base URL, ensure the
  server implements `/chat/completions`, and enable CORS when using the browser.
- **An edit needs approval** — approve the inline confirmation, or enable the
  shield toggle only for a project and key you trust.

## Connecting external agents (desktop MCP)

The desktop app runs a local Model Context Protocol server so external clients
can drive your open project, with or without a visible editor window.

The short version: open **Settings → MCP**, copy the snippet for your client, and
restart the client. The panel shows a live tool count and flips from "Waiting for
a client…" to "Connected: <client>" once an agent connects.

Full per-client setup (Claude Code, Claude Desktop, Cursor, Cline, direct HTTP),
the allowed-folders policy, the `--doctor` check and troubleshooting are in
[MCP-SETUP.md](./MCP-SETUP.md).

By default, destructive or expensive tool calls over MCP run without a prompt
(**Allow agents to delete and export without asking** is on). Turn it off in
**Settings → MCP** to have those calls refused with `CONFIRMATION_REQUIRED` until
you re-enable it.

The HTTP transport binds to `127.0.0.1` only and rejects any request without the
bearer token.

## Headless / automated edits (CLI)

The `@openreel/agent-runner` package edits a stored project with no app open —
useful for batch edits, "apply this recipe to N projects", and scheduled jobs.

```bash
openreel-agent \
  --project ./reel.json \
  --prompt "Add a title that says Welcome for the first 3 seconds" \
  --provider anthropic --model claude-sonnet-5-5 \
  --out ./reel.edited.json
```

- The API key is read from `OPENREEL_API_KEY` (or `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`) and is used per-request only — never stored or logged.
- `--dry-run` plans without applying mutations.
- In-app render/export jobs use the local web or desktop export engine. The
  headless CLI edits project files but does not submit work to a remote GPU.

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
