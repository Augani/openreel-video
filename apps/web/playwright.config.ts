import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { E2E_CHANNEL, GPU_ARGS, NOWEBGPU_ARGS, SOFTWARE_ARGS } from "./e2e/env";

const CI = !!process.env.CI;

const PORT = Number(process.env.OPENREEL_E2E_PORT ?? 5391);

// Duration-balanced sharding (e2e/shard-plan.mjs): the plan maps a project to the titles of the tests this
// shard runs. A project with no entry runs nothing; with no plan every test runs.
const PLAN_FILE = process.env.OPENREEL_E2E_SHARD_PLAN;
const PLAN: Record<string, string[]> | null = PLAN_FILE
  ? (JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Record<string, string[]>)
  : null;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Matches exactly the planned tests of one project (the grep title is "<project> <file> <describes> <title>"). */
const planGrep = (project: string): { grep?: RegExp[] } =>
  PLAN
    ? { grep: (PLAN[project] ?? []).length ? PLAN[project].map((t) => new RegExp(`(^|\\s)${escapeRegExp(t)}$`)) : [/^(?!)/] }
    : {};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One editor per test; a single worker keeps GPU/decoder load predictable.
  workers: 1,
  fullyParallel: false,
  // No retries, locally or in CI: a flake must be fixed, not hidden.
  retries: 0,
  forbidOnly: CI,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: E2E_CHANNEL,
    trace: CI ? "retain-on-failure" : "off",
    headless: true,
    viewport: { width: 1600, height: 900 },
  },
  projects: [
    {
      name: "gpu",
      ...planGrep("gpu"),
      // e2e/soak/* is the opt-in long-form soak (playwright.soak.config.ts), never part of the default run.
      testIgnore: [/fallback-.*\.spec\.ts$/, /[\\/]soak[\\/]/],
      use: {
        launchOptions: {
          args: GPU_ARGS,
        },
      },
    },
    {
      // Chrome with WebGPU switched off (requestAdapter() is null and the spec
      // also deletes navigator.gpu): the renderer factory lands on
      // Canvas2DFallbackRenderer while hardware WebGL2 stays available.
      name: "fallback-nowebgpu",
      ...planGrep("fallback-nowebgpu"),
      testMatch: /fallback-.*\.spec\.ts$/,
      use: {
        launchOptions: {
          args: NOWEBGPU_ARGS,
        },
      },
    },
    {
      // No GPU at all (SwiftShader/software): the pure software path.
      name: "fallback-software",
      ...planGrep("fallback-software"),
      testMatch: /fallback-.*\.spec\.ts$/,
      use: {
        launchOptions: {
          args: SOFTWARE_ARGS,
        },
      },
    },
  ],
  webServer: {
    // OPENREEL_E2E_DIST=<dir of a build made with VITE_OPENREEL_E2E=1> serves that PRODUCTION bundle
    // (tree-shaken, minified) instead of the dev server, to prove an optimisation did not drop code
    // the dev server keeps (e.g. package.json "sideEffects").
    command: process.env.OPENREEL_E2E_DIST
      ? `npx vite preview --outDir ${process.env.OPENREEL_E2E_DIST} --port ${PORT} --strictPort`
      : `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_OPENREEL_E2E: "1" },
  },
});
