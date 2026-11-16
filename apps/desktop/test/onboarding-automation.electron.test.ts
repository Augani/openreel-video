/**
 * Automation safety in real Electron: every perf / e2e / CI / agent signal keeps first-run onboarding
 * off the screen (so perf numbers and the other e2e suites never see the band), nothing is persisted for
 * a real user on the same profile, and OPENREEL_FORCE_ONBOARDING brings it back for testing onboarding itself.
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_ONBOARDING_E2E=1 pnpm exec vitest run test/onboarding-automation.electron.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  bandLocator,
  killAll,
  launch,
  onboardingE2eEnabled,
  quit,
  readOnboardingStorage,
  sleep,
  waitForWelcome,
} from "./onboarding-e2e-helpers";

const d = onboardingE2eEnabled ? describe : describe.skip;

let work = "";
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-onb-auto-"));
});
afterEach(killAll);
afterAll(() => {
  killAll();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

const readAutomation = (page: import("./onboarding-e2e-helpers").Session["page"]): Promise<boolean | undefined> =>
  page.evaluate(() => (window as unknown as { openreel?: { automation?: boolean } }).openreel?.automation);

d("automation suppresses first-run onboarding", () => {
  const cases: { name: string; env?: Record<string, string>; args?: string[] }[] = [
    { name: "OPENREEL_PERF", env: { OPENREEL_PERF: "1" } },
    { name: "OPENREEL_ELECTRON_TEST", env: { OPENREEL_ELECTRON_TEST: "1" } },
    { name: "OPENREEL_E2E", env: { OPENREEL_E2E: "1" } },
    { name: "CI", env: { CI: "true" } },
    { name: "OPENREEL_SKIP_ONBOARDING", env: { OPENREEL_SKIP_ONBOARDING: "1" } },
    { name: "OPENREEL_MCP_ENDPOINT_FILE", env: { OPENREEL_MCP_ENDPOINT_FILE: "<tmp>" } },
    { name: "--no-onboarding", args: ["--no-onboarding"] },
  ];

  for (const c of cases) {
    it(`${c.name}: no band, harness card clickable, nothing persisted`, async () => {
      const profile = path.join(work, `profile-${c.name.replace(/[^a-z0-9]/gi, "")}`);
      const env = { ...(c.env ?? {}) };
      if (env.OPENREEL_MCP_ENDPOINT_FILE === "<tmp>") env.OPENREEL_MCP_ENDPOINT_FILE = path.join(work, "endpoint.json");
      const session = await launch({ userData: profile, env, args: c.args });
      const { page } = session;
      await waitForWelcome(page);
      expect(await readAutomation(page), "window.openreel.automation").toBe(true);
      // Give the (eager) band and the idle mirror read time to show up if they were going to.
      await sleep(1500);
      expect(await bandLocator(page).count()).toBe(0);
      expect(await page.getByText("Or just pick a format and start").count()).toBe(0);
      // The in-memory automation skip must not be written, or a real user on this profile would never see onboarding.
      const stored = await readOnboardingStorage(page);
      expect(stored?.skippedBy).not.toBe("automation");
      await quit(session);
      expect(fs.existsSync(path.join(profile, "onboarding.json"))).toBe(false);
    }, 180_000);
  }

  it("OPENREEL_FORCE_ONBOARDING overrides every automation signal", async () => {
    const session = await launch({
      userData: path.join(work, "profile-force"),
      env: { CI: "true", OPENREEL_PERF: "1", OPENREEL_FORCE_ONBOARDING: "1" },
      args: ["--no-onboarding"],
    });
    await waitForWelcome(session.page);
    expect(await readAutomation(session.page)).toBe(false);
    await bandLocator(session.page).waitFor({ timeout: 10_000 });
    await quit(session);
  }, 180_000);

  it("a real launch on the profile an automation run used still sees onboarding", async () => {
    const profile = path.join(work, "profile-shared");
    const first = await launch({ userData: profile, env: { OPENREEL_PERF: "1" } });
    await waitForWelcome(first.page);
    expect(await bandLocator(first.page).count()).toBe(0);
    await quit(first);

    const second = await launch({ userData: profile });
    await waitForWelcome(second.page);
    await bandLocator(second.page).waitFor({ timeout: 10_000 });
    await quit(second);
  }, 240_000);
});
