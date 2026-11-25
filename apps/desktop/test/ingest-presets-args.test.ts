import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildProxyArgs, burnInFilters, drawtextRate, escapeDrawtextValue } from "../src/main/ingest/proxy-args";
import { pickBurnInFont } from "../src/main/ingest/proxy-runner";
import { proxyOutDir } from "../src/main/ingest/folders";
import { BUILTIN_INGEST_PRESETS } from "../../../packages/core/src/media/ingest-presets";
import { isOwnProxyFileName } from "../src/main/ingest/folders";
import { desktopProxyFileName } from "../../../packages/core/src/media/desktop-ingest";
import type { DesktopProxyProfile } from "../../../packages/core/src/types/project";

const base = { srcPath: "/in.mov", outPath: "/o.mov.part", srcWidth: 3840, srcHeight: 2160, threads: 2 };
const after = (args: string[], flag: string, from = 0): string => args[args.indexOf(flag, from) + 1];
const filterOf = (args: string[]): string => after(args, "-vf");

describe("proxy ffmpeg arguments per codec", () => {
  const cases: Array<[DesktopProxyProfile["codec"], string, string]> = [
    ["prores-proxy", "0", "yuv422p10le"],
    ["prores-lt", "1", "yuv422p10le"],
    ["prores-422", "2", "yuv422p10le"],
  ];
  for (const [codec, profileNumber, pixFmt] of cases) {
    it(`${codec}: prores_ks profile ${profileNumber}, ${pixFmt}, PCM audio, mov`, () => {
      const a = buildProxyArgs({ ...base, profile: { codec, size: "half" } });
      expect(after(a, "-c:v")).toBe("prores_ks");
      expect(after(a, "-profile:v")).toBe(profileNumber);
      expect(filterOf(a)).toContain(`format=${pixFmt}`);
      expect(after(a, "-c:a")).toBe("pcm_s16le");
      expect(after(a, "-f")).toBe("mov");
    });
  }
  for (const [codec, profile] of [["dnxhr-lb", "dnxhr_lb"], ["dnxhr-sq", "dnxhr_sq"]] as const) {
    it(`${codec}: dnxhd encoder, profile ${profile}, 8-bit 4:2:2`, () => {
      const a = buildProxyArgs({ ...base, profile: { codec, size: "half" } });
      expect(after(a, "-c:v")).toBe("dnxhd");
      expect(after(a, "-profile:v")).toBe(profile);
      expect(filterOf(a)).toContain("format=yuv422p");
      expect(filterOf(a)).not.toContain("10le");
    });
  }
  it("H.264 writes AAC and a faststart mp4", () => {
    const a = buildProxyArgs({ ...base, outPath: "/o.mp4.part", profile: { codec: "h264", size: "half" } });
    expect(after(a, "-c:v")).toBe("libx264");
    expect(after(a, "-c:a")).toBe("aac");
    expect(a).toContain("+faststart");
    expect(after(a, "-f")).toBe("mp4");
  });
});

describe("proxy ffmpeg arguments per size", () => {
  const scaleOf = (size: DesktopProxyProfile["size"], customWidth?: number, w = 3840, h = 2160): string =>
    /scale=(\d+:\d+)/.exec(filterOf(buildProxyArgs({ ...base, srcWidth: w, srcHeight: h, profile: { codec: "h264", size, ...(customWidth ? { customWidth } : {}) } })))![1];
  it("full keeps the source size, half and quarter divide it", () => {
    expect(scaleOf("full")).toBe("3840:2160");
    expect(scaleOf("half")).toBe("1920:1080");
    expect(scaleOf("quarter")).toBe("960:540");
  });
  it("fixed heights never upscale", () => {
    expect(scaleOf("720p")).toBe("1280:720");
    expect(scaleOf("1080p", undefined, 1280, 720)).toBe("1280:720");
  });
  it("custom width keeps the aspect ratio, rounds to even and never upscales", () => {
    expect(scaleOf("custom", 1000)).toBe("1000:562");
    expect(scaleOf("custom", 641)).toBe("642:360");
    expect(scaleOf("custom", 5000, 1920, 1080)).toBe("1920:1080");
  });
  it("the frame rate is never changed: no -r and no fps filter", () => {
    const a = buildProxyArgs({ ...base, profile: { codec: "prores-proxy", size: "half" } });
    expect(a).not.toContain("-r");
    expect(filterOf(a)).not.toContain("fps=");
  });
});

