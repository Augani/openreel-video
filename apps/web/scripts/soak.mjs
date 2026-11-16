#!/usr/bin/env node
/**
 * Long-form soak runner: generates the sources (once), builds a production bundle with the e2e hook
 * into a private directory and runs the soak specs against `vite preview` of it.
 *
 *   pnpm --filter @openreel/web test:soak                 # 30 min session + crash recovery
 *   pnpm --filter @openreel/web test:soak -- soak.spec.ts  # one spec
 *   SOAK_MINUTES=60 SOAK_MEDIA_DIR=/big/disk/soak ... test:soak
 *
 * Production, not `vite dev`: React's DEV build records every render into the Performance timeline
 * (structured-cloning the props, i.e. the whole 800-clip project) and a soak against the dev server dies
 * of "Data cannot be cloned, out of memory" after about five minutes. See docs/soak-report.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const passthrough = process.argv.slice(2).filter((a) => a !== "--");
const media = process.env.SOAK_MEDIA_DIR ?? join(tmpdir(), "openreel-soak-media");

if (!existsSync(join(media, "manifest.json"))) {
  console.log(`[soak] generating sources into ${media}`);
  const gen = spawnSync("node", ["e2e/soak/gen-media.mjs", media], { cwd: webDir, stdio: "inherit" });
  if (gen.status !== 0) process.exit(gen.status ?? 1);
}

let dist = process.env.OPENREEL_E2E_DIST;
let ownsDist = false;
if (!dist) {
  dist = mkdtempSync(join(tmpdir(), "openreel-soak-dist-"));
  ownsDist = true;
  console.log(`[soak] building the production bundle into ${dist}`);
  const build = spawnSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], {
    cwd: webDir,
    stdio: "inherit",
    env: { ...process.env, VITE_OPENREEL_E2E: "1" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const port = process.env.OPENREEL_E2E_PORT ?? String(6000 + Math.floor(Math.random() * 1000));
const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.soak.config.ts", ...passthrough], {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, OPENREEL_SOAK: "1", SOAK_MEDIA_DIR: media, OPENREEL_E2E_DIST: dist, OPENREEL_E2E_PORT: port },
});
if (ownsDist && !process.env.OPENREEL_E2E_KEEP_DIST) rmSync(dist, { recursive: true, force: true });
process.exit(run.status ?? 1);
