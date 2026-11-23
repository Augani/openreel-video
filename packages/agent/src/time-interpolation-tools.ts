import { TIME_INTERPOLATION_MODES, effectiveTimeInterpolation, isTimeInterpolation } from "@openreel/core/video/time-interpolation/types";
import type { RegisteredTool } from "./registry";
import type { JSONSchema } from "./types";
import type { ToolResult } from "./types";

/**
 * Time Interpolation (Premiere: Frame Sampling, Frame Blending, Optical Flow) for slow motion, speed ramps and
 * frame-rate conform. Definitions only; this group loads lazily with the other domain groups.
 */
const str: JSONSchema = { type: "string" };
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const TIME_INTERPOLATION_TOOLS: RegisteredTool[] = [
  {
    name: "set_clip_time_interpolation",
    domain: "speed",
    title: "Set time interpolation",
    description:
      'Set how a video clip makes the frames between two source frames when it is slowed, ramped, reversed or conformed to another frame rate: "frameSampling" (default; repeats the nearest frame), "frameBlending" (blends the two nearest frames) or "opticalFlow" (motion-compensated in-between frames; heavy, best for slow motion). Optional quality "low" | "medium" | "high" tunes optical flow. Applies to clipId or clipIds. One undo step per call; preview and export render identically.',
    inputSchema: {
      type: "object",
      properties: {
        clipId: str,
        clipIds: { type: "array", items: str },
        mode: { type: "string", enum: [...TIME_INTERPOLATION_MODES] },
        quality: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["mode"],
      additionalProperties: true,
    },
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host): Promise<ToolResult> => {
      host.requireOpenProject();
      const mode = args.mode;
      if (!isTimeInterpolation(mode)) return fail(`mode must be one of ${TIME_INTERPOLATION_MODES.join(", ")}`);
      const quality = args.quality;
      if (quality !== undefined && quality !== "low" && quality !== "medium" && quality !== "high") return fail("quality must be low, medium or high");
      const ids = Array.isArray(args.clipIds) ? args.clipIds.filter((id): id is string => typeof id === "string") : typeof args.clipId === "string" ? [args.clipId] : [];
      if (ids.length === 0) return fail("Give clipId or clipIds.");
      const project = host.getProject();
      const clips = new Map(project.timeline.tracks.flatMap((t) => t.clips).map((c) => [c.id, c] as const));
      const media = new Map(project.mediaLibrary.items.map((m) => [m.id, m] as const));
      for (const id of ids) {
        const clip = clips.get(id);
        if (!clip) return fail(`Clip not found: ${id}`, "CLIP_NOT_FOUND");
        if (media.get(clip.mediaId)?.type !== "video") return fail(`Clip ${id} is not video footage; Time Interpolation applies to video clips.`);
      }
      const txn = host.beginTransaction("Set time interpolation");
      try {
        for (const id of ids) {
          if (effectiveTimeInterpolation(clips.get(id)!) !== mode) {
            const result = await host.applyAction({ type: "clip/setTimeInterpolation", id: genId(), timestamp: Date.now(), params: { clipId: id, timeInterpolation: mode } });
            if (!result.success) throw new Error(result.error?.message ?? "The clip could not be edited.");
          }
          if (quality !== undefined && clips.get(id)!.interpolationQuality !== quality) {
            const result = await host.applyAction({ type: "clip/setInterpolationQuality", id: genId(), timestamp: Date.now(), params: { clipId: id, interpolationQuality: quality } });
            if (!result.success) throw new Error(result.error?.message ?? "The clip could not be edited.");
          }
        }
        await host.commitTransaction(txn, "Set time interpolation");
      } catch (error) {
        await host.rollbackTransaction(txn);
        return fail(error instanceof Error ? error.message : "set_clip_time_interpolation failed", "ACTION_FAILED");
      }
      return ok(`time interpolation set to ${mode} on ${ids.length} clip${ids.length === 1 ? "" : "s"}`, { clipIds: ids, mode, quality });
    },
  },
  {
    name: "get_clip_time_interpolation",
    domain: "read",
    title: "Get time interpolation",
    description: "Read the Time Interpolation mode and Optical Flow quality of a clip.",
    inputSchema: { type: "object", properties: { clipId: str }, required: ["clipId"], additionalProperties: true },
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host): Promise<ToolResult> => {
      host.requireOpenProject();
      const id = args.clipId;
      const clip = typeof id === "string" ? host.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id) : undefined;
      if (!clip) return fail(`Clip not found: ${String(id)}`, "CLIP_NOT_FOUND");
      return ok("time interpolation", { clipId: clip.id, mode: effectiveTimeInterpolation(clip), quality: clip.interpolationQuality ?? "medium", speed: clip.speed ?? 1 });
    },
  },
];
