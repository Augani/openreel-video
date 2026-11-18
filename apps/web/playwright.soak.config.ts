import { defineConfig } from "@playwright/test";
import { E2E_CHANNEL, GPU_ARGS } from "./e2e/env";

/**
 * Opt-in long-form soak (see docs/soak-report.md). Not part of `pnpm test:e2e`.
 *
 *   OPENREEL_E2E_PORT=6xxx pnpm --filter @openreel/web test:soak   (builds the production bundle, generates sources)
 *
 * Knobs: SOAK_MINUTES (session length, default 30), SOAK_CLIPS (800), SOAK_TIMELINE_MINUTES (100),
 * SOAK_MEDIA_DIR (node e2e/soak/gen-media.mjs <dir> writes the sources), SOAK_OUT (JSON results).
 */
if (process.env.OPENREEL_SOAK && !process.env.OPENREEL_E2E_DIST && !process.env.SOAK_ALLOW_DEV) {
  throw new Error(
    "The soak runs against a production bundle (React's DEV build records every render, props included, in the Performance timeline and a feature-length project exhausts memory in minutes). Use `pnpm --filter @openreel/web test:soak`, or set OPENREEL_E2E_DIST to a build made with VITE_OPENREEL_E2E=1 (SOAK_ALLOW_DEV=1 to override).",
  );
}

const PORT = Number(process.env.OPENREEL_E2E_PORT ?? 5392);

export default defineConfig({
  testDir: "./e2e/soak",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // A soak run is long by design; each spec sets its own timeout from SOAK_MINUTES.
  timeout: 0,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: E2E_CHANNEL,
    headless: true,
    viewport: { width: 1600, height: 900 },
    launchOptions: { ...(process.env.SOAK_CRASH_DIR ? { ignoreDefaultArgs: ["--disable-breakpad"] } : {}), args: [...GPU_ARGS, "--enable-precise-memory-info", ...(process.env.SOAK_CRASH_DIR ? ["--enable-crash-reporter", `--crash-dumps-dir=${process.env.SOAK_CRASH_DIR}`] : []), ...(process.env.SOAK_CHROME_LOG ? ["--enable-logging=stderr", "--v=0"] : [])] },
  },
  projects: [{ name: "soak" }],
  webServer: {
    command: process.env.OPENREEL_E2E_DIST
      ? `npx vite preview --outDir ${process.env.OPENREEL_E2E_DIST} --port ${PORT} --strictPort`
      : `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_OPENREEL_E2E: "1" },
  },
});
