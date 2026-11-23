/**
 * Camera card structures: Sony XAVC (PRIVATE/M4ROOT) and XDCAM (PRIVATE/XDROOT), Canon XF
 * (CONTENTS/CLIPS001), Panasonic P2 (CONTENTS/VIDEO), AVCHD (PRIVATE/AVCHD/BDMV/STREAM) and GoPro
 * chaptered recordings. A card is recognised from its folder layout and shown as clips, not folders;
 * a recording the camera split across several files (P2 spanned clips, AVCHD 2 / 4 GB splits, GoPro
 * chapters) is ONE clip with its segments in playing order.
 *
 * Pure: file access goes through `CardFs`, so the desktop app (Node), the browser (File System Access
 * handles) and the tests (generated folders) share the same detectors.
 */

export interface CardDirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export interface CardFs {
  /** Entries of a folder, or null when it does not exist / cannot be read. */
  list(dir: string): Promise<CardDirEntry[] | null>;
  join(...parts: string[]): string;
  /** First `maxBytes` of a file as bytes (small metadata files only), or null. */
  readBytes(path: string, maxBytes: number): Promise<Uint8Array | null>;
}

export type CardKind = "sony-xavc" | "sony-xdcam" | "canon-xf" | "panasonic-p2" | "avchd" | "gopro";

export const CARD_LABELS: Record<CardKind, string> = {
  "sony-xavc": "Sony XAVC",
  "sony-xdcam": "Sony XDCAM",
  "canon-xf": "Canon XF",
  "panasonic-p2": "Panasonic P2",
  avchd: "AVCHD",
  gopro: "GoPro",
};

export interface CardClipSegment {
  path: string;
  name: string;
  size: number;
  /** Panasonic P2: the audio MXF files that belong to this video segment (one per channel). */
  audioPaths?: string[];
}

export interface CardClip {
  /** Stable id: kind plus the first segment's path. */
  id: string;
  /** Clip name (file stem; the first chapter's number for GoPro). */
  name: string;
  kind: CardKind;
  /** In playing order; more than one means the camera split the recording. */
  segments: CardClipSegment[];
  spanned: boolean;
  /** Camera-made proxy file (Sony SUB, P2 PROXY), when the card has one. */
  proxyPath?: string;
  /** Sidecar metadata files next to the clip (Sony / Canon XML, P2 XML). */
  sidecars: string[];
  /** Sum of the segment sizes, bytes. */
  size: number;
  modifiedMs: number;
}

export interface CardDetection {
  kind: CardKind;
  label: string;
  root: string;
  clips: CardClip[];
}

const upper = (s: string): string => s.toUpperCase();
const ext = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const stem = (name: string): string => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);
const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true });

async function child(fs: CardFs, dir: string, name: string): Promise<{ path: string; entries: CardDirEntry[] } | null> {
  const entries = await fs.list(dir);
  const hit = entries?.find((e) => e.isDir && upper(e.name) === upper(name));
  if (!hit) return null;
  const path = fs.join(dir, hit.name);
  const inner = await fs.list(path);
  return inner ? { path, entries: inner } : null;
}

async function walk(fs: CardFs, dir: string, names: string[]): Promise<{ path: string; entries: CardDirEntry[] } | null> {
  let path = dir;
  let entries: CardDirEntry[] | null = null;
  for (const name of names) {
    const next = await child(fs, path, name);
    if (!next) return null;
    path = next.path;
    entries = next.entries;
  }
  return entries ? { path, entries } : null;
}

function makeClip(kind: CardKind, name: string, segments: CardClipSegment[], extra: Partial<Pick<CardClip, "proxyPath" | "sidecars">> = {}, mtimeMs = 0): CardClip {
  return {
    id: `${kind}:${segments[0]?.path ?? name}`,
    name,
    kind,
    segments,
    spanned: segments.length > 1,
    ...(extra.proxyPath ? { proxyPath: extra.proxyPath } : {}),
    sidecars: extra.sidecars ?? [],
    size: segments.reduce((n, s) => n + s.size, 0),
    modifiedMs: mtimeMs,
  };
}

const isMxf = (e: CardDirEntry): boolean => !e.isDir && ext(e.name) === "mxf";

// ---------------------------------------------------------------------------
// Sony
// ---------------------------------------------------------------------------

