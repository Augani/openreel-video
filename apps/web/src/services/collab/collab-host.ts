import type { CollabHost, WireAction } from "@openreel/collab";
import type { ActionExecutor, MediaItem, Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";

/** Runtime-only fields of a media item that never travel (the peer relinks the file by name/fingerprint). */
const RUNTIME_MEDIA_FIELDS = ["blob", "fileHandle", "thumbnailUrl", "waveformData", "filmstripThumbnails", "nativeSource", "originalUrl"] as const;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Media for the wire: metadata and the file hint (name, size, mtime) only; the peer sees a placeholder to relink. */
export function wireMediaItem(item: MediaItem): MediaItem {
  const out = { ...item } as Mutable<MediaItem>;
  for (const field of RUNTIME_MEDIA_FIELDS) delete (out as Record<string, unknown>)[field];
  return {
    ...out,
    blob: null,
    fileHandle: null,
    thumbnailUrl: null,
    waveformData: null,
    isPlaceholder: true,
    sourceFile: item.sourceFile ?? (item.blob instanceof File ? { name: item.blob.name, size: item.blob.size, lastModified: item.blob.lastModified } : { name: item.name, size: item.blob?.size ?? 0, lastModified: 0 }),
  } as MediaItem;
}

export function serializeProjectForWire(project: Project): unknown {
  const stripped = { ...project, mediaLibrary: { items: project.mediaLibrary.items.map(wireMediaItem) } };
  return JSON.parse(JSON.stringify(stripped));
}

/** Deep copy that shares media runtime data (blobs, waveforms) instead of copying it. */
export function cloneProject(project: Project): Project {
  const detached = { ...project, mediaLibrary: undefined } as unknown as Project;
  let clone: Project;
  try {
    clone = structuredClone(detached) as Project;
  } catch {
    clone = JSON.parse(JSON.stringify(detached)) as Project;
  }
  return { ...clone, mediaLibrary: { items: project.mediaLibrary.items.map((item) => ({ ...item })) } };
}

/**
 * A rebuilt project knows media only as the room describes it. Carry the local
 * runtime data (the relinked file, thumbnail, waveform) over from the project
 * it replaces, and keep local-only media the room has not seen yet.
 */
export function mergeLocalMedia(next: Project, previous: Project): Project {
  const local = new Map(previous.mediaLibrary.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const items = next.mediaLibrary.items.map((item) => {
    seen.add(item.id);
    const mine = local.get(item.id);
    if (!mine || mine.isPlaceholder) return item;
    const merged = { ...item } as Mutable<MediaItem>;
    for (const field of RUNTIME_MEDIA_FIELDS) {
      if (mine[field] !== undefined) (merged as Record<string, unknown>)[field] = mine[field];
    }
    merged.isPlaceholder = false;
    merged.blob = mine.blob;
    merged.fileHandle = mine.fileHandle;
    return merged as MediaItem;
  });
  for (const item of previous.mediaLibrary.items) if (!seen.has(item.id)) items.push(item);
  return { ...next, mediaLibrary: { items } };
}

let remoteExecutor: Promise<ActionExecutor> | null = null;

/** A dedicated executor (with a private, discarded history) so collaborators' actions can never reach the user's undo stack. */
function getRemoteExecutor(): Promise<ActionExecutor> {
  remoteExecutor ??= import("../engine-modules").then(({ ActionExecutor: Executor }) => new Executor());
  return remoteExecutor;
}

export interface ProjectStoreHost extends CollabHost<Project> {
  /** The next replaceProject opens the room's project as a new document (first join). */
  loadNextReplacementAsNewProject(): void;
}

/** Wires the engine to the project store. */
export function createProjectStoreHost(options: { onDocumentReplaced?: () => void } = {}): ProjectStoreHost {
  let loadAsNew = false;
  const store = useProjectStore;
  return {
    getProject: () => store.getState().project,
    clone: cloneProject,
    serialize: serializeProjectForWire,
    deserialize: (raw) => {
      const project = raw as Project;
      return { ...project, mediaLibrary: { items: (project.mediaLibrary?.items ?? []).map((item) => ({ ...item, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, isPlaceholder: true })) } };
    },
    replaceProject(next, previous) {
      if (loadAsNew) {
        loadAsNew = false;
        store.getState().loadProject(next);
        options.onDocumentReplaced?.();
        return;
      }
      const merged = mergeLocalMedia(next, previous);
      store.getState().syncRenderProcessingFrom(merged);
      store.setState({ project: merged });
    },
    projectChanged() {
      const project = store.getState().project;
      store.getState().syncRenderProcessingFrom(project);
      store.setState({ project: { ...project } });
    },
    async applyAction(action: WireAction, project: Project) {
      const executor = await getRemoteExecutor();
      const result = await executor.applyRemote({ type: action.type, id: action.id, timestamp: action.timestamp, params: action.params }, project);
      return result.success;
    },
    discardHistory(actionIds) {
      const history = store.getState().actionHistory;
      for (const id of actionIds) history.discard(id);
    },
    loadNextReplacementAsNewProject() {
      loadAsNew = true;
    },
  };
}
