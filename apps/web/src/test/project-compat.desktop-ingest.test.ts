import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectSerializer, type MediaProxyRef, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Desktop ingest adds only OPTIONAL fields: `mediaLibrary.desktopIngest` (proxy format, folders, jobs at
 * once), `sourceFile.path` (where the file lives on disk), `copiedFrom` (copy-to-project provenance) and, on
 * a proxy reference, `profile` and `previewPath`. So:
 *  - the w4..w8 files load and re-save without any of them appearing;
 *  - a project that uses them (fixtures/compat/w9-desktop-ingest.openreel.json, written by this tree from the
 *    w6 fixture) loads, keeps every field through a re-save, opens in the store, and an edit is one undo step.
 */

const FIXTURES = join(__dirname, "fixtures", "compat");
const serializer = new ProjectSerializer({} as never);
const read = (name: string): string => readFileSync(join(FIXTURES, `${name}.openreel.json`), "utf8");

const NEW_KEYS = ["desktopIngest", "copiedFrom", "previewPath", "proxiesWithCopy"];

function buildDesktopProject(): Project {
  const base = serializer.importFromJson(read("w6"));
  const proxy: MediaProxyRef = {
    storage: "path",
    path: "/Volumes/Edit/Film/Proxies/three-scenes-media-sc_half_proxy.mov",
    width: 640,
    height: 360,
    codec: "prores",
    frameRate: 30,
    duration: 6,
    fileSize: 123456,
    status: "ready",
    profile: { codec: "prores-proxy", size: "half" },
    previewPath: "/Volumes/Edit/Film/Proxies/three-scenes-media-sc_half_proxy.preview.mp4",
    source: "generated",
    createdAt: 1700000000000,
  };
  return {
    ...base,
    name: "Compat w9 desktop ingest",
    mediaLibrary: {
      ...base.mediaLibrary,
      ingestPreset: "copy",
      desktopIngest: {
        proxyProfile: { codec: "prores-proxy", size: "half" },
        proxyFolder: "/Volumes/Edit/Film/Proxies",
        mediaFolder: "Media",
        concurrency: 2,
        proxiesWithCopy: true,
      },
      items: base.mediaLibrary.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              sourceFile: { ...(item.sourceFile ?? { name: item.name, size: 0, lastModified: 0 }), path: "/Volumes/Edit/Film/Media/three-scenes.mp4", folder: "Media" },
              copiedFrom: { path: "/Volumes/Cards/A001/three-scenes.mp4", sha256: "0".repeat(64), copiedAt: 1700000000000 },
              proxy,
            }
          : item,
      ),
    },
  };
}

describe("desktop ingest project compatibility", () => {
  it.skipIf(!process.env.OPENREEL_DESKTOP_INGEST_FIXTURE_OUT)("writes the fixture (regeneration helper)", () => {
    writeFileSync(process.env.OPENREEL_DESKTOP_INGEST_FIXTURE_OUT!, serializer.exportToJson(buildDesktopProject()));
  });

  it("w4, w5, w6 and w8 files load and re-save without any desktop ingest field appearing", () => {
    for (const wave of ["w4", "w5", "w6", "w8", "w8-audio-repair"]) {
      const resaved = serializer.exportToJson(serializer.importFromJson(read(wave)));
      for (const key of NEW_KEYS) expect(resaved, `${wave} must not gain ${key}`).not.toContain(`"${key}"`);
      expect(resaved, `${wave} must not gain sourceFile.path`).not.toMatch(/"sourceFile":\s*\{[^}]*"path"/);
    }
  });

  describe("project that uses desktop ingest", () => {
    const json = existsSync(join(FIXTURES, "w9-desktop-ingest.openreel.json")) ? read("w9-desktop-ingest") : "{}"; // absent only while the generator test runs

    it("validates, imports and keeps every field", () => {
      expect(serializer.validateProjectJson(json).valid).toBe(true);
      const project = serializer.importFromJson(json);
      expect(project.mediaLibrary.ingestPreset).toBe("copy");
      expect(project.mediaLibrary.desktopIngest).toEqual({
        proxyProfile: { codec: "prores-proxy", size: "half" },
        proxyFolder: "/Volumes/Edit/Film/Proxies",
        mediaFolder: "Media",
        concurrency: 2,
        proxiesWithCopy: true,
      });
      const item = project.mediaLibrary.items[0];
      expect(item.sourceFile).toMatchObject({ path: "/Volumes/Edit/Film/Media/three-scenes.mp4", folder: "Media" });
      expect(item.copiedFrom).toMatchObject({ path: "/Volumes/Cards/A001/three-scenes.mp4", sha256: "0".repeat(64) });
      expect(item.proxy).toMatchObject({ storage: "path", profile: { codec: "prores-proxy", size: "half" }, previewPath: expect.stringContaining(".preview.mp4") });
    });

    it("re-saves with every field untouched, and a second re-save changes nothing", () => {
      const original = JSON.parse(json) as { project: Project };
      const first = JSON.parse(serializer.exportToJson(serializer.importFromJson(json))) as { project: Project };
      const slice = (file: { project: Project }) => ({
        ingest: file.project.mediaLibrary.desktopIngest,
        preset: file.project.mediaLibrary.ingestPreset,
        items: file.project.mediaLibrary.items.map((item) => [item.sourceFile, item.copiedFrom ?? null, item.proxy ?? null]),
      });
      expect(slice(first)).toEqual(slice(original));
      expect(JSON.parse(serializer.exportToJson(serializer.importFromJson(JSON.stringify(first))))).toEqual(first);
    });

    it("opens in the store; changing the proxy format is one undo step", async () => {
      useProjectStore.getState().loadProject(serializer.importFromJson(json));
      const history = useProjectStore.getState().actionHistory;
      const before = history.getUndoStackSize();
      const result = await useProjectStore.getState().executeAction({
        type: "media/organize",
        id: "compat-ingest",
        timestamp: Date.now(),
        params: { label: "Set proxy format", desktopIngest: { ...useProjectStore.getState().project.mediaLibrary.desktopIngest, proxyProfile: { codec: "h264", size: "quarter" } } },
      });
      expect(result.success).toBe(true);
      expect(history.getUndoStackSize()).toBe(before + 1);
      expect(useProjectStore.getState().project.mediaLibrary.desktopIngest?.proxyProfile).toEqual({ codec: "h264", size: "quarter" });
      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.mediaLibrary.desktopIngest?.proxyProfile).toEqual({ codec: "prores-proxy", size: "half" });
    });
  });
});
