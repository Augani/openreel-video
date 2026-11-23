import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Premiere-style preview render ("Render In to Out"). Rendered frames are
 * cached and played back instead of re-running the effects each frame; the
 * cache is invalidated per range by edits and is not part of the project, so
 * none of these tools create undo steps.
 */

const num: JSONSchema = { type: "number" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "ERROR"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});

const UNSUPPORTED = "render cache is not supported by this host (needs the live editor)";

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const RENDER_CACHE_TOOLS: RegisteredTool[] = [
  {
    name: "render_in_to_out",
    domain: "export",
    title: "Render In to Out",
    description:
      "Render the timeline's In/Out range (or the whole sequence when none is marked) into the preview render cache so effects, transitions and grades play back at full frame rate. Optional rangeStart/rangeEnd (seconds, start<end) render that span instead. Set effectsOnly to render only the stretches that carry effects, transitions, grades or layers (Render Effects In to Out; plain media is skipped). Frames already cached are skipped; render files persist across app restarts and only edited ranges are re-rendered. Returns data.status (completed|canceled|failed), framesRendered, framesSkipped, elapsedMs and the codec. Not an edit: no undo step. Expensive — requires confirmation.",
    inputSchema: obj({ rangeStart: num, rangeEnd: num, effectsOnly: { type: "boolean" } }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      if (typeof host.renderCache?.renderInToOut !== "function") return fail(UNSUPPORTED, "UNSUPPORTED");
      host.requireOpenProject();
      const rangeStart = optionalNumber(args.rangeStart);
      const rangeEnd = optionalNumber(args.rangeEnd);
      if ((rangeStart === undefined) !== (rangeEnd === undefined)) {
        return fail("Pass both rangeStart and rangeEnd, or neither.", "INVALID_PARAMS");
      }
      if (rangeStart !== undefined && rangeEnd !== undefined) {
        if (rangeStart < 0 || rangeEnd <= rangeStart) {
          return fail("rangeStart must be >= 0 and rangeEnd must be greater than rangeStart.", "INVALID_PARAMS");
        }
      }
      const effectsOnly = args.effectsOnly === true;
      const result = await host.renderCache.renderInToOut(
        rangeStart !== undefined && rangeEnd !== undefined
          ? { rangeStart, rangeEnd, ...(effectsOnly ? { effectsOnly } : {}) }
          : effectsOnly
            ? { effectsOnly }
            : undefined,
      );
      if (result.status === "failed") {
        return fail(result.message ?? "Render failed", "RENDER_FAILED");
      }
      return ok(
        result.status === "completed"
          ? `Rendered ${result.framesRendered} frame(s) (${result.framesSkipped} already cached) in ${(result.elapsedMs / 1000).toFixed(1)}s`
          : `Render canceled after ${result.framesRendered} frame(s)`,
        { ...result },
      );
    },
  },
  {
    name: "delete_render_files",
    domain: "export",
    title: "Delete render files",
    description:
      "Delete every cached preview render (Sequence > Delete render files). Playback of those segments goes back to live rendering. Cancels a running render first. Returns data.removedFrames. The project is unchanged: no undo step.",
    inputSchema: obj({}),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.renderCache?.deleteRenderFiles !== "function") return fail(UNSUPPORTED, "UNSUPPORTED");
      const { removedFrames } = await host.renderCache.deleteRenderFiles();
      return ok(`Deleted ${removedFrames} cached frame(s)`, { removedFrames });
    },
  },
  {
    name: "get_render_status",
    domain: "export",
    title: "Get render status",
    description:
      "Report the render-status bar: data.segments lists timeline stretches as cached (green: plays from the render cache), light (yellow: needs a render but likely plays in real time) or heavy (red: effects-heavy, unlikely to play in real time); plain media is omitted. Also data.cachedRanges (seconds), frameCount, bytes and whether a render is running. Read-only.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (_args, host) => {
      if (typeof host.renderCache?.getStatus !== "function") return fail(UNSUPPORTED, "UNSUPPORTED");
      const status = host.renderCache.getStatus();
      return ok(
        `${status.frameCount} cached frame(s); ${status.segments.filter((s) => s.level === "heavy").length} heavy segment(s)`,
        { ...status },
      );
    },
  },
];
