/**
 * Cold-start audio warm-up in real Electron: the preload embeds a hidden frame of the `openreel-warm://`
 * scheme (its own renderer process), the frame is not a Playwright page (a second window would break
 * `firstWindow()` everywhere), it removes itself again, only editor windows get it, and the audio service
 * is already running while the welcome screen is up.
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_AUDIO_WARM_E2E=1 pnpm exec vitest run test/audio-warm-frame.electron.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { killAll, launch, quit, repoRoot, sleep, waitForWelcome } from "./onboarding-e2e-helpers";

const enabled =
  process.env.OPENREEL_DESKTOP_AUDIO_WARM_E2E === "1" &&
  fs.existsSync(path.join(repoRoot, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(repoRoot, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

let work = "";
beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-audio-warm-"));
});
afterEach(killAll);
afterAll(() => {
  killAll();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("audio start-up warm-up", () => {
  it("embeds the warm frame as a frame (not a window), runs it, and removes it again", async () => {
    const session = await launch({ userData: path.join(work, "profile"), env: { OPENREEL_FORCE_ONBOARDING: "0" } });
    const { app, page } = session;
    await waitForWelcome(page);
    expect(page.url()).toMatch(/^app:\/\/openreel\//);

    const warmFrame = async () => page.frames().find((f: { url(): string }) => f.url().startsWith("openreel-warm://"));
    let frame = await warmFrame();
    for (let i = 0; !frame && i < 50; i++) {
      await sleep(100);
      frame = await warmFrame();
    }
    expect(frame, "the warm frame was never inserted").toBeTruthy();
    // It ran its page (an AudioContext can be built there; it is the frame's own origin, not the app's).
    expect(await frame.evaluate(() => location.origin)).toBe("openreel-warm://audio");
    expect(app.windows()).toHaveLength(1);
    expect(app.windows()[0]).toBe(page);

    // The audio service process exists without the editor having been opened.
    const types = await app.evaluate(({ app: electronApp }: any) => electronApp.getAppMetrics().map((m: any) => `${m.type}:${m.name ?? ""}`));
    expect(types.some((t: string) => /audio/i.test(t)), `no audio service in ${types.join(", ")}`).toBe(true);

    // Gone again shortly after it loaded (1.5 s) and always before the 10 s hard stop.
    const deadline = Date.now() + 12_000;
    while ((await warmFrame()) && Date.now() < deadline) await sleep(250);
    expect(await warmFrame()).toBeUndefined();
    expect(await page.evaluate(() => document.querySelectorAll("iframe").length)).toBe(0);
    await quit(session);
  });
});
