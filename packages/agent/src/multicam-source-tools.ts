import type { Project } from "@openreel/core/types/project";
import {
  computeAngleOffsets,
  createMulticamSource,
  flattenMulticam,
  getMulticamSource,
  getMulticamSources,
  insertMulticamClip,
  listMulticamClips,
  multicamClipAtTime,
  recordMulticamCuts,
  switchMulticamAngle,
  type AngleSyncInput,
  type MulticamEditResult,
  type MulticamSource,
  type MulticamSyncMethod,
} from "@openreel/core/multicam/source";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema } from "./types";
import { bool, commit, fail, guarded, num, obj, ok, str } from "./sequence-tools";

/**
 * Multi-camera tools. Each call computes the next project with the pure
 * functions in core/multicam/source and commits it as ONE
 * `project/applyEditSnapshot` action: exactly one undo step, through the same
 * code the editor's multicam monitor uses.
 */
const arr = (items: JSONSchema): JSONSchema => ({ type: "array", items });
const SYNC_METHODS = ["audio", "timecode", "in-points", "markers", "manual"] as const;

function describeSource(project: Project, source: MulticamSource) {
  const clips = listMulticamClips(project, source.id);
  return {
    id: source.id,
    name: source.name,
    syncMethod: source.syncMethod,
    audio: source.audio,
    angles: source.angles.map((angle, index) => ({
      number: index + 1,
      id: angle.id,
      name: angle.name,
      mediaId: angle.mediaId,
      offsetSec: angle.offset,
      confidence: source.confidence?.[angle.id],
    })),
    clips: clips.map((ref) => ({
      clipId: ref.clip.id,
      trackId: ref.track.id,
      startSec: ref.clip.startTime,
      durationSec: ref.clip.duration,
      angle: ref.source.angles.findIndex((a) => a.id === ref.angle.id) + 1,
      angleName: ref.angle.name,
    })),
  };
}

function resolveSource(project: Project, ref: unknown): MulticamSource {
  const sources = getMulticamSources(project);
  if (typeof ref === "string" && ref) {
    const found = sources.find((s) => s.id === ref) ?? sources.find((s) => s.name.toLowerCase() === ref.toLowerCase());
    if (!found) throw new Error(`No multicam source "${ref}". Use list_multicam_sources.`);
    return found;
  }
  if (sources.length === 1) return sources[0];
  throw new Error(sources.length === 0 ? "There is no multicam source. Use create_multicam first." : "Several multicam sources exist: pass sourceId.");
}

/** An angle by 1-based number, id, or (unique) name. */
function resolveAngle(source: MulticamSource, ref: unknown): string {
  if (typeof ref === "number" && Number.isInteger(ref)) {
    const angle = source.angles[ref - 1];
    if (!angle) throw new Error(`"${source.name}" has angles 1 to ${source.angles.length}.`);
    return angle.id;
  }
  if (typeof ref === "string" && ref) {
    const byId = source.angles.find((a) => a.id === ref);
    if (byId) return byId.id;
    const byName = source.angles.filter((a) => a.name.toLowerCase() === ref.toLowerCase());
    if (byName.length === 1) return byName[0].id;
    if (/^\d+$/.test(ref) && source.angles[Number(ref) - 1]) return source.angles[Number(ref) - 1].id;
  }
  throw new Error("angle must be an angle number (1-based), id or name. Use list_multicam_sources.");
}

const numbers = (value: unknown, name: string, count: number): number[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== count || value.some((v) => typeof v !== "number" || !Number.isFinite(v)))
    throw new Error(`${name} must be an array of ${count} numbers (one per media id).`);
  return value as number[];
};

const commitMulticam = (host: EditingHost, label: string, build: (project: Project) => MulticamEditResult) =>
  commit(host, label, build);

