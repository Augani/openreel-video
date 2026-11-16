import { chromium, expect, test as base, type BrowserContext } from "@playwright/test";
import { E2E_CHANNEL, GPU_ARGS } from "../env";

/**
 * `test` for the soak specs. With SOAK_CRASH_DIR set, the browser runs as a persistent context whose
 * profile (and therefore Crashpad database, `<dir>/profile/Crashpad`) survives a renderer crash, with
 * crash reporting left on, so a crashed soak leaves a minidump to inspect. Otherwise it is the plain
 * Playwright `context`/`page`.
 */
export const test = base.extend<object>({
  context: async ({ context, baseURL }, use) => {
    const dir = process.env.SOAK_CRASH_DIR;
    if (!dir) return use(context);
    const persistent: BrowserContext = await chromium.launchPersistentContext(`${dir}/profile`, {
      channel: E2E_CHANNEL,
      headless: true,
      baseURL,
      viewport: { width: 1600, height: 900 },
      ignoreDefaultArgs: ["--disable-breakpad"],
      args: [...GPU_ARGS, "--enable-precise-memory-info", "--enable-crash-reporter", `--crash-dumps-dir=${dir}/dumps`],
    });
    await use(persistent);
    await persistent.close();
  },
  page: async ({ context }, use) => {
    await use(await context.newPage());
  },
});

export { expect };
