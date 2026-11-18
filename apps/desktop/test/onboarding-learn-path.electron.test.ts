/**
 * Real-Electron end-to-end coverage of the Learn path (Playwright _electron, the BUILT app):
 *
 *  1. The real Learn sheet: "Use the practice clips" reads the shipped pack over the samples IPC, creates the
 *     practice project, imports the clips and puts the Lesson Bar up.
 *  2. Lesson 1 completes from project state (a clip on the timeline), lesson 2 completes by pressing the
 *     key the bar names (read from the live binding) at the playhead, and the bar says "3 of 6".
 *  3. Progress persists: after a full quit and relaunch the same profile still has lessons 1-2 done, and the
 *     Lesson Hub shows "2 of 6", resumes at lesson 3 and the bar comes back.
 *
 * Native dialogs are not used: the practice clips come from the app's own resources/samples folder.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_ONBOARDING_E2E=1:
 *   OPENREEL_DESKTOP_ONBOARDING_E2E=1 pnpm exec vitest run test/onboarding-learn-path.electron.test.ts
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const enabled =
  process.env.OPENREEL_DESKTOP_ONBOARDING_E2E === "1" &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

const require = createRequire(path.join(root, "package.json"));
function loadPlaywright(): { _electron: any } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const E = (page: any, expression: string): Promise<any> =>
  page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);

interface Session {
  app: any;
  page: any;
  profile: string;
}
const sessions = new Set<Session>();
let work = "";

async function launch(profile: string): Promise<Session> {
  const { _electron } = loadPlaywright();
  const env: Record<string, string | undefined> = { ...process.env };
  if (fs.existsSync(FFMPEG)) env.OPENREEL_FFMPEG_PATH = FFMPEG;
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    env,
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  // The passive tour would otherwise open over the editor and swallow clicks and keys.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__openreelE2E?.learn), undefined, { timeout: 60_000 });
  const session = { app, page, profile };
  sessions.add(session);
  return session;
}

async function quit(session: Session): Promise<void> {
  const proc = session.app.process();
  const exited = new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null) resolve(true);
    proc.once("exit", () => resolve(true));
  });
  // The unsaved-changes guard is a native message box nobody can click here: answer "Don't Save".
  await session.app
    .evaluate(({ dialog }: any) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    })
    .catch(() => undefined);
  session.app.evaluate(({ app }: any) => app.quit()).catch(() => undefined);
  const ok = await Promise.race([exited, sleep(20_000).then(() => false)]);
  if (!ok) {
    proc.kill("SIGKILL");
    await exited;
  }
  sessions.delete(session);
}

/** After a quit the previous auto-save is offered for recovery; the test wants a clean project instead. */
async function dismissRecovery(page: any): Promise<void> {
  const close = page.getByRole("button", { name: "Close dialog" });
  if (await close.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
    await close.click();
    await close.waitFor({ state: "detached", timeout: 10_000 });
  }
}

const bar = (page: any) => page.locator('[data-testid="lesson-bar"]');
const progress = (page: any) => page.locator('[data-testid="lesson-progress"]');

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "oronboarding-e2e-"));
});

