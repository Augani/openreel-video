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
