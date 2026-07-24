#!/usr/bin/env node
// Downloads the static ffmpeg binaries the desktop sidecar needs, verifies them
// against pinned SHA256 digests, REJECTS any non-redistributable (--enable-
// nonfree) build, and writes them to resources/bin/<slot>/ where ffmpeg-path.ts
// and electron-builder's extraResources expect them.
//
// All shipped builds are GPL and invoked as a separate process (see
// LICENSES/FFMPEG.md). Sources differ per slot because there is no single
// immutable, GPL-clean, statically-linked source covering every platform:
//   - darwin-arm64: OSXExperts (osxexperts.net) — ffmpeg-static's arm64 is
//     built --enable-nonfree and is NOT redistributable, so it is not used.
//   - darwin-x64 / linux-x64 / win32-x64: eugeneware/ffmpeg-static b6.1.1
//     (verified GPL, no --enable-nonfree).
// Binaries are gitignored; this script + MANIFEST.json pin exactly what is used.
//
// Usage:
//   node scripts/fetch-ffmpeg.mjs           # host platform's build slots
//   node scripts/fetch-ffmpeg.mjs --all     # every slot (all platforms)
//   node scripts/fetch-ffmpeg.mjs linux-x64 # one or more explicit slots
// The macOS build produces both arm64 and x64 artifacts from one runner, so the
// darwin host fetches both mac slots.

import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  chmod,
  access,
  rm,
} from "node:fs/promises";
import { constants as FS_CONSTANTS } from "node:fs";
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FFMPEG_STATIC = "b6.1.1";
const FS_BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC}`;

// artifactSha256 = sha of the downloaded file (raw binary or zip).
// binSha256 = sha of the final on-disk ffmpeg binary (== artifactSha256 for raw).
const SLOTS = {
  "darwin-arm64": {
    url: "https://www.osxexperts.net/ffmpeg71arm.zip",
    format: "zip",
    member: "ffmpeg",
    artifactSha256:
      "0878f3313311c2c1b2c818e7c955c0bd828c97b357fa86211b42a5c36d01e36f",
    binSha256:
      "6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617",
    bin: "ffmpeg",
    ffmpegVersion: "7.1",
    source: "OSXExperts (osxexperts.net), GPL static",
  },
  "darwin-x64": {
    url: `${FS_BASE}/ffmpeg-darwin-x64`,
    format: "raw",
    artifactSha256:
      "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
    binSha256:
      "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
    bin: "ffmpeg",
    ffmpegVersion: "6.1.1",
    source: "ffmpeg-static b6.1.1 (Evermeet), GPL static",
  },
  "linux-x64": {
    url: `${FS_BASE}/ffmpeg-linux-x64`,
    format: "raw",
    artifactSha256:
      "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
    binSha256:
      "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
    bin: "ffmpeg",
    ffmpegVersion: "6.1.1",
    source: "ffmpeg-static b6.1.1, GPL static",
  },
  "win32-x64": {
    url: `${FS_BASE}/ffmpeg-win32-x64`,
    format: "raw",
    artifactSha256:
      "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
    binSha256:
      "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00",
    bin: "ffmpeg.exe",
    ffmpegVersion: "6.1.1",
    source: "ffmpeg-static b6.1.1, GPL static",
  },
};

const HOST_SLOTS = {
  darwin: ["darwin-arm64", "darwin-x64"],
  win32: ["win32-x64"],
  linux: ["linux-x64"],
};

// ffmpeg sets its license state to "nonfree, unredistributable" only when built
// with --enable-nonfree; that exact flag is embedded in the binary's
// configuration string. Refuse to ship any such build.
const NONFREE = Buffer.from("--enable-nonfree");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BIN_ROOT = path.join(SCRIPT_DIR, "..", "resources", "bin");

function selectedSlots() {
  const args = process.argv.slice(2);
  const unknownFlags = args.filter((a) => a.startsWith("--") && a !== "--all");
  if (unknownFlags.length) {
    throw new Error(`Unknown flag(s): ${unknownFlags.join(", ")}. Valid: --all`);
  }
  const unknownSlots = args.filter((a) => !a.startsWith("--") && !SLOTS[a]);
  if (unknownSlots.length) {
    throw new Error(
      `Unknown slot(s): ${unknownSlots.join(", ")}. Valid: ${Object.keys(SLOTS).join(", ")}`,
    );
  }
  if (args.includes("--all")) return Object.keys(SLOTS);
  const explicit = args.filter((a) => SLOTS[a]);
  if (explicit.length) return explicit;
  return HOST_SLOTS[process.platform] ?? [];
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function fileExists(file) {
  try {
    await access(file, FS_CONSTANTS.F_OK);
    return true;
  } catch {
    return false;
  }
}

function extractFromZip(zipBuffer, member, slot) {
  // Node has no built-in zip reader; shell out to `unzip -p` (present on the
  // macOS runner, the only host that fetches a zip slot). Errors surface clearly
  // if it is missing.
  const tmpZip = path.join(os.tmpdir(), `openreel-ffmpeg-${slot}-${process.pid}.zip`);
  try {
    writeFileSync(tmpZip, zipBuffer);
    return execFileSync("unzip", ["-p", tmpZip, member], {
      maxBuffer: 512 * 1024 * 1024,
    });
  } finally {
    rmSync(tmpZip, { force: true });
  }
}

async function fetchSlot(slot) {
  const cfg = SLOTS[slot];
  const outDir = path.join(BIN_ROOT, slot);
  const outFile = path.join(outDir, cfg.bin);

  if (
    (await fileExists(outFile)) &&
    sha256(await readFile(outFile)) === cfg.binSha256
  ) {
    console.log(`[ffmpeg] ${slot}: already present and verified`);
    return slot;
  }

  console.log(`[ffmpeg] ${slot}: downloading ${cfg.url}`);
  const res = await fetch(cfg.url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed for ${slot}: HTTP ${res.status} ${res.statusText}`);
  }
  const artifact = Buffer.from(await res.arrayBuffer());
  const artifactDigest = sha256(artifact);
  if (artifactDigest !== cfg.artifactSha256) {
    throw new Error(
      `Artifact SHA256 mismatch for ${slot}: expected ${cfg.artifactSha256}, got ${artifactDigest}`,
    );
  }

  const binary =
    cfg.format === "zip"
      ? extractFromZip(artifact, cfg.member, slot)
      : artifact;

  if (binary.includes(NONFREE)) {
    throw new Error(
      `${slot}: binary is built --enable-nonfree and is NOT redistributable; refusing to ship it.`,
    );
  }

  const binDigest = sha256(binary);
  if (binDigest !== cfg.binSha256) {
    throw new Error(
      `Binary SHA256 mismatch for ${slot}: expected ${cfg.binSha256}, got ${binDigest}`,
    );
  }

  await mkdir(outDir, { recursive: true });
  await rm(outFile, { force: true });
  await writeFile(outFile, binary);
  await chmod(outFile, 0o755);
  console.log(
    `[ffmpeg] ${slot}: ok (${(binary.length / 1e6).toFixed(1)} MB, ffmpeg ${cfg.ffmpegVersion}, GPL, sha256 verified)`,
  );
  return slot;
}

