import type { ActionExecutorLike } from "./lazy-action-executor";
import {
  AdjustmentLayerEngine,
  NestedSequenceEngine,
  deleteSequence,
  duplicateSequence,
  ensureSequences,
  nestClips,
  renameSequence,
  syncActiveSequence,
  type Action,
  type AdjustmentLayer,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { EditingSession } from "./agent/editing-session";

export interface AdvancedLayerScope {
  projectId: string;
  executor: ActionExecutorLike;
}
export function ownsAdvancedLayerScope(scope: AdvancedLayerScope): boolean {
  const state = useProjectStore.getState();
  return (
    state.hasOpenProject &&
    state.project.id === scope.projectId &&
    state.actionExecutor === scope.executor
  );
}
function editable(scope: AdvancedLayerScope): boolean {
  return (
    ownsAdvancedLayerScope(scope) &&
    !useUIStore.getState().exportState.isExporting &&
    useUIStore.getState().effectApplicationClipId === null &&
    !useTimelineStore.getState().playbackLockedReason
  );
}
export function findAdvancedOwner(project: Project, clipId: string) {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

function publishAdjustmentLayers(
  scope: AdvancedLayerScope,
  layers: AdjustmentLayer[],
): boolean {
  if (!editable(scope)) return false;
  const state = useProjectStore.getState(),
    previous = state.project.adjustmentLayers ?? [];
  if (
    layers.length === previous.length &&
    layers.every((layer, index) => layer === previous[index])
  )
    return false;
  const ids = new Set<string>();
  for (const layer of layers) {
    if (
      ids.has(layer.id) ||
      ![layer.startTime, layer.duration, layer.opacity].every(
        Number.isFinite,
      ) ||
      layer.startTime < 0 ||
      layer.duration <= 0 ||
      layer.opacity < 0 ||
      layer.opacity > 1
    )
      return false;
    ids.add(layer.id);
    if (
      new Set(layer.effects.map((effect) => effect.id)).size !==
      layer.effects.length
    )
      return false;
  }
  const id = crypto.randomUUID(),
    timestamp = Date.now();
  const action: Action = {
    type: "adjustment/setAll",
    id,
    timestamp,
    params: { layers: structuredClone(layers) },
  };
  const inverse: Action = {
    type: "adjustment/setAll",
    id: `inverse-${id}`,
    timestamp,
    params: { layers: structuredClone(previous) },
  };
  state.actionHistory.push(action, inverse);
  useProjectStore.setState({
    project: {
      ...state.project,
      adjustmentLayers: layers,
      modifiedAt: timestamp,
    },
    clipRedoStack: [],
    templateRedoStack: [],
  });
  // A renderer is a cache. Late initialization must hydrate the currently owned data.
  void useEngineStore
    .getState()
    .getAdjustmentLayerEngine()
    .then((engine) => {
      if (ownsAdvancedLayerScope(scope))
        engine.loadLayers(
          useProjectStore.getState().project.adjustmentLayers ?? [],
        );
    })
    .catch((error) =>
      console.warn(
        "[Adjustment layers] Could not refresh the rendering cache",
        error,
      ),
    );
  return true;
}

export function createAdjustmentLayerForClip(
  scope: AdvancedLayerScope,
  clipId: string,
): string | null {
  if (!editable(scope)) return null;
  const project = useProjectStore.getState().project,
    owner = findAdvancedOwner(project, clipId);
  if (
    !owner ||
    owner.track.locked ||
    !Number.isFinite(owner.clip.duration) ||
    owner.clip.duration <= 0
  )
    return null;
  const engine = new AdjustmentLayerEngine();
  const layer = engine.createAdjustmentLayer(
    owner.track.id,
    owner.clip.startTime,
    {
      duration: owner.clip.duration,
      name: `Adjustment ${(project.adjustmentLayers?.length ?? 0) + 1}`,
    },
  );
  layer.id = crypto.randomUUID();
  return publishAdjustmentLayers(scope, [
    ...(project.adjustmentLayers ?? []),
    layer,
  ])
    ? layer.id
    : null;
}

export function editAdjustmentLayer(
  scope: AdvancedLayerScope,
  layerId: string,
  update: (
    layer: Readonly<AdjustmentLayer>,
    project: Project,
  ) => AdjustmentLayer | null,
): boolean {
  if (!editable(scope)) return false;
  const project = useProjectStore.getState().project,
    layers = project.adjustmentLayers ?? [];
  const current = layers.find((layer) => layer.id === layerId);
  if (
    !current ||
    !project.timeline.tracks.some(
      (track) => track.id === current.trackId && !track.locked,
    )
  )
    return false;
  const next = update(current, project);
  if (next && (next.id !== current.id || next.trackId !== current.trackId))
    return false;
  return publishAdjustmentLayers(
    scope,
    layers.flatMap((layer) =>
      layer.id !== layerId ? [layer] : next ? [next] : [],
    ),
  );
}

export function duplicateAdjustmentLayer(
  scope: AdvancedLayerScope,
  layerId: string,
): string | null {
  if (!editable(scope)) return null;
  const project = useProjectStore.getState().project,
    layer = project.adjustmentLayers?.find((item) => item.id === layerId);
  if (
    !layer ||
    !project.timeline.tracks.some(
      (track) => track.id === layer.trackId && !track.locked,
    )
  )
    return null;
  const duplicate = structuredClone(layer);
  duplicate.id = crypto.randomUUID();
  duplicate.name = `${layer.name} (Copy)`;
  duplicate.effects = duplicate.effects.map((effect) => ({
    ...effect,
    id: crypto.randomUUID(),
  }));
  return publishAdjustmentLayers(scope, [
    ...(project.adjustmentLayers ?? []),
    duplicate,
  ])
    ? duplicate.id
    : null;
}

function beginNestedEdit(scope: AdvancedLayerScope) {
  if (!editable(scope))
    throw new Error("The project changed or editing is unavailable.");
  const session = new EditingSession(),
    transaction = session.beginTransaction(),
    project = session.getProject();
  const engine = new NestedSequenceEngine();
  engine.loadState(project.compoundClips ?? [], project.nestedInstances ?? []);
  return { session, transaction, project, engine };
}
function assertTrackEditable(project: Project, trackId: string) {
  if (
    !project.timeline.tracks.some(
      (track) => track.id === trackId && !track.locked,
    )
  )
    throw new Error(
      "Unlock the affected track before editing the compound clip.",
    );
}
async function commitNested(
  scope: AdvancedLayerScope,
  edit: ReturnType<typeof beginNestedEdit>,
  label: string,
  timeline = edit.project.timeline,
) {
  if (!editable(scope))
    throw new Error("The project changed before the compound edit completed.");
  edit.session.replaceDraft({
    ...edit.project,
    timeline,
    compoundClips: edit.engine.getAllCompoundClips(),
    nestedInstances: edit.engine.getAllInstances(),
  });
  await edit.session.commitTransaction(edit.transaction, label);
  if (!ownsAdvancedLayerScope(scope)) return false;
  void useEngineStore
    .getState()
    .getNestedSequenceEngine()
    .then((engine) => {
      if (ownsAdvancedLayerScope(scope)) {
        const project = useProjectStore.getState().project;
        engine.loadState(
          project.compoundClips ?? [],
          project.nestedInstances ?? [],
        );
      }
    })
    .catch((error) =>
      console.warn(
        "[Nested sequences] Could not refresh the rendering cache",
        error,
      ),
    );
  return true;
}

/** Commit a project computed by the pure sequence functions as one undo step. */
async function commitSequenceProject(
  scope: AdvancedLayerScope,
  edit: ReturnType<typeof beginNestedEdit>,
  label: string,
  project: Project,
) {
  if (!editable(scope))
    throw new Error("The project changed before the compound edit completed.");
  edit.session.replaceDraft(project);
  await edit.session.commitTransaction(edit.transaction, label);
  if (!ownsAdvancedLayerScope(scope)) return false;
  void useEngineStore
    .getState()
    .getNestedSequenceEngine()
    .then((engine) => {
      if (ownsAdvancedLayerScope(scope)) {
        const current = useProjectStore.getState().project;
        engine.loadState(current.compoundClips ?? [], current.nestedInstances ?? []);
      }
    })
    .catch((error) =>
      console.warn("[Nested sequences] Could not refresh the rendering cache", error),
    );
  return true;
}

export async function createEditorCompound(
  scope: AdvancedLayerScope,
  clipIds: readonly string[],
): Promise<{ compoundId: string; instanceId: string } | null> {
  const edit = beginNestedEdit(scope),
    { project } = edit;
  const selected = new Set(clipIds),
    clips = project.timeline.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => selected.has(clip.id));
  if (clips.length < 2) return null;
  for (const clip of clips) assertTrackEditable(project, clip.trackId);
  // A compound clip IS a nested sequence now: it is openable in its own tab.
  const result = nestClips(project, clipIds, `Compound Clip ${(project.compoundClips?.length ?? 0) + 1}`);
  if (!result.ok) throw new Error(result.message);
  return (await commitSequenceProject(scope, edit, "Create compound clip", result.project))
    ? { compoundId: result.sequenceId as string, instanceId: result.clipId as string }
    : null;
}

export async function flattenEditorCompound(
  scope: AdvancedLayerScope,
  instanceId: string,
): Promise<boolean> {
  const edit = beginNestedEdit(scope),
    { project, engine } = edit;
  const owner = findAdvancedOwner(project, instanceId),
    instance = engine.getInstance(instanceId);
  if (!owner || !instance) return false;
  assertTrackEditable(project, owner.track.id);
  engine.updateInstance(instanceId, {
    trackId: owner.track.id,
    startTime: owner.clip.startTime,
    duration: owner.clip.duration,
    inPoint: owner.clip.inPoint,
    outPoint: owner.clip.outPoint,
    transform: owner.clip.transform,
    volume: owner.clip.volume,
  });
  const compound = engine.getCompoundClip(instance.compoundClipId);
  const flattened = engine.flattenInstance(instanceId);
  if (!flattened || !compound) return false;
  const occupiedIds = new Set(
    [
      ...project.timeline.tracks.flatMap((track) => track.clips),
      ...(project.textClips ?? []),
      ...(project.shapeClips ?? []),
      ...(project.svgClips ?? []),
      ...(project.stickerClips ?? []),
    ]
      .filter((clip) => clip.id !== instanceId)
      .map((clip) => clip.id),
  );
  const tracksById = new Map(
    project.timeline.tracks.map((track) => [track.id, track]),
  );
  // A nest made from timeline clips remembers the parent track each inner track came from.
  const origin = ensureSequences(project).sequences?.find((item) => item.id === compound.id)?.sourceTrackIds;
  const parentTrackFor = (innerTrackId: string): string =>
    tracksById.has(innerTrackId) ? innerTrackId : origin?.[innerTrackId] && tracksById.has(origin[innerTrackId]) ? origin[innerTrackId] : owner.track.id;
  const restored = flattened.clips.map((clip, index) => {
    const source = compound.content.clips[index];
    const trackId = parentTrackFor(source.trackId);
    assertTrackEditable(project, trackId);
    let id = occupiedIds.has(source.id) ? clip.id : source.id;
    while (occupiedIds.has(id)) id = crypto.randomUUID();
    occupiedIds.add(id);
    return { ...clip, id, trackId };
  });
  const sourceIds = new Map(
    compound.content.clips.map((clip, index) => [clip.id, restored[index].id]),
  );
  const timeline = {
    ...project.timeline,
    tracks: project.timeline.tracks.map((track) => {
      const transitions = compound.content.tracks
        .filter((source) => parentTrackFor(source.id) === track.id)
        .flatMap((source) =>
          source.transitions.map((transition) => ({
            ...transition,
            id: crypto.randomUUID(),
            clipAId: sourceIds.get(transition.clipAId) ?? transition.clipAId,
            ...(transition.clipBId
              ? {
                  clipBId:
                    sourceIds.get(transition.clipBId) ?? transition.clipBId,
                }
              : {}),
          })),
        );
      return {
        ...track,
        clips: [
          ...track.clips.filter((clip) => clip.id !== instanceId),
          ...restored.filter((clip) => clip.trackId === track.id),
        ],
        transitions: [
          ...track.transitions
            .filter(
              (transition) =>
                transition.clipAId !== instanceId &&
                transition.clipBId !== instanceId,
            )
            .map((transition) => ({
              ...transition,
              clipAId: sourceIds.get(transition.clipAId) ?? transition.clipAId,
              ...(transition.clipBId
                ? {
                    clipBId:
                      sourceIds.get(transition.clipBId) ?? transition.clipBId,
                  }
                : {}),
            })),
          ...transitions,
        ],
      };
    }),
  };
  return commitNested(scope, edit, "Flatten compound clip", timeline);
}

export async function editEditorCompound(
  scope: AdvancedLayerScope,
  compoundId: string,
  operation:
    | { type: "rename"; name: string }
    | { type: "duplicate" }
    | { type: "delete" },
): Promise<string | null> {
  const edit = beginNestedEdit(scope),
    { project } = edit;
  const ready = syncActiveSequence(ensureSequences(project));
  const sequence = ready.sequences?.find((item) => item.id === compoundId);
  if (!sequence) return null;
  for (const track of operation.type === "duplicate"
    ? []
    : project.timeline.tracks)
    if (
      track.clips.some(
        (clip) =>
          clip.metadata?.compoundClipId === compoundId ||
          clip.mediaId === `compound:${compoundId}`,
      )
    )
      assertTrackEditable(project, track.id);
  let result;
  if (operation.type === "rename") {
    const name = operation.name.trim();
    if (!name || name === sequence.name) return null;
    result = renameSequence(ready, compoundId, name);
  } else if (operation.type === "duplicate") {
    result = duplicateSequence(ready, compoundId);
  } else {
    result = deleteSequence(ready, compoundId);
    // Nested somewhere: the legacy contract is "refuse", not "throw".
    if (!result.ok) return null;
  }
  if (!result.ok) throw new Error(result.message);
  return (await commitSequenceProject(
    scope,
    edit,
    `${operation.type === "rename" ? "Rename" : operation.type === "duplicate" ? "Duplicate" : "Delete"} compound clip`,
    result.project,
  ))
    ? (result.sequenceId ?? compoundId)
    : null;
}
