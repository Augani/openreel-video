import type { Project } from "@openreel/core/types/project";
import type { Clip, Keyframe } from "@openreel/core/types/timeline";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Keyframe graph tools: Premiere-style temporal and spatial interpolation, handle edits, sampling and
 * cross-clip paste. Every implementation is loaded on first use (dynamic import) so the agent chunk
 * stays small, and every edit goes through the same pure core functions as the editor's graph, so the
 * keys written here evaluate identically in preview, export and `sample_keyframes`.
 */
const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TEMPORAL_OPS = ["linear", "bezier", "auto-bezier", "continuous-bezier", "hold", "ease-in", "ease-out"] as const;
const SPATIAL_OPS = ["linear", "bezier", "auto-bezier", "continuous-bezier"] as const;
const pointSchema = obj({ x: num, y: num }, ["x", "y"]);
const selectorSchema: JSONSchema = obj(
  {
    keyframeIds: { type: "array", items: str },
    property: str,
    times: { type: "array", items: num },
  },
);

function findClip(project: Project, clipId: unknown): Clip | undefined {
  if (typeof clipId !== "string") return undefined;
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/** Keyframe ids from `keyframeIds`, or from `property` (all of its keys, or only those at `times`). */
function selectIds(clip: Clip, args: Record<string, unknown>): string[] | ToolResult {
  if (Array.isArray(args.keyframeIds)) {
    const known = new Set(clip.keyframes.map((key) => key.id));
    const ids = args.keyframeIds.filter((id): id is string => typeof id === "string" && known.has(id));
    return ids.length ? ids : fail("None of keyframeIds exist on this clip (see list_clip_keyframes)");
  }
  if (typeof args.property !== "string") return fail("Pass keyframeIds, or a property (optionally with times)");
  const times = Array.isArray(args.times) ? args.times.filter(finite) : null;
  const ids = clip.keyframes
    .filter((key) => key.property === args.property && (!times || times.some((t) => Math.abs(t - key.time) < 1e-3)))
    .map((key) => key.id);
  return ids.length ? ids : fail(`No ${String(args.property)} keyframes matched`);
}
const isResult = (value: string[] | ToolResult): value is ToolResult => !Array.isArray(value);

async function commit(host: EditingHost, clipId: string, keyframes: Keyframe[], label: string): Promise<ToolResult | null> {
  const result = await host.applyAction({ type: "keyframe/setAll", id: genId(), timestamp: Date.now(), params: { clipId, keyframes } });
  return result.success ? null : fail(result.error?.message ?? `${label} failed`, result.error?.code ?? "ACTION_FAILED");
}

const describe = (key: Keyframe) => ({
  id: key.id,
  property: key.property,
  time: key.time,
  value: key.value,
  easing: key.easing,
  ...(key.bezierHandles ? { bezierHandles: key.bezierHandles } : {}),
  ...(key.interpolationIn ? { interpolationIn: key.interpolationIn } : {}),
  ...(key.interpolationOut ? { interpolationOut: key.interpolationOut } : {}),
  ...(key.spatialMode ? { spatialMode: key.spatialMode, spatialIn: key.spatialIn, spatialOut: key.spatialOut } : {}),
});

export const KEYFRAME_GRAPH_TOOLS: RegisteredTool[] = [
  {
    name: "list_clip_keyframes",
    domain: "read",
    title: "List clip keyframes",
    description:
      "List a clip's keyframes (id, property, clip-local time, value, easing, Bezier handles, temporal and spatial interpolation) optionally for one property. Use the ids with set_keyframe_interpolation and set_keyframe_handles.",
    inputSchema: obj({ clipId: str, property: str }, ["clipId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`);
      const keys = clip.keyframes.filter((key) => typeof args.property !== "string" || key.property === args.property);
      return ok(`${keys.length} keyframes`, { keyframes: [...keys].sort((a, b) => a.time - b.time).map(describe) });
    },
  },
  {
    name: "set_keyframe_interpolation",
    domain: "keyframe",
    title: "Set keyframe interpolation",
    description:
      "Premiere-style interpolation for keyframes picked by keyframeIds, or by property (+ optional times). temporal: linear, bezier, auto-bezier (smooth tangents recomputed from neighbours), continuous-bezier (collinear handles), hold, ease-in, ease-out; side 'both' (default), 'in' or 'out'. spatial (position.x/position.y keys whose X and Y keys share times): linear, bezier, auto-bezier, continuous-bezier shape the motion PATH while temporal timing still comes from the X key. One undo step.",
    inputSchema: obj(
      { clipId: str, ...(selectorSchema.properties as Record<string, JSONSchema>), temporal: { type: "string", enum: [...TEMPORAL_OPS] }, side: { type: "string", enum: ["both", "in", "out"] }, spatial: { type: "string", enum: [...SPATIAL_OPS] } },
      ["clipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`);
      if (args.temporal === undefined && args.spatial === undefined) return fail("Pass temporal and/or spatial");
      if (args.temporal !== undefined && !(TEMPORAL_OPS as readonly unknown[]).includes(args.temporal)) return fail(`temporal must be one of ${TEMPORAL_OPS.join(", ")}`);
      if (args.spatial !== undefined && !(SPATIAL_OPS as readonly unknown[]).includes(args.spatial)) return fail(`spatial must be one of ${SPATIAL_OPS.join(", ")}`);
      const side = args.side === "in" || args.side === "out" ? args.side : "both";
      const ids = selectIds(clip, args);
      if (isResult(ids)) return ids;
      let keyframes: Keyframe[] = clip.keyframes;
      if (args.temporal !== undefined) {
        const { applyKeyframeInterpolation } = await import("@openreel/core/animation/keyframe-interpolation");
        keyframes = applyKeyframeInterpolation(keyframes, ids, args.temporal as (typeof TEMPORAL_OPS)[number], side);
      }
      if (args.spatial !== undefined) {
        const { applySpatialInterpolation, pairPositionKeys } = await import("@openreel/core/animation/spatial-path");
        if (!pairPositionKeys(keyframes)) return fail("Spatial interpolation needs position.x and position.y keys at the same times");
        keyframes = applySpatialInterpolation(keyframes, ids, args.spatial as (typeof SPATIAL_OPS)[number]);
      }
      const error = await commit(host, clip.id, keyframes, "set_keyframe_interpolation");
      return error ?? ok(`interpolation set on ${ids.length} keyframes`, { keyframeIds: ids });
    },
  },
  {
    name: "set_keyframe_handles",
    domain: "keyframe",
    title: "Set keyframe handles",
    description:
      "Drag a keyframe handle like the graph editor. temporal: { in:{x,y}, out:{x,y} } are the normalized Bezier handles of the segment leaving the key (x is time 0..1, y is progress, overshoot allowed to -2..3); on an Auto Bezier key this makes it Continuous. spatial: { which:'in'|'out', x, y } is a position-path handle as an offset from the key point in position units (Auto becomes Continuous, Continuous keeps the handles collinear). One undo step.",
    inputSchema: obj(
      { clipId: str, keyframeId: str, temporal: obj({ in: pointSchema, out: pointSchema }, ["in", "out"]), spatial: obj({ which: { type: "string", enum: ["in", "out"] }, x: num, y: num }, ["which", "x", "y"]) },
      ["clipId", "keyframeId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      const key = clip?.keyframes.find((candidate) => candidate.id === args.keyframeId);
      if (!clip || !key) return fail("Clip or keyframe not found");
      if (!args.temporal && !args.spatial) return fail("Pass temporal and/or spatial");
      let keyframes: Keyframe[] = clip.keyframes;
      if (args.temporal) {
        const t = args.temporal as { in?: { x?: unknown; y?: unknown }; out?: { x?: unknown; y?: unknown } };
        if (![t.in?.x, t.in?.y, t.out?.x, t.out?.y].every(finite)) return fail("temporal handles must be finite numbers");
        const [{ clampBezierHandles }, { refreshSmoothKeyframesAfterEdit }] = await Promise.all([
          import("@openreel/core/animation/keyframe-bezier"),
          import("@openreel/core/animation/keyframe-interpolation"),
        ]);
        const handles = clampBezierHandles({ in: { x: t.in!.x as number, y: t.in!.y as number }, out: { x: t.out!.x as number, y: t.out!.y as number } });
        const edited = keyframes.map((k) => (k.id === key.id ? { ...k, easing: "bezier" as const, bezierHandles: handles } : k));
        keyframes = refreshSmoothKeyframesAfterEdit(keyframes, edited);
      }
      if (args.spatial) {
        const s = args.spatial as { which?: unknown; x?: unknown; y?: unknown };
        if ((s.which !== "in" && s.which !== "out") || !finite(s.x) || !finite(s.y)) return fail("spatial needs which ('in'|'out'), x and y");
        const { setSpatialHandle, pairPositionKeys } = await import("@openreel/core/animation/spatial-path");
        if (!pairPositionKeys(keyframes)) return fail("Spatial handles need position.x and position.y keys at the same times");
        keyframes = setSpatialHandle(keyframes, key.id, s.which, { x: s.x, y: s.y });
      }
      const error = await commit(host, clip.id, keyframes, "set_keyframe_handles");
      return error ?? ok("handles set", { keyframe: describe(keyframes.find((k) => k.id === key.id) as Keyframe) });
    },
  },
  {
    name: "sample_keyframes",
    domain: "read",
    title: "Sample animated values",
    description:
      "Evaluate a clip's animated transform and keyframed values at clip-local times (seconds) with the same evaluator the preview and export use: easing, Bezier handles, Auto/Continuous tangents and spatial motion paths included. Returns { time, values } where values maps property to number (position.x, position.y, scale.x, ...).",
    inputSchema: obj({ clipId: str, times: { type: "array", items: num } }, ["clipId", "times"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`);
      const times = Array.isArray(args.times) ? args.times.filter(finite).slice(0, 200) : [];
      if (!times.length) return fail("times must be a non-empty array of numbers");
      const { evaluateKeyframesAt } = await import("@openreel/core/animation/evaluate-keyframes");
      return ok(`${times.length} samples`, { samples: times.map((time) => ({ time, values: Object.fromEntries(evaluateKeyframesAt(clip.keyframes, time)) })) });
    },
  },
  {
    name: "copy_keyframes_to_clip",
    domain: "keyframe",
    title: "Copy keyframes between clips",
    description:
      "Copy keyframes (keyframeIds, or a property and optional times) from one clip and paste them onto another, the first copied key landing at clip-local `time` on the target (default 0). Keeps temporal handles and spatial paths. Effect parameter keys move onto the target's only effect of the same type; ambiguous ones are skipped and counted. targetProperty retargets a single copied property. Replaces target keys at the same instants. One undo step.",
    inputSchema: obj(
      { fromClipId: str, toClipId: str, ...(selectorSchema.properties as Record<string, JSONSchema>), time: num, targetProperty: str },
      ["fromClipId", "toClipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const from = findClip(project, args.fromClipId);
      const to = findClip(project, args.toClipId);
      if (!from || !to) return fail("Source or target clip not found");
      const ids = selectIds(from, args);
      if (isResult(ids)) return ids;
      const at = finite(args.time) ? Math.max(0, args.time) : 0;
      const { copyKeyframeSet, pasteKeyframeSet, retargetCopiedKeyframes } = await import("@openreel/core/animation/keyframe-clipboard");
      const picked = from.keyframes.filter((key) => ids.includes(key.id));
      const moved = retargetCopiedKeyframes(copyKeyframeSet(picked).keyframes, from.effects, to.effects);
      if (!moved.keyframes.length) return fail(`Nothing could be pasted (${moved.dropped} effect keys had no matching effect on the target)`);
      const merged = pasteKeyframeSet(to.keyframes, copyKeyframeSet(moved.keyframes), {
        time: at,
        targetProperty: typeof args.targetProperty === "string" ? args.targetProperty : undefined,
        maxTime: to.duration,
        newId: genId,
      });
      const error = await commit(host, to.id, merged, "copy_keyframes_to_clip");
      return error ?? ok(`pasted ${moved.keyframes.length} keyframes`, { skippedEffectKeys: moved.dropped });
    },
  },
];
