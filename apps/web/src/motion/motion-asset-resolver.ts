import { resolveCreationMotionSceneBinding } from "@openreel/core/creation/index";
import { renderAuroraPreviewToImageBitmap } from "@openreel/core/motion/native-aurora-bridge";
import type {
  MediaItem,
  MotionAsset,
  MotionRendererAssetResolver,
  MotionScene3DRenderResult,
} from "@openreel/core";
import type { CreationProjectState } from "@openreel/core/creation/index";

const imageBitmapCache = new Map<string, Promise<ImageBitmap | null>>();
const videoElementCache = new Map<string, Promise<HTMLVideoElement | null>>();
const videoObjectUrls = new Map<string, string>();
const modelUrlCache = new Map<string, Promise<string | null>>();
const modelObjectUrls = new Map<string, string>();

const MODEL_MAX_BYTES = 256 * 1024 * 1024;

type DesktopFetchUrl = (args: {
  url: string;
  maxBytes?: number;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  body: ArrayBuffer;
  error?: string;
}>;

interface WebMotionAssetResolverOptions {
  readonly creation?: CreationProjectState;
}

export function createWebMotionAssetResolver(
  mediaItems: readonly MediaItem[],
  options: WebMotionAssetResolverOptions = {},
): MotionRendererAssetResolver {
  return {
    resolveImageAsset: (asset) => resolveImageAsset(asset, mediaItems),
    resolveVideoFrame: (asset, localTime) =>
      resolveVideoFrame(asset, mediaItems, localTime),
    resolveModelUrl,
    renderScene3D: (input) => renderCreationScene3D(input, options.creation),
  };
}

export function clearWebMotionAssetBitmapCache(): void {
  imageBitmapCache.clear();
  for (const [key, pending] of videoElementCache) {
    void pending.then((video) => {
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
      const objectUrl = videoObjectUrls.get(key);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        videoObjectUrls.delete(key);
      }
    });
  }
  videoElementCache.clear();
  for (const objectUrl of modelObjectUrls.values()) {
    URL.revokeObjectURL(objectUrl);
  }
  modelObjectUrls.clear();
  modelUrlCache.clear();
}

async function resolveModelUrl(url: string): Promise<string | null> {
  if (!isRemoteHttpUrl(url)) return url;
  const bridge = typeof window !== "undefined"
    ? window.openreel?.media?.fetchUrl
    : undefined;
  if (typeof bridge !== "function") return url;

  let cached = modelUrlCache.get(url);
  if (!cached) {
    cached = fetchModelObjectUrl(url, bridge);
    modelUrlCache.set(url, cached);
  }
  return cached;
}

async function fetchModelObjectUrl(
  url: string,
  fetchUrl: DesktopFetchUrl,
): Promise<string | null> {
  try {
    const res = await fetchUrl({ url, maxBytes: MODEL_MAX_BYTES });
    if (!res.ok) return url;
    const blob = new Blob([res.body], {
      type: inferModelMime(url, res.contentType),
    });
    const objectUrl = URL.createObjectURL(blob);
    modelObjectUrls.set(url, objectUrl);
    return objectUrl;
  } catch {
    return url;
  }
}

function isRemoteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function inferModelMime(url: string, contentType: string): string {
  const mime = contentType.split(";")[0]?.trim();
  if (mime && mime !== "application/octet-stream") return mime;
  const pathname = safePathname(url).toLowerCase();
  if (pathname.endsWith(".gltf")) return "model/gltf+json";
  return "model/gltf-binary";
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function resolveVideoFrame(
  asset: MotionAsset,
  mediaItems: readonly MediaItem[],
  localTime: number,
): Promise<ImageBitmap | null> {
  if (asset.type !== "video") return null;
  const video = await getVideoElement(asset, mediaItems);
  if (!video) return null;
  await seekVideoTo(video, localTime);
  try {
    return await createImageBitmap(video);
  } catch {
    return null;
  }
}

async function getVideoElement(
  asset: MotionAsset,
  mediaItems: readonly MediaItem[],
): Promise<HTMLVideoElement | null> {
  if (typeof document === "undefined") return null;
  const cacheKey = assetCacheKey(asset);
  let cached = videoElementCache.get(cacheKey);
  if (!cached) {
    cached = createVideoElement(asset, mediaItems, cacheKey);
    videoElementCache.set(cacheKey, cached);
  }
  return cached;
}

async function createVideoElement(
  asset: MotionAsset,
  mediaItems: readonly MediaItem[],
  cacheKey: string,
): Promise<HTMLVideoElement | null> {
  const blob = await getMediaBlob(asset, mediaItems, "video");
  if (!blob) return null;
  const objectUrl = URL.createObjectURL(blob);
  videoObjectUrls.set(cacheKey, objectUrl);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = objectUrl;
  const ready = new Promise<HTMLVideoElement | null>((resolve) => {
    const onReady = (): void => {
      cleanup();
      resolve(video);
    };
    const onError = (): void => {
      cleanup();
      URL.revokeObjectURL(objectUrl);
      videoObjectUrls.delete(cacheKey);
      resolve(null);
    };
    const cleanup = (): void => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
  video.load();
  return ready;
}

async function seekVideoTo(
  video: HTMLVideoElement,
  time: number,
): Promise<void> {
  const target = Number.isFinite(video.duration)
    ? Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001))
    : Math.max(0, time);
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
    return;
  }
  await new Promise<void>((resolve) => {
    const onSeeked = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 2000);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = target;
  });
}

