import type { Project } from "@openreel/core";

/**
 * Export pre-step for Remove Object: when the analysis cache (IndexedDB) was cleared, re-run the analysis with
 * progress instead of failing the export. A no-op (and the analysis module is not even loaded) for a project
 * without Remove Object clips.
 */
export async function prepareObjectRemovalForExport(
  project: Pick<Project, "timeline">,
  hooks: { isCancelled: () => boolean; onProgress: (fraction: number, label: string) => void },
): Promise<number> {
  const any = (project.timeline?.tracks ?? []).some((track) => (track.clips ?? []).some((clip) => clip.objectRemoval?.enabled === true && typeof clip.objectRemoval.analysisKey === "string"));
  if (!any) return 0;
  const { ensureRemovalAnalysesForExport } = await import("./content-aware-fill");
  const controller = new AbortController();
  const watch = setInterval(() => {
    if (hooks.isCancelled()) controller.abort();
  }, 200);
  try {
    return await ensureRemovalAnalysesForExport(project, controller.signal, hooks.onProgress);
  } catch (error) {
    if (controller.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
    throw error;
  } finally {
    clearInterval(watch);
  }
}
