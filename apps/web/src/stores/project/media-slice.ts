import { v4 as uuidv4 } from "uuid";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import type { StoreApi } from "zustand";
import { claimNativeSource, probeFootageShape, isRawFileName, type Action, type MediaItem, type SourceColorSpace } from "@openreel/core";
import { buildRawMediaItem } from "../../services/raw-import";
import type { ProjectState } from "../project-store";
import { getMediaBridge, initializeMediaBridge } from "../../bridges/media-bridge";
import { saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";
import { toast } from "../notification-store";
import { useSettingsStore } from "../settings-store";
import { nativePathForFile } from "../../services/native-path";
import { sourceTimecodeMetadata } from "../../services/source-timecode";

/** Colour tags for the item's metadata: the desktop's ffmpeg tags win over the container's (they read the real stream). */
function detectedSourceColor(
  container: SourceColorSpace | undefined,
  native: SourceColorSpace | undefined,
): { sourceColor?: SourceColorSpace } {
  const color = native ?? container;
  return color ? { sourceColor: color } : {};
}

/** Pixel aspect ratio and field order the desktop's ffmpeg probe read from the stream (absent = square / progressive). */
function detectedFootageShape(
  native: { pixelAspectRatio?: number; fieldOrder?: "upper" | "lower" } | null | undefined,
): { pixelAspectRatio?: number; fieldOrder?: "upper" | "lower" } {
  return {
    ...(native?.pixelAspectRatio ? { pixelAspectRatio: native.pixelAspectRatio } : {}),
    ...(native?.fieldOrder ? { fieldOrder: native.fieldOrder } : {}),
  };
}

/** Desktop: how a file WebCodecs cannot decode (ProRes...) is read, kept on the item so a reopened project decodes it natively again. */
async function nativeSourceOf(file: Blob): Promise<MediaItem["nativeSource"] | undefined> {
  const info = await claimNativeSource(file).catch(() => null);
  if (!info) return undefined;
  return { path: info.id, codec: info.codec, width: info.width, height: info.height, frameRate: info.frameRate, ...(info.rotation ? { rotation: info.rotation } : {}) };
}

import { useProjectPanelStore } from "../project-panel-store";

/** The bin an import should land in: the Project panel's current bin, if it still exists. */
function importBinId(project: { bins?: readonly { id: string }[] }): string | undefined {
  const current = useProjectPanelStore.getState().currentBinId;
  return current && project.bins?.some((bin) => bin.id === current) ? current : undefined;
}

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

type MediaSlice = Pick<
  ProjectState,
  | "importMedia"
  | "deleteMedia"
  | "replaceMediaAsset"
  | "renameMedia"
  | "getMediaItem"
>;

export function createMediaSlice(set: Set, get: Get): MediaSlice {
  const replacementRequests = new Map<string, symbol>();

  const slice: MediaSlice = {
    importMedia: async (file, onProgress, source, options) => {
      const { project, actionExecutor } = get();
      const cancelled = () => options?.signal?.aborted || options?.isCurrent?.() === false;
      const cancelledResult = () => ({ success: false, error: { code: "INVALID_PARAMS" as const, message: "Media import was cancelled." } });
      const ownsSession = () => get().project.id === project.id && get().actionExecutor === actionExecutor;
      const ownsRequest = () => ownsSession() && !cancelled();
      const unavailableResult = () => cancelled() ? cancelledResult() : {
        success: false,
        error: { code: "INVALID_PARAMS" as const, message: "The project changed while importing media. Import the file again in the current project." },
      };
      const createdThumbnails = new Set<string>();
      // Caller-owned remote imports may be cancelled while decoding. Do not
      // publish or persist their result into a closed or superseded session.
      if (!ownsRequest()) return unavailableResult();

      // Camera RAW (DNG decoded by OpenReel, other formats via macOS ImageIO): its own import path.
      if (isRawFileName(file.name)) {
        try {
          onProgress?.("Reading camera RAW");
          const { item } = await buildRawMediaItem(file, uuidv4());
          if (!ownsRequest()) return unavailableResult();
          const rawPath = nativePathForFile(file);
          const newRawItem: MediaItem = {
            ...item,
            sourceFile: {
              name: file.name,
              size: file.size,
              lastModified: file.lastModified,
              ...(rawPath ? { path: rawPath } : {}),
            },
            importedAt: Date.now(),
            ...(importBinId(get().project) ? { binId: importBinId(get().project) } : {}),
          };
          const current = get().project;
          const rawProject = {
            ...current,
            mediaLibrary: { ...current.mediaLibrary, items: [...current.mediaLibrary.items, newRawItem] },
            modifiedAt: Date.now(),
          };
          set({ project: rawProject });
          try {
            await saveMediaBlob(rawProject.id, newRawItem.id, newRawItem.blob as Blob, newRawItem.metadata);
          } catch (err) {
            console.error("[ProjectStore] Failed to persist media blob:", err);
            toast.warning("Media could not be saved in browser storage", `Keep the original ${file.name} so you can relink it after reloading.`);
          }
          return { success: true, actionId: newRawItem.id };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not import the RAW file.";
          toast.error("Camera RAW not imported", message);
          return { success: false, error: { code: "DECODE_ERROR" as const, message } };
        }
      }

      try {
        const mediaBridge = getMediaBridge();
        if (!mediaBridge.isInitialized()) {
          await initializeMediaBridge();
        }
        if (!ownsRequest()) return unavailableResult();

        const isLargeFile = file.size > 50 * 1024 * 1024;
        const importResult = await mediaBridge.importFile(file, true, isLargeFile, onProgress, { untracked: true, signal: options?.signal });
        if (!ownsRequest()) return unavailableResult();

        if (!importResult.success || !importResult.media) {
          return {
            success: false,
            error: {
              code: "DECODE_ERROR" as const,
              message: importResult.error || "Failed to import media",
            },
          };
        }

        const processedMedia = importResult.media;

        let thumbnailUrl: string | null = null;
        const filmstripThumbnails: { timestamp: number; url: string }[] = [];

        if (processedMedia.thumbnails && processedMedia.thumbnails.length > 0) {
          for (const thumb of processedMedia.thumbnails) {
            let thumbUrl: string | null = null;

            if (thumb.dataUrl) {
              thumbUrl = thumb.dataUrl;
            } else if (thumb.canvas) {
              try {
                if (thumb.canvas instanceof OffscreenCanvas) {
                  const blob = await thumb.canvas.convertToBlob({
                    type: "image/jpeg",
                    quality: 0.7,
                  });
                  if (!ownsRequest()) return unavailableResult();
                  thumbUrl = URL.createObjectURL(blob);
                  createdThumbnails.add(thumbUrl);
                } else if (thumb.canvas instanceof HTMLCanvasElement) {
                  thumbUrl = thumb.canvas.toDataURL("image/jpeg", 0.7);
                }
              } catch (e) {
                console.warn("Failed to convert thumbnail canvas to URL:", e);
              }
            }

            if (thumbUrl) {
              filmstripThumbnails.push({ timestamp: thumb.timestamp, url: thumbUrl });
            }
          }

          if (filmstripThumbnails.length > 0) {
            thumbnailUrl = filmstripThumbnails[0].url;
          }
        }

        let mediaType: "video" | "audio" | "image";
        if (file.type.startsWith("image/")) {
          mediaType = "image";
        } else if (processedMedia.metadata.hasVideo) {
          mediaType = "video";
        } else if (processedMedia.metadata.hasAudio) {
          mediaType = "audio";
        } else {
          mediaType = "image";
        }

        if (mediaType === "video" && !thumbnailUrl) {
          try {
            const thumbs = await mediaBridge.generateThumbnailsForMedia(
              processedMedia.blob ?? file,
              mediaType,
            );
            if (!ownsRequest()) return unavailableResult();
            if (thumbs.length > 0) {
              thumbnailUrl = thumbs[0].dataUrl;
              filmstripThumbnails.push(
                ...thumbs.map((thumb) => ({
                  timestamp: thumb.timestamp,
                  url: thumb.dataUrl,
                })),
              );
            }
          } catch {
            // Background retry below is best-effort.
          }
        }

        const nativeSource = await nativeSourceOf(file);
        const claimedNative = await claimNativeSource(file).catch(() => null);
        const nativeSourceColor = claimedNative?.sourceColor;
        const newMediaItem: MediaItem = {
          id: uuidv4(),
          name: file.name,
          type: mediaType,
          fileHandle: null,
          blob: file,
          metadata: {
            ...(source?.stockSource ? { stockSource: { ...source.stockSource } } : {}),
            ...(mediaType === "audio" && source ? { soundLibraryId: source.soundLibraryId } : {}),
            ...(source?.recordedTake && (mediaType === "video" || (mediaType === "audio" && source.recordedTake === "voiceover")) ? { recordedTake: source.recordedTake } : {}),
            duration: processedMedia.metadata.duration || 0,
            width: processedMedia.metadata.width || 0,
            height: processedMedia.metadata.height || 0,
            frameRate: processedMedia.metadata.frameRate || 0,
            codec: processedMedia.metadata.codec || "",
            sampleRate: processedMedia.metadata.sampleRate || 0,
            channels: processedMedia.metadata.channels || 0,
            audioTrackCount: processedMedia.metadata.audioTrackCount,
            ...(processedMedia.metadata.audioStreamChannels ? { audioStreamChannels: processedMedia.metadata.audioStreamChannels } : {}),
            fileSize: file.size,
            hasVideo: processedMedia.metadata.hasVideo,
            hasAudio: processedMedia.metadata.hasAudio,
            ...detectedSourceColor(processedMedia.metadata.sourceColor, nativeSourceColor),
            ...(processedMedia.metadata.vr ? { vr: processedMedia.metadata.vr } : {}),
            ...detectedFootageShape(claimedNative ?? (processedMedia.metadata.hasVideo ? await probeFootageShape(file) : null)),
            ...(await sourceTimecodeMetadata(file)),
          },
          thumbnailUrl,
          waveformData: processedMedia.waveformData?.peaks || null,
          filmstripThumbnails:
            filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
          ...(nativeSource ? { nativeSource } : {}),
          sourceFile: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            ...(nativePathForFile(file) ? { path: nativePathForFile(file) } : {}),
          },
          importedAt: Date.now(),
          // Preferences > Default audio channels: a mono/stereo default is stamped on files that carry audio.
          ...(processedMedia.metadata.hasAudio && useSettingsStore.getState().defaultAudioChannels !== "file"
            ? { channelPreset: useSettingsStore.getState().defaultAudioChannels }
            : {}),
          // Import into the bin being viewed (Premiere imports into the active bin).
          ...(importBinId(get().project) ? { binId: importBinId(get().project) } : {}),
        };

        const currentProject = get().project;
        if (!ownsRequest()) return unavailableResult();

        const updatedProject = {
          ...currentProject,
          mediaLibrary: {
            ...currentProject.mediaLibrary,
            items: [...currentProject.mediaLibrary.items, newMediaItem],
          },
          modifiedAt: Date.now(),
        };

        // The published item now owns these URLs, including when persistence
        // fails or the caller closes while the storage write is pending.
        createdThumbnails.clear();
        set({ project: updatedProject });

        try {
          await saveMediaBlob(
            updatedProject.id,
            newMediaItem.id,
            file,
            newMediaItem.metadata,
          );
        } catch (err) {
          console.error("[ProjectStore] Failed to persist media blob:", err);
          toast.warning(
            "Media could not be saved in browser storage",
            `Keep the original ${file.name} so you can relink it after reloading.`,
          );
        }

        if (mediaType === "video" && !thumbnailUrl) {
          setTimeout(async () => {
            try {
              const beforeRetry = get();
              if (beforeRetry.project.id !== updatedProject.id || beforeRetry.actionExecutor !== actionExecutor ||
                !beforeRetry.project.mediaLibrary.items.some(item => item.id === newMediaItem.id && item.blob === file && !item.thumbnailUrl)) return;
              const thumbs = await mediaBridge.generateThumbnailsForMedia(
                newMediaItem.blob ?? file,
                mediaType,
              );
              if (thumbs.length > 0) {
                const currentProject = get().project;
                if (currentProject.id !== updatedProject.id || get().actionExecutor !== actionExecutor) return;
                const mediaIndex = currentProject.mediaLibrary.items.findIndex(
                  (m) => m.id === newMediaItem.id,
                );
                if (mediaIndex !== -1 && currentProject.mediaLibrary.items[mediaIndex].blob === file) {
                  const updatedItems = [...currentProject.mediaLibrary.items];
                  updatedItems[mediaIndex] = {
                    ...updatedItems[mediaIndex],
                    thumbnailUrl: thumbs[0].dataUrl,
                    filmstripThumbnails: thumbs.map((t) => ({
                      timestamp: t.timestamp,
                      url: t.dataUrl,
                    })),
                  };
                  set({
                    project: {
                      ...currentProject,
                      mediaLibrary: {
                        ...currentProject.mediaLibrary,
                        items: updatedItems,
                      },
                      modifiedAt: Date.now(),
                    },
                  });
                }
              }
            } catch {
              // Background thumbnail generation is best-effort
            }
          }, 100);
        }

        return { success: true, actionId: newMediaItem.id };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "DECODE_ERROR" as const,
            message:
              error instanceof Error ? error.message : "Unknown import error",
          },
        };
      } finally {
        for (const url of createdThumbnails) URL.revokeObjectURL(url);
      }
    },

    deleteMedia: async (mediaId: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "media/delete",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { mediaId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
        deleteMediaBlob(mediaId).catch((err: unknown) =>
          console.warn("[ProjectStore] Failed to delete media blob:", err),
        );
        void import("../../services/proxy-ingest").then((m) => m.discardProxyBytes(mediaId)).catch(() => undefined);
      }
      return result;
    },

    replaceMediaAsset: async (
      mediaId: string,
      file: File,
      sourceFolder?: string,
      options?: { restorePlaceholder?: boolean; sourcePath?: string },
    ) => {
      const { project, actionExecutor } = get();
      const replacementKey = `${project.id}:${mediaId}`;
      const originalItem = project.mediaLibrary.items.find(item => item.id === mediaId);
      if (!originalItem || (options?.restorePlaceholder && (!originalItem.isPlaceholder || replacementRequests.has(replacementKey)))) {
        return { success: false, error: { code: "INVALID_PARAMS", message: "This source changed or is already being replaced. Try again in the current project." } };
      }
      const replacementRequest = Symbol();
      replacementRequests.set(replacementKey, replacementRequest);
      const createdThumbnails = new Set<string>();
      const ownsReplacement = () => {
        const current = get();
        return current.project.id === project.id && current.actionExecutor === actionExecutor &&
          replacementRequests.get(replacementKey) === replacementRequest &&
          current.project.mediaLibrary.items.some(item => item.id === mediaId && item.blob === originalItem.blob &&
            item.sourceFile === originalItem.sourceFile && item.isPlaceholder === originalItem.isPlaceholder && item.type === originalItem.type);
      };
      const unavailableResult = () => ({ success: false, error: {
        code: "INVALID_PARAMS" as const,
        message: "The media or project changed while replacing the file. Try again in the current project.",
      } });

      try {
        const mediaBridge = getMediaBridge();
        if (!mediaBridge.isInitialized()) {
          await initializeMediaBridge();
        }
        if (!ownsReplacement()) return unavailableResult();

        const importResult = await mediaBridge.importFile(file, true);
        if (!ownsReplacement()) return unavailableResult();

        if (!importResult.success || !importResult.media) {
          return {
            success: false,
            error: {
              code: "DECODE_ERROR" as const,
              message: importResult.error || "Failed to import media",
            },
          };
        }

        const processedMedia = importResult.media;

        let thumbnailUrl: string | null = null;
        const filmstripThumbnails: { timestamp: number; url: string }[] = [];

        if (processedMedia.thumbnails && processedMedia.thumbnails.length > 0) {
          for (const thumb of processedMedia.thumbnails) {
            let thumbUrl: string | null = null;

            if (thumb.dataUrl) {
              thumbUrl = thumb.dataUrl;
            } else if (thumb.canvas) {
              try {
                if (thumb.canvas instanceof OffscreenCanvas) {
                  const blob = await thumb.canvas.convertToBlob({
                    type: "image/jpeg",
                    quality: 0.7,
                  });
                  if (!ownsReplacement()) return unavailableResult();
                  thumbUrl = URL.createObjectURL(blob);
                  createdThumbnails.add(thumbUrl);
                } else if (thumb.canvas instanceof HTMLCanvasElement) {
                  thumbUrl = thumb.canvas.toDataURL("image/jpeg", 0.7);
                }
              } catch (e) {
                console.warn("Failed to convert thumbnail canvas to URL:", e);
              }
            }

            if (thumbUrl) {
              filmstripThumbnails.push({ timestamp: thumb.timestamp, url: thumbUrl });
            }
          }

          if (filmstripThumbnails.length > 0) {
            thumbnailUrl = filmstripThumbnails[0].url;
          }
        }

        const mediaType = processedMedia.metadata.hasVideo
          ? "video"
          : processedMedia.metadata.hasAudio
            ? "audio"
            : "image";

        if (mediaType === "video" && !thumbnailUrl) {
          try {
            const thumbs = await mediaBridge.generateThumbnailsForMedia(
              processedMedia.blob ?? file,
              mediaType,
            );
            if (!ownsReplacement()) return unavailableResult();
            if (thumbs.length > 0) {
              thumbnailUrl = thumbs[0].dataUrl;
              filmstripThumbnails.push(
                ...thumbs.map((thumb) => ({
                  timestamp: thumb.timestamp,
                  url: thumb.dataUrl,
                })),
              );
            }
          } catch {
            // Background retry below is best-effort.
          }
        }

        // Reconnecting offline media keeps everything the user organised around it (bin, label, notes, proxy, copy provenance).
        const preserved: Partial<MediaItem> = options?.restorePlaceholder
          ? Object.fromEntries(
              (["binId", "label", "comment", "description", "scene", "shot", "take", "goodTake", "keywords", "reel", "logComment", "xmpSource", "importedAt", "proxy", "copiedFrom"] as const)
                .filter((key) => originalItem[key] !== undefined)
                .map((key) => [key, originalItem[key]]),
            )
          : {};
        const nativeSource = await nativeSourceOf(file);
        const claimedNative = await claimNativeSource(file).catch(() => null);
        const nativeSourceColor = claimedNative?.sourceColor;
        const updatedItem: MediaItem = {
          ...preserved,
          id: mediaId,
          name: file.name,
          type: mediaType,
          fileHandle: null,
          blob: file,
          metadata: {
            duration: processedMedia.metadata.duration || 0,
            width: processedMedia.metadata.width || 0,
            height: processedMedia.metadata.height || 0,
            frameRate: processedMedia.metadata.frameRate || 0,
            codec: processedMedia.metadata.codec || "",
            sampleRate: processedMedia.metadata.sampleRate || 0,
            channels: processedMedia.metadata.channels || 0,
            audioTrackCount: processedMedia.metadata.audioTrackCount,
            ...(processedMedia.metadata.audioStreamChannels ? { audioStreamChannels: processedMedia.metadata.audioStreamChannels } : {}),
            fileSize: file.size,
            hasVideo: processedMedia.metadata.hasVideo,
            hasAudio: processedMedia.metadata.hasAudio,
            ...detectedSourceColor(processedMedia.metadata.sourceColor, nativeSourceColor),
            ...(processedMedia.metadata.vr ? { vr: processedMedia.metadata.vr } : {}),
            ...detectedFootageShape(claimedNative ?? (processedMedia.metadata.hasVideo ? await probeFootageShape(file) : null)),
            ...(await sourceTimecodeMetadata(file)),
          },
          thumbnailUrl,
          waveformData: processedMedia.waveformData?.peaks || null,
          filmstripThumbnails:
            filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
          isPlaceholder: false,
          ...(nativeSource ? { nativeSource } : {}),
          sourceFile: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            folder: sourceFolder,
            ...(options?.sourcePath || nativePathForFile(file) ? { path: options?.sourcePath || nativePathForFile(file) } : {}),
          },
        };

        const currentProject = get().project;
        if (!ownsReplacement()) return unavailableResult();

        const updatedItems = currentProject.mediaLibrary.items.map((item) =>
          item.id === mediaId ? updatedItem : item,
        );

        createdThumbnails.clear();
        set({
          project: {
            ...currentProject,
            mediaLibrary: { ...currentProject.mediaLibrary, items: updatedItems },
            modifiedAt: Date.now(),
          },
        });

        try {
          await saveMediaBlob(
            currentProject.id,
            updatedItem.id,
            file,
            updatedItem.metadata,
          );
        } catch (error) {
          console.error("[ProjectStore] Failed to persist replacement media:", error);
          toast.warning(
            "Replacement media could not be saved in browser storage",
            `Keep the original ${file.name} so you can relink it after reloading.`,
          );
        }

        if (updatedItem.type === "video" && !updatedItem.thumbnailUrl) {
          setTimeout(async () => {
            try {
              const beforeRetry = get();
              if (beforeRetry.project.id !== project.id || beforeRetry.actionExecutor !== actionExecutor ||
                !beforeRetry.project.mediaLibrary.items.some(item => item.id === mediaId && item.blob === file && !item.thumbnailUrl)) return;
              const thumbs = await mediaBridge.generateThumbnailsForMedia(
                updatedItem.blob ?? file,
                updatedItem.type,
              );
              if (thumbs.length > 0) {
                const currentProject = get().project;
                if (
                  currentProject.id !== project.id ||
                  get().actionExecutor !== actionExecutor ||
                  currentProject.mediaLibrary.items.find((item) => item.id === mediaId)?.blob !== file
                ) return;
                const updatedItemsWithThumbs =
                  currentProject.mediaLibrary.items.map((item) =>
                    item.id === mediaId
                      ? {
                          ...item,
                          thumbnailUrl: thumbs[0].dataUrl,
                          filmstripThumbnails: thumbs.map((thumb) => ({
                            timestamp: thumb.timestamp,
                            url: thumb.dataUrl,
                          })),
                        }
                      : item,
                  );
                set({
                  project: {
                    ...currentProject,
                    mediaLibrary: { ...currentProject.mediaLibrary, items: updatedItemsWithThumbs },
                    modifiedAt: Date.now(),
                  },
                });
              }
            } catch {
              // Background thumbnail generation is best-effort
            }
          }, 100);
        }

        return { success: true, actionId: uuidv4() };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "DECODE_ERROR" as const,
            message:
              error instanceof Error ? error.message : "Unknown import error",
          },
        };
      } finally {
        for (const url of createdThumbnails) URL.revokeObjectURL(url);
        if (replacementRequests.get(replacementKey) === replacementRequest) {
          replacementRequests.delete(replacementKey);
        }
      }
    },

    renameMedia: async (mediaId: string, name: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "media/rename",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { mediaId, name },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    getMediaItem: (mediaId: string) =>
      get().project.mediaLibrary.items.find((item) => item.id === mediaId),
  };

  // Every import is one background task covering the whole action (decode and adding to the project),
  // so Cancel stops before the media is added and Retry re-runs the same row with the same follow-up.
  const importInner = slice.importMedia;
  const taskId = (): string => `import:${uuidv4()}`;
  const runTracked = (id: string, args: Parameters<MediaSlice["importMedia"]>): ReturnType<MediaSlice["importMedia"]> => {
    const [file, onProgress, source, options] = args;
    return backgroundTasks
      .track(
        { id, kind: "import", source: "import", title: `Import \u00b7 ${file.name}`, retry: () => void runTracked(id, args).catch(() => undefined) },
        async (ctx) => {
          const merged = new AbortController();
          const forward = () => merged.abort();
          for (const signal of [ctx.signal, options?.signal]) {
            if (signal?.aborted) forward();
            else signal?.addEventListener("abort", forward, { once: true });
          }
          try {
            const result = await importInner(file, (stage) => { ctx.progress(null, stage); onProgress?.(stage); }, source, { ...options, signal: merged.signal });
            if (!result.success && !ctx.signal.aborted) throw new ImportActionFailure(result);
            return result;
          } finally {
            ctx.signal.removeEventListener("abort", forward);
            options?.signal?.removeEventListener("abort", forward);
          }
        },
      )
      .catch((error) => {
        if (error instanceof ImportActionFailure) return error.result;
        throw error;
      });
  };
  return { ...slice, importMedia: (...args) => runTracked(taskId(), args) };
}

class ImportActionFailure extends Error {
  constructor(readonly result: Awaited<ReturnType<MediaSlice["importMedia"]>>) {
    super(result.error?.message ?? "Import failed");
  }
}
