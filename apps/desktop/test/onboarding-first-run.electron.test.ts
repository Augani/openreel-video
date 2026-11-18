/**
 * First-run onboarding in real Electron: a fresh profile, no automation. The band shows above the format
 * cards, "Horizontal" stays reachable inside the 1024x700 minimum window, and a format click still
 * reaches the editor (the contract the perf harness and the other e2e suites depend on).
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_ONBOARDING_E2E=1 pnpm exec vitest run test/onboarding-first-run.electron.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bandLocator, killAll, launch, onboardingE2eEnabled, quit, readOnboardingStorage, waitForWelcome } from "./onboarding-e2e-helpers";

const d = onboardingE2eEnabled ? describe : describe.skip;
// The welcome mark has to land within the cold-start envelope (perf-budgets.json cold budget is ~1.2 s
// from spawn on an idle machine); the e2e allows a generous ceiling because this runs on busy machines.
const WELCOME_VISIBLE_CEILING_MS = 15_000;

let work = "";
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-onb-first-"));
});
afterEach(killAll);
afterAll(() => {
  killAll();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("first-run onboarding (fresh profile, no automation)", () => {
  it("shows the band, keeps Horizontal inside 1024x700, and a format click reaches the editor", async () => {
    const session = await launch({
      userData: path.join(work, "profile"),
      env: { OPENREEL_FORCE_ONBOARDING: "1" },
      minimumWindow: true,
    });
    const { page } = session;
    await waitForWelcome(page);

    expect(
      await page.evaluate(() => (window as unknown as { openreel?: { automation?: boolean } }).openreel?.automation),
      "automation flag",
    ).toBe(false);

    const band = bandLocator(page);
    await band.waitFor({ timeout: 10_000 });
    for (const name of [/Edit with AI/, /Learn to edit/, /I already edit/, /Connect an agent/, /Skip setup/]) {
      expect(await page.getByRole("button", { name }).isVisible(), String(name)).toBe(true);
    }

    // The harness contract: the exact text and the role query both resolve to the one card button.
    expect(await page.getByText("Horizontal", { exact: true }).count()).toBe(1);
    const horizontal = page.getByRole("button", { name: /Horizontal/ });
    const box = await horizontal.boundingBox();
    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(viewport.w).toBeLessThanOrEqual(1030);
    expect(viewport.h).toBeLessThanOrEqual(710);
    expect(box, "Horizontal has a box").not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, "Horizontal fits inside the minimum window").toBeLessThanOrEqual(viewport.h);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w);

    // The band sits above the cards and never overlaps them.
    const bandBox = await band.boundingBox();
    expect(bandBox!.y + bandBox!.height).toBeLessThanOrEqual(box!.y + 1);

    // No scrolling needed at the minimum size, and nothing modal on first paint.
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="welcome-scroller"]');
      return scroller ? scroller.scrollHeight - scroller.clientHeight : Number.POSITIVE_INFINITY;
    });
    expect(overflow, "welcome content fits without scrolling").toBeLessThanOrEqual(1);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);

    const welcomeVisible = await page.evaluate(
      () => performance.getEntriesByName("openreel:welcome-visible").map((e) => e.startTime)[0] ?? null,
    );
    expect(welcomeVisible, "openreel:welcome-visible mark").not.toBeNull();
    expect(welcomeVisible as number).toBeLessThan(WELCOME_VISIBLE_CEILING_MS);
    const bandVisible = await page.evaluate(
      () => performance.getEntriesByName("openreel:onboarding-visible").map((e) => e.startTime)[0] ?? null,
    );
    expect(bandVisible, "openreel:onboarding-visible mark").not.toBeNull();

    await horizontal.click();
    await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    // The format was chosen on the welcome card: the editor must not ask for it again.
    expect(await page.getByRole("heading", { name: "Start your project" }).count()).toBe(0);

    const stored = await readOnboardingStorage(page);
    expect(stored).toMatchObject({ status: "skipped", skippedBy: "format" });
    await quit(session);

    // The main-process mirror survived the quit.
    const mirror = JSON.parse(fs.readFileSync(path.join(work, "profile", "onboarding.json"), "utf8"));
    expect(mirror).toMatchObject({ v: 1, status: "skipped", skippedBy: "format" });
  }, 240_000);

  it("a fresh profile without any flag shows the band and still lets the harness click Horizontal", async () => {
    // The launch helper scrubs every automation variable, so this is a real first run.
    const session = await launch({ userData: path.join(work, "plain-profile"), minimumWindow: true });
    await waitForWelcome(session.page);
    await bandLocator(session.page).waitFor({ timeout: 10_000 });
    await session.page.getByText("Horizontal", { exact: true }).click();
    await session.page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
    await quit(session);
  }, 240_000);

  it("lays the three path tiles in one row at 1280 wide (3-column layout)", async () => {
    const session = await launch({ userData: path.join(work, "wide-profile"), minimumWindow: true });
    await waitForWelcome(session.page);
    await session.app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
    await session.page.waitForFunction(() => window.innerWidth >= 1100, undefined, { timeout: 10_000 });
    const tiles = session.page.getByTestId("onboarding-tiles").getByRole("button");
    expect(await tiles.count()).toBe(3);
    const boxes = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox(), await tiles.nth(2).boundingBox()];
    expect(boxes.every((b) => b !== null)).toBe(true);
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[1]!.y - boxes[2]!.y)).toBeLessThan(2);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 1);
    expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x + boxes[1]!.width - 1);
    await quit(session);
  }, 240_000);
});
