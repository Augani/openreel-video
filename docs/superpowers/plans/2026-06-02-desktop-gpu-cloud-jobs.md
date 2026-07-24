# Desktop GPU Cloud Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the OpenReel desktop app submit AI jobs to the GPU render server (`ai.openreel.video`) — earn a `plat:"desktop"` JWT via the Cloudflare Worker, run the job client in the Electron main process (to dodge `app://` CORS), and expose a full AI panel in the editor.

**Architecture:** Worker gets a challenge-only `plat:"desktop"` leg in `/auth/token` (5 type-widenings + one handler + test; no GPU-worker change — it ignores `plat`). The Electron main process runs the token provider + job client (presign→PUT→submit→poll→manifest→artifact) and exposes `window.openreel.gpu.*` over IPC. The renderer ports the wire types into `packages/core`, drives polling with a `gpu-job-store` + `useGpuJobPoller` (mirroring the existing KieAI pattern), and surfaces a desktop-only top-level "AI" panel.

**Tech Stack:** Hono + jose (Worker), Electron main (Node `fetch` + `node:fs`), tsup CJS bundle, zod IPC contracts, React 18 + Zustand + Immer (renderer), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-02-desktop-gpu-cloud-jobs-design.md`.

**Conventions (project CLAUDE.md):** no line comments / no JSDoc except public-API; explicit return types on exported functions; avoid `any`; defensive guards + early returns; Conventional Commit messages; run typecheck + tests before each commit. Per-package commands: `pnpm --filter @openreel/desktop {typecheck,build,test:run}`, `pnpm --filter @openreel/web {typecheck,test:run}`, `pnpm --filter @openreel/core test:run`, and for the Worker `cd apps/cloud && npm test` (or `pnpm --filter` if it has a test script — verify in package.json; the auth tests run under vitest).

---

## File Structure

**Phase A — Worker (`apps/cloud`)**
- Modify `apps/cloud/src/auth/jwt.ts` — widen `JobTokenClaims.plat` (:9) and `mintJobToken` param (:37).
- Modify `apps/cloud/src/auth/kv.ts` — widen `ChallengeRecord.platform` (:23).
- Modify `apps/cloud/src/auth/routes.ts` — widen `/challenge` guard (:63) + `mintAndReturn` param (:407); add `handleDesktopToken` + dispatch (:~216).
- Modify `apps/cloud/src/auth/auth.test.ts` — add a `desktop` describe block.

**Phase B — Desktop main GPU client (`apps/desktop`)**
- Create `apps/desktop/src/main/gpu/token-provider.ts` — `GpuTokenProvider` (challenge→token, cache, single-flight, invalidate).
- Create `apps/desktop/src/main/gpu/job-client.ts` — `GpuJobClient` + pure helpers `normalizePresign`, `buildSubmitBody`.
- Create `apps/desktop/src/main/gpu/instance-id.ts` — persisted install UUID (keychain-backed).
- Modify `apps/desktop/src/shared/channels.ts` — `gpu:*` channels.
- Modify `apps/desktop/src/shared/ipc-contract.ts` — zod schemas.
- Modify `apps/desktop/src/main/index.ts` — construct client + register handlers.
- Modify `apps/desktop/src/preload/index.ts` — `gpu` namespace.
- Modify `apps/web/src/types/global.d.ts` — `gpu` types on `window.openreel`.
- Create tests `apps/desktop/test/gpu-token-provider.test.ts`, `apps/desktop/test/gpu-job-client.test.ts`.

**Phase C — Renderer types + store + poller (`packages/core` + `apps/web`)**
- Create `packages/core/src/ai/cloud-job-types.ts` — wire enums/types + helpers.
- Create `packages/core/src/ai/cloud-job-types.test.ts`.
- Modify `packages/core/src/media/native-media-bridge.ts` — export `materializeToTemp` + `readBackBlob`; add `gpu` to the bridge slice type.
- Create `apps/web/src/stores/gpu-job-store.ts` + test.
- Create `apps/web/src/services/gpu-jobs.ts` — renderer facade (submit-for-clip, result import).
- Create `apps/web/src/hooks/useGpuJobPoller.ts` + test.
- Modify `apps/web/src/App.tsx` — mount the poller once (desktop only).

**Phase D — AI Panel UI (`apps/web`)**
- Create `apps/web/src/components/editor/ai-panel/ai-kinds.config.ts` — kind catalog/grouping.
- Create `apps/web/src/components/editor/ai-panel/AIPanel.tsx` + `AIJobList.tsx`.
- Modify `apps/web/src/stores/ui-store.ts` — `PanelId "ai"` + `DEFAULT_PANELS`.
- Modify `apps/web/src/components/editor/EditorInterface.tsx` — mount the panel region.
- Modify the editor toolbar — a desktop-only toggle button.

---

# PHASE A — Worker `plat:"desktop"` leg

### Task A1: Widen platform types to include `"desktop"`

**Files:**
- Modify: `apps/cloud/src/auth/jwt.ts:9`, `apps/cloud/src/auth/jwt.ts:37`
- Modify: `apps/cloud/src/auth/kv.ts:23`
- Modify: `apps/cloud/src/auth/routes.ts:63`, `apps/cloud/src/auth/routes.ts:407`

- [ ] **Step 1: Widen `jwt.ts` types**

In `apps/cloud/src/auth/jwt.ts`, change the `JobTokenClaims` interface:
```ts
export interface JobTokenClaims extends JWTPayload {
  plat: "ios" | "android" | "desktop";
  scope: string;
}
```
and the `mintJobToken` signature:
```ts
export async function mintJobToken(
  signingJwk: string,
  params: { platform: "ios" | "android" | "desktop"; subject: string },
): Promise<{ token: string; exp: number; jti: string }> {
```

- [ ] **Step 2: Widen `kv.ts` `ChallengeRecord`**

In `apps/cloud/src/auth/kv.ts`, change the `ChallengeRecord` interface field:
```ts
  platform: "ios" | "android" | "desktop";
```

- [ ] **Step 3: Widen `routes.ts` `/challenge` guard and `mintAndReturn`**

In `apps/cloud/src/auth/routes.ts`, change the `/challenge` validation (currently at :63):
```ts
    if (
      body.platform !== "ios" &&
      body.platform !== "android" &&
      body.platform !== "desktop"
    ) {
      return c.json({ error: "invalid_platform" }, 400);
    }
```
and the `mintAndReturn` signature (currently at :407):
```ts
async function mintAndReturn(
  c: Context<{ Bindings: Bindings }>,
  platform: "ios" | "android" | "desktop",
  instanceId: string,
): Promise<Response> {
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/cloud && npx tsc --noEmit`
Expected: PASS (no new errors; the `handleDesktopToken` reference does not exist yet — it is added in A2, so do A2 before committing).

(No commit yet — A1 + A2 land together because the dispatch in A2 is what exercises these widenings.)

### Task A2: Add `handleDesktopToken` + dispatch + test (TDD)

**Files:**
- Modify: `apps/cloud/src/auth/routes.ts` (dispatch at :211-217 region; new `handleDesktopToken` near the other handlers)
- Modify: `apps/cloud/src/auth/auth.test.ts` (new describe block)

- [ ] **Step 1: Write the failing test**

In `apps/cloud/src/auth/auth.test.ts`, locate the existing imports and `baseEnv()` helper used by the ios/android blocks. Add this describe block (mirror the existing test style — `app.request(path, init, env as never)`):
```ts
describe("desktop token leg", () => {
  it("mints a plat:desktop JWT from a challenge with no attestation", async () => {
    const { env } = await baseEnv();
    const app = createAuthApp();

    const challengeRes = await app.request(
      "/challenge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bundle-ID": "com.openreel.video" },
        body: JSON.stringify({ platform: "desktop", instanceId: "desktop-instance-1" }),
      },
      env as never,
    );
    expect(challengeRes.status).toBe(200);
    const { challengeId } = (await challengeRes.json()) as { challengeId: string };

    const tokenRes = await app.request(
      "/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bundle-ID": "com.openreel.video" },
        body: JSON.stringify({ platform: "desktop", challengeId }),
      },
      env as never,
    );
    expect(tokenRes.status).toBe(200);
    const tok = (await tokenRes.json()) as { token: string; exp: number };
    expect(typeof tok.token).toBe("string");

    const claims = await verifyJobToken(
      JSON.stringify(publicJwkFromPrivate(env.AUTH_SIGNING_JWK as string)),
      tok.token,
    );
    expect(claims.plat).toBe("desktop");
    expect(claims.scope).toBe(JWT_SCOPE);
  });

  it("rejects a reused (already-consumed) challenge", async () => {
    const { env } = await baseEnv();
    const app = createAuthApp();
    const ch = await (
      await app.request(
        "/challenge",
        { method: "POST", headers: { "Content-Type": "application/json", "X-Bundle-ID": "com.openreel.video" }, body: JSON.stringify({ platform: "desktop", instanceId: "d2" }) },
        env as never,
      )
    ).json() as { challengeId: string };
    const init = { method: "POST", headers: { "Content-Type": "application/json", "X-Bundle-ID": "com.openreel.video" }, body: JSON.stringify({ platform: "desktop", challengeId: ch.challengeId }) };
    const first = await app.request("/token", init, env as never);
    expect(first.status).toBe(200);
    const second = await app.request("/token", init, env as never);
    expect(second.status).toBe(400);
  });
});
```
Ensure the test file imports `verifyJobToken`, `publicJwkFromPrivate`, and `JWT_SCOPE` from `./jwt` (the ios block already imports `verifyJobToken`/`publicJwkFromPrivate`; add `JWT_SCOPE` to that import if missing).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/cloud && npx vitest run src/auth/auth.test.ts -t "desktop token leg"`
Expected: FAIL — `/token` returns 400 `invalid_platform` (no desktop branch yet).

