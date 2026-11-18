import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Real Electron (Playwright `_electron`): an MCP client that talks to the app in the first
 * moments after the window is created must get a correct answer, not a timeout.
 *
 * The renderer defers the agent/MCP stack (an ~860 KB chunk) until the editor warm-up settled, and
 * main's bridge sends a request over IPC to a window that may still be loading. Fix under test
 * (17a08df1 and the renderer-ready queue in the main bridge): the IPC handler is registered
 * immediately and the request waits for the stack instead of being dropped.
 *
 * The request goes through the real main-process path: loopback HTTP MCP endpoint (token from the
 * endpoint file) -> renderer-bridge -> window IPC -> renderer registry -> back. It needs the BUILT
 * app, so it is opt-in:
 *
 *   pnpm --filter @openreel/desktop build
 *   OPENREEL_ELECTRON_TEST=1 pnpm --filter @openreel/desktop test:electron
 */
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const builtMain = path.join(desktopDir, "dist/main/index.js");
const builtRenderer = path.join(repoRoot, "apps/web/dist/index.html");
const enabled = process.env.OPENREEL_ELECTRON_TEST === "1";

function loadPlaywright(): { _electron: { launch(options: Record<string, unknown>): Promise<ElectronApp> } } {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith("playwright@"));
  if (!dir) throw new Error("playwright is not installed in the workspace");
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
}

interface ElectronApp {
  evaluate<T>(fn: (modules: { BrowserWindow: { getAllWindows(): Array<{ isDestroyed(): boolean }> } }) => T): Promise<T>;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(endpoint: { url: string; token: string }, body: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe.skipIf(!enabled)("MCP early request through the main-process bridge (real Electron)", () => {
  it("answers listTools and callTool sent within ~500 ms of window creation", async () => {
    expect(fs.existsSync(builtMain), `build the desktop app first (${builtMain})`).toBe(true);
    expect(fs.existsSync(builtRenderer), `build the renderer first (${builtRenderer})`).toBe(true);

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-early-"));
    const endpointFile = path.join(work, "mcp-endpoint.json");
    const { _electron } = loadPlaywright();
    const app = await _electron.launch({
      args: [desktopDir, `--user-data-dir=${path.join(work, "ud")}`],
      env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile },
      timeout: 90_000,
    });
    try {
      // t0: the first moment a BrowserWindow exists in the main process.
      let tWindow = 0;
      for (let i = 0; i < 60_000 && !tWindow; i++) {
        const open = await app
          .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed()))
          .catch(() => false);
        if (open) tWindow = Date.now();
        else await sleep(2);
      }
      expect(tWindow, "a window was created").toBeGreaterThan(0);

      // The endpoint file is written once the loopback server listens.
      let endpoint: { url: string; token: string } | null = null;
      while (!endpoint && Date.now() - tWindow < 20_000) {
        try {
          endpoint = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
        } catch {
          await sleep(2);
        }
      }
      expect(endpoint, "the MCP endpoint file appeared").not.toBeNull();
      const sentAfterMs = Date.now() - tWindow;

      // initialize is answered by main alone: negotiated version, usage instructions, client tracking.
      const init = await rpc(endpoint!, {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "early-e2e", version: "1.0" } },
      });
      expect(init.json.result.protocolVersion, "an unknown newer client version gets our latest").toBe("2025-11-25");
      expect(String(init.json.result.instructions)).toContain("get_app_state");

      const t1 = Date.now();
      const list = await rpc(endpoint!, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const listMs = Date.now() - t1;
      expect(list.status).toBe(200);
      expect(list.json.error, JSON.stringify(list.json.error)).toBeUndefined();
      const names = (list.json.result.tools as Array<{ name: string }>).map((tool) => tool.name);
      expect(names.length).toBeGreaterThan(20);
      expect(names).toContain("list_clips");
      const listClips = (list.json.result.tools as Array<{ name: string; annotations?: Record<string, unknown> }>).find(
        (tool) => tool.name === "list_clips",
      );
      expect(listClips?.annotations, "tool annotations come through tools/list").toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });

      const t2 = Date.now();
      const call = await rpc(endpoint!, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_clips", arguments: {} } });
      const callMs = Date.now() - t2;
      expect(call.status).toBe(200);
      expect(call.json.error, JSON.stringify(call.json.error)).toBeUndefined();
      // No project is open yet, so the tool itself answers "No project is open": a real, correct
      // answer from the live renderer registry. What must never happen is a bridge timeout.
      const text = String(call.json.result.content?.[0]?.text ?? "");
      expect(text, "callTool returned content").toBeTruthy();
      expect(text, "the renderer answered, not the bridge timeout").not.toMatch(/timed out/i);
      expect(text).toMatch(/No project is open|clips/i);
      // A failed tool is an isError tool result (with a hint), never a JSON-RPC -32603.
      if (call.json.result.isError) {
        expect(call.json.result.structuredContent.error.code).toBeTruthy();
        expect(text).toContain("Hint:");
      }

      console.info(
        `[mcp-early] first request sent ${sentAfterMs} ms after window creation; tools/list answered in ${listMs} ms (${names.length} tools); tools/call list_clips answered in ${callMs} ms`,
      );
      expect(sentAfterMs, "the request really was early (window just created)").toBeLessThan(2_000);
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