/** PRIVATE/M4ROOT: CLIP/C0001.MP4, SUB/C0001S03.MP4 (proxy), CLIP/C0001M01.XML (NRT metadata). */
async function detectSonyXavc(fs: CardFs, root: string): Promise<CardDetection | null> {
  const clipDir = await walk(fs, root, ["PRIVATE", "M4ROOT", "CLIP"]);
  if (!clipDir) return null;
  const sub = await walk(fs, root, ["PRIVATE", "M4ROOT", "SUB"]);
  const clips: CardClip[] = [];
  for (const entry of clipDir.entries.filter((e) => !e.isDir && ["mp4", "mov"].includes(ext(e.name))).sort(byName)) {
    const id = stem(entry.name);
    const xml = clipDir.entries.find((e) => upper(e.name) === upper(`${id}M01.XML`));
    const proxy = sub?.entries.find((e) => !e.isDir && upper(stem(e.name)).startsWith(upper(id)) && /S\d\d$/i.test(stem(e.name)));
    clips.push(
      makeClip(
        "sony-xavc",
        id,
        [{ path: fs.join(clipDir.path, entry.name), name: entry.name, size: entry.size }],
        { sidecars: xml ? [fs.join(clipDir.path, xml.name)] : [], ...(proxy && sub ? { proxyPath: fs.join(sub.path, proxy.name) } : {}) },
        entry.mtimeMs,
      ),
    );
  }
  return clips.length ? { kind: "sony-xavc", label: CARD_LABELS["sony-xavc"], root, clips } : null;
}

/** PRIVATE/XDROOT/Clip/*.MXF (XDCAM). */
async function detectSonyXdcam(fs: CardFs, root: string): Promise<CardDetection | null> {
  const clipDir = await walk(fs, root, ["PRIVATE", "XDROOT", "Clip"]);
  if (!clipDir) return null;
  const clips = clipDir.entries
    .filter(isMxf)
    .sort(byName)
    .map((entry) => {
      const id = stem(entry.name);
      const xml = clipDir.entries.find((e) => upper(e.name) === upper(`${id}M01.XML`));
      return makeClip("sony-xdcam", id, [{ path: fs.join(clipDir.path, entry.name), name: entry.name, size: entry.size }], { sidecars: xml ? [fs.join(clipDir.path, xml.name)] : [] }, entry.mtimeMs);
    });
  return clips.length ? { kind: "sony-xdcam", label: CARD_LABELS["sony-xdcam"], root, clips } : null;
}

// ---------------------------------------------------------------------------
// Canon XF
// ---------------------------------------------------------------------------

/** CONTENTS/CLIPS001/AAAA001.MXF (or one folder per clip) with .CIF / .XML / .BIM sidecars. */
async function detectCanonXf(fs: CardFs, root: string): Promise<CardDetection | null> {
  const contents = await child(fs, root, "CONTENTS");
  if (!contents) return null;
  const clips: CardClip[] = [];
  for (const folder of contents.entries.filter((e) => e.isDir && /^CLIPS\d+$/i.test(e.name)).sort(byName)) {
    const dir = fs.join(contents.path, folder.name);
    const entries = (await fs.list(dir)) ?? [];
    const collect = async (where: string, list: CardDirEntry[]): Promise<void> => {
      for (const entry of list.filter(isMxf).sort(byName)) {
        const id = stem(entry.name);
        const sidecars = list.filter((e) => !e.isDir && stem(e.name).toUpperCase() === id.toUpperCase() && ["cif", "xml", "bim", "thm"].includes(ext(e.name))).map((e) => fs.join(where, e.name));
        clips.push(makeClip("canon-xf", id, [{ path: fs.join(where, entry.name), name: entry.name, size: entry.size }], { sidecars }, entry.mtimeMs));
      }
    };
    await collect(dir, entries);
    for (const sub of entries.filter((e) => e.isDir).sort(byName)) {
      const subDir = fs.join(dir, sub.name);
      await collect(subDir, (await fs.list(subDir)) ?? []);
    }
  }
  return clips.length ? { kind: "canon-xf", label: CARD_LABELS["canon-xf"], root, clips } : null;
}

// ---------------------------------------------------------------------------
// Panasonic P2
// ---------------------------------------------------------------------------

interface P2Links {
  own: string[];
  top?: string;
  previous?: string;
  next?: string;
}

