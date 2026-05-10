# Codex Local Provider

OpenReel can use a local Codex bridge as an AI provider for workflows that should run through a local agent instead of a hosted API key.

## What It Adds

- `Codex Local` as an AI Assistant (LLM) provider.
- `Codex Local` as an AI Aggregator option for image generation workflows.
- A loopback-only browser client. OpenReel rejects non-local bridge URLs.
- An optional development bridge script for text enhancement through `codex exec`.

## Run The Development Bridge

Install the Codex CLI and start OpenReel in another terminal, then run:

```bash
pnpm codex:bridge
```

The default bridge URL is:

```text
http://127.0.0.1:14567
```

Open Settings -> General, choose `Codex Local` for the AI Assistant provider, and keep the bridge URL pointed at the loopback address.

## Bridge Contract

Text enhancement uses:

```http
POST /v1/text
Content-Type: application/json

{
  "system": "System instruction",
  "prompt": "User text"
}
```

The bridge should return one of these response shapes:

```json
{ "text": "Result text" }
```

```json
{ "output_text": "Result text" }
```

```json
{ "choices": [{ "message": { "content": "Result text" } }] }
```

Image generation and image editing use:

```http
POST /v1/images/edits
Content-Type: multipart/form-data
```

Fields:

- `prompt`: required text prompt.
- `aspectRatio`: optional ratio such as `16:9`, `1:1`, or `auto`.
- `source`: optional source image file.

The bridge may return an image response directly, or JSON containing `dataUrl`, `imageUrl`, `url`, `b64_json`, `images[0]`, or `data[0]`.

The included development bridge currently implements `/health` and `/v1/text`. Image-capable bridges can implement the same `/v1/images/edits` contract and OpenReel will consume the result.

## Security Notes

- Keep the bridge bound to `127.0.0.1` or `localhost`.
- Do not expose the bridge on a LAN or public interface.
- The included bridge uses an origin allowlist and a small request body limit.
- `codex exec` is launched without shell interpolation and with read-only sandboxing.
- OpenReel does not send Codex Local requests through the Cloudflare proxy.
