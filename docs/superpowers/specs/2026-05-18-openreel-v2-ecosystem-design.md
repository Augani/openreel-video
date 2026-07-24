# OpenReel v2 Ecosystem Design

## Overview

OpenReel v2 transforms the iOS video editor into a full creator platform competing with CapCut. The app remains fully functional offline with on-device AI, enhanced by cloud GPU power, a token-based economy ($ORC on Solana), a creator marketplace, and real-time collaboration.

**Core principle: the app works fully without internet. Cloud enhances, never gates.**

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   iOS App (fully offline-capable)         │
│  On-device AI (Core ML) + Local editing + Local export   │
├─────────────────────────────────────────────────────────┤
│              Cloudflare Workers (API Gateway)             │
│  Auth, marketplace, project sync, AI routing, token API  │
├──────────────────────┬──────────────────────────────────┤
│  Cloudflare Services │     AWS Spot GPU Fleet            │
│  R2 (media storage)  │  Heavy AI (upscale, gen, remove)  │
│  D1 (user/project DB)│  Premium renders (8K, long-form)  │
│  Workers AI (light)  │  Batch processing                 │
│  Durable Objects     │                                   │
│  (collab sessions)   │                                   │
├──────────────────────┴──────────────────────────────────┤
│              Solana (OpenReel Coin — $ORC)                │
│  SPL token, marketplace escrow, creator earnings         │
└─────────────────────────────────────────────────────────┘
```

## 1. On-Device AI (Core ML — Free, Instant, Offline)

All on-device AI runs locally via Core ML, requires no internet, and costs no $ORC.

| Feature | Model/Framework | Function |
|---------|----------------|----------|
| Auto-captions | Whisper (distilled, ~80MB) | Real-time speech-to-text, word-level timestamps, 50+ languages |
| Smart cut / silence removal | VAD + Whisper | Detect and remove dead air, filler words ("um", "uh") |
| Object tracking | YOLO / Vision framework | Track faces/objects for auto-framing, sticker attachment |
| Scene detection | Vision classifier | Auto-split clips at scene boundaries |
| Background removal | Segment Anything (mobile) | Real-time green-screen without green screen |
| Face detection + beautify | Vision + Core Image | Smooth skin, brighten eyes, reshape |
| Auto-reframe | Object detection + crop | Convert 16:9 → 9:16 by tracking subject |
| Smart color match | Histogram analysis | Match color/exposure across clips |
| Audio enhancement | RNNoise (Core ML) | Denoise, de-reverb, normalize — one-tap "enhance voice" |

### Model management

- Models download on first use (not bundled with app binary to stay under App Store size limits)
- Cached locally after download (~500MB total for all models)
- Versioned — app checks for model updates on launch (background, non-blocking)
- Graceful fallback — if model not downloaded, show download prompt instead of failing

### Performance targets

| Task | Target latency | Device minimum |
|------|---------------|----------------|
| Background removal | < 50ms/frame (real-time preview) | A14+ |
| Auto-captions | Real-time (streaming) | A13+ |
| Scene detection | < 200ms per cut point | A13+ |
| Object tracking | < 30ms/frame | A14+ |
| Auto-reframe | < 100ms per frame decision | A14+ |

## 2. Cloud AI (AWS Spot GPU — Costs $ORC, Async)

Heavy AI workloads that exceed device capability. All cloud AI is async — user submits job, gets notified when complete.

| Feature | Model | Approx GPU time | $ORC cost |
|---------|-------|-----------------|-----------|
| AI video upscale | Real-ESRGAN | ~30s per minute of video | 5 |
| AI background generation | SDXL | ~15s per image | 8 |
| AI B-roll generation | Video diffusion (SVD/CogVideo) | ~2 min per 10s clip | 30 |
| Voice cloning setup | XTTS-v2 | ~5 min one-time | 80 |
| Voice TTS (after clone) | XTTS-v2 | ~10s per 30s audio | 10 |
| AI music generation | MusicGen | ~30s per 30s track | 15 |
| Style transfer | Neural style transfer | ~1 min per minute of video | 15 |
| AI avatar / talking head | SadTalker / EMO | ~3 min per 30s | 50 |
| Frame interpolation | RIFE | ~1 min per minute (24→60fps) | 10 |
| Long-form → highlights | LLM + transcript analysis | ~30s | 5 |

### GPU Pipeline Architecture

```
iOS App                    Cloudflare Worker              AWS
───────                    ────────────────              ───
1. User taps "Upscale"
2. Upload source to R2 ──→ 3. Validate auth
   (presigned URL)            Check $ORC balance
                              Deduct tokens (escrow)
                              Push job to SQS ─────────→ 4. Spot instance pulls job
                              Return job_id                  Downloads from R2
                                                            Runs model
                                                            Uploads result to R2
                           5. Webhook: job complete ←────── POST /webhook/complete
                              Release escrow
                              Send push notification
