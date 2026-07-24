# OpenReel App-Attestation Token Broker — Canonical Contract

This is the authoritative spec for the anonymous-user GPU-job authorization flow.
The iOS and Android client agents implement against this document exactly.

## Goals

- Anonymous (no-login) users can run GPU jobs.
- Only genuine, unmodified instances of our apps can obtain authorization.
- No long-lived secret is bundled in the app.

## Model (hybrid)

1. App requests a one-time **challenge** from the Worker.
2. App proves authenticity:
   - iOS: **App Attest** — register a hardware key once, then sign an
     **assertion** over the challenge per token request.
   - Android: **Play Integrity** — return an integrity token bound to the
     challenge.
3. Worker verifies the proof and mints a short-lived **ES256 JWT**
   (`exp ~600s`, `scope: gpu:submit`, `aud: gpu`).
4. App uploads large media to **R2** via Worker-issued **presigned PUT** URLs.
5. App submits the GPU job to the GPU worker with `Authorization: Bearer <jwt>`,
   referencing inputs by R2 object key.
6. GPU worker validates the JWT against the Worker's public JWK and reads
   inputs / writes outputs in R2.

All endpoints are under the cloud Worker base URL (e.g. `https://openreel-cloud...workers.dev`),
mounted at `/auth`.

---

## Encodings

- All binary fields in JSON bodies are **standard base64** (padding optional;
  base64url is also accepted on input). The Worker emits base64url-without-padding
  for challenges and subjects.
- `challenge` is a 32-byte random nonce, returned base64url (no padding).
- Hashes are SHA-256 unless noted.

---

## 1. `POST /auth/challenge`

Request:

```json
{ "platform": "ios" | "android", "instanceId": "<app-generated stable id>" }
```

Response `200`:

```json
{ "challengeId": "<uuid>", "challenge": "<base64url nonce>" }
```

- The challenge is stored in KV with a **120-second TTL** and is **single-use**.
- `instanceId` is an app-stable identifier (e.g. iOS `identifierForVendor`,
  Android app-instance UUID). It is never returned to other parties; the JWT
  `sub` is `base64url(SHA256("instance:" + instanceId))`.

Errors: `400 invalid_platform`, `400 instance_id_required`, `403 revoked`,
`503 auth_unconfigured`.

---

## 2. `POST /auth/ios/register` (iOS, once per key)

Performed after `DCAppAttestService.generateKey` + `attestKey(_:clientDataHash:)`,
where `clientDataHash = SHA256(challenge)`.

Request:

```json
{
  "keyId": "<base64 keyId from generateKey>",
  "attestationObject": "<base64 CBOR attestation>",
  "challengeId": "<from /auth/challenge>"
}
```

Worker verification (Apple App Attest):

- CBOR-decode the attestation object; require `fmt == "apple-appattest"`.
- Parse `authData`: `rpIdHash(32) || flags(1) || signCount(4) || attestedCredentialData`.
- `rpIdHash == SHA256(teamID + "." + bundleID)`.
- Extract the nonce from the leaf cert extension OID `1.2.840.113635.100.8.2`
  and require it equals `SHA256(authData || SHA256(challenge))`.
- `keyId` equals the attested `credentialId`.
- Validate the certificate chain terminates at the bundled **Apple App Attest
  Root CA**.
- Extract the credential public key (COSE → JWK).

On success the Worker stores `{ keyId → publicKey(JWK), signCount, instanceId }`
and returns `200 { "ok": true }`.

Errors: `400 missing_fields`, `400 challenge_expired_or_used`,
`400 platform_mismatch`, `400 attestation_failed` (+ `detail`),
`403 revoked`, `503 apple_config_missing`.

---

## 3. `POST /auth/token`

Mint a job JWT. Always include `challengeId` from a fresh `/auth/challenge`.

### iOS body

```json
{
  "platform": "ios",
  "keyId": "<registered keyId>",
  "assertion": "<base64 CBOR assertion>",
  "challengeId": "<fresh challengeId>"
}
```

The assertion is produced by `DCAppAttestService.generateAssertion(_:clientDataHash:)`
with `clientDataHash = SHA256(challenge)`.

Worker verification (App Attest assertion):

