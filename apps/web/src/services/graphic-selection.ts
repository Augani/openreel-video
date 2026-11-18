import { expectedMemberIds, getGraphicInstance, type GraphicInstance, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";

/** The clip id that stands for the whole graphic in selection (its first member layer). */
export function graphicAnchorId(project: Project, instance: GraphicInstance): string | undefined {
  const [first] = expectedMemberIds(instance, project.settings);
  return first;
}

/** Select a graphic by instance id: its first layer, or its rendered clip while rendered. */
export function selectGraphic(instanceId: string): void {
  const project = useProjectStore.getState().getFullProject();
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return;
  if (instance.bake) {
    useUIStore.getState().select({ type: "clip", id: instance.bake.clipId });
    return;
  }
  const anchor = graphicAnchorId(project, instance);
  if (!anchor) return;
  const type = project.textClips?.some((clip) => clip.id === anchor) ? "text-clip" : "shape-clip";
  useUIStore.getState().select({ type, id: anchor, trackId: instance.trackId });
}
