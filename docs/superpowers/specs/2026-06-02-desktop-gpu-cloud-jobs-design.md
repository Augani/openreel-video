# Desktop GPU Cloud Jobs — Design

**Date:** 2026-06-02
**Status:** Proposed (awaiting review)
**Supersedes/relates:** builds on `2026-06-02-electron-desktop-native-offload-design.md` (Phase 4 BYOK keychain + `cloud.fetch`); realizes the deferred "desktop cloud-auth" item.

## 1. Goal

Let the OpenReel **desktop** app use the GPU/cloud render server (`ai.openreel.video`) the same way the iOS/Android apps do — submit AI jobs (upscale, matting, reframe, stabilization, transcription, music-gen, …), track progress, and pull results back into the project. Two pieces: (1) a way for a desktop install to **earn a GPU JWT** (the one gap — there is no desktop device-attestation primitive), and (2) the **cloud-job client + a full AI panel UI** in the editor.

Decisions already made with the user:
- **Auth model:** add a `plat:"desktop"` leg to the existing Cloudflare Worker `/auth/token`, minting real short-lived (600s) ES256 JWTs keyed by a persisted install UUID, gated only by the existing single-use challenge + per-instance/IP rate limits (no device attestation — abuse is rate-limited, not prevented). The GPU worker needs **no change** (it ignores `plat`; verified `infra/gpu-worker/core/auth.py:100`).
- **Scope:** plumbing (token provider + cloud-job client) **+ a full AI panel** exposing the job kinds.

## 2. Why the client lives in the Electron main process

