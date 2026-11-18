import type { ActionResult, MediaItem, Project } from "@openreel/core";
import { loadDirectoryHandle, loadFileHandle } from "./media-storage";

interface PlaceholderRestoreHost {
  isCurrent: () => boolean;
  getItem: (id: string) => MediaItem | undefined;
  replace: (id: string, file: File, folder?: string) => Promise<ActionResult>;
}

/** Resolve saved handles without allowing late reads to replace a newer project or source. */
export async function restoreProjectPlaceholders(project: Project, host: PlaceholderRestoreHost): Promise<number> {
  const placeholders = project.mediaLibrary.items.filter(item => item.isPlaceholder && item.sourceFile);
  const eligible = (item: MediaItem) => host.isCurrent() && host.getItem(item.id) === item && item.isPlaceholder;
  const stillMissing: MediaItem[] = [];
  let restored = 0;
  for (const item of placeholders) {
    if (!host.isCurrent()) return restored;
    if (!eligible(item) || !item.sourceFile) continue;
    try {
      const handle = await loadFileHandle(item.sourceFile.name, item.sourceFile.size);
      if (!host.isCurrent()) return restored;
      if (!eligible(item)) continue;
      if (!handle) { stillMissing.push(item); continue; }
      const file = await handle.getFile();
      if (!eligible(item)) continue;
      const result = await host.replace(item.id, file, item.sourceFile.folder);
      if (result.success) restored++;
      else if (eligible(item)) stillMissing.push(item);
    } catch { if (eligible(item)) stillMissing.push(item); }
  }
  if (!host.isCurrent() || !stillMissing.some(eligible)) return restored;
  try {
    const directory = await loadDirectoryHandle(project.id);
    if (!directory || !host.isCurrent()) return restored;
    const keyFor = (item: MediaItem) => `${item.sourceFile!.name.toLowerCase()}:${item.sourceFile!.size}`;
    const wanted = new Set(stillMissing.filter(eligible).map(keyFor));
    const files = new Map<string, File>();
    const entries = (directory.handle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
    for await (const [, handle] of entries) {
      if (!host.isCurrent()) return restored;
      if (handle.kind !== "file") continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (!host.isCurrent()) return restored;
        const key = `${file.name.toLowerCase()}:${file.size}`;
        if (wanted.has(key)) { files.set(key, file); wanted.delete(key); }
        if (!wanted.size) break;
      } catch { /* A stale entry does not prevent matching the remaining files. */ }
    }
    for (const item of stillMissing) {
      if (!host.isCurrent()) return restored;
      if (!eligible(item)) continue;
      const file = files.get(keyFor(item));
      if (!file) continue;
      try { if ((await host.replace(item.id, file, directory.folderName)).success) restored++; }
      catch { /* Keep the missing source visible for manual relink. */ }
    }
  } catch { /* Folder handles are optional and can expire between sessions. */ }
  return restored;
}
