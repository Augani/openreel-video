import { subclipRange } from "../media/bins";
import { interpretationSpeed } from "../media/interpretation";
import type {
  Action,
  ActionResult,
  TimelineAction,
  TrackAction,
  ClipAction,
  EffectAction,
  TransformAction,
  KeyframeAction,
  TransitionAction,
  AudioAction,
  SubtitleAction,
  MediaAction,
  ProjectAction,
  MarkerAction,
} from "../types/actions";
import type {
  Project,
  Track,
  Clip,
  Effect,
  Keyframe,
  EasingType,
  Transition,
  Subtitle,
  SubtitleStyle,
  MediaItem,
  TransitionType,
  Marker,
  MarkerKind,
  ReviewReply,
  ReviewStatus,
  AudioType,
  EssentialSoundState,
  LiveDuckingConfig,
} from "../types";
import type {
  MutableTimeline,
  MutableTrack,
  MutableClip,
} from "../utils/immutable-updates";
import { prepareClipSplit } from "../editing/clip-fragments";
import { applyTimelineToolEdits, rebaseSplitInverse, validateTimelineToolEdits, type TimelineToolItemEdit } from "../editing/timeline-tool-edit";
import type { BlendMode } from "../video/types";
import type { EmphasisAnimation } from "../graphics/types";
import type { ShapeClip, StickerClip, SVGClip } from "../graphics/types";
import type { TextClip } from "../text/types";
import type { AdjustmentLayer } from "../video/adjustment-layer-engine";
import type { MotionCompositionInstance } from "../motion/types";
import type { ClipColorGrading } from "../video/color-grading-engine";
import {
  registerMotionShader,
  unregisterMotionShader,
  isBuiltinMotionShaderId,
} from "../motion/shaders/registry";
import type { MotionShaderDef } from "../motion/shaders/types";
import { normalizeLiveDucking } from "../audio/live-ducking";
import { ActionValidator } from "./action-validator";
import { ActionHistory } from "./action-history";
import { InverseActionGenerator } from "./inverse-action-generator";
import { getActionHandler } from "./registry";
import "./handlers";
import { calculateProjectDuration } from "../timeline/project-duration";
import { reconcileGraphicInstances } from "../graphic-templates/instances";
import { reconcileMulticamAudio } from "../multicam/fixed-audio";

interface MutableProjectItems {
  textClips?: TextClip[];
  shapeClips?: ShapeClip[];
  svgClips?: SVGClip[];
  stickerClips?: StickerClip[];
  adjustmentLayers?: AdjustmentLayer[];
  motionInstances?: MotionCompositionInstance[];
}

interface TrackOwnedItems {
  textClips: TextClip[];
  shapeClips: ShapeClip[];
  svgClips: SVGClip[];
  stickerClips: StickerClip[];
  adjustmentLayers: AdjustmentLayer[];
  motionInstances: MotionCompositionInstance[];
}

function getTrackOwnedItems(project: Project, trackId: string): TrackOwnedItems {
  return {
    textClips: (project.textClips ?? []).filter((item) => item.trackId === trackId),
    shapeClips: (project.shapeClips ?? []).filter((item) => item.trackId === trackId),
    svgClips: (project.svgClips ?? []).filter((item) => item.trackId === trackId),
    stickerClips: (project.stickerClips ?? []).filter(
      (item) => item.trackId === trackId,
    ),
    adjustmentLayers: (project.adjustmentLayers ?? []).filter(
      (item) => item.trackId === trackId,
    ),
    motionInstances: (project.motionInstances ?? []).filter(
      (item) => item.trackId === trackId,
    ),
  };
}

function removeTrackOwnedItems(project: Project, trackId: string): void {
  const mutable = project as Project & MutableProjectItems;
  mutable.textClips = (project.textClips ?? []).filter(
    (item) => item.trackId !== trackId,
  );
  mutable.shapeClips = (project.shapeClips ?? []).filter(
    (item) => item.trackId !== trackId,
  );
  mutable.svgClips = (project.svgClips ?? []).filter(
    (item) => item.trackId !== trackId,
  );
  mutable.stickerClips = (project.stickerClips ?? []).filter(
    (item) => item.trackId !== trackId,
  );
  mutable.adjustmentLayers = (project.adjustmentLayers ?? []).filter(
    (item) => item.trackId !== trackId,
  );
  mutable.motionInstances = (project.motionInstances ?? []).filter(
    (item) => item.trackId !== trackId,
  );
}

function restoreTrackOwnedItems(project: Project, items: TrackOwnedItems): void {
  const mutable = project as Project & MutableProjectItems;
  mutable.textClips = [...(project.textClips ?? []), ...items.textClips];
  mutable.shapeClips = [...(project.shapeClips ?? []), ...items.shapeClips];
  mutable.svgClips = [...(project.svgClips ?? []), ...items.svgClips];
  mutable.stickerClips = [...(project.stickerClips ?? []), ...items.stickerClips];
  mutable.adjustmentLayers = [
    ...(project.adjustmentLayers ?? []),
    ...items.adjustmentLayers,
  ];
  mutable.motionInstances = [
    ...(project.motionInstances ?? []),
    ...items.motionInstances,
  ];
}

/**
 * Independent copy of everything an inverse action may retain, taken before the
 * handler mutates the live project. Media library items are immutable sources
 * (Blob handles, Float32Array waveforms, filmstrip data URLs): copying them was
 * the dominant cost of every edit (seconds on a 400-clip project), so they are
 * shared by reference and only the item list is copied.
 */
export function snapshotProjectForInverse(project: Project): Project {
  const detached = { ...project, mediaLibrary: { items: [] } };
  let clone: Project;
  try {
    clone = structuredClone(detached) as Project;
  } catch {
    // Non-cloneable values (functions, reactive proxies) previously survived the
    // JSON round-trip this replaced; keep that behavior as the slow fallback.
    clone = JSON.parse(JSON.stringify(detached)) as Project;
  }
  return {
    ...clone,
    mediaLibrary: { items: project.mediaLibrary.items.map((item) => ({ ...item })) },
  };
}

export class ActionExecutor {
  private validator: ActionValidator;
  private history: ActionHistory;
  private inverseGenerator: InverseActionGenerator;
  private lastAddedIds: Map<string, string> = new Map();

  private isSameTransitionPlacement(
    candidate: Transition,
    transition: Transition,
  ): boolean {
    if (candidate.id === transition.id) {
      return true;
    }

    if (candidate.clipBId || transition.clipBId) {
      return (
        candidate.clipAId === transition.clipAId &&
        candidate.clipBId === transition.clipBId
      );
    }

    return (
      candidate.clipAId === transition.clipAId &&
      (candidate.edge ?? "out") === (transition.edge ?? "out")
    );
  }

  constructor(history?: ActionHistory) {
    this.validator = new ActionValidator();
    this.history = history || new ActionHistory();
    this.inverseGenerator = new InverseActionGenerator();
  }

