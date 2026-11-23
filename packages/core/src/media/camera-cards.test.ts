import { describe, expect, it } from "vitest";
import { detectCameraCards, groupGoProChapters, parseAvchdPlaylist, parseGoProName, parseP2ClipLinks, type CardDirEntry, type CardFs } from "./camera-cards";

/** An in-memory card: a map of "a/b/c" paths to either a size (file) or null (folder). */
function memoryFs(files: Record<string, number | string | Uint8Array>): CardFs {
  const dirs = new Set<string>([""]);
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const norm = (p: string): string => p.replace(/^\/+|\/+$/g, "");
  return {
    join: (...parts) => parts.filter(Boolean).join("/"),
    async list(dir): Promise<CardDirEntry[] | null> {
      const d = norm(dir);
      if (!dirs.has(d)) return null;
      const out = new Map<string, CardDirEntry>();
      for (const path of [...Object.keys(files), ...dirs]) {
        if (!path || (d && !path.startsWith(`${d}/`))) continue;
        const rest = d ? path.slice(d.length + 1) : path;
        const [first, ...tail] = rest.split("/");
        if (!first) continue;
        const isDir = tail.length > 0 || dirs.has(path);
        const value = files[path];
        out.set(first, { name: first, isDir, size: isDir ? 0 : typeof value === "number" ? value : 1, mtimeMs: 1 });
      }
      return [...out.values()];
    },
    async readBytes(path): Promise<Uint8Array | null> {
      const value = files[norm(path)];
      if (value === undefined) return null;
      return typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(0);
    },
  };
}

describe("camera cards (in-memory structures)", () => {
  it("AVCHD without a playlist joins consecutive full-size splits (the 2 GB / 4 GB camera split)", async () => {
    const fs = memoryFs({
      "PRIVATE/AVCHD/BDMV/STREAM/00010.MTS": 2_000_000_000,
      "PRIVATE/AVCHD/BDMV/STREAM/00011.MTS": 2_000_000_000,
      "PRIVATE/AVCHD/BDMV/STREAM/00012.MTS": 700_000_000,
      "PRIVATE/AVCHD/BDMV/STREAM/00020.MTS": 500_000_000,
    });
    const [card] = await detectCameraCards(fs, "");
    expect(card.clips.map((c) => c.segments.map((s) => s.name))).toEqual([["00010.MTS", "00011.MTS", "00012.MTS"], ["00020.MTS"]]);
    expect(card.clips[0].spanned).toBe(true);
  });

  it("AVCHD with playlists ignores the size heuristic", async () => {
    const mpl = new TextEncoder().encode("MPLS0100....00001M2TS...");
    const fs = memoryFs({
      "AVCHD/BDMV/STREAM/00001.MTS": 2_000_000_000,
      "AVCHD/BDMV/STREAM/00002.MTS": 100,
      "AVCHD/BDMV/PLAYLIST/00001.MPL": mpl,
    });
    const [card] = await detectCameraCards(fs, "");
    expect(card.clips.map((c) => c.segments.length)).toEqual([1, 1]);
  });

  it("Sony XDCAM clips and P2 clips without XML stand alone", async () => {
    const xdcam = await detectCameraCards(memoryFs({ "PRIVATE/XDROOT/Clip/C0001.MXF": 10, "PRIVATE/XDROOT/Clip/C0001M01.XML": "<x/>" }), "");
    expect(xdcam[0].kind).toBe("sony-xdcam");
    expect(xdcam[0].clips[0].sidecars).toHaveLength(1);
    const p2 = await detectCameraCards(memoryFs({ "CONTENTS/VIDEO/0001AB.MXF": 10, "CONTENTS/VIDEO/0002AB.MXF": 10 }), "");
    expect(p2[0].clips.map((c) => c.name)).toEqual(["0001AB", "0002AB"]);
  });

  it("P2 chains three clips through Previous / Next in order and survives a link cycle", async () => {
    const xml = (name: string, gid: string, prev?: string, next?: string): string =>
      `<P2Main><ClipContent><ClipName>${name}</ClipName><GlobalClipID>${gid}</GlobalClipID><Relation><Connection><Top><GlobalClipID>G1</GlobalClipID></Top>${prev ? `<Previous><GlobalClipID>${prev}</GlobalClipID></Previous>` : ""}${next ? `<Next><GlobalClipID>${next}</GlobalClipID></Next>` : ""}</Connection></Relation></ClipContent></P2Main>`;
    const fs = memoryFs({
      "CONTENTS/VIDEO/0003AA.MXF": 10,
      "CONTENTS/VIDEO/0001AA.MXF": 10,
      "CONTENTS/VIDEO/0002AA.MXF": 10,
      "CONTENTS/CLIP/0001AA.XML": xml("0001AA", "G1", undefined, "G2"),
      "CONTENTS/CLIP/0002AA.XML": xml("0002AA", "G2", "G1", "G3"),
      "CONTENTS/CLIP/0003AA.XML": xml("0003AA", "G3", "G2"),
    });
    const [card] = await detectCameraCards(fs, "");
    expect(card.clips).toHaveLength(1);
    expect(card.clips[0].segments.map((s) => s.name)).toEqual(["0001AA.MXF", "0002AA.MXF", "0003AA.MXF"]);

    const cyc = memoryFs({
      "CONTENTS/VIDEO/0001AA.MXF": 10,
      "CONTENTS/VIDEO/0002AA.MXF": 10,
      "CONTENTS/CLIP/0001AA.XML": xml("0001AA", "G1", "G2", "G2"),
      "CONTENTS/CLIP/0002AA.XML": xml("0002AA", "G2", "G1", "G1"),
    });
    const [cycCard] = await detectCameraCards(cyc, "");
    expect(cycCard.clips.map((c) => c.segments.length).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("GoPro: legacy GOPR / GP naming groups per recording number", () => {
    const entry = (name: string): CardDirEntry => ({ name, isDir: false, size: 5, mtimeMs: 1 });
    const { clips, rest } = groupGoProChapters("d", [entry("GP020456.MP4"), entry("GOPR0456.MP4"), entry("GP010456.MP4"), entry("GOPR0457.MP4"), entry("notes.txt")], (...p) => p.join("/"));
    expect(clips.map((c) => [c.name, c.segments.map((s) => s.name)])).toEqual([
      ["GOPR0456", ["GOPR0456.MP4", "GP010456.MP4", "GP020456.MP4"]],
      ["GOPR0457", ["GOPR0457.MP4"]],
    ]);
    expect(rest.map((e) => e.name)).toEqual(["notes.txt"]);
    expect(parseGoProName("GX010001.mov")?.number).toBe("0001");
  });

  it("helpers: playlist ids and P2 links", () => {
    expect(parseAvchdPlaylist(new TextEncoder().encode("xx00003M2TSyy00004M2TS"))).toEqual(["00003", "00004"]);
    expect(parseP2ClipLinks("<Clip><GlobalClipID>A</GlobalClipID></Clip>", "N").own).toEqual(["A", "N"]);
  });
});
