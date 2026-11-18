import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { builtMain, builtRenderer, builtShim, launchApp, sleep, spawnShim, waitForEndpoint } from "./mcp-e2e-helpers";

/**
 * A live stdio shim must survive a token rotation and an app relaunch without the client being
 * restarted: on HTTP 401 or ECONNREFUSED it re-reads the endpoint file and retries once. While the
 * app is down it answers with a clear "isn't running" message instead of crashing.
 *
 *   pnpm --filter @openreel/desktop build
 *   OPENREEL_DESKTOP_MCP_E2E=1 OPENREEL_ELECTRON_TEST=1 vitest run test/mcp-shim-rotation.electron.test.ts
 */
const enabled = process.env.OPENREEL_DESKTOP_MCP_E2E === "1";

describe.skipIf(!enabled)("MCP shim token rotation and relaunch (real Electron)", () => {
  it("keeps one shim process working across rotateToken and an app relaunch", async () => {
    expect(fs.existsSync(builtMain), `build the desktop app first (${builtMain})`).toBe(true);
    expect(fs.existsSync(builtShim), `the shim must be built (${builtShim})`).toBe(true);
    expect(fs.existsSync(builtRenderer), `build the renderer first (${builtRenderer})`).toBe(true);

    const work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-shim-"));
    const endpointFile = path.join(work, "mcp-endpoint.json");
    let app = await launchApp(work, endpointFile);
    const shim = spawnShim(endpointFile);
    try {
      const first = await waitForEndpoint(endpointFile);

      const init = await shim.request({
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-shim", version: "1" } },
      });
      expect(init.result.protocolVersion).toBe("2025-06-18");
      expect(String(init.result.instructions)).toContain("get_app_state");

      const before = await shim.request({ method: "tools/list" });
      expect(before.error, JSON.stringify(before.error)).toBeUndefined();
      const toolCount = (before.result.tools as unknown[]).length;
      expect(toolCount).toBeGreaterThan(20);

      // Token rotation: the shim's cached token is now stale (HTTP 401) and must be re-read.
      const page = await app.firstWindow();
      await page.evaluate(() => (window as unknown as { openreel: { mcp: { rotateToken(): Promise<unknown> } } }).openreel.mcp.rotateToken());
      const rotated = await waitForEndpoint(endpointFile, 10_000, first.token);
      expect(rotated.token).not.toBe(first.token);
      const afterRotation = await shim.request({ method: "tools/list" });
      expect(afterRotation.error, JSON.stringify(afterRotation.error)).toBeUndefined();
      expect((afterRotation.result.tools as unknown[]).length).toBe(toolCount);

      // App quit: the endpoint file is removed and the shim says so plainly.
      await app.close();
      await sleep(300);
      const down = await shim.request({ method: "tools/list" });
      expect(down.error?.code).toBe(-32000);
      expect(String(down.error?.message)).toContain("OpenReel isn't running. Start the app and retry.");

      // Relaunch (new port, new token): the same shim process recovers by itself.
      app = await launchApp(work, endpointFile);
      const relaunched = await waitForEndpoint(endpointFile, 30_000, rotated.token);
      expect(relaunched.token).not.toBe(rotated.token);
      const recovered = await shim.request({ method: "tools/list" }, 90_000);
      expect(recovered.error, JSON.stringify(recovered.error)).toBeUndefined();
      expect((recovered.result.tools as unknown[]).length).toBe(toolCount);
    } finally {
      shim.kill();
      await app.close().catch(() => undefined);
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 240_000);

  it("--doctor reports a missing app and then a healthy one", async () => {
    const { spawnSync } = await import("node:child_process");
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-doctor-"));
    const endpointFile = path.join(work, "mcp-endpoint.json");
    try {
      const down = spawnSync(process.execPath, [builtShim, "--doctor"], {
        env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile },
        encoding: "utf8",
      });
      expect(down.status).toBe(1);
      expect(down.stdout).toContain("Start the OpenReel desktop app");

      const app = await launchApp(work, endpointFile);
      try {
        await waitForEndpoint(endpointFile);
        await (await app.firstWindow()).evaluate(() => true);
        const up = spawnSync(process.execPath, [builtShim, "--doctor"], {
          env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile },
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(up.stdout).toContain("initialize OK");
        expect(up.stdout).toContain("tools/list OK");
        expect(up.status).toBe(0);
      } finally {
        await app.close().catch(() => undefined);
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 180_000);
});
