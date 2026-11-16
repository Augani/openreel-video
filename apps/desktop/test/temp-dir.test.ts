import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp, existsSync, mkdtempSync, symlinkSync, writeFileSync, utimesSync, statSync, lstatSync } from "node:fs";

type TempDirModule = typeof import("../src/main/temp-dir");

const posix = process.platform !== "win32";
let root: string;
let prevTmp: string | undefined;

async function load(): Promise<TempDirModule> {
  vi.resetModules();
  return import("../src/main/temp-dir");
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "openreel-tdtest-"));
  prevTmp = process.env.TMPDIR;
  process.env.TMPDIR = root;
});

afterEach(async () => {
  if (prevTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = prevTmp;
  await fsp.rm(root, { recursive: true, force: true });
});

describe.skipIf(!posix)("temp-dir hardening", () => {
  it("recreates the dir with mode 0700 if it was deleted mid-session", async () => {
    const td = await load();
    const dir = td.appTempDir();
    await fsp.rm(dir, { recursive: true, force: true });
    const p = await td.newTempPathReady("t", "bin");
    expect(p.startsWith(dir)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(existsSync(dir)).toBe(true);
    await fsp.rm(dir, { recursive: true, force: true });
    const sync = td.newTempPath("u", "bin");
    expect(existsSync(path.dirname(sync))).toBe(true);
  });

  it("falls back to a fresh private dir when the shared path is a symlink", async () => {
    const decoy = path.join(root, "decoy");
    await fsp.mkdir(decoy);
    symlinkSync(decoy, path.join(root, "openreel-temp"));
    const td = await load();
    const dir = td.appTempDir();
    expect(dir).not.toBe(path.join(os.tmpdir(), "openreel-temp"));
    expect(path.dirname(dir)).toBe(os.tmpdir());
    expect(lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const p = await td.newTempPathReady("t", "bin");
    expect(p.startsWith(dir)).toBe(true);
  });

  it("falls back when the shared dir is owned by someone else", async () => {
    await fsp.mkdir(path.join(root, "openreel-temp"));
    const uid = process.getuid!();
    const spy = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
    try {
      const td = await load();
      expect(td.appTempDir()).not.toBe(path.join(os.tmpdir(), "openreel-temp"));
    } finally {
      spy.mockRestore();
    }
  });

  it("sweeps stale symlinks without following them", async () => {
    const td = await load();
    const outside = path.join(root, "outside.txt");
    writeFileSync(outside, "keep");
    const link = path.join(td.appTempDir(), "evil");
    symlinkSync(outside, link);
    const old = new Date(Date.now() - 3 * 24 * 3600e3);
    const stale = path.join(td.appTempDir(), "stale.bin");
    writeFileSync(stale, "x");
    utimesSync(stale, old, old);
    await fsp.lutimes(link, old, old);
    expect(await td.sweepStaleTemp()).toBe(2);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("releaseTempSync removes tracked files only", async () => {
    const td = await load();
    const p = await td.newTempPathReady("t", "bin");
    writeFileSync(p, "x");
    expect(td.releaseTempSync(p)).toBe(true);
    expect(existsSync(p)).toBe(false);
    expect(td.releaseTempSync(outsidePath())).toBe(false);
  });
});

function outsidePath(): string {
  return path.join(root, "not-ours");
}