const tag = (xml: string, name: string): string | undefined => new RegExp(`<${name}[^>]*>\\s*([^<]*?)\\s*</${name}>`, "i").exec(xml)?.[1] || undefined;
const block = (xml: string, name: string): string | undefined => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1];
const idIn = (xml: string | undefined): string | undefined => (xml ? (tag(xml, "GlobalClipID") ?? tag(xml, "ClipID") ?? tag(xml, "ClipName")) : undefined);

/** Spanned-clip links of a P2 clip XML: `Relation/Connection` with `Top`, `Previous` and `Next` references. */
export function parseP2ClipLinks(xml: string, fallbackName: string): P2Links {
  const connection = block(xml, "Connection");
  const withoutConnection = connection ? xml.replace(connection, "") : xml;
  const own = [tag(withoutConnection, "GlobalClipID"), tag(withoutConnection, "ClipName"), fallbackName].filter((v): v is string => !!v);
  return {
    own,
    top: idIn(block(connection ?? "", "Top")),
    previous: idIn(block(connection ?? "", "Previous")),
    next: idIn(block(connection ?? "", "Next")),
  };
}

/** CONTENTS/VIDEO/0001AB.MXF, AUDIO/0001AB00.MXF.., CLIP/0001AB.XML, PROXY/0001AB.MP4. */
async function detectP2(fs: CardFs, root: string): Promise<CardDetection | null> {
  const video = await walk(fs, root, ["CONTENTS", "VIDEO"]);
  if (!video) return null;
  const audio = await walk(fs, root, ["CONTENTS", "AUDIO"]);
  const clipMeta = await walk(fs, root, ["CONTENTS", "CLIP"]);
  const proxy = await walk(fs, root, ["CONTENTS", "PROXY"]);
  interface Node {
    segment: CardClipSegment;
    name: string;
    sidecar?: string;
    proxy?: string;
    links: P2Links;
    mtimeMs: number;
  }
  const nodes: Node[] = [];
  for (const entry of video.entries.filter(isMxf).sort(byName)) {
    const name = stem(entry.name);
    const audioPaths = (audio?.entries ?? [])
      .filter((e) => isMxf(e) && upper(stem(e.name)).startsWith(upper(name)) && stem(e.name).length === name.length + 2)
      .sort(byName)
      .map((e) => fs.join(audio!.path, e.name));
    const xmlEntry = clipMeta?.entries.find((e) => !e.isDir && upper(e.name) === upper(`${name}.XML`));
    const proxyEntry = proxy?.entries.find((e) => !e.isDir && upper(stem(e.name)) === upper(name));
    let links: P2Links = { own: [name] };
    if (xmlEntry && clipMeta) {
      const bytes = await fs.readBytes(fs.join(clipMeta.path, xmlEntry.name), 256 * 1024);
      if (bytes) links = parseP2ClipLinks(new TextDecoder().decode(bytes), name);
    }
    nodes.push({
      segment: { path: fs.join(video.path, entry.name), name: entry.name, size: entry.size, ...(audioPaths.length ? { audioPaths } : {}) },
      name,
      sidecar: xmlEntry && clipMeta ? fs.join(clipMeta.path, xmlEntry.name) : undefined,
      proxy: proxyEntry && proxy ? fs.join(proxy.path, proxyEntry.name) : undefined,
      links,
      mtimeMs: entry.mtimeMs,
    });
  }
  // Chain clips through Previous / Next references; a clip with neither starts and ends its own chain.
  const byKey = new Map<string, Node>();
  for (const node of nodes) for (const key of node.links.own) byKey.set(key, node);
  const resolve = (key: string | undefined): Node | undefined => (key ? byKey.get(key) : undefined);
  const prevOf = new Map<Node, Node>();
  const nextOf = new Map<Node, Node>();
  for (const node of nodes) {
    const next = resolve(node.links.next);
    const prev = resolve(node.links.previous);
    if (next && next !== node) {
      nextOf.set(node, next);
      prevOf.set(next, node);
    }
    if (prev && prev !== node) {
      prevOf.set(node, prev);
      nextOf.set(prev, node);
    }
  }
  const seen = new Set<Node>();
  const clips: CardClip[] = [];
  for (const node of nodes) {
    if (seen.has(node) || prevOf.has(node)) continue;
    const chain: Node[] = [];
    for (let cursor: Node | undefined = node; cursor && !seen.has(cursor); cursor = nextOf.get(cursor)) {
      chain.push(cursor);
      seen.add(cursor);
    }
    clips.push(
      makeClip(
        "panasonic-p2",
        chain[0].name,
        chain.map((n) => n.segment),
        { sidecars: chain.flatMap((n) => (n.sidecar ? [n.sidecar] : [])), ...(chain[0].proxy ? { proxyPath: chain[0].proxy } : {}) },
        chain[0].mtimeMs,
      ),
    );
  }
  // Anything caught in a cycle (corrupt links) still shows as its own clip.
  for (const node of nodes) if (!seen.has(node)) clips.push(makeClip("panasonic-p2", node.name, [node.segment], { sidecars: node.sidecar ? [node.sidecar] : [] }, node.mtimeMs));
  clips.sort(byName);
  return clips.length ? { kind: "panasonic-p2", label: CARD_LABELS["panasonic-p2"], root, clips } : null;
}

