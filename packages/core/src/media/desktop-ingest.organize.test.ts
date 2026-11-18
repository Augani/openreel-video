import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { ProjectSerializer } from "../storage/project-serializer";
import type { Action } from "../types/actions";
import type { MediaItem, Project } from "../types/project";

const item = (): MediaItem => ({
  id: "a",
  name: "a.mov",
  type: "video",
  fileHandle: null,
  blob: null,
  metadata: { duration: 10, width: 3840, height: 2160, frameRate: 30, codec: "prores", sampleRate: 48000, channels: 2, fileSize: 1000 },
  thumbnailUrl: null,
  waveformData: null,
  sourceFile: { name: "a.mov", size: 1000, lastModified: 1, path: "/orig/a.mov" },
});
const project = (): Project =>
  ({
    id: "p",
    name: "P",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [item()] },
    timeline: { duration: 0, tracks: [], subtitles: [], markers: [] },
  }) as unknown as Project;
const act = (params: Record<string, unknown>): Action => ({ type: "media/organize", id: `a-${Math.random()}`, timestamp: 0, params });

describe("media/organize desktop ingest", () => {
  it("sets the per-project config and undoes it in one step", async () => {
    const p = project();
    const executor = new ActionExecutor();
    expect((await executor.execute(act({ desktopIngest: { proxyProfile: { codec: "prores-proxy", size: "half" } } }), p)).success).toBe(true);
    expect((await executor.execute(act({ desktopIngest: { proxyProfile: { codec: "prores-proxy", size: "half" }, concurrency: 2 } }), p)).success).toBe(true);
    expect(p.mediaLibrary.desktopIngest).toEqual({ proxyProfile: { codec: "prores-proxy", size: "half" }, concurrency: 2 });
    await executor.undo(p);
    expect(p.mediaLibrary.desktopIngest).toEqual({ proxyProfile: { codec: "prores-proxy", size: "half" } });
    await executor.undo(p);
    expect(p.mediaLibrary.desktopIngest).toBeUndefined();
    await executor.redo(p);
    expect(p.mediaLibrary.desktopIngest?.proxyProfile?.codec).toBe("prores-proxy");
    expect((await executor.execute(act({ desktopIngest: { concurrency: 5 } }), p)).success).toBe(false);
  });

  it("rewrites the source reference to a copy and undoes it as one step", async () => {
    const p = project();
    const executor = new ActionExecutor();
    const copy = { name: "a.mov", size: 1000, lastModified: 1, path: "/proj/Media/a.mov" };
    const result = await executor.execute(
      act({ label: "Copy media", itemPatches: { a: { sourceFile: copy, copiedFrom: { path: "/orig/a.mov", sha256: "ab", copiedAt: 5 } } } }),
      p,
    );
    expect(result.success).toBe(true);
    expect(p.mediaLibrary.items[0].sourceFile?.path).toBe("/proj/Media/a.mov");
    expect(p.mediaLibrary.items[0].copiedFrom?.path).toBe("/orig/a.mov");
    await executor.undo(p);
    expect(p.mediaLibrary.items[0].sourceFile?.path).toBe("/orig/a.mov");
    expect(p.mediaLibrary.items[0].copiedFrom).toBeUndefined();
  });

  it("round-trips the optional fields through the project file", () => {
    const serializer = new ProjectSerializer({} as never);
    const p = project();
    (p.mediaLibrary as { desktopIngest?: unknown }).desktopIngest = { proxyProfile: { codec: "h264", size: "quarter" }, proxyFolder: "/x/Proxies" };
    (p.mediaLibrary.items[0] as { copiedFrom?: unknown }).copiedFrom = { path: "/o", sha256: "s", copiedAt: 1 };
    const loaded = serializer.importFromJson(serializer.exportToJson(p));
    expect(loaded.mediaLibrary.desktopIngest).toEqual({ proxyProfile: { codec: "h264", size: "quarter" }, proxyFolder: "/x/Proxies" });
    expect(loaded.mediaLibrary.items[0].sourceFile?.path).toBe("/orig/a.mov");
    expect(loaded.mediaLibrary.items[0].copiedFrom?.sha256).toBe("s");
  });
});
