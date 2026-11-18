import { getRawDeveloper, isDevelopedRaw, mediaImageVersion, type MediaItem } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Keeps the media-library thumbnail of a RAW still in step with its RAW Source
 * Settings, however they changed (Apply, undo, redo, an agent edit). The
 * thumbnail is a draft-quality development at 320 px, so this is cheap.
 */

const THUMBNAIL_EDGE = 320;
const seen = new Map<string, string>();
let started = false;

async function regenerate(item: MediaItem, version: string): Promise<void> {
  if (!item.blob || !item.raw?.settings) return;
  try {
    const frame = await getRawDeveloper().develop({
      sourceKey: `${item.id}:${item.blob.size}`,
      blob: item.blob,
      settings: { ...item.raw.settings, demosaic: "draft" },
      maxLongEdge: THUMBNAIL_EDGE,
    });
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")?.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.8);
    // Only apply if the settings did not move on while this was developing.
    useProjectStore.setState((state) => {
      const current = state.project.mediaLibrary.items.find((m) => m.id === item.id);
      if (!current || mediaImageVersion(current) !== version) return state;
      return {
        project: {
          ...state.project,
          mediaLibrary: {
            ...state.project.mediaLibrary,
            items: state.project.mediaLibrary.items.map((m) => (m.id === item.id ? { ...m, thumbnailUrl: url } : m)),
          },
        },
      };
    });
  } catch {
    // The old thumbnail stays; the image itself reports decode errors.
  }
}

export function startRawThumbnailSync(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  useProjectStore.subscribe((state) => {
    for (const item of state.project.mediaLibrary.items) {
      if (!isDevelopedRaw(item)) continue;
      const version = mediaImageVersion(item);
      const previous = seen.get(item.id);
      seen.set(item.id, version);
      // First sight of an item is its import (thumbnail already made); only changes regenerate.
      if (previous !== undefined && previous !== version) void regenerate(item, version);
    }
  });
}
