import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkLocalMediaPath, readLocalMedia, LOCAL_MEDIA_MAX_BYTES } from "./local-media";

describe("checkLocalMediaPath (win32)", () => {
  const ok = (p: string) => expect(checkLocalMediaPath(p, "win32"), p).toBeNull();
  const bad = (p: string) => expect(checkLocalMediaPath(p, "win32"), p).not.toBeNull();

  it("accepts absolute drive paths to media files", () => {
    ok("C:\\media\\a.mp4");
    ok("D:/footage/b.WAV");
    ok("C:\\Users\\me\\My Clips\\c d.png");
  });

  it("rejects relative paths", () => {
    bad("clip.mp4");
    bad("media\\clip.mp4");
    bad("..\\clip.mp4");
    bad("C:clip.mp4");
    bad("");
  });

  it("rejects UNC paths, which make Windows authenticate to a remote host", () => {
    bad("\\\\attacker.example.com\\share\\bait.mp4");
    bad("//attacker.example.com/share/bait.mp4");
  });

  it("rejects device namespace paths", () => {
    bad("\\\\?\\C:\\media\\a.mp4");
    bad("\\\\.\\PhysicalDrive0.mp4");
  });

  it("rejects alternate data streams, which name a hidden stream of another file", () => {
    bad("C:\\Users\\me\\secrets.txt:x.mp4");
    bad("C:\\media\\a.mp4::$DATA");
  });

  it("rejects trailing dots and spaces, which Windows strips before opening", () => {
    bad("C:\\media\\secret.txt .mp4.");
    bad("C:\\media\\a.mp4 ");
  });

  it("rejects non-media extensions and extensionless files", () => {
    bad("C:\\Users\\me\\.ssh\\id_rsa");
    bad("C:\\a\\notes.txt");
    bad("C:\\a\\archive.mp4.zip");
  });
});

describe("checkLocalMediaPath (posix)", () => {
  it("accepts absolute paths and rejects relative ones", () => {
    expect(checkLocalMediaPath("/Users/me/c.mov", "darwin")).toBeNull();
    expect(checkLocalMediaPath("footage/c.mov", "darwin")).not.toBeNull();
    expect(checkLocalMediaPath("/home/me/.env", "linux")).not.toBeNull();
  });
});

describe("readLocalMedia", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "openreel-local-media-"));
    await writeFile(path.join(dir, "clip.mp4"), Buffer.from([1, 2, 3, 4]));
    await writeFile(path.join(dir, "secret.txt"), "top secret");
    await mkdir(path.join(dir, "folder.mp4"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the bytes and file name of a media file", async () => {
    const res = await readLocalMedia({ path: path.join(dir, "clip.mp4") });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.name).toBe("clip.mp4");
    expect([...new Uint8Array(res.bytes)]).toEqual([1, 2, 3, 4]);
  });

  it("refuses a missing file with a readable error", async () => {
    const res = await readLocalMedia({ path: path.join(dir, "gone.mp4") });
    expect(res).toMatchObject({ ok: false });
  });

  it("refuses a directory named like a media file", async () => {
    const res = await readLocalMedia({ path: path.join(dir, "folder.mp4") });
    expect(res).toMatchObject({ ok: false });
  });

  it("refuses a symlink named like media that points at a non-media file", async (ctx) => {
    const link = path.join(dir, "evil.mp4");
    try {
      await symlink(path.join(dir, "secret.txt"), link, "file");
    } catch {
      ctx.skip(); // Windows without symlink privilege
    }
    const res = await readLocalMedia({ path: link });
    expect(res).toMatchObject({ ok: false });
  });

  it("refuses files over the size cap without reading them", async () => {
    const res = await readLocalMedia({ path: path.join(dir, "clip.mp4") }, { maxBytes: 3 });
    expect(res).toMatchObject({ ok: false });
    expect(LOCAL_MEDIA_MAX_BYTES).toBeGreaterThan(100 * 1024 * 1024);
  });
});
