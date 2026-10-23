/** Rows of the user's Director's Eyes library ⇒ items the editor can import. Pure helpers are tested. */
export type HawshKind = "image" | "video";
export type HawshSource = "generations" | "references";

export interface HawshItem {
  key: string;
  kind: HawshKind;
  source: HawshSource;
  title: string;
  /** Media URL: public for generations, storage path for references (signed later). */
  url: string | null;
  path?: string;
  thumb: string | null;
  createdAt: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clean = (t: unknown, fallback: string) => {
  const s = str(t).replace(/\s+/g, " ").trim();
  return s ? (s.length > 60 ? `${s.slice(0, 59)}…` : s) : fallback;
};

export function imageJobItems(rows: ReadonlyArray<Record<string, unknown>>): HawshItem[] {
  return rows.flatMap((r) => {
    const list = Array.isArray(r.image_urls) ? (r.image_urls as Array<{ imageURL?: unknown }>) : [];
    const urls = list.map((u) => str(u?.imageURL)).filter(Boolean);
    const title = clean(r.title || r.prompt, "Image");
    return urls.map((url, i) => ({
      key: `img:${str(r.id)}:${i}`, kind: "image" as const, source: "generations" as const,
      title: urls.length > 1 ? `${title} (${i + 1})` : title, url, thumb: url, createdAt: str(r.created_at),
    }));
  });
}

export function videoJobItems(rows: ReadonlyArray<Record<string, unknown>>): HawshItem[] {
  return rows.flatMap((r) => {
    const url = str(r.video_url);
    if (!url) return [];
    const frames = Array.isArray(r.frame_urls) ? (r.frame_urls as unknown[]).map(str).filter(Boolean) : [];
    return [{
      key: `vid:${str(r.request_id) || str(r.id)}`, kind: "video" as const, source: "generations" as const,
      title: clean(r.title || r.prompt, "Video"), url, thumb: frames[0] ?? null, createdAt: str(r.created_at),
    }];
  });
}

export function referenceItems(rows: ReadonlyArray<Record<string, unknown>>): HawshItem[] {
  return rows.flatMap((r) => {
    const kind = r.kind === "video" ? "video" : r.kind === "image" ? "image" : null;
    const path = str(r.path);
    if (!kind || !path) return [];
    return [{
      key: `ref:${str(r.id)}`, kind, source: "references" as const, title: clean(r.title, kind === "video" ? "Video" : "Image"),
      url: null, path, thumb: null, createdAt: str(r.created_at),
    }];
  });
}

/** File name for an imported item: title + extension from the URL (fallback by kind). */
export function importFileName(item: Pick<HawshItem, "title" | "kind">, url: string, mime: string): string {
  const fromUrl = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  const fromMime = mime.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov");
  const ext = fromUrl || fromMime || (item.kind === "video" ? "mp4" : "png");
  const base = item.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || item.kind;
  return `${base}.${ext}`;
}

/** Exports the library accepts: MP4 or MOV, non-empty, within the bucket limit. Returns a reason or null. */
export function exportProblem(blob: Pick<Blob, "size" | "type">, filename: string, maxBytes: number): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  const isMp4 = blob.type === "video/mp4" || ext === "mp4";
  const isMov = blob.type === "video/quicktime" || ext === "mov";
  if (!isMp4 && !isMov) return "Only MP4 or MOV exports can be saved to your library. Export as MP4 and try again.";
  if (blob.size <= 0) return "The export is empty.";
  if (blob.size > maxBytes) return `The export is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, the library limit. Export a shorter or smaller video.`;
  return null;
}
