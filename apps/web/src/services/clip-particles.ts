import {
  getParticleOwner,
  isParticleEffect,
  type ActionHistory,
  type ParticleEffect,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
interface ParticleEditScope {
  projectId: string;
  clipId: string;
  history: ActionHistory;
}
/** Saved configurations own editing/history; transient emitter state never enters a project. */
export async function editClipParticles(
  scope: ParticleEditScope,
  update: (
    effects: readonly ParticleEffect[],
    project: Project,
  ) => readonly ParticleEffect[],
): Promise<boolean> {
  const state = useProjectStore.getState(),
    project = state.project;
  const owner = getParticleOwner(project, scope.clipId);
  const track = project.timeline.tracks.find(
    (item) => item.id === owner?.trackId,
  );
  if (
    !state.hasOpenProject ||
    project.id !== scope.projectId ||
    state.actionHistory !== scope.history ||
    !track ||
    track.locked ||
    useUIStore.getState().exportState.isExporting ||
    useUIStore.getState().effectApplicationClipId !== null ||
    useTimelineStore.getState().playbackLockedReason
  )
    return false;
  const current = (project.particleEffects ?? []).filter(
      (effect) => effect.clipId === scope.clipId,
    ),
    next = update(current, project);
  if (
    next.length === current.length &&
    next.every((effect, index) => effect === current[index])
  )
    return false;
  if (
    !next.every(
      (effect) => effect.clipId === scope.clipId && isParticleEffect(effect),
    )
  )
    throw new Error("The particle configuration is invalid.");
  const replacements = new Map(next.map((effect) => [effect.id, effect])),
    prior = new Set(current.map((effect) => effect.id));
  const all = (project.particleEffects ?? []).flatMap((effect) =>
    effect.clipId !== scope.clipId
      ? [effect]
      : replacements.has(effect.id)
        ? [replacements.get(effect.id)!]
        : [],
  );
  all.push(...next.filter((effect) => !prior.has(effect.id)));
  if (new Set(all.map((effect) => effect.id)).size !== all.length)
    throw new Error("Particle effects must have unique IDs.");
  const discrete = scope.history.getCurrentGroupId() === null;
  if (discrete) scope.history.beginGroup("Edit particles");
  let operation;
  try {
    operation = state.actionExecutor.execute(
      {
        type: "particle/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { effects: all },
      },
      project,
    );
  } finally {
    if (discrete) scope.history.endGroup();
  }
  const result = await operation;
  if (!result.success)
    throw new Error(
      result.error?.message ?? "The particle edit could not be applied.",
    );
  const fresh = useProjectStore.getState();
  if (
    fresh.project.id !== scope.projectId ||
    fresh.actionHistory !== scope.history
  )
    return false;
  useProjectStore.setState({
    project: {
      ...fresh.project,
      particleEffects: project.particleEffects,
      modifiedAt: Date.now(),
    },
  });
  return true;
}
