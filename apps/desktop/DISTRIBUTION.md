# OpenReel Desktop — Distribution Guide

How to build, sign, notarize, and ship the desktop app for **macOS, Windows, and Linux**.

Packaging is `electron-builder` (config: `apps/desktop/electron-builder.yml`). The renderer is the `apps/web` build, bundled into the app and served over a hardened `app://` protocol. Native export/transcode use a bundled `ffmpeg` binary per platform.

---

## 1. Build commands

```bash
# from apps/desktop
pnpm build            # builds renderer (apps/web) + main/preload (tsup)
pnpm pack             # electron-builder --dir : unpacked .app, NO signing/notarization (local testing)
pnpm dist             # full installers (dmg/zip, nsis, AppImage/deb) WITH signing + notarization
```

`pnpm pack` is for local smoke-testing; it produces an ad-hoc-signed app that only runs on your machine. `pnpm dist` produces the real, distributable artifacts and requires the credentials below.

---

## 2. ffmpeg binaries (automated)

The app spawns a bundled `ffmpeg` from `resources/bin/<platform>-<arch>/ffmpeg[.exe]` (resolver: `apps/desktop/src/main/sidecar/ffmpeg-path.ts`). Binaries are **gitignored** and fetched on demand:

```bash
pnpm --filter @openreel/desktop fetch:ffmpeg          # host platform's slots
node apps/desktop/scripts/fetch-ffmpeg.mjs --all       # every slot
```

`fetch-ffmpeg.mjs` downloads pinned, **statically-linked** GPL builds from `eugeneware/ffmpeg-static` (release `b6.1.1`), verifies each against a hardcoded SHA256, writes them into `resources/bin/<slot>/`, and refreshes `MANIFEST.json`. It is wired into `pnpm pack`/`pnpm dist` and the release CI. The macOS host fetches **both** `darwin-arm64` and `darwin-x64` because the mac runner builds both arches. These builds link only system frameworks (VideoToolbox/AudioToolbox/AVFoundation) and include `libx264`/`libx265`/`prores`/AAC — verified self-contained (`otool -L` shows no `/opt/homebrew`).

**Licensing:** these are **GPL** builds (x264/x265). ffmpeg is invoked as a separate process (not linked), so this is GPL-compatible; ship attribution per `LICENSES/FFMPEG.md` (a product/legal decision to finalize).

> The macOS bundled ffmpeg is **signed** as part of the app bundle when a Developer ID identity is configured (electron-builder signs bundled binaries automatically).

---

## 3. macOS signing + notarization

**Signing identity** — configured in `electron-builder.yml` as
`Developer ID Application: Augustus Otu (864H636QW4)` (Team ID **864H636QW4**),
which is present in this machine's keychain. For CI, install the same Developer ID
cert via `CSC_LINK` (base64/path to a `.p12`) + `CSC_KEY_PASSWORD`.

**Notarization** — `mac.notarize.teamId: 864H636QW4` is set; `notarytool` is
installed (Xcode). Provide credentials ONE of two ways:

```bash
# Option A: saved keychain profile (simplest locally) — run once:
xcrun notarytool store-credentials openreel-notary \
  --apple-id "you@example.com" --team-id 864H636QW4 \
  --password "abcd-efgh-ijkl-mnop"        # app-specific password (appleid.apple.com)
export APPLE_KEYCHAIN_PROFILE=openreel-notary

# Option B: env (CI) — Apple ID:
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="864H636QW4"

# Option B': env (CI) — App Store Connect API key (preferred for CI):
export APPLE_API_KEY="/path/to/AuthKey_XXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Then `pnpm dist` signs with the Developer ID, staples the notarization ticket, and produces a Gatekeeper-passing dmg/zip. Without credentials, `pnpm dist` fails on the notarize step (use `pnpm pack` for unsigned local builds).

---

## 4. Windows signing

Provide an OV/EV Authenticode certificate via env (used by electron-builder for the NSIS installer):

```bash
export CSC_LINK="/path/to/win-cert.pfx"   # or base64 of the .pfx
export CSC_KEY_PASSWORD="…"
```

In the release CI these come from the `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets. (Without them, the Windows installer is unsigned and triggers SmartScreen warnings — acceptable for internal testing only; the release workflow still builds it.)

---

## 5. Hosting + auto-update (R2 → dl.openreel.video)

Built apps are **not** on GitHub Releases. They live in a Cloudflare **R2**
bucket served at **`https://dl.openreel.video`**, which hosts:

