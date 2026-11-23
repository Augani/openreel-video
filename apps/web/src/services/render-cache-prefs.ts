/** Render-cache preferences kept per browser profile (the desktop scratch folder and total cap live in the main process). */

export type PreviewResolution = "full" | "1080p";

export interface RenderCachePrefs {
  /** "full" renders cache frames at the sequence size; "1080p" caps them at 1920 wide. */
  resolution: PreviewResolution;
  /** Browser only: size cap for one project's render files. */
  webCapBytes: number;
}

const KEY = "openreel-render-cache-prefs";
export const RENDER_CACHE_PREFS_EVENT = "openreel:render-cache-prefs";
export const MIN_WEB_CAP_BYTES = 256 * 1024 * 1024;
export const MAX_WEB_CAP_BYTES = 16 * 1024 * 1024 * 1024;
export const DEFAULT_WEB_CAP_BYTES = 2 * 1024 * 1024 * 1024;

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop";
}

export function defaultPrefs(): RenderCachePrefs {
  // The scratch disk has room for sequence-size frames; a browser profile's quota usually does not.
  return { resolution: isDesktop() ? "full" : "1080p", webCapBytes: DEFAULT_WEB_CAP_BYTES };
}

const clampCap = (cap: number) => Math.min(MAX_WEB_CAP_BYTES, Math.max(MIN_WEB_CAP_BYTES, Math.round(cap)));

export function readRenderCachePrefs(): RenderCachePrefs {
  const defaults = defaultPrefs();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<RenderCachePrefs> | null;
    if (!raw) return defaults;
    const cap = raw.webCapBytes;
    return {
      resolution: raw.resolution === "full" || raw.resolution === "1080p" ? raw.resolution : defaults.resolution,
      webCapBytes:
        typeof cap === "number" && Number.isFinite(cap)
          ? clampCap(cap)
          : defaults.webCapBytes,
    };
  } catch {
    return defaults;
  }
}

export function writeRenderCachePrefs(patch: Partial<RenderCachePrefs>): RenderCachePrefs {
  const merged = { ...readRenderCachePrefs(), ...patch };
  const next = { ...merged, webCapBytes: clampCap(merged.webCapBytes) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the choice lasts until reload */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(RENDER_CACHE_PREFS_EVENT, { detail: next }));
  return next;
}

/** Widest cache frame for a resolution preference. */
export function maxWidthFor(resolution: PreviewResolution): number {
  return resolution === "full" ? Number.POSITIVE_INFINITY : 1920;
}
