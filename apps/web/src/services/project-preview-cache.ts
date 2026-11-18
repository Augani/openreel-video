export interface ProjectPreview {
  duration: number;
  thumbnailUrl?: string;
  modifiedAt: number;
}

const previews = new Map<string, ProjectPreview>();
const captured = new WeakSet<object>();
const pending = new Map<string, { revision: object; cancel: () => void }>();
const MAX_PREVIEWS = 12;

/** Capture real composed pixels once per immutable project revision, outside edit history. */
export function cacheProjectPreview(
  project: { id: string; modifiedAt: number },
  duration: number,
  source: HTMLCanvasElement,
): void {
  if (captured.has(project) || !source.width || !source.height) return;
  const copy = document.createElement("canvas");
  copy.width = 240;
  copy.height = Math.max(1, Math.round(240 * source.height / source.width));
  const ctx = copy.getContext("2d");
  if (!ctx) return;
  try { ctx.drawImage(source, 0, 0, copy.width, copy.height); }
  catch { return; }
  captured.add(project);
  pending.get(project.id)?.cancel();
  const job = () => {
    if (pending.get(project.id) !== entry) return;
    pending.delete(project.id);
    try {
      const thumbnailUrl = copy.toDataURL("image/jpeg", 0.72);
      previews.delete(project.id);
      previews.set(project.id, { duration, modifiedAt: project.modifiedAt, thumbnailUrl });
      while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
    } catch { captured.delete(project); }
  };
  const entry = { revision: project, cancel: () => {} };
  pending.set(project.id, entry);
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(job, { timeout: 500 });
    entry.cancel = () => { window.cancelIdleCallback(id); captured.delete(project); };
  } else {
    const id = window.setTimeout(job, 0);
    entry.cancel = () => { window.clearTimeout(id); captured.delete(project); };
  }
  // Interrupted project switches cannot accumulate pending canvas copies.
  while (pending.size > MAX_PREVIEWS) {
    const id = pending.keys().next().value!;
    pending.get(id)?.cancel(); pending.delete(id);
  }
}

export function getProjectPreview(projectId: string, modifiedAt?: number): ProjectPreview | undefined {
  if (pending.has(projectId)) return undefined;
  const preview = previews.get(projectId);
  return preview && (modifiedAt === undefined || preview.modifiedAt === modifiedAt) ? preview : undefined;
}