/** A failed test must not leave an app running: the next launch on the same profile would hit the single-instance lock. */
function killOpenSessions(): void {
  for (const session of [...sessions]) {
    try {
      session.app.process().kill("SIGKILL");
    } catch {
      /* already closed */
    }
  }
  sessions.clear();
}
afterEach(killOpenSessions);
afterAll(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

d("Learn path (real Electron)", () => {
  it(
    "practice project, lesson 1 and 2 from project state, progress persists across relaunch and the Hub resumes",
    async () => {
      const profile = path.join(work, "profile");
      fs.mkdirSync(profile, { recursive: true });

      // ---- 1. Real Learn sheet -> practice project -> Lesson Bar ---------------------------------------
      let s = await launch(profile);
      await s.page.getByRole("button", { name: /Horizontal/ }).waitFor({ timeout: 60_000 });
      await E(s.page, `h.learn.openSheet("learn")`);

      const dialog = s.page.getByRole("dialog", { name: "Pick your practice footage" });
      await dialog.waitFor({ timeout: 15_000 });
      const practice = dialog.getByRole("button", { name: /Use the practice clips/ });
      await practice.waitFor({ timeout: 15_000 });
      await sleep(300); // the button enables once the samples list resolved
      await practice.click();

      await bar(s.page).waitFor({ state: "visible", timeout: 120_000 });
      await dialog.waitFor({ state: "detached", timeout: 15_000 });
      expect(await progress(s.page).textContent()).toBe("1 of 6");
      expect(await s.page.evaluate(() => window.location.hash)).toMatch(/^#\/editor/);

      // The shipped pack: three generated video clips and the music bed, all in the media library.
      const library: Array<{ id: string; type: string; name: string }> = await E(
        s.page,
        `h.project.getState().project.mediaLibrary.items.map((i) => ({ id: i.id, type: i.type, name: i.name }))`,
      );
      expect(library.filter((i) => i.type === "video")).toHaveLength(3);
      expect(library.filter((i) => i.type === "audio")).toHaveLength(1);
      expect(await E(s.page, `h.project.getState().project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)`)).toBe(0);
      expect(await E(s.page, `h.project.getState().project.settings.width`)).toBe(1920);

      // ---- 2. Lesson 1: a clip on the timeline (project state, not a click) ---------------------------
      const video = library.find((i) => i.type === "video")!;
      await E(s.page, `h.project.getState().placeMediaClip(${JSON.stringify(video.id)}, undefined, 0)`);
      await s.page.waitForFunction(
        () => document.querySelector('[data-testid="lesson-progress"]')?.textContent === "2 of 6",
        undefined,
        { timeout: 15_000 },
      );
      expect(await bar(s.page).getAttribute("data-lesson")).toBe("split");

      // ---- 3. Lesson 2: press the key the bar names, at the playhead -----------------------------------
      const keyName = (await bar(s.page).locator("kbd").first().textContent())!.trim();
      expect(keyName.toUpperCase()).toBe("S"); // OpenReel's default split key, read from the live binding
      const clipId: string = await E(s.page, `h.project.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].id`);
      await E(s.page, `h.ui.getState().select({ type: "clip", id: ${JSON.stringify(clipId)} })`);
      await E(s.page, `h.timeline.getState().setPlayheadPosition(2.5)`);
      await s.page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
      await s.page.keyboard.press(keyName.toLowerCase());
      await s.page.waitForFunction(
        () => document.querySelector('[data-testid="lesson-progress"]')?.textContent === "3 of 6",
        undefined,
        { timeout: 15_000 },
      );
      expect(await E(s.page, `h.project.getState().project.timeline.tracks.reduce((n, t) => n + t.clips.length, 0)`)).toBe(2);
      expect(await bar(s.page).getAttribute("data-lesson")).toBe("delete");

      // Persisted before the quit.
      const stored = await E(s.page, `({ lessons: h.learn.onboarding.getState().lessons, current: h.learn.onboarding.getState().currentLesson })`);
      expect(stored.lessons).toMatchObject({ "place-clip": "done", split: "done" });
      expect(stored.current).toBe("delete");
      await sleep(500); // let the persist middleware flush
      await quit(s);

      // ---- 4. Relaunch: progress survived, Lesson Hub shows 2 of 6 and resumes ---------------------------
      s = await launch(profile);
      const after = await E(s.page, `({ lessons: h.learn.onboarding.getState().lessons, current: h.learn.onboarding.getState().currentLesson })`);
      expect(after.lessons).toMatchObject({ "place-clip": "done", split: "done" });
      expect(after.current).toBe("delete");
      expect(await bar(s.page).count()).toBe(0); // nothing nags on launch; the Hub is the way back in

      await dismissRecovery(s.page);
      await s.page.getByRole("button", { name: /Horizontal/ }).click({ timeout: 60_000 });
      await s.page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });

      await E(s.page, `h.learn.openSheet("lessons")`);
      const hub = s.page.getByRole("dialog", { name: "Learn OpenReel" });
      await hub.waitFor({ timeout: 15_000 });
      expect(await hub.getByRole("listitem").count()).toBe(6);
      expect(await hub.textContent()).toContain("2 of 6");
      await hub.getByRole("button", { name: "Resume" }).click();

      await bar(s.page).waitFor({ state: "visible", timeout: 15_000 });
      expect(await progress(s.page).textContent()).toBe("3 of 6");
      expect(await bar(s.page).getAttribute("data-lesson")).toBe("delete");

      // "Mark as done" is always there, even when the predicate would disagree.
      await bar(s.page).getByRole("button", { name: "Mark as done" }).click();
      await s.page.waitForFunction(
        () => document.querySelector('[data-testid="lesson-progress"]')?.textContent === "4 of 6",
        undefined,
        { timeout: 15_000 },
      );
      await quit(s);
    },
    480_000,
  );
});
