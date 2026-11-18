import type { Action } from "@openreel/core/types/actions";
import type { Subtitle, SubtitleStyle, CueSettings } from "@openreel/core/types/timeline";
import type { TextClip, TextScroll } from "@openreel/core/text/types";
import { findSavedStyle, normalizeStyleName } from "@openreel/core/text/saved-styles";
import type { EditingHost } from "./host";
import type { RegisteredTool } from "./registry";
import type { JSONSchema, ToolResult } from "./types";

/**
 * Text and caption styling for agents: roll/crawl titles, the caption style
 * model (stroke, shadow, box, safe margin, WebVTT cue settings) and the saved
 * style library. Every tool is one undoable action.
 */

const str: JSONSchema = { type: "string" };
const bool: JSONSchema = { type: "boolean" };
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const strList: JSONSchema = { type: "array", items: str };

const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data });
const fail = (message: string, code = "INVALID_PARAMS"): ToolResult => ({
  ok: false,
  summary: message,
  error: { code, message },
});
const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

async function dispatch(host: EditingHost, type: string, params: Record<string, unknown>, done: string, data?: unknown): Promise<ToolResult> {
  const action: Action = { type, id: genId(), timestamp: Date.now(), params };
  const result = await host.applyAction(action);
  return result.success ? ok(done, data) : fail(result.error?.message ?? `${type} failed`, result.error?.code ?? "ACTION_FAILED");
}

function guarded(run: (args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult> | ToolResult): RegisteredTool["handler"] {
  return async (args, host) => {
    try {
      host.requireOpenProject();
      return await run(args, host);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid request");
    }
  };
}

const textClipsOf = (host: EditingHost): TextClip[] => (host.getProject().textClips ?? []) as TextClip[];

function readScroll(value: unknown): TextScroll {
  const v = record(value);
  if (!v) throw new Error("scroll must be an object or null");
  if (v.mode !== "roll" && v.mode !== "crawl") throw new Error('scroll.mode must be "roll" or "crawl"');
  const allowed = v.mode === "roll" ? ["up", "down"] : ["left", "right"];
  if (v.direction !== undefined && !allowed.includes(String(v.direction)))
    throw new Error(`scroll.direction for ${v.mode} must be ${allowed.join(" or ")}`);
  return {
    mode: v.mode,
    ...(v.direction ? { direction: v.direction as TextScroll["direction"] } : {}),
    startOffscreen: v.startOffscreen !== false,
    endOffscreen: v.endOffscreen !== false,
  };
}

const CUE_ALIGN = ["start", "center", "end", "left", "right"];
function readCueSettings(value: Record<string, unknown>): CueSettings {
  const out: { -readonly [K in keyof CueSettings]: CueSettings[K] } = {};
  const num = (key: string, lo: number, hi: number): number | undefined => {
    if (value[key] === undefined) return undefined;
    const n = Number(value[key]);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`cueSettings.${key} must be a number from ${lo} to ${hi}`);
    return n;
  };
  const line = num("line", -1000, 1000);
  if (line !== undefined) out.line = line;
  if (value.snapToLines !== undefined) out.snapToLines = value.snapToLines !== false;
  const position = num("position", 0, 100);
  if (position !== undefined) out.position = position;
  const size = num("size", 1, 100);
  if (size !== undefined) out.size = size;
  if (value.lineAlign !== undefined) {
    if (!["start", "center", "end"].includes(String(value.lineAlign))) throw new Error("cueSettings.lineAlign must be start, center or end");
    out.lineAlign = value.lineAlign as CueSettings["lineAlign"];
  }
  if (value.positionAlign !== undefined) {
    if (!["line-left", "center", "line-right"].includes(String(value.positionAlign)))
      throw new Error("cueSettings.positionAlign must be line-left, center or line-right");
    out.positionAlign = value.positionAlign as CueSettings["positionAlign"];
  }
  if (value.align !== undefined) {
    if (!CUE_ALIGN.includes(String(value.align))) throw new Error(`cueSettings.align must be one of ${CUE_ALIGN.join(", ")}`);
    out.align = value.align as CueSettings["align"];
  }
  return out;
}

function targetCues(host: EditingHost, args: Record<string, unknown>): Subtitle[] {
  const all = host.getProject().timeline.subtitles;
  if (Array.isArray(args.subtitleIds)) {
    const ids = new Set(args.subtitleIds.map(String));
    const found = all.filter((s) => ids.has(s.id));
    if (found.length !== ids.size) throw new Error("One or more subtitleIds do not exist");
    return found;
  }
  if (typeof args.captionTrackId === "string") return all.filter((s) => (s.captionTrackId ?? "") === args.captionTrackId);
  return all;
}

