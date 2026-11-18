/**
 * Real-Electron end-to-end test of the windowless MCP workflow (Playwright _electron, the BUILT app):
 *
 *   get_app_state -> dismiss_onboarding -> get_export_options -> create_project ->
 *   import_media_from_path (allowed-roots policy) -> add_clip -> export_video / queue_export with an
 *   outputPath, with the window MINIMIZED and then HIDDEN -> save_project_as / open_project_file /
 *   import_timeline_from_path.
 *
 * Paths outside the allowed roots (also through `..` and symlinks) must be refused with
 * OUTSIDE_ALLOWED_ROOTS, and nothing may be written there.
 *
 * Everything goes through the real main-process path: loopback HTTP MCP endpoint (token from the
 * endpoint file) -> renderer-bridge -> window IPC -> renderer registry -> back. Needs the BUILT app
 * and a system ffmpeg (only to generate the source clip and to probe the exported files):
 *
 *   VITE_OPENREEL_E2E=1 pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_MCP_E2E=1 pnpm exec vitest run test/mcp-windowless-e2e.electron.test.ts   (from apps/desktop)
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE ?? path.join(path.dirname(FFMPEG), "ffprobe");
const enabled =
  process.env.OPENREEL_DESKTOP_MCP_E2E === "1" &&
  fs.existsSync(FFMPEG) &&
  fs.existsSync(path.join(desktopDir, "dist/main/index.js")) &&
  fs.existsSync(path.join(repoRoot, "apps/web/dist/index.html"));
const d = enabled ? describe : describe.skip;

function loadPlaywright(): { _electron: { launch(options: Record<string, unknown>): Promise<ElectronApp> } } {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith("playwright@"));
  if (!dir) throw new Error("playwright is not installed in the workspace");
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
}

interface WindowState {
  count: number;
  minimized: boolean;
  visible: boolean;
  focused: boolean;
}
interface ElectronApp {
  evaluate<T, A = undefined>(fn: (modules: { BrowserWindow: any }, arg: A) => T, arg?: A): Promise<T>;
  process(): { kill(signal: string): void };
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ToolOutcome {
  isError: boolean;
  text: string;
  data: any;
  code: string | null;
}

let endpoint: { url: string; token: string };
let nextId = 1;

async function rpc(body: unknown): Promise<any> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify(body),
  });
  return response.json();
}

/** tools/call with the result text split into the summary, the JSON data and the (CODE: message) of a failure. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const reply = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
  expect(reply.error, `${name}: ${JSON.stringify(reply.error)}`).toBeUndefined();
  const text = String(reply.result.content?.[0]?.text ?? "");
  const isError = reply.result.isError === true;
  let data: any;
  const blank = text.indexOf("\n\n");
  if (!isError && blank >= 0) {
    try {
      data = JSON.parse(text.slice(blank + 2));
    } catch {
      data = undefined;
    }
  }
  const code = /\(([A-Z_]+): /.exec(text)?.[1] ?? null;
  return { isError, text, data, code };
}

const sha256File = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function probe(file: string, entries: string): Record<string, string> {
  const out = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=nw=1", file], { encoding: "utf8" });
  return Object.fromEntries(out.trim().split("\n").map((line) => line.split("=") as [string, string]));
}

d("MCP windowless workflow (real Electron, window minimized / hidden)", () => {
  let app: ElectronApp;
  let work: string;
  let outside: string;
  let clip: string;
  let userData: string;

  const windowState = (): Promise<WindowState> =>
    app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().filter((w: any) => !w.isDestroyed());
      const w = wins[0];
      return { count: wins.length, minimized: w.isMinimized(), visible: w.isVisible(), focused: w.isFocused() };
    });

  const setWindow = (mode: "minimize" | "hide" | "blur" | "restore"): Promise<void> =>
    app.evaluate(({ BrowserWindow }, m) => {
      const w = BrowserWindow.getAllWindows().find((x: any) => !x.isDestroyed());
      if (m === "minimize") w.minimize();
      else if (m === "hide") w.hide();
      else if (m === "blur") w.blur();
      else {
        w.restore();
        w.show();
      }
    }, mode);

  beforeAll(async () => {
    if (!enabled) return;
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-win-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-outside-")));
    userData = path.join(work, "ud");
    fs.mkdirSync(path.join(work, "Footage"), { recursive: true });
    fs.mkdirSync(userData, { recursive: true });
    // The allowed-roots policy is read by the main process from userData: only <work> is allowed.
    fs.writeFileSync(path.join(userData, "mcp-policy.json"), JSON.stringify({ v: 1, allowedRoots: [work] }));

    clip = path.join(work, "Footage", "tone.mp4");
    execFileSync(
      FFMPEG,
      ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip],
    );
    fs.writeFileSync(path.join(outside, "secret.mp4"), fs.readFileSync(clip));
    fs.symlinkSync(path.join(outside, "secret.mp4"), path.join(work, "Footage", "link-out.mp4"));

    const endpointFile = path.join(work, "mcp-endpoint.json");
    const { _electron } = loadPlaywright();
    app = await _electron.launch({
      args: [desktopDir, `--user-data-dir=${userData}`],
      env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile, OPENREEL_FFMPEG_PATH: FFMPEG },
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
    // The renderer-bridge queues requests until the agent stack is ready, so this first call may take a moment.
    const list = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/list" });
    expect(list.result.tools.length).toBeGreaterThan(100);
  }, 180_000);

  afterAll(async () => {
    if (!enabled) return;
    try {
      app?.process().kill("SIGKILL");
    } catch {
      /* already gone */
    }
    for (const dir of [work, outside]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("registers the new tools and reports app state with no project and no focus on the window", async () => {
    const tools = (await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/list" })).result.tools as Array<{ name: string; inputSchema: any }>;
    const names = tools.map((tool) => tool.name);
    for (const name of ["import_media_from_path", "open_project_file", "save_project_as", "import_timeline_from_path", "get_export_options", "get_app_state", "dismiss_onboarding", "export_video", "queue_export"]) {
      expect(names, name).toContain(name);
    }
    const exportSchema = tools.find((tool) => tool.name === "export_video")!.inputSchema.properties;
    for (const key of ["format", "presetId", "codec", "bitDepth", "hdr", "width", "height", "frameRate", "bitrateKbps", "audioChannels", "timecode", "targetLufs", "truePeakCeilingDb", "outputPath", "overwrite"]) {
      expect(Object.keys(exportSchema), key).toContain(key);
    }

    await setWindow("minimize");
    await sleep(500);
    expect((await windowState()).minimized || !(await windowState()).visible).toBe(true);

    const state = await call("get_app_state");
    expect(state.isError, state.text).toBe(false);
    expect(state.data).toMatchObject({ projectOpen: false, projectId: null, mcp: { allowedRoots: [work], autoAllow: true } });
    expect(typeof state.data.appVersion).toBe("string");
    expect(state.data.windows.count).toBeGreaterThanOrEqual(1);
    expect(["welcome", "editor"]).toContain(state.data.route);
    expect(state.data.mcp.toolCount).toBe(names.length);
    expect(["unseen", "in-progress", "done", "skipped"]).toContain(state.data.onboarding.status);

    // Idempotent, and never a precondition.
    const first = await call("dismiss_onboarding");
    const second = await call("dismiss_onboarding");
    expect(first.isError, first.text).toBe(false);
    expect(second.data).toMatchObject({ changed: false });
    expect((await call("get_app_state")).data.onboarding.status).toMatch(/done|skipped/);
  }, 120_000);

  it("lists what this machine can export", async () => {
    const options = await call("get_export_options");
    expect(options.isError, options.text).toBe(false);
    const mp4 = options.data.formats.find((format: any) => format.id === "mp4");
    expect(mp4).toMatchObject({ available: true });
    expect(mp4.codecs).toContain("h264");
    expect(options.data.presets.map((preset: any) => preset.id)).toEqual(expect.arrayContaining(["mp4", "1080p-high"]));
    expect(options.data.audioLayouts).toEqual(["mono", "stereo", "5.1"]);
    expect(typeof options.data.hdr.supported).toBe("boolean");
  }, 60_000);

  it("refuses path tools without a project, then enforces the allowed-roots policy", async () => {
    const noProject = await call("import_media_from_path", { paths: [clip] });
    expect(noProject.isError).toBe(true);
    expect(noProject.code).toBe("NO_PROJECT");
    expect(noProject.text).toMatch(/create_project/);

    const created = await call("create_project", { name: "Windowless", width: 1280, height: 720, frameRate: 24 });
    expect(created.isError, created.text).toBe(false);
    await sleep(500);
    expect((await call("get_app_state")).data).toMatchObject({ projectOpen: true });

    const stat = (file: string) => fs.existsSync(file);
    const relative = await call("import_media_from_path", { paths: ["Footage/tone.mp4"] });
    expect(relative.code).toBe("INVALID_PARAMS");
    const outsideAbs = await call("import_media_from_path", { paths: [path.join(outside, "secret.mp4")] });
    expect(outsideAbs.isError).toBe(true);
    expect(outsideAbs.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    const traversal = await call("import_media_from_path", { paths: [path.join(work, "Footage", "..", "..", path.basename(outside), "secret.mp4")] });
    expect(traversal.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    const symlink = await call("import_media_from_path", { paths: [path.join(work, "Footage", "link-out.mp4")] });
    expect(symlink.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    const missing = await call("import_media_from_path", { paths: [path.join(work, "Footage", "missing.mp4")] });
    expect(missing.code).toBe("NOT_FOUND");
    expect(stat(path.join(outside, "secret.mp4"))).toBe(true);
    expect((await call("list_media")).text).not.toMatch(/secret/);

    const writeOutside = await call("save_project_as", { path: path.join(outside, "evil.oreel") });
    expect(writeOutside.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    expect(stat(path.join(outside, "evil.oreel"))).toBe(false);
  }, 120_000);

  let mediaId = "";
  it("imports the clip by path while the window is minimized and builds a timeline", async () => {
    await setWindow("minimize");
    const imported = await call("import_media_from_path", { paths: [path.join(work, "Footage")] });
    expect(imported.isError, imported.text).toBe(false);
    const entries = imported.data.imported as Array<any>;
    const tone = entries.find((entry) => entry.name === "tone.mp4");
    expect(tone, JSON.stringify(imported.data)).toBeTruthy();
    expect(tone).toMatchObject({ kind: "video", path: clip });
    expect(tone.durationSec).toBeGreaterThan(1.5);
    expect(tone.durationSec).toBeLessThan(2.6);
    expect(tone.width).toBe(320);
    // The symlink that leaves the root is reported as skipped, never imported.
    expect(imported.data.skipped.some((entry: any) => entry.code === "OUTSIDE_ALLOWED_ROOTS")).toBe(true);
    expect(entries.some((entry) => /link-out/.test(entry.name))).toBe(false);
    mediaId = tone.mediaId;

    let tracks = (await call("list_tracks")).data as any;
    let video = (Array.isArray(tracks) ? tracks : tracks?.tracks ?? []).find((track: any) => track.type === "video");
    if (!video) {
      expect((await call("add_track", { trackType: "video" })).isError).toBe(false);
      tracks = (await call("list_tracks")).data;
      video = (Array.isArray(tracks) ? tracks : tracks?.tracks ?? []).find((track: any) => track.type === "video");
    }
    expect(video, JSON.stringify(tracks)).toBeTruthy();
    const added = await call("add_clip", { trackId: video.id, mediaId, startTime: 0 });
    expect(added.isError, added.text).toBe(false);
    const clips = await call("list_clips");
    expect(clips.text).toContain(mediaId);
  }, 120_000);

  it("exports to an outputPath with the window minimized, and again hidden", async () => {
    await setWindow("minimize");
    await sleep(300);
    const state = await windowState();
    expect(state.minimized || !state.visible).toBe(true);

    const target = path.join(work, "out-minimized.mp4");
    const started = Date.now();
    const exported = await call("export_video", { outputPath: target });
    expect(exported.isError, exported.text).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
    const size = fs.statSync(target).size;
    expect(size).toBeGreaterThan(2_000);
    expect(exported.data.path).toBe(target);
    expect(exported.data.sizeBytes).toBe(size);
    expect(exported.data.sha256).toBe(sha256File(target));
    const info = probe(target, "stream=codec_name,width,height:format=duration");
    expect(info.codec_name).toBe("h264");
    expect(Number(info.duration)).toBeGreaterThan(1.5);
    console.info(`[mcp-windowless] minimized export: ${Date.now() - started} ms, ${size} bytes`);

    await setWindow("hide");
    await sleep(300);
    expect((await windowState()).visible).toBe(false);
    const hiddenTarget = path.join(work, "out-hidden.mp4");
    const hidden = await call("export_video", { outputPath: hiddenTarget });
    expect(hidden.isError, hidden.text).toBe(false);
    expect(fs.existsSync(hiddenTarget)).toBe(true);
    expect(hidden.data.sha256).toBe(sha256File(hiddenTarget));
    expect(Number(probe(hiddenTarget, "format=duration").duration)).toBeGreaterThan(1.5);

    // The default (no outputPath) still reports where the file is, plus size and hash.
    const defaultOut = await call("export_video", {});
    expect(defaultOut.isError, defaultOut.text).toBe(false);
    expect(fs.existsSync(defaultOut.data.path)).toBe(true);
    expect(defaultOut.data.sizeBytes).toBe(fs.statSync(defaultOut.data.path).size);
    expect(defaultOut.data.sha256).toBe(sha256File(defaultOut.data.path));
    fs.rmSync(defaultOut.data.path, { force: true });
  }, 300_000);

  it("refuses unsafe or invalid export destinations before rendering", async () => {
    const existing = path.join(work, "out-minimized.mp4");
    const before = sha256File(existing);
    const noOverwrite = await call("export_video", { outputPath: existing });
    expect(noOverwrite.code).toBe("INVALID_PARAMS");
    expect(noOverwrite.text).toMatch(/overwrite:true/);
    expect(sha256File(existing)).toBe(before);

    const outsidePath = path.join(outside, "stolen.mp4");
    const outsideExport = await call("export_video", { outputPath: outsidePath });
    expect(outsideExport.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    expect(fs.existsSync(outsidePath)).toBe(false);
    const queued = await call("queue_export", { outputPath: outsidePath });
    expect(queued.code).toBe("OUTSIDE_ALLOWED_ROOTS");

    const wrongExt = await call("export_video", { outputPath: path.join(work, "x.mov") });
    expect(wrongExt.code).toBe("INVALID_PARAMS");
    const symlinkDir = path.join(work, "linkdir");
    fs.symlinkSync(outside, symlinkDir);
    const viaLink = await call("export_video", { outputPath: path.join(symlinkDir, "x.mp4") });
    expect(viaLink.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    expect(fs.existsSync(path.join(outside, "x.mp4"))).toBe(false);
  }, 120_000);

  it("rejects unsupported export combinations with UNSUPPORTED and a hint that lists alternatives", async () => {
    const result = await call("export_video", { format: "mp4", codec: "h264", hdr: "pq" });
    expect(result.isError).toBe(true);
    expect(result.code).toBe("UNSUPPORTED");
    expect(result.text).toMatch(/h265/);
    const webm = await call("export_video", { format: "webm", bitDepth: 10 });
    expect(webm.code).toBe("UNSUPPORTED");
  }, 60_000);

  it("exports with extended options (size, frame rate, bitrate, preset) through the dialog's encoder path", async () => {
    await setWindow("blur");
    const target = path.join(work, "out-extended.mp4");
    const result = await call("export_video", { presetId: "mp4", width: 640, height: 360, frameRate: 24, bitrateKbps: 1500, audioChannels: "stereo", outputPath: target });
    expect(result.isError, result.text).toBe(false);
    expect(result.data.path).toBe(target);
    expect(result.data.sha256).toBe(sha256File(target));
    const info = probe(target, "stream=codec_name,width,height");
    expect(info).toMatchObject({ codec_name: "h264", width: "640", height: "360" });
  }, 300_000);

  it("exports HDR when the machine can (otherwise it is refused with the reason)", async () => {
    const options = await call("get_export_options");
    const target = path.join(work, "out-hdr.mp4");
    console.info(`[mcp-windowless] HDR export on this machine: ${options.data.hdr.supported ? "supported, exporting PQ" : `unsupported (${options.data.hdr.reason ?? "no reason"}), expecting a refusal`}`);
    if (!options.data.hdr.supported) {
      const refused = await call("export_video", { hdr: "pq", outputPath: target });
      expect(refused.code).toBe("UNSUPPORTED");
      expect(fs.existsSync(target)).toBe(false);
      return;
    }
    const result = await call("export_video", { hdr: "pq", codec: "h265", outputPath: target });
    expect(result.isError, result.text).toBe(false);
    const info = probe(target, "stream=codec_name,pix_fmt,color_transfer");
    expect(info.codec_name).toBe("hevc");
    expect(info.color_transfer).toBe("smpte2084");
    expect(info.pix_fmt).toMatch(/10/);
  }, 300_000);

  it("queue_export honours outputPath, hash and size while the window is hidden", async () => {
    await setWindow("hide");
    const target = path.join(work, "out-queued.mp4");
    const queued = await call("queue_export", { outputPath: target, filename: "queued.mp4" });
    expect(queued.isError, queued.text).toBe(false);
    const jobId = queued.data.jobId;
    let job: any;
    for (let i = 0; i < 600; i++) {
      const listing = await call("list_export_jobs");
      job = (listing.data.jobs as Array<any>).find((entry) => entry.id === jobId);
      if (job && ["completed", "failed", "cancelled"].includes(job.status)) break;
      await sleep(500);
    }
    expect(job?.status, JSON.stringify(job)).toBe("completed");
    expect(job.outputPath).toBe(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(job.sha256).toBe(sha256File(target));
    expect(job.outputBytes).toBe(fs.statSync(target).size);
  }, 300_000);

  it("saves the project to a file, reopens it, and imports a timeline file by path", async () => {
    await setWindow("restore");
    await setWindow("minimize");
    const projectFile = path.join(work, "Windowless.oreel");
    const saved = await call("save_project_as", { path: projectFile });
    expect(saved.isError, saved.text).toBe(false);
    expect(fs.existsSync(projectFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(projectFile, "utf8")).name ?? JSON.parse(fs.readFileSync(projectFile, "utf8")).project?.name).toBe("Windowless");
    const refuse = await call("save_project_as", { path: projectFile });
    expect(refuse.code).toBe("INVALID_PARAMS");
    expect((await call("save_project_as", { path: projectFile, overwrite: true })).isError).toBe(false);

    const timeline = await call("export_timeline_xml", { format: "otio" });
    expect(timeline.isError, timeline.text).toBe(false);
    const otioFile = path.join(work, "cut.otio");
    fs.writeFileSync(otioFile, timeline.data.files[0].content);

    const other = await call("create_project", { name: "Other" });
    expect(other.isError, other.text).toBe(false);
    const opened = await call("open_project_file", { path: projectFile });
    expect(opened.isError, opened.text).toBe(false);
    expect(opened.data).toMatchObject({ name: "Windowless", path: projectFile });
    const state = await call("get_app_state");
    expect(state.data.projectId).toBe(opened.data.id);

    const dry = await call("import_timeline_from_path", { path: otioFile, dryRun: true });
    expect(dry.isError, dry.text).toBe(false);
    expect(dry.data).toMatchObject({ format: "otio", applied: false });
    const imported = await call("import_timeline_from_path", { path: otioFile });
    expect(imported.isError, imported.text).toBe(false);
    expect(imported.data).toMatchObject({ format: "otio", applied: true });
    const outsideTimeline = path.join(outside, "x.otio");
    fs.writeFileSync(outsideTimeline, "{}");
    expect((await call("import_timeline_from_path", { path: outsideTimeline })).code).toBe("OUTSIDE_ALLOWED_ROOTS");
    expect((await call("open_project_file", { path: path.join(outside, "p.oreel") })).code).toBe("OUTSIDE_ALLOWED_ROOTS");

    const recents = await call("list_projects");
    expect(recents.text).toContain(projectFile);
  }, 180_000);
});
