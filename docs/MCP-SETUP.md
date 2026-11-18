# Connecting an agent to OpenReel (MCP)

The OpenReel desktop app runs a local [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP client can create projects, import media, edit, and export through the same tools as the built-in chat. The app does not need an editor window in front, or even visible.

Everything below is also in the app: **Settings → MCP** has live copy buttons, a live tool count and a connection indicator, and first-run onboarding offers the same steps as a "Connect an agent" card.

## How it works

```
MCP client  --stdio-->  openreel-mcp shim  --HTTP (127.0.0.1 + bearer token)-->  OpenReel desktop app
```

- The app listens on loopback only (`127.0.0.1`, a random port) and requires a bearer token on every request.
- On launch it writes `~/.openreel/mcp-endpoint.json` (mode 0600) with the URL and token. Set `OPENREEL_MCP_ENDPOINT_FILE` to use another path, and `OPENREEL_MCP_PORT` to pin the port.
- The **shim** is a small Node script that speaks stdio to your client and forwards each message to the app. It re-reads the endpoint file on every request, so it keeps working after you rotate the token or restart the app.
- If the editor window is closed (on macOS the app keeps running with no windows), the first tool call opens a hidden editor window. It stays hidden until you bring the app forward.

Protocol: the server speaks MCP revisions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`, and negotiates the highest revision both sides support. Tools carry annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), results include `structuredContent`, and `initialize` returns usage `instructions` for the agent.

Requirements: Node 18 or newer on the machine that runs your MCP client.

## Find the shim path

Open **Settings → MCP**. The snippets there already contain your real path. For reference:

| Install | Shim path |
| --- | --- |
| macOS app | `/Applications/OpenReel.app/Contents/Resources/app.asar.unpacked/dist/mcp-shim/index.js` |
| Windows / Linux app | `<install dir>/resources/app.asar.unpacked/dist/mcp-shim/index.js` |
| Development build | `apps/desktop/dist/mcp-shim/index.js` |

If a path contains spaces, quote it in a shell. The snippets in the app do this for you.

## Claude Code

```bash
claude mcp add openreel -- node /path/to/mcp-shim/index.js
```

Check with `claude mcp list`, then ask Claude Code to "list the tools OpenReel gives you".

## Claude Desktop

Edit the config file, add the server, then fully quit and reopen Claude Desktop.

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openreel": {
      "command": "node",
      "args": ["/path/to/mcp-shim/index.js"]
    }
  }
}
```

## Cursor

Add the same JSON to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` in a project, then reload Cursor.

## Cline

Open Cline's **MCP Servers** panel, choose **Configure MCP Servers**, and add the same `mcpServers` entry to the settings file it opens.

## Direct HTTP

For clients that speak HTTP directly, use the URL and token from **Settings → MCP**:

```
POST http://127.0.0.1:<port>/mcp
Authorization: Bearer <token>
Content-Type: application/json
```

The body is a JSON-RPC 2.0 message. Only `POST` is supported. Rotating the token in **Settings → MCP** invalidates the old one immediately.

## What an agent can do without a window

A typical windowless run:

1. `get_app_state` to see whether a project is open and which folders are allowed.
2. `create_project`, or `open_project_file` for an existing `.openreel` file.
3. `import_media_from_path` with absolute file or folder paths.
4. Edit with the typed tools. `get_capabilities` lists valid enums and ranges.
5. `get_export_options`, then `export_video` with an `outputPath`.
6. Poll `get_render_status` or `list_export_jobs` for long exports.

The full tool list is generated from the registry in [AGENT-CAPABILITIES.md](./AGENT-CAPABILITIES.md). The live count is shown in **Settings → MCP**.

## Safety

- **Allowed folders.** Agents can only read media from, and write exports to, a short list of folders: Movies, Music, Pictures, Documents, Downloads, Desktop, and the open project's folder. Edit the list in **Settings → MCP → Allowed folders**. Anything else fails with `OUTSIDE_ALLOWED_ROOTS`.
- **Confirmation.** **Allow agents to delete and export without asking** is on by default so existing setups keep working. Turn it off and destructive or expensive calls are refused with `CONFIRMATION_REQUIRED` until you turn it back on.
- **Token.** Treat it like a password. Rotate it in **Settings → MCP** if it leaks.

## Errors

Failures come back as ordinary tool results with `isError: true`, a `code`, and a `hint` that names the fix. They are not protocol errors, so the agent can read them and recover.

| Code | Meaning |
| --- | --- |
| `NO_PROJECT` | No project is open. Call `create_project` or `open_project_file`. |
| `NO_WINDOW` | The editor surface could not be created. Restart OpenReel. |
| `NOT_FOUND` | The id or path does not exist. |
| `OUTSIDE_ALLOWED_ROOTS` | The path is outside the allowed folders. |
| `UNSUPPORTED_TYPE` | The file type is not supported. |
| `UNREADABLE` | The file exists but cannot be read. |
| `UNSUPPORTED` | The option combination is not available. The hint lists valid ones. |
| `INVALID_PARAMS` | The arguments do not match the tool's schema. |
| `TIMEOUT` | The editor did not answer in time. Long jobs keep running; poll for status. |
| `CONFIRMATION_REQUIRED` | The safety toggle is off. |
| `TOOL_ERROR` | The tool ran and failed. Check the arguments and the project state. |
| `RENDERER_ERROR` | The editor reported an error while running the tool. Retry once. |
| `UNAVAILABLE` | OpenReel is shutting down or restarting. Wait a few seconds and retry. |
| `INTERNAL_ERROR` | An unexpected failure. Retry once, then restart OpenReel. |

## Troubleshooting

Run the doctor. It checks Node, the endpoint file, the server, the token and `tools/list`, and says which step fails:

```bash
node /path/to/mcp-shim/index.js --doctor
```

| Symptom | Cause and fix |
| --- | --- |
| "OpenReel isn't running. Start the app and retry." | The app is closed, or the endpoint file is missing. Start OpenReel. The shim retries on the next request, so you do not need to restart the client. |
| Client shows the server as failed at startup | Wrong path in the config, or Node is older than 18. Copy the snippet from **Settings → MCP** and run `--doctor`. |
| HTTP 401 | The token changed. The shim re-reads the endpoint file and retries once on its own. A direct HTTP client must use the new token. |
| Connection refused | A stale endpoint file after a crash. Start OpenReel; it rewrites the file. |
| "The server could not start" in **Settings → MCP** | The port is taken. Quit other OpenReel instances, or set `OPENREEL_MCP_PORT` to a free port and relaunch. |
| Panel stays on "Waiting for a client…" | No client has sent `initialize` yet. Restart the client, and confirm it lists OpenReel. |
| First call is slow after closing every window | A hidden editor window is starting. Later calls are fast. |
| `TIMEOUT` on an export | The job is still running. Poll `get_render_status` or `list_export_jobs`. |