export const TEXT_STYLE_TOOLS: RegisteredTool[] = [
  {
    name: "set_text_scroll",
    domain: "text",
    title: "Roll or crawl title",
    description:
      "Make a text clip roll (vertical credits) or crawl (horizontal ticker) across the frame over its whole duration. Pass { clipId, scroll: { mode: \"roll\"|\"crawl\", direction?: roll up|down, crawl left|right, startOffscreen?: true, endOffscreen?: true } } or scroll:null to stop scrolling. With startOffscreen the text enters fully outside the frame, with endOffscreen it leaves fully outside; a side that is not off-screen rests at the clip's position. Rendered the same in preview and export (2D text only: 3D-extruded or 3D-rotated titles ignore it).",
    inputSchema: obj({ clipId: str, scroll: { type: "object" } }, ["clipId", "scroll"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const clipId = String(args.clipId ?? "");
      if (!textClipsOf(host).some((c) => c.id === clipId)) return fail(`Text clip not found: ${clipId}`);
      if (args.scroll === null) {
        return dispatch(host, "text/update", { clipId, updates: {}, unset: ["scroll"] }, "Stopped scrolling", { clipId });
      }
      const scroll = readScroll(args.scroll);
      return dispatch(host, "text/update", { clipId, updates: { scroll } }, `Set ${scroll.mode} title`, { clipId, scroll });
    }),
  },
  {
    name: "set_caption_style",
    domain: "subtitle",
    title: "Set caption style",
    description:
      "Style caption cues as ONE undo step. Targets subtitleIds, else every cue of captionTrackId, else all cues. `style` merges into each cue's style: fontFamily, fontSize, color, backgroundColor, position (top|center|bottom), highlightColor, strokeColor, strokeWidth, shadowColor, shadowBlur, shadowOffsetX, shadowOffsetY, boxPaddingX, boxPaddingY, boxRadius, safeMargin (0..0.25 of the frame; keeps captions inside the safe area). `cueSettings` merges WebVTT settings (line, snapToLines, lineAlign, position, positionAlign, size, align) and is written into VTT export; SRT cannot carry them. cueSettings:null clears them.",
    inputSchema: obj({ subtitleIds: strList, captionTrackId: str, style: { type: "object" }, cueSettings: { type: "object" } }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const style = record(args.style);
      const clearCue = args.cueSettings === null;
      const cue = record(args.cueSettings);
      if (!style && !cue && !clearCue) return fail("Pass style and/or cueSettings");
      const targets = targetCues(host, args);
      if (!targets.length) return fail("No captions to style", "NO_CHANGE");
      const cueSettings = cue ? readCueSettings(cue) : undefined;
      const ids = new Set(targets.map((t) => t.id));
      const subtitles = host.getProject().timeline.subtitles.map((s): Subtitle => {
        if (!ids.has(s.id)) return s;
        const { cueSettings: prior, ...rest } = s;
        const nextCue = clearCue ? undefined : cueSettings ? { ...prior, ...cueSettings } : prior;
        return {
          ...rest,
          ...(style ? { style: { ...DEFAULT_CAPTION_STYLE, ...s.style, ...style } as SubtitleStyle } : {}),
          ...(nextCue ? { cueSettings: nextCue } : {}),
        };
      });
      return dispatch(host, "subtitle/setAll", { subtitles }, `Styled ${targets.length} caption${targets.length === 1 ? "" : "s"}`, { styled: targets.length });
    }),
  },
  {
    name: "list_saved_styles",
    domain: "text",
    title: "List saved styles",
    description: "List the saved text styles and caption styles stored on the project (id, name).",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: guarded((_args, host) => {
      const lib = host.getProject().savedStyles;
      const text = (lib?.text ?? []).map((s) => ({ id: s.id, name: s.name }));
      const caption = (lib?.caption ?? []).map((s) => ({ id: s.id, name: s.name }));
      return ok(`${text.length} text and ${caption.length} caption styles`, { text, caption });
    }),
  },
  {
    name: "save_text_style",
    domain: "text",
    title: "Save text style",
    description:
      "Save a text clip's look under a name so it can be applied to other text clips. Pass { name, clipId } (copies that clip's style and scroll) or { name, style } with a TextStyle object. Saving an existing name overwrites it.",
    inputSchema: obj({ name: str, clipId: str, style: { type: "object" }, includeScroll: bool }, ["name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const name = normalizeStyleName(String(args.name ?? ""));
      if (!name) return fail("name is required");
      let style = record(args.style);
      let scroll: TextScroll | undefined;
      if (typeof args.clipId === "string") {
        const clip = textClipsOf(host).find((c) => c.id === args.clipId);
        if (!clip) return fail(`Text clip not found: ${args.clipId}`);
        style = clip.style as unknown as Record<string, unknown>;
        if (args.includeScroll !== false) scroll = clip.scroll;
      }
      if (!style) return fail("Pass clipId or style");
      const id = genId();
      return dispatch(host, "style/save", { kind: "text", id, name, style, ...(scroll ? { scroll } : {}) }, `Saved text style "${name}"`, { name });
    }),
  },
  {
    name: "save_caption_style",
    domain: "subtitle",
    title: "Save caption style",
    description:
      "Save a caption look (style plus cue settings) under a name. Pass { name, subtitleId } to copy a cue's look, or { name, style, cueSettings? }. Saving an existing name overwrites it.",
    inputSchema: obj({ name: str, subtitleId: str, style: { type: "object" }, cueSettings: { type: "object" } }, ["name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const name = normalizeStyleName(String(args.name ?? ""));
      if (!name) return fail("name is required");
      let style = record(args.style);
      let cueSettings = record(args.cueSettings);
      if (typeof args.subtitleId === "string") {
        const cue = host.getProject().timeline.subtitles.find((s) => s.id === args.subtitleId);
        if (!cue) return fail(`Subtitle not found: ${args.subtitleId}`);
        style = (cue.style ?? DEFAULT_CAPTION_STYLE) as unknown as Record<string, unknown>;
        cueSettings = cue.cueSettings as unknown as Record<string, unknown> | undefined;
      }
      if (!style) return fail("Pass subtitleId or style");
      return dispatch(
        host,
        "style/save",
        { kind: "caption", id: genId(), name, style: { ...DEFAULT_CAPTION_STYLE, ...style }, ...(cueSettings ? { cueSettings: readCueSettings(cueSettings) } : {}) },
        `Saved caption style "${name}"`,
        { name },
      );
    }),
  },
  {
    name: "apply_saved_style",
    domain: "text",
    title: "Apply saved style",
    description:
      "Apply a saved style (id or name) to text clips ({ kind: \"text\", styleId, clipIds }) or caption cues ({ kind: \"caption\", styleId, subtitleIds }) as ONE undo step. Use list_saved_styles to see what exists.",
    inputSchema: obj({ kind: { type: "string", enum: ["text", "caption"] }, styleId: str, clipIds: strList, subtitleIds: strList }, ["kind", "styleId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: guarded(async (args, host) => {
      const styleId = String(args.styleId ?? "");
      if (args.kind === "text") {
        if (!Array.isArray(args.clipIds) || !args.clipIds.length) return fail("clipIds is required");
        return dispatch(host, "style/applyText", { clipIds: args.clipIds.map(String), styleId }, `Applied text style to ${args.clipIds.length} clip(s)`);
      }
      if (args.kind === "caption") {
        if (!Array.isArray(args.subtitleIds) || !args.subtitleIds.length) return fail("subtitleIds is required");
        return dispatch(host, "style/applyCaption", { subtitleIds: args.subtitleIds.map(String), styleId }, `Applied caption style to ${args.subtitleIds.length} cue(s)`);
      }
      return fail('kind must be "text" or "caption"');
    }),
  },
  {
    name: "delete_saved_style",
    domain: "text",
    title: "Delete saved style",
    description: "Delete a saved text or caption style by id or name. Clips that already use it keep their look.",
    inputSchema: obj({ kind: { type: "string", enum: ["text", "caption"] }, styleId: str }, ["kind", "styleId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: guarded(async (args, host) => {
      const kind = args.kind;
      if (kind !== "text" && kind !== "caption") return fail('kind must be "text" or "caption"');
      const lib = host.getProject().savedStyles;
      const list: ReadonlyArray<{ id: string; name: string }> = (kind === "text" ? lib?.text : lib?.caption) ?? [];
      if (!findSavedStyle(list, String(args.styleId ?? ""))) return fail(`Saved ${kind} style not found: ${String(args.styleId)}`);
      return dispatch(host, "style/delete", { kind, styleId: String(args.styleId) }, "Deleted saved style");
    }),
  },
];

const DEFAULT_CAPTION_STYLE: SubtitleStyle = {
  fontFamily: "Inter",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  position: "bottom",
};
