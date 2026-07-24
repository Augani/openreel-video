# OpenReel Desktop — Phase 0 / Plan 1: Workspace Scaffolding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Cargo workspace at `apps/desktop/` with all nine crates scaffolded (compiling, passing one hello-world test each), a pinned Rust toolchain, the workspace-level lints, and a GitHub Actions workflow that builds + tests + lints on macOS, Linux, and Windows. This unblocks every subsequent Phase 0 plan.

**Architecture:** New `apps/desktop/Cargo.toml` declares a workspace containing nine library/binary crates. Each crate ships with a `Cargo.toml`, a minimal `src/lib.rs` (or `main.rs` for the app), and one passing unit test. No third-party engine dependencies yet — those land in their respective implementation plans (Plan 2 = `openreel-project`, Plan 3 = `openreel-timeline`, and so on). CI runs `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` across the workspace on three OS runners.

**Tech Stack:** Rust 1.95 stable, edition 2024, Cargo workspaces, GitHub Actions.

**Branch:** `feat/desktop-workspace-scaffolding` off `main`.

---

### Task 1: Create the working branch

**Files:**
- N/A (branch creation only)

- [ ] **Step 1: Verify current state**

Run:
```bash
cd /Users/augustusotu/Projects/openreel
git status
git fetch origin main
```
Expected: working tree clean (or only unrelated unstaged work). `origin/main` ref refreshed.

- [ ] **Step 2: Create the branch**

Run:
```bash
git checkout -b feat/desktop-workspace-scaffolding origin/main
git branch --show-current
```
Expected: `feat/desktop-workspace-scaffolding`. No commits yet beyond `origin/main`.

---

### Task 2: Pin the Rust toolchain

**Files:**
- Create: `apps/desktop/rust-toolchain.toml`

- [ ] **Step 1: Create the directory and toolchain file**

Run:
```bash
mkdir -p apps/desktop
```

Then create `apps/desktop/rust-toolchain.toml` with this exact content:

```toml
[toolchain]
channel = "1.95"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

- [ ] **Step 2: Verify rustup picks up the pin**

Run:
```bash
cd apps/desktop
rustc --version
cd ../..
```
Expected: prints `rustc 1.95.x (...)`. If rustup says it's downloading 1.95, let it finish before continuing.

- [ ] **Step 3: Commit**

Run:
```bash
git add apps/desktop/rust-toolchain.toml
git commit -m "chore(desktop): pin Rust toolchain to 1.95"
```

---

### Task 3: Create the workspace `Cargo.toml`

**Files:**
- Create: `apps/desktop/Cargo.toml`

- [ ] **Step 1: Write the workspace manifest**

Create `apps/desktop/Cargo.toml` with this exact content:

```toml
[workspace]
resolver = "3"
members = [
    "crates/openreel-project",
    "crates/openreel-timeline",
    "crates/openreel-media",
    "crates/openreel-cache",
    "crates/openreel-render",
    "crates/openreel-audio",
    "crates/openreel-export",
    "crates/openreel-ai-client",
    "crates/openreel-app",
]

[workspace.package]
version = "0.0.1"
edition = "2024"
rust-version = "1.95"
authors = ["OpenReel Desktop Authors"]
license = "MIT"
repository = "https://github.com/Augani/openreel-video"
homepage = "https://openreel.com"

[workspace.lints.rust]
unsafe_op_in_unsafe_fn = "warn"
unused_must_use = "deny"
unreachable_pub = "warn"
missing_debug_implementations = "warn"

[workspace.lints.clippy]
all = { level = "deny", priority = -1 }
pedantic = { level = "warn", priority = -1 }
nursery = { level = "warn", priority = -1 }
module_name_repetitions = "allow"
missing_errors_doc = "allow"
missing_panics_doc = "allow"
doc_markdown = "allow"
missing_const_for_fn = "allow"

[profile.dev]
opt-level = 1

