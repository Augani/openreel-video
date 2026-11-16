import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "@openreel/agent";
import type { MediaItem } from "@openreel/core/types/project";
import { useProjectStore } from "../../stores/project-store";
import { useOnboardingStore } from "../../stores/onboarding-store";
import { LiveEditorHost } from "./live-host";
import { routeFromHash } from "./app-state";
import { projectManager } from "../project-manager";

type OpenReel = NonNullable<Window["openreel"]>;

const ROOT = "/Users/me/Movies";

/** A tiny in-memory disk plus the allowed-roots rule of the main process (prefix check, no symlinks here: main tests cover those). */
function installFakeDesktop(files: Record<string, string | Uint8Array>) {
  const disk = new Map<string, string | Uint8Array>(Object.entries(files));
  const resolveFiles = vi.fn(async (args: { paths: string[]; mode?: "read" | "write"; recursive?: boolean }) => {
    const resolved: Array<{ path: string; realPath: string; kind: "file"; sizeBytes: number; exists: boolean }> = [];
    const rejected: Array<{ path: string; code: "OUTSIDE_ALLOWED_ROOTS" | "NOT_FOUND" | "INVALID_PARAMS"; message: string }> = [];
    for (const path of args.paths) {
      if (!path.startsWith("/")) rejected.push({ path, code: "INVALID_PARAMS", message: "absolute only" });
      else if (!path.startsWith(`${ROOT}/`)) rejected.push({ path, code: "OUTSIDE_ALLOWED_ROOTS", message: "Outside the allowed folders" });
      else if (args.mode === "write") resolved.push({ path, realPath: path, kind: "file", sizeBytes: 0, exists: disk.has(path) });
      else if (args.recursive || disk.has(path)) {
        const hits = disk.has(path) ? [path] : [...disk.keys()].filter((key) => key.startsWith(`${path}/`));
        if (hits.length === 0) rejected.push({ path, code: "NOT_FOUND", message: "No file" });
        for (const hit of hits) resolved.push({ path: hit, realPath: hit, kind: "file", sizeBytes: String(disk.get(hit)).length, exists: true });
      } else rejected.push({ path, code: "NOT_FOUND", message: "No file" });
    }
    return { resolved, rejected };
  });
  const openreel = {
    platform: "desktop",
    fs: {
      readFile: vi.fn(async (path: string) => String(disk.get(path))),
      readFileBytes: vi.fn(async (path: string) => {
        const value = disk.get(path);
        return (value instanceof Uint8Array ? value : new TextEncoder().encode(String(value))).buffer;
      }),
      writeFile: vi.fn(async (path: string, data: string) => void disk.set(path, data)),
    },
    mcp: {
      resolveFiles,
      getAppInfo: vi.fn(async () => ({ appVersion: "9.9.9", platform: "darwin", windowCount: 1, editorWindow: true, protocolVersion: "2025-06-18" })),
      getPolicy: vi.fn(async () => ({ allowedRoots: [ROOT], defaultRoots: [ROOT] })),
    },
  };
  (window as unknown as { openreel: unknown }).openreel = openreel;
  return { disk, openreel: openreel as unknown as OpenReel, resolveFiles };
}

afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
  vi.restoreAllMocks();
});

