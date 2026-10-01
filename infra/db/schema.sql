-- =====================================================================
-- OpenReel Marketplace — canonical Postgres schema (STUDIO_PLAN Appendix F)
--
-- Money is always bigint cents, never float (§33.1). IDs are uuid; expose
-- opaque handles/slugs externally, never internal ids (§33.2). Apply with:
--   psql "$DATABASE_URL" -f infra/db/schema.sql
-- A Cloudflare D1 (SQLite) variant lives in infra/db/schema.d1.sql.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- =====================================================================
-- Identity and creators
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext UNIQUE NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creators (
    user_id         uuid PRIMARY KEY REFERENCES users(id),
    handle          citext UNIQUE NOT NULL,
    bio             text,
    avatar_uri      text,
    kyc_level       smallint NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    banned_at       timestamptz
);

CREATE TABLE IF NOT EXISTS payout_methods (
    creator_id      uuid PRIMARY KEY REFERENCES creators(user_id),
    rail            text NOT NULL CHECK (rail IN ('stripe','paystack','flutterwave','wise')),
    external_id     text NOT NULL,
    currency        text NOT NULL,
    verified_at     timestamptz
);

-- =====================================================================
-- Assets and versioning
-- =====================================================================

CREATE TABLE IF NOT EXISTS assets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      uuid NOT NULL REFERENCES creators(user_id),
    slug            citext NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('template','filter','effect')),
    category        text,
    current_version smallint,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (creator_id, slug)
);
CREATE INDEX IF NOT EXISTS assets_kind_category ON assets (kind, category);

CREATE TABLE IF NOT EXISTS asset_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        uuid NOT NULL REFERENCES assets(id),
    version         smallint NOT NULL,
    abi             text NOT NULL,
    manifest        jsonb NOT NULL,
    fxpkg_uri       text NOT NULL,
    review_state    text NOT NULL DEFAULT 'submitted',
    attestation     jsonb,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    approved_at     timestamptz,
    UNIQUE (asset_id, version)
);
CREATE INDEX IF NOT EXISTS asset_versions_review ON asset_versions (review_state, submitted_at);

CREATE TABLE IF NOT EXISTS drafts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      uuid NOT NULL REFERENCES creators(user_id),
    asset_id        uuid,
    kind            text NOT NULL CHECK (kind IN ('template','filter','effect')),
    title           text,
    graph           jsonb NOT NULL,
    manifest_draft  jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_creator ON drafts (creator_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS draft_snapshots (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id        uuid NOT NULL REFERENCES drafts(id),
    graph           jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS draft_snapshots_draft ON draft_snapshots (draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS submissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id        uuid NOT NULL REFERENCES drafts(id),
    asset_version_id uuid REFERENCES asset_versions(id),
    creator_id      uuid NOT NULL REFERENCES creators(user_id),
    state           text NOT NULL,
    fxpkg_uri       text NOT NULL,
    validator_log   jsonb,
    reviewer_notes  text,
    reviewer_id     uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_state ON submissions (state, created_at);

-- =====================================================================
-- Usage and projects
-- =====================================================================

CREATE TABLE IF NOT EXISTS projects (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    timeline        jsonb NOT NULL,
    timeline_version int NOT NULL DEFAULT 1,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS installs (
    user_id          uuid NOT NULL REFERENCES users(id),
    asset_id         uuid NOT NULL REFERENCES assets(id),
    installed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, asset_id)
);

-- =====================================================================
-- Mobile media uploads
-- =====================================================================

CREATE TABLE IF NOT EXISTS media_uploads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    kind            text NOT NULL CHECK (kind IN ('proxy', 'original')),
    parent_id       uuid REFERENCES media_uploads(id),
    storage_uri     text NOT NULL,
    size_bytes      bigint NOT NULL,
    duration_ms     int,
    width           int,
    height          int,
    codec           text,
    bitrate_kbps    int,
    sha256          text NOT NULL,
    device_fingerprint text,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    last_accessed_at timestamptz NOT NULL DEFAULT now(),
    evict_after     timestamptz
);
CREATE INDEX IF NOT EXISTS media_uploads_user ON media_uploads (user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS media_uploads_evict ON media_uploads (evict_after) WHERE evict_after IS NOT NULL;

-- =====================================================================
-- Rendering
-- =====================================================================

CREATE TABLE IF NOT EXISTS render_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    project_id      uuid REFERENCES projects(id),
    kind            text NOT NULL CHECK (kind IN ('preview_frame', 'preview_strip', 'export')),
    timeline_version int NOT NULL,
    params          jsonb NOT NULL,
    status          text NOT NULL DEFAULT 'queued',
    output_uri      text,
    error           text,
    started_at      timestamptz,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS render_jobs_status ON render_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS render_jobs_user ON render_jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strip_cache (
    cache_key       text PRIMARY KEY,
    strip_uri       text NOT NULL,
    tier            text NOT NULL DEFAULT 'hot',
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS strip_cache_expiry ON strip_cache (expires_at);

CREATE TABLE IF NOT EXISTS exports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    render_job_id   uuid REFERENCES render_jobs(id),
    project_id      uuid NOT NULL REFERENCES projects(id),
    user_id         uuid NOT NULL REFERENCES users(id),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text NOT NULL DEFAULT 'queued',
    output_uri      text,
    content_hash    text,
    duration_ms     int
);
CREATE INDEX IF NOT EXISTS exports_user ON exports (user_id, started_at);

CREATE TABLE IF NOT EXISTS attributions (
    export_id           uuid NOT NULL REFERENCES exports(id),
    asset_version_id    uuid NOT NULL REFERENCES asset_versions(id),
    share               numeric(5,4) NOT NULL CHECK (share >= 0 AND share <= 1),
    is_primary          boolean NOT NULL DEFAULT false,
    PRIMARY KEY (export_id, asset_version_id)
);

-- =====================================================================
-- Money (cents, never float — §33.1)
-- =====================================================================

CREATE TABLE IF NOT EXISTS creator_balances (
    creator_id      uuid PRIMARY KEY REFERENCES creators(user_id),
    pending_cents   bigint NOT NULL DEFAULT 0,
    payable_cents   bigint NOT NULL DEFAULT 0,
    paid_cents      bigint NOT NULL DEFAULT 0,
    currency        text NOT NULL DEFAULT 'USD',
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS earnings_ledger (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      uuid NOT NULL REFERENCES creators(user_id),
    export_id       uuid NOT NULL REFERENCES exports(id),
    asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
    gross_cents     bigint NOT NULL,
    creator_cents   bigint NOT NULL,
    state           text NOT NULL DEFAULT 'pending',  -- pending | payable | paid | reversed
    earned_at       timestamptz NOT NULL DEFAULT now(),
    payable_at      timestamptz,
    paid_at         timestamptz,
    payout_id       uuid
);
CREATE INDEX IF NOT EXISTS earnings_ledger_creator ON earnings_ledger (creator_id, state, earned_at);

CREATE TABLE IF NOT EXISTS payouts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      uuid NOT NULL REFERENCES creators(user_id),
    amount_cents    bigint NOT NULL,
    currency        text NOT NULL,
    rail            text NOT NULL,
    external_ref    text,
    status          text NOT NULL DEFAULT 'pending',
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    paid_at         timestamptz
);

CREATE TABLE IF NOT EXISTS events_archive (
    day             date NOT NULL,
    creator_id      uuid,
    asset_id        uuid,
    event_type      text NOT NULL,
    count           bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (day, creator_id, asset_id, event_type)
);