- [ ] **Step 3: Add the dispatch branch + handler**

In `apps/cloud/src/auth/routes.ts`, inside the `/token` handler, the dispatch currently reads:
```ts
    if (body.platform === "ios") {
      return handleIosToken(c, kv, body, challengeId, challengeRecord);
    }
    if (body.platform === "android") {
      return handleAndroidToken(c, kv, body, challengeId, challengeRecord, testDecoder);
    }
    return c.json({ error: "invalid_platform" }, 400);
```
Insert a desktop branch before the final return:
```ts
    if (body.platform === "desktop") {
      return handleDesktopToken(c, kv, challengeId, challengeRecord);
    }
    return c.json({ error: "invalid_platform" }, 400);
```
Then add the handler near `handleAndroidToken`:
```ts
async function handleDesktopToken(
  c: Context<{ Bindings: Bindings }>,
  kv: KVNamespaceLike,
  challengeId: string,
  challengeRecord: { challenge: string; instanceId: string },
): Promise<Response> {
  const consumed = await consumeChallenge(kv, challengeId);
  if (!consumed) {
    return c.json({ error: "challenge_expired_or_used" }, 400);
  }
  return mintAndReturn(c, "desktop", challengeRecord.instanceId);
}
```
(`consumeChallenge`, `KVNamespaceLike`, `mintAndReturn`, and `Context` are already imported/defined in this file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/cloud && npx vitest run src/auth/auth.test.ts -t "desktop token leg"`
Expected: PASS (2 tests).

- [ ] **Step 5: Full Worker typecheck + test suite**

Run: `cd apps/cloud && npx tsc --noEmit && npx vitest run`
Expected: PASS, no regressions in the ios/android auth tests.

- [ ] **Step 6: Commit**

```bash
git add apps/cloud/src/auth/jwt.ts apps/cloud/src/auth/kv.ts apps/cloud/src/auth/routes.ts apps/cloud/src/auth/auth.test.ts
git commit -m "feat(cloud): plat:desktop challenge-only leg in /auth/token (mint GPU JWT for desktop)"
```

---

# PHASE B — Desktop main GPU client

> All Phase B files are TypeScript bundled by tsup (CJS, Node target). Use Node globals (`fetch`, `crypto.randomUUID`, `node:fs/promises`). Mock `fetch` in tests via dependency injection (`fetchFn` param) — never hit the network.

### Task B1: `GpuTokenProvider` (TDD)

**Files:**
- Create: `apps/desktop/src/main/gpu/token-provider.ts`
- Test: `apps/desktop/test/gpu-token-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/gpu-token-provider.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { GpuTokenProvider } from "../src/main/gpu/token-provider";

function fakeFetch(responses: Array<{ ok: boolean; status: number; json: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.ok, status: r.status, json: async () => r.json } as unknown as Response;
  });
  return { fn, calls };
}

const okChallenge = { ok: true, status: 200, json: { challengeId: "ch1", challenge: "abc" } };
const okToken = (exp: number) => ({ ok: true, status: 200, json: { token: "tok", exp } });

describe("GpuTokenProvider", () => {
  it("mints via challenge then token and caches until near expiry", async () => {
    const now = () => 1_000_000; // ms
    const exp = Math.floor(now() / 1000) + 600;
    const { fn, calls } = fakeFetch([okChallenge, okToken(exp)]);
    const p = new GpuTokenProvider({
      brokerBaseUrl: "https://broker.test",
      bundleId: "com.openreel.video",
      instanceId: "inst-1",
      fetchFn: fn as unknown as typeof fetch,
      now,
    });
    expect(await p.getToken()).toBe("tok");
    expect(await p.getToken()).toBe("tok"); // cached, no new mint
    expect(calls.filter((c) => c.url.endsWith("/auth/challenge")).length).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/auth/token")).length).toBe(1);
    const chBody = JSON.parse(calls[0].init!.body as string);
    expect(chBody).toEqual({ platform: "desktop", instanceId: "inst-1" });
    const tokBody = JSON.parse(calls[1].init!.body as string);
    expect(tokBody).toEqual({ platform: "desktop", challengeId: "ch1" });
  });

  it("re-mints after invalidate()", async () => {
    const now = () => 1_000_000;
    const exp = Math.floor(now() / 1000) + 600;
    const { fn, calls } = fakeFetch([okChallenge, okToken(exp), okChallenge, okToken(exp)]);
    const p = new GpuTokenProvider({ brokerBaseUrl: "https://b", bundleId: "x", instanceId: "i", fetchFn: fn as unknown as typeof fetch, now });
    await p.getToken();
    p.invalidate();
    await p.getToken();
    expect(calls.filter((c) => c.url.endsWith("/auth/token")).length).toBe(2);
  });

  it("re-mints when the cached token is within 60s of expiry", async () => {
    let t = 1_000_000;
    const now = () => t;
    const exp = Math.floor(t / 1000) + 100; // expires in 100s
    const { fn, calls } = fakeFetch([okChallenge, okToken(exp), okChallenge, okToken(exp + 600)]);
    const p = new GpuTokenProvider({ brokerBaseUrl: "https://b", bundleId: "x", instanceId: "i", fetchFn: fn as unknown as typeof fetch, now });
    await p.getToken();
    t += 50_000; // now 50s before expiry -> within leeway
    await p.getToken();
    expect(calls.filter((c) => c.url.endsWith("/auth/token")).length).toBe(2);
  });

  it("throws on a failed challenge", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 503, json: { error: "auth_unconfigured" } }]);
    const p = new GpuTokenProvider({ brokerBaseUrl: "https://b", bundleId: "x", instanceId: "i", fetchFn: fn as unknown as typeof fetch });
    await expect(p.getToken()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openreel/desktop test:run gpu-token-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `token-provider.ts`**

Create `apps/desktop/src/main/gpu/token-provider.ts`:
```ts
export interface TokenProviderDeps {
  brokerBaseUrl: string;
  bundleId: string;
  instanceId: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  token: string;
  exp: number;
}

const REFRESH_LEEWAY_SECONDS = 60;

export class GpuTokenProvider {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly deps: TokenProviderDeps) {}

  invalidate(): void {
    this.cached = null;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.exp - this.nowSeconds() > REFRESH_LEEWAY_SECONDS) {
      return this.cached.token;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.mint().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private nowSeconds(): number {
    return Math.floor((this.deps.now ? this.deps.now() : Date.now()) / 1000);
  }

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Bundle-ID": this.deps.bundleId,
    };
  }

  private async mint(): Promise<string> {
    const challengeRes = await this.fetchFn(`${this.deps.brokerBaseUrl}/auth/challenge`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform: "desktop", instanceId: this.deps.instanceId }),
    });
    if (!challengeRes.ok) {
      throw new Error(`auth challenge failed: ${challengeRes.status}`);
    }
    const challenge = (await challengeRes.json()) as { challengeId?: string };
    if (!challenge.challengeId) {
      throw new Error("auth challenge missing challengeId");
    }

    const tokenRes = await this.fetchFn(`${this.deps.brokerBaseUrl}/auth/token`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ platform: "desktop", challengeId: challenge.challengeId }),
    });
    if (!tokenRes.ok) {
      throw new Error(`auth token mint failed: ${tokenRes.status}`);
    }
    const minted = (await tokenRes.json()) as { token?: string; exp?: number };
    if (!minted.token || typeof minted.exp !== "number") {
      throw new Error("auth token response malformed");
    }
    this.cached = { token: minted.token, exp: minted.exp };
    return minted.token;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openreel/desktop test:run gpu-token-provider`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gpu/token-provider.ts apps/desktop/test/gpu-token-provider.test.ts
git commit -m "feat(desktop): GPU token provider (desktop challenge->JWT, cache + single-flight + invalidate)"
```

### Task B2: `GpuJobClient` pure helpers (TDD)

**Files:**
- Create: `apps/desktop/src/main/gpu/job-client.ts` (helpers first; class added in B3)
- Test: `apps/desktop/test/gpu-job-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/gpu-job-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizePresign, buildSubmitBody } from "../src/main/gpu/job-client";

describe("normalizePresign", () => {
  it("accepts the canonical shape (uploadURL/mediaKey)", () => {
    const r = normalizePresign({ uploadURL: "https://r2/put", mediaKey: "jobs/a/b/file.mp4", headers: { "Content-Type": "video/mp4" } });
    expect(r).toEqual({ uploadUrl: "https://r2/put", mediaKey: "jobs/a/b/file.mp4", headers: { "Content-Type": "video/mp4" } });
  });
  it("accepts the broker shape (putUrl/objectKey)", () => {
    const r = normalizePresign({ putUrl: "https://r2/put", objectKey: "jobs/a/b/file.mp4" });
    expect(r.uploadUrl).toBe("https://r2/put");
    expect(r.mediaKey).toBe("jobs/a/b/file.mp4");
    expect(r.headers).toEqual({});
  });
  it("throws when both url aliases are missing", () => {
    expect(() => normalizePresign({ mediaKey: "k" })).toThrow();
  });
});

