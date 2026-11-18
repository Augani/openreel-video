import type { Action } from "@openreel/core/types/actions";
import { planClipNormalization } from "@openreel/core/audio/loudness/clip-normalize";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Loudness tools (ITU-R BS.1770-4 / EBU R128). Measuring needs the live
 * editor's offline audio renderer, so it goes through the optional
 * `host.loudness` bridge; headless hosts fail clearly. Normalizing a clip
 * measures through the bridge and then dispatches ONE gain action, i.e. one
 * undo step, through the same action path the inspector uses.
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

const round = (value: number | null, digits = 2): number | null =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

const lufs = (value: number | null): string => (value === null ? "-inf" : value.toFixed(1));

export const LOUDNESS_TOOLS: RegisteredTool[] = [
  {
    name: "measure_loudness",
    domain: "audio",
    title: "Measure loudness",
    description:
      "Measure real loudness per ITU-R BS.1770-4 / EBU R128: integrated LUFS (gated), loudness range (LU, EBU Tech 3342), true peak (dBTP, 4x oversampled) and sample peak. scope \"timeline\" (default) renders the whole mix offline exactly as an export would (optional startTime/endTime in seconds); scope \"clip\" measures one clip (clipId) as it currently sounds, in isolation; scope \"bus\" measures one bus's stem (busId: its post-fader output including everything routed or sent into it). Read-only. Silence reports integratedLufs null.",
    inputSchema: obj({
      scope: { type: "string", enum: ["timeline", "clip", "bus"] },
      clipId: str,
      busId: str,
      startTime: num,
      endTime: num,
    }),
    readOnly: true,
    destructive: false,
    expensive: true,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      const bridge = host.loudness;
      if (!bridge) return fail("Loudness measurement needs the live editor's audio renderer.", "UNSUPPORTED_HOST");
      const scope = args.scope === "clip" ? "clip" : args.scope === "bus" ? "bus" : "timeline";
      try {
        if (scope === "bus") {
          if (typeof args.busId !== "string" || !args.busId) return fail("busId is required for scope bus.", "INVALID_PARAMS");
          if (!bridge.measureBus) return fail("Per-bus loudness needs the live editor.", "UNSUPPORTED_HOST");
          const m = await bridge.measureBus(args.busId);
          return ok(
            `Bus ${m.busId}: ${lufs(m.integratedLufs)} LUFS integrated, LRA ${m.loudnessRangeLu.toFixed(1)} LU, true peak ${lufs(m.truePeakDbtp)} dBTP.`,
            m,
          );
        }
        if (scope === "clip") {
          if (typeof args.clipId !== "string" || !args.clipId) return fail("clipId is required for scope \"clip\".", "INVALID_PARAMS");
          const m = await bridge.measureClip(args.clipId);
          return ok(
            `Clip ${m.clipId}: ${lufs(m.integratedLufs)} LUFS integrated, LRA ${m.loudnessRangeLu.toFixed(1)} LU, true peak ${lufs(m.truePeakDbtp)} dBTP.`,
            m,
          );
        }
        const range =
          typeof args.startTime === "number" && typeof args.endTime === "number"
            ? { startTime: args.startTime, endTime: args.endTime }
            : undefined;
        const m = await bridge.measureTimeline(range);
        return ok(
          `Timeline mix: ${lufs(m.integratedLufs)} LUFS integrated, LRA ${m.loudnessRangeLu.toFixed(1)} LU, true peak ${lufs(m.truePeakDbtp)} dBTP over ${m.durationSec.toFixed(1)} s.`,
          m,
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Loudness measurement failed.", "MEASURE_FAILED");
      }
    },
  },
  {
    name: "normalize_clip_loudness",
    domain: "audio",
    title: "Normalize clip loudness",
    description:
      "Measure a clip's integrated loudness (BS.1770-4) and set its clip gain so it lands on targetLufs (default -14; common targets: -14 streaming, -16 podcast/social, -23 EBU R128 broadcast). Clip gain is capped at +12 dB; the result says when the cap stopped it and where the true peak ends up. One undo step. Clips with volume automation have that automation scaled instead.",
    inputSchema: obj({ clipId: str, targetLufs: num }, ["clipId"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      const bridge = host.loudness;
      if (!bridge) return fail("Loudness measurement needs the live editor's audio renderer.", "UNSUPPORTED_HOST");
      if (typeof args.clipId !== "string" || !args.clipId) return fail("clipId is required.", "INVALID_PARAMS");
      const targetLufs = args.targetLufs === undefined ? -14 : Number(args.targetLufs);
      if (!Number.isFinite(targetLufs) || targetLufs < -40 || targetLufs > -5) {
        return fail("targetLufs must be between -40 and -5.", "INVALID_PARAMS");
      }
      try {
        const m = await bridge.measureClip(args.clipId);
        const clip = host
          .getProject()
          .timeline.tracks.flatMap((t) => t.clips)
          .find((c) => c.id === m.clipId);
        if (!clip) return fail(`Clip not found: ${m.clipId}`, "CLIP_NOT_FOUND");
        if (m.integratedLufs === null) {
          return ok("The clip is silent, so there is nothing to normalize.", { clipId: m.clipId, applied: false });
        }
        const plan = planClipNormalization(
          clip,
          { integrated: m.integratedLufs, truePeak: m.truePeakDbtp ?? -Infinity },
          targetLufs,
        );
        if (!plan.action) return fail("The clip gain could not be planned.", "PLAN_FAILED");
        const action = { ...plan.action, id: genId(), timestamp: Date.now() } as Action;
        const result = await host.applyAction(action);
        if (!result.success) {
          return fail(result.error?.message ?? "The clip gain could not be changed.", result.error?.code ?? "ACTION_FAILED");
        }
        const data = {
          clipId: m.clipId,
          applied: true,
          actionId: action.id,
          targetLufs,
          measuredLufs: round(m.integratedLufs),
          gainDb: round(plan.appliedGainDb),
          clamped: plan.clamped,
          resultingLufs: round(plan.resultingLufs),
          resultingTruePeakDbtp: round(plan.resultingTruePeakDb),
        };
        return ok(
          `Clip ${m.clipId} ${lufs(m.integratedLufs)} -> ${plan.resultingLufs.toFixed(1)} LUFS (${plan.appliedGainDb >= 0 ? "+" : ""}${plan.appliedGainDb.toFixed(1)} dB)${plan.clamped ? ", limited by the +12 dB clip gain cap" : ""}; true peak ${plan.resultingTruePeakDb.toFixed(1)} dBTP.`,
          data,
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Loudness normalization failed.", "MEASURE_FAILED");
      }
    },
  },
];
