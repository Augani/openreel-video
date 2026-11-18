import type { StockMediaSource } from "@openreel/core";

export interface StockFootage {
  id: string;
  title: string;
  thumbnailUrl?: string;
  duration: number;
  sources: { url: string; mime: string; width: number; height: number }[];
  credit: StockMediaSource;
}

interface StockFootagePage {
  items: StockFootage[];
  nextOffset?: number;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" ? (value as RecordValue) : {};
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function safeUrl(value: unknown, hosts: readonly string[]): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !hosts.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  // Detached HTML is never rendered or attached to the application document.
  const doc = new DOMParser().parseFromString(
    value.slice(0, 20000),
    "text/html",
  );
  doc
    .querySelectorAll("script,style,img,iframe,object")
    .forEach((node) => node.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function parseFootage(value: unknown): StockFootage | undefined {
  const page = record(value);
  const info = record(
    Array.isArray(page.videoinfo) ? page.videoinfo[0] : undefined,
  );
  if (info.mediatype !== "VIDEO") return;
  const metadata = record(info.extmetadata);
  const field = (name: string) => plainText(record(metadata[name]).value);
  const pageUrl = safeUrl(info.descriptionurl, ["commons.wikimedia.org"]);
  const license = field("LicenseShortName");
  if (!pageUrl || !license || !number(page.pageid)) return;
  const sources: StockFootage["sources"] = [];
  const addSource = (
    urlValue: unknown,
    mimeValue: unknown,
    width: unknown,
    height: unknown,
  ) => {
    const url = safeUrl(urlValue, ["upload.wikimedia.org"]);
    const mime =
      typeof mimeValue === "string" ? mimeValue.split(";")[0].trim() : "";
    if (
      url &&
      ["video/webm", "video/mp4", "video/ogg"].includes(mime) &&
      number(width) &&
      number(height)
    ) {
      if (!sources.some((source) => source.url === url))
        sources.push({
          url,
          mime,
          width: number(width),
          height: number(height),
        });
    }
  };
  if (Array.isArray(info.derivatives))
    for (const item of info.derivatives) {
      const derivative = record(item);
      addSource(
        derivative.src,
        derivative.type,
        derivative.width,
        derivative.height,
      );
    }
  addSource(
    info.url,
    info.mime === "application/ogg" ? "video/ogg" : info.mime,
    info.width,
    info.height,
  );
  if (!sources.length) return;
  sources.sort((a, b) => a.height - b.height || a.width - b.width);
  const title =
    field("ObjectName") || plainText(page.title).replace(/^File:/, "");
  const rawLicenseUrl = record(metadata.LicenseUrl).value;
  const licenseUrl = safeUrl(
    typeof rawLicenseUrl === "string"
      ? rawLicenseUrl.replace(/^http:/, "https:")
      : undefined,
    ["creativecommons.org", "www.creativecommons.org"],
  );
  const id = `commons-${page.pageid}`;
  return {
    id,
    title,
    duration: number(info.duration),
    sources,
    thumbnailUrl: safeUrl(info.thumburl, [
      "thumb.wikimedia.org",
      "upload.wikimedia.org",
    ]),
    credit: {
      provider: "wikimedia-commons",
      id,
      title,
      creator: field("Artist") || "Creator listed on source page",
      pageUrl,
      license,
      ...(licenseUrl ? { licenseUrl } : {}),
    },
  };
}

/** Search only runs while Footage is open; thumbnails load lazily, video on demand. */
export async function searchStockFootage(
  query: string,
  signal: AbortSignal,
  offset = 0,
): Promise<StockFootagePage> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    maxlag: "5",
    generator: "search",
    gsrsearch: `${query.trim().slice(0, 200) || "nature"} filetype:video`,
    gsrnamespace: "6",
    gsrlimit: "8",
    gsroffset: String(Math.max(0, Math.floor(offset))),
    prop: "videoinfo",
    viprop: "url|size|mime|mediatype|extmetadata|derivatives",
    viurlwidth: "320",
    viextmetadatafilter: "ObjectName|Artist|LicenseShortName|LicenseUrl",
  }).toString();
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error(
      `Footage search is unavailable (${response.status}). Try again.`,
    );
  const data = record(await response.json());
  if (data.error)
    throw new Error("Footage search is temporarily unavailable. Try again.");
  const pages = record(data.query).pages;
  if (pages !== undefined && !Array.isArray(pages))
    throw new Error(
      "Footage search returned an unreadable response. Try again.",
    );
  const sorted = [...(Array.isArray(pages) ? pages : [])].sort(
    (a, b) => number(record(a).index) - number(record(b).index),
  );
  const nextOffset = record(data.continue).gsroffset;
  return {
    items: sorted
      .map(parseFootage)
      .filter((item): item is StockFootage => Boolean(item)),
    ...(typeof nextOffset === "number" &&
    Number.isInteger(nextOffset) &&
    nextOffset > offset
      ? { nextOffset }
      : {}),
  };
}

export function preferredFootageSource(item: StockFootage) {
  // Stable ties favor the first derivative over a much larger same-size original.
  return (
    item.sources
      .filter((source) => source.height <= 1080)
      .sort((a, b) => b.height - a.height)[0] ?? item.sources[0]
  );
}

export function stockCreditText(source: StockMediaSource): string {
  return `${source.title} — ${source.creator}\n${source.pageUrl}\n${source.license}${source.licenseUrl ? ` · ${source.licenseUrl}` : ""}`;
}

/** Downloads are bounded and abortable. Never import a remote HTML/error payload. */
export async function downloadStockFootage(
  item: StockFootage,
  signal: AbortSignal,
  onProgress: (bytes: number, total?: number) => void,
): Promise<File> {
  const source = preferredFootageSource(item);
  if (!source || !safeUrl(source.url, ["upload.wikimedia.org"]))
    throw new Error("This footage source is unavailable.");
  const response = await fetch(source.url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error(
      `Could not download footage (${response.status}). Try again.`,
    );
  const mime = response.headers.get("Content-Type")?.split(";")[0].trim();
  if (
    mime &&
    ![
      "video/webm",
      "video/mp4",
      "video/ogg",
      "application/ogg",
      "application/octet-stream",
    ].includes(mime)
  )
    throw new Error("The footage source did not return a video.");
  const total = Number(response.headers.get("Content-Length")) || undefined;
  if (total && total > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new Error(
      "This clip exceeds the 200 MB download limit. Choose a shorter clip.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("The footage download could not start. Try again.");
  const parts: ArrayBuffer[] = [];
  let received = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error(
          "This clip exceeds the 200 MB download limit. Choose a shorter clip.",
        );
      }
      parts.push(new Uint8Array(value).buffer);
      onProgress(received, total);
    }
    signal.throwIfAborted();
  } finally {
    reader.releaseLock();
  }
  if (!received) throw new Error("The footage download was empty. Try again.");
  const extension =
    source.mime === "video/mp4"
      ? "mp4"
      : source.mime === "video/ogg"
        ? "ogv"
        : "webm";
  // Portable filenames exclude control characters and reserved separators.
  const basename =
    item.title
      .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, "_")
      .trim()
      .slice(0, 140) || item.id;
  return new File(parts, `${basename}.${extension}`, { type: source.mime });
}
