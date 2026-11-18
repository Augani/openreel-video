import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { builtMain, builtRenderer, launchApp, rpc, sleep, waitForEndpoint } from "./mcp-e2e-helpers";

/**
 * macOS keeps the app alive with zero windows (`window-all-closed` does not quit). An MCP client
 * must still get answers: the main-process bridge creates a hidden editor window on demand and
 * waits for the renderer to announce readiness.
 *
 *   pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_MCP_E2E=1 OPENREEL_ELECTRON_TEST=1 vitest run test/mcp-no-window.electron.test.ts
 */
const enabled = process.env.OPENREEL_DESKTOP_MCP_E2E === "1";

describe.skipIf(!enabled || process.platform !== "darwin")("MCP with no editor window (real Electron, macOS)", () => {
  it("creates a hidden editor window on demand and answers tools/list and tools/call", async () => {
    expect(fs.existsSync(builtMain), `build the desktop app first (${builtMain})`).toBe(true);
    expect(fs.existsSync(builtRenderer), `build the renderer first (${builtRenderer})`).toBe(true);

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-nowin-"));
    const endpointFile = path.join(work, "mcp-endpoint.json");
    const app = await launchApp(work, endpointFile);
    try {
      const endpoint = await waitForEndpoint(endpointFile);
      // Let the normal window finish loading, then close every window the way a user would end up
      // with none (destroy() bypasses the unsaved-changes guard).
      await app.firstWindow();
      await sleep(1500);
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
      });
      await sleep(300);
      const remaining = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length);
      expect(remaining, "no windows are open, but the app (and the MCP server) is still running").toBe(0);

      const t0 = Date.now();
      const list = await rpc(endpoint, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const listMs = Date.now() - t0;
      expect(list.status).toBe(200);
      expect(list.json.error, JSON.stringify(list.json.error)).toBeUndefined();
      const names = (list.json.result.tools as Array<{ name: string }>).map((tool) => tool.name);
      expect(names.length).toBeGreaterThan(20);

      const state = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((w) => !w.isDestroyed())
          .map((w) => ({ visible: w.isVisible() })),
      );
      expect(state, "exactly one on-demand window now exists").toHaveLength(1);
      expect(state[0].visible, "the on-demand window stays hidden").toBe(false);

      const call = await rpc(endpoint, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_clips", arguments: {} } });
      expect(call.status).toBe(200);
      expect(call.json.error, "a tool failure is a tool result, not a protocol error").toBeUndefined();
      const text = String(call.json.result.content?.[0]?.text ?? "");
      expect(text).not.toMatch(/timed out/i);
      expect(text).toMatch(/No project is open|clips/i);

      console.info(`[mcp-no-window] tools/list with zero windows answered in ${listMs} ms (${names.length} tools)`);
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 150_000);
});
