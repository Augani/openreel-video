import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";
import type { EditingHost } from "./host";
import { preflightOutputPath, type ExportRequestInput } from "./export-options";

/**
 * Image-sequence (PNG / JPEG frames in a zip) and animated-GIF export, the same engine paths as the
 * Export dialog's "Images & GIF" tab. Neither touches the project, so neither creates an undo step.
 */

const obj = (properties: Record<string, JSONSchema>): JSONSchema => ({ type: "object", properties, required: [], additionalProperties: true });
const num: JSONSchema = { type: "number" };
const str: JSONSchema = { type: "string" };

const bad = (message: string, hint?: string): ToolResult => ({
  ok: false,
  summary: hint ? `${message} ${hint}` : message,
  error: { code: "INVALID_PARAMS", message, ...(hint ? { hint } : {}) },
});

const RANGE_PROPS: Record<string, JSONSchema> = {
  rangeStart: { ...num, description: "Start of the span to export, in timeline seconds (default 0). Pass together with rangeEnd." },
  rangeEnd: { ...num, description: "End of the span (exclusive), in timeline seconds. Must be after rangeStart." },
};
const OUTPUT_PROPS: Record<string, JSONSchema> = {
  outputPath: { ...str, description: "Absolute destination file, inside the allowed folders (get_app_state mcp.allowedRoots). Omit to keep the app's own output file; data.path says where." },
  overwrite: { type: "boolean", description: "Replace an existing file at outputPath (default false)." },
};

type Parsed<T> = { ok: true; value: T } | { ok: false; result: ToolResult };

function int(args: Record<string, unknown>, key: string, min: number, max: number): Parsed<number | undefined> {
  const value = args[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, result: bad(`${key} must be a whole number from ${min} to ${max}.`) };
  }
  return { ok: true, value };
}

function range(args: Record<string, unknown>): Parsed<{ startTime: number; endTime: number } | undefined> {
  const { rangeStart, rangeEnd } = args;
  if (rangeStart === undefined && rangeEnd === undefined) return { ok: true, value: undefined };
  if (typeof rangeStart !== "number" || typeof rangeEnd !== "number" || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
    return { ok: false, result: bad("Pass both rangeStart and rangeEnd as numbers, or neither.") };
  }
  if (rangeStart < 0 || rangeEnd <= rangeStart) return { ok: false, result: bad("rangeStart must be >= 0 and rangeEnd must be greater than rangeStart.") };
  return { ok: true, value: { startTime: rangeStart, endTime: rangeEnd } };
}

async function output(args: Record<string, unknown>, host: EditingHost): Promise<{ ok: true; params: Record<string, unknown> } | { ok: false; result: ToolResult }> {
  if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") return { ok: false, result: bad("overwrite must be a boolean.") };
  if (args.outputPath === undefined) {
    if (args.overwrite !== undefined) return { ok: false, result: bad("overwrite only applies together with outputPath.") };
    return { ok: true, params: {} };
  }
  if (typeof args.outputPath !== "string" || !args.outputPath.trim()) return { ok: false, result: bad("outputPath must be a non-empty absolute path.") };
  const request: ExportRequestInput = { outputPath: args.outputPath.trim(), overwrite: args.overwrite === true };
  const problem = await preflightOutputPath(host, request);
  if (problem) {
    return { ok: false, result: { ok: false, summary: `${problem.message} ${problem.hint}`, error: { code: problem.code, message: problem.message, hint: problem.hint } } };
  }
  return { ok: true, params: { outputPath: request.outputPath, overwrite: request.overwrite === true } };
}

function hasOpenProject(host: EditingHost): boolean {
  try {
    host.requireOpenProject();
    return true;
  } catch {
    return false;
  }
}

const noProject = (): ToolResult => ({
  ok: false,
  summary: "No project is open. Call create_project or open_project_file first.",
  error: { code: "NO_PROJECT", message: "No project is open", hint: "Call create_project or open_project_file first." },
});

async function runStill(host: EditingHost, kind: "exportImageSequence" | "exportGif", params: Record<string, unknown>): Promise<ToolResult> {
  const result = await host.runJob(kind, params);
  if (!result.ok) {
    const message = result.error ?? `${kind} job failed`;
    return {
      ok: false,
      summary: result.hint ? `${message} ${result.hint}` : message,
      error: { code: result.code ?? "JOB_FAILED", message, ...(result.hint ? { hint: result.hint } : {}) },
    };
  }
  return { ok: true, summary: `${kind} job complete`, data: result.data };
}

