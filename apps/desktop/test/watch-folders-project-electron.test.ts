/**
 * Real-Electron e2e for the PROJECT-file half of export watch folders (Playwright _electron, the BUILT app).
 *
 * A saved .oreel project dropped into an export folder that opted in (includeProjects) is opened in the editor
 * and rendered through the editor's own export queue with the folder's preset; the file lands in the output
 * folder and the project file moves to done/. The project is built through the MCP tools (the same way the
 * windowless MCP e2e does), so this also exercises the watch-folder origin of the confirmation gate: the
 * export is expensive and the agent auto-allow is turned off here.
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   pnpm --filter @openreel/desktop test:watch-e2e
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 240_000 });

const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? path.join(path.dirname(FFMPEG), "ffprobe");
const enabled =
  process.env.OPENREEL_DESKTOP_WATCH_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
  fs.existsSync(path.join(desktopDir, "dist/main/index.js")) &&
  fs.existsSync(path.join(repoRoot, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

function loadPlaywright(): { _electron: { launch(options: Record<string, unknown>): Promise<any> } } {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith("playwright@"));
  if (!dir) throw new Error("playwright is not installed in the workspace");
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(label: string, read: () => Promise<T> | T, timeout = 120_000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(200);
  }
}

let endpoint: { url: string; token: string };
let nextId = 1;
async function rpc(body: unknown): Promise<any> {
  const response = await fetch(endpoint.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` }, body: JSON.stringify(body) });
  return response.json();
}
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string; data: any }> {
  const reply = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
  expect(reply.error, `${name}: ${JSON.stringify(reply.error)}`).toBeUndefined();
  const text = String(reply.result.content?.[0]?.text ?? "");
  const blank = text.indexOf("\n\n");
  let data: any;
  if (reply.result.isError !== true && blank >= 0) {
    try {
      data = JSON.parse(text.slice(blank + 2));
    } catch {
      data = undefined;
    }
  }
  return { isError: reply.result.isError === true, text, data };
}

d("project files in an export watch folder (real Electron)", () => {
  let app: any;
  let work = "";
  let exportDir = "";
  let outputDir = "";

  beforeAll(async () => {
    if (!enabled) return;
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openreel-watch-proj-")));
    const userData = path.join(work, "ud");
    exportDir = path.join(work, "hot");
    outputDir = path.join(work, "rendered");
    for (const dir of [userData, exportDir, path.join(work, "Footage")]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(userData, "mcp-policy.json"), JSON.stringify({ v: 1, allowedRoots: [work] }));
    fs.writeFileSync(
      path.join(userData, "watch-folders.json"),
      JSON.stringify({ version: 1, folders: [{ id: "export-1", kind: "export", path: exportDir, presetId: "1080p-high", outputDir, includeProjects: true, baselined: true }] }),
    );
    execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(work, "Footage", "tone.mp4")]);
    const endpointFile = path.join(work, "mcp-endpoint.json");
    const { _electron } = loadPlaywright();
    app = await _electron.launch({
      args: [desktopDir, `--user-data-dir=${userData}`],
      env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile, OPENREEL_FFMPEG_PATH: FFMPEG, OPENREEL_WATCH_SETTLE_MS: "600" },
      timeout: 120_000,
    });
    for (let i = 0; i < 400; i++) {
      try {
        endpoint = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
        break;
      } catch {
        await sleep(50);
      }
    }
    expect(endpoint, "the MCP endpoint file appeared").toBeTruthy();
    expect((await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/list" })).result.tools.length).toBeGreaterThan(100);
  }, 240_000);

  afterAll(async () => {
    if (!enabled) return;
    try {
      app?.process().kill("SIGKILL");
    } catch {
      /* already gone */
    }
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("renders a dropped project file through the editor's export queue, into the output folder", async () => {
    expect((await call("dismiss_onboarding")).isError).toBe(false);
    expect((await call("create_project", { name: "Cut", width: 1280, height: 720, frameRate: 24 })).isError).toBe(false);
    const imported = await call("import_media_from_path", { paths: [path.join(work, "Footage", "tone.mp4")] });
    expect(imported.isError, imported.text).toBe(false);
    const mediaId = imported.data.imported[0].mediaId as string;
    let tracks = (await call("list_tracks")).data as any;
    let video = (Array.isArray(tracks) ? tracks : tracks?.tracks ?? []).find((track: any) => track.type === "video");
    if (!video) {
      expect((await call("add_track", { trackType: "video" })).isError).toBe(false);
      tracks = (await call("list_tracks")).data;
      video = (Array.isArray(tracks) ? tracks : tracks?.tracks ?? []).find((track: any) => track.type === "video");
    }
    expect((await call("add_clip", { trackId: video.id, mediaId, startTime: 0 })).isError).toBe(false);
    const staged = path.join(work, "Cut.oreel");
    expect((await call("save_project_as", { path: staged })).isError).toBe(false);
    // Another project is open when the file arrives: rendering replaces it (it is saved first).
    expect((await call("create_project", { name: "Something else" })).isError).toBe(false);

    fs.renameSync(staged, path.join(exportDir, "Cut.oreel"));
    const dump = async () => {
      const page = await app.firstWindow();
      return JSON.stringify(await page.evaluate(() => (window as any).openreel.watchFolders.list()));
    };
    const out = await until("rendered project", () => {
      const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter((n) => n.endsWith(".mp4") && !n.startsWith(".")) : [];
      return files.length ? path.join(outputDir, files[0]) : null;
    }, 60_000).catch(async (error) => {
      throw new Error(`${error.message}; watch state: ${await dump()}`);
    });
    const info = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", out], { encoding: "utf8" }));
    const video0 = info.streams.find((s: any) => s.codec_type === "video");
    expect(video0).toMatchObject({ codec_name: "h264", width: 1920, height: 1080 });
    expect(Number(info.format.duration)).toBeGreaterThan(1.5);
    await until("project moved to done", () => fs.existsSync(path.join(exportDir, "done", "Cut.oreel")));
    expect(fs.existsSync(path.join(exportDir, "Cut.oreel"))).toBe(false);
    expect((await call("get_app_state")).data).toMatchObject({ projectOpen: true });
  });
});