- the installers — `OpenReel-<version>-arm64.dmg`, `-x64.dmg`, `-x64.exe`, `-x86_64.AppImage`, `-amd64.deb` (electron-builder's arch token differs per target: x64 → `x86_64` for AppImage, `amd64` for deb),
- the electron-updater feed (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `*.zip`, `*.blockmap`),
- `manifest.json` — the human-download index the landing page reads.

`electron-builder.yml` sets `publish: { provider: generic, url: https://dl.openreel.video }`, so each build embeds that update feed and emits `latest*.yml` + blockmaps (the generic provider does not upload — the CI does, §6).

**Self-update flow** (`src/main/updater.ts`, `initAutoUpdater`): on launch it checks the R2 feed in the background (`autoDownload = false`). When a newer version exists the renderer shows an **update banner** (`apps/web/src/desktop/UpdateBanner.tsx`); the user clicks **Download** (`window.openreel.updater.download()` → in-app progress) and then **Restart & Install** (`updater.install()`), which quits through the normal flow so `autoInstallOnAppQuit` applies the update **after** the unsaved-changes guard. Nothing downloads or installs without consent.

Caveats: macOS install requires the build to be **signed** (Squirrel.Mac) — the CI does not upload an unsigned mac update feed; Linux auto-update is **AppImage** only (not `.deb`). The DMG/installers are always uploaded for manual download regardless of signing.

### R2 setup (one-time, in the Cloudflare dashboard)

1. **Create a bucket** (e.g. `openreel-desktop`).
2. **Attach the custom domain** `dl.openreel.video` to the bucket (R2 → bucket → Settings → Public access → Custom Domains). This makes objects public at `https://dl.openreel.video/<key>`.
3. **Create an R2 API token** (Account → R2 → Manage API Tokens) with Object Read & Write on that bucket; note the Access Key ID + Secret + your Account ID.
4. **CORS** so the landing (a different origin) can `fetch` `manifest.json` — already configured on the bucket via `wrangler r2 bucket cors set` for `https://openreel.video`, `www.`, `app.`, and `localhost:5173/3000` (dev). The desktop updater runs from the main process and is not CORS-bound. Add any new landing origin (e.g. a `*.pages.dev` preview) to that policy.

---

## 6. Release CI (build → R2)

`.github/workflows/release.yml` runs a `quality` gate (typecheck + tests) then
builds all three platforms on a matrix (macos → dmg/zip arm64+x64, windows →
nsis x64, ubuntu → AppImage/deb x64) on a `v*` tag (or `workflow_dispatch` with
`publish: true`). Each runner fetches ffmpeg, builds renderer+main, packages
with `electron-builder --publish never`, then **uploads to R2** via `aws s3`
(R2's S3 API). A final `manifest` job builds + uploads `manifest.json`.

Signing degrades gracefully: signed when the cert secret is present, unsigned
otherwise (the unsigned mac update feed is withheld). Set these encrypted Actions
**secrets**:

| Secret | Used for |
|---|---|
| `R2_ACCOUNT_ID` | R2 S3 endpoint (`https://<id>.r2.cloudflarestorage.com`) |
| `R2_BUCKET` | the bucket name (e.g. `openreel-desktop`) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token credentials |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | Developer ID `.p12` (base64) + password |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | notarization (`864H636QW4`) |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Authenticode `.pfx` (base64) + password |

**Cutting a release:** bump `apps/desktop/package.json` version, commit, push a
matching `vX.Y.Z` tag to the (private) origin. CI builds, uploads to R2, and
writes `manifest.json` — clients then see the update and the landing page shows
the new downloads. No manual publish step. (`desktop-readiness.yml` is an
unrelated stale Rust workflow; remove separately.)

### Landing page

`../openreel-landing` renders a desktop download section
(`components/DesktopDownload.tsx`) that fetches `https://dl.openreel.video/manifest.json`
at runtime and shows per-OS buttons (OS-detected primary CTA + all-platforms
list). No rebuild of the landing is needed for a new desktop version — it reads
the live manifest.

---

## 7. App identity

- Product name: **OpenReel** · appId: `video.openreel.desktop` · version: `apps/desktop/package.json`.
- Note: the GPU bundle id referenced in `src/main/index.ts` (`com.openreel.video`) differs from `video.openreel.desktop` — reconcile if a single identity is desired.

## What we (the product owner) must provide
1. ~~ffmpeg binaries / GPL attribution / auto-update~~ — **done** (§2, §5).
2. **R2 + subdomain** (one-time): create the bucket, bind `dl.openreel.video` to it, mint an R2 API token (§5), and set `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` as CI secrets.
3. **macOS signing**: `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` + `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (§3, §6) — required for mac auto-update to install.
4. **Windows signing**: `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`, or accept unsigned Windows (§4).
5. Fill in the real support / source-offer contact in `LICENSES/FFMPEG.md`.
