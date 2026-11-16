import type { MediaItem } from "@openreel/core";

export async function generateThumbnailFromBlob(
  blob: Blob,
  type: "video" | "audio" | "image",
): Promise<string | null> {
  if (!(blob instanceof Blob)) {
    return null;
  }

  if (type === "audio") {
    return null;
  }

  if (type === "image") {
    return URL.createObjectURL(blob);
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const src = URL.createObjectURL(blob);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cleaned = false;
    // Detach the element before revoking so an in-flight range request is not
    // left fetching a dead blob: URL (ERR_FILE_NOT_FOUND). Runs at most once.
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute("src");
      video.load();
      video.remove();
      URL.revokeObjectURL(src);
    };

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.videoWidth, 320);
        canvas.height = Math.min(
          video.videoHeight,
          (320 / video.videoWidth) * video.videoHeight,
        );

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (thumbBlob) => {
              cleanup();
              if (thumbBlob) {
                resolve(URL.createObjectURL(thumbBlob));
              } else {
                resolve(null);
              }
            },
            "image/jpeg",
            0.7,
          );
        } else {
          cleanup();
          resolve(null);
        }
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    video.src = src;
  });
}

export function createMissingMediaItem(item: MediaItem): MediaItem {
  const droppedThumbnail = item.thumbnailUrl?.startsWith("blob:") ?? false;
  const { thumbnailPixelAspect: _marker, ...rest } = item;
  return {
    ...(droppedThumbnail ? rest : item),
    fileHandle: null,
    blob: null,
    thumbnailUrl: droppedThumbnail
      ? null
      : item.thumbnailUrl,
    waveformData: null,
    filmstripThumbnails: undefined,
    isPlaceholder: true,
  };
}

export async function restoreMediaItem(
  item: MediaItem,
  storedBlob: Blob | undefined,
): Promise<MediaItem> {
  const blob =
    storedBlob instanceof Blob
      ? storedBlob
      : item.blob instanceof Blob
        ? item.blob
        : null;

  if (!blob) {
    return createMissingMediaItem(item);
  }

  let thumbnailUrl = item.thumbnailUrl;

  if (!thumbnailUrl || thumbnailUrl.startsWith("blob:")) {
    try {
      thumbnailUrl = await generateThumbnailFromBlob(blob, item.type);
    } catch (error) {
      console.warn(
        `[MediaRecovery] Failed to regenerate thumbnail for ${item.name}:`,
        error,
      );
      thumbnailUrl = null;
    }
  }

  // A regenerated thumbnail is square: the old marker no longer describes it.
  const { thumbnailPixelAspect: _marker, ...rest } = item;
  const regenerated = thumbnailUrl !== item.thumbnailUrl;
  return {
    ...(regenerated ? rest : item),
    fileHandle: null,
    blob,
    thumbnailUrl,
    waveformData: null,
    filmstripThumbnails: undefined,
    isPlaceholder: false,
  };
}
