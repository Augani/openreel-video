/**
 * Shared helpers for the first-run onboarding Electron suites (Playwright `_electron`, the BUILT app).
 *
 * Needs a build made with the e2e hook:  VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 * Opt in with OPENREEL_DESKTOP_ONBOARDING_E2E=1 (see the `test:onboarding-e2e` script).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(__dirname, "../../..");
const builtMain = path.join(repoRoot, "apps/desktop/dist/main/index.js");
const builtRenderer = path.join(repoRoot, "apps/web/dist/index.html");

export const onboardingE2eEnabled =
  process.env.OPENREEL_DESKTOP_ONBOARDING_E2E === "1" && fs.existsSync(builtMain) && fs.existsSync(builtRenderer);

/** Every variable that makes main report `automation = true`. A developer shell or CI may set any of them. */
export const AUTOMATION_ENV = [
  "OPENREEL_PERF",
  "OPENREEL_ELECTRON_TEST",
  "OPENREEL_E2E",
  "CI",
  "OPENREEL_SKIP_ONBOARDING",
  "OPENREEL_MCP_ENDPOINT_FILE",
  "OPENREEL_FORCE_ONBOARDING",
] as const;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Playwright objects are deliberately loose here: the suites only use a handful of calls.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Session {
  app: any;
  page: any;
  userData: string;
}

function loadPlaywright(): { _electron: any } {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((name) => name.startsWith("playwright@"));
  if (!dir) throw new Error("playwright is not installed in the workspace");
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
}

export interface LaunchOptions {
  userData: string;
  /** Extra env on top of a scrubbed copy of process.env (no automation variables). */
  env?: Record<string, string>;
  args?: string[];
  /** Resize to the minimum supported window (1024x700) before the page is used. */
  minimumWindow?: boolean;
}

const live = new Set<Session>();

export async function launch(options: LaunchOptions): Promise<Session> {
  const { _electron } = loadPlaywright();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(AUTOMATION_ENV as readonly string[]).includes(key)) env[key] = value;
  }
  Object.assign(env, options.env ?? {});
  const app = await _electron.launch({
    args: [path.join(repoRoot, "apps/desktop"), `--user-data-dir=${options.userData}`, ...(options.args ?? [])],
    env,
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  if (options.minimumWindow) {
    await app.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setSize(1024, 700);
    });
    await page.waitForFunction(() => window.innerWidth <= 1030 && window.innerHeight <= 710, undefined, { timeout: 10_000 });
  }
  const session = { app, page, userData: options.userData };
  live.add(session);
  return session;
}

/** Graceful quit so localStorage and the main-process mirror are flushed; kills only if it hangs. */
export async function quit(session: Session): Promise<void> {
  const proc = session.app.process();
  const exited = new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null) resolve(true);
    proc.once("exit", () => resolve(true));
  });
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
  live.delete(session);
}

export function killAll(): void {
  for (const session of live) {
    try {
      session.app.process().kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  live.clear();
}

/** The welcome screen is ready when the format cards are clickable. */
export async function waitForWelcome(page: any): Promise<void> {
  await page.getByRole("button", { name: /Horizontal/ }).waitFor({ timeout: 60_000 });
}

export function bandLocator(page: any): any {
  return page.getByRole("group", { name: "Choose how to start" });
}

export async function readOnboardingStorage(page: any): Promise<Record<string, any> | null> {
  const raw: string | null = await page.evaluate(() => {
    try {
      return localStorage.getItem("openreel-onboarding");
    } catch {
      return null;
    }
  });
  if (!raw) return null;
  return (JSON.parse(raw) as { state?: Record<string, any> }).state ?? null;
}

/** Click a native application-menu item by its path of labels, e.g. ["Help", "Welcome & Setup…"]. */
export async function clickMenu(app: any, labels: string[]): Promise<void> {
  const found = await app.evaluate(({ Menu }: any, path: string[]) => {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let target: any = null;
    for (const label of path) {
      target = items.find((item: any) => item.label === label);
      if (!target) return false;
      items = target.submenu?.items ?? [];
    }
    target.click();
    return true;
  }, labels);
  if (!found) throw new Error(`menu item not found: ${labels.join(" > ")}`);
}

export interface McpEndpointInfo {
  url: string;
  token: string;
}

export async function readEndpoint(file: string, timeoutMs = 30_000): Promise<McpEndpointInfo> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as McpEndpointInfo;
    } catch {
      await sleep(50);
    }
  }
  throw new Error("the MCP endpoint file never appeared");
}

export async function mcpCall(
  endpoint: McpEndpointInfo,
  method: string,
  params?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: response.status, json: await response.json() };
}
