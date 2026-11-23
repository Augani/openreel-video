import type { Project } from "@openreel/core";

/**
 * Entry-path shim: a project with a Morph Cut transition wakes the (lazily loaded) background analysis service.
 * Projects without one cost a scan of the transition lists and nothing else; the analysis code is never loaded.
 */
export function projectHasMorphCut(project: Project): boolean {
  return project.timeline.tracks.some((track) => (track.transitions ?? []).some((transition) => transition.type === "morphCut"));
}

export function notifyMorphCutProject(project: Project): void {
  if (!projectHasMorphCut(project)) return;
  void import("./morph-cut-service").then((service) => service.scheduleMorphCutScan()).catch((error) => console.warn("[MorphCut] could not schedule analysis:", error));
}
