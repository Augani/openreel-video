/**
 * Real-Electron coverage of the onboarding Pro path (spec 2.3, work package D), against the BUILT app on a
 * fresh profile (no legacy onboarding flag, so the first-run band and the Pro row are what a new user sees):
 *
 *  1. Pick Premiere keys and the Audio workspace in the Pro row, then click "Horizontal": the preset is
 *     persisted (`openreel_shortcut_preset`), the caption shows a real key count, and the editor opens
 *     on the Audio workspace.
 *  2. "Import timeline" from the row opens the picker, and a valid OTIO file lands in the editor's import report.
 *  3. "Custom sequence" creates a project with exactly the chosen width, height and frame rate.
 *  4. "Open project" uses the native picker (stubbed answer) and loads a project file into the editor.
 *
 * Native dialogs cannot be clicked, so the main process `dialog` functions are stubbed with the paths the test
 * wants; the file input of the timeline import is driven through Playwright's file chooser.
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_ONBOARDING_E2E=1:  pnpm exec vitest run test/onboarding-pro-path.electron.test.ts
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AUTOMATION_ENV } from "./onboarding-e2e-helpers";

const root = path.resolve(__dirname, "../../..");
const enabled =
  process.env.OPENREEL_DESKTOP_ONBOARDING_E2E === "1" &&
  fs.existsSync(path.join(root, "apps/desktop/dist/main/index.js")) &&
  fs.existsSync(path.join(root, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

const require = createRequire(path.join(root, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
function loadPlaywright(): { _electron: Loose } {
  const pnpmDir = path.join(root, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  return require(path.join(pnpmDir, dir!, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const E = (page: Loose, expression: string): Promise<Loose> =>
  page.evaluate(`(async (h) => (${expression}))(window.__openreelE2E)`);

interface Session {
  app: Loose;
  page: Loose;
  profile: string;
}
const sessions = new Set<Session>();
let work = "";

async function launch(): Promise<Session> {
  const profile = fs.mkdtempSync(path.join(work, "profile-"));
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({
    args: [path.join(root, "apps/desktop"), `--user-data-dir=${profile}`],
    // Scrubbed: any automation variable (OPENREEL_ELECTRON_TEST, CI, ...) hides onboarding by design.
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !(AUTOMATION_ENV as readonly string[]).includes(key)),
    ),
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  // Deliberately NOT seeding "openreel-onboarding-complete": this is a first run. Only the unrelated mograph tour is silenced.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.reload();
  const session = { app, page, profile };
  sessions.add(session);
  await page.getByRole("button", { name: /Horizontal/ }).waitFor({ timeout: 60_000 });
  return session;
}

async function openProRow(page: Loose): Promise<void> {
  await page.getByRole("button", { name: "I already edit" }).click();
  await page.getByRole("group", { name: "Set it up your way." }).waitFor({ timeout: 10_000 });
}

async function waitForEditor(page: Loose): Promise<void> {
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((window as Loose).__openreelE2E?.project), undefined, { timeout: 30_000 });
}

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

beforeAll(() => {
  if (!enabled) return;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "oronb-pro-e2e-"));
});
afterEach(killOpenSessions);
afterAll(() => {
  killOpenSessions();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

const OTIO_FILE = JSON.stringify({
  OTIO_SCHEMA: "Timeline.1",
  name: "Imported cut",
  tracks: {
    OTIO_SCHEMA: "Stack.1",
    children: [
      {
        OTIO_SCHEMA: "Track.1",
        kind: "Video",
        children: [
          {
            OTIO_SCHEMA: "Clip.2",
            name: "Interview",
            source_range: {
              OTIO_SCHEMA: "TimeRange.1",
              start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 0 },
              duration: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 48 },
            },
            active_media_reference_key: "DEFAULT_MEDIA",
            media_references: {
              DEFAULT_MEDIA: {
                OTIO_SCHEMA: "ExternalReference.1",
                target_url: "/nowhere/Interview.mp4",
                available_range: {
                  OTIO_SCHEMA: "TimeRange.1",
                  start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 0 },
                  duration: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 240 },
                },
              },
            },
          },
        ],
      },
    ],
  },
});

d("onboarding Pro path", () => {
  it("Premiere keys + Audio workspace persist and apply when a format card starts the editor", async () => {
    const { page } = await launch();
    await openProRow(page);

    await page.getByRole("radio", { name: "Premiere keys" }).click();
    await page.getByRole("radio", { name: "Audio workspace" }).click();

    const caption = await page.getByTestId("pro-keymap-caption").innerText();
    expect(caption).toMatch(/Premiere-style: \d+ keys changed\./);
    expect(caption).toMatch(/Search moves to/);
    const count = Number(/(\d+) keys changed/.exec(caption)![1]);
    expect(count).toBeGreaterThan(5);

    expect(await page.evaluate(() => localStorage.getItem("openreel_shortcut_preset"))).toBe("premiere");
    // The Premiere split binding is stored as a customization on top of the defaults.
    const custom = JSON.parse((await page.evaluate(() => localStorage.getItem("openreel_shortcuts"))) ?? "{}");
    expect(custom["editing.split"]).toBe("cmd+k");
    expect(Object.keys(custom).length).toBe(count);

    await page.getByRole("button", { name: /Horizontal/ }).click();
    await waitForEditor(page);
    expect(await E(page, "h.workspace.getState().section")).toBe("audio");
    expect(await page.evaluate(() => localStorage.getItem("openreel_shortcut_preset"))).toBe("premiere");
  }, 180_000);

  it("Import timeline from the row reaches the editor with the import report", async () => {
    const { page } = await launch();
    await openProRow(page);
    const file = path.join(work, "cut.otio");
    fs.writeFileSync(file, OTIO_FILE);

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15_000 }),
      page.getByRole("button", { name: /Import timeline/ }).click(),
    ]);
    await chooser.setFiles(file);

    await page.getByTestId("timeline-import-report").waitFor({ timeout: 60_000 });
    expect(await page.getByTestId("import-clip-count").innerText()).toBe("1");
    expect(await page.evaluate(() => window.location.hash)).toMatch(/editor/);
  }, 180_000);

  it("Custom sequence creates a project with the chosen size and frame rate", async () => {
    const { page } = await launch();
    await openProRow(page);
    await page.getByRole("button", { name: /Custom sequence/ }).click();
    const dialog = page.getByTestId("custom-sequence-dialog");
    await dialog.waitFor({ timeout: 10_000 });

    await dialog.getByLabel("Name").fill("Festival cut");
    await dialog.getByLabel("Width").fill("2048");
    await dialog.getByLabel("Height").fill("1080");
    await dialog.getByLabel("Frame rate").selectOption("25");
    await dialog.getByRole("button", { name: "Create sequence" }).click();

    await waitForEditor(page);
    const settings = await E(page, "(({ width, height, frameRate }) => ({ width, height, frameRate }))(h.project.getState().project.settings)");
    expect(settings).toEqual({ width: 2048, height: 1080, frameRate: 25 });
    expect(await E(page, "h.project.getState().project.name")).toBe("Festival cut");
    // The format was chosen here, so the empty-project format picker must not show a second time.
    expect(await page.getByRole("button", { name: /Horizontal/ }).count()).toBe(0);
  }, 180_000);

  it("Open project uses the native picker and loads the file", async () => {
    // Session 1 builds a project file with a distinctive size, then goes away.
    const first = await launch();
    await openProRow(first.page);
    await first.page.getByRole("button", { name: /Custom sequence/ }).click();
    const dialog = first.page.getByTestId("custom-sequence-dialog");
    await dialog.getByLabel("Name").fill("From file");
    await dialog.getByRole("button", { name: "4K 24" }).click();
    await dialog.getByRole("button", { name: "Create sequence" }).click();
    await waitForEditor(first.page);
    const json: string = await E(first.page, "JSON.stringify(h.project.getState().project)");
    const projectPath = path.join(work, "from-file.oreel");
    fs.writeFileSync(projectPath, json);
    first.app.process().kill("SIGKILL");
    sessions.delete(first);
    await sleep(500);

    const { app, page } = await launch();
    await openProRow(page);
    await app.evaluate(({ dialog: nativeDialog }: Loose, chosen: string) => {
      nativeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
    }, projectPath);
    await page.getByRole("button", { name: /Open project/ }).click();

    await waitForEditor(page);
    expect(await E(page, "h.project.getState().project.name")).toBe("From file");
    const settings = await E(page, "(({ width, height, frameRate }) => ({ width, height, frameRate }))(h.project.getState().project.settings)");
    expect(settings).toEqual({ width: 3840, height: 2160, frameRate: 24 });
  }, 240_000);
});