async function writeManifest(slots) {
  const manifestPath = path.join(BIN_ROOT, "MANIFEST.json");
  let existing = {};
  if (await fileExists(manifestPath)) {
    try {
      existing = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      existing = {};
    }
  }
  const binaries = { ...(existing.binaries ?? {}) };
  for (const slot of slots) {
    const cfg = SLOTS[slot];
    binaries[slot] = {
      file: `${slot}/${cfg.bin}`,
      ffmpegVersion: cfg.ffmpegVersion,
      source: cfg.source,
      sha256: cfg.binSha256,
    };
  }
  const manifest = {
    license:
      "All binaries are GPL FFmpeg builds invoked as a separate process. See LICENSES/FFMPEG.md. None are built --enable-nonfree (enforced at fetch time).",
    binaries,
    note: "Binaries are gitignored. Run `pnpm --filter @openreel/desktop fetch:ffmpeg` (host slots) or `node scripts/fetch-ffmpeg.mjs --all`. Sources/versions differ per slot (see each entry); digests are verified on every fetch.",
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const slots = selectedSlots();
  if (slots.length === 0) {
    throw new Error(`No ffmpeg build slots defined for platform "${process.platform}".`);
  }
  for (const slot of slots) {
    await fetchSlot(slot);
  }
  await writeManifest(slots);
  console.log(`[ffmpeg] done: ${slots.join(", ")}`);
}

main().catch((error) => {
  console.error(`[ffmpeg] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