export const EXPORT_IMAGE_SEQUENCE_TOOL: RegisteredTool = {
  name: "export_image_sequence",
  domain: "export",
  title: "Export image sequence",
  description:
    "Render frames of the project as numbered PNG or JPEG files delivered as one zip and wait for it. format png (default, lossless) | jpg, quality 1-100 (jpg only), width/height (default the project's), rangeStart/rangeEnd (timeline seconds, end exclusive; default the whole timeline) and pattern (file name with a zero-padded counter, e.g. 'frame_{0000}' -> frame_0042.png; default frame_{0000}), startNumber (added to the project frame index; default 0). One file per project frame, at most 5000 frames and about 1 GB: use a range for longer timelines. Result data: path, filename, bytes, frames, format. Not an edit: no undo step. Expensive: requires confirmation.",
  inputSchema: obj({
    format: { ...str, enum: ["png", "jpg"] },
    quality: num,
    width: num,
    height: num,
    ...RANGE_PROPS,
    pattern: str,
    startNumber: num,
    ...OUTPUT_PROPS,
  }),
  readOnly: false,
  destructive: false,
  expensive: true,
  handler: async (args, host) => {
    if (!hasOpenProject(host)) return noProject();
    const params: Record<string, unknown> = {};
    if (args.format !== undefined) {
      if (args.format !== "png" && args.format !== "jpg") return bad("format must be png or jpg.");
      params.format = args.format;
    }
    for (const [key, min, max] of [["quality", 1, 100], ["width", 2, 16384], ["height", 2, 16384], ["startNumber", 0, 99_999_999]] as const) {
      const parsed = int(args, key, min, max);
      if (!parsed.ok) return parsed.result;
      if (parsed.value !== undefined) params[key] = parsed.value;
    }
    if (args.pattern !== undefined) {
      if (typeof args.pattern !== "string" || !args.pattern.trim() || args.pattern.length > 100) return bad("pattern must be a non-empty string of at most 100 characters.", "Example: frame_{0000}");
      params.pattern = args.pattern.trim();
    }
    const span = range(args);
    if (!span.ok) return span.result;
    if (span.value) params.range = span.value;
    const out = await output(args, host);
    if (!out.ok) return out.result;
    if (typeof out.params.outputPath === "string" && !/\.zip$/i.test(out.params.outputPath)) {
      return bad("outputPath must end in .zip for an image sequence.", "Rename the destination to end in .zip.");
    }
    return runStill(host, "exportImageSequence", { ...params, ...out.params });
  },
};

export const EXPORT_GIF_TOOL: RegisteredTool = {
  name: "export_gif",
  domain: "export",
  title: "Export animated GIF",
  description:
    "Render the project (or a span) as an animated GIF and wait for it. fps 1-50 (default 15; GIF delays are whole centiseconds, so the real rate is 100/round(100/fps), e.g. 15 -> 14.29, and frames are sampled at that rate so the duration stays true), width/height (default the project's size scaled to at most 640 wide), maxColors 2-256 (one global palette, default 256), loop 0 = forever (default) | n = n plays | 'none' = play once, rangeStart/rangeEnd (timeline seconds, end exclusive). Limits: 4096 px a side, 1500 frames and about 768 MB of frame pixels. Result data: path, filename, bytes, frames. Not an edit: no undo step. Expensive: requires confirmation.",
  inputSchema: obj({
    fps: num,
    width: num,
    height: num,
    maxColors: num,
    loop: { description: "0 = forever, n = n plays, 'none' = once." },
    ...RANGE_PROPS,
    ...OUTPUT_PROPS,
  }),
  readOnly: false,
  destructive: false,
  expensive: true,
  handler: async (args, host) => {
    if (!hasOpenProject(host)) return noProject();
    const params: Record<string, unknown> = {};
    if (args.fps !== undefined) {
      if (typeof args.fps !== "number" || !Number.isFinite(args.fps) || args.fps < 1 || args.fps > 50) return bad("fps must be a number from 1 to 50.");
      params.fps = args.fps;
    }
    for (const [key, min, max] of [["width", 1, 4096], ["height", 1, 4096], ["maxColors", 2, 256]] as const) {
      const parsed = int(args, key, min, max);
      if (!parsed.ok) return parsed.result;
      if (parsed.value !== undefined) params[key] = parsed.value;
    }
    if (args.loop !== undefined) {
      if (args.loop !== "none" && !(typeof args.loop === "number" && Number.isInteger(args.loop) && args.loop >= 0 && args.loop <= 65535)) {
        return bad("loop must be 0 (forever), a play count up to 65535, or 'none'.");
      }
      params.loop = args.loop;
    }
    const span = range(args);
    if (!span.ok) return span.result;
    if (span.value) params.range = span.value;
    const out = await output(args, host);
    if (!out.ok) return out.result;
    if (typeof out.params.outputPath === "string" && !/\.gif$/i.test(out.params.outputPath)) {
      return bad("outputPath must end in .gif for a GIF export.", "Rename the destination to end in .gif.");
    }
    return runStill(host, "exportGif", { ...params, ...out.params });
  },
};

export const STILL_EXPORT_TOOLS: RegisteredTool[] = [EXPORT_IMAGE_SEQUENCE_TOOL, EXPORT_GIF_TOOL];