async function resolveImageAsset(
  asset: MotionAsset,
  mediaItems: readonly MediaItem[],
): Promise<ImageBitmap | null> {
  if (asset.type !== "image") return null;
  const cacheKey = assetCacheKey(asset);
  let cached = imageBitmapCache.get(cacheKey);
  if (!cached) {
    cached = loadImageBitmap(asset, mediaItems);
    imageBitmapCache.set(cacheKey, cached);
  }
  return cached;
}

async function renderCreationScene3D(
  input: Parameters<NonNullable<MotionRendererAssetResolver["renderScene3D"]>>[0],
  creation: CreationProjectState | undefined,
): Promise<MotionScene3DRenderResult | null> {
  const bound = resolveCreationMotionSceneBinding(
    creation,
    input.composition.id,
    input.layer.id,
  );
  if (!bound) return null;
  const image = await renderAuroraPreviewToImageBitmap({
    scene: bound.scene,
    assets: bound.assets,
    width: input.width,
    height: input.height,
    background: input.backgroundColor,
    timeSeconds: input.localTime,
    quality: input.quality ? "preview" : "final",
  });
  if (!image) return null;
  return {
    image,
    release: () => image.close(),
  };
}

async function loadImageBitmap(
  asset: MotionAsset,
  mediaItems: readonly MediaItem[],
): Promise<ImageBitmap | null> {
  const blob = await getMediaBlob(asset, mediaItems, "image");
  if (!blob) return null;
  const isSvg =
    blob.type === "image/svg+xml" ||
    (asset.url?.startsWith("data:image/svg+xml") ?? false);
  // createImageBitmap(svgBlob) throws in Firefox/Safari; decode SVG via an
  // <img> first (it handles SVG cross-browser), then snapshot to a bitmap.
  if (isSvg) {
    const viaImage = await imageBitmapFromImageElement(blob);
    if (viaImage) return viaImage;
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    return imageBitmapFromImageElement(blob);
  }
}

async function imageBitmapFromImageElement(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof Image === "undefined" || typeof URL?.createObjectURL !== "function") {
    return null;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getMediaBlob(
  asset: MotionAsset,
  mediaItems: readonly MediaItem[],
  expectedType: "image" | "video",
): Promise<Blob | null> {
  if (asset.mediaId) {
    const item = mediaItems.find((candidate) => candidate.id === asset.mediaId);
    if (item?.type === expectedType) {
      if (item.blob) return item.blob;
      if (item.fileHandle) return item.fileHandle.getFile();
      if (item.originalUrl) return fetchBlob(item.originalUrl);
      if (expectedType === "image" && item.thumbnailUrl) {
        return fetchBlob(item.thumbnailUrl);
      }
    }
  }

  if (asset.url) {
    return fetchBlob(asset.url);
  }

  if (
    typeof asset.data === "string" &&
    asset.data.startsWith(`data:${expectedType}/`)
  ) {
    return fetchBlob(asset.data);
  }

  if (typeof Blob !== "undefined" && asset.data instanceof Blob) {
    return asset.data;
  }

  return null;
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
  } catch {
    return null;
  }
}

function assetCacheKey(asset: MotionAsset): string {
  if (asset.mediaId) return `media:${asset.mediaId}`;
  if (asset.url) return `url:${asset.url}`;
  return `asset:${asset.id}`;
}
