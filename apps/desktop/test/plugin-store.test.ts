import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(), sendActionToFirstResponder: vi.fn() },
}));

import { PluginFolderStore } from "../src/main/ipc/plugins";
import { buildMenuTemplate } from "../src/main/app-menu";

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    apiVersion: 1,
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    category: "Stylize",
    parameters: [{ key: "amount", type: "float", min: 0, max: 1, default: 0.5 }],
    cpu: { file: "cpu.js" },
    ...over,
  });
const files = (over: Record<string, unknown> = {}) => ({
  "plugin.json": manifest(over),
  "cpu.js": "function process(frame) { frame.data[0] = 1; }",
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "openreel-plugins-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("PluginFolderStore (user data plugins folder)", () => {
  it("installs, lists, upgrades and uninstalls a plugin", async () => {
    const store = new PluginFolderStore(path.join(root, "plugins"));
    expect(await store.list()).toEqual([]);
    await store.put("demo", files());
    expect(await readdir(path.join(root, "plugins", "demo"))).toEqual(["cpu.js", "plugin.json"]);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(JSON.parse(listed[0]["plugin.json"]).version).toBe("1.0.0");

    await store.put("demo", files({ version: "1.1.0" }));
    expect(JSON.parse((await store.list())[0]["plugin.json"]).version).toBe("1.1.0");
    expect((await readdir(path.join(root, "plugins"))).filter((n) => n.includes("installing"))).toEqual([]);

    await store.remove("demo");
    expect(await store.list()).toEqual([]);
  });

  it("refuses invalid packages, mismatched ids and traversal ids without writing anything", async () => {
    const store = new PluginFolderStore(path.join(root, "plugins"));
    await expect(store.put("demo", { "plugin.json": "{}" })).rejects.toThrow(/invalid plugin package/);
    await expect(store.put("other", files())).rejects.toThrow(/does not match/);
    await expect(store.put("../evil", files({ id: "../evil" }))).rejects.toThrow();
    await expect(store.put("demo", { ...files(), "cpu.js": "function process() { fetch('x') }" })).rejects.toThrow(/fetch/);
    await expect(store.remove("../escape")).rejects.toThrow(/invalid plugin id/);
    expect(await store.list()).toEqual([]);
  });

  it("skips folders that were hand-edited into an invalid state", async () => {
    const store = new PluginFolderStore(path.join(root, "plugins"));
    await store.put("demo", files());
    await writeFile(path.join(root, "plugins", "demo", "cpu.js"), "fetch('https://example.com')");
    await mkdir(path.join(root, "plugins", "junk"));
    await writeFile(path.join(root, "plugins", "junk", "plugin.json"), "nope");
    expect(await store.list()).toEqual([]);
  });
});

describe("application menu", () => {
  it("has File > Collaborate wired to the collaborate action", () => {
    for (const platform of ["darwin", "win32", "linux"]) {
      const file = buildMenuTemplate(platform).find((menu) => menu.label === "File");
      expect(file?.submenu?.find((item) => item.actionId === "collaborate")).toMatchObject({ label: "Collaborate…", accelerator: "Shift+CmdOrCtrl+J" });
    }
  });

  it("has Effects > Manage Plugins wired to the managePlugins action", () => {
    for (const platform of ["darwin", "win32", "linux"]) {
      const effects = buildMenuTemplate(platform).find((menu) => menu.label === "Effects");
      expect(effects?.submenu?.map((item) => [item.label, item.actionId])).toEqual([["Manage Plugins…", "managePlugins"]]);
    }
  });
});