  async execute(action: Action, project: Project): Promise<ActionResult> {
    // A pointer/key gesture may finish while applyAction yields. Membership
    // belongs to invocation, not whichever group happens to be open later.
    const invocationGroupId = this.history.getCurrentGroupId();
    const validationResult = this.validator.validate(action, project);

    if (!validationResult.valid) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: validationResult.errors.map((e) => e.message).join("; "),
          details: { errors: validationResult.errors },
        },
      };
    }
    if (action.type === "clip/split") {
      try {
        const plan = prepareClipSplit(project, action.params.clipId as string, action.params.time as number, action.id);
        validateTimelineToolEdits(project, plan.edits);
        action = { ...action, params: { ...action.params, splitEdits: structuredClone(plan.edits), rightClipId: plan.rightClipId } };
      } catch (error) {
        return { success: false, error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : "The clip could not be split." } };
      }
    }
    if (action.type === "timeline/toolEdit") action = { ...action, params: { ...action.params, edits: structuredClone(action.params.edits) } };
    // Own the forward particle configuration as well as its inverse.
    if (action.type === "particle/setAll") action = { ...action, params: { ...action.params, effects: structuredClone(action.params.effects) } };
    // Add inverses capture only the new entity ID, resolved before history push.
    // Transform inverses capture only the affected transform synchronously.
    // A held slider must not serialize every clip, waveform or media item.
    // clip/move (one per frame during a drag) reads only the clip's old start/track: no project copy.
    const projectSnapshot = action.type === "clip/move" ? project : action.type === "project/updateSettings" ? {
      ...project,
      // Settings history owns only the five scalar settings. Large waveforms,
      // media handles and unrelated editing data never need JSON traversal.
      settings: { ...project.settings },
    } : (action.type === "track/add" || action.type === "clip/add" || action.type === "transform/update" || action.type === "timeline/toolEdit" || action.type === "media/organize" || action.type === "clip/slip" || action.type === "clip/split") ? project : action.type === "mask/setAll" ? {
      ...project,
      // Mask inverses own only the saved masks. Large media, waveform and
      // overlay collections do not need serializing for every slider step.
      masks: project.masks ? structuredClone(project.masks) : undefined,
    } : action.type === "particle/setAll" ? {
      ...project,
      particleEffects: project.particleEffects ? structuredClone(project.particleEffects) : undefined,
    } : snapshotProjectForInverse(project);
    const inverseAction = this.inverseGenerator.generate(
      action,
      projectSnapshot,
    );
    try {
      await this.applyAction(action as TimelineAction, project);
      // Resolve generated-id markers while this action's newly-created entity is
      // still the latest one. Deferring resolution until undo makes every entry
      // in a grouped add operation target the final created entity instead.
      const resolvedInverseAction = inverseAction
        ? this.resolveSpecialMarkers(inverseAction)
        : null;
      this.history.push(action, resolvedInverseAction, invocationGroupId);

      return {
        success: true,
        actionId: action.id,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
        },
      };
    }
  }

  async executeMany(
    actions: Action[],
    project: Project,
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const action of actions) {
      const result = await this.execute(action, project);
      results.push(result);
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  async undo(project: Project): Promise<ActionResult> {
    if (!this.history.canUndo()) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: "Nothing to undo",
        },
      };
    }

    const inverseActions = this.history.undoGroup();
    if (inverseActions.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: "No inverse action available",
        },
      };
    }

    const applied: Action[] = [];
    try {
      for (const inverseAction of inverseActions) {
        const resolvedAction = this.rebaseStaleInverse(this.resolveSpecialMarkers(inverseAction), project);
        await this.applyAction(resolvedAction as TimelineAction, project);
        applied.push(resolvedAction);
      }
      this.history.notifyApplied({ kind: "undo", actions: applied });
      return { success: true, actionId: inverseActions[0].id };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: error instanceof Error ? error.message : "Undo failed",
        },
      };
    }
  }

  async redo(project: Project): Promise<ActionResult> {
    if (!this.history.canRedo()) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: "Nothing to redo",
        },
      };
    }

    const actions = this.history.redoGroup();
    if (actions.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: "No action to redo",
        },
      };
    }

    try {
      for (const action of actions) {
        await this.applyAction(action as TimelineAction, project);
      }
      this.history.notifyApplied({ kind: "redo", actions });
      return { success: true, actionId: actions[0].id };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: error instanceof Error ? error.message : "Redo failed",
        },
      };
    }
  }

  getHistory(): ActionHistory {
    return this.history;
  }

  /**
   * A collaborator may have changed an item since the recorded inverse was made.
   * Applying it blindly would overwrite their work and diverge from every peer
   * that validates the published op, so re-aim the inverse at the current state
   * when it is a split-undo; anything else is applied as recorded.
   */
  private rebaseStaleInverse(action: Action, project: Project): Action {
    if (action.type !== "timeline/toolEdit" || !Array.isArray(action.params.edits)) return action;
    const edits = action.params.edits as TimelineToolItemEdit[];
    try {
      validateTimelineToolEdits(project, edits);
      return action;
    } catch {
      const rebased = rebaseSplitInverse(project, edits);
      return rebased ? { ...action, params: { ...action.params, edits: rebased } } : action;
    }
  }

  private resolveSpecialMarkers(action: Action): Action {
    const params = { ...action.params } as Record<string, unknown>;

    for (const [key, value] of Object.entries(params)) {
      if (value === "__LAST_ADDED__") {
        const lastId = this.lastAddedIds.get(action.type.split("/")[0]);
        if (lastId) {
          params[key] = lastId;
        }
      }
    }

    return { ...action, params };
  }

  /**
   * Ids minted while applying an action derive from the action id, so every
   * collaborator applying the same action creates the same entities.
   */
  private idScope: string | null = null;
  private idCounter = 0;

  private genId(prefix = ""): string {
    if (this.idScope !== null) return `${prefix}${this.idScope}-${this.idCounter++}`;
    return `${prefix}${crypto.randomUUID()}`;
  }

  /**
   * Apply an action that another collaborator already sequenced. It never
   * enters this executor's undo history (so local undo cannot undo it), and it
   * is validated like any edit so a stale target is a deterministic no-op.
   */
  async applyRemote(action: Action, project: Project): Promise<ActionResult> {
    const validation = this.validator.validate(action, project);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: validation.errors.map((e) => e.message).join("; "),
          details: { errors: validation.errors },
        },
      };
    }
    try {
      await this.applyAction(action as TimelineAction, project);
      return { success: true, actionId: action.id };
    } catch (error) {
      return { success: false, error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : "Remote action failed" } };
    }
  }

  private async applyAction(
    action: TimelineAction,
    project: Project,
  ): Promise<void> {
    const previousScope = this.idScope;
    const previousCounter = this.idCounter;
    this.idScope = (action as Action).id ?? null;
    this.idCounter = 0;
    try {
      await this.applyActionScoped(action, project);
    } finally {
      this.idScope = previousScope;
      this.idCounter = previousCounter;
    }
  }

  private async applyActionScoped(
    action: TimelineAction,
    project: Project,
  ): Promise<void> {
    const type = action.type;

    const handler = getActionHandler(type);
    if (handler) {
      await handler.apply(action as Action, project, {
        lastAddedIds: this.lastAddedIds,
      });
      this.reconcileGraphics(project);
      this.reconcileMulticamAudio(project);
      this.recalculateTimelineDuration(project);
      this.markProjectModified(project);
      return;
    }

    if (type.startsWith("project/")) {
      this.applyProjectAction(action as ProjectAction, project);
    } else if (type.startsWith("media/")) {
      await this.applyMediaAction(action as MediaAction, project);
    } else if (type.startsWith("track/")) {
      this.applyTrackAction(action as TrackAction, project);
    } else if (type.startsWith("clip/")) {
      this.applyClipAction(action as ClipAction, project);
    } else if (type.startsWith("effect/")) {
      this.applyEffectAction(action as EffectAction, project);
    } else if (type.startsWith("transform/")) {
      this.applyTransformAction(action as TransformAction, project);
    } else if (type.startsWith("keyframe/")) {
      this.applyKeyframeAction(action as KeyframeAction, project);
    } else if (type.startsWith("transition/")) {
      this.applyTransitionAction(action as TransitionAction, project);
    } else if (type.startsWith("audio/")) {
      this.applyAudioAction(action as AudioAction, project);
    } else if (type.startsWith("subtitle/")) {
      this.applySubtitleAction(action as SubtitleAction, project);
    } else if (type.startsWith("marker/")) {
      this.applyMarkerAction(action as MarkerAction, project);
    }

    this.reconcileGraphics(project);
    this.reconcileMulticamAudio(project);
    // Recompute timeline duration from clips after any action that may affect it
    this.recalculateTimelineDuration(project);
    this.markProjectModified(project);
  }

  /**
   * Essential Graphics: generic edits (sync lock, ripple, track edits) shift a
   * graphic's member clips without knowing about the instance record. Re-derive
   * the instance from them. No-op (one property read) for projects without graphics.
   */
  private reconcileGraphics(project: Project): void {
    if (!project.graphicInstances?.length) return;
    const next = reconcileGraphicInstances(project);
    if (next === project) return;
    const target = project as { -readonly [K in keyof Project]: Project[K] };
    target.textClips = next.textClips;
    target.shapeClips = next.shapeClips;
    target.svgClips = next.svgClips;
    target.graphicInstances = next.graphicInstances;
  }

  /**
   * Fixed-angle multicam audio is derived from the multicam video clips, so any
   * action, undo or redo that moved, trimmed, slipped, split or shifted them
   * re-derives it here and the sound stays sample-locked. One property scan for
   * projects without a fixed-audio source.
   */
  private reconcileMulticamAudio(project: Project): void {
    if (!project.multicamSources?.some((source) => source.audio.mode === "fixed")) return;
    const next = reconcileMulticamAudio(project);
    if (next === project) return;
    (project.timeline as MutableTimeline).tracks = next.timeline.tracks;
  }

  private recalculateTimelineDuration(project: Project): void {
    (project.timeline as MutableTimeline).duration =
      calculateProjectDuration(project);
  }

  private markProjectModified(project: Project): void {
    (project as { modifiedAt: number }).modifiedAt = Date.now();
  }

  private applyProjectAction(action: ProjectAction, project: Project): void {
    switch (action.type) {
      case "project/rename":
        (project as any).name = action.params.name;
        (project as any).modifiedAt = Date.now();
        break;

      case "project/updateSettings":
        (project as any).settings = {
          ...project.settings,
          ...action.params,
        };
        (project as any).modifiedAt = Date.now();
        break;

      case "project/setCanvasBackground":
        (project as any).timeline = {
          ...project.timeline,
          backgroundFillMode: action.params.backgroundFillMode,
          layoutBackgroundColor: action.params.layoutBackgroundColor,
        };
        (project as any).modifiedAt = Date.now();
        break;

      case "project/create":
        (project as any).name = action.params.name;
        (project as any).settings = action.params.settings;
        (project as any).modifiedAt = Date.now();
        break;

      case "project/registerGeneratedShader": {
        const def = action.params.def;
        if (isBuiltinMotionShaderId(def.id)) break;
        const existing: readonly MotionShaderDef[] =
          project.generatedShaders ?? [];
        const next = [
          ...existing.filter((entry) => entry.id !== def.id),
          def,
        ];
        (project as any).generatedShaders = next;
        (project as any).modifiedAt = Date.now();
        registerMotionShader(def);
        break;
      }

      case "project/removeGeneratedShader": {
        const shaderId = action.params.shaderId;
        const existing: readonly MotionShaderDef[] =
          project.generatedShaders ?? [];
        (project as any).generatedShaders = existing.filter(
          (entry) => entry.id !== shaderId,
        );
        (project as any).modifiedAt = Date.now();
        unregisterMotionShader(shaderId);
        break;
      }
    }
  }

  private async applyMediaAction(
    action: MediaAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): Promise<void> {
    const mediaLibrary = project.mediaLibrary as any;

    switch (action.type) {
      case "media/import": {
        const params = action.params as { file: File };
        const newMediaItem = {
          id: this.genId("media-"),
          name: params.file.name,
          type: this.inferMediaType(params.file),
          fileHandle: null,
          blob: params.file,
          metadata: {
            duration: 0,
            width: 0,
            height: 0,
            frameRate: 0,
            codec: "",
            sampleRate: 0,
            channels: 0,
            fileSize: params.file.size,
          },
          thumbnailUrl: null,
          waveformData: null,
        };
        mediaLibrary.items = [...mediaLibrary.items, newMediaItem];
        this.lastAddedIds.set("media", newMediaItem.id);
        break;
      }

      case "media/delete": {
        const params = action.params as { mediaId: string };
        mediaLibrary.items = mediaLibrary.items.filter(
          (item: MediaItem) => item.id !== params.mediaId,
        );
        break;
      }

      case "media/rename": {
        const params = action.params as { mediaId: string; name: string };
        mediaLibrary.items = mediaLibrary.items.map((item: MediaItem) =>
          item.id === params.mediaId ? { ...item, name: params.name } : item,
        );
        break;
      }

      case "media/restore": {
        const params = action.params as { mediaItem: MediaItem };
        mediaLibrary.items = [...mediaLibrary.items, params.mediaItem];
        break;
      }
    }
  }

  private inferMediaType(file: File): "video" | "audio" | "image" {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("image/")) return "image";
    return "video";
  }

  private applyTrackAction(
    action: TrackAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "track/add": {
        const params = action.params as {
          trackType: string;
          position?: number;
          trackId?: string;
          mode?: "standard";
          role?: Track["role"];
          name?: string;
        };
        const trackNames: Record<string, string> = {
          video: "Video",
          audio: "Audio",
          image: "Image",
          text: "Text",
          graphics: "Graphics",
        };
        const trackCount =
          timeline.tracks.filter((track: MutableTrack) =>
            params.mode === "standard"
              ? track.mode === "standard"
              : track.type === params.trackType,
          ).length + 1;
        const newTrack: MutableTrack = {
          id: params.trackId ?? this.genId("track-"),
          type: params.trackType as Track["type"],
          mode: params.mode,
          role: params.role,
          name:
            params.name ??
            `${
              params.mode === "standard"
                ? "Track"
                : trackNames[params.trackType] || params.trackType
            } ${trackCount}`,
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        };

        const position =
          params.position !== undefined
            ? params.position
            : timeline.tracks.length;

        timeline.tracks = [
          ...timeline.tracks.slice(0, position),
          newTrack,
          ...timeline.tracks.slice(position),
        ];
        this.lastAddedIds.set("track", newTrack.id);
        break;
      }

      case "track/duplicate": {
        const params = action.params as {
          sourceTrackId: string;
          position?: number;
          trackId?: string;
          itemIdMap?: Record<string, string>;
          transitionIdMap?: Record<string, string>;
        };
        const sourceIndex = timeline.tracks.findIndex(
          (track: MutableTrack) => track.id === params.sourceTrackId,
        );
        if (sourceIndex < 0) break;
        const source = timeline.tracks[sourceIndex];
        const trackId = params.trackId ?? this.genId("track-");
        params.trackId = trackId;
        const ownedItems = getTrackOwnedItems(project, source.id);
        const sourceItemIds = [
          ...source.clips.map((clip) => clip.id),
          ...ownedItems.textClips.map((item) => item.id),
          ...ownedItems.shapeClips.map((item) => item.id),
          ...ownedItems.svgClips.map((item) => item.id),
          ...ownedItems.stickerClips.map((item) => item.id),
          ...ownedItems.adjustmentLayers.map((item) => item.id),
          ...ownedItems.motionInstances.map((item) => item.id),
        ];
        params.itemIdMap ??= Object.fromEntries(
          sourceItemIds.map((id) => [id, this.genId("item-")]),
        );
        params.transitionIdMap ??= Object.fromEntries(
          source.transitions.map((transition) => [
            transition.id,
            this.genId("transition-"),
          ]),
        );
        const duplicateItem = <T extends { id: string; trackId?: string }>(
          item: T,
        ): T => ({
          ...structuredClone(item),
          id: params.itemIdMap![item.id]!,
          trackId,
        });
        const names = new Set(timeline.tracks.map((track) => track.name));
        const baseName = `${source.name} Copy`;
        let name = baseName;
        let suffix = 2;
        while (names.has(name)) {
          name = `${baseName} ${suffix}`;
          suffix += 1;
        }
        const duplicate: MutableTrack = {
          ...structuredClone(source),
          id: trackId,
          name,
          clips: source.clips.map((clip) => ({
            ...structuredClone(clip),
            id: params.itemIdMap![clip.id]!,
            trackId,
          })),
          transitions: source.transitions.map((transition) => ({
            ...structuredClone(transition),
            id: params.transitionIdMap![transition.id]!,
            clipAId:
              params.itemIdMap![transition.clipAId] ?? transition.clipAId,
            clipBId: transition.clipBId
              ? (params.itemIdMap![transition.clipBId] ?? transition.clipBId)
              : undefined,
          })),
        };
        const position = params.position ?? sourceIndex + 1;
        timeline.tracks = [
          ...timeline.tracks.slice(0, position),
          duplicate,
          ...timeline.tracks.slice(position),
        ];
        restoreTrackOwnedItems(project, {
          textClips: ownedItems.textClips.map(duplicateItem),
          shapeClips: ownedItems.shapeClips.map(duplicateItem),
          svgClips: ownedItems.svgClips.map(duplicateItem),
          stickerClips: ownedItems.stickerClips.map(duplicateItem),
          adjustmentLayers: ownedItems.adjustmentLayers.map((layer) => ({
            ...duplicateItem(layer),
            affectedTracks:
              layer.affectedTracks === "all"
                ? "all"
                : layer.affectedTracks.map((affectedTrackId) =>
                    affectedTrackId === source.id ? trackId : affectedTrackId,
                  ),
          })),
          motionInstances: ownedItems.motionInstances.map(duplicateItem),
        });
        this.lastAddedIds.set("track", trackId);
        break;
      }

      case "track/remove": {
        const params = action.params as { trackId: string };
        timeline.tracks = timeline.tracks.filter(
          (t: MutableTrack) => t.id !== params.trackId,
        );
        removeTrackOwnedItems(project, params.trackId);
        break;
      }

      case "track/restore": {
        const params = action.params as {
          track: Track;
          position: number;
          items?: TrackOwnedItems;
        };
        timeline.tracks = [
          ...timeline.tracks.slice(0, params.position),
          params.track,
          ...timeline.tracks.slice(params.position),
        ];
        if (params.items) {
          restoreTrackOwnedItems(project, params.items);
        }
        break;
      }

      case "track/reorder": {
        const params = action.params as {
          trackId: string;
          newPosition: number;
        };
        const trackIndex = timeline.tracks.findIndex(
          (t: MutableTrack) => t.id === params.trackId,
        );
        if (trackIndex !== -1) {
          const [track] = timeline.tracks.splice(trackIndex, 1);
          timeline.tracks.splice(params.newPosition, 0, track);
        }
        break;
      }

      case "track/lock": {
        const params = action.params as { trackId: string; locked: boolean };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) =>
          t.id === params.trackId ? { ...t, locked: params.locked } : t,
        );
        break;
      }

      case "track/setSyncLock": {
        const params = action.params as { trackId: string; syncLock: boolean };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) =>
          t.id === params.trackId ? { ...t, syncLock: params.syncLock } : t,
        );
        break;
      }

      case "track/hide": {
        const params = action.params as { trackId: string; hidden: boolean };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) =>
          t.id === params.trackId ? { ...t, hidden: params.hidden } : t,
        );
        break;
      }

      case "track/rename": {
        const params = action.params as { trackId: string; name: string };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) =>
          t.id === params.trackId ? { ...t, name: params.name } : t,
        );
        break;
      }

      case "track/mute": {
        const params = action.params as { trackId: string; muted: boolean };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) =>
          t.id === params.trackId ? { ...t, muted: params.muted } : t,
        );
        break;
      }

      case "track/solo": {
        const params = action.params as { trackId: string; solo: boolean };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) =>
          t.id === params.trackId ? { ...t, solo: params.solo } : t,
        );
        break;
      }

      case "track/setSoloSafe": {
        const params = action.params as { trackId: string; soloSafe: boolean };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) => {
          if (t.id !== params.trackId) return t;
          const { soloSafe: _previous, ...rest } = t as MutableTrack & { soloSafe?: boolean };
          void _previous;
          return params.soloSafe ? { ...rest, soloSafe: true } : rest;
        });
        break;
      }
    }
  }

  private applyMarkerAction(
    action: MarkerAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "marker/add": {
        const params = action.params as {
          time: number;
          label: string;
          color: string;
          duration?: number;
          comment?: string;
          kind?: MarkerKind;
          author?: string;
          status?: ReviewStatus;
          replies?: ReviewReply[];
          createdAt?: number;
        };
        const newMarker: Marker = {
          id: this.genId("marker-"),
          time: params.time,
          label: params.label,
          color: params.color,
          ...(params.duration ? { duration: params.duration } : {}),
          ...(params.comment ? { comment: params.comment } : {}),
          ...(params.kind ? { kind: params.kind } : {}),
          ...(params.author ? { author: params.author } : {}),
          ...(params.status ? { status: params.status } : {}),
          ...(params.replies && params.replies.length > 0 ? { replies: params.replies.map((r) => ({ ...r })) } : {}),
          ...(params.createdAt ? { createdAt: params.createdAt } : {}),
        };
        timeline.markers = [...timeline.markers, newMarker];
        this.lastAddedIds.set("marker", newMarker.id);
        break;
      }

      case "marker/restore": {
        const params = action.params as { marker: Marker; position: number };
        const markers = [...timeline.markers];
        const position = Math.min(
          Math.max(params.position, 0),
          markers.length,
        );
        markers.splice(position, 0, { ...params.marker });
        timeline.markers = markers;
        break;
      }

      case "marker/remove": {
        const params = action.params as { markerId: string };
        timeline.markers = timeline.markers.filter(
          (m) => m.id !== params.markerId,
        );
        break;
      }

      case "marker/update": {
        const params = action.params as {
          markerId: string;
          updates: Partial<Marker>;
        };
        timeline.markers = timeline.markers.map((m) => {
          if (m.id !== params.markerId) return m;
          // An undefined update clears an optional field (the inverse of
          // adding one), so undo restores the exact marker.
          const next: Record<string, unknown> = { ...m };
          for (const [key, value] of Object.entries(params.updates)) {
            if (value === undefined) delete next[key];
            else next[key] = value;
          }
          return next as unknown as Marker;
        });
        break;
      }
    }
  }

  private applyClipAction(
    action: ClipAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "clip/add": {
        const params = action.params as {
          trackId: string;
          mediaId: string;
          startTime: number;
          duration?: number;
          inPoint?: number;
          outPoint?: number;
          volume?: number;
          effects?: unknown[];
          audioEffects?: unknown[];
          keyframes?: unknown[];
          transform?: Record<string, unknown>;
          fade?: Clip["fade"];
          speed?: number;
          reversed?: boolean;
          audioTrackIndex?: number;
          sourceClip?: Clip;
          clipId?: string;
        };
        const track = timeline.tracks.find(
          (t: MutableTrack) => t.id === params.trackId,
        );
        if (track) {
          const mediaItem = project.mediaLibrary.items.find(
            (item) => item.id === params.mediaId,
          );
          // Use provided duration, or fall back to media duration (if > 0), or default to 5
          // Images and graphics have duration: 0, so we use the 5-second default for them
          // A subclip places its own window, not the whole parent file.
          const subWindow = mediaItem ? subclipRange(mediaItem) : null;
          // "Interpret footage" conforms the frame rate: the file plays at interpreted/native speed, so a
          // default (whole-file) placement spans the conformed duration.
          const conformSpeed =
            mediaItem && params.speed === undefined && !params.sourceClip && !subWindow && params.duration === undefined
              ? interpretationSpeed(mediaItem)
              : 1;
          const sourceSpan = subWindow && params.inPoint === undefined && !params.sourceClip
            ? Math.min(params.duration ?? Infinity, subWindow.end - subWindow.start)
            : params.duration ??
            (mediaItem?.metadata.duration && mediaItem.metadata.duration > 0
              ? mediaItem.metadata.duration
              : 5);
          const clipDuration = conformSpeed !== 1 ? sourceSpan / conformSpeed : sourceSpan;
          const defaultTransform = {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            anchor: { x: 0.5, y: 0.5 },
            opacity: 1,
            fitMode: "contain" as const,
          };
          const newClip = params.sourceClip
            ? {
                ...structuredClone(params.sourceClip),
                id: params.clipId ?? this.genId(),
                trackId: params.trackId,
                startTime: params.startTime,
              }
            : {
                id: params.clipId ?? this.genId(),
                mediaId: params.mediaId,
                trackId: params.trackId,
                startTime: params.startTime,
                duration: clipDuration,
                inPoint: params.inPoint ?? subWindow?.start ?? 0,
                outPoint: params.outPoint ?? (subWindow ? subWindow.start + clipDuration : conformSpeed !== 1 ? sourceSpan : clipDuration),
                effects: (params.effects as never[]) ?? [],
                audioEffects: (params.audioEffects as never[]) ?? [],
                transform: params.transform
                  ? { ...defaultTransform, ...params.transform }
                  : defaultTransform,
                volume: params.volume ?? 1,
                keyframes: (params.keyframes as never[]) ?? [],
                ...(params.fade ? { fade: params.fade } : {}),
                ...(params.speed !== undefined ? { speed: params.speed } : conformSpeed !== 1 ? { speed: conformSpeed } : {}),
                ...(params.reversed !== undefined
                  ? { reversed: params.reversed }
                  : {}),
                ...(params.audioTrackIndex !== undefined
                  ? { audioTrackIndex: params.audioTrackIndex }
                  : {}),
              };
          params.clipId = newClip.id;
          track.clips = [...track.clips, newClip];
          this.lastAddedIds.set("clip", newClip.id);
        }
        break;
      }

      case "clip/remove": {
        const params = action.params as { clipId: string };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.filter((c: MutableClip) => c.id !== params.clipId),
        }));
        break;
      }

      case "clip/restore": {
        const params = action.params as { clip: Clip };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) =>
          track.id === params.clip.trackId
            ? { ...track, clips: [...track.clips, params.clip] }
            : track,
        );
        break;
      }

      case "clip/move": {
        const params = action.params as {
          clipId: string;
          startTime: number;
          trackId?: string;
        };
        const clip = this.findClip(timeline, params.clipId);
        if (clip) {
          const targetTrackId = params.trackId || clip.trackId;
          // Only the source and target tracks are rebuilt: every other track keeps its
          // identity, so memoised timeline lanes/clips do not see a change they don't have.
          timeline.tracks = timeline.tracks.map((track: MutableTrack) => {
            const holdsClip = track.clips.some((c: MutableClip) => c.id === params.clipId);
            if (!holdsClip && track.id !== targetTrackId) return track;
            const remaining = holdsClip
              ? track.clips.filter((c: MutableClip) => c.id !== params.clipId)
              : track.clips;
            return {
              ...track,
              clips:
                track.id === targetTrackId
                  ? [
                      ...remaining,
                      {
                        ...clip,
                        startTime: params.startTime,
                        trackId: targetTrackId,
                      },
                    ]
                  : remaining,
            };
          });
        }
        break;
      }

      case "clip/trim": {
        const params = action.params as {
          clipId: string;
          inPoint?: number;
          outPoint?: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id === params.clipId) {
              const inPoint = params.inPoint ?? clip.inPoint;
              const outPoint = params.outPoint ?? clip.outPoint;
              return {
                ...clip,
                inPoint,
                outPoint,
                duration: outPoint - inPoint,
              };
            }
            return clip;
          }),
        }));
        break;
      }

      case "clip/split": {
        const params = action.params as { clipId: string; time: number; rightClipId?: string; splitEdits?: TimelineToolItemEdit[] };
        const plan = params.splitEdits
          ? { edits: params.splitEdits, rightClipId: params.rightClipId! }
          : prepareClipSplit(project, params.clipId, params.time, "id" in action ? String(action.id) : this.genId());
        validateTimelineToolEdits(project, plan.edits);
        Object.assign(project, applyTimelineToolEdits(project, plan.edits));
        this.lastAddedIds.set("clip", plan.rightClipId);
        break;
      }

      case "clip/merge": {
        const params = action.params as { clipId: string; originalClip: Clip };
        const origStart = params.originalClip.startTime;
        const origEnd = origStart + params.originalClip.duration;
        const origMediaId = params.originalClip.mediaId;
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => {
          if (track.id === params.originalClip.trackId) {
            const filteredClips = track.clips.filter((c: MutableClip) => {
              if (c.id === params.clipId) return false;
              if (c.mediaId === origMediaId) {
                const clipEnd = c.startTime + c.duration;
                if (c.startTime >= origStart && clipEnd <= origEnd) {
                  return false;
                }
              }
              return true;
            });
            return { ...track, clips: [...filteredClips, params.originalClip] };
          }
          return track;
        });
        break;
      }

      case "clip/rippleDelete": {
        const params = action.params as { clipId: string };
        const clip = this.findClip(timeline, params.clipId);
        if (clip) {
          const deletedDuration = clip.duration;
          const deletedStartTime = clip.startTime;

          timeline.tracks = timeline.tracks.map((track: MutableTrack) => {
            if (track.id === clip.trackId) {
              return {
                ...track,
                clips: track.clips
                  .filter((c: MutableClip) => c.id !== params.clipId)
                  .map((c: MutableClip) =>
                    c.startTime > deletedStartTime
                      ? { ...c, startTime: c.startTime - deletedDuration }
                      : c,
                  ),
              };
            }
            return track;
          });
        }
        break;
      }

      case "clip/setBlendMode": {
        const params = action.params as {
          clipId: string;
          blendMode: BlendMode;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? { ...clip, blendMode: params.blendMode }
              : clip,
          ),
        }));
        break;
      }

      case "clip/setBlendOpacity": {
        const params = action.params as { clipId: string; opacity: number };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? { ...clip, blendOpacity: params.opacity }
              : clip,
          ),
        }));
        break;
      }

      case "clip/setEmphasisAnimation": {
        const params = action.params as {
          clipId: string;
          emphasisAnimation: EmphasisAnimation;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? { ...clip, emphasisAnimation: params.emphasisAnimation }
              : clip,
          ),
        }));
        break;
      }

      case "clip/setColorGrading": {
        const params = action.params as {
          clipId: string;
          colorGrading?: ClipColorGrading;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? { ...clip, colorGrading: params.colorGrading }
              : clip,
          ),
        }));
        break;
      }

      case "clip/rippleRestore": {
        const params = action.params as {
          clip: Clip;
          affectedClips: Array<{ id: string; originalStartTime: number }>;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => {
          if (track.id === params.clip.trackId) {
            const restoredClips = track.clips.map((c: MutableClip) => {
              const affected = params.affectedClips.find(
                (ac) => ac.id === c.id,
              );
              return affected
                ? { ...c, startTime: affected.originalStartTime }
                : c;
            });
            return { ...track, clips: [...restoredClips, params.clip] };
          }
          return track;
        });
        break;
      }

      case "clip/slip": {
        const params = action.params as {
          clipId: string;
          delta: number;
        };
        const clip = this.findClip(timeline, params.clipId);
        if (clip) {
          const newInPoint = Math.max(0, clip.inPoint + params.delta);
          const newOutPoint = newInPoint + clip.duration;
          timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
            ...track,
            clips: track.clips.map((c: MutableClip) =>
              c.id === params.clipId
                ? { ...c, inPoint: newInPoint, outPoint: newOutPoint }
                : c,
            ),
          }));
        }
        break;
      }

      case "clip/slide": {
        const params = action.params as {
          clipId: string;
          delta: number;
          prevClipId?: string;
          nextClipId?: string;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((c: MutableClip) => {
            if (c.id === params.clipId) {
              return {
                ...c,
                startTime: Math.max(0, c.startTime + params.delta),
              };
            }
            if (c.id === params.prevClipId && params.delta > 0) {
              return { ...c, duration: c.duration + params.delta };
            }
            if (c.id === params.nextClipId && params.delta < 0) {
              return {
                ...c,
                startTime: c.startTime + params.delta,
                inPoint: c.inPoint - params.delta,
                duration: c.duration - params.delta,
              };
            }
            return c;
          }),
        }));
        break;
      }

      case "clip/roll": {
        const params = action.params as {
          leftClipId: string;
          rightClipId: string;
          delta: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((c: MutableClip) => {
            if (c.id === params.leftClipId) {
              return {
                ...c,
                duration: c.duration + params.delta,
                outPoint: c.outPoint + params.delta,
              };
            }
            if (c.id === params.rightClipId) {
              return {
                ...c,
                startTime: c.startTime + params.delta,
                inPoint: c.inPoint + params.delta,
                duration: c.duration - params.delta,
              };
            }
            return c;
          }),
        }));
        break;
      }

      case "clip/trimToPlayhead": {
        const params = action.params as {
          clipId: string;
          playheadTime: number;
          trimStart: boolean;
        };
        const clip = this.findClip(timeline, params.clipId);
        if (clip) {
          timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
            ...track,
            clips: track.clips.map((c: MutableClip) => {
              if (c.id !== params.clipId) return c;
              if (params.trimStart) {
                const delta = params.playheadTime - c.startTime;
                return {
                  ...c,
                  startTime: params.playheadTime,
                  inPoint: c.inPoint + delta,
                  duration: c.duration - delta,
                };
              } else {
                return {
                  ...c,
                  duration: params.playheadTime - c.startTime,
                  outPoint: c.inPoint + (params.playheadTime - c.startTime),
                };
              }
            }),
          }));
        }
        break;
      }

      case "clip/closeGapBefore": {
        // Close the gap before the target clip by sliding it (and every
        // later clip on the same track) left until it butts up against
        // the preceding clip (or the start of the timeline).
        const params = action.params as { clipId: string };
        const clip = this.findClip(timeline, params.clipId);
        if (clip) {
          const track = timeline.tracks.find((t) => t.id === clip.trackId);
          if (track) {
            const sorted = [...track.clips].sort(
              (a, b) => a.startTime - b.startTime,
            );
            const idx = sorted.findIndex((c) => c.id === clip.id);
            if (idx >= 0) {
              const prev = idx > 0 ? sorted[idx - 1] : null;
              const target = prev ? prev.startTime + prev.duration : 0;
              const gap = clip.startTime - target;
              if (gap > 0) {
                const shiftIds = new Set(
                  sorted.slice(idx).map((c) => c.id),
                );
                timeline.tracks = timeline.tracks.map((t: MutableTrack) => {
                  if (t.id !== track.id) return t;
                  return {
                    ...t,
                    clips: t.clips.map((c: MutableClip) =>
                      shiftIds.has(c.id)
                        ? { ...c, startTime: c.startTime - gap }
                        : c,
                    ),
                  };
                });
              }
            }
          }
        }
        break;
      }

      case "track/consolidate": {
        // Walk the track left-to-right and shift each clip backward so
        // there is no empty space between consecutive clips. Already
        // packed tracks are left alone.
        const params = action.params as { trackId: string };
        timeline.tracks = timeline.tracks.map((t: MutableTrack) => {
          if (t.id !== params.trackId) return t;
          const sorted = [...t.clips].sort(
            (a, b) => a.startTime - b.startTime,
          );
          let cursor = 0;
          const newPositions = new Map<string, number>();
          for (const c of sorted) {
            const newStart = Math.max(0, cursor);
            newPositions.set(c.id, newStart);
            cursor = newStart + c.duration;
          }
          return {
            ...t,
            clips: t.clips.map((c: MutableClip) => {
              const ns = newPositions.get(c.id);
              return ns !== undefined && ns !== c.startTime
                ? { ...c, startTime: ns }
                : c;
            }),
          };
        });
        break;
      }

      case "track/restorePositions": {
        // Inverse of track/consolidate — restore the captured per-clip
        // start times.
        const params = action.params as {
          trackId: string;
          positions: Array<{ clipId: string; startTime: number }>;
        };
        const lookup = new Map(
          params.positions.map((p) => [p.clipId, p.startTime] as const),
        );
        timeline.tracks = timeline.tracks.map((t: MutableTrack) => {
          if (t.id !== params.trackId) return t;
          return {
            ...t,
            clips: t.clips.map((c: MutableClip) => {
              const ns = lookup.get(c.id);
              return ns !== undefined && ns !== c.startTime
                ? { ...c, startTime: ns }
                : c;
            }),
          };
        });
        break;
      }
    }

    // A compound instance has a normal timeline clip as its editable shell.
    // Keep the persisted instance timing in lockstep so inspector state,
    // autosave and export never observe stale coordinates after an edit/undo.
    if (
      action.type === "clip/move" ||
      action.type === "clip/trim" ||
      action.type === "clip/slip" ||
      action.type === "clip/trimToPlayhead"
    ) {
      const clipId = (action.params as { clipId?: string }).clipId;
      const updatedClip = clipId ? this.findClip(timeline, clipId) : null;
      if (updatedClip && project.nestedInstances?.some((item) => item.id === clipId)) {
        (project as Project & { nestedInstances: typeof project.nestedInstances }).nestedInstances = project.nestedInstances.map(
          (item) =>
            item.id === clipId
              ? {
                  ...item,
                  trackId: updatedClip.trackId,
                  startTime: updatedClip.startTime,
                  duration: updatedClip.duration,
                  inPoint: updatedClip.inPoint,
                  outPoint: updatedClip.outPoint,
                  transform: updatedClip.transform,
                  volume: updatedClip.volume,
                }
              : item,
        );
      }
    }
  }

  private applyEffectAction(
    action: EffectAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "effect/add": {
        const params = action.params as {
          clipId: string;
          effectType: string;
          params?: Record<string, unknown>;
          effectId?: string;
          index?: number;
          enabled?: boolean;
          metadata?: Effect["metadata"];
        };
        const newEffect = {
          id: params.effectId ?? this.genId("effect-"),
          type: params.effectType,
          params: params.params || {},
          enabled: params.enabled ?? true,
          ...(params.metadata ? { metadata: params.metadata } : {}),
        };

        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? (() => {
                  const effects = [...clip.effects];
                  const index = Number.isInteger(params.index)
                    ? Math.max(0, Math.min(effects.length, params.index!))
                    : effects.length;
                  effects.splice(index, 0, newEffect);
                  return { ...clip, effects };
                })()
              : clip,
          ),
        }));
        this.lastAddedIds.set("effect", newEffect.id);
        break;
      }

      case "effect/remove": {
        const params = action.params as { clipId: string; effectId: string };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  effects: clip.effects.filter(
                    (e: Effect) => e.id !== params.effectId,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }

      case "effect/restore": {
        const params = action.params as {
          clipId: string;
          effect: Effect;
          index: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id === params.clipId) {
              const effects = [...clip.effects];
              effects.splice(params.index, 0, params.effect);
              return { ...clip, effects };
            }
            return clip;
          }),
        }));
        break;
      }

      case "effect/update": {
        const params = action.params as {
          clipId: string;
          effectId: string;
          params: Record<string, unknown>;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  effects: clip.effects.map((e: Effect) =>
                    e.id === params.effectId
                      ? { ...e, params: { ...e.params, ...params.params } }
                      : e,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }

      case "effect/toggle": {
        const params = action.params as {
          clipId: string;
          effectId: string;
          enabled: boolean;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  effects: clip.effects.map((e: Effect) =>
                    e.id === params.effectId
                      ? { ...e, enabled: params.enabled }
                      : e,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }

      case "effect/reorder": {
        const params = action.params as {
          clipId: string;
          effectId: string;
          newIndex: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id === params.clipId) {
              const effects = [...clip.effects];
              const effectIndex = effects.findIndex(
                (e: Effect) => e.id === params.effectId,
              );
              if (effectIndex !== -1) {
                const [effect] = effects.splice(effectIndex, 1);
                effects.splice(params.newIndex, 0, effect);
              }
              return { ...clip, effects };
            }
            return clip;
          }),
        }));
        break;
      }
    }
  }

  private applyTransformAction(
    action: TransformAction,
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
      ...track,
      clips: track.clips.map((clip: MutableClip) => {
        if (clip.id !== action.params.clipId) return clip;
        const prev = clip.transform;
        const next = action.params.transform;
        // Deep-merge nested objects so a partial-axis update (e.g.
        // { position: { x } }) does not drop the other axis, matching the
        // store's own deep-merge behavior.
        return {
          ...clip,
          // History restores the whole previous transform, including the
          // absence of optional properties such as rotate3d and perspective.
          transform: action.params.replace ? { ...action.params.transform } : {
            ...prev,
            ...next,
            position: { ...prev.position, ...(next.position ?? {}) },
            scale: { ...prev.scale, ...(next.scale ?? {}) },
            anchor: { ...prev.anchor, ...(next.anchor ?? {}) },
          },
        };
      }),
    }));
  }

  private applyKeyframeAction(
    action: KeyframeAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "keyframe/add": {
        const params = action.params as {
          clipId: string;
          time: number;
          property: string;
          value: unknown;
          easing?: EasingType;
        };
        const newKeyframe = {
          // Derive the id from the action so rapid sequential agent calls and
          // redo cannot collide within the same millisecond.
          id: `keyframe-${(action as Action).id}`,
          time: params.time,
          property: params.property,
          value: params.value,
          easing: params.easing ?? ("linear" as const),
        };

        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? { ...clip, keyframes: [...clip.keyframes, newKeyframe] }
              : clip,
          ),
        }));
        this.lastAddedIds.set("keyframe", newKeyframe.id);
        break;
      }

      case "keyframe/remove": {
        const params = action.params as {
          clipId: string;
          property: string;
          time: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  keyframes: clip.keyframes.filter(
                    (kf: Keyframe) =>
                      !(
                        kf.property === params.property &&
                        kf.time === params.time
                      ),
                  ),
                }
              : clip,
          ),
        }));
        break;
      }

      case "keyframe/update": {
        const params = action.params as {
          clipId: string;
          property: string;
          time: number;
          value?: unknown;
          easing?: EasingType;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  keyframes: clip.keyframes.map((kf: Keyframe) =>
                    kf.property === params.property && kf.time === params.time
                      ? {
                          ...kf,
                          ...(params.value !== undefined && {
                            value: params.value,
                          }),
                          ...(params.easing !== undefined && {
                            easing: params.easing,
                          }),
                        }
                      : kf,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }
    }
  }

  private applyTransitionAction(
    action:
      | TransitionAction
      | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "transition/add": {
        const params = action.params as {
          clipAId: string;
          clipBId: string;
          transitionType: TransitionType;
          duration: number;
        };
        const clipA = this.findClip(timeline, params.clipAId);
        if (clipA) {
          const track = timeline.tracks.find(
            (t: MutableTrack) => t.id === clipA.trackId,
          );
          if (track) {
            const newTransition: Transition = {
              id: this.genId("transition-"),
              clipAId: params.clipAId,
              clipBId: params.clipBId,
              type: params.transitionType,
              duration: params.duration,
              params: {},
            };
            track.transitions = [...(track.transitions || []), newTransition];
            this.lastAddedIds.set("transition", newTransition.id);
          }
        }
        break;
      }

      case "transition/set": {
        const params = action.params as { transition: Transition };
        const clipA = this.findClip(timeline, params.transition.clipAId);
        if (clipA) {
          timeline.tracks = timeline.tracks.map((track: MutableTrack) =>
            track.id === clipA.trackId
              ? {
                  ...track,
                  transitions: [
                    ...(track.transitions || []).filter(
                      (t: Transition) =>
                        !this.isSameTransitionPlacement(t, params.transition),
                    ),
                    params.transition,
                  ],
                }
              : track,
          );
        }
        break;
      }

      case "transition/restoreTrack": {
        const params = action.params as {
          trackId: string;
          transitions: Transition[];
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) =>
          track.id === params.trackId
            ? { ...track, transitions: params.transitions }
            : track,
        );
        break;
      }

      case "transition/remove": {
        const params = action.params as { transitionId: string };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          transitions: (track.transitions || []).filter(
            (t: Transition) => t.id !== params.transitionId,
          ),
        }));
        break;
      }

      case "transition/restore": {
        const params = action.params as { transition: Transition };
        const clipA = this.findClip(timeline, params.transition.clipAId);
        if (clipA) {
          timeline.tracks = timeline.tracks.map((track: MutableTrack) =>
            track.id === clipA.trackId
              ? {
                  ...track,
                  transitions: (track.transitions || []).some(t => t.id === params.transition.id)
                    ? (track.transitions || []).map(t => t.id === params.transition.id ? params.transition : t)
                    : [...(track.transitions || []), params.transition],
                }
              : track,
          );
        }
        break;
      }

      case "transition/update": {
        const params = action.params as {
          transitionId: string;
          type?: TransitionType;
          duration?: number;
          params?: Record<string, unknown>;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          transitions: (track.transitions || []).map((t: Transition) =>
            t.id === params.transitionId
              ? {
                  ...t,
                  ...(params.type !== undefined && { type: params.type }),
                  ...(params.duration !== undefined && {
                    duration: params.duration,
                  }),
                  ...(params.params !== undefined && {
                    params: { ...t.params, ...params.params },
                  }),
                }
              : t,
          ),
        }));
        break;
      }
    }
  }

  private applyAudioAction(
    action: AudioAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "audio/setVolume": {
        const params = action.params as { clipId: string; volume: number };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? { ...clip, volume: params.volume }
              : clip,
          ),
        }));
        break;
      }

      case "audio/setFade": {
        const params = action.params as {
          clipId: string;
          fadeIn?: number;
          fadeOut?: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id !== params.clipId) return clip;
            const fade = {
              ...clip.fade,
              fadeIn: params.fadeIn ?? clip.fade?.fadeIn ?? 0,
              fadeOut: params.fadeOut ?? clip.fade?.fadeOut ?? 0,
            };
            if (fade.origin) {
              fade.origin = { ...fade.origin,
                ...(params.fadeIn !== undefined ? { fadeIn: false } : {}),
                ...(params.fadeOut !== undefined ? { fadeOut: false } : {}),
              };
              if (fade.origin.fadeIn === false && fade.origin.fadeOut === false)
                delete fade.origin;
            }
            return { ...clip, fade };
          }),
        }));
        break;
      }

      case "audio/restoreFade": {
        const params = action.params as { clipId: string; fade: Clip["fade"] | null };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id !== params.clipId) return clip;
            const { fade: _previous, ...rest } = clip;
            return params.fade ? { ...rest, fade: structuredClone(params.fade) } : rest;
          }),
        }));
        break;
      }

      case "audio/addAutomation": {
        const params = action.params as {
          clipId: string;
          points: Array<{ time: number; value: number }> | null;
          /** Legacy form of `points: null` (drop the lane). */
          clear?: boolean;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id !== params.clipId) return clip;
            const { volume: _previous, ...otherLanes } = clip.automation ?? {};
            // `null` is how undo restores a clip that had no lane at all.
            if (params.points === null || params.clear) {
              const { automation: _drop, ...rest } = clip;
              return Object.keys(otherLanes).length
                ? { ...rest, automation: otherLanes }
                : rest;
            }
            return {
              ...clip,
              automation: {
                ...otherLanes,
                volume: params.points.map((point) => ({
                  time: point.time,
                  value: point.value,
                })),
              },
            };
          }),
        }));
        break;
      }

      case "audio/setLiveDucking": {
        const params = action.params as { clipId: string; config: LiveDuckingConfig | null };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id !== params.clipId) return clip;
            const { liveDucking: _previous, ...otherMetadata } = clip.metadata ?? {};
            const metadata = params.config
              ? { ...otherMetadata, liveDucking: normalizeLiveDucking(params.config) }
              : otherMetadata;
            if (Object.keys(metadata).length > 0) return { ...clip, metadata };
            const { metadata: _metadata, ...bare } = clip;
            return bare;
          }),
        }));
        break;
      }

      case "audio/setEssentialSound": {
        const params = action.params as {
          clipId: string;
          audioType: AudioType | null;
          state: EssentialSoundState | null;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id !== params.clipId) return clip;
            const { audioType: _type, ...withoutType } = clip;
            const { essentialSound: _state, ...otherMetadata } = clip.metadata ?? {};
            const metadata = params.state
              ? { ...otherMetadata, essentialSound: structuredClone(params.state) }
              : otherMetadata;
            const next: MutableClip = params.audioType
              ? { ...withoutType, audioType: params.audioType }
              : withoutType;
            if (Object.keys(metadata).length > 0) return { ...next, metadata };
            const { metadata: _metadata, ...bare } = next;
            return bare;
          }),
        }));
        break;
      }

      case "audio/addEffect": {
        const params = action.params as { clipId: string; effect: Effect };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  audioEffects: [...(clip.audioEffects ?? []), params.effect],
                }
              : clip,
          ),
        }));
        break;
      }

      case "audio/restoreEffect": {
        const params = action.params as {
          clipId: string;
          effect: Effect;
          index: number;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => {
            if (clip.id !== params.clipId) return clip;
            const audioEffects = [...(clip.audioEffects ?? [])];
            audioEffects.splice(params.index, 0, params.effect);
            return { ...clip, audioEffects };
          }),
        }));
        break;
      }

      case "audio/removeEffect": {
        const params = action.params as { clipId: string; effectId: string };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  audioEffects: (clip.audioEffects ?? []).filter(
                    (e: Effect) => e.id !== params.effectId,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }

      case "audio/replaceEffect": {
        const params = action.params as { clipId: string; effectId: string; effect: Effect };
        const effect = structuredClone(params.effect);
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) => clip.id === params.clipId
            ? { ...clip, audioEffects: (clip.audioEffects ?? []).map((item: Effect) => item.id === params.effectId ? effect : item) }
            : clip),
        }));
        break;
      }

      case "audio/updateEffect": {
        const params = action.params as {
          clipId: string;
          effectId: string;
          params: Record<string, unknown>;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  audioEffects: (clip.audioEffects ?? []).map((e: Effect) =>
                    e.id === params.effectId
                      ? { ...e, params: { ...e.params, ...params.params } }
                      : e,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }

      case "audio/toggleEffect": {
        const params = action.params as {
          clipId: string;
          effectId: string;
          enabled: boolean;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  audioEffects: (clip.audioEffects ?? []).map((e: Effect) =>
                    e.id === params.effectId
                      ? { ...e, enabled: params.enabled }
                      : e,
                  ),
                }
              : clip,
          ),
        }));
        break;
      }
    }
  }

  private applySubtitleAction(
    action: SubtitleAction | { type: string; params: Record<string, unknown> },
    project: Project,
  ): void {
    const timeline = project.timeline as MutableTimeline;

    switch (action.type) {
      case "subtitle/add": {
        const params = action.params as {
          text: string;
          startTime: number;
          endTime: number;
        };
        const newSubtitle = {
          id: this.genId("subtitle-"),
          text: params.text,
          startTime: params.startTime,
          endTime: params.endTime,
        };
        timeline.subtitles = [...(timeline.subtitles || []), newSubtitle];
        this.lastAddedIds.set("subtitle", newSubtitle.id);
        break;
      }

      case "subtitle/remove": {
        const params = action.params as { subtitleId: string };
        timeline.subtitles = (timeline.subtitles || []).filter(
          (s: Subtitle) => s.id !== params.subtitleId,
        );
        break;
      }

      case "subtitle/restore": {
        const params = action.params as { subtitle: Subtitle };
        timeline.subtitles = [...(timeline.subtitles || []), params.subtitle];
        break;
      }

      case "subtitle/restoreAll": {
        const params = action.params as { subtitles: Subtitle[] };
        timeline.subtitles = params.subtitles;
        break;
      }

      case "subtitle/update": {
        const params = action.params as {
          subtitleId: string;
          text?: string;
          startTime?: number;
          endTime?: number;
        };
        timeline.subtitles = (timeline.subtitles || []).map((s: Subtitle) =>
          s.id === params.subtitleId
            ? {
                ...s,
                ...(params.text !== undefined && { text: params.text }),
                ...(params.startTime !== undefined && {
                  startTime: params.startTime,
                }),
                ...(params.endTime !== undefined && {
                  endTime: params.endTime,
                }),
              }
            : s,
        );
        break;
      }

      case "subtitle/setStyle": {
        const params = action.params as { style: SubtitleStyle };
        timeline.subtitles = (timeline.subtitles || []).map((s: Subtitle) => ({
          ...s,
          style: params.style,
        }));
        break;
      }

      case "subtitle/import": {
        const params = action.params as { srtContent: string };
        const srtRegex =
          /(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n([\s\S]*?)(?=\n\n|\n*$)/g;
        let match;
        const newSubtitles = [];

        while ((match = srtRegex.exec(params.srtContent)) !== null) {
          const startTime = this.parseSrtTime(match[2]);
          const endTime = this.parseSrtTime(match[3]);
          const text = match[4].trim();

          newSubtitles.push({
            id: this.genId("subtitle-"),
            text,
            startTime,
            endTime,
          });
        }

        if (newSubtitles.length > 0) {
          timeline.subtitles = [...(timeline.subtitles || []), ...newSubtitles];
        }
        break;
      }
    }
  }

  private parseSrtTime(timeString: string): number {
    const [time, ms] = timeString.split(",");
    const [hours, minutes, seconds] = time.split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds + Number(ms) / 1000;
  }

  private findClip(
    timeline: MutableTimeline,
    clipId: string,
  ): MutableClip | null {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((c: MutableClip) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }
}
