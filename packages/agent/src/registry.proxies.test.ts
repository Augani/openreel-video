import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import type { ProxyBridge } from "./host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";

function hostWith(bridge?: Partial<ProxyBridge>) {
  const host = new HeadlessHost(makeEmptyProject());
  if (bridge) (host as unknown as { proxies: ProxyBridge }).proxies = bridge as ProxyBridge;
  return host;
}

describe("agent proxy tools", () => {
  it("registers create_proxies, attach_proxies, toggle_proxies, list_proxies and set_ingest_preset", () => {
    for (const name of ["create_proxies", "attach_proxies", "toggle_proxies", "list_proxies", "set_ingest_preset"]) expect(getTool(name)).toBeDefined();
    expect(getTool("list_proxies")?.readOnly).toBe(true);
    expect(getTool("create_proxies")?.description).toMatch(/full-resolution/i);
  });

  it("fails clearly on a host with no media pipeline", async () => {
    for (const name of ["create_proxies", "attach_proxies", "toggle_proxies", "list_proxies"]) {
      const r = await executeTool(name, {}, hostWith());
      expect(r.ok, name).toBe(false);
      expect(r.error?.code).toBe("UNSUPPORTED_HOST");
    }
  });

  it("create_proxies validates quality and forwards ids, quality and force", async () => {
    const calls: unknown[] = [];
    const host = hostWith({
      create: (ids, quality, force) => {
        calls.push([ids, quality, force]);
        return { queued: ["a"], skipped: [{ id: "b", reason: "Already has a proxy." }] };
      },
    });
    expect((await executeTool("create_proxies", { quality: "ultra" }, host)).ok).toBe(false);
    expect((await executeTool("create_proxies", { mediaIds: "a" }, host)).ok).toBe(false);
    const r = await executeTool("create_proxies", { mediaIds: ["a", "b"], quality: "low", force: true }, host);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ queued: ["a"] });
    expect(calls).toEqual([[["a", "b"], "low", true]]);
    await executeTool("create_proxies", {}, host);
    expect(calls[1]).toEqual([undefined, "medium", false]);
  });

  it("attach_proxies passes pairs through and reports rejected proxies", async () => {
    let seen: unknown = "unset";
    const host = hostWith({
      attach: async (pairs) => {
        seen = pairs;
        return pairs
          ? { attached: [], skipped: [{ name: "x_proxy.mp4", reason: "Duration 9.00s does not match the original 4.00s." }] }
          : { attached: [{ mediaId: "m", name: "m.mp4" }], skipped: [] };
      },
    });
    const byName = await executeTool("attach_proxies", {}, host);
    expect(byName.ok).toBe(true);
    expect(seen).toBeUndefined();
    const bad = await executeTool("attach_proxies", { pairs: [{ mediaId: "m", proxyMediaId: "p" }] }, host);
    expect(bad.ok).toBe(false);
    expect(bad.summary).toContain("Duration");
    expect(seen).toEqual([{ mediaId: "m", proxyMediaId: "p" }]);
    expect((await executeTool("attach_proxies", { pairs: [{ mediaId: "m" }] }, host)).ok).toBe(false);
  });

  it("toggle_proxies sets or flips the switch and rejects a non-boolean", async () => {
    let on = true;
    const host = hostWith({ toggle: (value) => ({ on: (on = value ?? !on) }) });
    expect((await executeTool("toggle_proxies", {}, host)).data).toEqual({ on: false });
    expect((await executeTool("toggle_proxies", { on: true }, host)).data).toEqual({ on: true });
    expect((await executeTool("toggle_proxies", { on: "yes" }, host)).ok).toBe(false);
  });

  it("set_ingest_preset is one media/organize action and rejects unknown presets", async () => {
    const host = hostWith();
    expect((await executeTool("set_ingest_preset", { preset: "copy" }, host)).ok).toBe(false);
    expect((await executeTool("set_ingest_preset", { preset: "bogus" }, host)).ok).toBe(false);
    const r = await executeTool("set_ingest_preset", { preset: "proxies" }, host);
    expect(r.ok).toBe(true);
    expect(host.getProject().mediaLibrary.ingestPreset).toBe("proxies");
  });
});