// ---------------------------------------------------------------------------
// AVCHD
// ---------------------------------------------------------------------------

/** Clip numbers an AVCHD / Blu-ray playlist (`.MPL`) lists, in order: each PlayItem names `NNNNNM2TS`. */
export function parseAvchdPlaylist(bytes: Uint8Array): string[] {
  let latin = "";
  for (let i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);
  const ids: string[] = [];
  const pattern = /(\d{5})M2TS/g;
  for (let match = pattern.exec(latin); match; match = pattern.exec(latin)) ids.push(match[1]);
  return ids;
}

/** Cameras start a new stream file at 2 GB (FAT) / 4 GB; used only when the card has no playlist for a pair. */
const AVCHD_SPLIT_BYTES = 1.9e9;

/** PRIVATE/AVCHD/BDMV (or AVCHD/BDMV, BDMV): STREAM/00001.MTS, PLAYLIST/00001.MPL, CLIPINF/. */
async function detectAvchd(fs: CardFs, root: string): Promise<CardDetection | null> {
  const bdmv =
    (await walk(fs, root, ["PRIVATE", "AVCHD", "BDMV"])) ?? (await walk(fs, root, ["AVCHD", "BDMV"])) ?? (await walk(fs, root, ["BDMV"]));
  if (!bdmv) return null;
  const stream = await walk(fs, bdmv.path, ["STREAM"]);
  if (!stream) return null;
  const files = stream.entries.filter((e) => !e.isDir && ["mts", "m2ts"].includes(ext(e.name))).sort(byName);
  if (!files.length) return null;
  const byId = new Map(files.map((e) => [stem(e.name), e]));
  const playlists = await walk(fs, bdmv.path, ["PLAYLIST"]);
  const groups: string[][] = [];
  const grouped = new Set<string>();
  for (const entry of (playlists?.entries ?? []).filter((e) => !e.isDir && ["mpl", "mpls"].includes(ext(e.name))).sort(byName)) {
    const bytes = await fs.readBytes(fs.join(playlists!.path, entry.name), 256 * 1024);
    if (!bytes) continue;
    const ids = [...new Set(parseAvchdPlaylist(bytes))].filter((id) => byId.has(id) && !grouped.has(id));
    if (ids.length > 1) {
      groups.push(ids);
      for (const id of ids) grouped.add(id);
    }
  }
  // No playlist says so: consecutive stream numbers where the earlier file is a full split.
  if (!playlists) {
    for (let i = 0; i < files.length - 1; i++) {
      const a = files[i];
      const b = files[i + 1];
      if (a.size >= AVCHD_SPLIT_BYTES && Number(stem(b.name)) === Number(stem(a.name)) + 1) {
        const last = groups[groups.length - 1];
        if (last && last[last.length - 1] === stem(a.name)) last.push(stem(b.name));
        else groups.push([stem(a.name), stem(b.name)]);
        grouped.add(stem(a.name));
        grouped.add(stem(b.name));
      }
    }
  }
  const clips: CardClip[] = [];
  const clipInfo = await walk(fs, bdmv.path, ["CLIPINF"]);
  const sidecarFor = (id: string): string[] => {
    const hit = clipInfo?.entries.find((e) => !e.isDir && stem(e.name) === id);
    return hit && clipInfo ? [fs.join(clipInfo.path, hit.name)] : [];
  };
  const seg = (e: CardDirEntry): CardClipSegment => ({ path: fs.join(stream.path, e.name), name: e.name, size: e.size });
  for (const e of files) {
    const id = stem(e.name);
    if (grouped.has(id)) continue;
    clips.push(makeClip("avchd", id, [seg(e)], { sidecars: sidecarFor(id) }, e.mtimeMs));
  }
  for (const ids of groups) {
    const entries = ids.map((id) => byId.get(id)!);
    clips.push(makeClip("avchd", ids[0], entries.map(seg), { sidecars: ids.flatMap(sidecarFor) }, entries[0].mtimeMs));
  }
  clips.sort(byName);
  return { kind: "avchd", label: CARD_LABELS.avchd, root, clips };
}

