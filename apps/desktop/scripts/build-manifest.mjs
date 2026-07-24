#!/usr/bin/env node
// Builds manifest.json for the landing page's desktop download section from the
// release artifacts. The desktop app's own self-update feed is electron-
// updater's latest*.yml (separate); this manifest is the human-download index.
//
// Usage: node scripts/build-manifest.mjs <artifactsDir> <outFile>
//   <artifactsDir> is searched recursively for the installers; filenames follow
//   electron-builder's artifactName: OpenReel-<version>-<arch>.<ext>.

import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://dl.openreel.video";

const [, , artifactsDir, outFile] = process.argv;
if (!artifactsDir || !outFile) {
  console.error("usage: build-manifest.mjs <artifactsDir> <outFile>");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(scriptDir, "..", "package.json"), "utf8"),
);
const version = pkg.version;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(artifactsDir).filter((f) =>
  path.basename(f).startsWith(`OpenReel-${version}-`),
);

function find(predicate) {
  const hit = files.find((f) => predicate(path.basename(f)));
  if (!hit) return null;
  const name = path.basename(hit);
  return { file: name, url: `${BASE_URL}/${name}`, size: statSync(hit).size };
}

// Match by extension (+ arch token only to split the two macOS dmgs). This is
// robust to electron-builder's per-target arch naming, which is NOT uniform:
// x64 → "x64" for dmg/exe but "x86_64" for AppImage and "amd64" for deb.
const targets = {
  macArm64: (n) => n.endsWith(".dmg") && n.includes("arm64"),
  macX64: (n) => n.endsWith(".dmg") && !n.includes("arm64"),
  win64: (n) => n.endsWith(".exe"),
  linuxAppImage: (n) => n.endsWith(".AppImage"),
  linuxDeb: (n) => n.endsWith(".deb"),
};

const downloads = {};
for (const [key, predicate] of Object.entries(targets)) {
  const entry = find(predicate);
  if (entry) downloads[key] = entry;
}

if (Object.keys(downloads).length === 0) {
  console.error(
    `[manifest] no installers for version ${version} found under ${artifactsDir}`,
  );
  process.exit(1);
}

const manifest = {
  version,
  // Stamped by the caller via env so the script stays deterministic.
  releasedAt: process.env.RELEASE_DATE || null,
  baseUrl: BASE_URL,
  downloads,
};

writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `[manifest] ${outFile}: v${version}, platforms: ${Object.keys(downloads).join(", ")}`,
);