export const MULTICAM_SOURCE_TOOLS: RegisteredTool[] = [
  {
    name: "list_multicam_sources",
    domain: "multicam",
    title: "List multicam sources",
    description:
      "List the project's multi-camera sources (synced angles, numbered 1-9 like the number keys) and the multicam clips of the active sequence that use them, with each clip's active angle.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((_args, host) => {
      const project = host.getProject();
      const sources = getMulticamSources(project).map((s) => describeSource(project, s));
      return ok(`${sources.length} multicam source(s)`, { sources });
    }),
  },
  {
    name: "create_multicam",
    domain: "multicam",
    title: "Create multicam source",
    description:
      'Create a synced multi-camera source from 2 to 9 video media items ("mediaIds", the first is the sync reference; angle numbers follow the order) and, by default, place it on the timeline at "startTime" (seconds, default 0) as one multicam clip showing angle 1. "syncMethod": "audio" (default: cross-correlates the cameras\' audio, accurate to well under a frame; needs a host that can decode audio, or pass "offsets"), "timecode" (pass "timecodes": start timecode seconds per media), "in-points" (pass "inPoints": In time in each media), "markers" (pass "markers": a marker time in each media), or "manual" (pass "offsets": shared-time seconds at which each media\'s time 0 plays). "audio": {"mode":"follow"} (default: audio follows the video angle) or {"mode":"fixed","angle":N}. Pass "place": false to only create the source. One undo step. Then use switch_angle / record_multicam_cuts / flatten_multicam.',
    inputSchema: obj(
      {
        name: str,
        mediaIds: arr(str),
        syncMethod: { type: "string", enum: [...SYNC_METHODS] },
        offsets: arr(num),
        timecodes: arr(num),
        inPoints: arr(num),
        markers: arr(num),
        audio: { type: "object", additionalProperties: true },
        place: bool,
        startTime: num,
      },
      ["mediaIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: guarded(async (args, host) => {
      const mediaIds = args.mediaIds;
      if (!Array.isArray(mediaIds) || mediaIds.some((id) => typeof id !== "string")) throw new Error("mediaIds must be an array of media id strings.");
      const ids = mediaIds as string[];
      const method = (args.syncMethod ?? "audio") as MulticamSyncMethod;
      if (!SYNC_METHODS.includes(method as (typeof SYNC_METHODS)[number])) throw new Error(`syncMethod must be one of ${SYNC_METHODS.join(", ")}.`);
      const offsetsIn = numbers(args.offsets, "offsets", ids.length);
      const inputs: AngleSyncInput[] = ids.map((mediaId) => ({ mediaId }));
      let confidence: number[] | undefined;
      let finalOffsets: number[];
      if (method === "audio") {
        let measured: { offsets: number[]; confidence?: number[] } | null = offsetsIn ? { offsets: offsetsIn } : null;
        if (!measured) {
          if (!host.multicamSync) return fail('Audio sync needs a host that can decode audio. Pass "offsets" or use another syncMethod.', "UNSUPPORTED");
          measured = await host.multicamSync.measureAudioOffsets(ids);
        }
        const audioOffsets = measured.offsets;
        confidence = measured.confidence;
        const result = computeAngleOffsets("audio", inputs.map((input, i) => ({ ...input, audioOffset: audioOffsets[i] })));
        if (!result.ok) throw new Error(result.message);
        finalOffsets = result.offsets;
      } else {
        const tcs = numbers(args.timecodes, "timecodes", ids.length);
        const ins = numbers(args.inPoints, "inPoints", ids.length);
        const marks = numbers(args.markers, "markers", ids.length);
        const result = computeAngleOffsets(
          method,
          inputs.map((input, i) => ({ ...input, timecode: tcs?.[i], inPoint: ins?.[i], marker: marks?.[i], audioOffset: offsetsIn?.[i] })),
        );
        if (!result.ok) throw new Error(result.message);
        finalOffsets = result.offsets;
      }
      const startTime = typeof args.startTime === "number" ? args.startTime : 0;
      const place = args.place !== false;
      const audioArg = args.audio as { mode?: string; angle?: unknown } | undefined;
      let sourceId: string | undefined;
      const committed = await commitMulticam(host, "Create multicam source", (project) => {
        const created = createMulticamSource(project, {
          name: typeof args.name === "string" ? args.name : undefined,
          syncMethod: method,
          angles: ids.map((mediaId, i) => ({ mediaId, offset: finalOffsets[i] })),
          confidence,
        });
        if (!created.ok || !created.sourceId) return created;
        sourceId = created.sourceId;
        let next = created.project;
        if (audioArg?.mode === "fixed") {
          const source = getMulticamSource(next, created.sourceId);
          if (!source) return { ok: false, message: "The multicam source could not be created." };
          const angleId = resolveAngle(source, audioArg.angle ?? 1);
          next = {
            ...next,
            multicamSources: getMulticamSources(next).map((s) => (s.id === source.id ? { ...s, audio: { mode: "fixed" as const, angleId } } : s)),
          };
        }
        if (!place) return { ok: true, project: next, sourceId: created.sourceId };
        const placed = insertMulticamClip(next, { sourceId: created.sourceId, startTime });
        return placed.ok ? { ...placed, sourceId: created.sourceId } : placed;
      });
      if (committed.failure) return committed.failure;
      const project = host.getProject();
      const source = getMulticamSource(project, sourceId ?? "");
      return ok(
        `Created multicam source "${source?.name}" with ${ids.length} angles${place ? " and placed it on the timeline" : ""}`,
        source ? describeSource(project, source) : undefined,
      );
    }),
  },
  {
    name: "switch_angle",
    domain: "multicam",
    title: "Switch multicam angle",
    description:
      'Switch a multicam clip to another angle, keeping every frame in sync. Identify the clip by "clipId" or by "atTime" (timeline seconds: the multicam clip on screen then). "angle" is the 1-based angle number (the number key), id or name. Refused when the angle has no footage for that span. One undo step.',
    inputSchema: obj({ clipId: str, atTime: num, angle: { type: ["number", "string"] } }, ["angle"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      let clipId = typeof args.clipId === "string" ? args.clipId : undefined;
      if (!clipId) {
        if (typeof args.atTime !== "number") throw new Error("Pass clipId or atTime.");
        clipId = multicamClipAtTime(project, args.atTime)?.clip.id;
        if (!clipId) throw new Error(`No multicam clip at ${args.atTime}s.`);
      }
      const target = clipId;
      const ref = listMulticamClips(project).find((r) => r.clip.id === target);
      if (!ref) throw new Error("That clip is not a multicam clip. Use list_multicam_sources.");
      const angleId = resolveAngle(ref.source, args.angle);
      const committed = await commitMulticam(host, "Switch multicam angle", (p) => switchMulticamAngle(p, [target], angleId));
      if (committed.failure) return committed.failure;
      const angle = ref.source.angles.find((a) => a.id === angleId);
      return ok(`Switched to angle ${ref.source.angles.findIndex((a) => a.id === angleId) + 1} (${angle?.name})`, { clipId: target, angleId });
    }),
  },
  {
    name: "record_multicam_cuts",
    domain: "multicam",
    title: "Record multicam cuts",
    description:
      'Cut a multicam clip between angles in one pass, like pressing the number keys during playback: "cuts" is a list of {time (timeline seconds), angle (1-based number, id or name)}; each angle runs until the next cut, the last until "endTime". Splits the multicam clips where a cut lands inside them. One undo step for the whole pass.',
    inputSchema: obj({ sourceId: str, cuts: arr({ type: "object", additionalProperties: true }), endTime: num }, ["cuts", "endTime"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const project = host.getProject();
      const source = resolveSource(project, args.sourceId);
      if (!Array.isArray(args.cuts) || args.cuts.length === 0) throw new Error("cuts must be a non-empty array of {time, angle}.");
      if (typeof args.endTime !== "number") throw new Error("endTime must be a number of seconds.");
      const cuts = (args.cuts as Array<{ time?: unknown; angle?: unknown }>).map((cut) => {
        if (typeof cut.time !== "number" || !Number.isFinite(cut.time)) throw new Error("every cut needs a numeric time.");
        return { time: cut.time, angleId: resolveAngle(source, cut.angle) };
      });
      const endTime = args.endTime;
      const committed = await commitMulticam(host, "Record multicam cuts", (p) => recordMulticamCuts(p, { cuts, endTime, sourceId: source.id }));
      if (committed.failure) return committed.failure;
      const next = host.getProject();
      return ok(`Recorded ${cuts.length} cut(s)`, describeSource(next, getMulticamSource(next, source.id) ?? source));
    }),
  },
  {
    name: "flatten_multicam",
    domain: "multicam",
    title: "Flatten multicam",
    description:
      'Flatten multicam clips to their active angle: every cut becomes a plain clip of that angle (same frames, same audio), no longer linked to the multicam source. Optional "sourceId" or "clipIds" limit what is flattened. One undo step.',
    inputSchema: obj({ sourceId: str, clipIds: arr(str) }),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      const clipIds = Array.isArray(args.clipIds) ? (args.clipIds as unknown[]).filter((id): id is string => typeof id === "string") : undefined;
      const sourceId = typeof args.sourceId === "string" ? resolveSource(host.getProject(), args.sourceId).id : undefined;
      const before = listMulticamClips(host.getProject()).length;
      const committed = await commitMulticam(host, "Flatten multicam", (p) => flattenMulticam(p, { clipIds, sourceId }));
      if (committed.failure) return committed.failure;
      return ok(`Flattened ${before - listMulticamClips(host.getProject()).length} multicam clip(s) to their active angle`);
    }),
  },
];
