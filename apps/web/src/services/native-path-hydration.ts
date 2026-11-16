/**
 * Keeps native decode working for media that came back from storage.
 *
 * A file imported through the picker is a File that knows its path, so the native decoder can open it.
 * A Blob restored from IndexedDB (project reopened, auto-save recovered, project opened from the
 * recent list) is not: its path is gone. The project remembers it, though (`nativeSource.path`, or
 * `sourceFile.path`), so this watches the open project and
 *
 *  1. teaches the decoder the remembered path of every loaded Blob, so ProRes etc. decode again, and
 *  2. checks that those files are still where the project says. A moved or deleted file turns the item
 *     into an offline placeholder, which brings up the normal relink controls (and reconnects on its
 *     own when the file comes back or is found by Relink from folder), instead of a silent black frame.
 */
import type { MediaItem } from "@openreel/core";
import { toast } from "../stores/notification-store";
import { createMissingMediaItem } from "../utils/media-recovery";
import { hasRememberedNativePath, rememberNativePath } from "./native-decode";

/** The path the item's native decode should read: the saved native source, else the file's recorded path. */
export function nativePathOf(item: MediaItem): string {
  return item.nativeSource?.path || (item.nativeSource ? item.sourceFile?.path ?? "" : "");
}

/** Remember the path of every loaded native-decoded Blob. Returns the items that still need their file checked. */
export function hydrateNativePaths(items: readonly MediaItem[]): MediaItem[] {
  const toVerify: MediaItem[] = [];
  for (const item of items) {
    if (!item.nativeSource || item.isPlaceholder) continue;
    const path = nativePathOf(item);
    if (!path) continue;
    if (item.blob instanceof Blob && !hasRememberedNativePath(item.blob)) rememberNativePath(item.blob, path);
    toVerify.push(item);
  }
  return toVerify;
}

type StatBridge = { stat(paths: string[]): Promise<Record<string, { exists: boolean; size: number }>> };

/** Items whose native file is gone, per `stat`. */
export async function findMovedNativeSources(api: StatBridge, items: readonly MediaItem[]): Promise<MediaItem[]> {
  if (!items.length) return [];
  const paths = [...new Set(items.map(nativePathOf))];
  const stat = await api.stat(paths);
  return items.filter((item) => stat[nativePathOf(item)]?.exists === false);
}

const checked = new Set<string>();
let projectKey = "";

type ProjectStoreModule = typeof import("../stores/project-store");
let storeModule: ProjectStoreModule | null = null;

async function verify(): Promise<void> {
  const api = window.openreel?.ingest;
  if (!api || !storeModule) return;
  const { useProjectStore } = storeModule;
  const state = useProjectStore.getState();
  if (!state.hasOpenProject) return;
  const projectId = state.project.id;
  if (projectKey !== projectId) {
    projectKey = projectId;
    checked.clear();
  }
  const pending = hydrateNativePaths(state.project.mediaLibrary.items).filter((item) => !checked.has(`${item.id}|${nativePathOf(item)}`));
  if (!pending.length) return;
  for (const item of pending) checked.add(`${item.id}|${nativePathOf(item)}`);
  let moved: MediaItem[];
  try {
    moved = await findMovedNativeSources(api, pending);
  } catch {
    return;
  }
  if (!moved.length) return;
  const live = useProjectStore.getState();
  if (live.project.id !== projectId) return;
  const ids = new Set(moved.map((item) => item.id));
  // Runtime state (the file is not there), not an edit: no undo step. The saved project keeps its path.
  useProjectStore.setState({
    project: {
      ...live.project,
      mediaLibrary: { ...live.project.mediaLibrary, items: live.project.mediaLibrary.items.map((item) => (ids.has(item.id) && !item.isPlaceholder ? createMissingMediaItem(item) : item)) },
    },
  });
  const names = moved.slice(0, 2).map((item) => item.name).join(", ");
  toast.warning(
    moved.length === 1 ? "A media file moved" : `${moved.length} media files moved`,
    `${names}${moved.length > 2 ? " and more" : ""} could not be found where the project saved ${moved.length === 1 ? "it" : "them"}. Use Relink from Folder in the Media panel.`,
  );
}

let started = false;

/** Desktop only; idempotent. */
export function startNativePathHydration(): void {
  if (started || window.openreel?.platform !== "desktop") return;
  started = true;
  // Loaded lazily: the project store is not part of the desktop startup path.
  void import("../stores/project-store").then((module) => {
    storeModule = module;
    let lastItems: unknown = null;
    const run = (): void => {
      const items = module.useProjectStore.getState().project.mediaLibrary.items;
      if (items === lastItems) return;
      lastItems = items;
      void verify();
    };
    module.useProjectStore.subscribe(run);
    run();
  });
}