- CBOR-decode → `{ signature, authenticatorData }`.
- `rpIdHash` matches `SHA256(teamID + "." + bundleID)`.
- `signCount` is **strictly greater** than the stored value (then persisted).
- Verify ECDSA-P256 signature over `authenticatorData || SHA256(challenge)`
  with the stored public key.

### Android body

```json
{
  "platform": "android",
  "integrityToken": "<Play Integrity token>",
  "challengeId": "<fresh challengeId>"
}
```

The Play Integrity request must use the challenge as the nonce (or
`requestHash`). Worker verification (decode via Google Play Integrity API):

- `appIntegrity.appRecognitionVerdict == "PLAY_RECOGNIZED"`.
- `deviceIntegrity.deviceRecognitionVerdict` contains `"MEETS_DEVICE_INTEGRITY"`.
- `appIntegrity.packageName == "com.pythonxi.openreelvideo"`.
- `requestDetails.nonce == challenge` **or** `requestDetails.requestHash`
  matches `SHA256(challenge)` (hex, base64, or base64url).

### Response `200` (both platforms)

```json
{ "token": "<ES256 JWT>", "exp": <unix seconds> }
```

JWT header: `{ "alg": "ES256", "kid": "<key id>" }`
JWT claims:

```json
{
  "iss": "openreel-cloud",
  "aud": "gpu",
  "plat": "ios" | "android",
  "sub": "<base64url SHA256 of instanceId>",
  "scope": "gpu:submit",
  "iat": <unix>,
  "exp": <iat + 600>,
  "jti": "<uuid>"
}
```

### Rate limits & revocation

- Sliding-window KV counters: **per-instanceId** (10 / 60s) and **per-IP**
  (30 / 60s, keyed on `CF-Connecting-IP`). Exceeding returns `429` with a
  `Retry-After` header.
- Revocation denylist (KV): a revoked `instanceId` or `keyId` returns `403`.

Errors: `400 invalid_platform`, `400 challenge_expired_or_used`,
`400 key_not_registered`, `400 missing_fields`, `403 assertion_failed`,
`403 play_integrity_failed`, `403 revoked`, `429 rate_limited`,
`503 signing_key_missing` / `play_integrity_unconfigured` / `apple_config_missing`.

---

## 4. `POST /auth/upload-url` (auth: job JWT)

Header: `Authorization: Bearer <job JWT>`.

Request:

```json
{ "filename": "clip.mp4", "contentType": "video/mp4" }
```

Response `200`:

```json
{
  "putUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/jobs/<sub>/<uuid>/<safeFilename>?X-Amz-...",
  "getUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/jobs/<sub>/<uuid>/<safeFilename>?X-Amz-...",
  "objectKey": "jobs/<sub>/<uuid>/<safeFilename>",
  "bucket": "openreel-assets",
  "expiresAt": "<ISO8601>"
}
```

- Presigned via R2 S3-compatible SigV4 (`region=auto`, `UNSIGNED-PAYLOAD`,
  signed header `host` only — the client may send any `Content-Type`).
- Object key: `jobs/{sub}/{uuid}/{safeFilename}`; filename is sanitized to
  `[A-Za-z0-9._-]`.
- Expiry: 900s.
- The app PUTs the file to `putUrl`, then submits the GPU job referencing
  `objectKey` as `mediaKey`.

Errors: `401 unauthorized` / `invalid_token`, `400 filename_required`,
`503 r2_unconfigured` / `signing_key_missing`.

---

## 5. GPU worker authorization

The GPU worker (`infra/gpu-worker`) replaces the static bearer check:

- `Authorization: Bearer <jwt>` is validated as **ES256** against `AUTH_PUBLIC_JWK`.
- Checks: `iss == openreel-cloud`, `aud == gpu`, `scope == gpu:submit`, `exp`
  not passed, required claims present. Small in-memory **jti replay cache**
  (TTL 900s) rejects token reuse.
- Migration flag `OPENREEL_JWT_REQUIRED` (default `true`). When `false` and
  `OPENREEL_API_KEY` is set, the legacy static bearer is still accepted as a
  fallback — for cutover only.