The desktop renderer is the `apps/web` bundle served over `app://`. A renderer `fetch` to `ai.openreel.video`, the Worker, or the R2 presigned URL is **cross-origin** and would require CORS allow-listing of `app://` on all three servers (the native mobile apps don't hit CORS). Routing every GPU/broker/R2/artifact call through the **main process** (Node `fetch`, no CORS, no preflight) avoids that entirely and matches the Phase 4 `cloud.fetch` precedent. Main also already owns the OS keychain (persist install id / cache token), native fs (`readFileBytes`, `tempFilePath`, streamed `writeChunk`), and is robust against renderer reloads.

So: **all network + token logic runs in `apps/desktop` main**; the renderer drives UX and calls `window.openreel.gpu.*` over IPC.

## 3. Architecture

```
┌── apps/web renderer (app://) ───────────────────────────────────────┐
│  AI Panel UI ── gpu-job-store (persisted) ── useGpuJobPoller (1×)    │
│        │                      │                      │              │
│        └──────── window.openreel.gpu.* (IPC, contextBridge) ────────┘
                               │
┌── apps/desktop main (Node) ──┴──────────────────────────────────────┐
│  GpuTokenProvider ──(challenge→token, cache+refresh)──► Worker /auth │
│  GpuJobClient: presign→PUT(R2)→submit→status→manifest→artifact       │
│      uses native fs for source bytes + artifact temp files          │
└──────────────────────────────────────────────────────────────────────┘
        │ Bearer <plat:"desktop" JWT> + X-Bundle-ID: com.openreel.video
        ▼
   ai.openreel.video  (GPU worker — UNCHANGED)
        ▲
   openreel-cloud Worker  (NEW desktop leg in /auth/token)
```

Shared wire types live in `packages/core/src/ai/cloud-job-types.ts` (importable by both renderer and, via relative path, the desktop client — or duplicated in desktop if cross-package import is awkward; see §9).

## 4. Component 1 — Worker `plat:"desktop"` leg (`apps/cloud`)

A challenge-only leg: the client gets a challenge, then exchanges it for a token with no attestation proof. Reuses challenge single-use + rate-limit + revocation already enforced before platform dispatch.

**Type widenings (5 sites), `"ios"|"android"` → `"ios"|"android"|"desktop"`:**
- `apps/cloud/src/auth/routes.ts:63` — `/challenge` platform validation guard.
- `apps/cloud/src/auth/kv.ts:23` — `ChallengeRecord.platform`.
- `apps/cloud/src/auth/jwt.ts:9` — `JobTokenClaims.plat`.
- `apps/cloud/src/auth/jwt.ts:37` — `mintJobToken` `params.platform`.
- `apps/cloud/src/auth/routes.ts:407` — `mintAndReturn` `platform` param.

**New dispatch + handler (`routes.ts`):**
- In `/token` (after the android branch, before the `invalid_platform` return at ~:217): `if (body.platform === "desktop") return handleDesktopToken(c, kv, challengeId, challengeRecord);`
- `handleDesktopToken(c, kv, challengeId, challengeRecord)`: `const consumed = await consumeChallenge(kv, challengeId); if (!consumed) return c.json({ error: "challenge_expired_or_used" }, 400); return mintAndReturn(c, "desktop", challengeRecord.instanceId);`. (No proof field. `instanceId` comes from the stored challenge record — not re-sent.)

**Request/response (external):**
- `POST /auth/challenge` `{ platform:"desktop", instanceId }` → `{ challengeId, challenge }`.
- `POST /auth/token` `{ platform:"desktop", challengeId }` → `{ token, exp }` (ES256, `iss=openreel-cloud`, `aud=gpu`, `scope=gpu:submit`, `plat=desktop`, `sub=sha256("instance:"+instanceId)`, ttl 600s).
- `POST /auth/upload-url` (unchanged; already platform-agnostic, only reads `sub`).

**No new bindings** — uses `AUTH_KV` + `AUTH_SIGNING_JWK` only.

**Test (`apps/cloud/src/auth/auth.test.ts`)**: mirror the ios block minus crypto — `baseEnv()`, `createAuthApp()`, `/challenge` then `/token` with `{platform:"desktop"}`, assert 200 and `verifyJobToken(publicJwkFromPrivate(env.AUTH_SIGNING_JWK), token)` yields `plat==="desktop"`, `scope==="gpu:submit"`.

**Hardening seam (documented, not built):** later require a signed challenge from a desktop keypair registered out-of-band (reuse `storeAttest`/`readAttest`) or an account session, by adding proof verification inside `handleDesktopToken`. Until then, the leg is rate-limited but unattested.

## 5. Component 2 — Desktop main GPU client (`apps/desktop`)

### 5.1 `GpuTokenProvider` (`src/main/gpu/token-provider.ts`)
- Install id: persisted UUID. Reuse the keychain (`getKeyStore().get/set("gpu-instance-id")`) or a small `userData` file; generate once.
- `getToken()`: if cached `{token, exp}` and `exp - now > 60s` → return cached; else `POST {broker}/auth/challenge {platform:"desktop", instanceId}` → `POST {broker}/auth/token {platform:"desktop", challengeId}` → cache `{token, exp}`. Single-flight (no concurrent mints). `invalidate()` clears cache; called on a 401 from the GPU host (improves on mobile, which never auto-recovers).
- Broker base URL: config (env `OPENREEL_AUTH_BROKER_BASE_URL`, default the deployed Worker — confirm host in §10). `X-Bundle-ID: com.openreel.video` on all broker calls.

### 5.2 `GpuJobClient` (`src/main/gpu/job-client.ts`)
- `uploadMedia({ srcPath, filename, contentType })`: `POST {broker}/auth/upload-url {filename, contentType}` (Bearer token) → normalize dual-shape presign (`putUrl|uploadURL`, `objectKey|mediaKey`) → stream `PUT` the file bytes to the presigned URL (Content-Type from presign headers else sniffed; **no** Bearer/X-Bundle-ID on the PUT) → return `{ mediaKey }`.
- `submitJob({ kind, params, mediaKey?, mediaFilename?, files? })`: build per the 3 variants — JSON-only (no media), JSON `{request,mediaKey,mediaFilename}` (uploaded media), or multipart (extra files). Bearer + `X-Bundle-ID` + `Accept`. → `{ jobID, status, manifestURL? }`. Honor `503 + Retry-After` (return a typed retryable error).
- `jobStatus(jobID)` → `{ jobID, status, progress, message?, manifestURL?, error?, queuePosition?, pendingAhead? }`.
- `fetchManifest(jobID)` → `AIWorkerResultManifest`.
- `downloadArtifact(jobID, relativePath)` → writes bytes to `fs.tempFilePath(ext)`, returns `{ tempPath, mime }` (renderer reads via `fs.readFileBytes`). Keeps large binaries out of IPC where possible; small artifacts may return bytes directly.
- `cancelJob(jobID)` → DELETE.
- On any GPU-host 401: `tokenProvider.invalidate()` then one retry.

### 5.3 IPC surface (`window.openreel.gpu`)
Channels in `src/shared/channels.ts` (`gpu:*`), zod schemas in `ipc-contract.ts`, handlers in `main/index.ts`, preload namespace, and `apps/web/src/types/global.d.ts` + the `packages/core` bridge slice:
```
gpu: {
  uploadMedia(args: { srcPath: string; filename: string; contentType?: string }): Promise<{ mediaKey: string }>;
  submitJob(args: { kind: string; params: Record<string, unknown>; mediaKey?: string; mediaFilename?: string }): Promise<{ jobID: string; status: string; manifestURL?: string }>;
  jobStatus(jobID: string): Promise<GpuJobStatus>;
  fetchManifest(jobID: string): Promise<GpuJobManifest>;
  downloadArtifact(jobID: string, relativePath: string): Promise<{ tempPath: string; mime: string }>;
  cancelJob(jobID: string): Promise<GpuJobStatus>;
}
```
Polling stays in the renderer (discrete `jobStatus` calls), mirroring `useKieAIPoller`; main stays free of long-lived per-job loops that a renderer reload would orphan.

**Tests** (`apps/desktop/test/gpu-*.test.ts`): pure unit tests with a mocked `fetch` + fake KeyStore — token caching/refresh/single-flight, presign dual-shape normalization, the 3 submit-body variants, 401→invalidate→retry, 503 surfaced as retryable. (`buildSubmitBody`, `normalizePresign`, etc. as pure functions.)

## 6. Component 3 — Renderer cloud-job types, store, poller

### 6.1 Wire types (`packages/core/src/ai/cloud-job-types.ts`)
Ported from the mobile catalog (exact wire strings):
- `AI_CLOUD_JOB_KINDS` const map (25 kinds; snake_case wire values — `aiHighlight:"ai_highlight"`, etc.) + `AiCloudJobKind` type.
- `AiCloudJobStatus = "queued"|"uploading"|"processing"|"completed"|"failed"|"cancelled"`; `TERMINAL = {completed,failed,cancelled}`.
- `AiCloudJobRequest { kind; params }`, `AiCloudJobCreated`, `AiCloudJobStatusResponse` (incl. optional `queuePosition`/`pendingAhead`), `AiCloudPresignResponse` (dual-shape normalizer), `AiWorkerArtifactReference` (+ `isImage/isVideo/isAudio` helpers, union of iOS+Android ext sets), `AiWorkerResultManifest`.
- `MEDIA_OPTIONAL_KINDS = {music_generation, translation}`; client requires media/mediaKey for all others (matches worker `main.py:105/387`).

### 6.2 `gpu-job-store` (`apps/web/src/stores/gpu-job-store.ts`)
Mirror `kieai-store` (persisted, key `"gpu-pending-jobs"`): `PendingGpuJob { jobID; mediaId; projectId; kind; suggestedName; createdAt; retries; failed }`; actions `addJob/removeJob/incrementRetry/markFailed/retryJob/getJobsForProject`. 3-day expiry like KieAI.

### 6.3 `useGpuJobPoller` (`apps/web/src/hooks/useGpuJobPoller.ts`)
Mounted **once** in `App.tsx` (desktop only — gate on `window.openreel?.platform==="desktop"`). Mirror `useKieAIPoller`: recursive `setTimeout` (2s base), in-flight/timer guards, re-read job state from the store to avoid stale closures, Android-style transient retry (HTTP 5xx/408/429 + network error, ≤5 consecutive, exp backoff capped 15s), overall 30-min cap → mark failed. On `completed`: `fetchManifest` → pick primary artifact → `downloadArtifact` → `readFileBytes(tempPath)` → re-import (see §7). On `failed`/`cancelled`: `markFailed` + set the asset's pending/error flags.

## 7. Component 4 — Media in/out + AI Panel UI (`apps/web`)

### 7.1 Source bytes & result re-import (`packages/core/src/media`)
- Input: selected clip → `clip.mediaId` → `getMediaItem` → `blob` (rehydrate via `loadMediaBlob` if null after reload) → on desktop, materialize to a temp file (export `materializeToTemp` from `native-media-bridge.ts`) → pass `srcPath` to `gpu.uploadMedia`.
- Output: `downloadArtifact` temp path → `readFileBytes` → `Blob`. For image results reuse `replacePlaceholderMedia`; for video/audio results use the general `importMedia(file)` path (generalize `replacePlaceholderMedia`, which today hardcodes `type:"image"`, OR route non-image results through `importMedia`). `MediaItem.type` stays `video|audio|image`.

### 7.2 AI Panel
A new **top-level panel** (`ui-store` `PanelId` `"ai"` + `DEFAULT_PANELS` entry + an `EditorInterface.tsx` grid region gated on `panels.ai.visible`, mirroring `audioMixer`), toggled from the toolbar, **desktop-only**. Contents:
- Kind catalog grouped (Enhance/Restore: upscale, denoise, face_restore, photo_enhance, colorize; Cut-out: background_removal, person_matting, object_removal; Motion: stabilization, auto_reframe, frame_interpolation; Analyze: transcription, auto_captions, scene_detection, face_analysis, object_tracking, smart_thumbnail, ai_highlight; Audio: audio_separation, voice_enhance, silence_removal; Generate: music_generation, translation, color_match, portrait_bokeh). Each kind: a tiny params form (most are param-light; `context` populated from the selected clip — projectID/clipID/mediaID/renderSize/sourceDuration/sourceFrameRate/quality, sent under `params.context` per worker hoist precedence).
- Submit flow: validate input (selected clip required unless kind ∈ `MEDIA_OPTIONAL_KINDS`) → `addPlaceholderMedia` (pending) → `uploadMedia` (if media) → `submitJob` → `gpu-job-store.addJob`. Progress/error surface on the asset (reuse `isPending`/`kieaiError` or parallel `gpuError` flags) + a jobs list in the panel. Result becomes a new media item; user can drop it on the timeline (`addClip`/`addClipToNewTrack`).

Param forms are intentionally minimal in v1 (kind + context + a couple of per-kind options); the panel is extensible per kind.

## 8. Error handling & edge cases
- **Token:** single-flight mint; 60s refresh leeway; 401 → invalidate + one retry. Broker 429 → surface "rate limited, retry shortly".
- **Submit 503 + Retry-After:** poller/submit honors `Retry-After`, exponential backoff.
- **Worker has no 408:** the 30-min cap is enforced **client-side** (poller), then job marked failed/timed-out.
- **Input deleted post-job** (worker deletes the uploaded `mediaKey`): never re-reference it after submit.
- **Artifacts TTL 24h + worker is in-memory** (restart → 404 on poll): treat 404-after-known-job as failed/expired; download promptly on completion.
- **mediaKey prefix:** must start with the presign-issued prefix (`jobs/…`); always use the key returned by presign verbatim.
- **`>150MB` video:** v1 may skip the mobile HEVC pre-compress (note as follow-up); the native sidecar `transcode` could provide it later.

## 9. Code placement & sharing
- Wire types: `packages/core/src/ai/cloud-job-types.ts` (single source). The desktop main client imports them via the workspace package if the build allows; otherwise duplicate the small type file in `apps/desktop` (documented duplication, as with `cloud.ts`’s `DIRECT_CONFIG`).
- Desktop client: `apps/desktop/src/main/gpu/{token-provider,job-client}.ts` + IPC wiring.
- Renderer: `apps/web/src/stores/gpu-job-store.ts`, `apps/web/src/hooks/useGpuJobPoller.ts`, `apps/web/src/components/editor/ai-panel/*`, plus `ui-store`/`EditorInterface`/`global.d.ts` edits and a `packages/core` bridge-slice extension for the new `fs`/`gpu` methods.

## 10. Open items to confirm before/while building
- **Broker production host** for desktop config: iOS uses `https://api.openreel.video`; web `api-endpoints.ts` uses `https://openreel-cloud.niiyeboah1996.workers.dev`. Pick the canonical one for `OPENREEL_AUTH_BROKER_BASE_URL` (default) — likely the same Worker. (Auth-broker-deployed memo has the live URL.)
- **CORS not needed** because calls go through main — confirmed by design.
- **Deploy:** the Worker change must be deployed (`apps/cloud`) for desktop tokens to mint; until then desktop AI is non-functional. GPU worker unchanged.
- **`>150MB` pre-compression** deferred to follow-up.

## 11. Phasing (for the plan)
- **Phase A — Worker desktop leg** (`apps/cloud`): widen 5 types, `handleDesktopToken`, dispatch, unit test. Independently shippable + deployable.
- **Phase B — Desktop main GPU client** (`apps/desktop`): token provider, job client, IPC, preload, types; unit tests with mocked fetch.
- **Phase C — Renderer types + store + poller** (`packages/core` + `apps/web`): wire types, gpu-job-store, useGpuJobPoller, media in/out helpers; unit tests.
- **Phase D — AI Panel UI** (`apps/web`): top-level panel, kind catalog, submit/progress/result-to-timeline. Component tests where practical; full end-to-end render needs the deployed Worker + a real desktop run (human).

## 12. Out of scope
Server-side accounts/login (the account-backed broker leg), mobile changes, `>150MB` HEVC pre-compress, per-kind advanced parameter UIs beyond the minimal set, and any GPU-worker code change.
