import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MediaItem, Project } from "@openreel/core";
import { PreviewProxyCache } from "./preview-proxy-cache";

/**
 * "Use proxies" is a preview-only switch: with it on, the preview reads the proxy; export and interchange
 * always read the full-resolution media, whatever the switch, the preset or the proxy's codec says.
 */
const media = (id = "clip"): MediaItem => ({
  id, name: `${id}.mov`, type: "video", blob: new Blob(["full-resolution"]), fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { width: 3840, height: 2160, duration: 10, frameRate: 30, codec: "avc", sampleRate: 48000, channels: 2, fileSize: 15 },
});
const project = (items: MediaItem[]): Project => ({ id: "p", mediaLibrary: { items } }) as Project;

describe("proxies in the preview, full resolution in the export", () => {
  it("global switch on: the preview uses the proxy; off: the original; export: always the original", () => {
    const item = media();
    const p = project([item]);
    const proxy = new Blob(["burn-in-proxy"]);
    const cache = new PreviewProxyCache({ loadOriginal: async () => item.blob!, generate: async () => new Blob(["x"]) });
    cache.syncProject(p);
    // A proxy built from a preset (here with burn-in) comes back from disk and is hydrated as the preview source.
    cache.hydrate(item, proxy, { width: 1920, height: 1080 });
    cache.setProxiesOn(true);
    expect(cache.resolve(p.id, item).blob).toBe(proxy);
    expect(cache.resolve(p.id, item, "export")).toBe(item);
    expect(cache.resolve(p.id, item, "export").blob).toBe(item.blob);
    cache.setProxiesOn(false);
    expect(cache.resolve(p.id, item).blob).toBe(item.blob);
    expect(cache.resolve(p.id, item, "export")).toBe(item);
  });

  it("the export code never reaches for a proxy", () => {
    // The export engine, the export queue and the export runners read media from the library items. Nothing in them
    // may import the preview proxy cache or read an item's proxy reference.
    const root = join(__dirname, "../../../..");
    const dirs = [join(root, "packages/core/src/export"), join(root, "apps/web/src/services/export-queue"), join(root, "apps/desktop/src/main/ipc")];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(full);
      }
    };
    for (const dir of dirs) walk(dir);
    for (const file of [join(root, "apps/web/src/services/export-runner.ts"), join(root, "apps/web/src/stores/export-queue-store.ts")]) files.push(file);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((file) => /preview-proxy|previewProxyCache|\.proxy\??\.(path|previewPath|storage)|item\.proxy\b|media\.proxy\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