6. App receives push
   Downloads result from R2
   Shows in project
```

### Spot fleet configuration

- Instance types: g5.xlarge (A10G, 24GB VRAM) for most tasks, g5.2xlarge for video gen
- Auto-scaling: 0 → 50 instances based on SQS queue depth (ApproximateNumberOfMessages)
- Scale-to-zero when idle — no base cost
- Spot interruption handling: jobs are idempotent, return to queue on interruption
- Mix: 80% spot / 20% on-demand for reliability floor
- Region: us-east-1 primary (cheapest spot), us-west-2 failover
- Checkpointing: long jobs (video gen > 60s) save intermediate state to S3 every 30s

### Job states

```
PENDING → QUEUED → PROCESSING → UPLOADING → COMPLETE
                 ↓                              ↑
              INTERRUPTED → (re-queued) ────────┘
                 ↓
              FAILED (after 3 retries)
```

On FAILED: refund $ORC from escrow back to user.

## 3. Marketplace

A creator-to-creator marketplace where assets are sold for $ORC with instant Solana settlement.

### Asset types

| Type | Description | Typical price range |
|------|-------------|-------------------|
| Templates | Full edit templates with media placeholders | 10-100 $ORC |
| Effect presets | Color grades, LUT packs, filter chains | 5-50 $ORC |
| Text styles | Animated text presets, kinetic typography | 5-30 $ORC |
| Transitions | Custom transition effects | 5-20 $ORC |
| Sound packs | SFX bundles, music loops (royalty-free) | 10-80 $ORC |
| AI workflows | Saved AI generation recipes with prompts | 5-30 $ORC |

### Revenue split

- Creator: 70%
- Platform (OpenReel treasury): 30%
- Enforced on-chain via the escrow program

### Purchase flow

```
Buyer taps "Buy" (15 $ORC)
  → App signs Solana transaction (buyer wallet → escrow PDA)
  → CF Worker detects on-chain confirmation
  → Worker decrypts asset from R2, generates download URL
  → Asset added to buyer's library
  → Escrow releases: 10.5 $ORC → seller, 4.5 $ORC → treasury
