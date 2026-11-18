import { describe, expect, it } from "vitest";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool, toMcpTools } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import type { AppStateSnapshot, EditingHost } from "./host";

const snapshot: AppStateSnapshot = {
  appVersion: "1.2.3",
  platform: "darwin",
  route: "welcome",
  windows: { editor: true, count: 1 },
  projectOpen: false,
  projectId: null,
  onboarding: { status: "unseen", path: null, skippedBy: null },
  ai: { configured: false, provider: null },
  mcp: { toolCount: 400, autoAllow: true, allowedRoots: ["/Users/me/Movies"], protocolVersion: "2025-06-18" },
};

describe("app state tools", () => {
  it("registers get_app_state (read-only) and dismiss_onboarding over MCP", () => {
    const mcp = new Set(toMcpTools().map((t) => t.name));
    expect(mcp.has("get_app_state")).toBe(true);
    expect(mcp.has("dismiss_onboarding")).toBe(true);
    expect(getTool("get_app_state")).toMatchObject({ readOnly: true, destructive: false, expensive: false });
    expect(getTool("dismiss_onboarding")).toMatchObject({ readOnly: false, destructive: false });
    expect(getTool("get_app_state")!.inputSchema).toMatchObject({ type: "object", properties: {} });
  });

  it("get_app_state returns the host snapshot with the spec shape", async () => {
    const host = Object.assign(new HeadlessHost(makeEmptyProject()), { getAppState: async () => snapshot }) as EditingHost;
    const result = await executeTool("get_app_state", {}, host);
    expect(result.ok).toBe(true);
    const data = result.data as AppStateSnapshot;
    expect(Object.keys(data).sort()).toEqual(
      ["ai", "appVersion", "mcp", "onboarding", "platform", "projectId", "projectOpen", "route", "windows"].sort(),
    );
    expect(Object.keys(data.mcp).sort()).toEqual(["allowedRoots", "autoAllow", "protocolVersion", "toolCount"]);
    expect(Object.keys(data.onboarding).sort()).toEqual(["path", "skippedBy", "status"]);
    expect(result.summary).toMatch(/no project open/);
  });

  it("get_app_state works with no project open (it never needs one)", async () => {
    const host = Object.assign(new HeadlessHost(makeEmptyProject()), {
      getAppState: async () => snapshot,
      requireOpenProject: () => {
        throw new Error("No project is open");
      },
    }) as EditingHost;
    expect((await executeTool("get_app_state", {}, host)).ok).toBe(true);
    expect((await executeTool("dismiss_onboarding", {}, Object.assign(host, { dismissOnboarding: async () => ({ status: "skipped", changed: false }) }))).ok).toBe(true);
  });

  it("dismiss_onboarding is idempotent: the second call reports no change", async () => {
    let status = "unseen";
    const host = Object.assign(new HeadlessHost(makeEmptyProject()), {
      dismissOnboarding: async () => {
        const changed = status === "unseen";
        status = "skipped";
        return { status, changed };
      },
    }) as EditingHost;
    const first = await executeTool("dismiss_onboarding", {}, host);
    const second = await executeTool("dismiss_onboarding", {}, host);
    expect(first.data).toEqual({ status: "skipped", changed: true });
    expect(second.data).toEqual({ status: "skipped", changed: false });
    expect(second.summary).toMatch(/already skipped/);
  });

  it("both answer UNSUPPORTED with a hint on a host without the live app", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    for (const name of ["get_app_state", "dismiss_onboarding"]) {
      const result = await executeTool(name, {}, host);
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({ code: "UNSUPPORTED" });
      expect(result.error?.hint).toBeTruthy();
    }
  });
});
