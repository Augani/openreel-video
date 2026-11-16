import type { Action } from "@openreel/core/types/actions";
import {
  planAddBus,
  planAddSend,
  planRemoveBus,
  planRemoveSend,
  planSetBusAutomation,
  planSetBusOutput,
  planSetSend,
  planSetTrackOutput,
  planStemsPreset,
  planUpdateBus,
  getAudioBuses,
  type RoutingPlan,
} from "@openreel/core/audio/audio-routing";
import { isTrackAutomationLane, planSetTrackAutomation } from "@openreel/core/audio/track-automation";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Audio Track Mixer routing: submix buses, track output assignment and sends.
 * Every tool computes its edit with the same pure planners the mixer UI uses
 * and dispatches ONE `audioRouting/set` action, i.e. one undo step.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const points: JSONSchema = {
  type: "array",
  items: { type: "object", properties: { time: num, value: num }, required: ["time", "value"] },
};
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({ ok: false, summary: message, error: { code, message } });

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const ROLES = ["general", "dialogue", "music", "effects"] as const;
const roleOf = (value: unknown) => (typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as (typeof ROLES)[number]) : undefined);
const pointList = (value: unknown): { time: number; value: number }[] | undefined =>
  Array.isArray(value)
    ? value
        .filter((p): p is { time: number; value: number } => !!p && typeof p.time === "number" && typeof p.value === "number")
        .map((p) => ({ time: p.time, value: p.value }))
    : undefined;

async function commit(host: EditingHost, plan: RoutingPlan, data: Record<string, unknown> = {}): Promise<ToolResult> {
  if (!plan.ok) return fail(plan.message, "INVALID_ROUTING");
  const action: Action = {
    type: "audioRouting/set",
    id: genId(),
    timestamp: Date.now(),
    params: { ...plan.params, label: plan.label } as unknown as Action["params"],
  };
  const result = await host.applyAction(action);
  if (!result.success) return fail(result.error?.message ?? "audioRouting/set failed", result.error?.code ?? "ACTION_FAILED");
  return ok(plan.label, { actionId: action.id, busId: plan.busId, sendId: plan.sendId, ...data });
}

const timelineOf = (host: EditingHost) => host.getProject().timeline;

