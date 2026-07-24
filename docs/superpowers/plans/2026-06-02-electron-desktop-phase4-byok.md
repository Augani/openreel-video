# OpenReel Desktop — Phase 4 (BYOK keychain + AI routing + share-link origin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** On desktop, store the user's own AI provider keys in the OS keychain and make AI calls **directly from the main process** (key never reaches the renderer), routed transparently through the existing `secure-storage`/`apiFetch` seams; and fix share/deep-link URLs to use the public web origin instead of `app://`.

**Scope:** Spec §6.8 **BYOK** + §5 #2 (apiFetch) + §5 #9 (secure-storage→keychain) + §5 #7 (share-link origin). **DEFERRED:** server-proxy / desktop sign-in ("cloud auth") — the backend has no desktop auth path (Worker `/auth` is iOS/Android attestation only; no OAuth/device-code endpoint; no cloud-pays-AI service; render uses a dev-shim Bearer). That needs a backend auth contract + AI-cost/product decision + deploy; its own future plan.

**Architecture:** Implement the currently-stubbed `window.openreel.keychain.*` via Electron `safeStorage` (ciphertext under `userData`, Linux fallback per §5 #9). Add `window.openreel.cloud.fetch(service, path, options)` — a main-process handler that reads the key from the key store by service id, applies the provider auth headers (a `DIRECT_CONFIG` mirror in main, since `apps/desktop` can't import `apps/web`), fetches upstream, and returns a serialized `{status,statusText,headers,body}` the renderer rebuilds into a `Response`. `secure-storage.ts` and `apiFetch` get desktop branches; the master-password lifecycle is bypassed on desktop (the OS keychain provides at-rest protection). Share-link builders inject `window.openreel.publicOrigin`.

**Key facts (survey 2026-06-02):**
- AI seam: ONE caller `apps/web/src/components/editor/inspector/hooks/useElevenLabsApi.ts`; `apiFetch(service, path, apiKey, options)` (`api-proxy.ts:45`); services `elevenlabs|openai|anthropic`; **secret-id == service name**; callers gate on `isSessionUnlocked()` then `getSecret(service)`.
- `secure-storage.ts`: `saveSecret/getSecret/deleteSecret(id,...)`, `isSessionUnlocked()`, `isMasterPasswordSet()`, master-password/unlock lifecycle. Settings UI (`ApiKeysPanel.tsx`) + `kieai/client.ts` (`getSecret("kie-ai")`) also consume it. Branch inside `secure-storage.ts` → zero caller changes for storage.
- keychain handlers are **stubbed** in `apps/desktop/src/main/index.ts` (throw "not until Phase 4"); `window.openreel.keychain.{get,set,delete}` typed in `global.d.ts`.
- Share-link: `use-router.ts` `generateShareableLink` (~155-164) + `share-service.ts` `getSharePageUrl` (~105-111), both build `` `${window.location.origin}${window.location.pathname}` `` + hash. Only 2 sites. `window.openreel.publicOrigin === "https://app.openreel.video"` already exists.

---

# WORKSTREAM A — BYOK

### Task A1: OS-keychain key store via `safeStorage` (replace the stubs) — TDD

**Files:** create `apps/desktop/src/main/ipc/keychain.ts` + `apps/desktop/test/keychain.test.ts`; modify `apps/desktop/src/main/index.ts` (replace stub handlers).

- [ ] **Step 1: failing test** for a `KeyStore` (DI'd with a temp file + a `SafeStorageLike` so it's headless-testable):
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { KeyStore, type SafeStorageLike } from "../src/main/ipc/keychain";

// reversible fake (base64) standing in for OS encryption
const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s, "utf8"),
  decryptString: (b) => b.toString("utf8"),
});

let file: string;
beforeEach(() => { file = path.join(tmpdir(), `openreel-kc-${Date.now()}-${Math.random()}.json`); });
afterEach(async () => { await fs.rm(file, { force: true }); });

