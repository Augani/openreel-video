import { vi } from "vitest";
import { existsSync } from "node:fs";

// Real ffmpeg: the bundled sidecar when present, else OPENREEL_FFMPEG_PATH, else Homebrew's. Skipped when none exists.
const candidates = [
  process.env.OPENREEL_FFMPEG_PATH,
  `${__dirname}/../resources/bin/${process.platform}-${process.arch}/ffmpeg`,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
].filter((p): p is string => Boolean(p));
const ffmpegBin = candidates.find((p) => existsSync(p));
if (ffmpegBin) process.env.OPENREEL_FFMPEG_PATH = ffmpegBin;

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectCameraCards, parseAvchdPlaylist, parseGoProName, parseP2ClipLinks } from "../../../packages/core/src/media/camera-cards";
import { readXmpFields, parseXmp, XMP_UUID, serializeXmp, applyXmpFields } from "../../../packages/core/src/media/xmp";
import { listDirectory, nodeCardFs } from "../src/main/media-browser/browse";
import { buildPreview, filmstripOf, prepareClipFile, probeClip, thumbnailOf, type ClipRef, type ToolContext } from "../src/main/media-browser/tools";
import { readXmpOfFile, sidecarPathFor, writeSidecarFor } from "../src/main/media-browser/xmp-io";

const d = ffmpegBin ? describe : describe.skip;

let work = "";
let ctx: ToolContext;

