import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Motion tracking tools. Tracking decodes real frames and runs the tracker in a worker, so it needs
 * the live editor; headless hosts fail clearly. A track is stored on the source clip. Tracking and
 * every later change to the path (re-track, point correction) are ONE undo step each, and anything
 * attached to the path follows inside that same step.
 */

const num: JSONSchema = { type: "number" };
const str: JSONSchema = { type: "string" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({ ok: false, summary: message, error: { code, message } });
const UNSUPPORTED = "Motion tracking needs the live editor's decoder and is not available on this host.";
const ALGORITHMS = ["correlation", "optical-flow", "feature"] as const;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function region(value: unknown): { x: number; y: number; width: number; height: number } | null | undefined {
  if (value === undefined) return undefined;
  const r = value as Record<string, unknown> | null;
  if (!r || !finite(r.x) || !finite(r.y) || !finite(r.width) || !finite(r.height) || r.width <= 0 || r.height <= 0) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export const MOTION_TRACKING_TOOLS: RegisteredTool[] = [
  {
    name: "track_motion",
    domain: "motion",
    title: "Track motion",
    description:
      "Follow a target through a video or image clip (Inspector > Motion Tracking > Start Tracking). clipId is the SOURCE clip; region {x,y,width,height} is the target in SOURCE pixels at anchorFrame (omit for the central half of the frame). Without anchorFrame the whole clip is tracked forward from frame 0. With anchorFrame (clip-local frame at project fps) set direction forward or backward to track from that frame; merge:true keeps the rest of an existing path (re-track part of it). The tracker measures per-frame confidence, re-finds the target against its reference appearance after drift, predicts through occlusion with its last velocity (those frames are reported as lost), and resumes when the target returns. Returns frames, lostFrames, lowConfidence runs, manualFrames and frames/s. Stored on the clip as ONE undo step; anything already attached follows the new path. Use attach_track to make a clip, text, shape, sticker or svg follow it.",
    inputSchema: obj(
      {
        clipId: str,
        region: obj({ x: num, y: num, width: num, height: num }, ["x", "y", "width", "height"]),
        anchorFrame: num,
        direction: { type: "string", enum: ["forward", "backward"] },
        algorithm: { type: "string", enum: [...ALGORITHMS] },
        confidenceThreshold: num,
        merge: bool,
      },
      ["clipId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.motionTracking) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      if (typeof args.clipId !== "string" || !args.clipId) return fail("clipId is required.");
      const target = region(args.region);
      if (target === null) return fail("region needs finite x, y and positive width, height (source pixels).");
      if (args.anchorFrame !== undefined && (!Number.isInteger(args.anchorFrame) || (args.anchorFrame as number) < 0)) return fail("anchorFrame must be a non-negative integer frame.");
      if (args.direction !== undefined && args.direction !== "forward" && args.direction !== "backward") return fail("direction must be forward or backward.");
      if (args.algorithm !== undefined && !(ALGORITHMS as readonly unknown[]).includes(args.algorithm)) return fail(`algorithm must be one of ${ALGORITHMS.join(", ")}.`);
      if (args.confidenceThreshold !== undefined && (!finite(args.confidenceThreshold) || args.confidenceThreshold <= 0 || args.confidenceThreshold > 1)) return fail("confidenceThreshold must be in (0, 1].");
      try {
        const summary = await host.motionTracking.track({
          clipId: args.clipId, region: target, anchorFrame: args.anchorFrame as number | undefined,
          direction: args.direction as "forward" | "backward" | undefined, algorithm: args.algorithm as (typeof ALGORITHMS)[number] | undefined,
          confidenceThreshold: args.confidenceThreshold as number | undefined, merge: args.merge === true,
        });
        return ok(
          `Tracked ${summary.frames} frame${summary.frames === 1 ? "" : "s"}${summary.lostFrames ? `, ${summary.lostFrames} low-confidence` : ""}${summary.framesPerSecond ? ` at ${summary.framesPerSecond.toFixed(0)} frames/s` : ""}.`,
          summary,
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Tracking failed", "TRACKING_FAILED");
      }
    },
  },
  {
    name: "attach_track",
    domain: "motion",
    title: "Attach track",
    description:
      "Make a clip, text, shape, sticker or svg follow a tracked path (Inspector > Motion Tracking > Apply Tracking). clipId is the tracked SOURCE clip (run track_motion first); targetId is what should move. mode follow (default) moves the target by the path's movement; pin places it on the tracked point plus offset {x,y} in project pixels. applyScale / applyRotation (default true) also follow the target's size and turn; smoothing 0..10 averages the path. Writes position/scale/rotation keyframes on the target as ONE undo step, and re-running it updates the same attachment.",
    inputSchema: obj(
      { clipId: str, targetId: str, mode: { type: "string", enum: ["follow", "pin"] }, offset: obj({ x: num, y: num }), applyScale: bool, applyRotation: bool, smoothing: num },
      ["clipId", "targetId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.motionTracking) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      if (typeof args.clipId !== "string" || typeof args.targetId !== "string" || !args.clipId || !args.targetId) return fail("clipId and targetId are required.");
      if (args.mode !== undefined && args.mode !== "follow" && args.mode !== "pin") return fail("mode must be follow or pin.");
      const offset = args.offset as { x?: unknown; y?: unknown } | undefined;
      if (offset !== undefined && (!offset || !finite(offset.x) || !finite(offset.y))) return fail("offset needs finite x and y.");
      if (args.smoothing !== undefined && (!finite(args.smoothing) || args.smoothing < 0 || args.smoothing > 10)) return fail("smoothing must be between 0 and 10.");
      try {
        const result = await host.motionTracking.attach({
          clipId: args.clipId, targetId: args.targetId, mode: args.mode as "follow" | "pin" | undefined,
          offset: offset ? { x: offset.x as number, y: offset.y as number } : undefined,
          applyScale: args.applyScale === undefined ? undefined : args.applyScale === true,
          applyRotation: args.applyRotation === undefined ? undefined : args.applyRotation === true,
          smoothing: args.smoothing as number | undefined,
        });
        return ok(`Attached ${args.targetId} to the track of ${args.clipId} (${result.keyframes} keyframes).`, result);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Could not attach the track", "ATTACH_FAILED");
      }
    },
  },
  {
    name: "correct_track_point",
    domain: "motion",
    title: "Correct tracked point",
    description:
      "Set the tracked point at one frame by hand (Inspector > Motion Tracking > Set point). clipId is the tracked source clip, frame is clip-local at project fps, x and y are SOURCE pixels. The point becomes full confidence and is no longer counted as lost; anything attached follows. ONE undo step. Use get_motion_track to find low-confidence frames first.",
    inputSchema: obj({ clipId: str, frame: num, x: num, y: num }, ["clipId", "frame", "x", "y"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.motionTracking) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      if (typeof args.clipId !== "string" || !args.clipId) return fail("clipId is required.");
      if (!Number.isInteger(args.frame) || (args.frame as number) < 0) return fail("frame must be a non-negative integer.");
      if (!finite(args.x) || !finite(args.y)) return fail("x and y must be finite source pixels.");
      try {
        const summary = await host.motionTracking.correct(args.clipId, args.frame as number, { x: args.x, y: args.y });
        return ok(`Set the point at frame ${args.frame}.`, summary);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Could not correct the point", "TRACKING_FAILED");
      }
    },
  },
  {
    name: "get_motion_track",
    domain: "motion",
    title: "Get motion track",
    description:
      "Summarise the saved motion track of a source clip: frame range, how many frames are low confidence, the runs of hidden or weak frames (candidates for track_motion with anchorFrame + merge, or correct_track_point), hand-set frames and the first and last point. Returns null data when the clip has no valid track (never tracked, or its source changed).",
    inputSchema: obj({ clipId: str }, ["clipId"]),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host: EditingHost) => {
      host.requireOpenProject();
      if (!host.motionTracking) return fail(UNSUPPORTED, "UNSUPPORTED_HOST");
      if (typeof args.clipId !== "string" || !args.clipId) return fail("clipId is required.");
      const summary = host.motionTracking.summary(args.clipId);
      return summary ? ok(`${summary.frames} tracked frames, ${summary.lostFrames} low confidence.`, summary) : ok("This clip has no valid motion track.", null);
    },
  },
];
