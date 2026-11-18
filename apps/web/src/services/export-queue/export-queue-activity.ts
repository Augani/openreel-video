import type { ExportFrameSource, Project } from "@openreel/core";

/**
 * Tiny shared flag: true while the export queue is encoding a job. Kept apart
 * from the queue store so low-level services (render cache) can ask without
 * importing the store and its dependencies.
 */
let running = false;

export const isExportQueueRunning = (): boolean => running;
export const setExportQueueRunning = (value: boolean): void => {
  running = value;
};

/** "Use previews" preference shared by the Export dialog, direct exports and queued jobs. */
let usePreviews = true;
export const getUseExportPreviews = (): boolean => usePreviews;
export const setUseExportPreviews = (value: boolean): void => {
  usePreviews = value;
};

export type ExportFrameSourceProvider = (
  project: Project,
  settings: { width: number; height: number; frameRate: number; upscaling?: { enabled?: boolean } },
) => ExportFrameSource | null;

let frameSourceProvider: ExportFrameSourceProvider | null = null;

/** The render cache service registers itself here so exports can reuse its frames. */
export const registerExportFrameSourceProvider = (provider: ExportFrameSourceProvider): void => {
  frameSourceProvider = provider;
};

/** Cached preview frames an export of `project` may reuse, or null. */
export const createExportFrameSource = (
  project: Project,
  settings: Parameters<ExportFrameSourceProvider>[1],
): ExportFrameSource | null => frameSourceProvider?.(project, settings) ?? null;