function ff(args: string[]): void {
  execFileSync(ffmpegBin!, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "pipe" });
}
/** H.264 + AAC clip; `seconds` long; a different test pattern per `hue` so segments differ. */
function mp4(out: string, seconds: number, hue = 0): void {
  mkdirSync(path.dirname(out), { recursive: true });
  ff(["-f", "lavfi", "-i", `testsrc2=s=320x180:r=25,hue=h=${hue}`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
}
function ts(out: string, seconds: number): void {
  mkdirSync(path.dirname(out), { recursive: true });
  ff(["-f", "lavfi", "-i", "testsrc2=s=320x180:r=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mpegts", out]);
}
/** DV video MXF (the only video codec ffmpeg's MXF muxer writes with these tools; P2 itself uses DVCPRO / AVC-Intra). */
function mxf(out: string, seconds: number): void {
  mkdirSync(path.dirname(out), { recursive: true });
  ff(["-f", "lavfi", "-i", "testsrc2=s=720x576:r=25", "-t", String(seconds), "-c:v", "dvvideo", "-pix_fmt", "yuv420p", "-f", "mxf", out]);
}
/** ffmpeg cannot write audio-only MXF: a PCM WAV under the .MXF name stands in (the join reads it by content). */
function audioMxf(out: string, seconds: number): void {
  mkdirSync(path.dirname(out), { recursive: true });
  ff(["-f", "lavfi", "-i", "sine=frequency=550:sample_rate=48000", "-t", String(seconds), "-c:a", "pcm_s24le", "-f", "wav", out]);
}
const write = (file: string, text: string | Uint8Array): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const sonyRoot = (): string => path.join(work, "SONY_CARD");
const avchdRoot = (): string => path.join(work, "AVCHD_CARD");
const p2Root = (): string => path.join(work, "P2_CARD");
const canonRoot = (): string => path.join(work, "CANON_CARD");
const goproRoot = (): string => path.join(work, "GOPRO_CARD");

const p2Xml = (name: string, globalId: string, rel: { top?: string; prev?: string; next?: string }): string => `<?xml version="1.0" encoding="UTF-8"?>
<P2Main xmlns="http://www.panasonic.com/P2Main"><ClipContent><ClipName>${name}</ClipName><GlobalClipID>${globalId}</GlobalClipID>
${rel.top ? `<Relation><Connection><Top><GlobalClipID>${rel.top}</GlobalClipID></Top>${rel.prev ? `<Previous><GlobalClipID>${rel.prev}</GlobalClipID></Previous>` : ""}${rel.next ? `<Next><GlobalClipID>${rel.next}</GlobalClipID></Next>` : ""}</Connection></Relation>` : ""}
</ClipContent></P2Main>`;

/** Minimal Blu-ray style playlist: the PlayItems name their clips as `NNNNNM2TS`. */
const mpl = (...ids: string[]): Uint8Array => Buffer.from(`MPLS0100\0\0\0\0${ids.map((id) => `${id}M2TS\0\0\0`).join("")}`, "latin1");

beforeAll(() => {
  if (!ffmpegBin) return;
  work = mkdtempSync(path.join(os.tmpdir(), "openreel-mb-"));
  ctx = { ffmpegPath: ffmpegBin, cacheDir: path.join(work, "cache") };

  // Sony XAVC S: PRIVATE/M4ROOT/CLIP + SUB proxy + NRT XML
  mp4(path.join(sonyRoot(), "PRIVATE/M4ROOT/CLIP/C0001.MP4"), 2);
  mp4(path.join(sonyRoot(), "PRIVATE/M4ROOT/CLIP/C0002.MP4"), 1, 90);
  mp4(path.join(sonyRoot(), "PRIVATE/M4ROOT/SUB/C0001S03.MP4"), 2);
  write(path.join(sonyRoot(), "PRIVATE/M4ROOT/CLIP/C0001M01.XML"), "<NonRealTimeMeta/>");

  // Canon XF: CONTENTS/CLIPS001
  mxf(path.join(canonRoot(), "CONTENTS/CLIPS001/AAAA001.MXF"), 1);
  write(path.join(canonRoot(), "CONTENTS/CLIPS001/AAAA001.CIF"), "x");
  write(path.join(canonRoot(), "CONTENTS/CLIPS001/AAAA001.XML"), "<x/>");
  mxf(path.join(canonRoot(), "CONTENTS/CLIPS001/AAAB002.MXF"), 1);

  // Panasonic P2: 0001AB spans into 0001AC; 0002XY stands alone
  mxf(path.join(p2Root(), "CONTENTS/VIDEO/0001AB.MXF"), 2);
  mxf(path.join(p2Root(), "CONTENTS/VIDEO/0001AC.MXF"), 1.5);
  mxf(path.join(p2Root(), "CONTENTS/VIDEO/0002XY.MXF"), 1);
  audioMxf(path.join(p2Root(), "CONTENTS/AUDIO/0001AB00.MXF"), 2);
  audioMxf(path.join(p2Root(), "CONTENTS/AUDIO/0001AC00.MXF"), 1.5);
  write(path.join(p2Root(), "CONTENTS/CLIP/0001AB.XML"), p2Xml("0001AB", "AAA1", { top: "AAA1", next: "AAA2" }));
  write(path.join(p2Root(), "CONTENTS/CLIP/0001AC.XML"), p2Xml("0001AC", "AAA2", { top: "AAA1", prev: "AAA1" }));
  write(path.join(p2Root(), "CONTENTS/CLIP/0002XY.XML"), p2Xml("0002XY", "BBB1", {}));

  // AVCHD: 00000 stands alone; 00001 + 00002 are one recording (the playlist says so)
  ts(path.join(avchdRoot(), "PRIVATE/AVCHD/BDMV/STREAM/00000.MTS"), 1);
  ts(path.join(avchdRoot(), "PRIVATE/AVCHD/BDMV/STREAM/00001.MTS"), 2);
  ts(path.join(avchdRoot(), "PRIVATE/AVCHD/BDMV/STREAM/00002.MTS"), 1.5);
  write(path.join(avchdRoot(), "PRIVATE/AVCHD/BDMV/PLAYLIST/00000.MPL"), mpl("00000"));
  write(path.join(avchdRoot(), "PRIVATE/AVCHD/BDMV/PLAYLIST/00001.MPL"), mpl("00001", "00002"));
  write(path.join(avchdRoot(), "PRIVATE/AVCHD/BDMV/CLIPINF/00001.CPI"), "x");

  // GoPro: GH010123 + GH020123 + GH030123 are one recording; GX010124 is single; LRV files are not clips
  const gp = path.join(goproRoot(), "DCIM/100GOPRO");
  mp4(path.join(gp, "GH010123.MP4"), 1.2);
  mp4(path.join(gp, "GH020123.MP4"), 1, 120);
  mp4(path.join(gp, "GH030123.MP4"), 0.8, 200);
  mp4(path.join(gp, "GX010124.MP4"), 1);
  write(path.join(gp, "GL010123.LRV"), "x");
  write(path.join(gp, "GH010123.THM"), "x");
}, 120_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("camera card name parsing", () => {
  it("parses GoPro chapter names", () => {
    expect(parseGoProName("GH010123.MP4")).toEqual({ prefix: "GH", chapter: 0, number: "0123" });
    expect(parseGoProName("GX030123.mp4")).toEqual({ prefix: "GX", chapter: 2, number: "0123" });
    expect(parseGoProName("GOPR0456.MP4")).toEqual({ prefix: "GOPR", chapter: 0, number: "0456" });
    expect(parseGoProName("GP020456.MP4")).toEqual({ prefix: "GP", chapter: 2, number: "0456" });
    expect(parseGoProName("GL010123.LRV")).toBeNull();
    expect(parseGoProName("holiday.mp4")).toBeNull();
  });
  it("reads clip numbers from an AVCHD playlist", () => {
    expect(parseAvchdPlaylist(mpl("00007", "00008"))).toEqual(["00007", "00008"]);
  });
  it("reads P2 spanning links", () => {
    const links = parseP2ClipLinks(p2Xml("0001AB", "AAA1", { top: "AAA1", next: "AAA2" }), "0001AB");
    expect(links.own).toContain("AAA1");
    expect(links.next).toBe("AAA2");
    expect(links.previous).toBeUndefined();
  });
});

d("camera card detectors on generated folder structures", () => {
  it("Sony XAVC: clips with proxy and XML sidecar", async () => {
    const [card] = await detectCameraCards(nodeCardFs(), sonyRoot());
    expect(card.kind).toBe("sony-xavc");
    expect(card.clips.map((c) => c.name)).toEqual(["C0001", "C0002"]);
    expect(card.clips[0].proxyPath).toMatch(/C0001S03\.MP4$/);
    expect(card.clips[0].sidecars[0]).toMatch(/C0001M01\.XML$/);
    expect(card.clips[1].proxyPath).toBeUndefined();
  });

  it("Canon XF: MXF clips with their sidecars", async () => {
    const [card] = await detectCameraCards(nodeCardFs(), canonRoot());
    expect(card.kind).toBe("canon-xf");
    expect(card.clips.map((c) => c.name)).toEqual(["AAAA001", "AAAB002"]);
    expect(card.clips[0].sidecars.map((s) => path.extname(s)).sort()).toEqual([".CIF", ".XML"]);
  });

  it("Panasonic P2: the spanned clip is one clip with its audio files", async () => {
    const [card] = await detectCameraCards(nodeCardFs(), p2Root());
    expect(card.kind).toBe("panasonic-p2");
    expect(card.clips.map((c) => [c.name, c.segments.length])).toEqual([["0001AB", 2], ["0002XY", 1]]);
    const spanned = card.clips[0];
    expect(spanned.spanned).toBe(true);
    expect(spanned.segments.map((s) => s.name)).toEqual(["0001AB.MXF", "0001AC.MXF"]);
    expect(spanned.segments[0].audioPaths?.[0]).toMatch(/0001AB00\.MXF$/);
    expect(card.clips[1].spanned).toBe(false);
  });

  it("AVCHD: playlist-linked streams are one clip", async () => {
    const [card] = await detectCameraCards(nodeCardFs(), avchdRoot());
    expect(card.kind).toBe("avchd");
    expect(card.clips.map((c) => [c.name, c.segments.map((s) => s.name)])).toEqual([
      ["00000", ["00000.MTS"]],
      ["00001", ["00001.MTS", "00002.MTS"]],
    ]);
  });

  it("GoPro: chapters are joined in order, LRV and THM are ignored", async () => {
    const [card] = await detectCameraCards(nodeCardFs(), goproRoot());
    expect(card.kind).toBe("gopro");
    expect(card.clips.map((c) => [c.name, c.segments.map((s) => s.name)])).toEqual([
      ["GH0123", ["GH010123.MP4", "GH020123.MP4", "GH030123.MP4"]],
      ["GX0124", ["GX010124.MP4"]],
    ]);
  });

  it("an ordinary folder is not a card", async () => {
    expect(await detectCameraCards(nodeCardFs(), path.join(sonyRoot(), "PRIVATE"))).toEqual([]);
  });

  it("the browser lists a card's clips instead of its folders, and its folders on request", async () => {
    const clips = await listDirectory(avchdRoot());
    expect(clips.card?.kinds[0].label).toBe("AVCHD");
    expect(clips.entries.every((e) => e.kind === "clip")).toBe(true);
    expect(clips.entries.map((e) => e.name)).toEqual(["00000", "00001"]);
    const raw = await listDirectory(avchdRoot(), { rawFolders: true });
    expect(raw.card).toBeUndefined();
    expect(raw.entries.map((e) => [e.kind, e.name])).toEqual([["dir", "PRIVATE"]]);
  });

  it("a plain folder groups GoPro chapters into one clip and hides non-media", async () => {
    const listing = await listDirectory(path.join(goproRoot(), "DCIM/100GOPRO"), { rawFolders: true });
    expect(listing.entries.map((e) => [e.kind, e.name])).toEqual([["clip", "GH0123"], ["file", "GX010124.MP4"]]);
  });
});

d("spanned clips are joined with the right duration", () => {
  const near = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThan(0.2);
  const clipRef = async (root: string, name: string): Promise<ClipRef> => {
    const [card] = await detectCameraCards(nodeCardFs(), root);
    const clip = card.clips.find((c) => c.name === name)!;
    return { name: clip.name, kind: clip.kind, segments: clip.segments.map((s) => ({ path: s.path, ...(s.audioPaths ? { audioPaths: s.audioPaths } : {}) })) };
  };

  it("GoPro chapters: durations add up and the original files are untouched", async () => {
    const ref = await clipRef(goproRoot(), "GH0123");
    const before = ref.segments.map((s) => createHash("sha256").update(readFileSync(s.path)).digest("hex"));
    const probe = await probeClip(ctx, ref);
    near(probe.duration, 3.0);
    expect(probe.segmentDurations.length).toBe(3);
    const joined = await prepareClipFile(ctx, ref);
    expect(joined.joined).toBe(true);
    expect(joined.name).toBe("GH0123.mp4");
    near(joined.duration, 3.0);
    const reuse = await prepareClipFile(ctx, ref);
    expect(reuse.path).toBe(joined.path);
    expect(ref.segments.map((s) => createHash("sha256").update(readFileSync(s.path)).digest("hex"))).toEqual(before);
  });

  it("AVCHD spanned streams join into one transport stream", async () => {
    const ref = await clipRef(avchdRoot(), "00001");
    const joined = await prepareClipFile(ctx, ref);
    expect(joined.name).toBe("00001.MTS".replace("MTS", "mts"));
    near(joined.duration, 3.5);
    const probe = await probeClip(ctx, { ...ref, segments: [{ path: joined.path }] });
    near(probe.duration, 3.5);
  });

  it("P2 spanned video joins with its audio channels into one MXF", async () => {
    const ref = await clipRef(p2Root(), "0001AB");
    const joined = await prepareClipFile(ctx, ref);
    expect(path.extname(joined.path)).toBe(".mxf");
    near(joined.duration, 3.5);
    const info = spawnSync(ffmpegBin!, ["-hide_banner", "-i", joined.path], { encoding: "utf8" }).stderr;
    expect(info).toMatch(/Video: dvvideo/);
    expect(info).toMatch(/Audio: pcm_s24le/);
  }, 30_000);

  it("a single-file clip is imported from where it is, without a copy", async () => {
    const ref = await clipRef(sonyRoot(), "C0001");
    const result = await prepareClipFile(ctx, ref);
    expect(result.joined).toBe(false);
    expect(result.path).toBe(ref.segments[0].path);
    near(result.duration, 2);
  });

  it("thumbnails and hover-scrub frames come from the right segment", async () => {
    const ref = await clipRef(goproRoot(), "GH0123");
    const thumb = await thumbnailOf(ctx, ref.segments[0].path, 0.5, 160);
    expect(thumb?.startsWith("data:image/jpeg;base64,")).toBe(true);
    const strip = await filmstripOf(ctx, ref, 6, 120);
    near(strip.duration, 3.0);
    expect(strip.frames.length).toBe(6);
    expect(strip.frames.every((f) => f && f.length > 200)).toBe(true);
    // Frames from different chapters (different hue) differ.
    expect(new Set(strip.frames).size).toBeGreaterThan(3);
  });

  it("the preview of a spanned clip plays all of it", async () => {
    const ref = await clipRef(avchdRoot(), "00001");
    const preview = await buildPreview(ctx, ref);
    expect(preview.truncated).toBe(false);
    near(preview.duration, 3.5);
    const probe = await probeClip(ctx, { name: "p", kind: "x", segments: [{ path: preview.path }] });
    near(probe.duration, 3.5);
    expect(probe.height).toBe(360);
  });
});

d("XMP on disk", () => {
  const u32 = (n: number): Buffer => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

  it("reads an embedded uuid box, writes a sidecar and never touches the media", async () => {
    const file = path.join(work, "xmp", "A001_C002.mp4");
    mp4(file, 1);
    const packet = serializeXmp(applyXmpFields(null, { description: "Hero walks in", keywords: ["night", "interior"], scene: "12A", reel: "A001" }));
    const payload = Buffer.concat([Buffer.from(XMP_UUID), Buffer.from(packet, "utf8")]);
    appendFileSync(file, Buffer.concat([u32(8 + payload.length), Buffer.from("uuid"), payload]));
    const mediaHash = (): string => createHash("sha256").update(readFileSync(file)).digest("hex");
    const before = mediaHash();

    const read = (await readXmpOfFile(file))!;
    expect(read.source).toBe("embedded");
    expect(read.fields).toMatchObject({ description: "Hero walks in", keywords: ["night", "interior"], scene: "12A", reel: "A001" });

    const sidecar = await writeSidecarFor(file, { keywords: ["night", "interior", "street"], take: "4", good: true });
    expect(sidecar).toBe(sidecarPathFor(file));
    expect(path.basename(sidecar)).toBe("A001_C002.xmp");
    const fields = readXmpFields(parseXmp(readFileSync(sidecar, "utf8"))!);
    expect(fields).toMatchObject({ keywords: ["night", "interior", "street"], take: "4", good: true });
    expect(mediaHash()).toBe(before);

    // The sidecar overrides the embedded packet field by field on the next read.
    const again = (await readXmpOfFile(file))!;
    expect(again.source).toBe("sidecar");
    expect(again.fields.keywords).toEqual(["night", "interior", "street"]);
    expect(again.fields.description).toBe("Hero walks in");
    expect(again.fields.take).toBe("4");

    // Updating the sidecar keeps what it already had and clears what is emptied.
    await writeSidecarFor(file, { scene: "" , logComment: "keep" });
    const updated = readXmpFields(parseXmp(readFileSync(sidecar, "utf8"))!);
    expect(updated).toMatchObject({ take: "4", logComment: "keep", keywords: ["night", "interior", "street"] });
    expect(updated.scene).toBeUndefined();
  });

  it("returns null when a file has no XMP and refuses to write a sidecar for a missing file", async () => {
    const file = path.join(work, "xmp", "plain.mp4");
    mp4(file, 1);
    expect(await readXmpOfFile(file)).toBeNull();
    await expect(writeSidecarFor(path.join(work, "xmp", "gone.mp4"), { scene: "1" })).rejects.toThrow(/not on disk/);
  });
});