describe("LiveEditorHost save_project_as / open_project_file", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Round trip");
    // jsdom has no usable IndexedDB: the autosave that precedes replacing a project, and the recents
    // database, would never settle.
    useProjectStore.setState({ forceSave: async () => undefined });
    vi.spyOn(projectManager, "ensureInitialized").mockResolvedValue(undefined);
  });

  it("writes the project to the path, refuses to overwrite by default, and reopens it", async () => {
    const { disk } = installFakeDesktop({});
    const host = new LiveEditorHost();
    const path = `${ROOT}/cut.oreel`;

    const saved = await executeTool("save_project_as", { path }, host);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(saved.data).toMatchObject({ name: "Round trip", path });
    expect(JSON.parse(String(disk.get(path))).name).toBe("Round trip");

    const again = await executeTool("save_project_as", { path }, host);
    expect(again.error).toMatchObject({ code: "INVALID_PARAMS" });
    expect(again.error?.hint).toMatch(/overwrite:true/);
    expect((await executeTool("save_project_as", { path, overwrite: true }, host)).ok).toBe(true);

    useProjectStore.getState().createNewProject("Something else");
    const opened = await executeTool("open_project_file", { path }, host);
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    expect(opened.data).toMatchObject({ name: "Round trip", path });
    expect(useProjectStore.getState().project.name).toBe("Round trip");
  });

  it("refuses paths outside the allowed roots without touching the disk", async () => {
    const { disk, openreel } = installFakeDesktop({});
    const host = new LiveEditorHost();
    const save = await executeTool("save_project_as", { path: "/etc/evil.oreel" }, host);
    expect(save.error).toMatchObject({ code: "OUTSIDE_ALLOWED_ROOTS" });
    expect(save.error?.hint).toMatch(/allowed folder/i);
    expect(openreel.fs.writeFile).not.toHaveBeenCalled();
    expect(disk.size).toBe(0);
    const open = await executeTool("open_project_file", { path: "/etc/evil.oreel" }, host);
    expect(open.error).toMatchObject({ code: "OUTSIDE_ALLOWED_ROOTS" });
  });

  it("reports NOT_FOUND for a missing file and UNSUPPORTED_TYPE for a file that is not a project", async () => {
    installFakeDesktop({ [`${ROOT}/notes.json`]: "{\"hello\":1}" });
    const host = new LiveEditorHost();
    expect((await executeTool("open_project_file", { path: `${ROOT}/missing.oreel` }, host)).error?.code).toBe("NOT_FOUND");
    const notProject = await executeTool("open_project_file", { path: `${ROOT}/notes.json` }, host);
    expect(notProject.error?.code).toBe("UNSUPPORTED_TYPE");
    expect(notProject.error?.hint).toMatch(/\.oreel/);
  });

  it("save_project_as refuses non-project extensions so overwrite cannot clobber other files", async () => {
    const { disk } = installFakeDesktop({ [`${ROOT}/settings.json`]: "{}" });
    const host = new LiveEditorHost();
    const result = await executeTool("save_project_as", { path: `${ROOT}/settings.json`, overwrite: true }, host);
    expect(result.error).toMatchObject({ code: "UNSUPPORTED_TYPE" });
    expect(disk.get(`${ROOT}/settings.json`)).toBe("{}");
  });

  it("save_project_as needs an open project", async () => {
    installFakeDesktop({});
    useProjectStore.setState({ hasOpenProject: false });
    const result = await executeTool("save_project_as", { path: `${ROOT}/x.oreel` }, new LiveEditorHost());
    expect(result.error).toMatchObject({ code: "NO_PROJECT" });
  });

  it("is UNSUPPORTED without the desktop bridge", async () => {
    const host = new LiveEditorHost();
    const result = await executeTool("open_project_file", { path: `${ROOT}/x.oreel` }, host);
    expect(result.error?.code).toBe("UNSUPPORTED");
  });
});