describe("KeyStore", () => {
  it("set/get/delete round-trips and persists encrypted (not plaintext) on disk", async () => {
    const ks = new KeyStore(file, fakeSafe());
    await ks.set("openai", "sk-secret");
    expect(await ks.get("openai")).toBe("sk-secret");
    const raw = await fs.readFile(file, "utf8");
    expect(raw).not.toContain("sk-secret"); // stored as base64 ciphertext
    await ks.delete("openai");
    expect(await ks.get("openai")).toBeNull();
  });
  it("get returns null for unknown id", async () => {
    expect(await new KeyStore(file, fakeSafe()).get("nope")).toBeNull();
  });
  it("set throws (no plaintext) when OS encryption is unavailable", async () => {
    await expect(new KeyStore(file, fakeSafe(false)).set("x", "y")).rejects.toThrow();
  });
});
```
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement `keychain.ts`:**
```ts
import { promises as fs } from "node:fs";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class KeyStore {
  constructor(private readonly file: string, private readonly safe: SafeStorageLike) {}

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }
  private async writeAll(map: Record<string, string>): Promise<void> {
    await fs.writeFile(this.file, JSON.stringify(map), { mode: 0o600 });
  }

  async set(id: string, value: string): Promise<void> {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error(
        "OS key storage is unavailable on this system (no Keychain/DPAPI/libsecret). Cannot securely store the key.",
      );
    }
    const map = await this.readAll();
    map[id] = this.safe.encryptString(value).toString("base64");
    await this.writeAll(map);
  }

  async get(id: string): Promise<string | null> {
    const map = await this.readAll();
    const ciphertext = map[id];
    if (!ciphertext) return null;
    if (!this.safe.isEncryptionAvailable()) return null;
    return this.safe.decryptString(Buffer.from(ciphertext, "base64"));
  }

  async delete(id: string): Promise<void> {
    const map = await this.readAll();
    if (!(id in map)) return;
    delete map[id];
    await this.writeAll(map);
  }
}

let singleton: KeyStore | null = null;
export function getKeyStore(): KeyStore {
  if (!singleton) {
    // Lazy: requires electron at call time (not at import — keeps the module unit-testable).
    const { app, safeStorage } = require("electron") as typeof import("electron");
    const path = require("node:path") as typeof import("node:path");
    singleton = new KeyStore(path.join(app.getPath("userData"), "openreel-keys.json"), safeStorage);
  }
  return singleton;
}
```
- [ ] **Step 4: run → PASS** (3 tests).
- [ ] **Step 5: replace the keychain stub handlers in `main/index.ts`** — swap the `keychainNotImplemented` throw for real delegation:
```ts
import { getKeyStore } from "./ipc/keychain";
// ...
  handle(CHANNELS.keychainGet, z.object({ id: z.string() }), ({ id }) => getKeyStore().get(id));
  handle(CHANNELS.keychainSet, z.object({ id: z.string(), value: z.string() }), ({ id, value }) =>
    getKeyStore().set(id, value));
  handle(CHANNELS.keychainDelete, z.object({ id: z.string() }), ({ id }) => getKeyStore().delete(id));
