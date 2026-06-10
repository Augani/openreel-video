import {
  PROXY_PRESETS,
  getFFmpegFallback,
  getRecommendedProxyPreset,
  shouldUseProxy,
  type MediaItem,
  type MediaMetadata,
  type MediaProxyInfo,
  type MediaProxyPreset,
} from "@openreel/core";

const PROXY_MEDIA_ID_SUFFIX = ":proxy";

export const getProxyMediaId = (mediaId: string): string =>
  `${mediaId}${PROXY_MEDIA_ID_SUFFIX}`;

export const getPreviewBlob = (item: MediaItem): Blob | null => {
  if (item.type === "video" && item.proxy?.status === "ready" && item.proxyBlob) {
    return item.proxyBlob;
  }

  return item.blob;
};

export const getRecommendedProxyInfo = (
  item: MediaItem,
): MediaProxyInfo | undefined => {
  if (item.type !== "video") {
    return undefined;
  }

  if (
    !shouldUseProxy({
      width: item.metadata.width,
      height: item.metadata.height,
      duration: item.metadata.duration,
      fileSize: item.metadata.fileSize,
    })
  ) {
    return undefined;
  }

  return {
    mediaId: getProxyMediaId(item.id),
    preset: getRecommendedProxyPreset({
      width: item.metadata.width,
      height: item.metadata.height,
    }),
    status: "recommended",
  };
};

export const getProxyDimensions = (
  item: MediaItem,
  preset: MediaProxyPreset,
): { readonly width: number; readonly height: number } => {
  const settings = PROXY_PRESETS[preset];
  const scaledWidth = Math.round(item.metadata.width * settings.scale);
  const scaledHeight = Math.round(item.metadata.height * settings.scale);
  const maxWidth = settings.maxWidth ?? scaledWidth;
  const maxHeight = settings.maxHeight ?? scaledHeight;
  const ratio = Math.min(maxWidth / scaledWidth, maxHeight / scaledHeight, 1);

  return {
    width: Math.max(2, Math.round(scaledWidth * ratio)),
    height: Math.max(2, Math.round(scaledHeight * ratio)),
  };
};

export const getProxyMetadata = (
  item: MediaItem,
  proxyBlob: Blob,
  preset: MediaProxyPreset,
): MediaMetadata => {
  const dimensions = getProxyDimensions(item, preset);

  return {
    ...item.metadata,
    width: dimensions.width,
    height: dimensions.height,
    codec: "h264",
    fileSize: proxyBlob.size,
  };
};

export const generateProxyBlob = async (
  item: MediaItem,
  onProgress: (progress: number) => void,
): Promise<{ readonly blob: Blob; readonly preset: MediaProxyPreset }> => {
  if (!item.blob) {
    throw new Error("Original media blob is not available.");
  }

  const preset =
    item.proxy?.preset ??
    getRecommendedProxyPreset({
      width: item.metadata.width,
      height: item.metadata.height,
    });

  const blob = await getFFmpegFallback().generateProxyWithPreset(
    item.blob,
    preset,
    (progress) => onProgress(progress.progress),
  );

  return { blob, preset };
};