describe("LiveEditorHost import_media_from_path", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Import");
  });

  function fakeImport() {
    return vi.spyOn(useProjectStore.getState(), "importMedia").mockImplementation(async (file: File) => {
      const id = `media-${file.name}`;
      const item: MediaItem = {
        id,
        name: file.name,
        type: file.type.startsWith("audio") ? "audio" : "video",
        fileHandle: null,
        blob: file,
        metadata: { duration: 4.5, width: 1280, height: 720, frameRate: 24, codec: "h264", sampleRate: 48000, channels: 2, fileSize: file.size },
        thumbnailUrl: null,
        waveformData: null,
        sourceFile: { name: file.name, size: file.size, lastModified: 0 },
      };
      useProjectStore.setState((state) => ({
        project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items: [...state.project.mediaLibrary.items, item] } },
      }));
      return { success: true, actionId: id };
    });
  }

  it("imports files and folders under the roots, returns probed metadata and records the disk path", async () => {
    installFakeDesktop({
      [`${ROOT}/a.mp4`]: "video-a",
      [`${ROOT}/shoot/b.mov`]: "video-b",
      [`${ROOT}/shoot/notes.txt`]: "text",
    });
    const spy = fakeImport();
    const host = new LiveEditorHost();
    const result = await executeTool("import_media_from_path", { paths: [`${ROOT}/a.mp4`, `${ROOT}/shoot`, "/etc/passwd"], recursive: true }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const data = result.data as { imported: Array<Record<string, unknown>>; skipped: Array<{ path: string; code: string }> };
    expect(data.imported.map((entry) => entry.name)).toEqual(["a.mp4", "b.mov"]);
    expect(data.imported[0]).toMatchObject({ kind: "video", durationSec: 4.5, width: 1280, height: 720, frameRate: 24, codec: "h264" });
    expect(data.skipped.map((entry) => entry.code).sort()).toEqual(["OUTSIDE_ALLOWED_ROOTS", "UNSUPPORTED_TYPE"]);
    expect(spy).toHaveBeenCalledTimes(2);
    const item = useProjectStore.getState().project.mediaLibrary.items.find((entry) => entry.name === "a.mp4");
    expect(item?.sourceFile?.path).toBe(`${ROOT}/a.mp4`);
  });

  it("returns the policy rejection when nothing could be imported", async () => {
    installFakeDesktop({});
    fakeImport();
    const result = await executeTool("import_media_from_path", { paths: ["/etc/passwd"] }, new LiveEditorHost());
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "OUTSIDE_ALLOWED_ROOTS" });
    expect((result.data as { skipped: unknown[] }).skipped).toHaveLength(1);
  });

  it("files imported items in a named bin", async () => {
    installFakeDesktop({ [`${ROOT}/a.mp4`]: "video-a" });
    fakeImport();
    const host = new LiveEditorHost();
    const made = await executeTool("create_bin", { name: "Day 1" }, host);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const result = await executeTool("import_media_from_path", { paths: [`${ROOT}/a.mp4`], bin: "day 1" }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const item = useProjectStore.getState().project.mediaLibrary.items.find((entry) => entry.name === "a.mp4");
    expect(item?.binId).toBe((made.data as { binId: string }).binId);
    const missing = await executeTool("import_media_from_path", { paths: [`${ROOT}/a.mp4`], bin: "Nope" }, host);
    expect(missing.error).toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("answers NO_PROJECT with a create_project hint", async () => {
    installFakeDesktop({ [`${ROOT}/a.mp4`]: "x" });
    useProjectStore.setState({ hasOpenProject: false });
    const result = await executeTool("import_media_from_path", { paths: [`${ROOT}/a.mp4`] }, new LiveEditorHost());
    expect(result.error).toMatchObject({ code: "NO_PROJECT" });
    expect(result.error?.hint).toMatch(/create_project/);
  });
});

describe("LiveEditorHost get_app_state / dismiss_onboarding", () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it("reports app, route, project, onboarding and the allowed roots", async () => {
    installFakeDesktop({});
    useProjectStore.setState({ hasOpenProject: false });
    window.location.hash = "#/welcome";
    const result = await executeTool("get_app_state", {}, new LiveEditorHost());
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      appVersion: "9.9.9",
      platform: "darwin",
      route: "welcome",
      windows: { editor: true, count: 1 },
      projectOpen: false,
      projectId: null,
      onboarding: { status: "unseen", path: null, skippedBy: null },
      mcp: { allowedRoots: [ROOT], autoAllow: true, protocolVersion: "2025-06-18" },
    });
    expect((result.data as { mcp: { toolCount: number } }).mcp.toolCount).toBeGreaterThan(300);
  });

  it("dismiss_onboarding marks it skipped by the agent, once", async () => {
    installFakeDesktop({});
    const host = new LiveEditorHost();
    const first = await executeTool("dismiss_onboarding", {}, host);
    expect(first.data).toEqual({ status: "skipped", changed: true });
    expect(useOnboardingStore.getState()).toMatchObject({ status: "skipped", skippedBy: "agent" });
    const second = await executeTool("dismiss_onboarding", {}, host);
    expect(second.data).toEqual({ status: "skipped", changed: false });
    const state = await executeTool("get_app_state", {}, host);
    expect(state.data).toMatchObject({ onboarding: { status: "skipped", skippedBy: "agent" } });
  });

  it("closes an open sheet and counts that as a change", async () => {
    installFakeDesktop({});
    useOnboardingStore.setState({ status: "done", openSheet: "agent" });
    const result = await executeTool("dismiss_onboarding", {}, new LiveEditorHost());
    expect(result.data).toEqual({ status: "done", changed: true });
    expect(useOnboardingStore.getState().openSheet).toBeNull();
  });

  it("maps hashes to route names", () => {
    expect(routeFromHash("")).toBe("welcome");
    expect(routeFromHash("#/")).toBe("welcome");
    expect(routeFromHash("#/editor")).toBe("editor");
    expect(routeFromHash("#/editor?x=1")).toBe("editor");
  });
});
