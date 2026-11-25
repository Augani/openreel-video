import type {
  TextGradientStop,
  TextBackgroundBox,
  TextClip,
  TextFill,
  TextRun,
  TextRunStyle,
  TextStroke,
  TextStyle,
} from "./types";

/**
 * Run model for per-character styling. Runs are contiguous, ordered pieces of
 * the clip text; their `text` fields concatenate to `TextClip.text`. Every
 * helper is pure and returns normalised runs (no empty runs, no two adjacent
 * runs with equal style) so the result can be stored and serialised as is.
 */

const RUN_STYLE_KEYS: readonly (keyof TextRunStyle)[] = [
  "fontFamily", "fontWeight", "fontStyle", "fontSize", "color", "fill",
  "letterSpacing", "baselineShift", "underline", "smallCaps", "ligatures", "tabularFigures",
];

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameRunStyle(a: TextRunStyle, b: TextRunStyle): boolean {
  return RUN_STYLE_KEYS.every((key) => sameValue(a[key], b[key]));
}

/** Drop `undefined` entries so equal styles compare and serialise equal. */
export function compactRunStyle(style: TextRunStyle): TextRunStyle {
  const out: Record<string, unknown> = {};
  for (const key of RUN_STYLE_KEYS) if (style[key] !== undefined) out[key] = style[key];
  return out as TextRunStyle;
}

export function isEmptyRunStyle(style: TextRunStyle): boolean {
  return RUN_STYLE_KEYS.every((key) => style[key] === undefined);
}

/** Merge adjacent equal runs and drop empty ones. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const style = compactRunStyle(run.style);
    const last = out[out.length - 1];
    if (last && sameRunStyle(last.style, style)) out[out.length - 1] = { text: last.text + run.text, style: last.style };
    else out.push({ text: run.text, style });
  }
  return out;
}

export const runsText = (runs: readonly TextRun[]): string => runs.map((run) => run.text).join("");

/**
 * Runs for `text`. Lazy migration: a clip without runs yields one run with no
 * overrides. Runs whose text no longer matches (an edit that bypassed the run
 * model) are reconciled by diffing, so styling survives around the edit.
 */
export function runsForText(text: string, runs?: readonly TextRun[]): TextRun[] {
  if (!runs || runs.length === 0) return text.length ? [{ text, style: {} }] : [];
  const current = runsText(runs);
  if (current === text) return normalizeRuns(runs);
  return editRuns(runs, text);
}

export function clipRuns(clip: Pick<TextClip, "text" | "runs">): TextRun[] {
  return runsForText(clip.text, clip.runs);
}

/** True when the text has any styling the plain single-style renderer cannot express. */
export function hasRunOverrides(runs: readonly TextRun[] | undefined): boolean {
  return !!runs && runs.some((run) => !isEmptyRunStyle(run.style));
}

/** True when the clip needs the rich renderer; plain clips keep the legacy path pixel for pixel. */
export function isRichTextClip(clip: Pick<TextClip, "runs" | "style">): boolean {
  const { style } = clip;
  return (
    hasRunOverrides(clip.runs) ||
    style.fill !== undefined ||
    (style.strokes !== undefined) ||
    style.backgroundBox !== undefined
  );
}

function splitAt(runs: readonly TextRun[], index: number): TextRun[] {
  const out: TextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const end = offset + run.text.length;
    if (index > offset && index < end) {
      out.push({ text: run.text.slice(0, index - offset), style: run.style });
      out.push({ text: run.text.slice(index - offset), style: run.style });
    } else out.push(run);
    offset = end;
  }
  return out;
}

/**
 * Apply a style patch to `[start, end)`. A key set to `undefined` in the patch
 * clears that override (the text goes back to the clip style).
 */
export function applyRunStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  patch: Partial<TextRunStyle>,
): TextRun[] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return normalizeRuns(runs);
  const total = runsText(runs).length;
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(total, Math.max(start, end));
  if (from >= to) return normalizeRuns(runs);
  const split = splitAt(splitAt(runs, from), to);
  let offset = 0;
  const out = split.map((run) => {
    const runStart = offset;
    offset += run.text.length;
    if (runStart < from || runStart >= to) return run;
    const merged: Record<string, unknown> = { ...run.style };
    for (const key of Object.keys(patch) as (keyof TextRunStyle)[]) {
      if (patch[key] === undefined) delete merged[key];
      else merged[key] = patch[key];
    }
    return { text: run.text, style: merged as TextRunStyle };
  });
  return normalizeRuns(out);
}

