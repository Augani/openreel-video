import { describe, expect, it } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeEmptyProject, makeProjectWithClip } from "./test-fixtures";
import {
  HostFileError,
  type EditingHost,
  type FileAccessResolveResult,
  type ImportMediaFromPathOptions,
  type LocalFileAccess,
} from "./host";

const ref = (path: string, mediaId = "m1") => ({
  mediaId,
  path,
  name: path.split("/").pop() as string,
  kind: "video" as const,
  durationSec: 4,
  width: 1920,
  height: 1080,
  frameRate: 30,
  codec: "h264",
});

function hostWith(extra: Partial<EditingHost>): { host: EditingHost; calls: unknown[] } {
  const calls: unknown[] = [];
  const base = new HeadlessHost(makeEmptyProject());
  const host = Object.assign(base, extra) as EditingHost;
  return { host, calls };
}

describe("path tools registration", () => {
  it("registers the four tools over MCP with the right flags", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    for (const name of ["import_media_from_path", "open_project_file", "save_project_as", "import_timeline_from_path"]) {
      expect(getTool(name), name).toBeDefined();
      expect(mcp.has(name), name).toBe(true);
    }
    expect(getTool("import_media_from_path")).toMatchObject({ readOnly: false, destructive: false, expensive: true });
    expect(getTool("open_project_file")).toMatchObject({ destructive: true });
    expect(getTool("import_timeline_from_path")).toMatchObject({ destructive: true });
    expect(getTool("save_project_as")).toMatchObject({ destructive: false, readOnly: false });
  });

  it("describes the import schema per the spec (paths 1..500, absolute)", () => {
    const schema = getTool("import_media_from_path")!.inputSchema as {
      properties: Record<string, { minItems?: number; maxItems?: number }>;
      required: string[];
    };
    expect(schema.required).toEqual(["paths"]);
    expect(schema.properties.paths).toMatchObject({ minItems: 1, maxItems: 500 });
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["recursive", "copyToProject", "ingestPreset", "createProxies", "bin"]));
  });
});

describe("import_media_from_path", () => {
  it("answers UNSUPPORTED with a hint on a host without file access", async () => {
    const result = await executeTool("import_media_from_path", { paths: ["/a/b.mp4"] }, new HeadlessHost(makeEmptyProject()));
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "UNSUPPORTED" });
    expect(result.error?.hint).toBeTruthy();
  });

  it("rejects bad arguments as INVALID_PARAMS before touching the host", async () => {
    const seen: ImportMediaFromPathOptions[] = [];
    const { host } = hostWith({ importMediaFromPath: async (o) => (seen.push(o), { imported: [], skipped: [] }) });
    for (const args of [{}, { paths: [] }, { paths: [1] }, { paths: ["relative/x.mp4"] }, { paths: ["/a.mp4"], ingestPreset: "bogus" }, { paths: ["/a.mp4"], recursive: "yes" }]) {
      const result = await executeTool("import_media_from_path", args as Record<string, unknown>, host);
      expect(result.error?.code, JSON.stringify(args)).toBe("INVALID_PARAMS");
    }
    expect(seen).toEqual([]);
  });

  it("reports NO_PROJECT with a create_project hint", async () => {
    const { host } = hostWith({
      importMediaFromPath: async () => ({ imported: [], skipped: [] }),
      requireOpenProject: () => {
        throw new Error("No project is open");
      },
    });
    const result = await executeTool("import_media_from_path", { paths: ["/a/b.mp4"] }, host);
    expect(result.error).toMatchObject({ code: "NO_PROJECT" });
    expect(result.error?.hint).toMatch(/create_project/);
  });

  it("passes options through and returns the imported/skipped result shape", async () => {
    const seen: ImportMediaFromPathOptions[] = [];
    const { host } = hostWith({
      importMediaFromPath: async (options) => {
        seen.push(options);
        return {
          imported: [ref("/Users/me/Movies/a.mp4")],
          skipped: [{ path: "/Users/me/Movies/notes.txt", code: "UNSUPPORTED_TYPE", message: "Not media" }],
        };
      },
    });
    const result = await executeTool(
      "import_media_from_path",
      { paths: ["/Users/me/Movies/a.mp4", "/Users/me/Movies/notes.txt"], recursive: true, copyToProject: true, ingestPreset: "proxies", createProxies: true, bin: "Day 1" },
      host,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(seen[0]).toEqual({
      paths: ["/Users/me/Movies/a.mp4", "/Users/me/Movies/notes.txt"],
      recursive: true,
      copyToProject: true,
      ingestPreset: "proxies",
      createProxies: true,
      bin: "Day 1",
    });
    const data = result.data as { imported: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>> };
    expect(data.imported[0]).toMatchObject({ mediaId: "m1", kind: "video", durationSec: 4, width: 1920, height: 1080, frameRate: 30, codec: "h264" });
    expect(data.skipped[0]).toMatchObject({ code: "UNSUPPORTED_TYPE" });
    expect(result.summary).toMatch(/Imported 1 file\(s\), 1 skipped/);
  });

  it("fails with the first skipped code (and keeps the list) when nothing imported", async () => {
    const { host } = hostWith({
      importMediaFromPath: async () => ({
        imported: [],
        skipped: [{ path: "/etc/passwd", code: "OUTSIDE_ALLOWED_ROOTS", message: "Outside the allowed folders" }],
      }),
    });
    const result = await executeTool("import_media_from_path", { paths: ["/etc/passwd"] }, host);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "OUTSIDE_ALLOWED_ROOTS" });
    expect(result.error?.hint).toMatch(/allowed folder/i);
    expect((result.data as { skipped: unknown[] }).skipped).toHaveLength(1);
  });

  it("maps a thrown HostFileError to its code and hint", async () => {
    const { host } = hostWith({
      importMediaFromPath: async () => {
        throw new HostFileError("UNREADABLE", "Permission denied", "chmod the file");
      },
    });
    const result = await executeTool("import_media_from_path", { paths: ["/a.mp4"] }, host);
    expect(result.error).toEqual({ code: "UNREADABLE", message: "Permission denied", hint: "chmod the file" });
  });
});

