import { describe, it, expect, vi } from "vitest";

// No @openreel/agent mock here: exercises the real registry classification
// (isDestructive/toMcpTools) so arg/host wiring drift is actually caught.

vi.mock("./host-singleton", () => ({
  getLiveEditorHost: () => ({
    requireOpenProject: () => {
      throw new Error("No project is open");
    },
  }),
  runExclusive: (fn: () => Promise<unknown>) => fn(),
}));

let autoAllow = false;
vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ mcpAutoAllowTrustedLocal: autoAllow }) },
}));

import { handleMcpBridgeRequest } from "./mcp-listener";

describe("handleMcpBridgeRequest (real registry)", () => {
  it("listTools returns the real registry", async () => {
    const res = await handleMcpBridgeRequest({ callId: "c", kind: "listTools" });
    expect(res.ok).toBe(true);
    expect((res.result as unknown[]).length).toBeGreaterThan(10);
  });

  it("gates a genuinely destructive tool (delete_media) via real classification", async () => {
    autoAllow = false;
    const res = await handleMcpBridgeRequest({
      callId: "c",
      kind: "callTool",
      name: "delete_media",
      args: { mediaId: "m1" },
    });
    expect(res.ok).toBe(true);
    expect((res.result as { error?: { code: string } }).error?.code).toBe(
      "CONFIRMATION_REQUIRED",
    );
  });
});
