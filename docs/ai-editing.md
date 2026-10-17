# AI editing workspace

Choose **AI editing** in the editor toolbar. Media remains on the left, the existing preview is in the center, chat is on the right, and the existing timeline stays below. **Manual** restores the inspector. Panel dividers support keyboard arrows; narrower desktop widths stack chat below the preview.

## Connect a model

Open **Settings → AI Editor** (or the chat panel’s **AI settings** button), choose OpenAI, Anthropic, or an OpenAI-compatible/local adapter, and enter a base URL, tool-capable model ID, and optional local-server key. OpenAI and Anthropic require a key. Configuration and keys live only in this tab's memory; reload or **Forget key** clears the key. They are not saved in project documents or browser storage.

Requests go directly to the chosen endpoint, with redirects rejected and no application proxy. Remote endpoints require HTTPS; localhost permits HTTP. The endpoint must allow browser CORS. A vision model is needed for the optional preview-image tool. Media files are not uploaded by the tool catalog; project metadata, text, and explicitly requested preview frames are sent to the model. Arbitrary model names work with the selected API protocol; this is not a guarantee that every provider supports browser calls or tools.

## Edit and revise

The closed, validated catalog supports media and timeline inspection, tracks, adding/removing/moving/trimming/splitting clips, speed/reverse/pitch correction, transforms/crop/opacity, volume/fades, built-in video and audio effects, text and supplied subtitles, keyframes, transitions, markers, project settings, reusable presets, preview inspection, and opening the existing export dialog. IDs identify individual elements. Tracks composite from the first track on top to the last underneath.

Each turn uses the existing agent loop and core action executor on an isolated draft. A successful turn commits one snapshot through the existing history. Preview, title/effects/transition engines synchronize before React sees that snapshot. **Undo last AI turn** only operates if that turn is still the latest action; ordinary undo/redo remains available. Rejected transition preflight checks can be corrected in the same turn by explicitly referencing the failed call; every pending failure must be repaired before commit. Unresolved or fatal tool failures, cancellation, truncated replies, budgets, or intervening user changes discard the draft. Cancelled or failed conversations are cleared from the next model request so pending changes cannot be mistaken for committed state.

## Share edits

**Edit JSON & reusable presets** exports `openreel-edit` version 2, a typed timeline/project document with stable element IDs and local-media references. It excludes blobs, file handles, thumbnails, URLs, provider settings, credentials, and agent instructions. A version-1 migration renames `assets` to `media`. Import validates size, depth, fields, ranges, IDs, references, source spans, effect parameters, and adjacency before replacing the edit in one undo step.

Share original media separately. Existing local assets are matched by ID or a unique filename/size hint. Missing files become explicit placeholders; relinking decodes the chosen file, checks source ranges, preserves IDs, and commits one undo step. Import performs no network fetch. Preset version 1 shares a built-in look and/or transition; applying it generates fresh IDs and preserves unrelated clips.

Portable JSON currently covers media clips, text, supplied captions, markers, numeric built-in effects, and transitions. Projects using graphics, SVG/stickers, masks, adjustment layers, nested/multicam/motion/creation scenes, or unsupported properties must use the ordinary project format; portable export rejects those instead of silently dropping them. AI editing preserves existing unsupported project data, but its catalog does not expose arbitrary scripts, shaders, URL media, automatic transcription, or generative-media services. `open_export` opens local settings; encoding starts when the user chooses **Start Export**.

## Verification

Run `pnpm build`, web `typecheck`/`lint`, and core/agent/web `test:run`. Unit tests exercise strict documents and migrations, runtime media preservation, stale-state detection, atomic failures/cancellation/budgets, unknown tools and values, transport safety, custom models, and credential-safe error handling.

`scripts/verify-ai-workspace.cjs` uses installed Playwright and system Chromium. Run from the repository root against a running web server:

```bash
OPENREEL_BROWSER_URL=http://127.0.0.1:5173 OPENREEL_EVIDENCE_DIR=/tmp/openreel-ai-evidence node scripts/verify-ai-workspace.cjs
```

The evidence directory must contain `sample-video.mp4` (4 seconds), `sample-still.png`, and `sample-audio.wav` (4 seconds). The fixture endpoint is intercepted locally; all other external HTTPS requests are blocked. No paid/live model is called. The test imports files through the UI, constructs/imports JSON, checks a visible targeted title revision, undo/redo, roundtrip, malformed-document rejection, presets, multi-tool failure, cancellation, stale-state rejection, relinking, responsive screenshots, actual WebM export, and key clearing on reload. Inspect the exported file with ffprobe/ffmpeg as well as screenshots. Live-provider compatibility remains unverified without a user-supplied key.

Sample footage: Sintel trailer, Blender Foundation (2010), served by W3C at https://media.w3.org/2010/05/sintel/trailer.mp4, referenced at https://www.w3.org/2010/05/video/mediaevents.html. The test excerpt is seconds 15–19 resized to 640×360, with a derived still and a generated 440 Hz sine wave. Attribution/license: https://durian.blender.org/about/ (CC BY 3.0). The exported verification clip adds title, effects, overlay, transition, and tone to that excerpt.