describe("open_project_file and save_project_as", () => {
  it("open_project_file validates the path and extension, then returns the ref", async () => {
    const opened: string[] = [];
    const { host } = hostWith({
      openProjectFile: async (path) => (opened.push(path), { id: "p1", name: "Edit", path }),
    });
    expect((await executeTool("open_project_file", { path: "rel/x.oreel" }, host)).error?.code).toBe("INVALID_PARAMS");
    expect((await executeTool("open_project_file", { path: "/a/video.mp4" }, host)).error?.code).toBe("UNSUPPORTED_TYPE");
    const ok = await executeTool("open_project_file", { path: "/Users/me/Documents/Edit.oreel" }, host);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(ok.data).toMatchObject({ id: "p1", path: "/Users/me/Documents/Edit.oreel" });
    expect(opened).toEqual(["/Users/me/Documents/Edit.oreel"]);
  });

  it("open_project_file surfaces NOT_FOUND and OUTSIDE_ALLOWED_ROOTS from the host", async () => {
    const { host } = hostWith({
      openProjectFile: async (path) => {
        throw path.includes("missing") ? new HostFileError("NOT_FOUND", "No file there") : new HostFileError("OUTSIDE_ALLOWED_ROOTS", "Outside");
      },
    });
    expect((await executeTool("open_project_file", { path: "/Users/me/missing.oreel" }, host)).error).toMatchObject({ code: "NOT_FOUND" });
    const outside = await executeTool("open_project_file", { path: "/etc/x.oreel" }, host);
    expect(outside.error?.code).toBe("OUTSIDE_ALLOWED_ROOTS");
    expect(outside.error?.hint).toBeTruthy();
  });

  it("save_project_as forwards overwrite (default false) and needs a project", async () => {
    const saves: Array<[string, boolean]> = [];
    const { host } = hostWith({
      saveProjectAs: async (path, options) => (saves.push([path, options.overwrite]), { id: "p1", name: "Edit", path, sizeBytes: 10 }),
    });
    expect((await executeTool("save_project_as", { path: "/a/b.txt" }, host)).error?.code).toBe("UNSUPPORTED_TYPE");
    await executeTool("save_project_as", { path: "/a/b.oreel" }, host);
    await executeTool("save_project_as", { path: "/a/c.openreel", overwrite: true }, host);
    expect(saves).toEqual([["/a/b.oreel", false], ["/a/c.openreel", true]]);

    const closed = hostWith({
      saveProjectAs: async () => ({ id: "x", name: "x", path: "/a/b.oreel" }),
      requireOpenProject: () => {
        throw new Error("No project is open");
      },
    }).host;
    expect((await executeTool("save_project_as", { path: "/a/b.oreel" }, closed)).error?.code).toBe("NO_PROJECT");
  });

  it("an existing file without overwrite surfaces as INVALID_PARAMS from the host", async () => {
    const { host } = hostWith({
      saveProjectAs: async () => {
        throw new HostFileError("INVALID_PARAMS", "A file already exists", "Pass overwrite:true");
      },
    });
    const result = await executeTool("save_project_as", { path: "/a/b.oreel" }, host);
    expect(result.error).toMatchObject({ code: "INVALID_PARAMS", hint: "Pass overwrite:true" });
  });
});

