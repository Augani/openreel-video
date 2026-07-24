import { vi } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";

let userDataDir = "";
let appVersion = "1.0.0-alpha.3";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") throw new Error(`unexpected path: ${name}`);
      return userDataDir;
    },
    getVersion: () => appVersion,
  },
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateGpuCacheOnUpgrade } from "../src/main/gpu-cache-migration";

const MARKER = ".openreel-build";

function seedDir(name: string): void {
  mkdirSync(path.join(userDataDir, name), { recursive: true });
  writeFileSync(path.join(userDataDir, name, "blob.bin"), "cache-data");
}

describe("gpu cache migration", () => {
  beforeEach(() => {
    userDataDir = path.join(tmpdir(), `orel-gpucache-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(userDataDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  const CACHE_DIRS = ["GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "Code Cache"];

  it("clears regenerable caches on version change but preserves user data", () => {
    for (const d of CACHE_DIRS) seedDir(d);
    for (const d of ["IndexedDB", "Local Storage", "Cookies"]) seedDir(d);
    writeFileSync(path.join(userDataDir, MARKER), "1.0.0-alpha.2");
    appVersion = "1.0.0-alpha.3";

    migrateGpuCacheOnUpgrade();

    for (const d of CACHE_DIRS) {
      expect(existsSync(path.join(userDataDir, d))).toBe(false);
    }
    for (const d of ["IndexedDB", "Local Storage", "Cookies"]) {
      expect(existsSync(path.join(userDataDir, d))).toBe(true);
    }
    expect(readFileSync(path.join(userDataDir, MARKER), "utf8")).toBe("1.0.0-alpha.3");
  });

  it("does nothing when the version is unchanged", () => {
    seedDir("GPUCache");
    writeFileSync(path.join(userDataDir, MARKER), "1.0.0-alpha.3");
    appVersion = "1.0.0-alpha.3";

    migrateGpuCacheOnUpgrade();

    expect(existsSync(path.join(userDataDir, "GPUCache"))).toBe(true);
  });

  it("writes the marker on first run without clearing anything", () => {
    seedDir("GPUCache");
    appVersion = "1.0.0-alpha.3";

    migrateGpuCacheOnUpgrade();

    expect(existsSync(path.join(userDataDir, MARKER))).toBe(true);
    expect(readFileSync(path.join(userDataDir, MARKER), "utf8")).toBe("1.0.0-alpha.3");
    expect(existsSync(path.join(userDataDir, "GPUCache"))).toBe(true);
  });

  it("repairs a corrupt marker (a directory) into a valid file", () => {
    mkdirSync(path.join(userDataDir, MARKER), { recursive: true });
    appVersion = "1.0.0-alpha.3";
    expect(() => migrateGpuCacheOnUpgrade()).not.toThrow();
    expect(statSync(path.join(userDataDir, MARKER)).isFile()).toBe(true);
    expect(readFileSync(path.join(userDataDir, MARKER), "utf8")).toBe("1.0.0-alpha.3");
  });
});
