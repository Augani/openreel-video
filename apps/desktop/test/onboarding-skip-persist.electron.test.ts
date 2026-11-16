/**
 * Skip persistence and re-entry in real Electron: Esc dismisses the band only (the first Esc must not enter
 * the editor), the skip survives a relaunch, and Help > Welcome & Setup... brings the band back. A cleared
 * renderer profile does not re-onboard a returning user (main-process mirror).
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_ONBOARDING_E2E=1 pnpm exec vitest run test/onboarding-skip-persist.electron.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  bandLocator,
  clickMenu,
  killAll,
  launch,
  onboardingE2eEnabled,
  quit,
  readOnboardingStorage,
  waitForWelcome,
} from "./onboarding-e2e-helpers";

const d = onboardingE2eEnabled ? describe : describe.skip;
const FORCE = { OPENREEL_FORCE_ONBOARDING: "1" };

let work = "";
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-onb-skip-"));
});
afterEach(killAll);
afterAll(() => {
  killAll();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("onboarding skip, persistence and re-entry", () => {
  it("Esc dismisses the band only, survives a relaunch, and Help > Welcome & Setup re-opens it", async () => {
    const profile = path.join(work, "profile");
    const first = await launch({ userData: profile, env: FORCE });
    await waitForWelcome(first.page);
    await bandLocator(first.page).waitFor({ timeout: 10_000 });

    // First Esc: the band goes, the welcome screen stays (the editor is NOT entered).
    await first.page.locator("body").click({ position: { x: 4, y: 4 }, force: true });
    await first.page.keyboard.press("Escape");
    await bandLocator(first.page).waitFor({ state: "detached", timeout: 5_000 });
    expect(await first.page.evaluate(() => window.location.hash)).not.toContain("editor");
    expect(await first.page.getByRole("button", { name: /Horizontal/ }).isVisible()).toBe(true);
    expect(await readOnboardingStorage(first.page)).toMatchObject({ status: "skipped", skippedBy: "user" });
    await quit(first);
    expect(JSON.parse(fs.readFileSync(path.join(profile, "onboarding.json"), "utf8"))).toMatchObject({
      status: "skipped",
      skippedBy: "user",
    });

    // Relaunch on the same profile: still skipped, a "Setup" link is offered instead.
    const second = await launch({ userData: profile, env: FORCE });
    await waitForWelcome(second.page);
    await second.page.waitForTimeout(1500);
    expect(await bandLocator(second.page).count()).toBe(0);
    expect(await second.page.getByRole("button", { name: "Setup" }).isVisible()).toBe(true);

    // The native Help menu re-opens it without changing the stored status.
    await clickMenu(second.app, ["Help", "Welcome & Setup…"]);
    await bandLocator(second.page).waitFor({ timeout: 5_000 });
    expect(await readOnboardingStorage(second.page)).toMatchObject({ status: "skipped" });

    // Esc closes it again, and the Esc after that behaves as it always did (enters the editor).
    await second.page.locator("body").click({ position: { x: 4, y: 4 }, force: true });
    await second.page.keyboard.press("Escape");
    await bandLocator(second.page).waitFor({ state: "detached", timeout: 5_000 });
    await second.page.keyboard.press("Escape");
    await second.page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await quit(second);
  }, 300_000);

  it("the Setup link re-opens the band, and the Help menu works from the editor route", async () => {
    const session = await launch({ userData: path.join(work, "profile-setup"), env: FORCE });
    await waitForWelcome(session.page);
    await session.page.getByRole("button", { name: /Skip setup/ }).click();
    await bandLocator(session.page).waitFor({ state: "detached", timeout: 5_000 });
    await session.page.getByRole("button", { name: "Setup" }).click();
    await bandLocator(session.page).waitFor({ timeout: 5_000 });

    await session.page.getByRole("button", { name: /Horizontal/ }).click();
    await session.page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await clickMenu(session.app, ["Help", "Welcome & Setup…"]);
    await bandLocator(session.page).waitFor({ timeout: 10_000 });
    expect(await session.page.evaluate(() => window.location.hash)).toContain("welcome");
    await quit(session);
  }, 240_000);

  it("a done mirror keeps a cleared renderer profile from re-onboarding", async () => {
    const profile = path.join(work, "profile-mirror");
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(
      path.join(profile, "onboarding.json"),
      JSON.stringify({ v: 1, status: "done", persona: "pro", completedAt: Date.now() }),
    );
    const session = await launch({ userData: profile, env: FORCE });
    await waitForWelcome(session.page);
    // The mirror is read once at idle after first paint, so the band may flash and then collapse.
    await bandLocator(session.page).waitFor({ state: "detached", timeout: 15_000 });
    expect(await readOnboardingStorage(session.page)).toMatchObject({ status: "done" });
    await quit(session);
  }, 180_000);
});
