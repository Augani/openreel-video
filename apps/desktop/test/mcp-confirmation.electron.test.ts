import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { builtMain, builtRenderer, launchApp, rpc, sleep, waitForEndpoint } from "./mcp-e2e-helpers";

/**
 * With "Allow agents to delete and export without asking" turned off, a destructive tool call over
 * MCP must come back as an isError tool result with CONFIRMATION_REQUIRED and a hint (not a
 * protocol error), while read-only calls keep working.
 *
 *   pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_MCP_E2E=1 OPENREEL_ELECTRON_TEST=1 vitest run test/mcp-confirmation.electron.test.ts
 */
const enabled = process.env.OPENREEL_DESKTOP_MCP_E2E === "1";

describe.skipIf(!enabled)("MCP confirmation gate (real Electron)", () => {
  it("refuses a destructive tool as a tool error when auto-allow is off", async () => {
    expect(fs.existsSync(builtMain), `build the desktop app first (${builtMain})`).toBe(true);
    expect(fs.existsSync(builtRenderer), `build the renderer first (${builtRenderer})`).toBe(true);

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-confirm-"));
    const endpointFile = path.join(work, "mcp-endpoint.json");
    const app = await launchApp(work, endpointFile);
    try {
      const endpoint = await waitForEndpoint(endpointFile);
      const page = await app.firstWindow();
      await page.evaluate(() => {
        window.localStorage.setItem(
          "openreel-settings",
          JSON.stringify({ state: { mcpAutoAllowTrustedLocal: false }, version: 7 }),
        );
      });
      // The reload tears down the evaluate context, so its promise may reject; that is expected.
      await page.evaluate(() => window.location.reload()).catch(() => undefined);
      await sleep(500);

      const list = await rpc(endpoint, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(list.json.error, JSON.stringify(list.json.error)).toBeUndefined();
      const remove = (list.json.result.tools as Array<{ name: string; annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }>).find(
        (tool) => tool.name === "remove_clip",
      );
      expect(remove?.annotations?.destructiveHint, "remove_clip is annotated destructive").toBe(true);

      const blocked = await rpc(endpoint, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "remove_clip", arguments: { clipId: "nope" } },
      });
      expect(blocked.status).toBe(200);
      expect(blocked.json.error, "an isError tool result, not a JSON-RPC error").toBeUndefined();
      expect(blocked.json.result.isError).toBe(true);
      expect(blocked.json.result.structuredContent.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(String(blocked.json.result.content[0].text)).toContain("Hint:");

      const readOnly = await rpc(endpoint, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_editor_state", arguments: {} },
      });
      expect(readOnly.json.error).toBeUndefined();
      expect(String(readOnly.json.result.content[0].text)).not.toContain("CONFIRMATION_REQUIRED");
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 150_000);
});