describe("audio keep or strip", () => {
  it("keep maps the first audio stream when there is one", () => {
    const a = buildProxyArgs({ ...base, profile: { codec: "prores-lt", size: "half" } });
    expect(a).toContain("0:a:0?");
    expect(a).not.toContain("-an");
  });
  it("strip writes no audio at all, with or without the preview twin", () => {
    for (const codec of ["h264", "prores-proxy", "dnxhr-lb"] as const) {
      const a = buildProxyArgs({ ...base, profile: { codec, size: "half", audio: "strip" }, ...(codec === "h264" ? {} : { previewOutPath: "/p.mp4.part" }) });
      expect(a).toContain("-an");
      expect(a).not.toContain("0:a:0?");
      expect(a).not.toContain("-c:a");
    }
  });
});

describe("burn-in", () => {
  const font = "/fonts/Mono.ttf";
  const spec = { ...base, fontFile: font, clipName: "Interview A", startTimecode: "01:02:03:04", frameRate: 25 };
  it("clip name only: one drawtext with the name, no timecode filter", () => {
    const filters = burnInFilters({ ...spec, profile: { codec: "h264", size: "half", burnIn: { clipName: true } } }, 1080);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain("text='Interview A'");
    expect(filters[0]).toContain("expansion=none");
    expect(filters[0]).not.toContain("timecode=");
  });
  it("timecode only: starts at the source start timecode at the source rate", () => {
    const filters = burnInFilters({ ...spec, profile: { codec: "h264", size: "half", burnIn: { timecode: true } } }, 1080);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain("timecode='01\\:02\\:03\\:04'");
    expect(filters[0]).toContain("rate=25");
  });
  it("both: name top-left, timecode bottom-left, after the scale and before the pixel format", () => {
    const a = buildProxyArgs({ ...spec, outPath: "/o.mp4.part", profile: { codec: "h264", size: "half", burnIn: { clipName: true, timecode: true } } });
    const vf = filterOf(a);
    expect(vf.indexOf("scale=")).toBeLessThan(vf.indexOf("drawtext="));
    expect(vf.indexOf("drawtext=")).toBeLessThan(vf.indexOf("format=yuv420p"));
    expect((vf.match(/drawtext=/g) ?? []).length).toBe(2);
  });
  it("the preview twin carries the burn-in too (one chain, then the split)", () => {
    const a = buildProxyArgs({ ...spec, previewOutPath: "/p.mp4.part", profile: { codec: "prores-proxy", size: "half", burnIn: { clipName: true } } });
    const graph = after(a, "-filter_complex");
    expect(graph.indexOf("drawtext=")).toBeLessThan(graph.indexOf("split=2"));
  });
  it("NTSC and drop-frame timecode use exact rates", () => {
    expect(drawtextRate(29.97)).toBe("30000/1001");
    expect(drawtextRate(23.976)).toBe("24000/1001");
    expect(drawtextRate(25)).toBe("25");
    expect(drawtextRate(undefined)).toBe("25");
    const [tc] = burnInFilters({ ...spec, startTimecode: "10:00:00;02", frameRate: 29.97, profile: { codec: "h264", size: "half", burnIn: { timecode: true } } }, 720);
    expect(tc).toContain("timecode='10\\:00\\:00;02'");
    expect(tc).toContain("rate=30000/1001");
  });
  it("a start timecode that is not a timecode falls back to zero", () => {
    const [tc] = burnInFilters({ ...spec, startTimecode: "garbage", profile: { codec: "h264", size: "half", burnIn: { timecode: true } } }, 720);
    expect(tc).toContain("timecode='00\\:00\\:00\\:00'");
  });
  it("clip names with quotes, colons, percent signs and backslashes cannot break out of the option", () => {
    expect(escapeDrawtextValue("It's a: b\\c%{x}")).toBe("It\u2019s a\\: b/c%{x}");
    expect(escapeDrawtextValue("line\nbreak")).toBe("line break");
  });
  it("refuses burn-in without a font, and adds nothing when burn-in is off", () => {
    expect(() => buildProxyArgs({ ...base, profile: { codec: "h264", size: "half", burnIn: { clipName: true } } })).toThrow(/font/i);
    expect(filterOf(buildProxyArgs({ ...base, profile: { codec: "h264", size: "half" } }))).not.toContain("drawtext");
    expect(burnInFilters({ ...base, profile: { codec: "h264", size: "half", burnIn: {} } }, 1080)).toEqual([]);
  });
  it("picks the first installed font for the platform", () => {
    expect(pickBurnInFont("darwin", (f) => f.endsWith("Helvetica.ttc"))).toBe("/System/Library/Fonts/Helvetica.ttc");
    expect(pickBurnInFont("win32", () => true)).toBe("C:/Windows/Fonts/consola.ttf");
    expect(pickBurnInFont("linux", () => false)).toBeUndefined();
  });
});

