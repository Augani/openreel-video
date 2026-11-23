import { z } from "zod";

/**
 * Render cache on the scratch disk (desktop). Shared by the main process, the preload bridge and (mirrored in
 * apps/web/src/types/global.d.ts) the renderer. Frames are opaque intra-coded blobs the renderer produced; the main
 * process only stores them, so the paths it touches are built from validated project and frame keys, never from
 * renderer-supplied strings.
 */

export const RENDER_CACHE_FOLDER = "OpenReel Render Cache";
export const RENDER_CACHE_MIN_CAP_BYTES = 512 * 1024 * 1024;
export const RENDER_CACHE_DEFAULT_CAP_BYTES = 20 * 1024 * 1024 * 1024;
export const RENDER_CACHE_MAX_CAP_BYTES = 2 * 1024 * 1024 * 1024 * 1024;

export const projectKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const frameKeySchema = z.string().regex(/^(f\d{1,9}|__index__)$/);

export const renderCachePutArgsSchema = z.object({ project: projectKeySchema, key: frameKeySchema, data: z.instanceof(Uint8Array) });
export const renderCacheGetArgsSchema = z.object({ project: projectKeySchema, key: frameKeySchema });
export const renderCacheDeleteArgsSchema = z.object({ project: projectKeySchema, keys: z.array(frameKeySchema).max(100_000) });
export const renderCacheProjectArgsSchema = z.object({ project: projectKeySchema });
export const renderCacheSetCapArgsSchema = z.object({
  capBytes: z.number().int().min(RENDER_CACHE_MIN_CAP_BYTES).max(RENDER_CACHE_MAX_CAP_BYTES),
});

export const renderCacheStatArgsSchema = z.object({ paths: z.array(z.string().min(1).max(4096)).max(5000) });

export interface RenderCacheSettings {
  /** The folder render files live under (inside `RENDER_CACHE_FOLDER`). */
  scratchDir: string;
  /** True when the user has not chosen one: the app's own data folder is used. */
  isDefault: boolean;
  /** Total size across every project; the oldest projects' files are deleted first when it is exceeded. */
  capBytes: number;
  /** Free bytes on the scratch volume (null when unknown). */
  freeBytes: number | null;
}

export interface RenderCacheUsage {
  bytes: number;
  projects: Array<{ key: string; bytes: number; files: number; touchedAt: number }>;
}
