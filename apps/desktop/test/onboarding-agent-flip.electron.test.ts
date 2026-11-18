/**
 * Agent route flip in real Electron: an MCP client creates a project while the first-run band (and a
 * sheet) is open. The UI flips to the editor, onboarding is retired as skippedBy "agent", and no overlay
 * is left behind to steal input from the agent session.
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_ONBOARDING_E2E=1 pnpm exec vitest run test/onboarding-agent-flip.electron.test.ts
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
  mcpCall,
  onboardingE2eEnabled,
  quit,
  readEndpoint,
  readOnboardingStorage,
  waitForWelcome,
} from "./onboarding-e2e-helpers";

const d = onboardingE2eEnabled ? describe : describe.skip;

let work = "";
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-onb-agent-"));
});
afterEach(killAll);
afterAll(() => {
  killAll();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

async function createProjectViaMcp(endpointFile: string): Promise<void> {
  const endpoint = await readEndpoint(endpointFile);
  const result = await mcpCall(endpoint, "tools/call", { name: "create_project", arguments: { name: "Agent project" } });
  expect(result.status).toBe(200);
  expect(result.json.error, JSON.stringify(result.json.error)).toBeUndefined();
}

d("an MCP agent creating a project during onboarding", () => {
  for (const withSheet of [false, true]) {
    it(`flips to the editor and retires onboarding as 'agent' (${withSheet ? "a sheet is open" : "band only"})`, async () => {
      const endpointFile = path.join(work, `endpoint-${withSheet}.json`);
      // OPENREEL_MCP_ENDPOINT_FILE is itself an automation signal; FORCE keeps onboarding on for this test.
      const session = await launch({
        userData: path.join(work, `profile-${withSheet}`),
        env: { OPENREEL_FORCE_ONBOARDING: "1", OPENREEL_MCP_ENDPOINT_FILE: endpointFile },
      });
      const { page } = session;
      await waitForWelcome(page);
      await bandLocator(page).waitFor({ timeout: 10_000 });
      if (withSheet) {
        await clickMenu(session.app, ["Help", "Connect an AI Agent…"]);
        await page.waitForTimeout(500);
      }

      await createProjectViaMcp(endpointFile);

      await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
      expect(await page.evaluate(() => window.location.hash)).toContain("editor");
      expect(await readOnboardingStorage(page)).toMatchObject({ status: "skipped", skippedBy: "agent" });

      // Nothing is left over the editor: no band, no dialog, no onboarding drag strip, no tour overlay.
      expect(await bandLocator(page).count()).toBe(0);
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
      expect(await page.getByTestId("onboarding-drag-strip").count()).toBe(0);
      expect(await page.locator(".z-\\[100\\].fixed").count(), "no passive-tour overlay on desktop").toBe(0);
      await quit(session);
    }, 240_000);
  }
});
