import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import type { DesktopIngestBridge, ProxyBridge } from "./host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";

function desktopBridge(over: Partial<DesktopIngestBridge> = {}): ProxyBridge {
  const desktop: DesktopIngestBridge = {
    retryFailed: async () => ({ retried: 2 }),
    copyToProject: async () => ({ copied: [{ mediaId: "a", name: "a.mov", path: "/p/Media/a.mov", sha256: "x" }], skipped: [] }),
    relink: async () => ({ linked: [{ mediaId: "a", name: "a.mov", path: "/f/a.mov" }], ambiguous: [], notFound: ["b.mov"], failed: [] }),
    folders: async () => ({ proxyDir: "/p/Proxies", mediaDir: "/p/Media", projectSaved: true }),
    ...over,
  };
  return { desktop } as unknown as ProxyBridge;
}
function hostWith(bridge?: ProxyBridge) {
  const host = new HeadlessHost(makeEmptyProject());
  if (bridge) (host as unknown as { proxies: ProxyBridge }).proxies = bridge;
  return host;
}

describe("agent desktop ingest tools", () => {
  it("registers set_proxy_format, retry_failed_proxies, copy_media_to_project and relink_media", () => {
    for (const name of ["set_proxy_format", "retry_failed_proxies", "copy_media_to_project", "relink_media"]) expect(getTool(name)).toBeDefined();
    expect(getTool("copy_media_to_project")?.description).toMatch(/never modified or deleted/);
  });

  it("fails clearly off desktop", async () => {
    const host = hostWith({} as ProxyBridge);
    for (const [name, args] of [["set_proxy_format", { codec: "h264" }], ["retry_failed_proxies", {}], ["copy_media_to_project", {}], ["relink_media", { folder: "/f" }]] as const) {
      const r = await executeTool(name, args, host);
      expect(r.ok, name).toBe(false);
      expect(r.error?.code, name).toBe("UNSUPPORTED_HOST");
    }
  });

  it("set_proxy_format merges the given fields as one media/organize step and rejects bad values", async () => {
    const host = hostWith(desktopBridge());
    expect((await executeTool("set_proxy_format", { codec: "dnxhd" }, host)).ok).toBe(false);
    expect((await executeTool("set_proxy_format", { concurrency: 4 }, host)).ok).toBe(false);
    expect((await executeTool("set_proxy_format", { codec: "prores-proxy", size: "quarter" }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest).toEqual({ proxyProfile: { codec: "prores-proxy", size: "quarter" } });
    expect((await executeTool("set_proxy_format", { size: "720p", concurrency: 2, proxyFolder: "/fast/prx" }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest).toEqual({
      proxyProfile: { codec: "prores-proxy", size: "720p" },
      concurrency: 2,
      proxyFolder: "/fast/prx",
    });
  });

  it("set_proxy_format takes every codec, size, audio, burn-in, destination and checksum option", async () => {
    const tool = getTool("set_proxy_format");
    const props = (tool?.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.codec.enum).toEqual(["prores-proxy", "prores-lt", "prores-422", "dnxhr-lb", "dnxhr-sq", "h264"]);
    expect(props.size.enum).toEqual(["full", "half", "quarter", "720p", "1080p", "custom"]);
    expect(props.checksum.enum).toEqual(["sha256", "md5", "xxh64"]);
    for (const word of ["ProRes 422 LT", "DNxHR SQ", "xxh64", "burn", "strip", "destination", "customWidth", "720p"]) expect(tool?.description, word).toContain(word);

    const host = hostWith(desktopBridge());
    const run = (args: Record<string, unknown>) => executeTool("set_proxy_format", args, host);
    expect((await run({ codec: "prores-lt", size: "custom", customWidth: 960, audio: "strip", burnIn: { clipName: true, timecode: true }, destination: { mode: "custom", folder: "/Volumes/Fast/Proxies" }, checksum: "xxh64" })).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest).toEqual({
      proxyProfile: { codec: "prores-lt", size: "custom", customWidth: 960, audio: "strip", burnIn: { clipName: true, timecode: true }, destination: { mode: "custom", folder: "/Volumes/Fast/Proxies" } },
      checksum: "xxh64",
    });
    // Merging keeps the other fields; a fixed size drops the custom width; burn-in flags merge; defaults are normalised away.
    expect((await run({ size: "720p", burnIn: { timecode: false }, audio: "keep", destination: { mode: "project" } })).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest).toEqual({
      proxyProfile: { codec: "prores-lt", size: "720p", burnIn: { clipName: true } },
      checksum: "xxh64",
    });
    expect((await run({ checksum: "md5", codec: "dnxhr-sq", size: "full" })).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest).toMatchObject({ proxyProfile: { codec: "dnxhr-sq", size: "full", burnIn: { clipName: true } }, checksum: "md5" });
  });

  it("set_proxy_format rejects invalid option combinations without changing the project", async () => {
    const host = hostWith(desktopBridge());
    const before = host.getProject().mediaLibrary.desktopIngest;
    for (const args of [
      { checksum: "crc32" },
      { audio: "mute" },
      { size: "custom" },
      { size: "custom", customWidth: 8 },
      { size: "custom", customWidth: 960.5 },
      { size: "half", customWidth: 960 },
      { destination: { mode: "custom" } },
      { destination: { mode: "desktop" } },
      { burnIn: { timecode: "yes" } },
      { burnIn: "tc" },
      { destination: "media" },
    ]) {
      const r = await executeTool("set_proxy_format", args, host);
      expect(r.ok, JSON.stringify(args)).toBe(false);
    }
    expect(host.getProject().mediaLibrary.desktopIngest).toEqual(before);
  });

  it("set_proxy_format clears the remembered app preset id when the profile changes, keeps it for other settings", async () => {
    const host = hostWith(desktopBridge());
    await host.applyAction({ type: "media/organize", id: "p", timestamp: 0, params: { label: "x", desktopIngest: { proxyProfile: { codec: "h264", size: "half" }, proxyPresetId: "h264-half" } } } as never);
    expect((await executeTool("set_proxy_format", { concurrency: 2 }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest?.proxyPresetId).toBe("h264-half");
    expect((await executeTool("set_proxy_format", { audio: "strip" }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.desktopIngest?.proxyPresetId).toBeUndefined();
  });

  it("copy_media_to_project reports the algorithm and digest the copy was verified with", async () => {
    const host = hostWith(
      desktopBridge({ copyToProject: async () => ({ copied: [{ mediaId: "a", name: "a.mov", path: "/p/Media/a.mov", sha256: "", algorithm: "xxh64", checksum: "0123456789abcdef" }], skipped: [] }) }),
    );
    const r = await executeTool("copy_media_to_project", {}, host);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ copied: [{ algorithm: "xxh64", checksum: "0123456789abcdef" }] });
    expect(getTool("copy_media_to_project")?.description).toMatch(/MD5 or xxHash64/);
  });

  it("describes create_proxies for both hosts and keeps the panel pointers", () => {
    const create = getTool("create_proxies")?.description ?? "";
    expect(create).toMatch(/Project panel > Proxies > Create proxies/);
    expect(create).toMatch(/set_proxy_format/);
    expect(create).toMatch(/full-resolution/);
  });

  it("set_ingest_preset accepts copy only on desktop", async () => {
    expect((await executeTool("set_ingest_preset", { preset: "copy" }, hostWith())).ok).toBe(false);
    const host = hostWith(desktopBridge());
    expect((await executeTool("set_ingest_preset", { preset: "copy" }, host)).ok).toBe(true);
    expect(host.getProject().mediaLibrary.ingestPreset).toBe("copy");
  });

  it("forwards retry, copy and relink to the bridge and reports results", async () => {
    const seen: unknown[] = [];
    const host = hostWith(
      desktopBridge({
        copyToProject: async (ids) => {
          seen.push(["copy", ids]);
          return { copied: [], skipped: [{ name: "a.mov", reason: "Save the project first so its Media folder has a home." }] };
        },
        relink: async (kind, folder) => {
          seen.push(["relink", kind, folder]);
          return { linked: [], ambiguous: [{ name: "a.mov", candidates: ["/x", "/y"] }], notFound: [], failed: [] };
        },
      }),
    );
    expect((await executeTool("retry_failed_proxies", {}, host)).data).toEqual({ retried: 2 });
    const copy = await executeTool("copy_media_to_project", { mediaIds: ["a"] }, host);
    expect(copy.ok).toBe(false);
    expect(copy.summary).toContain("Save the project first");
    expect((await executeTool("copy_media_to_project", { mediaIds: "a" }, host)).ok).toBe(false);
    const relink = await executeTool("relink_media", { folder: "/Volumes/Footage", kind: "proxy" }, host);
    expect(relink.ok).toBe(true);
    expect(relink.data).toMatchObject({ ambiguous: [{ name: "a.mov" }] });
    expect((await executeTool("relink_media", { folder: "/f", kind: "nope" }, host)).ok).toBe(false);
    expect((await executeTool("relink_media", { folder: " " }, host)).ok).toBe(false);
    expect(seen).toEqual([["copy", ["a"]], ["relink", "proxy", "/Volumes/Footage"]]);
  });
});