describe("buildSubmitBody", () => {
  it("JSON-only when no mediaKey", () => {
    const { body, contentType } = buildSubmitBody({ kind: "music_generation", params: { prompt: "lofi" } });
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ kind: "music_generation", params: { prompt: "lofi" } });
  });
  it("JSON wrapper with mediaKey + mediaFilename", () => {
    const { body } = buildSubmitBody({ kind: "upscale", params: { context: { clipID: "c1" } }, mediaKey: "jobs/x/y/in.mp4", mediaFilename: "in.mp4" });
    expect(JSON.parse(body)).toEqual({
      request: { kind: "upscale", params: { context: { clipID: "c1" } } },
      mediaKey: "jobs/x/y/in.mp4",
      mediaFilename: "in.mp4",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openreel/desktop test:run gpu-job-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers in `job-client.ts`**

Create `apps/desktop/src/main/gpu/job-client.ts` with the pure helpers (the class is added in B3):
```ts
export interface NormalizedPresign {
  uploadUrl: string;
  mediaKey: string;
  headers: Record<string, string>;
}

export function normalizePresign(raw: Record<string, unknown>): NormalizedPresign {
  const uploadUrl = (raw.uploadURL ?? raw.putUrl) as string | undefined;
  const mediaKey = (raw.mediaKey ?? raw.objectKey) as string | undefined;
  if (!uploadUrl || !mediaKey) {
    throw new Error("presign response missing uploadURL/putUrl or mediaKey/objectKey");
  }
  const headers = (raw.headers as Record<string, string> | undefined) ?? {};
  return { uploadUrl, mediaKey, headers };
}

export interface SubmitArgs {
  kind: string;
  params: Record<string, unknown>;
  mediaKey?: string;
  mediaFilename?: string;
}

export function buildSubmitBody(args: SubmitArgs): { body: string; contentType: string } {
  const request = { kind: args.kind, params: args.params };
  if (args.mediaKey) {
    return {
      body: JSON.stringify({ request, mediaKey: args.mediaKey, mediaFilename: args.mediaFilename }),
      contentType: "application/json",
    };
  }
  return { body: JSON.stringify(request), contentType: "application/json" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openreel/desktop test:run gpu-job-client`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gpu/job-client.ts apps/desktop/test/gpu-job-client.test.ts
git commit -m "feat(desktop): GPU job-client pure helpers (presign normalize + submit-body builder)"
```

### Task B3: `GpuJobClient` class — upload/submit/status/manifest/artifact/cancel (TDD)

**Files:**
- Modify: `apps/desktop/src/main/gpu/job-client.ts` (add the class)
- Test: `apps/desktop/test/gpu-job-client.test.ts` (add class tests)

- [ ] **Step 1: Add failing tests for the class**

Append to `apps/desktop/test/gpu-job-client.test.ts`:
```ts
import { vi } from "vitest";
import { GpuJobClient } from "../src/main/gpu/job-client";

function clientWith(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const tokenProvider = { getToken: vi.fn(async () => "tok"), invalidate: vi.fn() };
  const client = new GpuJobClient({
    gpuBaseUrl: "https://gpu.test",
    brokerBaseUrl: "https://broker.test",
    bundleId: "com.openreel.video",
    tokenProvider,
    fetchFn: fetchImpl as unknown as typeof fetch,
  });
  return { client, tokenProvider };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("GpuJobClient.submitJob", () => {
  it("sends Bearer + X-Bundle-ID and returns the created job", async () => {
    const seen: { init?: RequestInit } = {};
    const { client } = clientWith(async (_url, init) => {
      seen.init = init;
      return jsonResponse(200, { jobID: "job1", status: "queued", manifestURL: "/jobs/job1/manifest" });
    });
    const res = await client.submitJob({ kind: "upscale", params: {}, mediaKey: "jobs/a/b/in.mp4", mediaFilename: "in.mp4" });
    expect(res.jobID).toBe("job1");
    const headers = seen.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Bundle-ID"]).toBe("com.openreel.video");
  });

  it("surfaces a 503 as a retryable error carrying Retry-After", async () => {
    const { client } = clientWith(async () => jsonResponse(503, { error: "queue_full" }, { "retry-after": "30" }));
    await expect(client.submitJob({ kind: "upscale", params: {}, mediaKey: "k", mediaFilename: "f" })).rejects.toMatchObject({ status: 503, retryAfterSeconds: 30 });
  });

  it("on a 401 invalidates the token and retries once", async () => {
    let n = 0;
    const { client, tokenProvider } = clientWith(async () => {
      n += 1;
      return n === 1 ? jsonResponse(401, { error: "invalid_token" }) : jsonResponse(200, { jobID: "j", status: "queued" });
    });
    const res = await client.submitJob({ kind: "denoise", params: {}, mediaKey: "k", mediaFilename: "f" });
    expect(res.jobID).toBe("j");
    expect(tokenProvider.invalidate).toHaveBeenCalledTimes(1);
    expect(n).toBe(2);
  });
});

describe("GpuJobClient.jobStatus", () => {
  it("GETs /jobs/{id} and returns the status payload", async () => {
    const { client } = clientWith(async (url) => {
      expect(url).toBe("https://gpu.test/jobs/job1");
      return jsonResponse(200, { jobID: "job1", status: "processing", progress: 0.5, queuePosition: 0, pendingAhead: 0 });
    });
    const s = await client.jobStatus("job1");
    expect(s.status).toBe("processing");
    expect(s.progress).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openreel/desktop test:run gpu-job-client`
Expected: FAIL — `GpuJobClient` not exported.

- [ ] **Step 3: Implement the `GpuJobClient` class**

Append to `apps/desktop/src/main/gpu/job-client.ts`:
```ts
import { readFile, writeFile } from "node:fs/promises";

export interface GpuJobClientDeps {
  gpuBaseUrl: string;
  brokerBaseUrl: string;
  bundleId: string;
  tokenProvider: { getToken(): Promise<string>; invalidate(): void };
  fetchFn?: typeof fetch;
  tempFilePath?: (ext: string) => Promise<string>;
}

export interface GpuJobStatus {
  jobID: string;
  status: string;
  progress?: number;
  message?: string;
  manifestURL?: string;
  error?: string;
  queuePosition?: number;
  pendingAhead?: number;
}

export interface GpuJobCreated {
  jobID: string;
  status: string;
  manifestURL?: string;
}

export class GpuRetryableError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GpuRetryableError";
  }
}

export class GpuJobClient {
  constructor(private readonly deps: GpuJobClientDeps) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.deps.tokenProvider.getToken();
    return {
      Authorization: `Bearer ${token}`,
      "X-Bundle-ID": this.deps.bundleId,
      Accept: "application/json",
    };
  }

  private async authedFetch(url: string, init: RequestInit): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string>), ...(await this.authHeaders()) };
    let res = await this.fetchFn(url, { ...init, headers });
    if (res.status === 401) {
      this.deps.tokenProvider.invalidate();
      const retryHeaders = { ...(init.headers as Record<string, string>), ...(await this.authHeaders()) };
      res = await this.fetchFn(url, { ...init, headers: retryHeaders });
    }
    return res;
  }

  async uploadMedia(args: { srcPath: string; filename: string; contentType?: string }): Promise<{ mediaKey: string }> {
    const presignRes = await this.authedFetch(`${this.deps.brokerBaseUrl}/auth/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: args.filename, contentType: args.contentType }),
    });
    if (!presignRes.ok) {
      throw new Error(`presign failed: ${presignRes.status}`);
    }
    const presign = normalizePresign((await presignRes.json()) as Record<string, unknown>);
    const bytes = await readFile(args.srcPath);
    const putHeaders: Record<string, string> = { ...presign.headers };
    if (!putHeaders["Content-Type"] && !putHeaders["content-type"] && args.contentType) {
      putHeaders["Content-Type"] = args.contentType;
    }
    const putRes = await this.fetchFn(presign.uploadUrl, { method: "PUT", headers: putHeaders, body: bytes });
    if (!putRes.ok) {
      throw new Error(`upload PUT failed: ${putRes.status}`);
    }
    return { mediaKey: presign.mediaKey };
  }

  async submitJob(args: SubmitArgs): Promise<GpuJobCreated> {
    const { body, contentType } = buildSubmitBody(args);
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    if (res.status === 503) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new GpuRetryableError("queue full", 503, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!res.ok) {
      throw new Error(`submit failed: ${res.status}`);
    }
    return (await res.json()) as GpuJobCreated;
  }

  async jobStatus(jobID: string): Promise<GpuJobStatus> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}`, { method: "GET" });
    if (!res.ok) {
      throw new GpuRetryableError(`status failed: ${res.status}`, res.status);
    }
    return (await res.json()) as GpuJobStatus;
  }

  async fetchManifest(jobID: string): Promise<Record<string, unknown>> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}/manifest`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`manifest failed: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async downloadArtifact(jobID: string, relativePath: string): Promise<{ tempPath: string; mime: string }> {
    if (!this.deps.tempFilePath) {
      throw new Error("tempFilePath dependency not provided");
    }
    const res = await this.authedFetch(
      `${this.deps.gpuBaseUrl}/jobs/${jobID}/artifacts/${relativePath}`,
      { method: "GET" },
    );
    if (!res.ok) {
      throw new Error(`artifact download failed: ${res.status}`);
    }
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const ext = relativePath.split(".").pop() ?? "bin";
    const tempPath = await this.deps.tempFilePath(ext);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(tempPath, buffer);
    return { tempPath, mime };
  }

  async cancelJob(jobID: string): Promise<GpuJobStatus> {
    const res = await this.authedFetch(`${this.deps.gpuBaseUrl}/jobs/${jobID}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`cancel failed: ${res.status}`);
    }
    return (await res.json()) as GpuJobStatus;
  }
}
```
Move the `import { readFile, writeFile }` line to the top of the file with the other content (helpers stay above the class; imports at file top).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openreel/desktop test:run gpu-job-client`
Expected: PASS (all helper + class tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/gpu/job-client.ts apps/desktop/test/gpu-job-client.test.ts
git commit -m "feat(desktop): GpuJobClient (upload/submit/status/manifest/artifact/cancel; 401-retry; 503 retryable)"
```

### Task B4: Persisted install id + IPC wiring + preload + types

**Files:**
- Create: `apps/desktop/src/main/gpu/instance-id.ts`
- Modify: `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc-contract.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`
- Modify: `apps/web/src/types/global.d.ts`

- [ ] **Step 1: Implement the install-id helper**

Create `apps/desktop/src/main/gpu/instance-id.ts`:
```ts
import { getKeyStore } from "../ipc/keychain";

const INSTANCE_ID_KEY = "gpu-instance-id";

export async function getOrCreateInstanceId(): Promise<string> {
  const store = getKeyStore();
  const existing = await store.get(INSTANCE_ID_KEY);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID();
  await store.set(INSTANCE_ID_KEY, id);
  return id;
}
```
(If `getKeyStore().set` throws because `safeStorage` is unavailable, fall back to a `userData` file: catch the error and read/write `path.join(app.getPath("userData"), "openreel-gpu-instance.txt")`. Implement that fallback now:)
```ts
import { promises as fs } from "node:fs";
import path from "node:path";

export async function getOrCreateInstanceId(): Promise<string> {
  const store = getKeyStore();
  try {
    const existing = await store.get(INSTANCE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    await store.set(INSTANCE_ID_KEY, id);
    return id;
  } catch {
    const { app } = require("electron") as typeof import("electron");
    const file = path.join(app.getPath("userData"), "openreel-gpu-instance.txt");
    try {
      const fromFile = (await fs.readFile(file, "utf8")).trim();
      if (fromFile) return fromFile;
    } catch {
      // no file yet
    }
    const id = crypto.randomUUID();
    await fs.writeFile(file, id, { mode: 0o600 });
    return id;
  }
}
```

- [ ] **Step 2: Add channels**

In `apps/desktop/src/shared/channels.ts`, add inside the `CHANNELS` object (after `cloudFetch`):
```ts
  gpuUploadMedia: "openreel:gpu:uploadMedia",
  gpuSubmitJob: "openreel:gpu:submitJob",
  gpuJobStatus: "openreel:gpu:jobStatus",
  gpuFetchManifest: "openreel:gpu:fetchManifest",
  gpuDownloadArtifact: "openreel:gpu:downloadArtifact",
  gpuCancelJob: "openreel:gpu:cancelJob",
```

- [ ] **Step 3: Add zod schemas**

In `apps/desktop/src/shared/ipc-contract.ts`, add:
```ts
export const gpuUploadMediaArgsSchema = z.object({
  srcPath: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
});
export const gpuSubmitJobArgsSchema = z.object({
  kind: z.string(),
  params: z.record(z.unknown()),
  mediaKey: z.string().optional(),
  mediaFilename: z.string().optional(),
});
export const gpuJobIdArgsSchema = z.object({ jobID: z.string() });
export const gpuArtifactArgsSchema = z.object({ jobID: z.string(), relativePath: z.string() });
```

- [ ] **Step 4: Register handlers + construct the client in `main/index.ts`**

In `apps/desktop/src/main/index.ts`:
- Add imports:
```ts
import { GpuTokenProvider } from "./gpu/token-provider";
import { GpuJobClient } from "./gpu/job-client";
import { getOrCreateInstanceId } from "./gpu/instance-id";
import { tempFilePath } from "./ipc/fs";
import {
  gpuUploadMediaArgsSchema,
  gpuSubmitJobArgsSchema,
  gpuJobIdArgsSchema,
  gpuArtifactArgsSchema,
} from "../shared/ipc-contract";
```
- Near the top (module scope), define the config + a lazy client getter:
```ts
const BROKER_BASE_URL = process.env.OPENREEL_AUTH_BROKER_BASE_URL ?? "https://openreel-cloud.niiyeboah1996.workers.dev";
const GPU_BASE_URL = process.env.OPENREEL_GPU_BASE_URL ?? "https://ai.openreel.video";
const BUNDLE_ID = "com.openreel.video";

let gpuClient: GpuJobClient | null = null;
async function getGpuClient(): Promise<GpuJobClient> {
  if (gpuClient) return gpuClient;
  const instanceId = await getOrCreateInstanceId();
  const tokenProvider = new GpuTokenProvider({ brokerBaseUrl: BROKER_BASE_URL, bundleId: BUNDLE_ID, instanceId });
  gpuClient = new GpuJobClient({
    gpuBaseUrl: GPU_BASE_URL,
    brokerBaseUrl: BROKER_BASE_URL,
    bundleId: BUNDLE_ID,
    tokenProvider,
    tempFilePath: (ext: string) => tempFilePath({ ext }),
  });
  return gpuClient;
}
```
- Inside `app.whenReady().then(() => { ... })`, register:
```ts
  handle(CHANNELS.gpuUploadMedia, gpuUploadMediaArgsSchema, async (args) => (await getGpuClient()).uploadMedia(args));
  handle(CHANNELS.gpuSubmitJob, gpuSubmitJobArgsSchema, async (args) => (await getGpuClient()).submitJob(args));
  handle(CHANNELS.gpuJobStatus, gpuJobIdArgsSchema, async ({ jobID }) => (await getGpuClient()).jobStatus(jobID));
  handle(CHANNELS.gpuFetchManifest, gpuJobIdArgsSchema, async ({ jobID }) => (await getGpuClient()).fetchManifest(jobID));
  handle(CHANNELS.gpuDownloadArtifact, gpuArtifactArgsSchema, async ({ jobID, relativePath }) => (await getGpuClient()).downloadArtifact(jobID, relativePath));
  handle(CHANNELS.gpuCancelJob, gpuJobIdArgsSchema, async ({ jobID }) => (await getGpuClient()).cancelJob(jobID));
```
(Verify `tempFilePath`'s argument shape in `apps/desktop/src/main/ipc/fs.ts` — it is registered as `handle(CHANNELS.fsTempFilePath, z.object({ ext: z.string() }), tempFilePath)`, so `tempFilePath` takes `{ ext }`. Match that call signature.)

- [ ] **Step 5: Expose the `gpu` namespace in preload**

In `apps/desktop/src/preload/index.ts`, add after the `cloud` namespace:
```ts
  gpu: {
    uploadMedia: (args: unknown) => ipcRenderer.invoke(CHANNELS.gpuUploadMedia, args),
    submitJob: (args: unknown) => ipcRenderer.invoke(CHANNELS.gpuSubmitJob, args),
    jobStatus: (jobID: string) => ipcRenderer.invoke(CHANNELS.gpuJobStatus, { jobID }),
    fetchManifest: (jobID: string) => ipcRenderer.invoke(CHANNELS.gpuFetchManifest, { jobID }),
    downloadArtifact: (jobID: string, relativePath: string) =>
      ipcRenderer.invoke(CHANNELS.gpuDownloadArtifact, { jobID, relativePath }),
    cancelJob: (jobID: string) => ipcRenderer.invoke(CHANNELS.gpuCancelJob, { jobID }),
  },
```

- [ ] **Step 6: Add the `gpu` type to `global.d.ts`**

In `apps/web/src/types/global.d.ts`, inside `window.openreel`, after `cloud`, add:
```ts
      gpu: {
        uploadMedia(args: { srcPath: string; filename: string; contentType?: string }): Promise<{ mediaKey: string }>;
        submitJob(args: { kind: string; params: Record<string, unknown>; mediaKey?: string; mediaFilename?: string }): Promise<{ jobID: string; status: string; manifestURL?: string }>;
        jobStatus(jobID: string): Promise<{ jobID: string; status: string; progress?: number; message?: string; manifestURL?: string; error?: string; queuePosition?: number; pendingAhead?: number }>;
        fetchManifest(jobID: string): Promise<Record<string, unknown>>;
        downloadArtifact(jobID: string, relativePath: string): Promise<{ tempPath: string; mime: string }>;
        cancelJob(jobID: string): Promise<{ jobID: string; status: string }>;
      };
```

- [ ] **Step 7: Typecheck + build + full desktop suite**

Run: `pnpm --filter @openreel/desktop typecheck && pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop test:run`
Expected: PASS, build succeeds, all desktop tests green.

- [ ] **Step 8: Web typecheck (global.d.ts change)**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/main/gpu/instance-id.ts apps/desktop/src/shared/channels.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/web/src/types/global.d.ts
git commit -m "feat(desktop): window.openreel.gpu IPC bridge (upload/submit/poll/manifest/artifact/cancel)"
```

---

# PHASE C — Renderer types + store + poller

### Task C1: Port cloud-job wire types into core (TDD)

**Files:**
- Create: `packages/core/src/ai/cloud-job-types.ts`
- Test: `packages/core/src/ai/cloud-job-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/ai/cloud-job-types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  AI_CLOUD_JOB_KINDS,
  isTerminalStatus,
  MEDIA_OPTIONAL_KINDS,
  artifactIsImage,
  artifactIsVideo,
  artifactIsAudio,
} from "./cloud-job-types";

describe("cloud-job-types", () => {
  it("uses snake_case wire values for kinds", () => {
    expect(AI_CLOUD_JOB_KINDS.aiHighlight).toBe("ai_highlight");
    expect(AI_CLOUD_JOB_KINDS.backgroundRemoval).toBe("background_removal");
    expect(AI_CLOUD_JOB_KINDS.upscale).toBe("upscale");
    expect(Object.keys(AI_CLOUD_JOB_KINDS).length).toBe(25);
  });
  it("marks completed/failed/cancelled terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("processing")).toBe(false);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("uploading")).toBe(false);
  });
  it("knows media-optional kinds", () => {
    expect(MEDIA_OPTIONAL_KINDS.has("music_generation")).toBe(true);
    expect(MEDIA_OPTIONAL_KINDS.has("translation")).toBe(true);
    expect(MEDIA_OPTIONAL_KINDS.has("upscale")).toBe(false);
  });
  it("classifies artifacts by type or extension", () => {
    expect(artifactIsImage({ relativePath: "out.png" })).toBe(true);
    expect(artifactIsVideo({ relativePath: "out.mp4" })).toBe(true);
    expect(artifactIsAudio({ relativePath: "out.wav" })).toBe(true);
    expect(artifactIsImage({ type: "image", relativePath: "x" })).toBe(true);
    expect(artifactIsVideo({ relativePath: "out.png" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openreel/core test:run cloud-job-types`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cloud-job-types.ts`**

Create `packages/core/src/ai/cloud-job-types.ts`:
```ts
export const AI_CLOUD_JOB_KINDS = {
  transcription: "transcription",
  aiHighlight: "ai_highlight",
  autoCaptions: "auto_captions",
  personMatting: "person_matting",
  objectTracking: "object_tracking",
  faceAnalysis: "face_analysis",
  stabilization: "stabilization",
  autoReframe: "auto_reframe",
  audioSeparation: "audio_separation",
  colorMatch: "color_match",
  colorize: "colorize",
  upscale: "upscale",
  sceneDetection: "scene_detection",
  backgroundRemoval: "background_removal",
  musicGeneration: "music_generation",
  photoEnhance: "photo_enhance",
  portraitBokeh: "portrait_bokeh",
  smartThumbnail: "smart_thumbnail",
  denoise: "denoise",
  silenceRemoval: "silence_removal",
  frameInterpolation: "frame_interpolation",
  faceRestore: "face_restore",
  objectRemoval: "object_removal",
  voiceEnhance: "voice_enhance",
  translation: "translation",
} as const;

export type AiCloudJobKind = (typeof AI_CLOUD_JOB_KINDS)[keyof typeof AI_CLOUD_JOB_KINDS];

export type AiCloudJobStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export const MEDIA_OPTIONAL_KINDS: ReadonlySet<string> = new Set([
  AI_CLOUD_JOB_KINDS.musicGeneration,
  AI_CLOUD_JOB_KINDS.translation,
]);

export interface AiCloudJobRequest {
  kind: string;
  params: Record<string, unknown>;
}

export interface AiCloudJobCreated {
  jobID: string;
  status: AiCloudJobStatus;
  manifestURL?: string;
}

export interface AiCloudJobStatusResponse {
  jobID: string;
  status: AiCloudJobStatus;
  progress?: number;
  message?: string;
  manifestURL?: string;
  error?: string;
  queuePosition?: number;
  pendingAhead?: number;
}

export interface AiWorkerArtifactReference {
  type?: string;
  stem?: string;
  relativePath: string;
  width?: number;
  height?: number;
  frameIndex?: number;
  sourceTime?: number;
  score?: number;
  fps?: number;
  frameCount?: number;
  sampleRate?: number;
  duration?: number;
  channels?: number;
}

export interface AiWorkerResultManifest {
  jobID: string;
  kind: string;
  status?: AiCloudJobStatus;
  model?: string;
  artifacts: AiWorkerArtifactReference[];
  metadata?: Record<string, unknown>;
}

const IMAGE_EXTS: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "tiff", "tif", "bmp"]);
const VIDEO_EXTS: ReadonlySet<string> = new Set(["mp4", "mov", "m4v", "webm"]);
const AUDIO_EXTS: ReadonlySet<string> = new Set(["wav", "m4a", "mp3", "aac", "ogg"]);

function ext(relativePath: string): string {
  return relativePath.split(".").pop()?.toLowerCase() ?? "";
}

export function artifactIsImage(a: AiWorkerArtifactReference): boolean {
  return a.type === "image" || IMAGE_EXTS.has(ext(a.relativePath));
}

export function artifactIsVideo(a: AiWorkerArtifactReference): boolean {
  return a.type === "video" || a.type === "mask_video" || VIDEO_EXTS.has(ext(a.relativePath));
}

export function artifactIsAudio(a: AiWorkerArtifactReference): boolean {
  return a.type === "audio" || AUDIO_EXTS.has(ext(a.relativePath));
}

export function normalizeResultManifest(raw: Record<string, unknown>): AiWorkerResultManifest {
  const artifactsRaw = Array.isArray(raw.artifacts) ? (raw.artifacts as Record<string, unknown>[]) : [];
  return {
    jobID: String(raw.jobID ?? ""),
    kind: String(raw.kind ?? ""),
    status: raw.status as AiCloudJobStatus | undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    artifacts: artifactsRaw
      .filter((a) => typeof a.relativePath === "string")
      .map((a) => ({ ...(a as object), relativePath: String((a as { relativePath: unknown }).relativePath) }) as AiWorkerArtifactReference),
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

export function primaryArtifact(manifest: AiWorkerResultManifest): AiWorkerArtifactReference | null {
  return (
    manifest.artifacts.find(artifactIsVideo) ??
    manifest.artifacts.find(artifactIsImage) ??
    manifest.artifacts.find(artifactIsAudio) ??
    manifest.artifacts[0] ??
    null
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openreel/core test:run cloud-job-types`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the core barrel (if one exists)**

Check `packages/core/src/index.ts` (or `packages/core/src/ai/index.ts`). If there is an `ai` barrel or a top-level barrel that re-exports modules, add `export * from "./ai/cloud-job-types";` following the existing pattern. If no barrel re-exports `ai/`, skip (the renderer can import the file path directly).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/cloud-job-types.ts packages/core/src/ai/cloud-job-types.test.ts packages/core/src/index.ts
git commit -m "feat(core): AI cloud-job wire types (25 kinds, status, manifest, artifact classifiers)"
```

### Task C2: Export native-bridge upload/readback helpers + add `gpu` slice

**Files:**
- Modify: `packages/core/src/media/native-media-bridge.ts`

- [ ] **Step 1: Export `materializeToTemp` and `readBackBlob`**

In `packages/core/src/media/native-media-bridge.ts`, the helpers `materializeToTemp(bridge, file)` (around :55) and `readBackBlob(bridge, outPath, mime)` (around :77) are currently private (`function`). Change both to `export function`. Also export the bridge accessor used to get the fs slice — confirm `getBridge()`/`nativeMediaAvailable()` are exported (they are used by `media-import-service.ts`); if `getBridge` is not exported, add `export` to it.

- [ ] **Step 2: Add `gpu` to the bridge slice type**

In the same file, the bridge type (around :5) declares `{ platform?: string; fs: {...}; media: {...} }`. Add an optional `gpu` member matching the IPC surface, so core code can call it when present:
```ts
  gpu?: {
    uploadMedia(args: { srcPath: string; filename: string; contentType?: string }): Promise<{ mediaKey: string }>;
    submitJob(args: { kind: string; params: Record<string, unknown>; mediaKey?: string; mediaFilename?: string }): Promise<{ jobID: string; status: string; manifestURL?: string }>;
    jobStatus(jobID: string): Promise<{ jobID: string; status: string; progress?: number; message?: string; manifestURL?: string; error?: string; queuePosition?: number; pendingAhead?: number }>;
    fetchManifest(jobID: string): Promise<Record<string, unknown>>;
    downloadArtifact(jobID: string, relativePath: string): Promise<{ tempPath: string; mime: string }>;
    cancelJob(jobID: string): Promise<{ jobID: string; status: string }>;
  };
```

- [ ] **Step 3: Typecheck core**

Run: `pnpm --filter @openreel/core test:run native-media-bridge`
Expected: PASS (no behavior change; existing tests still green). If there is no test file for it, run `pnpm --filter @openreel/core test:run` to confirm nothing breaks.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/media/native-media-bridge.ts
git commit -m "refactor(core): export materializeToTemp/readBackBlob + add gpu slice to native bridge"
```

### Task C3: `gpu-job-store` (TDD)

**Files:**
- Create: `apps/web/src/stores/gpu-job-store.ts`
- Test: `apps/web/src/stores/gpu-job-store.test.ts`

> Mirror `apps/web/src/stores/kieai-store.ts` exactly (read it first as the template — persisted zustand store, actions `addTask/removeTask/incrementRetry/markFailed/retryTask/getTasksForProject`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/stores/gpu-job-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useGpuJobStore } from "./gpu-job-store";

beforeEach(() => {
  useGpuJobStore.setState({ jobs: [] });
});

describe("gpu-job-store", () => {
  it("adds and lists jobs for a project", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "Upscaled" });
    useGpuJobStore.getState().addJob({ jobID: "j2", mediaId: "m2", projectId: "p2", kind: "denoise", suggestedName: "Denoised" });
    const p1 = useGpuJobStore.getState().getJobsForProject("p1");
    expect(p1.map((j) => j.jobID)).toEqual(["j1"]);
    expect(p1[0].retries).toBe(0);
    expect(p1[0].failed).toBe(false);
  });
  it("increments retries and marks failed", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "x" });
    useGpuJobStore.getState().incrementRetry("j1");
    expect(useGpuJobStore.getState().jobs[0].retries).toBe(1);
    useGpuJobStore.getState().markFailed("j1");
    expect(useGpuJobStore.getState().jobs[0].failed).toBe(true);
    useGpuJobStore.getState().retryJob("j1");
    expect(useGpuJobStore.getState().jobs[0].failed).toBe(false);
    expect(useGpuJobStore.getState().jobs[0].retries).toBe(0);
  });
  it("removes jobs", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "x" });
    useGpuJobStore.getState().removeJob("j1");
    expect(useGpuJobStore.getState().jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openreel/web test:run gpu-job-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `gpu-job-store.ts`**

Create `apps/web/src/stores/gpu-job-store.ts` (follow `kieai-store.ts`'s persist setup — same `create<...>()(persist(...))` import style):
```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PendingGpuJob {
  jobID: string;
  mediaId: string;
  projectId: string;
  kind: string;
  suggestedName: string;
  createdAt: number;
  retries: number;
  failed: boolean;
}

interface GpuJobState {
  jobs: PendingGpuJob[];
  addJob(job: Omit<PendingGpuJob, "retries" | "failed" | "createdAt"> & { createdAt?: number }): void;
  removeJob(jobID: string): void;
  incrementRetry(jobID: string): void;
  markFailed(jobID: string): void;
  retryJob(jobID: string): void;
  getJobsForProject(projectId: string): PendingGpuJob[];
}

export const useGpuJobStore = create<GpuJobState>()(
  persist(
    (set, get) => ({
      jobs: [],
      addJob: (job) =>
        set((state) => ({
          jobs: [
            ...state.jobs,
            { ...job, createdAt: job.createdAt ?? Date.now(), retries: 0, failed: false },
          ],
        })),
      removeJob: (jobID) => set((state) => ({ jobs: state.jobs.filter((j) => j.jobID !== jobID) })),
      incrementRetry: (jobID) =>
        set((state) => ({
          jobs: state.jobs.map((j) => (j.jobID === jobID ? { ...j, retries: j.retries + 1 } : j)),
        })),
      markFailed: (jobID) =>
        set((state) => ({ jobs: state.jobs.map((j) => (j.jobID === jobID ? { ...j, failed: true } : j)) })),
      retryJob: (jobID) =>
        set((state) => ({
          jobs: state.jobs.map((j) => (j.jobID === jobID ? { ...j, failed: false, retries: 0 } : j)),
        })),
      getJobsForProject: (projectId) => get().jobs.filter((j) => j.projectId === projectId),
    }),
    { name: "gpu-pending-jobs" },
  ),
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openreel/web test:run gpu-job-store`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/gpu-job-store.ts apps/web/src/stores/gpu-job-store.test.ts
git commit -m "feat(web): gpu-job-store (durable pending-job queue, mirrors kieai-store)"
```

### Task C4: `gpu-jobs` renderer facade + `useGpuJobPoller` (TDD)

**Files:**
- Create: `apps/web/src/services/gpu-jobs.ts`
- Create: `apps/web/src/hooks/useGpuJobPoller.ts`
- Test: `apps/web/src/services/gpu-jobs.test.ts`

> Read `apps/web/src/hooks/useKieAIPoller.ts` first as the template for the poller (recursive setTimeout, in-flight/timer guards, retry/backoff, expiry). Reuse its structure; swap KieAI calls for `window.openreel.gpu.*` and `gpu-job-store`.

- [ ] **Step 1: Write the failing test for the facade's pure pieces**

Create `apps/web/src/services/gpu-jobs.test.ts` (test the retry-classifier + backoff, which are pure):
```ts
import { describe, it, expect } from "vitest";
import { isTransientGpuError, gpuBackoffMs, TRANSIENT_GPU_CODES } from "./gpu-jobs";

describe("gpu-jobs retry policy", () => {
  it("classifies 5xx/408/429 + network errors as transient", () => {
    expect(isTransientGpuError({ status: 503 })).toBe(true);
    expect(isTransientGpuError({ status: 500 })).toBe(true);
    expect(isTransientGpuError({ status: 408 })).toBe(true);
    expect(isTransientGpuError({ status: 429 })).toBe(true);
    expect(isTransientGpuError({ status: 404 })).toBe(false);
    expect(isTransientGpuError({})).toBe(true); // no status => network error => transient
    expect(TRANSIENT_GPU_CODES.has(429)).toBe(true);
  });
  it("exponential backoff capped at 15s", () => {
    expect(gpuBackoffMs(0, 2000)).toBe(2000);
    expect(gpuBackoffMs(1, 2000)).toBe(4000);
    expect(gpuBackoffMs(2, 2000)).toBe(8000);
    expect(gpuBackoffMs(3, 2000)).toBe(15000); // 16000 capped
    expect(gpuBackoffMs(10, 2000)).toBe(15000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openreel/web test:run gpu-jobs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `gpu-jobs.ts`**

Create `apps/web/src/services/gpu-jobs.ts`:
```ts
import {
  normalizeResultManifest,
  primaryArtifact,
  MEDIA_OPTIONAL_KINDS,
} from "@openreel/core";

export const TRANSIENT_GPU_CODES: ReadonlySet<number> = new Set([408, 429, 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511]);
const POLL_BASE_MS = 2000;
const BACKOFF_CAP_MS = 15000;

export function isTransientGpuError(err: { status?: number }): boolean {
  if (typeof err.status !== "number") return true;
  return TRANSIENT_GPU_CODES.has(err.status);
}

export function gpuBackoffMs(attempt: number, baseMs: number = POLL_BASE_MS): number {
  const factor = 1 << Math.max(0, Math.min(attempt, 4));
  return Math.min(baseMs * factor, BACKOFF_CAP_MS);
}

export function isDesktopGpuAvailable(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop" && !!window.openreel.gpu;
}

export interface SubmitClipJobArgs {
  kind: string;
  params: Record<string, unknown>;
  srcPath?: string;
  filename?: string;
  contentType?: string;
}

export async function submitClipJob(args: SubmitClipJobArgs): Promise<{ jobID: string }> {
  if (!isDesktopGpuAvailable()) {
    throw new Error("GPU jobs are only available on desktop");
  }
  const gpu = window.openreel!.gpu;
  let mediaKey: string | undefined;
  let mediaFilename: string | undefined;
  if (args.srcPath && args.filename) {
    const uploaded = await gpu.uploadMedia({ srcPath: args.srcPath, filename: args.filename, contentType: args.contentType });
    mediaKey = uploaded.mediaKey;
    mediaFilename = args.filename;
  } else if (!MEDIA_OPTIONAL_KINDS.has(args.kind)) {
    throw new Error(`kind ${args.kind} requires media`);
  }
  const created = await gpu.submitJob({ kind: args.kind, params: args.params, mediaKey, mediaFilename });
  return { jobID: created.jobID };
}

export { normalizeResultManifest, primaryArtifact };
```
(If `@openreel/core` does not re-export the cloud-job types via its barrel — verified in C1 Step 5 — import from the file path instead: `import { ... } from "@openreel/core/src/ai/cloud-job-types"` matching how other web code imports core internals; check an existing web import of core to match the convention.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openreel/web test:run gpu-jobs`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `useGpuJobPoller.ts`**

Create `apps/web/src/hooks/useGpuJobPoller.ts`, structurally mirroring `useKieAIPoller.ts`. It must:
- Be a no-op unless `isDesktopGpuAvailable()`.
- Use module-level `timersRef`/`inFlightRef` maps keyed by `jobID` and recursive `setTimeout` (2s base via `gpuBackoffMs`), re-reading job state from `useGpuJobStore.getState()` each tick (avoid stale closures).
- For each pending job: call `window.openreel.gpu.jobStatus(jobID)`. On transient error (`isTransientGpuError`): `incrementRetry`; if `retries >= 5` → `markFailed` + set the asset error flag; else reschedule with `gpuBackoffMs(retries)`. On a job older than 30 min → `markFailed`. On terminal status: if `completed` → `fetchManifest` → `normalizeResultManifest` → `primaryArtifact` → `downloadArtifact(jobID, art.relativePath)` → `readFileBytes(tempPath)` (via `window.openreel.fs.readFileBytes`) → wrap in a `File` → re-import (see C5) → `replacePlaceholderMedia`/`importMedia` → `removeJob`; if `failed`/`cancelled` → `markFailed` + asset error flag + `removeJob`.

Concrete skeleton:
```ts
import { useEffect } from "react";
import { useGpuJobStore } from "../stores/gpu-job-store";
import { useProjectStore } from "../stores/project-store";
import { isDesktopGpuAvailable, gpuBackoffMs, isTransientGpuError } from "../services/gpu-jobs";
import { importGpuResult } from "../services/gpu-result-import";
import { isTerminalStatus, normalizeResultManifest, primaryArtifact } from "@openreel/core";

const POLL_BASE_MS = 2000;
const MAX_RETRIES = 5;
const MAX_AGE_MS = 30 * 60 * 1000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();

export function useGpuJobPoller(): void {
  useEffect(() => {
    if (!isDesktopGpuAvailable()) return;
    let cancelled = false;

    const tick = async (jobID: string): Promise<void> => {
      if (cancelled || inFlight.has(jobID)) return;
      const job = useGpuJobStore.getState().jobs.find((j) => j.jobID === jobID);
      if (!job) return;
      if (Date.now() - job.createdAt > MAX_AGE_MS) {
        useGpuJobStore.getState().markFailed(jobID);
        useProjectStore.getState().setKieAIItemState(job.mediaId, false, true);
        return;
      }
      inFlight.add(jobID);
      try {
        const status = await window.openreel!.gpu.jobStatus(jobID);
        if (status.status === "completed") {
          const manifest = normalizeResultManifest(await window.openreel!.gpu.fetchManifest(jobID));
          const art = primaryArtifact(manifest);
          if (art) {
            const { tempPath, mime } = await window.openreel!.gpu.downloadArtifact(jobID, art.relativePath);
            const bytes = await window.openreel!.fs.readFileBytes(tempPath);
            await importGpuResult({ job, bytes, mime, relativePath: art.relativePath });
          }
          useGpuJobStore.getState().removeJob(jobID);
          return;
        }
        if (isTerminalStatus(status.status)) {
          useGpuJobStore.getState().markFailed(jobID);
          useProjectStore.getState().setKieAIItemState(job.mediaId, false, true);
          useGpuJobStore.getState().removeJob(jobID);
          return;
        }
        schedule(jobID, POLL_BASE_MS);
      } catch (err) {
        if (isTransientGpuError(err as { status?: number })) {
          useGpuJobStore.getState().incrementRetry(jobID);
          const retries = useGpuJobStore.getState().jobs.find((j) => j.jobID === jobID)?.retries ?? MAX_RETRIES;
          if (retries >= MAX_RETRIES) {
            useGpuJobStore.getState().markFailed(jobID);
            useProjectStore.getState().setKieAIItemState(job.mediaId, false, true);
          } else {
            schedule(jobID, gpuBackoffMs(retries));
          }
        } else {
          useGpuJobStore.getState().markFailed(jobID);
          useProjectStore.getState().setKieAIItemState(job.mediaId, false, true);
        }
      } finally {
        inFlight.delete(jobID);
      }
    };

    const schedule = (jobID: string, delay: number): void => {
      const existing = timers.get(jobID);
      if (existing) clearTimeout(existing);
      timers.set(jobID, setTimeout(() => void tick(jobID), delay));
    };

    const projectId = useProjectStore.getState().project?.id;
    const jobs = projectId ? useGpuJobStore.getState().getJobsForProject(projectId) : [];
    for (const job of jobs) {
      if (!job.failed) schedule(job.jobID, POLL_BASE_MS);
    }

    return () => {
      cancelled = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);
}
```
(Verify `setKieAIItemState(mediaId, isPending, isError)` signature against `project-store.ts:2077` and adjust the call to match; if a generic name is preferred, reuse it as-is — the flags are generic per the recon. Confirm `useProjectStore.getState().project?.id` is the correct project-id accessor.)

- [ ] **Step 6: Run the facade test again + web typecheck**

Run: `pnpm --filter @openreel/web test:run gpu-jobs && pnpm --filter @openreel/web typecheck`
Expected: PASS. (The poller has no dedicated unit test — it is integration-level; its pure helpers are covered in `gpu-jobs.test.ts`. `importGpuResult` is created in C5; if typecheck fails on its import, do C5 before this typecheck.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/services/gpu-jobs.ts apps/web/src/services/gpu-jobs.test.ts apps/web/src/hooks/useGpuJobPoller.ts
git commit -m "feat(web): GPU job facade (submit-for-clip) + useGpuJobPoller (KieAI-pattern polling/retry)"
```

### Task C5: Result import helper + mount the poller

**Files:**
- Create: `apps/web/src/services/gpu-result-import.ts`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Implement `gpu-result-import.ts`**

Create `apps/web/src/services/gpu-result-import.ts`. It turns a downloaded artifact into project media. For image results use `replacePlaceholderMedia`; for video/audio use `importMedia` (which handles metadata/thumbnails/waveform) then remove the placeholder:
```ts
import { useProjectStore } from "../stores/project-store";
import { artifactIsImage } from "@openreel/core";
import type { PendingGpuJob } from "../stores/gpu-job-store";

export async function importGpuResult(args: {
  job: PendingGpuJob;
  bytes: ArrayBuffer;
  mime: string;
  relativePath: string;
}): Promise<void> {
  const name = args.job.suggestedName || args.relativePath.split("/").pop() || "AI Result";
  const blob = new Blob([args.bytes], { type: args.mime });
  const store = useProjectStore.getState();
  if (artifactIsImage({ relativePath: args.relativePath, type: undefined })) {
    await store.replacePlaceholderMedia(args.job.mediaId, blob, name);
    return;
  }
  const file = new File([blob], name, { type: args.mime });
  await store.importMedia(file);
  store.removePlaceholderMedia?.(args.job.mediaId);
}
```
(Verify `replacePlaceholderMedia(mediaId, blob, name)` and `importMedia(file)` signatures in `project-store.ts` (:2091, :1639 per recon). If there is no `removePlaceholderMedia`, remove the placeholder by whatever the store exposes — check the kieai flow; if KieAI leaves the placeholder and only `replacePlaceholderMedia`, then for non-image results call `replacePlaceholderMedia` too but pass the video blob and ensure the media type is corrected — see the note below. Simplest correct v1: extend `replacePlaceholderMedia` to accept the real MIME/type, OR always use `importMedia` + delete placeholder. Pick the path that matches the store's actual API and keep media `type` correct.)

- [ ] **Step 2: Mount the poller once in `App.tsx`**

In `apps/web/src/App.tsx`, mirror the existing `useKieAIPoller()` mount (recon: `App.tsx:13` import, `:47` call). Add:
```ts
import { useGpuJobPoller } from "./hooks/useGpuJobPoller";
```
and inside the same component that calls `useKieAIPoller()`:
```ts
  useGpuJobPoller();
```

- [ ] **Step 3: Web typecheck + full web suite**

Run: `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run`
Expected: PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/gpu-result-import.ts apps/web/src/App.tsx
git commit -m "feat(web): import GPU result artifacts into the project + mount useGpuJobPoller"
```

---

# PHASE D — AI Panel UI

### Task D1: Kind catalog config

**Files:**
- Create: `apps/web/src/components/editor/ai-panel/ai-kinds.config.ts`

- [ ] **Step 1: Implement the catalog**

Create `apps/web/src/components/editor/ai-panel/ai-kinds.config.ts`:
```ts
import { AI_CLOUD_JOB_KINDS } from "@openreel/core";

export interface AiKindDef {
  kind: string;
  label: string;
  group: "Enhance" | "Cut-out" | "Motion" | "Analyze" | "Audio" | "Generate";
  requiresClip: boolean;
}

export const AI_KINDS: AiKindDef[] = [
  { kind: AI_CLOUD_JOB_KINDS.upscale, label: "Upscale", group: "Enhance", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.denoise, label: "Denoise", group: "Enhance", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.faceRestore, label: "Face Restore", group: "Enhance", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.photoEnhance, label: "Photo Enhance", group: "Enhance", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.colorize, label: "Colorize", group: "Enhance", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.backgroundRemoval, label: "Remove Background", group: "Cut-out", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.personMatting, label: "Person Matte", group: "Cut-out", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.objectRemoval, label: "Object Removal", group: "Cut-out", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.stabilization, label: "Stabilize", group: "Motion", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.autoReframe, label: "Auto Reframe", group: "Motion", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.frameInterpolation, label: "Smooth (Interpolate)", group: "Motion", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.portraitBokeh, label: "Portrait Bokeh", group: "Motion", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.transcription, label: "Transcribe", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.autoCaptions, label: "Auto Captions", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.sceneDetection, label: "Scene Detection", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.faceAnalysis, label: "Face Analysis", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.objectTracking, label: "Object Tracking", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.smartThumbnail, label: "Smart Thumbnail", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.aiHighlight, label: "AI Highlights", group: "Analyze", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.audioSeparation, label: "Separate Audio", group: "Audio", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.voiceEnhance, label: "Enhance Voice", group: "Audio", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.silenceRemoval, label: "Remove Silence", group: "Audio", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.colorMatch, label: "Color Match", group: "Enhance", requiresClip: true },
  { kind: AI_CLOUD_JOB_KINDS.musicGeneration, label: "Generate Music", group: "Generate", requiresClip: false },
  { kind: AI_CLOUD_JOB_KINDS.translation, label: "Translate", group: "Generate", requiresClip: false },
];

export const AI_KIND_GROUPS = ["Enhance", "Cut-out", "Motion", "Analyze", "Audio", "Generate"] as const;
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.
```bash
git add apps/web/src/components/editor/ai-panel/ai-kinds.config.ts
git commit -m "feat(web): AI panel kind catalog (25 kinds grouped)"
```

### Task D2: Register the `ai` panel in ui-store

**Files:**
- Modify: `apps/web/src/stores/ui-store.ts:4` (PanelId), `:187` (DEFAULT_PANELS)

- [ ] **Step 1: Add the panel id + default**

In `apps/web/src/stores/ui-store.ts`, extend the `PanelId` union (currently `"mediaLibrary"|"inspector"|"effects"|"audioMixer"|"colorGrading"|"subtitles"`) to add `"ai"`. In `DEFAULT_PANELS`, add:
```ts
  ai: { visible: false },
```
(Match the `PanelState` shape used by the other entries.)

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS (exhaustive `Record<PanelId, PanelState>` now includes `ai`).
```bash
git add apps/web/src/stores/ui-store.ts
git commit -m "feat(web): register desktop AI panel id in ui-store"
```

### Task D3: `AIPanel` + `AIJobList` components

**Files:**
- Create: `apps/web/src/components/editor/ai-panel/AIJobList.tsx`
- Create: `apps/web/src/components/editor/ai-panel/AIPanel.tsx`

- [ ] **Step 1: Implement `AIJobList.tsx`**

Create `apps/web/src/components/editor/ai-panel/AIJobList.tsx` — shows the current project's pending jobs with progress/error + a cancel/retry affordance:
```tsx
import { useGpuJobStore } from "../../../stores/gpu-job-store";
import { useProjectStore } from "../../../stores/project-store";

export function AIJobList(): JSX.Element | null {
  const jobs = useGpuJobStore((s) => s.jobs);
  const projectId = useProjectStore((s) => s.project?.id);
  const mine = jobs.filter((j) => j.projectId === projectId);
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 p-2">
      {mine.map((job) => (
        <div key={job.jobID} className="flex items-center justify-between rounded-md bg-neutral-800 px-3 py-2 text-sm">
          <span className="truncate">{job.suggestedName}</span>
          <span className="ml-2 shrink-0 text-xs text-neutral-400">
            {job.failed ? "Failed" : "Running…"}
          </span>
          {job.failed ? (
            <button
              type="button"
              className="ml-2 text-xs text-blue-400"
              onClick={() => {
                useGpuJobStore.getState().retryJob(job.jobID);
                useProjectStore.getState().setKieAIItemState(job.mediaId, true, false);
              }}
            >
              Retry
            </button>
          ) : (
            <button
              type="button"
              className="ml-2 text-xs text-neutral-400"
              onClick={() => {
                void window.openreel?.gpu.cancelJob(job.jobID);
                useGpuJobStore.getState().removeJob(job.jobID);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```
(Match Tailwind class conventions to neighboring panels; verify `setKieAIItemState` signature.)

- [ ] **Step 2: Implement `AIPanel.tsx`**

Create `apps/web/src/components/editor/ai-panel/AIPanel.tsx`. It lists kinds grouped, resolves the selected clip's source bytes on desktop via `materializeToTemp`, submits, inserts a placeholder, and records the job. Use the project/timeline stores to find the selected clip + its media.
```tsx
import { useState } from "react";
import { AI_KINDS, AI_KIND_GROUPS } from "./ai-kinds.config";
import { AIJobList } from "./AIJobList";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useGpuJobStore } from "../../../stores/gpu-job-store";
import { submitClipJob, isDesktopGpuAvailable } from "../../../services/gpu-jobs";
import { materializeToTemp, nativeMediaAvailable, getBridge } from "@openreel/core";

export function AIPanel(): JSX.Element {
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runKind = async (kind: string, requiresClip: boolean): Promise<void> => {
    setError(null);
    setBusyKind(kind);
    try {
      const project = useProjectStore.getState().project;
      if (!project) throw new Error("No project open");
      const selectedClipId = useTimelineStore.getState().selectedClipId;
      let srcPath: string | undefined;
      let filename: string | undefined;
      let contentType: string | undefined;
      let mediaId = `gpu-${kind}-${Date.now()}`;

      if (requiresClip) {
        if (!selectedClipId) throw new Error("Select a clip first");
        const clip = useTimelineStore.getState().getClip?.(selectedClipId);
        const sourceMediaId = clip?.mediaId;
        if (!sourceMediaId) throw new Error("Selected clip has no media");
        const item = useProjectStore.getState().getMediaItem(sourceMediaId);
        let blob = item?.blob ?? null;
        if (!blob) blob = await useProjectStore.getState().loadMediaBlob?.(sourceMediaId);
        if (!blob) throw new Error("Could not load clip media");
        if (!nativeMediaAvailable()) throw new Error("Native media bridge unavailable");
        filename = item?.name ?? "input";
        contentType = blob.type || undefined;
        const file = new File([blob], filename, { type: contentType });
        srcPath = await materializeToTemp(getBridge()!, file);
        mediaId = `gpu-${kind}-${sourceMediaId}-${Date.now()}`;
      }

      const params: Record<string, unknown> = {
        context: {
          projectID: project.id,
          quality: "balanced",
        },
      };

      const def = AI_KINDS.find((k) => k.kind === kind);
      const suggestedName = `${def?.label ?? kind} result`;

      useProjectStore.getState().addPlaceholderMedia({
        id: mediaId,
        name: suggestedName,
        type: "video",
        isPlaceholder: true,
        isPending: true,
      } as never);

      const { jobID } = await submitClipJob({ kind, params, srcPath, filename, contentType });
      useGpuJobStore.getState().addJob({ jobID, mediaId, projectId: project.id, kind, suggestedName });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKind(null);
    }
  };

  if (!isDesktopGpuAvailable()) {
    return <div className="p-3 text-sm text-neutral-400">AI cloud jobs are available in the desktop app.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {error && <div className="m-2 rounded bg-red-900/50 px-3 py-2 text-xs text-red-200">{error}</div>}
      {AI_KIND_GROUPS.map((group) => (
        <div key={group} className="p-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group}</h3>
          <div className="grid grid-cols-2 gap-2">
            {AI_KINDS.filter((k) => k.group === group).map((k) => (
              <button
                key={k.kind}
                type="button"
                disabled={busyKind !== null}
                className="rounded-md bg-neutral-800 px-3 py-2 text-left text-sm hover:bg-neutral-700 disabled:opacity-50"
                onClick={() => void runKind(k.kind, k.requiresClip)}
              >
                {busyKind === k.kind ? "Submitting…" : k.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <AIJobList />
    </div>
  );
}
```
(Verify these store accessors against the real APIs before relying on them: `useTimelineStore.getState().selectedClipId` / `getClip(id)` — check `timeline-store.ts`; `useProjectStore.getState().addPlaceholderMedia` (:2063), `getMediaItem` (:2058), `loadMediaBlob`, `project`. If `getClip`/`selectedClipId` differ, adapt to the actual selectors. `materializeToTemp`/`nativeMediaAvailable`/`getBridge` must be exported from core per Task C2 — if `getBridge` returns a typed slice, the `!` non-null is fine after the `nativeMediaAvailable()` guard.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @openreel/web typecheck`
Expected: PASS.
```bash
git add apps/web/src/components/editor/ai-panel/AIPanel.tsx apps/web/src/components/editor/ai-panel/AIJobList.tsx
git commit -m "feat(web): AIPanel + AIJobList (submit AI jobs, placeholder media, job list)"
```

### Task D4: Mount the panel region + toolbar toggle

**Files:**
- Modify: `apps/web/src/components/editor/EditorInterface.tsx` (grid region, mirror `audioMixer` at :479-488)
- Modify: the editor toolbar component that toggles panels (find the `audioMixer` toggle and add an `ai` one)

- [ ] **Step 1: Mount the panel in `EditorInterface.tsx`**

In `apps/web/src/components/editor/EditorInterface.tsx`, find the `audioMixer` region (recon: ~:479-488, pattern `{panels.audioMixer.visible && <PanelErrorBoundary><AudioMixer/></PanelErrorBoundary>}`). Add an analogous region for `ai`:
```tsx
{panels.ai.visible && (
  <PanelErrorBoundary>
    <AIPanel />
  </PanelErrorBoundary>
)}
```
Add the import at the top:
```ts
import { AIPanel } from "./ai-panel/AIPanel";
```
Place the region in a sensible grid slot (reuse the same grid area/styling as `audioMixer`, or a right-side dock — match the existing layout; if a dedicated grid area is needed, follow how `audioMixer`/`colorGrading` regions are positioned at `:426-488`).

- [ ] **Step 2: Add a desktop-only toggle**

Find the toolbar button that toggles `audioMixer` (search for `togglePanel("audioMixer")` or `setPanelVisible`). Add a sibling button, gated on desktop:
```tsx
{window.openreel?.platform === "desktop" && (
  <button type="button" onClick={() => togglePanel("ai")} title="AI">
    {/* use the project's icon system; e.g. a Sparkles icon like the inspector ai tab */}
    AI
  </button>
)}
```
(Match the toolbar's existing button markup/icon conventions — use the same `togglePanel`/`setPanelVisible` action the audio mixer button uses.)

- [ ] **Step 3: Typecheck + build + full web suite**

Run: `pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run && pnpm --filter @openreel/web build`
Expected: PASS, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/EditorInterface.tsx <toolbar-file>
git commit -m "feat(web): mount desktop AI panel + toolbar toggle"
```

### Task D5: Final full-stack verification

- [ ] **Step 1: All packages green**

Run:
```bash
cd apps/cloud && npx tsc --noEmit && npx vitest run && cd ../..
pnpm --filter @openreel/core test:run
pnpm --filter @openreel/desktop typecheck && pnpm --filter @openreel/desktop build && pnpm --filter @openreel/desktop test:run
pnpm --filter @openreel/web typecheck && pnpm --filter @openreel/web test:run && pnpm --filter @openreel/web build
```
Expected: all PASS.

- [ ] **Step 2: Record pending-human verifications**

Append to `apps/desktop/test/parity.md` (or create a short note) listing what needs a real desktop run + deployed Worker:
- Deploy the `apps/cloud` Worker (desktop leg) before desktop AI works.
- Confirm `OPENREEL_AUTH_BROKER_BASE_URL` points at the live broker.
- Manual E2E: launch desktop, open AI panel, run `upscale` on a selected clip, confirm a real result returns and imports.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/parity.md
git commit -m "docs(desktop): record GPU AI panel pending-human E2E checks"
```

---

## Self-Review

**Spec coverage:** §4 Worker leg → A1/A2. §5.1 token provider → B1. §5.2 job client → B2/B3. §5.3 IPC → B4. §6.1 wire types → C1. §6.2 store → C3. §6.3 poller → C4. §7.1 media in/out → C2/C5. §7.2 AI panel → D1–D4. §8 error handling → distributed (token single-flight/leeway B1; 401-retry/503 B3; transient retry/backoff/30-min C4). §9 placement → matches file structure. §10 broker-host default → B4 Step 4 (`OPENREEL_AUTH_BROKER_BASE_URL` default = web config host). §11 phasing → A/B/C/D. §12 out-of-scope (accounts, mobile, >150MB precompress, advanced param UIs) → not built.

**Placeholder scan:** All code steps contain real code. UI tasks (D3/D4) contain full component code with explicit "verify against actual store API" callouts (those are integration-verification instructions, not deferred work — the executor confirms selectors and adapts; the code shown is the intended implementation).

**Type consistency:** `AI_CLOUD_JOB_KINDS`/`isTerminalStatus`/`normalizeResultManifest`/`primaryArtifact`/`MEDIA_OPTIONAL_KINDS` defined in C1, consumed in C4/C5/D1. `GpuTokenProvider`/`GpuJobClient`/`normalizePresign`/`buildSubmitBody`/`GpuRetryableError` defined B1–B3, wired B4. `window.openreel.gpu` shape identical across B4 preload, B4 global.d.ts, C2 core slice, and C4/D3 consumers. `PendingGpuJob`/`useGpuJobStore` defined C3, consumed C4/D3. `gpu-job-store` persist key `"gpu-pending-jobs"`. Channels `gpu*` consistent B4 channels↔schemas↔handlers↔preload.

**Known verification dependencies (flagged inline, not gaps):** exact `project-store`/`timeline-store` selector names (`getClip`, `selectedClipId`, `loadMediaBlob`, `setKieAIItemState`, `addPlaceholderMedia`, `replacePlaceholderMedia`, `importMedia`, `project.id`) and the toolbar toggle file — the executor confirms these against the live code (recon gave file:line for most) and adapts call sites; the data flow and contracts are fixed.