```

### Creator publishing flow

1. Creator builds template/preset in the editor
2. Taps "Publish to Marketplace"
3. Adds: title, description, preview video (auto-generated from template), price, category, tags
4. Asset encrypted and uploaded to R2
5. Listing metadata stored in D1
6. Goes live after automated review (check for prohibited content via Workers AI)

### Discovery

- Categories: Templates, Color, Text, Transitions, Audio, AI Workflows
- Trending: ranked by purchases in last 7 days
- Curated collections: editor's picks, seasonal themes
- Search: full-text search on title + description + tags (D1 FTS)
- Creator profiles: see all assets by a creator, their total sales, rating

### Creator tools

- Analytics dashboard: sales over time, revenue, top assets, conversion rate
- Version updates: push updates to existing assets (buyers auto-receive)
- Bundle pricing: sell multiple assets as a discounted pack
- Free samples: offer 1 free asset as lead magnet
- Promo codes: generate discount codes for marketing

## 4. Real-Time Collaboration

Figma-style multiplayer editing — multiple people editing the same project simultaneously.

### Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Session coordination | Cloudflare Durable Object (1 per active project) | Manages connected users, cursor positions, lock state, action broadcast |
| Real-time transport | WebSocket (via DO) | Low-latency bidirectional state sync |
| Conflict resolution | Track-level locking + OT for metadata | Prevents destructive conflicts while allowing parallel work |
| Project storage | R2 (media) + D1 (project JSON, versions) | Persistent state between sessions |
| Offline reconciliation | CRDT-based merge on reconnect | Edit offline → reconnect → auto-merge non-conflicting changes |

### Collaboration model

- **Track locking**: when a user starts editing a track (trim, move, add effect), that track locks for others. Lock releases on deselect or after 30s idle.
- **Non-conflicting edits**: two users can edit different tracks simultaneously without conflict.
- **Live cursors**: each collaborator's playhead position visible as a colored line on the timeline.
- **Presence indicators**: avatars in top bar showing who's in the session.

### Roles

| Role | Permissions |
|------|------------|
| Owner | Full control, manage collaborators, delete project |
| Editor | Edit all tracks, add/remove media, export |
| Commenter | View project, add timeline comments, cannot edit |
| Viewer | View-only, cannot comment or edit |

### Timeline comments

- Pin comments to specific timecodes
- Thread replies
- @mention collaborators (push notification)
- Resolve/unresolve threads
- Comments persist across sessions (stored in D1)

### Version history

- Every collab session auto-saves versions (every 60s of activity)
- Named versions: "After color grade" — user can label checkpoints
- Roll back to any version (creates a new branch, doesn't destroy history)
- Diff view: see what changed between versions (added/removed clips highlighted)

### Limits

| Tier | Shared projects | Simultaneous editors |
|------|----------------|---------------------|
| Free | 1 | 2 |
| Hold 50 $ORC | 5 | 3 |
| Hold 200 $ORC | Unlimited | 5 |

### Cross-platform

- iOS ↔ iOS collaboration works
- iOS ↔ Web collaboration works (same DO, same WebSocket protocol)
- Same project format — no conversion needed

## 5. OpenReel Coin ($ORC) — Token Economics

### Token properties

| Property | Value |
|----------|-------|
| Chain | Solana (SPL token) |
| Total supply | 1,000,000,000 $ORC (fixed, mint authority burned) |
| Decimals | 6 |
| Standard | SPL Token-2022 (for transfer hooks if needed later) |

### Distribution

| Allocation | Amount | Vesting |
|------------|--------|---------|
| Creator rewards pool | 400M (40%) | Released over 5 years based on platform activity |
| Treasury (team) | 200M (20%) | 12-month cliff, 36-month linear vest |
| DEX liquidity | 150M (15%) | Locked in LP at launch |
| User acquisition | 150M (15%) | Released as sign-up bonuses, streaks, referrals over 3 years |
| Advisors + early contributors | 100M (10%) | 6-month cliff, 24-month linear vest |

### How users acquire $ORC

1. **Buy on DEX**: swap SOL or USDC for $ORC on Raydium/Orca
2. **In-app purchase**: Apple Pay → SOL → $ORC (via Jupiter aggregator, routed through backend)
3. **Earn - marketplace sales**: sell templates/presets, receive 70% of sale price
4. **Earn - daily streaks**: edit consecutively → earn small token rewards (diminishing returns)
5. **Earn - referrals**: invite new users → earn 5% of their first 30 days of purchases
6. **Earn - challenges**: weekly editing challenges with $ORC prize pools

### How users spend $ORC

1. **Cloud AI tasks**: per-job pricing (see Section 2)
2. **Marketplace purchases**: buy templates, presets, sounds
3. **Premium cloud export**: 8K, batch, Dolby Vision
4. **Priority queue**: 2x $ORC for front-of-queue GPU processing
5. **Pro feature access**: hold minimum balance (100 $ORC) to unlock pro editing features

### Balance-gated features (hold, not spend)

Pro editing features unlock when the user's wallet holds a minimum $ORC balance. Tokens are not consumed — just held. This creates demand without punishing usage:

| Feature set | Minimum balance |
|-------------|----------------|
| Pro editing (multicam, masking, nested timelines, speed ramping) | 100 $ORC |
| Extended cloud storage (50 GB) | 50 $ORC |
| Full cloud storage (500 GB) | 200 $ORC |
| Unlimited collab projects | 200 $ORC |

### In-app wallet

- **Key generation**: Ed25519 keypair generated on first launch
- **Storage**: private key in iOS Keychain (hardware-backed on devices with Secure Enclave)
- **UX**: no seed phrase shown by default — feels like a normal app account
- **Advanced export**: settings → "Export Wallet" reveals seed phrase for power users
- **External wallet**: can connect Phantom/Solflare via deep link for users who prefer self-custody
- **Balance display**: $ORC balance in top bar of editor, tap to see transaction history / buy more

### Apple App Store compliance

- In-app $ORC purchases via Apple IAP (Apple takes 30%) — required for in-app token buying
- External wallet funding (transfer $ORC from any Solana wallet) — Apple cannot block
- Marketplace transactions use $ORC directly — "user-generated digital goods" exemption applies
- No real-money cashout from within the app (users go to DEX externally)

### Solana programs (smart contracts)

| Program | Purpose |
|---------|---------|
| Token mint | SPL Token-2022 mint with burned authority |
| Marketplace escrow | PDA-based escrow: holds buyer payment, releases to seller on asset delivery confirmation |
| Vesting | Linear vesting with cliff for team/advisor allocations |
| Rewards distributor | Merkle-based airdrop for streak/referral/challenge rewards (batch-claimable) |

## 6. Pro Features (Balance-Gated)

On-device features that unlock when holding ≥100 $ORC. No per-use cost.

| Feature | Description |
|---------|-------------|
| Motion tracking (precision) | Sub-pixel tracking, attach any element to tracked point with smoothing |
| Masking + rotoscope | Draw bezier masks, AI-assisted edge refinement, animate mask keyframes |
| Speed ramping curves | Bezier-based speed control with visual curve editor |
| Multicam editing | Sync multiple camera angles by audio, switch between them on timeline |
| Proxy workflow | Edit on auto-generated low-res proxies, conform to full-res on export |
| Nested timelines | Compound clips — edit a sub-sequence, use it as a single clip in parent |
| Audio sync | Auto-sync separate audio recording to video via waveform correlation |
| Adjustment layers | Apply effects to all layers below without per-clip setup |
| Scopes | Waveform monitor, vectorscope, histogram — professional color reference |

## 7. Premium Cloud Export

Cloud-rendered exports for users who need power beyond their device.

### Multi-platform batch export

One tap exports all platform versions simultaneously on cloud GPUs:

| Platform | Aspect | Resolution | Codec |
|----------|--------|-----------|-------|
| YouTube | 16:9 | 4K / 1080p | H.265 |
| TikTok | 9:16 | 1080p | H.264 |
| Instagram Reels | 9:16 | 1080p | H.264 |
| Instagram Feed | 1:1 / 4:5 | 1080p | H.264 |
| Twitter/X | 16:9 | 720p | H.264 (optimized) |
| Podcast clip | 1:1 | 1080p | H.264 + waveform overlay |

Cost: 10 $ORC for full batch (vs. one-at-a-time on-device for free).

### Cloud-exclusive capabilities

| Feature | Description | $ORC cost |
|---------|-------------|-----------|
| 8K export | Full 8K render on cloud GPU | 20 per minute |
| Frame interpolation | 24fps → 60/120fps (RIFE model) | 10 per minute |
| Dolby Vision mastering | HDR grading + DV metadata | 15 per minute |
| ProRes 4444 | Highest quality intermediate codec | 10 per minute |
| Batch versions | Export 10 variations (different music, text, etc.) | 5 per additional version |

### Direct publishing (future v2.5+)

- Connect YouTube/TikTok/Instagram accounts via OAuth
- Export → publish with title, description, tags, thumbnail
- Schedule posts
- Basic analytics dashboard (views, engagement)

## 8. Project Sync + Offline-First Architecture

### Sync model

```
┌─────────────────────────────────────────────┐
│  iOS App (source of truth while offline)     │
│  project.json ←→ Local SQLite + FileManager  │
│  media files  ←→ Local storage               │
│  AI results   ←→ cached locally              │
└──────────────────┬──────────────────────────┘
                   │ (when online, background)
                   ▼
