import { getWarpRegistry } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Stabilized clips need their footage registered with the stabilizer: Synthesize Edges decodes neighbouring
 * frames of it, in the monitor as in the export. Following the project keeps that true after a reload, a paste or
 * an undo without anything having to open the inspector.
 */
let following = false;

function sync(): void {
  const registry = getWarpRegistry();
  const project = useProjectStore.getState().project;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.stabilization?.warpAnalysis || registry.getFootage(clip.id)) continue;
      const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
      if (media?.blob) registry.setFootage(clip.id, { blob: media.blob, mediaId: media.id });
    }
  }
}

export function followWarpFootage(): void {
  if (following) return;
  following = true;
  useProjectStore.subscribe((state, previous) => {
    if (state.project.timeline !== previous.project.timeline || state.project.mediaLibrary !== previous.project.mediaLibrary) sync();
  });
  sync();
}
