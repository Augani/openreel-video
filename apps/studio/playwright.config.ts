import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