┌─────────────────────────────────────────────┐
│  Cloudflare R2 + D1                          │
│  project.json (versioned snapshots)          │
│  media manifests (content-hash references)   │
│  AI results cache                            │
│  Collaboration state                         │
└─────────────────────────────────────────────┘
```

### Sync rules

1. All edits write to local storage immediately — never wait for network
2. Project JSON syncs to cloud every 30s while online (debounced, delta-compressed)
3. Media uploads are opt-in — only sync if user enables cloud backup or starts collab
4. Solo projects: last-write-wins conflict resolution
5. Collab projects: OT merge via Durable Object
6. Cloud AI requests queue locally when offline, fire when connectivity returns
7. If cloud is unreachable, everything still works except cloud AI and collab

### Cross-device continuity

- Same project format across iOS, iPad, and web app
- Media references use content-addressable hashes (SHA-256 of file)
- Open project on any device — media re-links automatically if file exists locally
- Missing media shows placeholder with "Download from cloud" option

### Storage tiers

| Tier | Cloud storage | Requirement |
|------|---------------|-------------|
| Free | 5 GB (project JSON + thumbnails) | None |
| Creator | 50 GB (projects + shared media) | Hold 50 $ORC |
| Pro | 500 GB (full media backup) | Hold 200 $ORC |

## 9. Cloudflare Workers API (Expanded)

Expanding the existing Hono-based Workers app into a full platform backend.

### Service map

| Route group | Binding | Purpose |
|-------------|---------|---------|
| `/auth/*` | D1, KV | Wallet-based auth (Sign-In with Solana message signing), session tokens |
| `/users/*` | D1 | Profiles, preferences, wallet addresses, subscription state |
| `/projects/*` | R2, D1 | CRUD, versioning, sync endpoints, media manifests |
| `/marketplace/*` | R2, D1 | Listings, search, categories, reviews, purchase flow |
| `/ai/*` | Queue, R2 | Job submission, status polling, webhook receiver, result delivery |
| `/collab/*` | Durable Objects | Session creation, WebSocket upgrade, presence |
| `/templates/*` | R2 | (Existing) Template storage and retrieval |
| `/shares/*` | R2 | (Existing) Video sharing |
| `/highlights/*` | Workers AI | (Existing) AI highlight extraction |
| `/token/*` | External (Solana RPC) | Balance checks, transaction verification, escrow status |
| `/notifications/*` | Queue | Push notification dispatch (APNs) |
| `/analytics/*` | Analytics Engine | Usage tracking, creator dashboard data |

### Auth flow (Sign-In with Solana)

```
1. App requests nonce from /auth/nonce
2. User signs nonce with wallet private key (Keychain)
3. App sends signature + public key to /auth/verify
4. Worker verifies signature against public key
5. Worker issues JWT session token (stored in KV with expiry)
6. All subsequent requests include JWT in Authorization header
```

### Cloudflare bindings needed

| Binding | Name | Purpose |
|---------|------|---------|
| D1 | OPENREEL_DB | Users, projects metadata, marketplace listings, reviews, comments |
| R2 | MEDIA_BUCKET | User media, project files, exported videos |
| R2 | MARKETPLACE_BUCKET | Encrypted marketplace assets |
| R2 | TEMPLATES_BUCKET | (Existing) Template storage |
| R2 | SHARES_BUCKET | (Existing) Shared video storage |
| KV | SESSIONS | JWT session storage with TTL |
| KV | RATE_LIMITS | Per-user rate limiting counters |
| Queue | AI_JOBS | Queue for dispatching to AWS GPU fleet |
| Queue | NOTIFICATIONS | Push notification dispatch queue |
| Durable Object | CollabSession | One instance per active collaborative editing session |
| Workers AI | AI | Light AI tasks (text generation, content moderation) |
| Analytics Engine | ANALYTICS | Usage events, creator metrics |

### D1 Schema (key tables)

```sql
users (id, wallet_address, display_name, avatar_url, created_at, settings_json)
projects (id, owner_id, name, resolution, fps, duration, version, updated_at, is_collab)
project_versions (id, project_id, version_num, json_r2_key, created_at, label)
project_collaborators (project_id, user_id, role, invited_at)
marketplace_listings (id, creator_id, type, title, description, price_orc, category, tags, rating_avg, purchase_count, asset_r2_key, preview_r2_key, status, created_at)
marketplace_purchases (id, listing_id, buyer_id, tx_signature, amount_orc, purchased_at)
marketplace_reviews (id, listing_id, user_id, rating, comment, created_at)
ai_jobs (id, user_id, type, status, input_r2_key, output_r2_key, cost_orc, created_at, completed_at)
timeline_comments (id, project_id, user_id, timecode_ms, body, thread_parent_id, resolved, created_at)
```

## 10. Earning Without Selling

Users who don't create marketplace assets can still earn $ORC:

| Mechanism | Reward | Limit |
|-----------|--------|-------|
| Daily editing streak (3+ days) | 1 $ORC/day | Max 30/month |
| Weekly editing streak (7+ days) | 5 $ORC bonus | Max 20/month |
| Referral (new user signs up + makes first edit) | 10 $ORC | No limit |
| Referral ongoing (5% of referee's purchases for 30 days) | Variable | Capped at 100 $ORC/referral |
| Weekly challenge winner | 50-200 $ORC (from pool) | 1 winner/week |
| Challenge participation (submit entry) | 2 $ORC | 1/week |

All rewards come from the User Acquisition allocation (150M $ORC over 3 years).

## 11. Implementation Phases

### Phase v2.0 — On-Device AI (6 weeks)

1. Core ML model pipeline: download manager, version checker, fallback handling
2. Whisper integration: streaming transcription, word-level timestamps
3. Auto-captions UI: generated subtitle track, editable text, style presets
4. Smart cut: silence detection → auto-generate cut points → user confirms
5. Background removal: SAM mobile model, real-time preview, matte refinement
6. Auto-reframe: subject detection → crop keyframe generation → preview
7. Scene detection: auto-split at scene changes, user can accept/reject splits
8. Audio enhancement: one-tap denoise + normalize + de-reverb
9. Smart color match: reference frame picker → apply correction to clips
10. Object tracking: tap object → track across frames → attach text/sticker

### Phase v2.1 — Cloud Infrastructure + $ORC (6 weeks)

1. Solana token: deploy SPL Token-2022 mint, burn authority, create LP on Raydium
2. Marketplace escrow program: write + test + deploy Anchor program
3. Vesting program: team/advisor vesting contracts
4. Embedded wallet: Keychain keypair generation, balance display, transaction signing
5. In-app $ORC purchase flow: Apple IAP → SOL → $ORC swap (Jupiter)
6. Auth system: Sign-In with Solana on CF Workers, JWT sessions, KV storage
7. User profiles: D1 schema, CRUD endpoints, avatar upload to R2
8. Project sync: background upload/download, version history, delta compression
9. AI router: job submission endpoint, SQS integration, webhook receiver
10. AWS spot fleet: Terraform for ASG, SQS queue, IAM roles, base AMI with models
11. Push notifications: APNs integration via CF Queue consumer

### Phase v2.2 — Cloud AI Features (5 weeks)

1. GPU worker service: Python service on GPU instances, pulls from SQS, processes, uploads to R2
2. Video upscale (Real-ESRGAN): input validation, chunked processing, result upload
3. Frame interpolation (RIFE): 24→60fps, 30→120fps
4. AI background generation (SDXL): text prompt → background image → composite
5. Style transfer: select style → apply to clip → preview → confirm
6. Voice cloning (XTTS-v2): voice sample upload → model fine-tune → stored per-user
7. TTS with cloned voice: text → audio using user's cloned voice model
8. AI music generation (MusicGen): genre + mood + duration → royalty-free track
9. AI B-roll (video diffusion): text prompt → 5-10s video clip
10. Job status UI: progress tracking, queue position, cancel, result notification

### Phase v2.3 — Marketplace (5 weeks)

1. D1 schema for listings, purchases, reviews
2. Creator publishing flow: package asset → encrypt → upload → set metadata
3. Marketplace browse UI: categories, trending, search, creator profiles
4. Asset preview: auto-generated preview video for templates, before/after for presets
5. Purchase flow: $ORC transaction → on-chain confirmation → decrypt + deliver asset
6. Escrow settlement: 70/30 split on-chain, instant to seller wallet
7. Reviews and ratings: post-purchase review, aggregate ratings
8. Creator dashboard: sales analytics, revenue, top assets, payout history
9. Bundle system: group multiple assets, discount pricing
10. Content moderation: Workers AI scan on publish, report system, admin review queue

### Phase v2.4 — Collaboration (5 weeks)

1. Durable Object: CollabSession class — user registry, lock state, action buffer
2. WebSocket protocol: message types (cursor_move, track_lock, action_apply, comment_add)
3. Track locking: acquire/release locks, 30s idle timeout, visual lock indicators
4. Live cursors: colored playhead per user, presence indicators in top bar
5. Action broadcast: local action → send to DO → DO broadcasts to all participants
6. Offline reconciliation: queue actions locally → replay on reconnect → CRDT merge
7. Timeline comments: pin to timecode, threads, @mentions, resolve/unresolve
8. Version history: auto-save snapshots, named versions, diff view, rollback
9. Invite flow: generate link, accept via deep link, role assignment
10. Cross-platform: ensure iOS ↔ web collab works (same protocol, same DO)

### Phase v2.5 — Pro Features + Multi-Platform Export (4 weeks)

1. Balance-gate system: check wallet balance → unlock/lock feature sets
2. Multicam editing: multi-angle sync (audio waveform correlation), angle switcher UI
3. Masking: bezier path drawing, AI edge assist, animated mask keyframes
4. Speed ramping: visual bezier curve editor for speed over time
5. Nested timelines: compound clip creation, double-tap to enter, breadcrumb navigation
6. Adjustment layers: layer type that applies effects to all layers below
7. Audio sync: waveform correlation between separate audio + video files
8. Scopes: waveform monitor, vectorscope, RGB parade — overlay on preview
9. Cloud batch export: submit multi-platform job → render all versions on GPU fleet
10. Direct publishing groundwork: OAuth flows for YouTube/TikTok/Instagram

### Phase v2.6 — Polish + Launch (3 weeks)

1. Token launch: LP creation, initial distribution, verify trading works
2. Earning mechanisms: streak tracking, referral system, challenge infrastructure
3. Onboarding: updated tutorial covering AI features, wallet, marketplace
4. Performance audit: profile all AI models, optimize memory, ensure < 400MB active
5. Security audit: wallet key storage, API auth, escrow program audit
6. App Store review preparation: screenshots, preview video, compliance review
7. TestFlight beta: invite creators, gather feedback, iterate
8. Marketing assets: landing page updates, feature videos
9. Launch: App Store submission + token distribution event

## 12. Technical Risks + Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Apple rejects token mechanics | Can't ship | Design IAP path as primary, external funding as secondary. Consult App Store guidelines pre-submission. |
| Spot GPU interruptions during generation | Failed jobs | Idempotent jobs + checkpointing + 20% on-demand floor |
| Core ML models too large for older devices | Bad UX on A13 | Tiered model sizes (small/medium/large), graceful fallback |
| Solana congestion spikes | Marketplace transactions slow | Use priority fees, batch transactions where possible, show pending state |
| Token price volatility | User confusion about costs | Display costs in both $ORC and approximate USD equivalent |
| Durable Object memory limits (128MB) | Collab session crashes | Keep DO state minimal (pointers, not full media), offload to D1/R2 |
| Content moderation on marketplace | Legal risk | Automated scan on upload + community reports + manual review queue |

## 13. Success Metrics (v2)

| Metric | Target (6 months post-v2) |
|--------|--------------------------|
| Monthly active editors | 100K+ |
| AI feature usage (% of sessions) | 40%+ |
| Marketplace listings | 5,000+ |
| Marketplace GMV (monthly $ORC volume) | 500K+ $ORC |
| Active collab projects | 10K+ |
| Token holders | 50K+ wallets |
| Cloud AI job completion rate | 99%+ |
| Average session length | 12+ minutes |
| Creator earnings (top 100 average) | 1,000+ $ORC/month |
| App Store rating | 4.6+ |

## 14. Total Timeline

| Phase | Duration | Cumulative |
|-------|----------|-----------|
| v2.0 — On-Device AI | 6 weeks | Week 6 |
| v2.1 — Cloud Infra + $ORC | 6 weeks | Week 12 |
| v2.2 — Cloud AI Features | 5 weeks | Week 17 |
| v2.3 — Marketplace | 5 weeks | Week 22 |
| v2.4 — Collaboration | 5 weeks | Week 27 |
| v2.5 — Pro Features + Export | 4 weeks | Week 31 |
| v2.6 — Polish + Launch | 3 weeks | Week 34 |

**Total: 34 weeks to full v2 ecosystem launch.**