```
(Remove the `keychainNotImplemented` thunk.)
- [ ] **Step 6: typecheck + build:main + full desktop suite green. Commit:** `feat(desktop): OS-keychain key store via safeStorage (BYOK)`

### Task A2: `window.openreel.cloud.fetch` — direct-from-main provider calls (key never in renderer) — TDD

**Files:** create `apps/desktop/src/main/ipc/cloud.ts` + `apps/desktop/test/cloud-fetch.test.ts`; modify `channels.ts`, `ipc-contract.ts`, `main/index.ts`, `preload/index.ts`, `apps/web/src/types/global.d.ts`.

- [ ] **Step 1: channel + schema + type.** Add `cloudFetch: "openreel:cloud:fetch"` to CHANNELS; add `cloudFetchArgsSchema = z.object({ service: z.enum(["elevenlabs","openai","anthropic"]), path: z.string(), method: z.string().optional(), headers: z.record(z.string()).optional(), body: z.string().optional() })` to ipc-contract. Add to `global.d.ts` window.openreel: `cloud: { fetch(service: "elevenlabs"|"openai"|"anthropic", path: string, options?: { method?: string; headers?: Record<string,string>; body?: string }): Promise<{ status: number; statusText: string; headers: Record<string,string>; body: ArrayBuffer }> }`.
- [ ] **Step 2: failing test** `cloud-fetch.test.ts` — mock the key store + global `fetch`, assert `cloudFetch` (a) reads the key for the service from the store, (b) applies the right provider auth header (elevenlabs `xi-api-key`, openai `Authorization: Bearer`, anthropic `x-api-key`+`anthropic-version`), (c) targets the right base URL+path, (d) forwards method/body, (e) returns `{status, body}`; and throws/return-401-shape when no key is stored.
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildUpstreamRequest, DIRECT_CONFIG } from "../src/main/ipc/cloud";

describe("cloud buildUpstreamRequest", () => {
  it("elevenlabs: xi-api-key + base url", () => {
    const r = buildUpstreamRequest("elevenlabs", "/voices", "KEY", { method: "GET" });
    expect(r.url).toBe("https://api.elevenlabs.io/v1/voices");
    expect(r.headers["xi-api-key"]).toBe("KEY");
  });
  it("openai: bearer", () => {
    const r = buildUpstreamRequest("openai", "/chat/completions", "KEY", { method: "POST", body: "{}" });
    expect(r.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(r.headers["Authorization"]).toBe("Bearer KEY");
    expect(r.method).toBe("POST");
    expect(r.body).toBe("{}");
  });
  it("anthropic: x-api-key + version", () => {
    const r = buildUpstreamRequest("anthropic", "/messages", "KEY", {});
    expect(r.headers["x-api-key"]).toBe("KEY");
    expect(r.headers["anthropic-version"]).toBe("2023-06-01");
  });
});
```
- [ ] **Step 3: implement `cloud.ts`** with a `DIRECT_CONFIG` mirror (document the duplication of `apps/web/src/services/api-proxy.ts`'s config — keep in sync), a pure `buildUpstreamRequest(service, path, key, options)` → `{url, method, headers, body}`, and `cloudFetch({service, path, method, headers, body})` that: reads `getKeyStore().get(service)`; if null → return `{status:401, statusText:"No API key", headers:{}, body:new ArrayBuffer(0)}`; else builds the request, `fetch`es, reads `arrayBuffer()`, returns `{status, statusText, headers (Object.fromEntries), body}`. Merge any renderer-supplied non-secret `headers` (e.g. content-type) under the auth headers.
- [ ] **Step 4: register** raw or via `handle` in `main/index.ts` (`handle(CHANNELS.cloudFetch, cloudFetchArgsSchema, cloudFetch)`); expose in preload `cloud: { fetch: (service, path, options) => ipcRenderer.invoke(CHANNELS.cloudFetch, { service, path, ...options }) }`.
- [ ] **Step 5: run → PASS; typecheck + build:main green. Commit:** `feat(desktop): window.openreel.cloud.fetch (direct provider calls from main, key from keychain)`

### Task A3: `secure-storage.ts` desktop branch → keychain + bypass master-password — TDD

**Files:** modify `apps/web/src/services/secure-storage.ts`; create `apps/web/src/services/secure-storage.desktop.test.ts`.

- [ ] **Step 1: failing test** (mock `window.openreel = { platform:"desktop", keychain: {get,set,delete} }`): `saveSecret("openai","OpenAI","k")` → `keychain.set("openai","k")`; `getSecret("openai")` → `keychain.get`; `deleteSecret` → `keychain.delete`; `isSessionUnlocked()` → `true`; `isMasterPasswordSet()` resolves `true`. Cleanup deletes `window.openreel` in afterEach.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: add a desktop guard** `function desktopKeychain() { return typeof window!=="undefined" && window.openreel?.platform==="desktop" ? window.openreel.keychain : undefined; }` and branch FIRST in `saveSecret` (`await kc.set(id, value); return;`), `getSecret` (`return (await kc.get(id)) ?? null;`), `deleteSecret` (`await kc.delete(id); return;`), `isSessionUnlocked` (`if (desktopKeychain()) return true;`), and `isMasterPasswordSet` (`if (desktopKeychain()) return true;`). Web path unchanged when `kc` is undefined. (Label is dropped — the OS keychain has no label slot; `listSecrets` keeps using IndexedDB metadata or returns the configured services — leave listSecrets web-only for v1 and note it; ApiKeysPanel's list can fall back to settings-store configuredServices on desktop, but that's a UI nicety out of scope here.)
- [ ] **Step 4: run → PASS; web typecheck + full web suite (147/7 baseline, no new failures). Commit:** `feat(web): route API-key storage to OS keychain on desktop (bypass master password)`

### Task A4: `apiFetch` desktop branch + skip renderer key-decrypt — TDD

**Files:** modify `apps/web/src/services/api-proxy.ts` + `apps/web/src/services/api-proxy.desktop.test.ts`; modify `useElevenLabsApi.ts`.

- [ ] **Step 1: failing test** (mock `window.openreel.cloud.fetch` returning `{status:200, statusText:"OK", headers:{"content-type":"application/json"}, body: new TextEncoder().encode('{"ok":true}').buffer}`): `apiFetch("openai","/chat/completions","IGNORED",{method:"POST",body:"{}"})` on desktop → calls `window.openreel.cloud.fetch("openai","/chat/completions",{method:"POST",body:"{}"})` (NOT the passed key), and returns a real `Response` with `status===200` and `await res.json()` `{ok:true}`.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: add the desktop branch at the TOP of `apiFetch`:**
```ts
  if (typeof window !== "undefined" && window.openreel?.platform === "desktop") {
    const r = await window.openreel.cloud.fetch(service, path, {
      method: options.method,
      headers: options.headers as Record<string, string> | undefined,
      body: typeof options.body === "string" ? options.body : undefined,
    });
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
```
(`apiKey` is intentionally unused on desktop — main reads it from the keychain.)
- [ ] **Step 4: `useElevenLabsApi.ts` — skip the renderer key-decrypt on desktop** so the key never enters renderer memory. Add a `const isDesktop = typeof window!=="undefined" && window.openreel?.platform==="desktop";` and at each of the 2 key-retrieval sites (`getSecret("elevenlabs")`, `getSecret(defaultLlmProvider)`) use `const key = isDesktop ? "" : await getSecret(service)`. The `isSessionUnlocked()` gates already pass on desktop (A3 returns true), so leave them. (apiFetch ignores the key on desktop.)
- [ ] **Step 5: run apiFetch test → PASS; web typecheck + full web suite (no new failures). Commit:** `feat(web): desktop AI calls via window.openreel.cloud.fetch (key never in renderer)`

---

# WORKSTREAM B — share-link origin (§5 #7)

### Task B1: inject `publicOrigin` on desktop — TDD

**Files:** modify `apps/web/src/hooks/use-router.ts` + `apps/web/src/services/share-service.ts`; add a small unit test.

- [ ] **Step 1: extract a tiny helper + failing test.** Add (in a shared spot or inline in each file) `function shareBaseOrigin(): string { if (typeof window==="undefined") return ""; if (window.openreel?.platform==="desktop") return window.openreel.publicOrigin; return `${window.location.origin}${window.location.pathname}`; }`. Test (jsdom): with `window.openreel={platform:"desktop",publicOrigin:"https://app.openreel.video"}`, `generateShareableLink("share",{id:"x"})` starts with `https://app.openreel.video#/` (NOT `app://`/`localhost`), and `getSharePageUrl("x")` === `https://app.openreel.video#/share/x`; without the bridge, it uses `window.location.origin`.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: replace the two `` `${window.location.origin}${window.location.pathname}` `` base computations** (`use-router.ts:159-162`, `share-service.ts:106-109`) with `shareBaseOrigin()`. Note: desktop `publicOrigin` has no trailing path, so `getSharePageUrl` becomes `https://app.openreel.video#/share/<id>` — correct.
- [ ] **Step 4: run → PASS; web typecheck + full web suite green. Commit:** `feat(web): share/deep-link URLs use public origin on desktop`

---

## Self-Review
**Coverage:** §6.8 BYOK → A1 (keychain) + A2 (cloud.fetch) + A4 (apiFetch); §5 #9 → A3; §5 #2 → A4; §5 #7 → B1. Server-proxy/desktop-auth explicitly deferred (no backend contract).
**No-regression:** every web edit is desktop-guarded (`window.openreel?.platform==="desktop"`); the web suite (147/7) must stay green after A3/A4/B1. Desktop suite + typechecks must stay green after A1/A2.
**Key-never-in-renderer:** A4 skips `getSecret` on desktop; cloud.fetch reads the key in main. The only renderer key exposure remaining is the explicit "reveal key" in ApiKeysPanel (user-initiated, acceptable) which still uses `getSecret`→keychain.
**Type/contract consistency:** `cloud.fetch` shape identical across global.d.ts ↔ preload ↔ main handler ↔ apiFetch consumer; the `DIRECT_CONFIG` mirror in `cloud.ts` must match `api-proxy.ts` (documented duplication).
**Verifiability:** KeyStore (safeStorage mocked), buildUpstreamRequest, secure-storage branch (mocked keychain), apiFetch branch (mocked cloud.fetch), share-link (jsdom) — all headless. Real OS keychain + live provider calls need the desktop app + real keys (human).

## Execution Handoff
Inline execution (per the current mode). Tasks are bite-sized + TDD; run gates per step.