describe("import_timeline_from_path", () => {
  function setup(otio: string | Uint8Array, resolve?: LocalFileAccess["resolve"]) {
    const project = makeProjectWithClip() as Project;
    (project.mediaLibrary as { items: unknown[] }).items = [
      { id: "m1", name: "Interview.mp4", type: "video", blob: null, fileHandle: null, metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, channels: 2, sampleRate: 48000 } },
    ];
    const history = new ActionHistory();
    const host = new HeadlessHost(project, { history });
    const bytes = typeof otio === "string" ? new TextEncoder().encode(otio) : otio;
    const files: LocalFileAccess = {
      resolve:
        resolve ??
        (async (paths): Promise<FileAccessResolveResult> => ({
          resolved: paths.map((p) => ({ path: p, realPath: p, kind: "file" as const, sizeBytes: bytes.length })),
          rejected: [],
        })),
      readBytes: async () => bytes,
    };
    return { host: Object.assign(host, { files }) as EditingHost & HeadlessHost, history };
  }

  async function exportOtio(): Promise<string> {
    const { host } = setup("");
    const exported = await executeTool("export_timeline_xml", { format: "otio" }, host);
    return (exported.data as { files: { content: string }[] }).files[0].content;
  }

  it("imports an OTIO file by path as one undo step and reports the format", async () => {
    const otio = await exportOtio();
    const { host, history } = setup(otio);
    const result = await executeTool("import_timeline_from_path", { path: "/Users/me/Documents/cut.otio" }, host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.data).toMatchObject({ format: "otio", applied: true, mode: "replace", path: "/Users/me/Documents/cut.otio" });
    expect(history.getUndoStackSize()).toBe(1);
  });

  it("supports dryRun and refuses a mismatching explicit format", async () => {
    const otio = await exportOtio();
    const { host, history } = setup(otio);
    const dry = await executeTool("import_timeline_from_path", { path: "/a/cut.otio", dryRun: true }, host);
    expect(dry.data).toMatchObject({ applied: false, format: "otio" });
    expect(history.getUndoStackSize()).toBe(0);
    const wrong = await executeTool("import_timeline_from_path", { path: "/a/cut.otio", format: "xmeml" }, host);
    expect(wrong.error?.code).toBe("INVALID_PARAMS");
    expect(wrong.error?.hint).toMatch(/otio/);
  });

  it("rejects EDL, relative paths, garbage files and policy rejections with stable codes", async () => {
    const { host } = setup("not a timeline");
    expect((await executeTool("import_timeline_from_path", { path: "/a/cut.edl" }, host)).error?.code).toBe("UNSUPPORTED");
    expect((await executeTool("import_timeline_from_path", { path: "/a/x.otio", format: "edl" }, host)).error?.code).toBe("UNSUPPORTED");
    expect((await executeTool("import_timeline_from_path", { path: "cut.otio" }, host)).error?.code).toBe("INVALID_PARAMS");
    expect((await executeTool("import_timeline_from_path", { path: "/a/junk.xml" }, host)).error?.code).toBe("UNSUPPORTED_TYPE");

    const denied = setup("{}", async (paths) => ({
      resolved: [],
      rejected: paths.map((path) => ({ path, code: "OUTSIDE_ALLOWED_ROOTS" as const, message: "Outside the allowed folders" })),
    }));
    const outside = await executeTool("import_timeline_from_path", { path: "/etc/cut.otio" }, denied.host);
    expect(outside.error).toMatchObject({ code: "OUTSIDE_ALLOWED_ROOTS" });
    expect(denied.history.getUndoStackSize()).toBe(0);
  });

  it("answers UNSUPPORTED without a file-access host", async () => {
    const result = await executeTool("import_timeline_from_path", { path: "/a/cut.otio" }, new HeadlessHost(makeEmptyProject()));
    expect(result.error?.code).toBe("UNSUPPORTED");
  });
});

describe("create_shape_clip path geometry", () => {
  it("forwards pathData, points and closed to the host", async () => {
    const seen: unknown[] = [];
    const { host } = hostWith({
      createShapeOverlay: async (options) => {
        seen.push(options);
        return { id: "s1", trackId: "t1" };
      },
    });
    const result = await getTool("create_shape_clip")!.handler(
      {
        clip: {
          shapeType: "path",
          startTime: 0,
          duration: 2,
          pathData: "M 0 0 L 1 1",
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          closed: false,
        },
      },
      host,
    );
    expect(result.ok).toBe(true);
    expect(seen[0]).toMatchObject({
      shapeType: "path",
      pathData: "M 0 0 L 1 1",
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      closed: false,
    });
  });

  it("drops malformed points", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { host } = hostWith({
      createShapeOverlay: async (options) => {
        seen.push(options as unknown as Record<string, unknown>);
        return { id: "s1", trackId: "t1" };
      },
    });
    await getTool("create_shape_clip")!.handler(
      { clip: { shapeType: "path", startTime: 0, duration: 1, points: [{ x: 0 }] } },
      host,
    );
    expect(seen[0]).not.toHaveProperty("points");
  });
});
