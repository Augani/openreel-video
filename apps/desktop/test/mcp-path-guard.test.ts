import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { resolveMcpPaths } from "../src/main/mcp/path-guard";
import { placeOutput } from "../src/main/mcp/place-output";

let base: string;
let root: string;
let outside: string;
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openreel-guard-")));
  root = path.join(base, "Movies");
  outside = path.join(base, "Secret");
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, "a.mp4"), "video-bytes");
  await fs.writeFile(path.join(root, "notes.txt"), "text");
  await fs.writeFile(path.join(outside, "key.mp4"), "secret");
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const read = (paths: string[], recursive = false) => resolveMcpPaths({ paths, recursive, mode: "read" }, { roots: [root] });
const write = (paths: string[]) => resolveMcpPaths({ paths, mode: "write" }, { roots: [root] });

describe("resolveMcpPaths (read)", () => {
  it("resolves a file inside a root with its real path and size", async () => {
    const result = await read([path.join(root, "a.mp4")]);
    expect(result.rejected).toEqual([]);
    expect(result.resolved).toEqual([
      { path: path.join(root, "a.mp4"), realPath: path.join(root, "a.mp4"), kind: "file", sizeBytes: 11, exists: true },
    ]);
  });

  it("rejects a file outside the roots, existing or not, with the same code", async () => {
    const result = await read([path.join(outside, "key.mp4"), path.join(outside, "missing.mp4")]);
    expect(result.resolved).toEqual([]);
    expect(result.rejected.map((r) => r.code)).toEqual(["OUTSIDE_ALLOWED_ROOTS", "OUTSIDE_ALLOWED_ROOTS"]);
  });

  it("rejects .. traversal out of a root", async () => {
    const result = await read([path.join(root, "..", "Secret", "key.mp4")]);
    expect(result.rejected[0]?.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  it("rejects a symlink inside the root that points outside it", async () => {
    await fs.symlink(path.join(outside, "key.mp4"), path.join(root, "link.mp4"));
    await fs.symlink(outside, path.join(root, "linkdir"));
    const result = await read([path.join(root, "link.mp4"), path.join(root, "linkdir", "key.mp4")]);
    expect(result.resolved).toEqual([]);
    expect(result.rejected.map((r) => r.code)).toEqual(["OUTSIDE_ALLOWED_ROOTS", "OUTSIDE_ALLOWED_ROOTS"]);
  });

  it("accepts a symlink that stays inside the root, reporting the real path", async () => {
    await fs.symlink(path.join(root, "a.mp4"), path.join(root, "alias.mp4"));
    const result = await read([path.join(root, "alias.mp4")]);
    expect(result.resolved[0]?.realPath).toBe(path.join(root, "a.mp4"));
  });

  it("reports NOT_FOUND for a missing file inside a root", async () => {
    const result = await read([path.join(root, "nope.mp4")]);
    expect(result.rejected).toMatchObject([{ code: "NOT_FOUND" }]);
  });

  it("rejects relative paths and NUL bytes as INVALID_PARAMS", async () => {
    const result = await read(["a.mp4", path.join(root, "a\0.mp4")]);
    expect(result.rejected.map((r) => r.code)).toEqual(["INVALID_PARAMS", "INVALID_PARAMS"]);
  });

  it("expands a folder to its media files only; recursive controls subfolders; hidden files are skipped", async () => {
    await fs.mkdir(path.join(root, "sub"));
    await fs.writeFile(path.join(root, "sub", "b.mov"), "x");
    await fs.writeFile(path.join(root, ".hidden.mp4"), "x");
    const flat = await read([root]);
    expect(flat.resolved.map((e) => path.basename(e.path))).toEqual(["a.mp4"]);
    const deep = await read([root], true);
    expect(deep.resolved.map((e) => path.basename(e.path)).sort()).toEqual(["a.mp4", "b.mov"]);
  });

  it("skips symlinks inside a folder that escape the root and reports them", async () => {
    await fs.symlink(path.join(outside, "key.mp4"), path.join(root, "evil.mp4"));
    const result = await read([root]);
    expect(result.resolved.map((e) => path.basename(e.path))).toEqual(["a.mp4"]);
    expect(result.rejected).toMatchObject([{ code: "OUTSIDE_ALLOWED_ROOTS" }]);
  });

  it("reports UNSUPPORTED_TYPE for a folder without media", async () => {
    await fs.mkdir(path.join(root, "docs"));
    await fs.writeFile(path.join(root, "docs", "x.txt"), "x");
    const result = await read([path.join(root, "docs")]);
    expect(result.rejected).toMatchObject([{ code: "UNSUPPORTED_TYPE" }]);
  });
});

describe("resolveMcpPaths (write)", () => {
  it("accepts a new file in an allowed folder and flags exists:false", async () => {
    const result = await write([path.join(root, "out.mp4")]);
    expect(result.rejected).toEqual([]);
    expect(result.resolved[0]).toMatchObject({ kind: "file", exists: false, sizeBytes: 0 });
  });

  it("flags an existing target as exists:true", async () => {
    const result = await write([path.join(root, "a.mp4")]);
    expect(result.resolved[0]).toMatchObject({ exists: true, sizeBytes: 11 });
  });

  it("rejects a destination outside the roots and a parent that is a symlink out", async () => {
    await fs.symlink(outside, path.join(root, "linkdir"));
    const result = await write([path.join(outside, "out.mp4"), path.join(root, "linkdir", "out.mp4")]);
    expect(result.rejected.map((r) => r.code)).toEqual(["OUTSIDE_ALLOWED_ROOTS", "OUTSIDE_ALLOWED_ROOTS"]);
  });

  it("rejects a dangling symlink target and a missing parent folder", async () => {
    await fs.symlink(path.join(outside, "gone.mp4"), path.join(root, "dangling.mp4"));
    const result = await write([path.join(root, "dangling.mp4"), path.join(root, "nodir", "out.mp4")]);
    expect(result.rejected.map((r) => r.code)).toEqual(["OUTSIDE_ALLOWED_ROOTS", "NOT_FOUND"]);
  });
});

describe("placeOutput", () => {
  let temp: string;
  beforeEach(async () => {
    temp = path.join(base, "tmp");
    await fs.mkdir(temp);
  });
  const makeTemp = async (name = "openreel-export-1234.mp4", data = "exported-data"): Promise<string> => {
    const file = path.join(temp, name);
    await fs.writeFile(file, data);
    return file;
  };

  it("copies a temp export to an allowed destination and reports size and sha256", async () => {
    const from = await makeTemp();
    const to = path.join(root, "final.mp4");
    const result = await placeOutput({ from, to }, [root], temp);
    expect(result).toEqual({
      ok: true,
      path: to,
      sizeBytes: 13,
      sha256: createHash("sha256").update("exported-data").digest("hex"),
    });
    expect(await fs.readFile(to, "utf8")).toBe("exported-data");
    await expect(fs.stat(from)).resolves.toBeTruthy();
    expect((await fs.readdir(root)).some((n) => n.endsWith(".part"))).toBe(false);
  });

  it("only measures the source when no destination is given", async () => {
    const from = await makeTemp();
    const result = await placeOutput({ from }, [root], temp);
    expect(result).toEqual({ ok: true, path: from, sizeBytes: 13, sha256: createHash("sha256").update("exported-data").digest("hex") });
    expect((await fs.readdir(root)).sort()).toEqual(["a.mp4", "notes.txt"]);
  });

  it("moves the source when asked", async () => {
    const from = await makeTemp();
    const result = await placeOutput({ from, to: path.join(root, "m.mp4"), move: true }, [root], temp);
    expect(result.ok).toBe(true);
    await expect(fs.stat(from)).rejects.toThrow();
  });

  it("refuses a destination whose extension differs from the export (no clobbering other file types)", async () => {
    const from = await makeTemp();
    const docx = path.join(root, "thesis.docx");
    await fs.writeFile(docx, "my thesis");
    const result = await placeOutput({ from, to: docx, overwrite: true }, [root], temp);
    expect(result).toMatchObject({ ok: false, code: "INVALID_PARAMS" });
    expect(await fs.readFile(docx, "utf8")).toBe("my thesis");
  });

  it("refuses to overwrite unless overwrite:true", async () => {
    const from = await makeTemp();
    const to = path.join(root, "a.mp4");
    const refused = await placeOutput({ from, to }, [root], temp);
    expect(refused).toMatchObject({ ok: false, code: "INVALID_PARAMS" });
    expect(await fs.readFile(to, "utf8")).toBe("video-bytes");
    expect(await placeOutput({ from, to, overwrite: true }, [root], temp)).toMatchObject({ ok: true });
    expect(await fs.readFile(to, "utf8")).toBe("exported-data");
  });

  it("refuses a destination outside the roots", async () => {
    const from = await makeTemp();
    const result = await placeOutput({ from, to: path.join(outside, "x.mp4") }, [root], temp);
    expect(result).toMatchObject({ ok: false, code: "OUTSIDE_ALLOWED_ROOTS" });
    await expect(fs.stat(path.join(outside, "x.mp4"))).rejects.toThrow();
  });

  it("refuses a source that is not an OpenReel temp export", async () => {
    const stray = await makeTemp("passwords.txt");
    expect(await placeOutput({ from: stray, to: path.join(root, "x.txt") }, [root], temp)).toMatchObject({ ok: false, code: "INVALID_PARAMS" });
    const elsewhere = path.join(outside, "openreel-export-9.mp4");
    await fs.writeFile(elsewhere, "x");
    expect(await placeOutput({ from: elsewhere, to: path.join(root, "x.mp4") }, [root], temp)).toMatchObject({ ok: false, code: "INVALID_PARAMS" });
  });
});
