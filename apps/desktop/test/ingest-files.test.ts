import { vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyIntoFolder, hashFile } from "../src/main/ingest/copy-ingest";
import { isOwnProxyFileName, isPreviewTwinName, isReadableProxyPath, resolveIngestFolders } from "../src/main/ingest/folders";
import { parseFfmpegProbe } from "../src/main/ingest/probe-media";
import { buildProxyArgs, parseProgressSeconds } from "../src/main/ingest/proxy-args";
import { scanFolderForMedia } from "../src/main/ingest/relink-scan";
import { desktopProxyFileName } from "../../../packages/core/src/media/desktop-ingest";

let work = "";
beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "oringest-"));
});
afterAll(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe("parseFfmpegProbe", () => {
  const h264 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 8000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 3840x2160 [SAR 1:1 DAR 16:9], 7800 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)`;
  it("reads duration, size, frame rate, codec and audio", () => {
    expect(parseFfmpegProbe(h264)).toEqual({
      duration: 62.5, width: 3840, height: 2160, frameRate: 29.97, videoCodec: "h264", hasVideo: true, hasAudio: true,
      container: "mov,mp4,m4a,3gp,3g2,mj2", audioStreams: [{ codec: "aac", channels: 2, sampleRate: 48000 }],
    });
  });
  it("handles ProRes, stills, audio-only and cover art", () => {
    const prores = "  Duration: 00:00:05.00, start: 0.0, bitrate: 1 kb/s\n  Stream #0:0[0x1](eng): Video: prores (Proxy) (apco / 0x6F637061), yuv422p10le(tv, bt709, progressive), 1920x1080, 25 fps, 25 tbr, 25 tbn";
    expect(parseFfmpegProbe(prores)).toMatchObject({ width: 1920, height: 1080, frameRate: 25, videoCodec: "prores", hasAudio: false });
    const still = "  Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: png, rgba(pc, gbr/unknown/unknown), 800x600, 25 tbr, 25 tbn";
    expect(parseFfmpegProbe(still)).toMatchObject({ width: 800, height: 600, frameRate: 25, hasVideo: true });
    expect(parseFfmpegProbe(still).duration).toBeUndefined();
    const audio = "  Duration: 00:03:00.00, start: 0, bitrate: 320 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s\n  Stream #0:1: Video: mjpeg, yuvj420p, 500x500, 90k tbr (attached pic)";
    expect(parseFfmpegProbe(audio)).toMatchObject({ hasVideo: false, hasAudio: true, duration: 180 });
  });
});

describe("buildProxyArgs", () => {
  const base = { srcPath: "/in.mov", outPath: "/o/x.mov.part", srcWidth: 3840, srcHeight: 2160, threads: 2 };
  it("ProRes 422 Proxy: prores_ks profile 0, 10-bit 4:2:2, half size, mov", () => {
    const args = buildProxyArgs({ ...base, profile: { codec: "prores-proxy", size: "half" } });
    expect(args.join(" ")).toContain("-vf scale=1920:1080:flags=bicubic,format=yuv422p10le");
    expect(args).toEqual(expect.arrayContaining(["-c:v", "prores_ks", "-profile:v", "0", "-f", "mov"]));
    expect(args.at(-1)).toBe("-nostats");
    expect(args[args.indexOf("-progress") + 1]).toBe("pipe:1");
  });
  it("H.264: yuv420p, short GOP for scrubbing, faststart mp4, quarter size", () => {
    const args = buildProxyArgs({ ...base, outPath: "/o/x.mp4.part", profile: { codec: "h264", size: "quarter" } });
    expect(args.join(" ")).toContain("scale=960:540");
    expect(args).toEqual(expect.arrayContaining(["libx264", "-g", "12", "+faststart", "mp4"]));
  });
  it("720p fixes the height and never upscales", () => {
    expect(buildProxyArgs({ ...base, profile: { codec: "h264", size: "720p" } }).join(" ")).toContain("scale=1280:720");
    expect(buildProxyArgs({ ...base, srcWidth: 1280, srcHeight: 720, profile: { codec: "h264", size: "1080p" } }).join(" ")).toContain("scale=1280:720");
  });
  it("ProRes with a preview twin decodes once and writes two outputs", () => {
    const args = buildProxyArgs({ ...base, previewOutPath: "/o/x.preview.mp4.part", profile: { codec: "prores-proxy", size: "half" } });
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).toContain("-filter_complex");
    expect(args).toContain("/o/x.mov.part");
    expect(args).toContain("/o/x.preview.mp4.part");
  });
  it("drops hwaccel on the retry and refuses an unknown source size", () => {
    expect(buildProxyArgs({ ...base, hwaccel: false, profile: { codec: "h264", size: "half" } })).not.toContain("-hwaccel");
    expect(buildProxyArgs({ ...base, profile: { codec: "h264", size: "half" } })).toContain("-hwaccel");
    expect(() => buildProxyArgs({ ...base, srcWidth: 0, srcHeight: 0, profile: { codec: "h264", size: "half" } })).toThrow(/unknown/);
  });
  it("parses progress seconds from the last block", () => {
    expect(parseProgressSeconds("frame=1\nout_time_us=1500000\nprogress=continue\nframe=2\nout_time_us=2500000\n")).toBe(2.5);
    expect(parseProgressSeconds("out_time_us=N/A")).toBeNull();
    expect(parseProgressSeconds("")).toBeNull();
  });
});

describe("resolveIngestFolders", () => {
  it("puts Proxies and Media beside the saved project", () => {
    // Expectations are built with path.resolve/join: on Windows "/work/film" resolves to "<drive>:\\work\\film".
    const dir = path.resolve("/work/film");
    const f = resolveIngestFolders({ projectPath: path.join(dir, "cut.oreel"), projectId: "p", userDataDir: path.resolve("/ud") });
    expect(f).toEqual({ projectDir: dir, proxyDir: path.join(dir, "Proxies"), mediaDir: path.join(dir, "Media"), projectSaved: true });
  });
  it("honours absolute and project-relative overrides", () => {
    const dir = path.resolve("/work/film");
    const fast = path.resolve("/fast/ssd/prx");
    const f = resolveIngestFolders({ projectPath: path.join(dir, "cut.oreel"), projectId: "p", userDataDir: path.resolve("/ud"), config: { proxyFolder: fast, mediaFolder: "Footage/Copies" } });
    expect(f.proxyDir).toBe(fast);
    expect(f.mediaDir).toBe(path.join(dir, "Footage", "Copies"));
  });
  it("falls back to the app data folder for an unsaved project", () => {
    const f = resolveIngestFolders({ projectId: "my/proj:1", userDataDir: path.resolve("/ud") });
    expect(f.projectSaved).toBe(false);
    expect(f.proxyDir).toBe(path.join(path.resolve("/ud"), "Ingest", "my_proj_1", "Proxies"));
  });
  it("recognises only this app's proxy file names for read-back", () => {
    expect(isOwnProxyFileName(desktopProxyFileName({ id: "abc", name: "x.mov" }, { codec: "prores-proxy", size: "half" }))).toBe(true);
    expect(isOwnProxyFileName("x_half_proxy.preview.mp4")).toBe(true);
    expect(isOwnProxyFileName("passwords.txt")).toBe(false);
    expect(isOwnProxyFileName("id_rsa")).toBe(false);
  });
  it("lets only video containers through the proxy read-back channel", () => {
    for (const ok of ["A001_proxy.mov", "cam.MP4", "x.mxf", "x_half_proxy.preview.mp4"]) expect(isReadableProxyPath(ok), ok).toBe(true);
    for (const bad of ["passwords.txt", "id_rsa", "notes.json", "x.mov.txt", ".env"]) expect(isReadableProxyPath(bad), bad).toBe(false);
    expect(isPreviewTwinName("x_half_proxy.preview.mp4")).toBe(true);
    expect(isPreviewTwinName("x_half_proxy.mov")).toBe(false);
  });
});

describe("copyIntoFolder", () => {
  const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
  it("copies, verifies the checksum, never touches the original and reports progress", async () => {
    const src = path.join(work, "orig", "clip.mov");
    await fs.mkdir(path.dirname(src), { recursive: true });
    const data = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    await fs.writeFile(src, data);
    const before = await fs.stat(src);
    const progress: number[] = [];
    const out = await copyIntoFolder({ srcPath: src, destDir: path.join(work, "proj", "Media"), onProgress: (p) => progress.push(p) });
    expect(out).toMatchObject({ size: data.length, sha256: sha(data), alreadyInPlace: false });
    expect(path.basename(out.destPath)).toBe("clip.mov");
    expect(sha(await fs.readFile(out.destPath))).toBe(sha(data));
    // Original untouched.
    const after = await fs.stat(src);
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(await fs.readdir(path.join(work, "proj", "Media"))).toEqual(["clip.mov"]);
  });
  it("numbers a name that is already taken instead of overwriting", async () => {
    const src = path.join(work, "orig2", "clip.mov");
    await fs.mkdir(path.dirname(src), { recursive: true });
    await fs.writeFile(src, "second");
    const dest = path.join(work, "proj2", "Media");
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "clip.mov"), "existing");
    const out = await copyIntoFolder({ srcPath: src, destDir: dest });
    expect(path.basename(out.destPath)).toBe("clip (2).mov");
    expect(await fs.readFile(path.join(dest, "clip.mov"), "utf8")).toBe("existing");
  });
  it("does not copy a file that already lives in the media folder", async () => {
    const dest = path.join(work, "proj3", "Media");
    await fs.mkdir(dest, { recursive: true });
    const src = path.join(dest, "in.mov");
    await fs.writeFile(src, "abc");
    const out = await copyIntoFolder({ srcPath: src, destDir: dest });
    expect(out).toMatchObject({ alreadyInPlace: true, destPath: src, sha256: sha(Buffer.from("abc")) });
    expect(await fs.readdir(dest)).toEqual(["in.mov"]);
  });
  it("leaves nothing behind when the source is unreadable, and refuses a directory", async () => {
    const dest = path.join(work, "proj4", "Media");
    await expect(copyIntoFolder({ srcPath: path.join(work, "nope.mov"), destDir: dest })).rejects.toThrow();
    await expect(copyIntoFolder({ srcPath: work, destDir: dest })).rejects.toThrow(/Only files/);
    expect(existsSync(dest) ? await fs.readdir(dest) : []).toEqual([]);
  });
  it("aborts cleanly and removes the partial copy", async () => {
    const src = path.join(work, "orig5", "big.mov");
    await fs.mkdir(path.dirname(src), { recursive: true });
    await fs.writeFile(src, Buffer.alloc(8 * 1024 * 1024, 1));
    const controller = new AbortController();
    controller.abort();
    const dest = path.join(work, "proj5", "Media");
    await expect(copyIntoFolder({ srcPath: src, destDir: dest, signal: controller.signal })).rejects.toThrow();
    expect(await fs.readdir(dest)).toEqual([]);
    expect(existsSync(src)).toBe(true);
  });
  it("hashFile matches crypto", async () => {
    const p = path.join(work, "h.bin");
    await fs.writeFile(p, "hello");
    expect(await hashFile(p)).toBe(sha(Buffer.from("hello")));
  });
});

describe("scanFolderForMedia", () => {
  it("walks the tree, probes only files whose name matches, skips hidden folders", async () => {
    const root = path.join(work, "scan");
    for (const f of ["a/Clip1.MOV", "a/b/clip2.mp4", "a/other.mov", ".hidden/clip1.mov", "c/Clip1_proxy.mp4", "c/notes.txt"]) {
      await fs.mkdir(path.dirname(path.join(root, f)), { recursive: true });
      await fs.writeFile(path.join(root, f), "x");
    }
    const probed: string[] = [];
    const probe = async (p: string) => {
      probed.push(path.relative(root, p));
      return { hasVideo: true, hasAudio: false, duration: 4, frameRate: 25, width: 640, height: 360 };
    };
    const media = await scanFolderForMedia({ root, names: ["clip1.mov", "Clip2.mp4"], mode: "media", probe });
    expect(media.candidates.map((c) => c.name).sort()).toEqual(["Clip1.MOV", "clip2.mp4"]);
    expect(probed.sort()).toEqual([path.join("a", "Clip1.MOV"), path.join("a", "b", "clip2.mp4")]);
    expect(media.candidates[0]).toMatchObject({ duration: 4, frameRate: 25, width: 640 });
    const proxies = await scanFolderForMedia({ root, names: ["Clip1.mov"], mode: "proxy", probe });
    expect(proxies.candidates.map((c) => c.name).sort()).toEqual(["Clip1.MOV", "Clip1_proxy.mp4"]);
    // The preview twin of a ProRes proxy is not offered as a second proxy.
    await fs.writeFile(path.join(root, "c", "Clip1_half_proxy.preview.mp4"), "x");
    const again = await scanFolderForMedia({ root, names: ["Clip1.mov"], mode: "proxy", probe });
    expect(again.candidates.map((c) => c.name)).not.toContain("Clip1_half_proxy.preview.mp4");
  });
  it("stops at the depth limit and reports truncation; an unprobeable file has no duration", async () => {
    const root = path.join(work, "deep");
    const deep = path.join(root, "1", "2", "3", "4");
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "z.mov"), "x");
    await fs.writeFile(path.join(root, "z.mov"), "x");
    const r = await scanFolderForMedia({ root, names: ["z.mov"], mode: "media", probe: async () => null, maxDepth: 2 });
    expect(r.truncated).toBe(true);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].duration).toBeUndefined();
  });
});
