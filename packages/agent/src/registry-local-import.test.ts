import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool, isExpensive } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import type { EditingHost, ImportedMediaRef } from "./host";
import type { Project } from "@openreel/core/types/project";

function hostWithPathImport(calls: Array<{ path: string; name?: string }>): EditingHost {
  const base = new HeadlessHost(makeEmptyProject());
  return Object.assign(base, {
    async importMediaFromPath(path: string, options?: { name?: string }): Promise<ImportedMediaRef> {
      calls.push({ path, name: options?.name });
      return { mediaId: "m9", name: options?.name ?? "clip.mp4", type: "video", durationSec: 4 };
    },
  });
}

describe("import_media_from_path", () => {
  it("is registered, and gated behind confirmation because it reads local files", () => {
    const tool = getTool("import_media_from_path");
    expect(tool).toBeDefined();
    expect(tool?.readOnly).toBe(false);
    expect(isExpensive("import_media_from_path")).toBe(true);
  });

  it("reports UNSUPPORTED on a host without importMediaFromPath", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("import_media_from_path", { path: "C:\\media\\a.mp4" }, host);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("UNSUPPORTED");
  });

  it.each(["clip.mp4", "media/clip.mp4", "..\\clip.mp4", ""])(
    "rejects the non-absolute path %j without touching the disk",
    async (path) => {
      const calls: Array<{ path: string }> = [];
      const res = await executeTool("import_media_from_path", { path }, hostWithPathImport(calls));
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("INVALID_PARAMS");
      expect(calls).toHaveLength(0);
    },
  );

  it.each(["C:\\secrets\\id_rsa", "/home/u/.env", "C:\\a\\notes.txt", "/tmp/archive.mp4.zip"])(
    "rejects the non-media file %j without touching the disk",
    async (path) => {
      const calls: Array<{ path: string }> = [];
      const res = await executeTool("import_media_from_path", { path }, hostWithPathImport(calls));
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("INVALID_PARAMS");
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    "\\\\attacker.example.com\\share\\bait.mp4",
    "\\\\?\\C:\\media\\a.mp4",
    "\\\\.\\PhysicalDrive0.mp4",
    "C:\\Users\\u\\secrets.txt:x.mp4",
    "C:\\media\\secret.txt .mp4.",
  ])("rejects the network, device, stream or trailing-dot path %j", async (path) => {
    const calls: Array<{ path: string }> = [];
    const res = await executeTool("import_media_from_path", { path }, hostWithPathImport(calls));
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
    expect(calls).toHaveLength(0);
  });

  it.each(["C:\\media\\a.MP4", "D:/footage/b.wav", "/Users/u/c.png"])(
    "imports the absolute media path %j",
    async (path) => {
      const calls: Array<{ path: string; name?: string }> = [];
      const res = await executeTool(
        "import_media_from_path",
        { path, name: "Bed" },
        hostWithPathImport(calls),
      );
      expect(res.ok).toBe(true);
      expect(calls).toEqual([{ path, name: "Bed" }]);
      expect((res.data as ImportedMediaRef).mediaId).toBe("m9");
    },
  );
});

describe("list_overlays", () => {
  function projectWithOverlays(): Project {
    const empty = makeEmptyProject() as unknown as Record<string, unknown>;
    return {
      ...empty,
      timeline: {
        ...(empty.timeline as object),
        subtitles: [{ id: "s1", text: "Hello there", startTime: 1, endTime: 2.5 }],
      },
      textClips: [
        { id: "t1", trackId: "tt", startTime: 0.5, duration: 3, text: "Title", style: {}, transform: {}, keyframes: [] },
      ],
    } as unknown as Project;
  }

  it("is a read-only tool", () => {
    expect(getTool("list_overlays")?.readOnly).toBe(true);
  });

  it("lists text clips and subtitles with their timings in seconds", async () => {
    const res = await executeTool("list_overlays", {}, new HeadlessHost(projectWithOverlays()));
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({
      textClips: [{ id: "t1", trackId: "tt", text: "Title", startSec: 0.5, endSec: 3.5, durationSec: 3 }],
      subtitles: [{ id: "s1", text: "Hello there", startSec: 1, endSec: 2.5, durationSec: 1.5 }],
    });
  });

  it("returns empty lists for a project with no overlays", async () => {
    const res = await executeTool("list_overlays", {}, new HeadlessHost(makeEmptyProject()));
    expect(res.data).toEqual({ textClips: [], subtitles: [] });
  });
});
