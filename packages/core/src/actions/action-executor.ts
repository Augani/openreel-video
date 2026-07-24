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
} from "../types";
import type {
  MutableTimeline,
  MutableTrack,
  MutableClip,
} from "../utils/immutable-updates";
import type { BlendMode } from "../video/types";
import type { EmphasisAnimation } from "../graphics/types";
import type { ClipColorGrading } from "../video/color-grading-engine";
import {
  registerMotionShader,
  unregisterMotionShader,
  isBuiltinMotionShaderId,
} from "../motion/shaders/registry";
import type { MotionShaderDef } from "../motion/shaders/types";
import { ActionValidator } from "./action-validator";
import { ActionHistory } from "./action-history";
import { InverseActionGenerator } from "./inverse-action-generator";
import { getActionHandler } from "./registry";
import "./handlers";
import { calculateProjectDuration } from "../timeline/project-duration";

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
    const projectSnapshot = JSON.parse(JSON.stringify(project));
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
      this.history.push(action, resolvedInverseAction);

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

    try {
      for (const inverseAction of inverseActions) {
        const resolvedAction = this.resolveSpecialMarkers(inverseAction);
        await this.applyAction(resolvedAction as TimelineAction, project);
      }
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

  private async applyAction(
    action: TimelineAction,
    project: Project,
  ): Promise<void> {
    const type = action.type;

    const handler = getActionHandler(type);
    if (handler) {
      await handler.apply(action as Action, project, {
        lastAddedIds: this.lastAddedIds,
      });
      this.recalculateTimelineDuration(project);
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

    // Recompute timeline duration from clips after any action that may affect it
    this.recalculateTimelineDuration(project);
  }

  private recalculateTimelineDuration(project: Project): void {
    (project.timeline as MutableTimeline).duration =
      calculateProjectDuration(project);
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
          id: `media-${Date.now()}`,
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
        };
        const trackNames: Record<string, string> = {
          video: "Video",
          audio: "Audio",
          image: "Image",
          text: "Text",
          graphics: "Graphics",
        };
        const trackCount =
          timeline.tracks.filter(
            (t: MutableTrack) => t.type === params.trackType,
          ).length + 1;
        const newTrack: MutableTrack = {
          id: params.trackId ?? `track-${crypto.randomUUID()}`,
          type: params.trackType as Track["type"],
          name: `${trackNames[params.trackType] || params.trackType} ${trackCount}`,
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
        };
        const sourceIndex = timeline.tracks.findIndex(
          (track: MutableTrack) => track.id === params.sourceTrackId,
        );
        if (sourceIndex < 0) break;
        const source = timeline.tracks[sourceIndex];
        const trackId = params.trackId ?? `track-${crypto.randomUUID()}`;
        const clipIdMap = new Map(
          source.clips.map((clip) => [
            clip.id,
            `clip-${crypto.randomUUID()}`,
          ]),
        );
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
            id: clipIdMap.get(clip.id)!,
            trackId,
          })),
          transitions: source.transitions.map((transition) => ({
            ...structuredClone(transition),
            id: `transition-${crypto.randomUUID()}`,
            clipAId:
              clipIdMap.get(transition.clipAId) ?? transition.clipAId,
            clipBId: transition.clipBId
              ? (clipIdMap.get(transition.clipBId) ?? transition.clipBId)
              : undefined,
          })),
        };
        const position = params.position ?? sourceIndex + 1;
        timeline.tracks = [
          ...timeline.tracks.slice(0, position),
          duplicate,
          ...timeline.tracks.slice(position),
        ];
        this.lastAddedIds.set("track", trackId);
        break;
      }

      case "track/remove": {
        const params = action.params as { trackId: string };
        timeline.tracks = timeline.tracks.filter(
          (t: MutableTrack) => t.id !== params.trackId,
        );
        break;
      }

      case "track/restore": {
        const params = action.params as { track: Track; position: number };
        timeline.tracks = [
          ...timeline.tracks.slice(0, params.position),
          params.track,
          ...timeline.tracks.slice(params.position),
        ];
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
        };
        const newMarker: Marker = {
          id: `marker-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          time: params.time,
          label: params.label,
          color: params.color,
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
        timeline.markers = timeline.markers.map((m) =>
          m.id === params.markerId ? { ...m, ...params.updates } : m,
        );
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
          fade?: { fadeIn: number; fadeOut: number };
          speed?: number;
          reversed?: boolean;
          audioTrackIndex?: number;
          sourceClip?: Clip;
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
          const clipDuration =
            params.duration ??
            (mediaItem?.metadata.duration && mediaItem.metadata.duration > 0
              ? mediaItem.metadata.duration
              : 5);
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
                id: crypto.randomUUID(),
                trackId: params.trackId,
                startTime: params.startTime,
              }
            : {
                id: crypto.randomUUID(),
                mediaId: params.mediaId,
                trackId: params.trackId,
                startTime: params.startTime,
                duration: clipDuration,
                inPoint: params.inPoint ?? 0,
                outPoint: params.outPoint ?? clipDuration,
                effects: (params.effects as never[]) ?? [],
                audioEffects: (params.audioEffects as never[]) ?? [],
                transform: params.transform
                  ? { ...defaultTransform, ...params.transform }
                  : defaultTransform,
                volume: params.volume ?? 1,
                keyframes: (params.keyframes as never[]) ?? [],
                ...(params.fade ? { fade: params.fade } : {}),
                ...(params.speed !== undefined ? { speed: params.speed } : {}),
                ...(params.reversed !== undefined
                  ? { reversed: params.reversed }
                  : {}),
                ...(params.audioTrackIndex !== undefined
                  ? { audioTrackIndex: params.audioTrackIndex }
                  : {}),
              };
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
          timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
            ...track,
            clips: track.clips.filter(
              (c: MutableClip) => c.id !== params.clipId,
            ),
          }));
          const targetTrackId = params.trackId || clip.trackId;
          timeline.tracks = timeline.tracks.map((track: MutableTrack) =>
            track.id === targetTrackId
              ? {
                  ...track,
                  clips: [
                    ...track.clips,
                    {
                      ...clip,
                      startTime: params.startTime,
                      trackId: targetTrackId,
                    },
                  ],
                }
              : track,
          );
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
              const updates: Partial<MutableClip> = {};
              if (params.inPoint !== undefined) {
                updates.inPoint = params.inPoint;
                updates.duration = clip.outPoint - params.inPoint;
              }
              if (params.outPoint !== undefined) {
                updates.outPoint = params.outPoint;
                updates.duration = params.outPoint - clip.inPoint;
              }
              return { ...clip, ...updates };
            }
            return clip;
          }),
        }));
        break;
      }

      case "clip/split": {
        const params = action.params as { clipId: string; time: number };
        const clip = this.findClip(timeline, params.clipId);
        if (clip) {
          const splitTime = params.time;
          const splitOffset = splitTime - clip.startTime;

          const clip1 = {
            ...clip,
            duration: splitOffset,
            outPoint: clip.inPoint + splitOffset,
          };

          const clip2 = {
            ...clip,
            id: crypto.randomUUID(),
            startTime: splitTime,
            duration: clip.duration - splitOffset,
            inPoint: clip.inPoint + splitOffset,
          };

          timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
            ...track,
            clips: track.clips.flatMap((c: MutableClip) =>
              c.id === params.clipId ? [clip1, clip2] : [c],
            ),
          }));

          this.lastAddedIds.set("clip", clip2.id);
        }
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
        };
        const newEffect = {
          id: params.effectId ?? `effect-${Date.now()}`,
          type: params.effectType,
          params: params.params || {},
          enabled: params.enabled ?? true,
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
          transform: {
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
        };
        const newKeyframe = {
          id: `keyframe-${Date.now()}`,
          time: params.time,
          property: params.property,
          value: params.value,
          easing: "linear" as const,
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
              id: `transition-${Date.now()}`,
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
                  transitions: [
                    ...(track.transitions || []),
                    params.transition,
                  ],
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
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  fade: {
                    fadeIn:
                      params.fadeIn !== undefined
                        ? params.fadeIn
                        : clip.fade?.fadeIn || 0,
                    fadeOut:
                      params.fadeOut !== undefined
                        ? params.fadeOut
                        : clip.fade?.fadeOut || 0,
                  },
                }
              : clip,
          ),
        }));
        break;
      }

      case "audio/addAutomation": {
        const params = action.params as {
          clipId: string;
          points: Array<{ time: number; value: number }>;
        };
        timeline.tracks = timeline.tracks.map((track: MutableTrack) => ({
          ...track,
          clips: track.clips.map((clip: MutableClip) =>
            clip.id === params.clipId
              ? {
                  ...clip,
                  automation: {
                    ...clip.automation,
                    volume: params.points,
                  },
                }
              : clip,
          ),
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
          id: `subtitle-${Date.now()}`,
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
            id: `subtitle-${Date.now()}-${match[1]}`,
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