// ---------------------------------------------------------------------------
// GoPro
// ---------------------------------------------------------------------------

export interface GoProName {
  /** Recording number (0123 in GH010123.MP4). */
  number: string;
  /** 0 for the first file, then 1, 2, ... */
  chapter: number;
  prefix: string;
}

/** `GH010123.MP4` / `GX020123.MP4` (HERO6+), `GOPR0123.MP4` + `GP010123.MP4` (HERO3-5). LRV / THM are not clips. */
export function parseGoProName(name: string): GoProName | null {
  const modern = /^(G[HXL])(\d{2})(\d{4})\.(mp4|mov)$/i.exec(name);
  if (modern) return { prefix: upper(modern[1]), chapter: Number(modern[2]) - 1, number: modern[3] };
  const first = /^(GOPR)(\d{4})\.(mp4|mov)$/i.exec(name);
  if (first) return { prefix: "GOPR", chapter: 0, number: first[2] };
  const later = /^(GP)(\d{2})(\d{4})\.(mp4|mov)$/i.exec(name);
  if (later) return { prefix: "GP", chapter: Number(later[2]), number: later[3] };
  return null;
}

/** Group a folder's GoPro chapters into clips. Files that are not GoPro names are returned in `rest`. */
export function groupGoProChapters(dir: string, entries: readonly CardDirEntry[], join: (...parts: string[]) => string): { clips: CardClip[]; rest: CardDirEntry[] } {
  const groups = new Map<string, Array<{ entry: CardDirEntry; parsed: GoProName }>>();
  const rest: CardDirEntry[] = [];
  for (const entry of entries) {
    const parsed = entry.isDir ? null : parseGoProName(entry.name);
    if (!parsed) {
      rest.push(entry);
      continue;
    }
    const key = parsed.number;
    const list = groups.get(key) ?? [];
    list.push({ entry, parsed });
    groups.set(key, list);
  }
  const clips: CardClip[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.parsed.chapter - b.parsed.chapter);
    const first = list[0];
    const prefix = first.parsed.prefix === "GOPR" || first.parsed.prefix === "GP" ? "GOPR" : first.parsed.prefix;
    clips.push(
      makeClip(
        "gopro",
        `${prefix}${first.parsed.number}`,
        list.map(({ entry }) => ({ path: join(dir, entry.name), name: entry.name, size: entry.size })),
        {},
        first.entry.mtimeMs,
      ),
    );
  }
  clips.sort(byName);
  return { clips, rest };
}

/** DCIM/100GOPRO/*.MP4: a GoPro card is recognised by its `NNNGOPRO` folders. */
async function detectGoPro(fs: CardFs, root: string): Promise<CardDetection | null> {
  const dcim = await child(fs, root, "DCIM");
  if (!dcim) return null;
  const clips: CardClip[] = [];
  for (const folder of dcim.entries.filter((e) => e.isDir && /GOPRO$/i.test(e.name)).sort(byName)) {
    const dir = fs.join(dcim.path, folder.name);
    const entries = (await fs.list(dir)) ?? [];
    clips.push(...groupGoProChapters(dir, entries, fs.join).clips);
  }
  return clips.length ? { kind: "gopro", label: CARD_LABELS.gopro, root, clips } : null;
}

// ---------------------------------------------------------------------------

/**
 * Recognise a camera card (or a copy of its folder structure) rooted at `root`. Returns one detection
 * per structure found, so a card that carries more than one (rare) shows all of its clips.
 */
export async function detectCameraCards(fs: CardFs, root: string): Promise<CardDetection[]> {
  const found = await Promise.all([detectSonyXavc(fs, root), detectSonyXdcam(fs, root), detectCanonXf(fs, root), detectP2(fs, root), detectAvchd(fs, root), detectGoPro(fs, root)]);
  return found.filter((d): d is CardDetection => d !== null);
}

/** Convenience for callers that want a single answer. */
export async function detectCameraCard(fs: CardFs, root: string): Promise<CardDetection | null> {
  return (await detectCameraCards(fs, root))[0] ?? null;
}
