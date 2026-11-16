import type { Project } from "@openreel/core/types/project";
import type { Clip, Keyframe } from "@openreel/core/types/timeline";
import { EASING_TYPES } from "@openreel/core/types/timeline";
import {
  clearEffectParamKeyframes,
  cloneEffectInstanceKeyframes,
  getAnimatableEffectParams,
  getEffectParamKeyframes,
  removeEffectParamKeyframe,
  upsertEffectParamKeyframe,
} from "@openreel/core/video/effect-instance-keyframes";
import {
  applyEffectPreset,
  createEffectPreset,
  mergeImportedPresets,
  parseEffectPresets,
  serializeEffectPresets,
  type EffectPreset,
} from "@openreel/core/video/effect-presets";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Effect instance animation and presets.
 *
 * Keyframes are keyed by effect INSTANCE (`fx:<effectId>:<param>`), so two
 * copies of one effect animate independently. These tools are the agent
 * counterpart of the inspector stopwatch (toggle / add / remove / prev-next
 * keyframe) and of the preset library (save, apply, export, import).
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const obj = (
  properties: Record<string, JSONSchema>,
  required: string[] = [],
): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function findClip(project: Project, clipId: unknown): Clip | undefined {
  if (typeof clipId !== "string") return undefined;
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

async function dispatch(
  host: EditingHost,
  type: string,
  params: Record<string, unknown>,
  label: string,
): Promise<ToolResult | null> {
  const result = await host.applyAction({ type, id: genId(), timestamp: Date.now(), params });
  return result.success
    ? null
    : fail(result.error?.message ?? `${label} failed`, result.error?.code ?? "ACTION_FAILED");
}

interface Located {
  readonly clip: Clip;
  readonly effectId: string;
  readonly param: string;
}

function locate(args: Record<string, unknown>, host: EditingHost): Located | ToolResult {
  host.requireOpenProject();
  const clip = findClip(host.getProject(), args.clipId);
  if (!clip) return fail(`Clip "${String(args.clipId)}" not found`, "INVALID_PARAMS");
  const effect = clip.effects.find((candidate) => candidate.id === args.effectId);
  if (!effect) return fail(`Effect "${String(args.effectId)}" not found on clip ${clip.id}`, "INVALID_PARAMS");
  const param = typeof args.param === "string" ? args.param : "";
  const animatable = getAnimatableEffectParams(effect);
  if (!animatable.some((candidate) => candidate.key === param)) {
    return fail(
      `"${param}" is not an animatable numeric parameter of a ${effect.type} effect. Animatable: ${
        animatable.map((candidate) => candidate.key).join(", ") || "none (shader, plugin and mask effects are not supported)"
      }.`,
      "INVALID_PARAMS",
    );
  }
  return { clip, effectId: effect.id, param };
}

const isResult = (value: Located | ToolResult): value is ToolResult => "ok" in value;

function presetsOf(project: Project): readonly EffectPreset[] {
  return project.effectPresets ?? [];
}

export const EFFECT_INSTANCE_TOOLS: RegisteredTool[] = [
  {
    name: "list_effect_params",
    domain: "read",
    title: "List animatable effect params",
    description:
      "List the animatable numeric parameters of one effect instance on a clip (key, label, min, max, step, current value) with their instance keyframes (time, value, easing). Use the keys with set_effect_param_keyframe.",
    inputSchema: obj({ clipId: str, effectId: str }, ["clipId", "effectId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      const effect = clip?.effects.find((candidate) => candidate.id === args.effectId);
      if (!clip || !effect) return fail("Clip or effect not found", "INVALID_PARAMS");
      const params = getAnimatableEffectParams(effect).map((param) => ({
        ...param,
        value: typeof effect.params[param.key] === "number" ? effect.params[param.key] : param.defaultValue,
        keyframes: getEffectParamKeyframes(clip.keyframes, effect.id, param.key).map((keyframe) => ({
          time: keyframe.time,
          value: keyframe.value,
          easing: keyframe.easing,
        })),
      }));
      return ok(`${params.length} animatable params`, { effectType: effect.type, params });
    },
  },
  {
    name: "set_effect_param_keyframe",
    domain: "keyframe",
    title: "Keyframe an effect parameter",
    description:
      "Add or update a keyframe on one numeric parameter of one effect INSTANCE at a clip-local time in seconds (the inspector stopwatch). Keyframes belong to the instance, so two copies of the same effect animate independently. Works for every classic video effect; see list_effect_params for the keys. A keyframe already at that time is updated. One undo step.",
    inputSchema: obj(
      { clipId: str, effectId: str, param: str, time: num, value: num, easing: { type: "string", enum: [...EASING_TYPES] } },
      ["clipId", "effectId", "param", "time", "value"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      const located = locate(args, host);
      if (isResult(located)) return located;
      if (!finite(args.time) || args.time < 0) return fail("time must be a number >= 0", "INVALID_PARAMS");
      if (!finite(args.value)) return fail("value must be a finite number", "INVALID_PARAMS");
      if (args.easing !== undefined && !(EASING_TYPES as readonly unknown[]).includes(args.easing)) {
        return fail("easing must be a supported easing type", "INVALID_PARAMS");
      }
      const keyframes = upsertEffectParamKeyframe(
        located.clip.keyframes,
        located.effectId,
        located.param,
        {
          time: args.time,
          value: args.value,
          ...(typeof args.easing === "string" ? { easing: args.easing as Keyframe["easing"] } : {}),
        },
        genId,
      );
      const error = await dispatch(host, "keyframe/setAll", { clipId: located.clip.id, keyframes }, "set_effect_param_keyframe");
      return error ?? ok("effect keyframe set", { count: getEffectParamKeyframes(keyframes, located.effectId, located.param).length });
    },
  },
  {
    name: "remove_effect_param_keyframe",
    domain: "keyframe",
    title: "Remove effect param keyframe",
    description:
      "Remove the keyframe of an effect instance parameter at a clip-local time (seconds), or every keyframe of that parameter when time is omitted (stopwatch off; the parameter keeps its stored value). One undo step.",
    inputSchema: obj({ clipId: str, effectId: str, param: str, time: num }, ["clipId", "effectId", "param"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`, "INVALID_PARAMS");
      const effectId = typeof args.effectId === "string" ? args.effectId : "";
      const param = typeof args.param === "string" ? args.param : "";
      if (!effectId || !param) return fail("effectId and param are required", "INVALID_PARAMS");
      if (args.time !== undefined && (!finite(args.time) || args.time < 0)) {
        return fail("time must be a number >= 0", "INVALID_PARAMS");
      }
      const before = getEffectParamKeyframes(clip.keyframes, effectId, param).length;
      const keyframes =
        args.time === undefined
          ? clearEffectParamKeyframes(clip.keyframes, effectId, param)
          : removeEffectParamKeyframe(clip.keyframes, effectId, param, args.time as number);
      if (keyframes.length === clip.keyframes.length) return fail("No matching keyframe found", "INVALID_PARAMS");
      const error = await dispatch(host, "keyframe/setAll", { clipId: clip.id, keyframes }, "remove_effect_param_keyframe");
      return error ?? ok("effect keyframe removed", { removed: before - getEffectParamKeyframes(keyframes, effectId, param).length });
    },
  },
  {
    name: "duplicate_video_effect",
    domain: "effect",
    title: "Duplicate effect",
    description:
      "Duplicate an effect instance on a clip, inserted right after the original, together with its parameter keyframes (the copy animates independently from then on). Returns the new effectId. One undo step.",
    inputSchema: obj({ clipId: str, effectId: str }, ["clipId", "effectId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clip = findClip(host.getProject(), args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`, "INVALID_PARAMS");
      const index = clip.effects.findIndex((effect) => effect.id === args.effectId);
      if (index < 0) return fail(`Effect "${String(args.effectId)}" not found`, "INVALID_PARAMS");
      const source = clip.effects[index]!;
      const newId = `effect-${genId()}`;
      const effects = [...clip.effects];
      effects.splice(index + 1, 0, { ...source, id: newId, params: structuredClone(source.params) });
      const keyframes = [...clip.keyframes, ...cloneEffectInstanceKeyframes(clip.keyframes, source.id, newId, genId)];
      const error = await dispatch(host, "effect/setStackState", { clipId: clip.id, effects, keyframes }, "duplicate_video_effect");
      return error ?? ok("effect duplicated", { effectId: newId });
    },
  },
  {
    name: "list_effect_presets",
    domain: "read",
    title: "List effect presets",
    description: "List the project's saved effect presets (id, name, timing mode, effect types, keyframe count).",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (_args, host) => {
      host.requireOpenProject();
      const presets = presetsOf(host.getProject()).map((preset) => ({
        id: preset.id,
        name: preset.name,
        timing: preset.timing,
        effects: preset.effects.map((effect) => effect.type),
        keyframes: preset.keyframes.length,
      }));
      return ok(`${presets.length} presets`, { presets });
    },
  },
  {
    name: "save_effect_preset",
    domain: "effect",
    title: "Save effect preset",
    description:
      "Save effects of a clip (all of them, or only effectIds) with their parameter keyframes as a named preset in the project. timing 'relative' (default) stores keyframe times as a fraction of the clip duration so the animation stretches to the clip it is applied to; 'absolute' keeps seconds. Returns presetId. One undo step.",
    inputSchema: obj(
      { clipId: str, name: str, effectIds: { type: "array", items: str }, timing: { type: "string", enum: ["relative", "absolute"] } },
      ["clipId", "name"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const clip = findClip(project, args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`, "INVALID_PARAMS");
      const timing = args.timing === "absolute" ? "absolute" : "relative";
      if (args.timing !== undefined && args.timing !== "absolute" && args.timing !== "relative") {
        return fail('timing must be "relative" or "absolute"', "INVALID_PARAMS");
      }
      if (args.effectIds !== undefined && (!Array.isArray(args.effectIds) || args.effectIds.some((id) => typeof id !== "string"))) {
        return fail("effectIds must be an array of effect ids", "INVALID_PARAMS");
      }
      const created = createEffectPreset(clip, {
        id: `preset-${genId()}`,
        name: typeof args.name === "string" ? args.name : "",
        timing,
        ...(Array.isArray(args.effectIds) ? { effectIds: args.effectIds as string[] } : {}),
      });
      if (!created.ok) return fail(created.error, "INVALID_PARAMS");
      const error = await dispatch(host, "effectPreset/setAll", { presets: [...presetsOf(project), created.value] }, "save_effect_preset");
      return error ?? ok(`preset "${created.value.name}" saved`, { presetId: created.value.id });
    },
  },
  {
    name: "apply_effect_preset",
    domain: "effect",
    title: "Apply effect preset",
    description:
      "Apply a saved effect preset to a clip: its effects are added as fresh independent instances with their keyframes (relative presets are scaled to this clip's duration). mode 'append' (default) adds to the stack, 'replace' replaces the clip's effect stack. Returns the new effectIds. One undo step.",
    inputSchema: obj(
      { clipId: str, presetId: str, mode: { type: "string", enum: ["append", "replace"] } },
      ["clipId", "presetId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const clip = findClip(project, args.clipId);
      if (!clip) return fail(`Clip "${String(args.clipId)}" not found`, "INVALID_PARAMS");
      const preset = presetsOf(project).find((candidate) => candidate.id === args.presetId);
      if (!preset) return fail(`Preset "${String(args.presetId)}" not found`, "INVALID_PARAMS");
      if (args.mode !== undefined && args.mode !== "append" && args.mode !== "replace") {
        return fail('mode must be "append" or "replace"', "INVALID_PARAMS");
      }
      const applied = applyEffectPreset(clip, preset, {
        mode: args.mode === "replace" ? "replace" : "append",
        makeId: (prefix) => `${prefix}-${genId()}`,
      });
      const error = await dispatch(
        host,
        "effect/setStackState",
        { clipId: clip.id, effects: applied.effects, keyframes: applied.keyframes },
        "apply_effect_preset",
      );
      return error ?? ok(`preset "${preset.name}" applied`, { effectIds: applied.addedEffectIds });
    },
  },
  {
    name: "delete_effect_preset",
    domain: "effect",
    title: "Delete effect preset",
    description: "Delete a saved effect preset (clips that already used it keep their effects). One undo step.",
    inputSchema: obj({ presetId: str }, ["presetId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const presets = presetsOf(host.getProject());
      if (!presets.some((preset) => preset.id === args.presetId)) {
        return fail(`Preset "${String(args.presetId)}" not found`, "INVALID_PARAMS");
      }
      const error = await dispatch(
        host,
        "effectPreset/setAll",
        { presets: presets.filter((preset) => preset.id !== args.presetId) },
        "delete_effect_preset",
      );
      return error ?? ok("preset deleted");
    },
  },
  {
    name: "export_effect_presets",
    domain: "read",
    title: "Export effect presets",
    description:
      "Return saved effect presets as JSON text (all, or only presetIds) in the portable OpenReel preset file format, for sharing or backup. Import with import_effect_presets.",
    inputSchema: obj({ presetIds: { type: "array", items: str } }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      host.requireOpenProject();
      const wanted = Array.isArray(args.presetIds) ? new Set(args.presetIds as unknown[]) : null;
      const presets = presetsOf(host.getProject()).filter((preset) => !wanted || wanted.has(preset.id));
      if (presets.length === 0) return fail("No presets to export", "INVALID_PARAMS");
      return ok(`${presets.length} presets exported`, { json: serializeEffectPresets(presets) });
    },
  },
  {
    name: "import_effect_presets",
    domain: "effect",
    title: "Import effect presets",
    description:
      "Import effect presets from JSON text produced by export_effect_presets (or a single preset object). The file is validated strictly; presets are added to the project library and never overwrite existing ones. Returns the new presetIds. One undo step.",
    inputSchema: obj({ json: str }, ["json"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (typeof args.json !== "string") return fail("json must be a string", "INVALID_PARAMS");
      const parsed = parseEffectPresets(args.json, () => `preset-${genId()}`);
      if (!parsed.ok) return fail(parsed.error, "INVALID_PARAMS");
      const library = presetsOf(host.getProject());
      const merged = mergeImportedPresets(library, parsed.value, () => `preset-${genId()}`);
      const error = await dispatch(host, "effectPreset/setAll", { presets: merged }, "import_effect_presets");
      return error ?? ok(`${merged.length - library.length} presets imported`, {
        presetIds: merged.slice(library.length).map((preset) => preset.id),
      });
    },
  },
];
