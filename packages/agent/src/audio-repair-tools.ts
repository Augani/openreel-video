import type { Action } from "@openreel/core/types/actions";
import type { Effect } from "@openreel/core/types/timeline";
import {
  REPAIR_EFFECT_DEFINITIONS,
  sanitizeRepairParams,
} from "@openreel/core/audio/repair/repair-definitions";
import { REPAIR_EFFECT_TYPES, isRepairEffectType, type RepairEffectType } from "@openreel/core/audio/repair/repair-dsp";
import { getAudioBuses } from "@openreel/core/audio/audio-routing";
import {
  listEffectLatencies,
  planTimelineDelayCompensation,
  rackLatencySamples,
} from "@openreel/core/audio/effect-latency";
import type { RegisteredTool } from "./registry";
import type { EditingHost } from "./host";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Audio repair: detect problems in dialogue (hum, clipping, clicks, sibilance)
 * and add the repair effects that fix them to a clip, plus stems as a queued
 * job. add_audio_repair is ONE undo step however many effects it adds.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
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

const findClip = (host: EditingHost, clipId: string) => {
  for (const track of host.getProject().timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const TYPE_LIST = REPAIR_EFFECT_TYPES.join(" | ");

export const AUDIO_REPAIR_TOOLS: RegisteredTool[] = [
  {
    name: "get_audio_latency_report",
    domain: "audio",
    title: "Audio effect latency report",
    description:
      "Report the processing latency of lookahead/FFT audio effects (compressor, limiter, DeClick, DeClip, DeReverb and the zero-latency repair effects) and what the project's mixer adds. data.effects lists each effect's latency in samples and ms; data.tracks lists each track's rack latency and the compensation delay the graph inserts so parallel tracks and buses stay aligned; data.totalLatencyMs is how late the whole mix leaves the graph before offline renders and the realtime scheduler compensate it. Compensation is automatic, so a click stays on the same sample as the picture; this is for diagnosing and explaining. Read-only.",
    inputSchema: obj({ sampleRate: num }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const rate = typeof args.sampleRate === "number" && args.sampleRate >= 8000 ? args.sampleRate : project.settings.sampleRate || 48000;
      const plan = planTimelineDelayCompensation(project.timeline, rate);
      const ms = (seconds: number) => Math.round(seconds * 1e6) / 1e3;
      const tracks = project.timeline.tracks.map((track) => {
        const samples = rackLatencySamples(track.audioRack, rate);
        return { trackId: track.id, name: track.name, latencyMs: ms(samples / rate), compensationDelayMs: ms(plan.trackDelay.get(track.id) ?? 0) };
      });
      const masterSamples = rackLatencySamples(project.timeline.masterAudioRack, rate);
      const totalLatencyMs = ms(plan.masterLatency + masterSamples / rate);
      return ok(`Mixer latency ${totalLatencyMs} ms, compensated automatically.`, {
        sampleRate: rate,
        effects: listEffectLatencies(rate),
        tracks,
        masterRackLatencyMs: ms(masterSamples / rate),
        totalLatencyMs,
      });
    },
  },
  {
    name: "analyze_audio_issues",
    domain: "audio",
    title: "Analyze audio issues",
    description:
      "Analyze a clip's audio (as it sounds before any repair effects) for mains hum (50/60 Hz and harmonics), clipping, clicks and harsh sibilance. Returns data.report (hum {present, frequency, prominenceDb, harmonics}, clipping {present, runs, clippedSamples, peak}, clicks {present, count, perMinute}, sibilance {present, centerHz, thresholdDb, fraction}, peakDb) and data.suggestions: the repair effects (type + params + reason) that would address what was found. Read-only; needs the live editor's audio decoder. Use add_audio_repair to apply.",
    inputSchema: obj({ clipId: str }, ["clipId"]),
    readOnly: true,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.", "INVALID_PARAMS");
      if (!findClip(host, clipId)) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const bridge = host.audioRepair;
      if (!bridge) return fail("Audio analysis needs the live editor's audio decoder.", "UNSUPPORTED_HOST");
      try {
        const { report, suggestions } = await bridge.analyze(clipId);
        const found = [
          report.hum.present && `hum ${report.hum.frequency} Hz`,
          report.clipping.present && `clipping (${report.clipping.runs} peaks)`,
          report.clicks.present && `${report.clicks.count} clicks`,
          report.sibilance.present && "harsh sibilance",
        ].filter(Boolean);
        return ok(found.length ? `Found: ${found.join(", ")}.` : "No hum, clipping, clicks or harsh sibilance found.", {
          clipId,
          report,
          suggestions,
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Analysis failed.", "ANALYSIS_FAILED");
      }
    },
  },
  {
    name: "add_audio_repair",
    domain: "audio",
    title: "Add audio repair",
    description: `Add repair effects to a clip as ONE undo step. auto:true (the default when no fixes are given) analyzes the clip and adds only what it found (hum, clipping, clicks, sibilance), with the suggested settings. fixes: explicit effect types to add (${TYPE_LIST}) with their default or given params (params: {deHum: {frequency: 50, harmonics: 4}, deEss: {threshold: -28}}; ranges in get_capabilities / the effect definitions: deHum frequency 40-70 Hz, harmonics 1-8, q 5-100, depth 0-1; deClick sensitivity 0-1, maxWidth 2-48 samples; deClip threshold -24..0 dBFS, maxRun 4-120; deEss frequency 2500-12000 Hz, threshold -60..0 dB, ratio 1-20, listen 0/1; deReverb amount 0-1, rt60 0.1-3 s, floor -40..0 dB; gate threshold -80..0 dB, range -80..0 dB, hold 0-1 s; brickwallLimiter ceiling -24..0 dBTP, release 0.01-1 s (5 ms lookahead, true-peak safe); lowPass frequency 100-20000 Hz, slope 12-48 dB/oct). A repair effect already on the clip is updated instead of duplicated. DeReverb is experimental (reduces the late tail only, adds ~21 ms latency). The same effects can sit on a track/bus rack via set_track_audio_rack. Returns data.added with each effect id, type, params and reason.`,
    inputSchema: obj(
      {
        clipId: str,
        auto: bool,
        fixes: { type: "array", items: { type: "string", enum: [...REPAIR_EFFECT_TYPES] } },
        params: { type: "object" },
      },
      ["clipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const clipId = typeof args.clipId === "string" ? args.clipId : "";
      if (!clipId) return fail("clipId is required.", "INVALID_PARAMS");
      const clip = findClip(host, clipId);
      if (!clip) return fail(`Clip not found: ${clipId}`, "CLIP_NOT_FOUND");
      const fixes: RepairEffectType[] = [];
      if (args.fixes !== undefined) {
        if (!Array.isArray(args.fixes)) return fail("fixes must be an array of effect types.", "INVALID_PARAMS");
        for (const entry of args.fixes) {
          if (!isRepairEffectType(entry)) return fail(`Unknown repair effect '${String(entry)}'. Use ${TYPE_LIST}.`, "INVALID_PARAMS");
          if (!fixes.includes(entry)) fixes.push(entry);
        }
      }
      const overrides = asRecord(args.params) ?? {};
      const auto = args.auto === true || (args.auto === undefined && fixes.length === 0);

      const plan = new Map<RepairEffectType, { params: Record<string, number>; reason: string }>();
      let analysis: unknown;
      if (auto) {
        const bridge = host.audioRepair;
        if (!bridge) return fail("Auto-detect needs the live editor's audio decoder; pass fixes explicitly instead.", "UNSUPPORTED_HOST");
        try {
          const result = await bridge.analyze(clipId);
          analysis = result.report;
          for (const suggestion of result.suggestions) {
            plan.set(suggestion.type, { params: suggestion.params, reason: suggestion.reason });
          }
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Analysis failed.", "ANALYSIS_FAILED");
        }
      }
      for (const type of fixes) {
        if (!plan.has(type)) plan.set(type, { params: {}, reason: "requested" });
      }
      if (plan.size === 0) {
        return ok("Nothing to repair: no hum, clipping, clicks or harsh sibilance found.", { clipId, added: [], analysis });
      }

      const existing = new Map<string, Effect>(
        (clip.audioEffects ?? []).filter((effect) => isRepairEffectType(effect.type)).map((effect) => [effect.type, effect]),
      );
      const txn = host.beginTransaction("Repair audio");
      const added: Array<{ effectId: string; type: string; params: Record<string, number>; reason: string; updated: boolean }> = [];
      try {
        for (const [type, item] of plan) {
          const params = sanitizeRepairParams(type, { ...item.params, ...(asRecord(overrides[type]) ?? {}) });
          const prior = existing.get(type);
          const action: Action = prior
            ? { type: "audio/updateEffect", id: genId(), timestamp: Date.now(), params: { clipId, effectId: prior.id, params } }
            : {
                type: "audio/addEffect",
                id: genId(),
                timestamp: Date.now(),
                params: { clipId, effect: { id: genId(), type, enabled: true, params } },
              };
          const result = await host.applyAction(action);
          if (!result.success) throw new Error(result.error?.message ?? `Could not add ${REPAIR_EFFECT_DEFINITIONS[type].label}`);
          const effectId = prior ? prior.id : (action.params as { effect: Effect }).effect.id;
          if (prior && !prior.enabled) {
            await host.applyAction({ type: "audio/toggleEffect", id: genId(), timestamp: Date.now(), params: { clipId, effectId, enabled: true } });
          }
          added.push({ effectId, type, params, reason: item.reason, updated: Boolean(prior) });
        }
        await host.commitTransaction(txn, "Repair audio");
      } catch (error) {
        await host.rollbackTransaction(txn);
        return fail(error instanceof Error ? error.message : "Could not add the repairs.", "REPAIR_FAILED");
      }
      return ok(
        `Added ${added.length} repair effect${added.length === 1 ? "" : "s"} to the clip: ${added.map((a) => REPAIR_EFFECT_DEFINITIONS[a.type as RepairEffectType].label).join(", ")}.`,
        { clipId, added, analysis },
      );
    },
  },
  {
    name: "queue_stems_export",
    domain: "export",
    title: "Queue stems export",
    description:
      "Add a stems job to the export queue (Export queue panel > Stems) and, unless start=false, start the queue. The job snapshots the project now; when it runs it renders each selected bus (busIds; default every bus that carries audio) as its own WAV through the export mixdown, all full-length and sample-aligned so they re-sum in a DAW, and bundles them in one zip. bitDepth 16 or 24 (default 24); filename overrides the zip name. Returns data.jobId; poll list_export_jobs, where a finished stems job lists data.jobs[].stems (one entry per WAV with fileName, bytes, durationSec). Not an edit: no undo step. Expensive - requires confirmation.",
    inputSchema: obj({ busIds: { type: "array", items: str }, bitDepth: { type: "number", enum: [16, 24] }, filename: str, start: bool }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const bridge = host.exportQueue;
      if (typeof bridge?.enqueueStems !== "function") {
        return fail("Stems jobs need the live editor's export queue.", "UNSUPPORTED_HOST");
      }
      const busIds = Array.isArray(args.busIds) ? args.busIds.filter((id): id is string => typeof id === "string") : undefined;
      const known = new Set(getAudioBuses(host.getProject().timeline).map((b) => b.id));
      const unknown = busIds?.find((id) => !known.has(id));
      if (unknown) return fail(`Bus not found: ${unknown}`, "BUS_NOT_FOUND");
      if (args.bitDepth !== undefined && args.bitDepth !== 16 && args.bitDepth !== 24) {
        return fail("bitDepth must be 16 or 24.", "INVALID_PARAMS");
      }
      try {
        const job = await bridge.enqueueStems({
          busIds,
          bitDepth: args.bitDepth === 16 ? 16 : 24,
          filename: typeof args.filename === "string" && args.filename.trim() ? args.filename.trim() : undefined,
          start: args.start === false ? false : true,
        });
        return ok(`Queued stems job ${job.outputName} (${job.presetLabel})`, { jobId: job.id, job });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Could not queue the stems export.", "QUEUE_FAILED");
      }
    },
  },
];

void num;
