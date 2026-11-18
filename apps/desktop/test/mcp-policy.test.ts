import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpPolicyStore, normalizeRoots } from "../src/main/mcp/policy";

let dir: string;
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openreel-policy-")));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const defaults = (): string[] => [path.join(dir, "Movies"), path.join(dir, "Documents")];

describe("McpPolicyStore", () => {
  it("starts from the default roots and reports them for reset", () => {
    const store = new McpPolicyStore({ file: path.join(dir, "mcp-policy.json"), defaultRoots: defaults() });
    expect(store.get()).toEqual({ allowedRoots: defaults(), defaultRoots: defaults() });
  });

  it("persists the edited roots and reloads them in a new store", () => {
    const file = path.join(dir, "ud", "mcp-policy.json");
    const a = new McpPolicyStore({ file, defaultRoots: defaults() });
    const saved = a.set({ allowedRoots: [path.join(dir, "Shoots"), path.join(dir, "Shoots")] });
    expect(saved.allowedRoots).toEqual([path.join(dir, "Shoots")]);
    expect(saved.defaultRoots).toEqual(defaults());
    const b = new McpPolicyStore({ file, defaultRoots: defaults() });
    expect(b.get().allowedRoots).toEqual([path.join(dir, "Shoots")]);
  });

  it("rejects relative paths and the filesystem root when setting", () => {
    const store = new McpPolicyStore({ file: path.join(dir, "p.json"), defaultRoots: defaults() });
    expect(() => store.set({ allowedRoots: ["relative/dir"] })).toThrow(/absolute/);
    expect(() => store.set({ allowedRoots: [path.parse(dir).root] })).toThrow(/filesystem root/);
  });

  it("falls back to the defaults when the file is corrupt", async () => {
    const file = path.join(dir, "p.json");
    await fs.writeFile(file, "{not json");
    expect(new McpPolicyStore({ file, defaultRoots: defaults() }).get().allowedRoots).toEqual(defaults());
  });

  it("adds the open project's folder to the effective roots only", () => {
    const store = new McpPolicyStore({ file: path.join(dir, "p.json"), defaultRoots: defaults() });
    store.setProjectFolder(path.join(dir, "Edits"));
    expect(store.effectiveRoots()).toEqual([...defaults(), path.join(dir, "Edits")]);
    expect(store.get().allowedRoots).toEqual(defaults());
    store.setProjectFolder(null);
    expect(store.effectiveRoots()).toEqual(defaults());
  });

  it("normalizeRoots drops invalid entries leniently", () => {
    expect(normalizeRoots(["", "rel", path.join(dir, "a", "..", "b")])).toEqual([path.join(dir, "b")]);
  });
});
