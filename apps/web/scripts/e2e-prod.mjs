#!/usr/bin/env node
/**
 * Production-bundle e2e smoke: builds the web app with the e2e hook enabled
 * (VITE_OPENREEL_E2E=1) into a private directory, serves that minified,
 * tree-shaken, code-split bundle with `vite preview` and runs the cold-start
 * smoke subset (e2e/prod-smoke.spec.ts) plus the specs that used to need the
 * dev server (mask-pen, multi-sequence, effects-parity) and the w9 features that lazy engines must serve on first use
 * (graphics frame scale, motion tracking worker, CEA-608 embed, multicam incl. fixed-angle audio) when --all is given.
 *
 *   pnpm --filter @openreel/web test:e2e:prod            # smoke subset
 *   pnpm --filter @openreel/web test:e2e:prod -- --all   # + the converted dev-server specs
 *   OPENREEL_E2E_DIST=<dir> pnpm ... test:e2e:prod       # reuse an existing build, skip the build
 *   OPENREEL_E2E_PORT=6123 ...                           # pick the preview port (default: random 6000-6999)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const all = args.includes("--all");
const passthrough = args.filter((a) => a !== "--all" && a !== "--");

let dist = process.env.OPENREEL_E2E_DIST;
let ownsDist = false;
if (!dist) {
  dist = mkdtempSync(join(tmpdir(), "openreel-e2e-dist-"));
  ownsDist = true;
  console.log(`[e2e:prod] building the production bundle into ${dist}`);
  const build = spawnSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], {
    cwd: webDir,
    stdio: "inherit",
    env: { ...process.env, VITE_OPENREEL_E2E: "1" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error(`[e2e:prod] ${dist} has no index.html`);
  process.exit(1);
}

const port = process.env.OPENREEL_E2E_PORT ?? String(6000 + Math.floor(Math.random() * 1000));
const specs = ["e2e/prod-smoke.spec.ts", ...(all ? ["e2e/mask-pen.spec.ts", "e2e/multi-sequence.spec.ts", "e2e/effects-parity.spec.ts", "e2e/graphics-frame-scale.spec.ts", "e2e/motion-tracking.spec.ts", "e2e/cea608-embed.spec.ts", "e2e/multicam.spec.ts"] : [])];
console.log(`[e2e:prod] serving ${dist} on :${port}; running ${specs.join(", ")}`);
const run = spawnSync("npx", ["playwright", "test", ...specs, "--project=gpu", ...passthrough], {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, OPENREEL_E2E_DIST: dist, OPENREEL_E2E_PORT: port },
});
if (ownsDist && !process.env.OPENREEL_E2E_KEEP_DIST) rmSync(dist, { recursive: true, force: true });
process.exit(run.status ?? 1);