[profile.release]
opt-level = 3
lto = "thin"
codegen-units = 1
```

- [ ] **Step 2: Verify the workspace parses (even though no members exist yet)**

Run:
```bash
cd apps/desktop
cargo metadata --no-deps --format-version 1 > /dev/null 2>&1; echo "exit=$?"
cd ../..
```
Expected: `exit=101` (cargo errors because members don't exist) — that's fine; we'll add them next. We're verifying the TOML itself parses.

To confirm TOML parses, run instead:
```bash
cd apps/desktop
python3 -c "import tomllib; tomllib.loads(open('Cargo.toml').read()); print('toml ok')"
cd ../..
```
Expected: `toml ok`. (If `tomllib` isn't available, use `cargo metadata` and confirm the error mentions the missing crate dirs, not a TOML parse error.)

- [ ] **Step 3: Commit**

Run:
```bash
git add apps/desktop/Cargo.toml
git commit -m "chore(desktop): add workspace Cargo.toml with 9 member crates"
```

---

### Task 4: Add `.gitignore` for the workspace

**Files:**
- Create: `apps/desktop/.gitignore`

- [ ] **Step 1: Write the gitignore**

Create `apps/desktop/.gitignore` with this exact content:

```gitignore
/target
**/*.rs.bk
Cargo.lock.bk
.idea/
.vscode/
*.iml
.DS_Store
```

- [ ] **Step 2: Commit**

Run:
```bash
git add apps/desktop/.gitignore
git commit -m "chore(desktop): add Cargo workspace gitignore"
```

---

### Task 5: Scaffold `openreel-project` crate

**Files:**
- Create: `apps/desktop/crates/openreel-project/Cargo.toml`
- Create: `apps/desktop/crates/openreel-project/src/lib.rs`

- [ ] **Step 1: Create the crate directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-project/src
```

- [ ] **Step 2: Write the crate `Cargo.toml`**

Create `apps/desktop/crates/openreel-project/Cargo.toml`:

```toml
[package]
name = "openreel-project"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "OpenReel project model: schema types, .openreel JSON I/O, migrations."

[lints]
workspace = true
```

- [ ] **Step 3: Write the failing test in `src/lib.rs`**

Create `apps/desktop/crates/openreel-project/src/lib.rs` with this exact content:

```rust
//! OpenReel project model: schema types, `.openreel` JSON I/O, migrations.
//!
//! This crate is the source of truth for the desktop's view of a project.
//! See `docs/superpowers/specs/2026-05-28-kael-openreel-desktop-design.md`.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (workspace-level cargo verification deferred to Task 14)**

Note: cargo workspaces require all declared members to exist on disk before `cargo test`/`fmt`/`clippy` can load anything. Because Tasks 5–13 scaffold the nine member crates one at a time, per-task `cargo` verification cannot run; it would always fail on missing later-task members. Verify by inspection here (file content matches the spec exactly), then defer cargo verification to Task 14 once all nine crates exist.

Run:
```bash
ls apps/desktop/crates/openreel-project/Cargo.toml apps/desktop/crates/openreel-project/src/lib.rs
git add apps/desktop/crates/openreel-project
git diff --cached --stat
git commit -m "feat(openreel-project): scaffold crate"
```
Expected: both files exist; `git diff --cached --stat` shows two new files added.

---

### Task 6: Scaffold `openreel-timeline` crate

**Files:**
- Create: `apps/desktop/crates/openreel-timeline/Cargo.toml`
- Create: `apps/desktop/crates/openreel-timeline/src/lib.rs`

- [ ] **Step 1: Create the crate directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-timeline/src
```

- [ ] **Step 2: Write the crate `Cargo.toml`**

Create `apps/desktop/crates/openreel-timeline/Cargo.toml`:

```toml
[package]
name = "openreel-timeline"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Pure timeline math: source mapping, reverse/boomerang, split-on-speed, snapping, parity invariants."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-timeline/src/lib.rs`:

```rust
//! Pure timeline math: source mapping, reverse/boomerang, split-on-speed,
//! snapping, parity invariants.
//!
//! No I/O, no rendering. This crate is intentionally a pure-functions
//! library so it stays trivially testable against the iOS parity fixtures.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-timeline
git commit -m "feat(openreel-timeline): scaffold crate"
```

---

### Task 7: Scaffold `openreel-media` crate

**Files:**
- Create: `apps/desktop/crates/openreel-media/Cargo.toml`
- Create: `apps/desktop/crates/openreel-media/src/lib.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-media/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-media/Cargo.toml`:

```toml
[package]
name = "openreel-media"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Media probing, thumbnail extraction, waveform peaks, proxy generation, relink — backed by FFmpeg (added in Plan 4)."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-media/src/lib.rs`:

```rust
//! Media probing, thumbnail extraction, waveform peaks, proxy generation,
//! relink — backed by FFmpeg.
//!
//! Stub state during Plan 1; real FFmpeg integration lands in Plan 4.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-media
git commit -m "feat(openreel-media): scaffold crate"
```

---

### Task 8: Scaffold `openreel-cache` crate

**Files:**
- Create: `apps/desktop/crates/openreel-cache/Cargo.toml`
- Create: `apps/desktop/crates/openreel-cache/src/lib.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-cache/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-cache/Cargo.toml`:

```toml
[package]
name = "openreel-cache"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Disk cache for thumbnails, waveforms, decoded frames, render previews, AI results."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-cache/src/lib.rs`:

```rust
//! Disk cache for thumbnails, waveforms, decoded frames, render previews,
//! AI results. Per-project keys with media-fingerprint invalidation.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-cache
git commit -m "feat(openreel-cache): scaffold crate"
```

---

### Task 9: Scaffold `openreel-render` crate

**Files:**
- Create: `apps/desktop/crates/openreel-render/Cargo.toml`
- Create: `apps/desktop/crates/openreel-render/src/lib.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-render/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-render/Cargo.toml`:

```toml
[package]
name = "openreel-render"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "wgpu render graph for video composition, effects, blend modes, LUT, text and graphics — single source of truth for preview, export, and thumbnails."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-render/src/lib.rs`:

```rust
//! wgpu render graph for video composition, effects, blend modes, LUT,
//! text and graphics.
//!
//! Single source of truth for preview, export, and thumbnails — no
//! parallel pipeline is permitted. wgpu integration lands in a later plan.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-render
git commit -m "feat(openreel-render): scaffold crate"
```

---

### Task 10: Scaffold `openreel-audio` crate

**Files:**
- Create: `apps/desktop/crates/openreel-audio/Cargo.toml`
- Create: `apps/desktop/crates/openreel-audio/src/lib.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-audio/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-audio/Cargo.toml`:

```toml
[package]
name = "openreel-audio"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Audio decoding, mixer graph, EQ/comp/reverb/delay/automation/ducking/fades/loudness, waveform, beat detection."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-audio/src/lib.rs`:

```rust
//! Audio decoding, mixer graph, EQ/comp/reverb/delay/automation/ducking/
//! fades/loudness, waveform, beat detection.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-audio
git commit -m "feat(openreel-audio): scaffold crate"
```

---

### Task 11: Scaffold `openreel-export` crate

**Files:**
- Create: `apps/desktop/crates/openreel-export/Cargo.toml`
- Create: `apps/desktop/crates/openreel-export/src/lib.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-export/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-export/Cargo.toml`:

```toml
[package]
name = "openreel-export"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Durable export queue, hardware-encoder selection, batch presets, FFmpeg muxing."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-export/src/lib.rs`:

```rust
//! Durable export queue, hardware-encoder selection, batch presets,
//! FFmpeg muxing.

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-export
git commit -m "feat(openreel-export): scaffold crate"
```

---

### Task 12: Scaffold `openreel-ai-client` crate

**Files:**
- Create: `apps/desktop/crates/openreel-ai-client/Cargo.toml`
- Create: `apps/desktop/crates/openreel-ai-client/src/lib.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-ai-client/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-ai-client/Cargo.toml`:

```toml
[package]
name = "openreel-ai-client"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Desktop auth flow + GPU job submission/polling against the existing OpenReel cloud."

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/lib.rs`**

Create `apps/desktop/crates/openreel-ai-client/src/lib.rs`:

```rust
//! Desktop auth flow + GPU job submission/polling against the existing
//! OpenReel cloud (transcription, auto-caption, multilang, background
//! removal, object tracking, beat detection, photo enhance).

#![cfg_attr(not(test), warn(missing_docs))]

/// Returns the crate version, useful for diagnostics during scaffolding.
#[must_use]
pub const fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_workspace_pinned() {
        assert_eq!(version(), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Note: per-crate `cargo` commands can't run yet — the workspace `Cargo.toml` declares all 9 members and cargo refuses to load while later-task crates are missing. Verify by file inspection here; Task 14 runs the full workspace test/fmt/clippy.

Run:
```bash
git add apps/desktop/crates/openreel-ai-client
git commit -m "feat(openreel-ai-client): scaffold crate"
```

---

### Task 13: Scaffold `openreel-app` binary crate

**Files:**
- Create: `apps/desktop/crates/openreel-app/Cargo.toml`
- Create: `apps/desktop/crates/openreel-app/src/main.rs`

- [ ] **Step 1: Create directory**

Run:
```bash
mkdir -p apps/desktop/crates/openreel-app/src
```

- [ ] **Step 2: Write `Cargo.toml`**

Create `apps/desktop/crates/openreel-app/Cargo.toml`:

```toml
[package]
name = "openreel-app"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "OpenReel Desktop application binary — kael UI host that ties together all engine crates."

[[bin]]
name = "openreel-desktop"
path = "src/main.rs"

[lints]
workspace = true
```

- [ ] **Step 3: Write `src/main.rs`**

Create `apps/desktop/crates/openreel-app/src/main.rs`:

```rust
//! OpenReel Desktop application entry point.
//!
//! In Plan 1 this is a smoke binary that prints the desktop version and
//! exits. The kael window + view tree land in a later plan.

fn main() {
    println!(
        "openreel-desktop {} (Plan 1 scaffold — no window yet)",
        env!("CARGO_PKG_VERSION")
    );
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_env_is_pinned() {
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.1");
    }
}
```

- [ ] **Step 4: Commit (cargo verification deferred to Task 14)**

Same workspace-load constraint as Tasks 5–12: cargo can't load this binary crate in isolation until all other declared members exist. Inspect file contents against the spec, commit, and let Task 14 run the actual `cargo build`/`cargo run`/`cargo test`.

Run:
```bash
ls apps/desktop/crates/openreel-app/Cargo.toml apps/desktop/crates/openreel-app/src/main.rs
git add apps/desktop/crates/openreel-app
git diff --cached --stat
git commit -m "feat(openreel-app): scaffold binary crate"
```
Expected: both files exist; `git diff --cached --stat` shows two new files added.

---

### Task 14: Verify the whole workspace builds and tests pass

**Files:**
- N/A (verification)

- [ ] **Step 1: Run the full workspace test suite**

Run:
```bash
cd apps/desktop
cargo build --workspace 2>&1 | tail -5
cargo test --workspace 2>&1 | tail -15
cd ../..
```
Expected: workspace builds successfully; nine `test version_*` results appear, all `ok`. Final line includes `test result: ok. 9 passed; 0 failed`.

- [ ] **Step 2: Run workspace-wide fmt and clippy**

Run:
```bash
cd apps/desktop
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cd ../..
```
Expected: both exit 0 with no warnings.

- [ ] **Step 3: Confirm `Cargo.lock` exists and commit it**

Run:
```bash
ls apps/desktop/Cargo.lock
git status apps/desktop/Cargo.lock
git add apps/desktop/Cargo.lock
git commit -m "chore(desktop): commit Cargo.lock for the new workspace"
```
Expected: `apps/desktop/Cargo.lock` is committed.

---

### Task 15: Add the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/desktop-readiness.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/desktop-readiness.yml` with this exact content:

```yaml
name: Desktop Readiness

on:
  pull_request:
    paths:
      - 'apps/desktop/**'
      - '.github/workflows/desktop-readiness.yml'
  push:
    branches:
      - main
    paths:
      - 'apps/desktop/**'
      - '.github/workflows/desktop-readiness.yml'
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  CARGO_TERM_COLOR: always
  RUST_BACKTRACE: 1

jobs:
  rustfmt:
    name: Rustfmt
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: apps/desktop
    steps:
      - uses: actions/checkout@v5
      - name: Install toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.95"
          components: rustfmt
      - name: Check formatting
        run: cargo fmt --all --check

  clippy:
    name: Clippy
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: apps/desktop
    steps:
      - uses: actions/checkout@v5
      - name: Install toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.95"
          components: clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/desktop -> target
      - name: Clippy
        run: cargo clippy --workspace --all-targets -- -D warnings

  verify:
    name: Verify (${{ matrix.label }})
    runs-on: ${{ matrix.os }}
    timeout-minutes: 30
    defaults:
      run:
        working-directory: apps/desktop
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            label: macOS
          - os: ubuntu-latest
            label: Linux
          - os: windows-latest
            label: Windows
    steps:
      - uses: actions/checkout@v5
      - name: Install toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.95"
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/desktop -> target
      - name: Build workspace
        run: cargo build --workspace
      - name: Test workspace
        run: cargo test --workspace
      - name: Build binary
        run: cargo build -p openreel-app --bin openreel-desktop
```

- [ ] **Step 2: Confirm YAML parses**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/desktop-readiness.yml')); print('yaml ok')"
```
Expected: `yaml ok`. (If `yaml` isn't installed, install it with `pip3 install pyyaml` or trust GitHub's parser — we'll see CI fail loudly if it's broken.)

- [ ] **Step 3: Commit**

Run:
```bash
git add .github/workflows/desktop-readiness.yml
git commit -m "ci(desktop): add Rust workspace readiness workflow"
```

---

### Task 16: Push the branch and open the PR

**Files:**
- N/A (GitHub operations)

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feat/desktop-workspace-scaffolding
```
Expected: `* [new branch]      feat/desktop-workspace-scaffolding -> feat/desktop-workspace-scaffolding`.

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --base main --head feat/desktop-workspace-scaffolding --title "feat(desktop): scaffold Cargo workspace at apps/desktop (Phase 0 / Plan 1)" --body "$(cat <<'EOF'
## Summary

Plan 1 of Phase 0 of the OpenReel Desktop spec (`docs/superpowers/specs/2026-05-28-kael-openreel-desktop-design.md`). Stands up the empty Cargo workspace at `apps/desktop/` with all nine crates scaffolded (each compiling, each with one passing test) and a Rust CI workflow that runs fmt + clippy + workspace tests + binary build across macOS, Linux, and Windows. No engine logic yet — that lands in Plans 2 through N as each crate gets real implementations.

## Test plan

- [x] `cargo build --workspace` clean
- [x] `cargo test --workspace` — 9 tests pass (one per crate)
- [x] `cargo fmt --all --check` clean
- [x] `cargo clippy --workspace --all-targets -- -D warnings` clean
- [x] `cargo run -p openreel-app --bin openreel-desktop` prints the version string
- [ ] CI: Desktop Readiness workflow green on macOS / Linux / Windows
EOF
)"
```
Expected: PR URL is printed.

- [ ] **Step 3: Watch CI to completion**

Run:
```bash
gh pr checks --watch
```
Expected: all six checks (`Rustfmt`, `Clippy`, `Verify (macOS)`, `Verify (Linux)`, `Verify (Windows)`, and any other existing required checks that run on this PR) report `pass`.

- [ ] **Step 4: Merge once green**

Run:
```bash
gh pr merge --squash --delete-branch
```
Expected: PR merges; branch deleted; local main updates with `git pull` on next sync.

- [ ] **Step 5: Sync local main**

Run:
```bash
git checkout main
git pull
git log --oneline -3
```
Expected: latest commit is `feat(desktop): scaffold Cargo workspace at apps/desktop (Phase 0 / Plan 1) (#N)`.

---

## What's next

After this plan merges, the next plans in sequence (each delivered as its own design + plan pair, not pre-spec'd here):

- **Plan 2:** `openreel-project` — real serde types for the `.openreel` schema; load + round-trip an iOS-authored fixture; migrations stub.
- **Plan 3:** `openreel-timeline` — port iOS `TimelineSourceMapper` (`sourceTime = inPoint + localTime * speed`, reverse, boomerang, splits) with the 10 parity invariants as unit tests against iOS-authored fixtures.
- **Plan 4:** `openreel-media` — wire `ffmpeg-next`, probe a real MP4, extract one decoded frame.
- **Plan 5:** `openreel-cache` — disk-backed cache with media-fingerprint invalidation.
- **Plan 6:** `openreel-render` — minimal wgpu graph (decode → upload → color-convert → LUT → composite → readback), driven by `openreel-project` + `openreel-timeline` + `openreel-media` outputs.
- **Plan 7:** `openreel-app` integration — open a kael window and display the rendered frame from Plan 6.
- **Plan 8:** Golden-frame parity harness — fixtures + iOS reference outputs + the `cargo test -p openreel-render --test parity` suite that closes Phase 0.
