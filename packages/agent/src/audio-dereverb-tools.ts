import type { Clip } from "@openreel/core/types/timeline";
import { planEnhanceSpeechChange, sanitizeEnhanceBalance } from "@openreel/core/audio/enhance/enhance-effect";
import { planReduceReverbAction, sanitizeReduceReverbAmount, sanitizeReduceReverbSensitivity } from "@openreel/core/audio/reverb/reverb-effect";
import type { RegisteredTool } from "./registry";
import type { EditingHost } from "./host";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Dereverberation and the Speech / Background balance for agents. Both edit the clip's own audio effects ("reduceReverb",
 * "enhanceSpeech"), every call is ONE undo step however many clips it touches, the effects are saved in the project, and the
 * heavy work happens once per source in the same cached off-thread jobs the preview and the export share.
 */

const str: JSONSchema = { type: "string" };
const num: JSONSchema = { type: "number" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: "object", properties, required, additionalProperties: true });
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const findClip = (host: EditingHost, clipId: string): Clip | undefined => {
  for (const track of host.getProject().timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
};

const collectIds = (args: Record<string, unknown>): string[] => {
  const ids = new Set<string>(Array.isArray(args.clipIds) ? args.clipIds.filter((id): id is string => typeof id === "string") : []);
  if (typeof args.clipId === "string" && args.clipId) ids.add(args.clipId);
  return [...ids];
};

export const AUDIO_DEREVERB_TOOLS: RegisteredTool[] = [
  {
    name: "reduce_reverb",
    domain: "audio",
    title: "Reduce Reverb",
    description:
      "Remove the late reverb tail from dialogue on-device (Premiere Essential Sound Reduce Reverb / Audition DeReverb style): weighted prediction error dereverberation plus a blind-RT60 late-reverb spectral stage. Adds or updates a 'reduceReverb' audio effect on clipIds/clipId as ONE undo step; amount 0-100 (default 60, how hard the tail is removed), sensitivity 0-100 (default 50, higher starts earlier and assumes more of the signal is reverb; strong settings can thin the voice); remove:true removes it. It cannot remove early reflections. Applied after spectral repair and before Enhance Speech, hosted plugins and the live chain (so Enhance Speech and the Speech / Background balance work on the dereverberated voice); computed once per source and setting and cached: the preview plays the original until ready, the export waits.",
    inputSchema: obj({ clipIds: { type: "array", items: str }, clipId: str, amount: num, sensitivity: num, remove: bool }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const ids = collectIds(args);
      if (ids.length === 0) return fail("Pass clipId or clipIds.");
      for (const key of ["amount", "sensitivity"] as const) {
        if (args[key] !== undefined && (typeof args[key] !== "number" || !Number.isFinite(args[key] as number))) return fail(`${key} must be a number from 0 to 100.`);
      }
      const clips = ids.map((id) => ({ id, clip: findClip(host, id) }));
      const missing = clips.find((entry) => !entry.clip);
      if (missing) return fail(`Clip not found: ${missing.id}`, "CLIP_NOT_FOUND");
      const change = args.remove === true ? null : {
        ...(args.amount !== undefined ? { amount: sanitizeReduceReverbAmount(args.amount) } : {}),
        ...(args.sensitivity !== undefined ? { sensitivity: sanitizeReduceReverbSensitivity(args.sensitivity) } : {}),
      };
      const txn = host.beginTransaction("Reduce Reverb");
      try {
        for (const { clip } of clips) {
          const action = clip && planReduceReverbAction(clip, change, { actionId: genId(), effectId: genId() });
          const result = action ? await host.applyAction(action) : { success: true };
          if (!result.success) throw new Error(result.error?.message ?? "Could not change Reduce Reverb");
        }
        await host.commitTransaction(txn, "Reduce Reverb");
      } catch (error) {
        await host.rollbackTransaction(txn);
        return fail(error instanceof Error ? error.message : "Could not change Reduce Reverb.", "REDUCE_REVERB_FAILED");
      }
      return ok(change === null ? "Removed Reduce Reverb." : `Reduce Reverb on ${ids.length} clip(s).`, { clipIds: ids, ...(change ?? {}), removed: change === null });
    },
  },
  {
    name: "set_speech_background_balance",
    domain: "audio",
    title: "Speech / Background balance",
    description:
      "Set the Speech / Background balance of Enhance Speech on clipIds/clipId as ONE undo step: balance 0-100, where 100 (default) is speech only, 50 is the original mix and 0 is background only. Background is what the on-device model took out (original minus enhanced, sample aligned); the cached enhancement is remixed, the model is never re-run. Adds Enhance Speech (mix 100) to a clip that has none. Independent of enhance_speech's mix, which blends the result with the original.",
    inputSchema: obj({ clipIds: { type: "array", items: str }, clipId: str, balance: num }, ["balance"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const ids = collectIds(args);
      if (ids.length === 0) return fail("Pass clipId or clipIds.");
      if (typeof args.balance !== "number" || !Number.isFinite(args.balance)) return fail("balance must be a number from 0 to 100.");
      const balance = sanitizeEnhanceBalance(args.balance);
      const clips = ids.map((id) => ({ id, clip: findClip(host, id) }));
      const missing = clips.find((entry) => !entry.clip);
      if (missing) return fail(`Clip not found: ${missing.id}`, "CLIP_NOT_FOUND");
      const txn = host.beginTransaction("Speech / Background balance");
      try {
        for (const { clip } of clips) {
          const action = clip && planEnhanceSpeechChange(clip, { balance }, { actionId: genId(), effectId: genId() });
          const result = action ? await host.applyAction(action) : { success: true };
          if (!result.success) throw new Error(result.error?.message ?? "Could not change the Speech / Background balance");
        }
        await host.commitTransaction(txn, "Speech / Background balance");
      } catch (error) {
        await host.rollbackTransaction(txn);
        return fail(error instanceof Error ? error.message : "Could not change the Speech / Background balance.", "BALANCE_FAILED");
      }
      return ok(`Speech / Background balance ${balance} on ${ids.length} clip(s).`, { clipIds: ids, balance });
    },
  },
];
