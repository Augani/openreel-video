import { mediaTrimBounds } from "../media/bins";
import { validateOcioSettings } from "../color/ocio/settings";
import type {
  Action,
  ValidationResult,
  ValidationError,
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
import type { Project, Timeline, Track, Clip } from "../types";
import { AUDIO_TYPES, EASING_TYPES, MARKER_KINDS, REVIEW_STATUSES } from "../types/timeline";
import { TRANSITION_TYPES } from "../types/effects";
import { validateTransitionParams } from "../video/transition-defaults";
import { getActionHandler } from "./registry";
import { validateVrProperties } from "../vr/vr-properties";

export class ActionValidator {
  validate(action: Action, project: Project): ValidationResult {
    const errors: ValidationError[] = [];
    if (!action.type || typeof action.type !== "string") {
      errors.push({
        code: "INVALID_TYPE",
        message: "Action type is required and must be a string",
      });
      return { valid: false, errors };
    }

    if (!action.params || typeof action.params !== "object") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Action params are required and must be an object",
      });
      return { valid: false, errors };
    }

    const handler = getActionHandler(action.type);
    if (handler) {
      return handler.validate(action, project);
    }

    const typeValidationErrors = this.validateActionType(
      action as TimelineAction,
      project,
    );
    errors.push(...typeValidationErrors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateActionType(
    action: TimelineAction,
    project: Project,
  ): ValidationError[] {
    const type = action.type;

    if (type.startsWith("project/")) {
      return this.validateProjectAction(action as ProjectAction, project);
    } else if (type.startsWith("media/")) {
      return this.validateMediaAction(action as MediaAction, project);
    } else if (type.startsWith("track/")) {
      return this.validateTrackAction(action as TrackAction, project);
    } else if (type.startsWith("clip/")) {
      return this.validateClipAction(action as ClipAction, project);
    } else if (type.startsWith("effect/")) {
      return this.validateEffectAction(action as EffectAction, project);
    } else if (type.startsWith("transform/")) {
      return this.validateTransformAction(action as TransformAction, project);
    } else if (type.startsWith("keyframe/")) {
      return this.validateKeyframeAction(action as KeyframeAction, project);
    } else if (type.startsWith("transition/")) {
      return this.validateTransitionAction(action as TransitionAction, project);
    } else if (type.startsWith("audio/")) {
      return this.validateAudioAction(action as AudioAction, project);
    } else if (type.startsWith("subtitle/")) {
      return this.validateSubtitleAction(action as SubtitleAction, project);
    } else if (type.startsWith("marker/")) {
      return this.validateMarkerAction(action as MarkerAction, project);
    }

    return [
      {
        code: "UNKNOWN_ACTION_TYPE",
        message: `Unknown action type: ${type}`,
      },
    ];
  }

  private validateProjectAction(
    action: ProjectAction,
    _project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    switch (action.type) {
      case "project/create":
        if (!action.params.name || typeof action.params.name !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Project name is required and must be a string",
            path: "params.name",
          });
        }
        if (!action.params.settings) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Project settings are required",
            path: "params.settings",
          });
        }
        break;

      case "project/rename":
        if (!action.params.name || typeof action.params.name !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Project name is required and must be a string",
            path: "params.name",
          });
        }
        break;

      case "project/updateSettings":
      case "project/setCanvasBackground":
        // Params are partial, so just check they're an object
        if (
          !action.params ||
          typeof action.params !== "object" ||
          Array.isArray(action.params)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Params must be an object",
            path: "params",
          });
        } else if (action.type === "project/updateSettings") {
          const { pixelAspectRatio, fieldOrder, colorManagement, acesOutput, ocio, vr } = action.params as {
            vr?: unknown;
            pixelAspectRatio?: unknown;
            fieldOrder?: unknown;
            colorManagement?: unknown;
            acesOutput?: unknown;
            ocio?: unknown;
          };
          if (colorManagement !== undefined && colorManagement !== "display-referred" && colorManagement !== "aces" && colorManagement !== "ocio") {
            errors.push({ code: "INVALID_PARAMS", message: "Colour management must be display-referred, aces or ocio", path: "params.colorManagement" });
          }
          if (ocio !== undefined) {
            const problem = validateOcioSettings(ocio);
            if (problem) errors.push({ code: "INVALID_PARAMS", message: problem, path: "params.ocio" });
          }
          if (acesOutput !== undefined && acesOutput !== "srgb" && acesOutput !== "rec709") {
            errors.push({ code: "INVALID_PARAMS", message: "ACES output transform must be srgb or rec709", path: "params.acesOutput" });
          }
          if (
            pixelAspectRatio !== undefined &&
            !(typeof pixelAspectRatio === "number" && Number.isFinite(pixelAspectRatio) && pixelAspectRatio >= 0.25 && pixelAspectRatio <= 4)
          ) {
            errors.push({ code: "INVALID_PARAMS", message: "Sequence pixel aspect ratio must be between 0.25 and 4", path: "params.pixelAspectRatio" });
          }
          if (vr !== undefined && vr !== null) {
            const problem = validateVrProperties(vr);
            if (problem) errors.push({ code: "INVALID_PARAMS", message: problem, path: "params.vr" });
          }
          if (fieldOrder !== undefined && fieldOrder !== "progressive" && fieldOrder !== "upper" && fieldOrder !== "lower") {
            errors.push({ code: "INVALID_PARAMS", message: "Sequence field order must be progressive, upper or lower", path: "params.fieldOrder" });
          }
        }
        break;

      case "project/registerGeneratedShader":
        if (
          !action.params.def ||
          typeof action.params.def !== "object" ||
          typeof action.params.def.id !== "string" ||
          typeof action.params.def.glsl !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "A valid shader def is required",
            path: "params.def",
          });
        }
        break;

      case "project/removeGeneratedShader":
        if (
          !action.params.shaderId ||
          typeof action.params.shaderId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "shaderId is required and must be a string",
            path: "params.shaderId",
          });
        }
        break;
    }

    return errors;
  }

  private validateMediaAction(
    action: MediaAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    switch (action.type) {
      case "media/import":
        if (!action.params.file) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "File is required for media import",
            path: "params.file",
          });
        }
        break;

      case "media/delete":
      case "media/rename":
        if (
          !action.params.mediaId ||
          typeof action.params.mediaId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Media ID is required and must be a string",
            path: "params.mediaId",
          });
        } else {
          const mediaExists = project.mediaLibrary.items.some(
            (item) => item.id === action.params.mediaId,
          );
          if (!mediaExists) {
            errors.push({
              code: "MEDIA_NOT_FOUND",
              message: `Media with ID ${action.params.mediaId} not found`,
              path: "params.mediaId",
            });
          }
        }

        if (action.type === "media/rename") {
          if (!action.params.name || typeof action.params.name !== "string") {
            errors.push({
              code: "INVALID_PARAMS",
              message: "Media name is required and must be a string",
              path: "params.name",
            });
          }
        }
        break;
    }

    return errors;
  }

  private validateTrackAction(
    action: TrackAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    switch (action.type) {
      case "track/add":
        if (
          !["video", "audio", "image", "text", "graphics"].includes(
            action.params.trackType,
          )
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message:
              "Track type must be 'video', 'audio', 'image', 'text', or 'graphics'",
            path: "params.trackType",
          });
        }
        if (
          action.params.position !== undefined &&
          (typeof action.params.position !== "number" ||
            action.params.position < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track position must be a non-negative number",
            path: "params.position",
          });
        }
        break;

      case "track/duplicate":
        if (
          !action.params.sourceTrackId ||
          typeof action.params.sourceTrackId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Source track ID is required and must be a string",
            path: "params.sourceTrackId",
          });
        } else if (!this.findTrack(timeline, action.params.sourceTrackId)) {
          errors.push({
            code: "TRACK_NOT_FOUND",
            message: `Track with ID ${action.params.sourceTrackId} not found`,
            path: "params.sourceTrackId",
          });
        }
        if (
          action.params.position !== undefined &&
          (typeof action.params.position !== "number" ||
            action.params.position < 0 ||
            action.params.position > timeline.tracks.length)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track position must be within the timeline",
            path: "params.position",
          });
        }
        break;

      case "track/remove":
      case "track/lock":
      case "track/setSyncLock":
      case "track/hide":
      case "track/mute":
      case "track/solo":
      case "track/setSoloSafe":
        if (
          !action.params.trackId ||
          typeof action.params.trackId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track ID is required and must be a string",
            path: "params.trackId",
          });
        } else {
          const track = this.findTrack(timeline, action.params.trackId);
          if (!track) {
            errors.push({
              code: "TRACK_NOT_FOUND",
              message: `Track with ID ${action.params.trackId} not found`,
              path: "params.trackId",
            });
          }
        }
        if (
          action.type === "track/lock" &&
          typeof action.params.locked !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Locked parameter must be a boolean",
            path: "params.locked",
          });
        }
        if (
          action.type === "track/setSyncLock" &&
          typeof action.params.syncLock !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "syncLock parameter must be a boolean",
            path: "params.syncLock",
          });
        }
        if (
          action.type === "track/hide" &&
          typeof action.params.hidden !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Hidden parameter must be a boolean",
            path: "params.hidden",
          });
        }
        if (
          action.type === "track/mute" &&
          typeof action.params.muted !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Muted parameter must be a boolean",
            path: "params.muted",
          });
        }
        if (
          action.type === "track/solo" &&
          typeof action.params.solo !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Solo parameter must be a boolean",
            path: "params.solo",
          });
        }
        if (
          action.type === "track/setSoloSafe" &&
          typeof action.params.soloSafe !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "soloSafe parameter must be a boolean",
            path: "params.soloSafe",
          });
        }
        break;

      case "track/reorder":
        if (
          !action.params.trackId ||
          typeof action.params.trackId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track ID is required and must be a string",
            path: "params.trackId",
          });
        } else {
          const track = this.findTrack(timeline, action.params.trackId);
          if (!track) {
            errors.push({
              code: "TRACK_NOT_FOUND",
              message: `Track with ID ${action.params.trackId} not found`,
              path: "params.trackId",
            });
          }
        }

        if (
          typeof action.params.newPosition !== "number" ||
          action.params.newPosition < 0 ||
          action.params.newPosition >= timeline.tracks.length
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: `New position must be between 0 and ${
              timeline.tracks.length - 1
            }`,
            path: "params.newPosition",
          });
        }
        break;

      case "track/rename":
        if (
          !action.params.trackId ||
          typeof action.params.trackId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track ID is required and must be a string",
            path: "params.trackId",
          });
        } else {
          const track = this.findTrack(timeline, action.params.trackId);
          if (!track) {
            errors.push({
              code: "TRACK_NOT_FOUND",
              message: `Track with ID ${action.params.trackId} not found`,
              path: "params.trackId",
            });
          }
        }
        if (
          typeof action.params.name !== "string" ||
          action.params.name.trim().length === 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track name is required and must be a non-empty string",
            path: "params.name",
          });
        }
        break;
    }

    return errors;
  }

  private validateMarkerAction(
    action: MarkerAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    switch (action.type) {
      case "marker/add":
        if (
          typeof action.params.time !== "number" ||
          action.params.time < 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Marker time must be a non-negative number",
            path: "params.time",
          });
        }
        errors.push(...this.validateMarkerFields(action.params, "params"));
        break;

      case "marker/remove":
      case "marker/update":
        if (
          !action.params.markerId ||
          typeof action.params.markerId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Marker ID is required and must be a string",
            path: "params.markerId",
          });
        } else {
          const marker = timeline.markers.find(
            (m) => m.id === action.params.markerId,
          );
          if (!marker) {
            errors.push({
              code: "INVALID_PARAMS",
              message: `Marker with ID ${action.params.markerId} not found`,
              path: "params.markerId",
            });
          }
        }
        if (action.type === "marker/update") {
          const updates = action.params.updates ?? {};
          if (
            updates.time !== undefined &&
            (typeof updates.time !== "number" ||
              !Number.isFinite(updates.time) ||
              updates.time < 0)
          ) {
            errors.push({
              code: "INVALID_PARAMS",
              message: "Marker time must be a non-negative number",
              path: "params.updates.time",
            });
          }
          errors.push(...this.validateMarkerFields(updates, "params.updates"));
        }
        break;
    }

    return errors;
  }

  private validateMarkerFields(
    fields: {
      duration?: unknown;
      comment?: unknown;
      kind?: unknown;
      author?: unknown;
      status?: unknown;
      replies?: unknown;
    },
    path: string,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    if (
      fields.duration !== undefined &&
      (typeof fields.duration !== "number" ||
        !Number.isFinite(fields.duration) ||
        fields.duration < 0)
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Marker duration must be a non-negative number",
        path: `${path}.duration`,
      });
    }
    if (fields.comment !== undefined && typeof fields.comment !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Marker comment must be a string",
        path: `${path}.comment`,
      });
    }
    if (
      fields.kind !== undefined &&
      !(MARKER_KINDS as readonly unknown[]).includes(fields.kind)
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: `Marker kind must be one of ${MARKER_KINDS.join(", ")}`,
        path: `${path}.kind`,
      });
    }
    if (fields.author !== undefined && typeof fields.author !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Marker author must be a string",
        path: `${path}.author`,
      });
    }
    if (
      fields.status !== undefined &&
      !(REVIEW_STATUSES as readonly unknown[]).includes(fields.status)
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: `Marker status must be one of ${REVIEW_STATUSES.join(", ")}`,
        path: `${path}.status`,
      });
    }
    if (
      fields.replies !== undefined &&
      (!Array.isArray(fields.replies) ||
        fields.replies.some(
          (r) =>
            !r ||
            typeof r !== "object" ||
            typeof (r as { text?: unknown }).text !== "string" ||
            typeof (r as { author?: unknown }).author !== "string",
        ))
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Marker replies must be a list of { author, text } entries",
        path: `${path}.replies`,
      });
    }
    return errors;
  }

  private validateClipAction(
    action: ClipAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    switch (action.type) {
      case "clip/add":
        if (
          !action.params.trackId ||
          typeof action.params.trackId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Track ID is required and must be a string",
            path: "params.trackId",
          });
        } else {
          const track = this.findTrack(timeline, action.params.trackId);
          if (!track) {
            errors.push({
              code: "TRACK_NOT_FOUND",
              message: `Track with ID ${action.params.trackId} not found`,
              path: "params.trackId",
            });
          } else if (track.locked) {
            errors.push({
              code: "TRACK_LOCKED",
              message: `Track ${action.params.trackId} is locked`,
              path: "params.trackId",
            });
          }
        }
        if (
          !action.params.mediaId ||
          typeof action.params.mediaId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Media ID is required and must be a string",
            path: "params.mediaId",
          });
        } else {
          const mediaExists = project.mediaLibrary.items.some(
            (item) => item.id === action.params.mediaId,
          );
          if (!mediaExists) {
            errors.push({
              code: "MEDIA_NOT_FOUND",
              message: `Media with ID ${action.params.mediaId} not found`,
              path: "params.mediaId",
            });
          }
        }
        if (
          typeof action.params.startTime !== "number" ||
          action.params.startTime < 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Start time must be a non-negative number",
            path: "params.startTime",
          });
        }
        break;

      case "clip/remove":
      case "clip/rippleDelete":
        if (!action.params.clipId || typeof action.params.clipId !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip ID is required and must be a string",
            path: "params.clipId",
          });
        } else {
          const clip = this.findClip(timeline, action.params.clipId);
          if (!clip) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip with ID ${action.params.clipId} not found`,
              path: "params.clipId",
            });
          } else {
            const track = this.findTrack(timeline, clip.trackId);
            if (track?.locked) {
              errors.push({
                code: "TRACK_LOCKED",
                message: `Track containing clip ${action.params.clipId} is locked`,
                path: "params.clipId",
              });
            }
          }
        }
        break;

      case "clip/addBatch": {
        const entries = action.params.clips;
        if (!Array.isArray(entries) || entries.length === 0) {
          errors.push({ code: "INVALID_PARAMS", message: "clips must be a non-empty array", path: "params.clips" });
          break;
        }
        const trackLocks = new Map(timeline.tracks.map((track) => [track.id, Boolean(track.locked)] as const));
        const mediaIds = new Set(project.mediaLibrary.items.map((item) => item.id));
        const existing = new Set<string>();
        for (const track of timeline.tracks) for (const clip of track.clips) existing.add(clip.id);
        const seen = new Set<string>();
        for (const entry of entries) {
          if (typeof entry.clipId !== "string" || entry.clipId === "" || seen.has(entry.clipId) || existing.has(entry.clipId)) {
            errors.push({ code: "INVALID_PARAMS", message: `Clip ID ${String(entry.clipId)} is missing or already in use`, path: "params.clips" });
            break;
          }
          seen.add(entry.clipId);
          if (!trackLocks.has(entry.trackId)) {
            errors.push({ code: "TRACK_NOT_FOUND", message: `Track with ID ${String(entry.trackId)} not found`, path: "params.clips" });
            break;
          }
          if (trackLocks.get(entry.trackId)) {
            errors.push({ code: "TRACK_LOCKED", message: `Track ${entry.trackId} is locked`, path: "params.clips" });
            break;
          }
          if (typeof entry.startTime !== "number" || !Number.isFinite(entry.startTime) || entry.startTime < 0) {
            errors.push({ code: "INVALID_PARAMS", message: "Start time must be a non-negative number", path: "params.clips" });
            break;
          }
          if (!entry.sourceClip || typeof entry.sourceClip !== "object" || typeof entry.sourceClip.mediaId !== "string" || !mediaIds.has(entry.sourceClip.mediaId)) {
            errors.push({ code: "MEDIA_NOT_FOUND", message: `Media with ID ${String(entry.sourceClip?.mediaId)} not found`, path: "params.clips" });
            break;
          }
        }
        break;
      }

      case "clip/removeBatch": {
        const ids = action.params.clipIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          errors.push({ code: "INVALID_PARAMS", message: "clipIds must be a non-empty array", path: "params.clipIds" });
          break;
        }
        const located = new Map<string, boolean>();
        for (const track of timeline.tracks) for (const clip of track.clips) located.set(clip.id, Boolean(track.locked));
        for (const id of ids) {
          if (!located.has(id)) {
            errors.push({ code: "CLIP_NOT_FOUND", message: `Clip with ID ${String(id)} not found`, path: "params.clipIds" });
            break;
          }
          if (located.get(id)) {
            errors.push({ code: "TRACK_LOCKED", message: `Track containing clip ${id} is locked`, path: "params.clipIds" });
            break;
          }
        }
        break;
      }

      case "clip/moveBatch": {
        const moves = action.params.moves;
        if (!Array.isArray(moves) || moves.length === 0) {
          errors.push({ code: "INVALID_PARAMS", message: "moves must be a non-empty array", path: "params.moves" });
          break;
        }
        const located = new Map<string, boolean>();
        for (const track of timeline.tracks) for (const clip of track.clips) located.set(clip.id, Boolean(track.locked));
        const trackLocks = new Map(timeline.tracks.map((track) => [track.id, Boolean(track.locked)] as const));
        const seen = new Set<string>();
        for (const move of moves) {
          if (typeof move.clipId !== "string" || !located.has(move.clipId)) {
            errors.push({ code: "CLIP_NOT_FOUND", message: `Clip with ID ${String(move.clipId)} not found`, path: "params.moves" });
            break;
          }
          if (seen.has(move.clipId)) {
            errors.push({ code: "INVALID_PARAMS", message: `Clip ${move.clipId} appears twice in one batch`, path: "params.moves" });
            break;
          }
          seen.add(move.clipId);
          if (located.get(move.clipId)) {
            errors.push({ code: "TRACK_LOCKED", message: `Track containing clip ${move.clipId} is locked`, path: "params.moves" });
            break;
          }
          if (typeof move.startTime !== "number" || !Number.isFinite(move.startTime) || move.startTime < 0) {
            errors.push({ code: "INVALID_PARAMS", message: "Start time must be a non-negative number", path: "params.moves" });
            break;
          }
          if (move.trackId !== undefined) {
            if (!trackLocks.has(move.trackId)) {
              errors.push({ code: "TRACK_NOT_FOUND", message: `Target track with ID ${move.trackId} not found`, path: "params.moves" });
              break;
            }
            if (trackLocks.get(move.trackId)) {
              errors.push({ code: "TRACK_LOCKED", message: `Target track ${move.trackId} is locked`, path: "params.moves" });
              break;
            }
          }
        }
        break;
      }

      case "clip/move":
        if (!action.params.clipId || typeof action.params.clipId !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip ID is required and must be a string",
            path: "params.clipId",
          });
        } else {
          const clip = this.findClip(timeline, action.params.clipId);
          if (!clip) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip with ID ${action.params.clipId} not found`,
              path: "params.clipId",
            });
          } else {
            const track = this.findTrack(timeline, clip.trackId);
            if (track?.locked) {
              errors.push({
                code: "TRACK_LOCKED",
                message: `Track containing clip ${action.params.clipId} is locked`,
                path: "params.clipId",
              });
            }
          }
        }

        if (
          typeof action.params.startTime !== "number" ||
          action.params.startTime < 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Start time must be a non-negative number",
            path: "params.startTime",
          });
        }

        if (action.params.trackId !== undefined) {
          if (typeof action.params.trackId !== "string") {
            errors.push({
              code: "INVALID_PARAMS",
              message: "Track ID must be a string",
              path: "params.trackId",
            });
          } else {
            const targetTrack = this.findTrack(timeline, action.params.trackId);
            if (!targetTrack) {
              errors.push({
                code: "TRACK_NOT_FOUND",
                message: `Target track with ID ${action.params.trackId} not found`,
                path: "params.trackId",
              });
            } else if (targetTrack.locked) {
              errors.push({
                code: "TRACK_LOCKED",
                message: `Target track ${action.params.trackId} is locked`,
                path: "params.trackId",
              });
            }
          }
        }
        break;

      case "clip/trim":
        if (!action.params.clipId || typeof action.params.clipId !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip ID is required and must be a string",
            path: "params.clipId",
          });
        } else {
          const clip = this.findClip(timeline, action.params.clipId);
          if (!clip) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip with ID ${action.params.clipId} not found`,
              path: "params.clipId",
            });
          } else {
            const track = this.findTrack(timeline, clip.trackId);
            if (track?.locked) {
              errors.push({
                code: "TRACK_LOCKED",
                message: `Track containing clip ${action.params.clipId} is locked`,
                path: "params.clipId",
              });
            }
          }
        }

        if (
          action.params.inPoint !== undefined &&
          (typeof action.params.inPoint !== "number" ||
            action.params.inPoint < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "In-point must be a non-negative number",
            path: "params.inPoint",
          });
        }

        if (
          action.params.outPoint !== undefined &&
          (typeof action.params.outPoint !== "number" ||
            action.params.outPoint < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Out-point must be a non-negative number",
            path: "params.outPoint",
          });
        }
        if (
          action.params.inPoint !== undefined &&
          action.params.outPoint !== undefined &&
          action.params.outPoint <= action.params.inPoint
        ) {
          errors.push({
            code: "INVALID_TIME_RANGE",
            message: "Out-point must be greater than in-point",
            path: "params",
          });
        }
        {
          // Restricted subclips keep trims inside their source window.
          const trimmed = typeof action.params.clipId === "string" ? this.findClip(timeline, action.params.clipId) : undefined;
          const bounds = trimmed
            ? mediaTrimBounds(project.mediaLibrary.items.find((item) => item.id === trimmed.mediaId))
            : null;
          if (bounds) {
            const nextIn = typeof action.params.inPoint === "number" ? action.params.inPoint : trimmed!.inPoint;
            const nextOut = typeof action.params.outPoint === "number" ? action.params.outPoint : trimmed!.outPoint;
            if (nextIn < bounds.min - 1e-6 || nextOut > bounds.max + 1e-6)
              errors.push({
                code: "INVALID_TIME_RANGE",
                message: "This subclip restricts trims to its boundaries",
                path: "params",
              });
          }
        }
        break;

      case "clip/split":
        if (!action.params.clipId || typeof action.params.clipId !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip ID is required and must be a string",
            path: "params.clipId",
          });
        } else {
          const clip = this.findClip(timeline, action.params.clipId);
          if (!clip) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip with ID ${action.params.clipId} not found`,
              path: "params.clipId",
            });
          } else {
            const track = this.findTrack(timeline, clip.trackId);
            if (track?.locked) {
              errors.push({
                code: "TRACK_LOCKED",
                message: `Track containing clip ${action.params.clipId} is locked`,
                path: "params.clipId",
              });
            }
            if (typeof action.params.time === "number") {
              if (
                action.params.time <= clip.startTime ||
                action.params.time >= clip.startTime + clip.duration
              ) {
                errors.push({
                  code: "OUT_OF_BOUNDS",
                  message: `Split time must be within clip bounds (${
                    clip.startTime
                  } to ${clip.startTime + clip.duration})`,
                  path: "params.time",
                });
              }
            } else {
              errors.push({
                code: "INVALID_PARAMS",
                message: "Split time is required and must be a number",
                path: "params.time",
              });
            }
          }
        }
        break;

      case "clip/setBlendMode":
      case "clip/setBlendOpacity":
      case "clip/setEmphasisAnimation":
      case "clip/setColorGrading":
        if (!action.params.clipId || typeof action.params.clipId !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip ID is required and must be a string",
            path: "params.clipId",
          });
        } else {
          const clip = this.findClip(timeline, action.params.clipId);
          if (!clip) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip with ID ${action.params.clipId} not found`,
              path: "params.clipId",
            });
          } else {
            const track = this.findTrack(timeline, clip.trackId);
            if (track?.locked) {
              errors.push({
                code: "TRACK_LOCKED",
                message: `Track containing clip ${action.params.clipId} is locked`,
                path: "params.clipId",
              });
            }
          }
        }
        break;
    }

    return errors;
  }

  private validateEffectAction(
    action: EffectAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    // All effect actions require clipId
    if (!action.params.clipId || typeof action.params.clipId !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Clip ID is required and must be a string",
        path: "params.clipId",
      });
      return errors;
    }

    const clip = this.findClip(timeline, action.params.clipId);
    if (!clip) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip with ID ${action.params.clipId} not found`,
        path: "params.clipId",
      });
      return errors;
    }

    const track = this.findTrack(timeline, clip.trackId);
    if (track?.locked) {
      errors.push({
        code: "TRACK_LOCKED",
        message: `Track containing clip ${action.params.clipId} is locked`,
        path: "params.clipId",
      });
    }

    switch (action.type) {
      case "effect/add":
        if (
          !action.params.effectType ||
          typeof action.params.effectType !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Effect type is required and must be a string",
            path: "params.effectType",
          });
        }
        break;

      case "effect/remove":
      case "effect/update":
      case "effect/toggle":
      case "effect/reorder":
        if (
          !action.params.effectId ||
          typeof action.params.effectId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Effect ID is required and must be a string",
            path: "params.effectId",
          });
        } else {
          const effectExists = clip.effects.some(
            (e) => e.id === action.params.effectId,
          );
          if (!effectExists) {
            errors.push({
              code: "EFFECT_NOT_FOUND",
              message: `Effect with ID ${action.params.effectId} not found on clip`,
              path: "params.effectId",
            });
          }
        }

        if (action.type === "effect/reorder") {
          if (
            typeof action.params.newIndex !== "number" ||
            action.params.newIndex < 0 ||
            action.params.newIndex >= clip.effects.length
          ) {
            errors.push({
              code: "INVALID_PARAMS",
              message: `New index must be between 0 and ${
                clip.effects.length - 1
              }`,
              path: "params.newIndex",
            });
          }
        }

        if (
          action.type === "effect/toggle" &&
          typeof action.params.enabled !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Enabled parameter must be a boolean",
            path: "params.enabled",
          });
        }
        break;
    }

    return errors;
  }

  private validateTransformAction(
    action: TransformAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    if (!action.params.clipId || typeof action.params.clipId !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Clip ID is required and must be a string",
        path: "params.clipId",
      });
      return errors;
    }

    const clip = this.findClip(timeline, action.params.clipId);
    if (!clip) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip with ID ${action.params.clipId} not found`,
        path: "params.clipId",
      });
      return errors;
    }

    const track = this.findTrack(timeline, clip.trackId);
    if (track?.locked) {
      errors.push({
        code: "TRACK_LOCKED",
        message: `Track containing clip ${action.params.clipId} is locked`,
        path: "params.clipId",
      });
    }

    if (
      !action.params.transform ||
      typeof action.params.transform !== "object"
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Transform is required and must be an object",
        path: "params.transform",
      });
    }

    return errors;
  }

  private validateKeyframeAction(
    action: KeyframeAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    // The registered bulk-set handler owns validation for this action. This
    // branch also narrows the legacy validator's remaining action union.
    if (action.type === "keyframe/setAll") {
      return errors;
    }

    if (!action.params.clipId || typeof action.params.clipId !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Clip ID is required and must be a string",
        path: "params.clipId",
      });
      return errors;
    }

    const clip = this.findClip(timeline, action.params.clipId);
    if (!clip) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip with ID ${action.params.clipId} not found`,
        path: "params.clipId",
      });
      return errors;
    }

    const track = this.findTrack(timeline, clip.trackId);
    if (track?.locked) {
      errors.push({
        code: "TRACK_LOCKED",
        message: `Track containing clip ${action.params.clipId} is locked`,
        path: "params.clipId",
      });
    }

    if (!action.params.property || typeof action.params.property !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Property is required and must be a string",
        path: "params.property",
      });
    }

    if (typeof action.params.time !== "number" || action.params.time < 0) {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Time is required and must be a non-negative number",
        path: "params.time",
      });
    }

    if (
      action.type === "keyframe/add" &&
      action.params.easing !== undefined &&
      !EASING_TYPES.includes(action.params.easing)
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Easing must be a supported easing type",
        path: "params.easing",
      });
    }

    return errors;
  }

  private validateTransitionAction(
    action: TransitionAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    switch (action.type) {
      case "transition/add":
        if (
          !action.params.clipAId ||
          typeof action.params.clipAId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip A ID is required and must be a string",
            path: "params.clipAId",
          });
        }

        if (
          !action.params.clipBId ||
          typeof action.params.clipBId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Clip B ID is required and must be a string",
            path: "params.clipBId",
          });
        }

        if (
          typeof action.params.transitionType !== "string" ||
          !TRANSITION_TYPES.includes(action.params.transitionType)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Transition type must be supported",
            path: "params.transitionType",
          });
        }

        if (
          typeof action.params.duration !== "number" ||
          action.params.duration <= 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Duration must be a positive number",
            path: "params.duration",
          });
        }
        {
          const problem = validateTransitionParams((action.params as { params?: unknown }).params);
          if (problem) errors.push({ code: "INVALID_PARAMS", message: problem, path: "params.params" });
        }
        if (action.params.clipAId && action.params.clipBId) {
          const clipA = this.findClip(timeline, action.params.clipAId);
          const clipB = this.findClip(timeline, action.params.clipBId);

          if (!clipA) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip A with ID ${action.params.clipAId} not found`,
              path: "params.clipAId",
            });
          }

          if (!clipB) {
            errors.push({
              code: "CLIP_NOT_FOUND",
              message: `Clip B with ID ${action.params.clipBId} not found`,
              path: "params.clipBId",
            });
          }

          if (clipA && clipB) {
            if (clipA.trackId !== clipB.trackId) {
              errors.push({
                code: "INVALID_PARAMS",
                message: "Clips must be on the same track for transition",
                path: "params",
              });
            }
            const clipAEnd = clipA.startTime + clipA.duration;
            const clipBEnd = clipB.startTime + clipB.duration;
            const tolerance = 0.001;

            const aBeforeB = Math.abs(clipAEnd - clipB.startTime) < tolerance;
            const bBeforeA = Math.abs(clipBEnd - clipA.startTime) < tolerance;

            if (!aBeforeB && !bBeforeA) {
              errors.push({
                code: "INVALID_PARAMS",
                message: "Clips must be adjacent for transition",
                path: "params",
              });
            }
          }
        }
        break;

      case "transition/set": {
        const transition = action.params.transition as
          | { id?: unknown; clipAId?: unknown }
          | undefined;
        if (
          !transition ||
          typeof transition.id !== "string" ||
          typeof transition.clipAId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "A valid transition with id and clipAId is required",
            path: "params.transition",
          });
        } else if (!this.findClip(timeline, transition.clipAId)) {
          errors.push({
            code: "CLIP_NOT_FOUND",
            message: `Clip A with ID ${transition.clipAId} not found`,
            path: "params.transition.clipAId",
          });
        }
        {
          const problem = validateTransitionParams((transition as { params?: unknown } | undefined)?.params);
          if (problem) errors.push({ code: "INVALID_PARAMS", message: problem, path: "params.transition.params" });
        }
        break;
      }

      case "transition/remove":
      case "transition/update":
        if (action.type === "transition/update") {
          const problem = validateTransitionParams(action.params.params);
          if (problem) errors.push({ code: "INVALID_PARAMS", message: problem, path: "params.params" });
          if (action.params.type !== undefined && !TRANSITION_TYPES.includes(action.params.type)) {
            errors.push({ code: "INVALID_PARAMS", message: "Transition type must be supported", path: "params.type" });
          }
        }
        if (
          !action.params.transitionId ||
          typeof action.params.transitionId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Transition ID is required and must be a string",
            path: "params.transitionId",
          });
        }

        if (
          action.type === "transition/update" &&
          action.params.type !== undefined &&
          !TRANSITION_TYPES.includes(action.params.type)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Transition type must be supported",
            path: "params.type",
          });
        }

        if (
          action.type === "transition/update" &&
          action.params.duration !== undefined
        ) {
          if (
            typeof action.params.duration !== "number" ||
            action.params.duration <= 0
          ) {
            errors.push({
              code: "INVALID_PARAMS",
              message: "Duration must be a positive number",
              path: "params.duration",
            });
          }
        }
        break;
    }

    return errors;
  }

  private validateAudioAction(
    action: AudioAction,
    project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const timeline = project.timeline;

    if (!action.params.clipId || typeof action.params.clipId !== "string") {
      errors.push({
        code: "INVALID_PARAMS",
        message: "Clip ID is required and must be a string",
        path: "params.clipId",
      });
      return errors;
    }

    const clip = this.findClip(timeline, action.params.clipId);
    if (!clip) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip with ID ${action.params.clipId} not found`,
        path: "params.clipId",
      });
      return errors;
    }

    const track = this.findTrack(timeline, clip.trackId);
    if (track?.locked) {
      errors.push({
        code: "TRACK_LOCKED",
        message: `Track containing clip ${action.params.clipId} is locked`,
        path: "params.clipId",
      });
    }

    switch (action.type) {
      case "audio/setVolume":
        if (
          typeof action.params.volume !== "number" ||
          action.params.volume < 0 ||
          action.params.volume > 4
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Volume must be a number between 0 and 4",
            path: "params.volume",
          });
        }
        break;

      case "audio/setFade":
        if (
          action.params.fadeIn !== undefined &&
          (typeof action.params.fadeIn !== "number" || !Number.isFinite(action.params.fadeIn) || action.params.fadeIn < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Fade-in must be a non-negative number",
            path: "params.fadeIn",
          });
        }

        if (
          action.params.fadeOut !== undefined &&
          (typeof action.params.fadeOut !== "number" || !Number.isFinite(action.params.fadeOut) ||
            action.params.fadeOut < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Fade-out must be a non-negative number",
            path: "params.fadeOut",
          });
        }
        break;

      case "audio/restoreFade": {
        const fade = action.params.fade;
        if (fade === null) break;
        const origin = fade?.origin;
        if (!fade || typeof fade !== "object" ||
            !Number.isFinite(fade.fadeIn) || fade.fadeIn < 0 ||
            !Number.isFinite(fade.fadeOut) || fade.fadeOut < 0 ||
            (origin !== undefined && (!origin || typeof origin !== "object" ||
              !Number.isFinite(origin.offset) || !Number.isFinite(origin.duration) || origin.duration <= 0 ||
              (origin.out !== undefined && (!origin.out || !Number.isFinite(origin.out.offset) || !Number.isFinite(origin.out.duration) || origin.out.duration <= 0)) ||
              (origin.fadeIn !== undefined && typeof origin.fadeIn !== "boolean") ||
              (origin.fadeOut !== undefined && typeof origin.fadeOut !== "boolean")))) {
          errors.push({ code: "INVALID_PARAMS", message: "The restored fade has invalid timing.", path: "params.fade" });
        }
        break;
      }

      case "audio/addAutomation": {
        const points = action.params.points as unknown;
        if (points === null) break;
        if (!Array.isArray(points)) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Automation points must be an array",
            path: "params.points",
          });
        } else if (
          points.some(
            (point: { time?: unknown; value?: unknown } | null) =>
              !point ||
              typeof point.time !== "number" ||
              !Number.isFinite(point.time) ||
              point.time < 0 ||
              typeof point.value !== "number" ||
              !Number.isFinite(point.value) ||
              point.value < 0,
          )
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message:
              "Automation points need a finite time and value of 0 or more",
            path: "params.points",
          });
        }
        break;
      }

      case "audio/addEffect": {
        const effect = action.params.effect as
          | { id?: unknown; type?: unknown }
          | undefined;
        if (
          !effect ||
          typeof effect.id !== "string" ||
          typeof effect.type !== "string" ||
          !effect.type
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "A valid effect object with an id and type is required",
            path: "params.effect",
          });
        }
        break;
      }

      case "audio/replaceEffect": {
        const { effectId, effect } = action.params;
        if (!(clip.audioEffects ?? []).some((item) => item.id === effectId)) {
          errors.push({ code: "EFFECT_NOT_FOUND", message: "Audio effect not found on clip", path: "params.effectId" });
        }
        if (!effect || effect.id !== effectId || typeof effect.type !== "string" || !effect.type
          || typeof effect.enabled !== "boolean" || !effect.params || typeof effect.params !== "object" || Array.isArray(effect.params)) {
          errors.push({ code: "INVALID_PARAMS", message: "A complete effect with the same identity is required", path: "params.effect" });
        }
        break;
      }

      case "audio/setLiveDucking": {
        const { config } = action.params;
        if (config !== null) {
          const numbers = [config?.amountDb, config?.attackMs, config?.releaseMs, config?.holdMs];
          if (typeof config !== "object" || typeof config.enabled !== "boolean" || numbers.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
            errors.push({ code: "INVALID_PARAMS", message: "Live ducking needs enabled, amountDb, attackMs, releaseMs and holdMs", path: "params.config" });
          } else if (config.amountDb <= 0 || config.attackMs < 0 || config.releaseMs < 0 || config.holdMs < 0) {
            errors.push({ code: "INVALID_PARAMS", message: "Ducking amount must be positive and times cannot be negative", path: "params.config" });
          }
        }
        break;
      }

      case "audio/setEssentialSound": {
        const { audioType, state } = action.params;
        if (audioType !== null && !AUDIO_TYPES.includes(audioType)) {
          errors.push({ code: "INVALID_PARAMS", message: "Audio type must be dialogue, music, sfx, ambience or null", path: "params.audioType" });
        }
        if (state !== null && (typeof state !== "object" || !state?.options)) {
          errors.push({ code: "INVALID_PARAMS", message: "Essential Sound state needs its options", path: "params.state" });
        }
        break;
      }

      case "audio/removeEffect":
      case "audio/updateEffect":
      case "audio/toggleEffect":
        if (
          !action.params.effectId ||
          typeof action.params.effectId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Effect ID is required and must be a string",
            path: "params.effectId",
          });
        } else {
          const effectExists = (clip.audioEffects ?? []).some(
            (e) => e.id === action.params.effectId,
          );
          if (!effectExists) {
            errors.push({
              code: "EFFECT_NOT_FOUND",
              message: `Audio effect with ID ${action.params.effectId} not found on clip`,
              path: "params.effectId",
            });
          }
        }
        if (
          action.type === "audio/toggleEffect" &&
          typeof action.params.enabled !== "boolean"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Enabled parameter must be a boolean",
            path: "params.enabled",
          });
        }
        break;
    }

    return errors;
  }

  private validateSubtitleAction(
    action: SubtitleAction,
    _project: Project,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    switch (action.type) {
      case "subtitle/import":
        if (
          !action.params.srtContent ||
          typeof action.params.srtContent !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "SRT content is required and must be a string",
            path: "params.srtContent",
          });
        }
        break;

      case "subtitle/add":
        if (!action.params.text || typeof action.params.text !== "string") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Subtitle text is required and must be a string",
            path: "params.text",
          });
        }

        if (
          typeof action.params.startTime !== "number" ||
          action.params.startTime < 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Start time must be a non-negative number",
            path: "params.startTime",
          });
        }

        if (
          typeof action.params.endTime !== "number" ||
          action.params.endTime < 0
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "End time must be a non-negative number",
            path: "params.endTime",
          });
        }

        if (
          typeof action.params.startTime === "number" &&
          typeof action.params.endTime === "number" &&
          action.params.endTime <= action.params.startTime
        ) {
          errors.push({
            code: "INVALID_TIME_RANGE",
            message: "End time must be greater than start time",
            path: "params",
          });
        }
        break;

      case "subtitle/update":
        if (
          !action.params.subtitleId ||
          typeof action.params.subtitleId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Subtitle ID is required and must be a string",
            path: "params.subtitleId",
          });
        }

        if (
          action.params.startTime !== undefined &&
          (typeof action.params.startTime !== "number" ||
            action.params.startTime < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Start time must be a non-negative number",
            path: "params.startTime",
          });
        }

        if (
          action.params.endTime !== undefined &&
          (typeof action.params.endTime !== "number" ||
            action.params.endTime < 0)
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "End time must be a non-negative number",
            path: "params.endTime",
          });
        }
        break;

      case "subtitle/remove":
        if (
          !action.params.subtitleId ||
          typeof action.params.subtitleId !== "string"
        ) {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Subtitle ID is required and must be a string",
            path: "params.subtitleId",
          });
        }
        break;

      case "subtitle/setStyle":
        if (!action.params.style || typeof action.params.style !== "object") {
          errors.push({
            code: "INVALID_PARAMS",
            message: "Style is required and must be an object",
            path: "params.style",
          });
        }
        break;
    }

    return errors;
  }

  private findTrack(timeline: Timeline, trackId: string): Track | null {
    return timeline.tracks.find((t) => t.id === trackId) || null;
  }

  private findClip(timeline: Timeline, clipId: string): Clip | null {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }
}