export const AUDIO_ROUTING_TOOLS: RegisteredTool[] = [
  {
    name: "set_track_automation",
    domain: "audio",
    title: "Set track fader / pan automation",
    description:
      "Replace one automation lane of an audio track: lane \"volume\" (linear gain 0..4, 1 = 0 dB) or \"pan\" (-1 left .. 1 right), points [{time (timeline seconds), value}]. The lane replaces the track fader / pan while it plays, in preview and in export. An empty array clears the lane. Read the current lanes from the track's automation field. One undo step.",
    inputSchema: obj({ trackId: str, lane: { type: "string", enum: ["volume", "pan"] }, points }, ["trackId", "lane", "points"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (!isTrackAutomationLane(args.lane)) return fail("lane must be 'volume' or 'pan'", "INVALID_PARAMS");
      if (!Array.isArray(args.points)) return fail("points must be an array", "INVALID_PARAMS");
      const list = pointList(args.points) ?? [];
      const plan = planSetTrackAutomation(timelineOf(host), String(args.trackId), args.lane, list);
      if (!plan.ok) return fail(plan.message, "INVALID_PARAMS");
      const action: Action = {
        type: "trackAutomation/set",
        id: genId(),
        timestamp: Date.now(),
        params: { trackId: plan.trackId, lane: plan.lane, points: plan.points } as unknown as Action["params"],
      };
      const result = await host.applyAction(action);
      if (!result.success) return fail(result.error?.message ?? "trackAutomation/set failed", result.error?.code ?? "ACTION_FAILED");
      return ok(plan.label, { actionId: action.id, trackId: plan.trackId, lane: plan.lane, points: plan.points ?? [] });
    },
  },
  {
    name: "create_bus",
    domain: "audio",
    title: "Create audio bus",
    description:
      "Add a submix bus to the Audio Track Mixer. Tracks route into it with set_track_output (or send to it with add_send); it has its own effect rack/fader (set_track_audio_effect_param with target = the bus id), mute/solo and automation, then plays into the master or another bus (output; loops are refused). role: general|dialogue|music|effects. With preset \"stems\" it instead creates the Dialogue / Music / FX buses and routes tracks by role/name. Returns busId. One undo step.",
    inputSchema: obj({
      name: str,
      role: { type: "string", enum: [...ROLES] },
      output: { ...str, description: 'Bus id this bus plays into; omit or "master" for the master.' },
      preset: { type: "string", enum: ["stems"] },
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (args.preset === "stems") {
        const result = await commit(host, planStemsPreset(timelineOf(host)));
        return result.ok ? { ...result, data: { ...(result.data as object), buses: getAudioBuses(timelineOf(host)).map((b) => ({ id: b.id, name: b.name })) } } : result;
      }
      return commit(
        host,
        planAddBus(timelineOf(host), {
          name: typeof args.name === "string" ? args.name : undefined,
          role: roleOf(args.role),
          output: typeof args.output === "string" ? args.output : undefined,
        }),
      );
    },
  },
  {
    name: "update_bus",
    domain: "audio",
    title: "Edit audio bus",
    description:
      "Edit a bus: name, role, muted, solo, output (another bus id or \"master\"; loops are refused) and/or volume automation points [{time (timeline s), value (linear gain 0..4)}] (empty array clears). Fader and effects use set_track_audio_effect_param / add_track_audio_effect with target = the bus id. One undo step.",
    inputSchema: obj(
      { busId: str, name: str, role: { type: "string", enum: [...ROLES] }, muted: bool, solo: bool, output: str, volumeAutomation: points },
      ["busId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const busId = String(args.busId);
      const timeline = timelineOf(host);
      if (args.output !== undefined) {
        // one action per call keeps one undo step: route first, other fields are separate edits
        if (["name", "role", "muted", "solo", "volumeAutomation"].some((k) => args[k] !== undefined)) {
          return fail("Change a bus's output in its own call (one undo step per edit).", "INVALID_PARAMS");
        }
        return commit(host, planSetBusOutput(timeline, busId, typeof args.output === "string" ? args.output : null));
      }
      if (args.volumeAutomation !== undefined) {
        if (["name", "role", "muted", "solo"].some((k) => args[k] !== undefined)) {
          return fail("Change volumeAutomation in its own call (one undo step per edit).", "INVALID_PARAMS");
        }
        const list = pointList(args.volumeAutomation) ?? [];
        return commit(host, planSetBusAutomation(timeline, busId, list.length ? list : null));
      }
      return commit(
        host,
        planUpdateBus(timeline, busId, {
          name: typeof args.name === "string" ? args.name : undefined,
          role: roleOf(args.role),
          muted: typeof args.muted === "boolean" ? args.muted : undefined,
          solo: typeof args.solo === "boolean" ? args.solo : undefined,
        }),
      );
    },
  },
  {
    name: "remove_bus",
    domain: "audio",
    title: "Remove audio bus",
    description:
      "Delete a bus. Tracks and buses that played into it are re-routed to its own output (or master) and sends to it are removed, all in one undo step.",
    inputSchema: obj({ busId: str }, ["busId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      return commit(host, planRemoveBus(timelineOf(host), String(args.busId)));
    },
  },
  {
    name: "set_track_output",
    domain: "audio",
    title: "Set track output",
    description:
      'Assign a track\'s main output to a bus (busId) or back to the master (busId omitted or "master"). Sends are separate (add_send). One undo step.',
    inputSchema: obj({ trackId: str, busId: { ...str, description: 'Bus id, or "master".' } }, ["trackId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      return commit(host, planSetTrackOutput(timelineOf(host), String(args.trackId), typeof args.busId === "string" ? args.busId : null));
    },
  },
  {
    name: "add_send",
    domain: "audio",
    title: "Add track send",
    description:
      "Add an aux send from a track to a bus. level is linear 0..4 (1 = 0 dB, default 1). preFader true taps before the track fader (ignores it), false (default) after it. Both respect track mute/solo. At most 6 sends per track, one per bus. Returns sendId. One undo step.",
    inputSchema: obj({ trackId: str, busId: str, level: num, preFader: bool }, ["trackId", "busId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      return commit(
        host,
        planAddSend(timelineOf(host), String(args.trackId), String(args.busId), {
          level: typeof args.level === "number" ? args.level : undefined,
          preFader: args.preFader === true,
        }),
      );
    },
  },
  {
    name: "set_send_level",
    domain: "audio",
    title: "Set send level",
    description:
      "Edit one send (trackId + sendId): level (linear 0..4), preFader, muted and/or automation points [{time (timeline s), value (linear 0..4)}] that replace the level while they play (empty array clears). removeSend true deletes the send. One undo step.",
    inputSchema: obj(
      { trackId: str, sendId: str, level: num, preFader: bool, muted: bool, automation: points, removeSend: bool },
      ["trackId", "sendId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const timeline = timelineOf(host);
      const trackId = String(args.trackId);
      const sendId = String(args.sendId);
      if (args.removeSend === true) return commit(host, planRemoveSend(timeline, trackId, sendId));
      const automation = args.automation === undefined ? undefined : (pointList(args.automation) ?? []);
      return commit(
        host,
        planSetSend(timeline, trackId, sendId, {
          level: typeof args.level === "number" ? args.level : undefined,
          preFader: typeof args.preFader === "boolean" ? args.preFader : undefined,
          muted: typeof args.muted === "boolean" ? args.muted : undefined,
          automation: automation === undefined ? undefined : automation.length ? automation : null,
        }),
      );
    },
  },
  {
    name: "export_stems",
    domain: "audio",
    title: "Export audio stems",
    description:
      "Export each bus (or the busIds given) as its own WAV stem in one go. A stem is the bus's post-fader output (its rack, fader, automation and everything routed or sent into it) over the whole timeline, before the master rack, so stems line up and re-sum. bitDepth 16 or 24 (default 24). Needs the live editor; the files are handed to the user (downloads). Read-only for the project.",
    inputSchema: obj({ busIds: { type: "array", items: str }, bitDepth: { type: "number", enum: [16, 24] } }),
    readOnly: true,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const bridge = host.stems;
      if (!bridge) return fail("Stem export needs the live editor's audio renderer.", "UNSUPPORTED_HOST");
      const busIds = Array.isArray(args.busIds) ? args.busIds.filter((id): id is string => typeof id === "string") : undefined;
      const known = new Set(getAudioBuses(timelineOf(host)).map((b) => b.id));
      const unknown = busIds?.find((id) => !known.has(id));
      if (unknown) return fail(`Bus not found: ${unknown}`, "BUS_NOT_FOUND");
      try {
        const files = await bridge.exportStems({ busIds, bitDepth: args.bitDepth === 16 ? 16 : 24 });
        return ok(`Exported ${files.length} stem${files.length === 1 ? "" : "s"}: ${files.map((f) => f.fileName).join(", ")}`, { files });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Stem export failed.", "EXPORT_FAILED");
      }
    },
  },
];