describe("destination folders", () => {
  const profile = (destination?: DesktopProxyProfile["destination"]): DesktopProxyProfile => ({ codec: "h264", size: "half", ...(destination ? { destination } : {}) });
  it("project (the default) uses the project's Proxies folder", () => {
    expect(proxyOutDir(profile(), "/proj/Proxies", "/media/a.mov")).toBe("/proj/Proxies");
    expect(proxyOutDir(profile({ mode: "project" }), "/proj/Proxies", "/media/a.mov")).toBe("/proj/Proxies");
  });
  it("next to media uses a Proxies folder beside the file", () => {
    expect(proxyOutDir(profile({ mode: "media" }), "/proj/Proxies", "/media/day1/a.mov")).toBe(path.resolve("/media/day1/Proxies"));
  });
  it("custom uses the chosen folder, absolute or relative to the project", () => {
    expect(proxyOutDir(profile({ mode: "custom", folder: path.resolve("/Volumes/Fast/prx") }), "/proj/Proxies", "/media/a.mov")).toBe(path.resolve("/Volumes/Fast/prx"));
    expect(proxyOutDir(profile({ mode: "custom", folder: "cache" }), "/proj/Proxies", "/media/a.mov", "/proj")).toBe(path.resolve("/proj/cache"));
  });
});

describe("proxy file names", () => {
  it("keep the original name for plain profiles and differ between presets of one clip", () => {
    const item = { id: "abcdef123456", name: "A001.mov" };
    expect(desktopProxyFileName(item, { codec: "h264", size: "half" })).toBe("A001-abcdef12_half_proxy.mp4");
    const names = BUILTIN_INGEST_PRESETS.map((p) => desktopProxyFileName(item, p.profile));
    expect(new Set(names).size).toBe(names.length);
    expect(desktopProxyFileName(item, { codec: "prores-lt", size: "custom", customWidth: 1280, burnIn: { timecode: true }, audio: "strip" })).toBe("A001-abcdef12_w1280-lt-tc-na_proxy.mov");
  });
  it("are recognised as this app's own proxies", () => {
    const item = { id: "abcdef123456", name: "A001.mov" };
    for (const preset of BUILTIN_INGEST_PRESETS) expect(isOwnProxyFileName(desktopProxyFileName(item, preset.profile))).toBe(true);
    expect(isOwnProxyFileName(desktopProxyFileName(item, { codec: "h264", size: "custom", customWidth: 800 }))).toBe(true);
    expect(isOwnProxyFileName("holiday.mp4")).toBe(false);
  });
});

describe("burn-in drop-frame timecode", () => {
  const spec = (frameRate: number) => ({ ...base, profile: { codec: "h264", size: "half", burnIn: { timecode: true } } as DesktopProxyProfile, startTimecode: "01:00:00;00", frameRate, fontFile: "/f.ttf" });
  it("keeps the drop-frame separator at 29.97 and 59.94", () => {
    expect(burnInFilters(spec(30000 / 1001), 1080).join()).toContain("01\\:00\\:00\;00");
    expect(burnInFilters(spec(60000 / 1001), 1080).join()).toContain("01\\:00\\:00\;00");
  });
  it("falls back to non-drop at other rates, which ffmpeg would refuse", () => {
    expect(burnInFilters(spec(25), 1080).join()).toContain("01\\:00\\:00\\:00");
    expect(burnInFilters(spec(24), 1080).join()).not.toContain(";00:");
  });
});