/** Slice of the runs covering `[start, end)`. */
export function sliceRuns(runs: readonly TextRun[], start: number, end: number): TextRun[] {
  const out: TextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runEnd = offset + run.text.length;
    const a = Math.max(start, offset);
    const b = Math.min(end, runEnd);
    if (a < b) out.push({ text: run.text.slice(a - offset, b - offset), style: run.style });
    offset = runEnd;
  }
  return out;
}

/**
 * Re-flow runs onto edited text. The edit is located by the longest common
 * prefix and suffix; inserted characters take the style of the character
 * before the insertion point (or after it at the very start), like a word
 * processor. Deleted characters take their run style with them.
 */
export function editRuns(runs: readonly TextRun[], newText: string): TextRun[] {
  const oldText = runsText(runs);
  if (oldText === newText) return normalizeRuns(runs);
  if (newText.length === 0) return [];
  if (oldText.length === 0) return [{ text: newText, style: {} }];
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(oldText.length, newText.length) - prefix;
  while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
  const inserted = newText.slice(prefix, newText.length - suffix);
  const head = sliceRuns(runs, 0, prefix);
  const tail = sliceRuns(runs, oldText.length - suffix, oldText.length);
  const styleSource = head.length ? head[head.length - 1] : sliceRuns(runs, 0, 1)[0];
  const middle: TextRun[] = inserted ? [{ text: inserted, style: styleSource?.style ?? {} }] : [];
  return normalizeRuns([...head, ...middle, ...tail]);
}

/** Style value shared by every character in `[start, end)`, or "mixed". */
export function rangeRunStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
): { [K in keyof TextRunStyle]?: TextRunStyle[K] | "mixed" } {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const covered = from === to ? sliceRuns(runs, Math.max(0, from - 1), Math.max(1, from)) : sliceRuns(runs, from, to);
  const result: Record<string, unknown> = {};
  if (covered.length === 0) return result;
  for (const key of RUN_STYLE_KEYS) {
    const first = covered[0].style[key];
    result[key] = covered.every((run) => sameValue(run.style[key], first)) ? first : "mixed";
  }
  return result as { [K in keyof TextRunStyle]?: TextRunStyle[K] | "mixed" };
}

/** Multiply every length in the runs (font size, tracking, shift) by `k`. */
export function scaleRuns(runs: readonly TextRun[], k: number): TextRun[] {
  if (k === 1) return runs.slice();
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return runs.map((run) => ({
    text: run.text,
    style: {
      ...run.style,
      ...(run.style.fontSize !== undefined ? { fontSize: round(run.style.fontSize * k) } : {}),
      ...(run.style.letterSpacing !== undefined ? { letterSpacing: round(run.style.letterSpacing * k) } : {}),
      ...(run.style.baselineShift !== undefined ? { baselineShift: round(run.style.baselineShift * k) } : {}),
    },
  }));
}

/** A run style with every field resolved against the clip style. */
export interface ResolvedRunStyle {
  readonly fontFamily: string;
  readonly fontWeight: TextStyle["fontWeight"];
  readonly fontStyle: "normal" | "italic";
  readonly fontSize: number;
  readonly fill: TextFill;
  readonly letterSpacing: number;
  readonly baselineShift: number;
  readonly underline: boolean;
  readonly smallCaps: boolean;
  readonly ligatures: boolean;
  readonly tabularFigures: boolean;
}

export function baseFill(style: Pick<TextStyle, "fill" | "color">): TextFill {
  return style.fill ?? { type: "solid", color: style.color };
}

export function resolveRunStyle(base: TextStyle, run: TextRunStyle): ResolvedRunStyle {
  const fill: TextFill = run.fill ?? (run.color !== undefined ? { type: "solid", color: run.color } : baseFill(base));
  return {
    fontFamily: run.fontFamily ?? base.fontFamily,
    fontWeight: run.fontWeight ?? base.fontWeight,
    fontStyle: run.fontStyle ?? base.fontStyle,
    fontSize: run.fontSize ?? base.fontSize,
    fill,
    letterSpacing: run.letterSpacing ?? base.letterSpacing,
    baselineShift: run.baselineShift ?? 0,
    underline: run.underline ?? base.textDecoration === "underline",
    smallCaps: run.smallCaps ?? false,
    ligatures: run.ligatures ?? true,
    tabularFigures: run.tabularFigures ?? false,
  };
}

/** Strokes of a style; the legacy single stroke counts as the first one. */
export function resolveStrokes(style: Pick<TextStyle, "strokes" | "strokeColor" | "strokeWidth">): TextStroke[] {
  if (style.strokes) return style.strokes.filter((stroke) => stroke.width > 0);
  return style.strokeColor && style.strokeWidth ? [{ color: style.strokeColor, width: style.strokeWidth }] : [];
}

