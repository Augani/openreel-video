import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, MediaItem } from "@openreel/core";
import type { ProjectState } from "../project-store";
import { getMediaBridge, initializeMediaBridge } from "../../bridges/media-bridge";
import { saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";
import { toast } from "../notification-store";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type MediaSlice = Pick<
  ProjectState,
  | "importMedia"
  | "deleteMedia"
  | "replaceMediaAsset"
  | "renameMedia"
  | "getMediaItem"
>;

export function createMediaSlice(set: Set, get: Get): MediaSlice {
  const replacementRequests = new Map<string, symbol>();

  return {
    importMedia: async (file: File) => {
      const { project } = get();

      try {
        const mediaBridge = getMediaBridge();
        if (!mediaBridge.isInitialized()) {
          await initializeMediaBridge();
        }

        const isLargeFile = file.size > 50 * 1024 * 1024;
        const importResult = await mediaBridge.importFile(file, true, isLargeFile);

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
                  thumbUrl = URL.createObjectURL(blob);
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

        const newMediaItem: MediaItem = {
          id: uuidv4(),
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
            fileSize: file.size,
            hasVideo: processedMedia.metadata.hasVideo,
            hasAudio: processedMedia.metadata.hasAudio,
          },
          thumbnailUrl,
          waveformData: processedMedia.waveformData?.peaks || null,
          filmstripThumbnails:
            filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
          sourceFile: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          },
        };

        const currentProject = get().project;
        if (currentProject.id !== project.id) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS" as const,
              message: "The project changed while importing media. Import the file again in the current project.",
            },
          };
        }

        const updatedProject = {
          ...currentProject,
          mediaLibrary: {
            ...currentProject.mediaLibrary,
            items: [...currentProject.mediaLibrary.items, newMediaItem],
          },
          modifiedAt: Date.now(),
        };

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
              const thumbs = await mediaBridge.generateThumbnailsForMedia(
                newMediaItem.blob ?? file,
                mediaType,
              );
              if (thumbs.length > 0) {
                const currentProject = get().project;
                if (currentProject.id !== updatedProject.id) return;
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
      }
      return result;
    },

    replaceMediaAsset: async (
      mediaId: string,
      file: File,
      sourceFolder?: string,
    ) => {
      const { project } = get();
      const replacementKey = `${project.id}:${mediaId}`;
      const replacementRequest = Symbol();
      replacementRequests.set(replacementKey, replacementRequest);

      try {
        const mediaBridge = getMediaBridge();
        if (!mediaBridge.isInitialized()) {
          await initializeMediaBridge();
        }

        const importResult = await mediaBridge.importFile(file, true);

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
                  thumbUrl = URL.createObjectURL(blob);
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

        const updatedItem: MediaItem = {
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
            fileSize: file.size,
            hasVideo: processedMedia.metadata.hasVideo,
            hasAudio: processedMedia.metadata.hasAudio,
          },
          thumbnailUrl,
          waveformData: processedMedia.waveformData?.peaks || null,
          filmstripThumbnails:
            filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
          isPlaceholder: false,
          sourceFile: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            folder: sourceFolder,
          },
        };

        const currentProject = get().project;
        if (
          currentProject.id !== project.id ||
          replacementRequests.get(replacementKey) !== replacementRequest ||
          !currentProject.mediaLibrary.items.some((item) => item.id === mediaId)
        ) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS" as const,
              message: "The media or project changed while replacing the file. Try again in the current project.",
            },
          };
        }

        const updatedItems = currentProject.mediaLibrary.items.map((item) =>
          item.id === mediaId ? updatedItem : item,
        );

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
              const thumbs = await mediaBridge.generateThumbnailsForMedia(
                updatedItem.blob ?? file,
                updatedItem.type,
              );
              if (thumbs.length > 0) {
                const currentProject = get().project;
                if (
                  currentProject.id !== project.id ||
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
}