- Job inputs are referenced by R2 object key (`mediaKey`, the `objectKey`
  returned by `/auth/upload-url`). The worker reads inputs and writes outputs
  through `core/storage.py`, which targets R2 (S3-compatible) when
  `OPENREEL_R2_ACCOUNT_ID` is set.

GPU env:

| Var | Purpose |
|-----|---------|
| `AUTH_PUBLIC_JWK` | P-256 **public** JWK (JSON) matching the Worker signing key |
| `OPENREEL_JWT_REQUIRED` | `true` (default) to require JWT; `false` enables legacy fallback |
| `OPENREEL_API_KEY` | legacy static bearer (fallback only) |
| `OPENREEL_JTI_CACHE_TTL_SECONDS` | replay cache TTL (default 900) |
| `OPENREEL_R2_ACCOUNT_ID` | enables R2 mode in storage |
| `OPENREEL_R2_ACCESS_KEY_ID` / `OPENREEL_R2_SECRET_ACCESS_KEY` | R2 S3 creds |
| `OPENREEL_R2_BUCKET` | R2 bucket (default `openreel-assets`) |

---

## Worker bindings & secrets (owner setup)

KV namespace:

```bash
cd apps/cloud
wrangler kv namespace create AUTH_KV
# paste the returned id into wrangler.jsonc -> kv_namespaces[0].id
```

Non-secret vars (in `wrangler.jsonc`): `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`
(`com.openreel.video`), `ANDROID_PACKAGE_NAME` (`com.pythonxi.openreelvideo`),
`R2_ACCOUNT_ID`, `R2_ASSETS_BUCKET_NAME` (`openreel-assets`).

Secrets (`wrangler secret put <NAME>`):

```bash
# P-256 private JWK (JSON string) used to sign job JWTs. Generate one:
#   node -e "const {generateKeyPairSync}=require('crypto');const {privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});const jwk=privateKey.export({format:'jwk'});jwk.kid='auth-key-1';console.log(JSON.stringify(jwk))"
wrangler secret put AUTH_SIGNING_JWK

# OAuth access token (or short-lived JWT) for the Play Integrity decode API,
# minted from the Google service account with the Play Integrity scope.
wrangler secret put PLAY_INTEGRITY_ACCESS_TOKEN

# R2 S3-compatible access key + secret (R2 -> Manage API Tokens).
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

The Apple App Attest Root CA is **bundled as a public constant** in
`src/auth/appattest.ts` — no secret needed.

GPU worker: set `AUTH_PUBLIC_JWK` to the public half of `AUTH_SIGNING_JWK`
(strip the `d` member). The `GPU_PUBLIC_JWK_HINT` mentioned in planning maps to
this `AUTH_PUBLIC_JWK` env on the GPU side.

---

## Test coverage & honest gaps

Fully E2E-tested (vitest / pytest):

- Challenge issue + TTL expiry + single-use replay rejection.
- JWT mint + verify round-trip; expired / tampered / wrong-scope / wrong-aud /
  wrong-iss rejected (both Worker and GPU).
- iOS **assertion** path with real WebCrypto P-256 signatures (signCount
  increment + non-increasing rejection).
- Android Play Integrity verdict logic via an injected decoder (good verdict
  mints; missing `MEETS_DEVICE_INTEGRITY` rejected).
- Per-instance rate-limit `429`; revocation `403`.
- Presigned URL shape + object-key sanitization + signature determinism.
- GPU: valid token accepted; missing/expired/wrong-scope/wrong-aud/wrong-iss/
  tampered/replayed tokens rejected.

Implemented to spec but **not** E2E-verified (require real device / store env):

- iOS App Attest **attestation registration** full X.509 chain *signature*
  verification: the code parses CBOR/authData, checks the nonce extension,
  rpId hash, credentialId, and that the chain issuer terminates at the bundled
  Apple Root CA subject. It does **not** cryptographically verify each
  intermediate certificate signature (structural/issuer-linkage check only).
  Full validation needs a genuine Apple-issued attestation from a real device.
- Android Play Integrity **live decode**: the Google Play Integrity API call
  (`googlePlayIntegrityDecoder`) is implemented to spec but tested only via an
  injected decoder; the real Google round-trip needs a Play-signed token and a
  service-account access token.