/** Box behind the text; the legacy backgroundColor is a box with 10px side padding and no radius. */
export function resolveBackgroundBox(style: Pick<TextStyle, "backgroundBox" | "backgroundColor">): TextBackgroundBox | undefined {
  if (style.backgroundBox) return style.backgroundBox;
  return style.backgroundColor ? { color: style.backgroundColor, paddingX: 10, paddingY: 0, radius: 0 } : undefined;
}

/** First colour of a fill, for decorations that cannot take a gradient. */
export function fillAnchorColor(fill: TextFill): string {
  return fill.type === "solid" ? fill.color : (fill.stops[0]?.color ?? "#ffffff");
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Stops sorted and clamped so a hand-edited project cannot break the renderer. */
export function normalizeStops(stops: readonly TextGradientStop[]): TextGradientStop[] {
  return stops
    .filter((stop) => Number.isFinite(stop.offset) && typeof stop.color === "string")
    .map((stop) => ({ offset: clamp01(stop.offset), color: stop.color }))
    .sort((a, b) => a.offset - b.offset);
}

function parseFill(value: unknown): TextFill | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fill = value as { type?: unknown; color?: unknown; angle?: unknown; stops?: unknown };
  if (fill.type === "solid" && typeof fill.color === "string") return { type: "solid", color: fill.color };
  if ((fill.type === "linear" || fill.type === "radial") && Array.isArray(fill.stops)) {
    const stops = normalizeStops(fill.stops as TextGradientStop[]);
    if (stops.length < 2) return undefined;
    return fill.type === "linear"
      ? { type: "linear", angle: typeof fill.angle === "number" && Number.isFinite(fill.angle) ? fill.angle : 0, stops }
      : { type: "radial", stops };
  }
  return undefined;
}

/**
 * Validate runs read from a project file (or a template). Unknown fields are
 * dropped, malformed runs are skipped, and `undefined` comes back when nothing
 * usable remains so the clip falls back to single-run text.
 */
export function parseRuns(value: unknown): TextRun[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs: TextRun[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { text, style } = raw as { text?: unknown; style?: Record<string, unknown> };
    if (typeof text !== "string" || text.length === 0) continue;
    const s = style && typeof style === "object" ? style : {};
    const out: Record<string, unknown> = {};
    if (typeof s.fontFamily === "string") out.fontFamily = s.fontFamily;
    if (typeof s.fontWeight === "number" || s.fontWeight === "normal" || s.fontWeight === "bold") out.fontWeight = s.fontWeight;
    if (s.fontStyle === "normal" || s.fontStyle === "italic") out.fontStyle = s.fontStyle;
    for (const key of ["fontSize", "letterSpacing", "baselineShift"] as const) {
      if (typeof s[key] === "number" && Number.isFinite(s[key])) out[key] = s[key];
    }
    if (typeof s.fontSize === "number" && !(s.fontSize > 0)) delete out.fontSize;
    if (typeof s.color === "string") out.color = s.color;
    const fill = parseFill(s.fill);
    if (fill) out.fill = fill;
    for (const key of ["underline", "smallCaps", "ligatures", "tabularFigures"] as const) {
      if (typeof s[key] === "boolean") out[key] = s[key];
    }
    runs.push({ text, style: out as TextRunStyle });
  }
  return runs.length ? normalizeRuns(runs) : undefined;
}

/**
 * Lazy migration for clips read from storage: validates runs and drops them
 * when they only restate the clip style, so old single-style text is untouched.
 */
export function migrateTextClipRuns<T extends Pick<TextClip, "text" | "runs">>(clip: T): T {
  if (clip.runs === undefined) return clip;
  const parsed = parseRuns(clip.runs);
  if (!parsed || !hasRunOverrides(parsed)) {
    const { runs: _runs, ...rest } = clip;
    void _runs;
    return rest as T;
  }
  return { ...clip, runs: runsForText(clip.text, parsed) };
}

/** Every distinct font a clip draws with, for font loading before render/export. */
export function collectClipFonts(
  clip: Pick<TextClip, "text" | "runs" | "style">,
): { family: string; weight: string | number; sample: string }[] {
  const fonts = new Map<string, { family: string; weight: string | number; chars: Set<string> }>();
  for (const run of clipRuns(clip)) {
    const resolved = resolveRunStyle(clip.style, run.style);
    const key = `${resolved.fontFamily}:${resolved.fontWeight}`;
    const entry = fonts.get(key) ?? { family: resolved.fontFamily, weight: resolved.fontWeight, chars: new Set<string>() };
    for (const character of run.text) entry.chars.add(character);
    fonts.set(key, entry);
  }
  return [...fonts.values()].map(({ family, weight, chars }) => ({ family, weight, sample: [...chars].join("") }));
}
