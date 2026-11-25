import type { Action } from "@openreel/core/types/actions";
import type { AudioRack, AudioRackEffect } from "@openreel/core/types/timeline";
import {
  AUDIO_RACK_EFFECT_DEFINITIONS,
  AUDIO_RACK_EFFECT_TYPES,
  getMaxRackEffects,
  createRackEffect,
  isAudioRackEffectType,
  sanitizeRackEffectParams,
} from "@openreel/core/audio/track-audio-rack";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Premiere-style Audio Track Mixer effect racks (a configurable number of ordered effects per
 * audio track plus the master bus). Each tool dispatches ONE `audioRack/set`
 * action, i.e. one undo step, through the same handler the mixer UI uses.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
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

const TARGET_DESC = 'Track id, bus id (create_bus), or "master" for the master bus.';

const EFFECT_PARAM_DOC = AUDIO_RACK_EFFECT_TYPES.map((type) => {
  const def = AUDIO_RACK_EFFECT_DEFINITIONS[type];
  return `${type}: ${def.params.map((p) => `${p.key} ${p.min}..${p.max}${p.unit ? ` ${p.unit}` : ""}`).join(", ")}`;
}).join("; ") + '; compressor sidechain: set keySource to "track:<trackId>" or "bus:<busId>" so it detects on that signal instead of its own (a key that would close a feedback loop is ignored); keyHpf high-passes the key';

function currentRack(host: EditingHost, target: string): AudioRack {
  const timeline = host.getProject().timeline;
  const rack =
    target === "master"
      ? timeline.masterAudioRack
      : (timeline.tracks.find((t) => t.id === target)?.audioRack ??
        timeline.audioBuses?.find((b) => b.id === target)?.rack);
  return rack ?? { effects: [] };
}

function validateTarget(host: EditingHost, target: unknown): string | undefined {
  if (typeof target !== "string" || target.length === 0) return "target is required";
  if (target === "master") return undefined;
  const { tracks, audioBuses } = host.getProject().timeline;
  return tracks.some((t) => t.id === target) || audioBuses?.some((b) => b.id === target)
    ? undefined
    : `Track or bus not found: ${target}`;
}

async function commitRack(
  host: EditingHost,
  target: string,
  rack: AudioRack,
  summary: string,
  data: Record<string, unknown>,
): Promise<ToolResult> {
  const action: Action = {
    type: "audioRack/set",
    id: genId(),
    timestamp: Date.now(),
    params: { target, rack },
  };
  const result = await host.applyAction(action);
  if (!result.success) {
    return fail(result.error?.message ?? "audioRack/set failed", result.error?.code ?? "ACTION_FAILED");
  }
  return ok(summary, { actionId: action.id, target, ...data });
}

const paramRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const TRACK_AUDIO_RACK_TOOLS: RegisteredTool[] = [
  {
    name: "add_track_audio_effect",
    domain: "track",
    title: "Add track audio effect",
    description: `Add an effect to a track's (or the master bus's) audio effect rack. Racks hold up to ${getMaxRackEffects()} effects processed in order, in live playback and in export. effectType: ${AUDIO_RACK_EFFECT_TYPES.join("|")}. Optional params (omitted ones use defaults; ${EFFECT_PARAM_DOC}), position (0-based slot, default end) and bypassed. Returns the new effectId. One undo step.`,
    inputSchema: obj(
      {
        target: { ...str, description: TARGET_DESC },
        effectType: { type: "string", enum: [...AUDIO_RACK_EFFECT_TYPES] },
        params: { type: "object" },
        position: num,
        bypassed: bool,
      },
      ["target", "effectType"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const invalid = validateTarget(host, args.target);
      if (invalid) return fail(invalid, "TRACK_NOT_FOUND");
      if (!isAudioRackEffectType(args.effectType)) {
        return fail(`effectType must be one of ${AUDIO_RACK_EFFECT_TYPES.join(", ")}`, "INVALID_PARAMS");
      }
      const target = args.target as string;
      const rack = currentRack(host, target);
      if (rack.effects.length >= getMaxRackEffects()) {
        return fail(`The rack is full (${getMaxRackEffects()} effects). Remove one first.`, "RACK_FULL");
      }
      const effect = createRackEffect(args.effectType, {
        params: paramRecord(args.params),
        bypassed: args.bypassed === true,
      });
      const effects = [...rack.effects];
      const at =
        typeof args.position === "number" && Number.isFinite(args.position)
          ? Math.max(0, Math.min(effects.length, Math.floor(args.position)))
          : effects.length;
      effects.splice(at, 0, effect);
      return commitRack(host, target, { ...rack, effects }, `Added ${effect.type} to ${target}`, {
        effectId: effect.id,
        position: at,
        params: effect.params,
      });
    },
  },
  {
    name: "set_track_audio_effect_param",
    domain: "track",
    title: "Set track audio effect parameters",
    description: `Edit one effect in a track/master audio rack: any of params (object of numeric parameters, clamped to range; ${EFFECT_PARAM_DOC}), bypassed and position (new 0-based slot: reorders the rack). Also sets the bus fader/pan of that track: volume (linear 0..4, 1 = 0 dB) and pan (-1..1; tracks only) when effectId is omitted. One undo step.`,
    inputSchema: obj(
      {
        target: { ...str, description: TARGET_DESC },
        effectId: str,
        params: { type: "object" },
        bypassed: bool,
        position: num,
        volume: num,
        pan: num,
      },
      ["target"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const invalid = validateTarget(host, args.target);
      if (invalid) return fail(invalid, "TRACK_NOT_FOUND");
      const target = args.target as string;
      const rack = currentRack(host, target);
      let next: AudioRack = rack;
      if (typeof args.volume === "number" && Number.isFinite(args.volume)) {
        next = { ...next, volume: Math.max(0, Math.min(4, args.volume)) };
      }
      if (typeof args.pan === "number" && Number.isFinite(args.pan) && target !== "master") {
        next = { ...next, pan: Math.max(-1, Math.min(1, args.pan)) };
      }
      let updated: AudioRackEffect | undefined;
      if (args.effectId !== undefined) {
        const index = rack.effects.findIndex((e) => e.id === args.effectId);
        if (index < 0) return fail(`Rack effect not found: ${String(args.effectId)}`, "EFFECT_NOT_FOUND");
        const existing = rack.effects[index];
        const merged = paramRecord(args.params)
          ? sanitizeRackEffectParams(existing.type, { ...existing.params, ...paramRecord(args.params) })
          : existing.params;
        updated = {
          ...existing,
          params: merged,
          bypassed: typeof args.bypassed === "boolean" ? args.bypassed : existing.bypassed,
        };
        const effects = [...rack.effects];
        effects[index] = updated;
        if (typeof args.position === "number" && Number.isFinite(args.position)) {
          const [moved] = effects.splice(index, 1);
          effects.splice(Math.max(0, Math.min(effects.length, Math.floor(args.position))), 0, moved);
        }
        next = { ...next, effects };
      } else if (args.params !== undefined || typeof args.bypassed === "boolean" || args.position !== undefined) {
        return fail("params, bypassed and position edit one effect: give its effectId.", "INVALID_PARAMS");
      } else if (next === rack) {
        return fail("Give an effectId (with params/bypassed/position) or a volume/pan to set.", "INVALID_PARAMS");
      }
      return commitRack(host, target, next, `Updated audio rack on ${target}`, {
        effect: updated,
        volume: next.volume ?? 1,
        pan: next.pan ?? 0,
      });
    },
  },
  {
    name: "remove_track_audio_effect",
    domain: "track",
    title: "Remove track audio effect",
    description:
      "Remove one effect from a track's (or the master bus's) audio effect rack by effectId. One undo step.",
    inputSchema: obj(
      { target: { ...str, description: TARGET_DESC }, effectId: str },
      ["target", "effectId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const invalid = validateTarget(host, args.target);
      if (invalid) return fail(invalid, "TRACK_NOT_FOUND");
      const target = args.target as string;
      const rack = currentRack(host, target);
      if (!rack.effects.some((e) => e.id === args.effectId)) {
        return fail(`Rack effect not found: ${String(args.effectId)}`, "EFFECT_NOT_FOUND");
      }
      return commitRack(
        host,
        target,
        { ...rack, effects: rack.effects.filter((e) => e.id !== args.effectId) },
        `Removed audio effect from ${target}`,
        { effectId: args.effectId },
      );
    },
  },
];
