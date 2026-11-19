/**
 * Timecode and name burn-in (Premiere "Timecode" / "Clip Name" effects and the export "Timecode burn-in").
 *
 * Two effect types draw text into the picture:
 *  - `burn-in-timecode`: sequence, source-file or clip timecode (drop-frame aware, offset, field mark,
 *    frames / feet+frames formats).
 *  - `burn-in-name`: the clip name, file name or sequence name.
 *
 * Everything here is deterministic. The text is a pure function of (clip timing, project, parameters): it is
 * resolved once per frame by `withBurnInText` (the same sampling step that gives time driven effects their clock),
 * stored as the internal `__text` param, and drawn by `drawBurnIn`. Preview, playback, effect cards and export all
 * share those two functions, so a frame shows the same digits wherever it is rendered. Digits are placed on a
 * fixed advance (one cell per character) so the picture does not depend on the font's tabular figures.
 */
import {
  framesToTimecode,
  makeFrameRate,
  resolveFrameRate,
  secondsToFrames,
  timecodeToFrames,
  type FrameRate,
} from "../interchange/timecode";
import { getSpeedEngine } from "./speed-engine";

export const BURN_IN_EFFECT_TYPES = ["burn-in-timecode", "burn-in-name"] as const;
export type BurnInEffectType = (typeof BURN_IN_EFFECT_TYPES)[number];

export function isBurnInEffectType(type: string): type is BurnInEffectType {
  return type === "burn-in-timecode" || type === "burn-in-name";
}

/** Param the sampler writes the resolved text into. Never stored in a project. */
export const BURN_IN_TEXT_PARAM = "__text";

export type BurnInPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type BurnInGroup = "Source" | "Layout" | "Text" | "Background";

export type BurnInParamSpec =
  | { readonly kind: "number"; readonly key: string; readonly label: string; readonly group: BurnInGroup; readonly min: number; readonly max: number; readonly step: number; readonly unit?: string; readonly default: number }
  | { readonly kind: "select"; readonly key: string; readonly label: string; readonly group: BurnInGroup; readonly default: string; readonly options: readonly { readonly value: string; readonly label: string }[] }
  | { readonly kind: "toggle"; readonly key: string; readonly label: string; readonly group: BurnInGroup; readonly default: boolean }
  | { readonly kind: "text"; readonly key: string; readonly label: string; readonly group: BurnInGroup; readonly default: string; readonly placeholder?: string; readonly maxLength: number }
  | { readonly kind: "color"; readonly key: string; readonly label: string; readonly group: BurnInGroup; readonly default: string };

export interface BurnInSpec {
  readonly type: BurnInEffectType;
  readonly label: string;
  readonly description: string;
  readonly params: readonly BurnInParamSpec[];
}

export const BURN_IN_POSITIONS: readonly { value: BurnInPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "middle-left", label: "Middle left" },
  { value: "center", label: "Center" },
  { value: "middle-right", label: "Middle right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

const layoutAndStyle = (position: BurnInPosition, size: number): BurnInParamSpec[] => [
  { kind: "select", key: "position", label: "Position", group: "Layout", default: position, options: BURN_IN_POSITIONS },
  { kind: "number", key: "margin", label: "Margin", group: "Layout", min: 0, max: 30, step: 0.5, unit: "%", default: 3 },
  { kind: "number", key: "offsetX", label: "Offset X", group: "Layout", min: -50, max: 50, step: 0.5, unit: "%", default: 0 },
  { kind: "number", key: "offsetY", label: "Offset Y", group: "Layout", min: -50, max: 50, step: 0.5, unit: "%", default: 0 },
  { kind: "number", key: "size", label: "Size", group: "Text", min: 1, max: 30, step: 0.5, unit: "%", default: size },
  { kind: "number", key: "opacity", label: "Opacity", group: "Text", min: 0, max: 100, step: 1, unit: "%", default: 100 },
  { kind: "color", key: "textColor", label: "Text color", group: "Text", default: "#ffffff" },
  { kind: "toggle", key: "box", label: "Background box", group: "Background", default: true },
  { kind: "color", key: "boxColor", label: "Box color", group: "Background", default: "#000000" },
  { kind: "number", key: "boxOpacity", label: "Box opacity", group: "Background", min: 0, max: 100, step: 1, unit: "%", default: 65 },
  { kind: "number", key: "boxPadding", label: "Box padding", group: "Background", min: 0, max: 100, step: 1, unit: "%", default: 35 },
];

export const BURN_IN_TIME_BASES: readonly { value: string; label: string }[] = [
  { value: "auto", label: "Auto (source rate)" },
  { value: "23.976", label: "23.976 fps" },
  { value: "24", label: "24 fps" },
  { value: "25", label: "25 fps" },
  { value: "29.97-df", label: "29.97 fps drop-frame" },
  { value: "29.97-ndf", label: "29.97 fps non-drop" },
  { value: "30", label: "30 fps" },
  { value: "50", label: "50 fps" },
  { value: "59.94-df", label: "59.94 fps drop-frame" },
  { value: "59.94-ndf", label: "59.94 fps non-drop" },
  { value: "60", label: "60 fps" },
];

export const BURN_IN_SPECS: Readonly<Record<BurnInEffectType, BurnInSpec>> = {
  "burn-in-timecode": {
    type: "burn-in-timecode",
    label: "Timecode",
    description: "Burn in sequence, source or clip timecode (drop-frame aware)",
    params: [
      {
        kind: "select", key: "source", label: "Timecode source", group: "Source", default: "sequence",
        options: [
          { value: "sequence", label: "Sequence" },
          { value: "source", label: "Source file" },
          { value: "clip", label: "Clip (from 0)" },
        ],
      },
      { kind: "select", key: "timeBase", label: "Time display", group: "Source", default: "auto", options: BURN_IN_TIME_BASES },
      {
        kind: "select", key: "format", label: "Format", group: "Source", default: "timecode",
        options: [
          { value: "timecode", label: "Timecode" },
          { value: "frames", label: "Frames" },
          { value: "feet-16", label: "Feet + frames (16 mm)" },
          { value: "feet-35", label: "Feet + frames (35 mm)" },
        ],
      },
      { kind: "number", key: "offsetFrames", label: "Offset", group: "Source", min: -1000000, max: 1000000, step: 1, unit: " fr", default: 0 },
      {
        kind: "select", key: "field", label: "Field mark", group: "Source", default: "off",
        options: [
          { value: "off", label: "Off" },
          { value: "field-2", label: "Second field (. or ,)" },
        ],
      },
      { kind: "text", key: "label", label: "Label", group: "Source", default: "", placeholder: "e.g. CAM A", maxLength: 40 },
      ...layoutAndStyle("bottom-center", 5),
    ],
  },
  "burn-in-name": {
    type: "burn-in-name",
    label: "Clip Name",
    description: "Burn in the clip name, file name or sequence name",
    params: [
      {
        kind: "select", key: "nameSource", label: "Name source", group: "Source", default: "clip",
        options: [
          { value: "clip", label: "Clip name" },
          { value: "file", label: "File name" },
          { value: "sequence", label: "Sequence name" },
        ],
      },
      { kind: "toggle", key: "hideExtension", label: "Hide file extension", group: "Source", default: false },
      { kind: "text", key: "prefix", label: "Prefix", group: "Source", default: "", placeholder: "e.g. SCENE 4 - ", maxLength: 60 },
      ...layoutAndStyle("top-left", 4),
    ],
  },
};

export const BURN_IN_DEFAULTS: Readonly<Record<BurnInEffectType, Readonly<Record<string, unknown>>>> = {
  "burn-in-timecode": Object.freeze(Object.fromEntries(BURN_IN_SPECS["burn-in-timecode"].params.map((p) => [p.key, p.default]))),
  "burn-in-name": Object.freeze(Object.fromEntries(BURN_IN_SPECS["burn-in-name"].params.map((p) => [p.key, p.default]))),
};

/** Stored params with defaults filled in and every value clamped into its legal range. */
export function resolveBurnInParams(type: BurnInEffectType, params: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of BURN_IN_SPECS[type].params) {
    const raw = params?.[spec.key];
    switch (spec.kind) {
      case "number": {
        const n = typeof raw === "number" && Number.isFinite(raw) ? raw : spec.default;
        out[spec.key] = Math.min(spec.max, Math.max(spec.min, n));
        break;
      }
      case "select":
        out[spec.key] = typeof raw === "string" && spec.options.some((o) => o.value === raw) ? raw : spec.default;
        break;
      case "toggle":
        out[spec.key] = typeof raw === "boolean" ? raw : spec.default;
        break;
      case "text":
        out[spec.key] = typeof raw === "string" ? raw.slice(0, spec.maxLength) : spec.default;
        break;
      case "color":
        out[spec.key] = typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw : spec.default;
        break;
    }
  }
  return out;
}

/** An effect with no opacity draws nothing, so it is skipped everywhere (the neutral value of this effect). */
export function isBurnInNeutral(type: BurnInEffectType, params: Readonly<Record<string, unknown>> | undefined): boolean {
  return (resolveBurnInParams(type, params).opacity as number) <= 0;
}

/* -------------------------------------------------------------------------- */
/* Timecode formatting                                                         */
/* -------------------------------------------------------------------------- */

export type BurnInTimeFormat = "timecode" | "frames" | "feet-16" | "feet-35";

/** FrameRate for a "Time display" choice; "auto" uses the supplied native rate and drop-frame flag. */
export function burnInFrameRate(timeBase: string, native: { fps: number; dropFrame: boolean }): FrameRate {
  switch (timeBase) {
    case "23.976": return makeFrameRate(24, true);
    case "24": return makeFrameRate(24, false);
    case "25": return makeFrameRate(25, false);
    case "29.97-df": return makeFrameRate(30, true, true);
    case "29.97-ndf": return makeFrameRate(30, true, false);
    case "30": return makeFrameRate(30, false);
    case "50": return makeFrameRate(50, false);
    case "59.94-df": return makeFrameRate(60, true, true);
    case "59.94-ndf": return makeFrameRate(60, true, false);
    case "60": return makeFrameRate(60, false);
    default: return resolveFrameRate(native.fps > 0 ? native.fps : 30, { dropFrame: native.dropFrame });
  }
}

export interface FormatBurnInTimecodeOptions {
  /** Whole frames at `rate` (the start timecode plus elapsed frames plus the user offset). Negative shows a minus sign. */
  readonly frames: number;
  readonly rate: FrameRate;
  readonly format?: BurnInTimeFormat;
  /** Draw the second-field separator ("." for non-drop, "," for drop-frame, the SMPTE ST 12M-2 field mark). */
  readonly secondField?: boolean;
}

const FRAMES_PER_FOOT: Readonly<Record<"feet-16" | "feet-35", number>> = { "feet-16": 40, "feet-35": 16 };

/**
 * Text for a frame count. Timecode is `HH:MM:SS:FF` with `;` before the frames for drop-frame counting; Frames is the
 * plain count; feet + frames is `FFFF+FF` (40 frames per foot of 16 mm film, 16 per foot of 35 mm).
 */
export function formatBurnInTimecode({ frames, rate, format = "timecode", secondField = false }: FormatBurnInTimecodeOptions): string {
  const whole = Math.trunc(frames);
  const negative = whole < 0;
  const abs = Math.abs(whole);
  let text: string;
  if (format === "frames") {
    text = String(abs);
  } else if (format === "feet-16" || format === "feet-35") {
    const perFoot = FRAMES_PER_FOOT[format];
    text = `${String(Math.floor(abs / perFoot)).padStart(4, "0")}+${String(abs % perFoot).padStart(2, "0")}`;
  } else {
    text = framesToTimecode(abs, rate);
    if (secondField) {
      // ST 12M-2 field mark: the separator before the frames changes ':' to '.' and ';' to ','.
      text = text.replace(/([:;])(\d+)$/, (_m, sep: string, f: string) => `${sep === ";" ? "," : "."}${f}`);
    }
  }
  return negative ? `-${text}` : text;
}

/** Frames elapsed after `seconds` at `rate` (the frame being shown starts at or before the instant). */
export function elapsedFrames(seconds: number, rate: FrameRate): number {
  const exact = (Math.max(0, seconds) * rate.num) / rate.den;
  // The tolerance absorbs float error in n / fps so exports land on exactly frame n.
  return Math.floor(exact + 1e-6);
}

function startFramesOf(startTimecode: string | undefined, rate: FrameRate): number {
  if (!startTimecode) return 0;
  const match = /^(\d+):(\d{1,2}):(\d{1,2})[:;.,](\d+)$/.exec(startTimecode.trim());
  if (!match) return 0;
  try {
    return timecodeToFrames(`${match[1]}:${match[2]}:${match[3]}${rate.dropFrame ? ";" : ":"}${match[4]}`, rate);
  } catch {
    // A start that is a dropped number at this rate (or an out-of-range frame field) counts from zero.
    return 0;
  }
}

const isDropText = (timecode: string | undefined): boolean => !!timecode && timecode.includes(";");

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

export interface BurnInMedia {
  readonly name: string;
  readonly fileName: string;
  readonly frameRate?: number;
  /** HH:MM:SS:FF of the file's embedded start, `;` for drop-frame. */
  readonly startTimecodeText?: string;
  /** Embedded start as a time of day in seconds, when only that was read. */
  readonly startTimecodeSeconds?: number;
}

/** What a project contributes to burn-in text; build it with `createBurnInSource`. */
export interface BurnInSource {
  readonly frameRate: number;
  readonly sequenceName: string;
  readonly sequenceStartTimecode?: string;
  readonly media: (mediaId: string | undefined) => BurnInMedia | undefined;
}

export interface BurnInClipTiming {
  readonly id: string;
  readonly mediaId?: string;
  readonly startTime?: number;
  readonly inPoint?: number;
}

export interface BurnInProjectLike {
  readonly name: string;
  readonly settings: { readonly frameRate: number; readonly startTimecode?: string };
  readonly mediaLibrary: {
    readonly items: readonly {
      readonly id: string;
      readonly name: string;
      readonly metadata: { readonly frameRate: number; readonly startTimecode?: number; readonly startTimecodeText?: string };
      readonly interpretation?: { readonly frameRate?: number };
      readonly sourceFile?: { readonly name: string };
    }[];
  };
  readonly sequences?: readonly { readonly id: string; readonly name: string }[];
  readonly activeSequenceId?: string;
}

const sourceCache = new WeakMap<object, BurnInSource>();

/** Burn-in source of a project (cached per project object, so a frame loop builds it once). */
export function createBurnInSource(project: BurnInProjectLike): BurnInSource {
  const cached = sourceCache.get(project);
  if (cached) return cached;
  const byId = new Map<string, BurnInMedia>();
  for (const item of project.mediaLibrary?.items ?? []) {
    byId.set(item.id, {
      name: item.name,
      fileName: item.sourceFile?.name || item.name,
      frameRate: item.interpretation?.frameRate || item.metadata.frameRate || undefined,
      startTimecodeText: item.metadata.startTimecodeText,
      startTimecodeSeconds: item.metadata.startTimecode,
    });
  }
  const sequence = project.sequences?.find((s) => s.id === project.activeSequenceId);
  const source: BurnInSource = {
    frameRate: project.settings.frameRate,
    sequenceName: sequence?.name || project.name,
    sequenceStartTimecode: project.settings.startTimecode,
    media: (mediaId) => (mediaId ? byId.get(mediaId) : undefined),
  };
  sourceCache.set(project, source);
  return source;
}

/**
 * What an effect card or a not-yet-placed preview shows: a believable broadcast sequence (29.97 drop-frame starting at
 * 01:00:00;00) and a camera file. Never used for real frames.
 */
export const BURN_IN_SAMPLE_SOURCE: BurnInSource = {
  frameRate: 29.97,
  sequenceName: "Sequence 01",
  sequenceStartTimecode: "01:00:00;00",
  media: () => ({ name: "Interview A", fileName: "A001_C003_0912.mov", frameRate: 29.97, startTimecodeText: "14:22:10;00" }),
};

export interface ResolveBurnInTimecodeInput {
  readonly params: Readonly<Record<string, unknown>>;
  readonly source: BurnInSource;
  readonly clip: BurnInClipTiming;
  /** Seconds since the clip's first frame on the timeline. */
  readonly localTime: number;
}

/** The timecode text a `burn-in-timecode` effect shows for this clip at this instant. */
export function resolveBurnInTimecodeText({ params, source, clip, localTime }: ResolveBurnInTimecodeInput): string {
  const p = resolveBurnInParams("burn-in-timecode", params);
  const sourceKind = p.source as string;
  const media = source.media(clip.mediaId);
  const local = Math.max(0, localTime);

  let native: { fps: number; dropFrame: boolean };
  let startTimecode: string | undefined;
  let startSeconds = 0;
  let elapsedSeconds: number;
  if (sourceKind === "source" && media) {
    native = { fps: media.frameRate ?? source.frameRate, dropFrame: isDropText(media.startTimecodeText) };
    startTimecode = media.startTimecodeText;
    startSeconds = media.startTimecodeText ? 0 : (media.startTimecodeSeconds ?? 0);
    elapsedSeconds = (clip.inPoint ?? 0) + getSpeedEngine().getSourceTimeAtPlaybackTime(clip.id, local);
  } else if (sourceKind === "clip" || sourceKind === "source") {
    // A source timecode needs a file; generated clips (and clips on a missing file) count from their first frame.
    native = { fps: source.frameRate, dropFrame: false };
    elapsedSeconds = local;
  } else {
    native = { fps: source.frameRate, dropFrame: isDropText(source.sequenceStartTimecode) };
    startTimecode = source.sequenceStartTimecode;
    elapsedSeconds = (clip.startTime ?? 0) + local;
  }

  const rate = burnInFrameRate(p.timeBase as string, native);
  const base = startFramesOf(startTimecode, rate) + (startSeconds > 0 ? secondsToFrames(startSeconds, rate) : 0);
  const frames = base + elapsedFrames(elapsedSeconds, rate) + Math.round(p.offsetFrames as number);
  const text = formatBurnInTimecode({
    frames,
    rate,
    format: p.format as BurnInTimeFormat,
    secondField: p.field === "field-2",
  });
  const label = (p.label as string).trim();
  return label ? `${label}  ${text}` : text;
}

/** The text a `burn-in-name` effect shows for this clip. */
export function resolveBurnInNameText(params: Readonly<Record<string, unknown>>, source: BurnInSource, clip: BurnInClipTiming): string {
  const p = resolveBurnInParams("burn-in-name", params);
  const media = source.media(clip.mediaId);
  let name = "";
  switch (p.nameSource) {
    case "file":
      name = media?.fileName ?? "";
      if (p.hideExtension) name = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
      break;
    case "sequence":
      name = source.sequenceName;
      break;
    default:
      name = media?.name ?? "";
  }
  return `${p.prefix as string}${name}`;
}

interface EffectLike {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params: Record<string, unknown>;
}

/** True when the clip carries a burn-in that draws, so its frames depend on the clip's position in time. */
export function hasBurnInEffects(clip: { readonly effects?: readonly EffectLike[] }): boolean {
  return clip.effects?.some((e) => e.enabled !== false && isBurnInEffectType(e.type) && !isBurnInNeutral(e.type, e.params)) ?? false;
}

/**
 * Adds the resolved text to every burn-in effect (the array is returned untouched when there is none). Without a
 * source the effect has nothing to read and draws nothing, rather than a made-up value.
 */
export function withBurnInText<T extends EffectLike>(
  effects: readonly T[],
  clip: BurnInClipTiming,
  localTime: number,
  source: BurnInSource | undefined,
): readonly T[] {
  if (!effects.some((e) => isBurnInEffectType(e.type))) return effects;
  return effects.map((effect) => {
    if (!isBurnInEffectType(effect.type)) return effect;
    const text = !source
      ? ""
      : effect.type === "burn-in-timecode"
        ? resolveBurnInTimecodeText({ params: effect.params, source, clip, localTime })
        : resolveBurnInNameText(effect.params, source, clip);
    return { ...effect, params: { ...effect.params, [BURN_IN_TEXT_PARAM]: text } };
  });
}

/* -------------------------------------------------------------------------- */
/* Export "Timecode burn-in" overlay                                           */
/* -------------------------------------------------------------------------- */

/** Export setting: one click burns the sequence timecode into every frame, above all tracks and captions. */
export interface TimecodeBurnInSettings {
  readonly enabled: boolean;
  /** Absent = sequence timecode; "source" shows the file timecode of the topmost video clip under the playhead. */
  readonly source?: "sequence" | "source";
  readonly position?: BurnInPosition;
  /** Percent of the frame height. */
  readonly size?: number;
  /** Percent. */
  readonly opacity?: number;
  readonly box?: boolean;
}

export const DEFAULT_TIMECODE_BURN_IN: Required<Omit<TimecodeBurnInSettings, "enabled">> = {
  source: "sequence",
  position: "bottom-center",
  size: 5,
  opacity: 100,
  box: true,
};

interface OverlayProject extends BurnInProjectLike {
  readonly timeline: {
    readonly tracks: readonly {
      readonly type: string;
      readonly hidden?: boolean;
      readonly clips: readonly { readonly id: string; readonly mediaId: string; readonly startTime: number; readonly duration: number; readonly inPoint: number }[];
    }[];
  };
}

/** The effect (with resolved text) the export draws over a frame at `time`, or null when the setting is off. */
export function timecodeBurnInOverlay(
  project: OverlayProject,
  settings: TimecodeBurnInSettings | undefined,
  time: number,
): EffectLike | null {
  if (!settings?.enabled) return null;
  const defined = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
  const merged = { ...DEFAULT_TIMECODE_BURN_IN, ...defined };
  const params: Record<string, unknown> = {
    source: merged.source === "source" ? "source" : "sequence",
    position: merged.position,
    size: merged.size,
    opacity: merged.opacity,
    box: merged.box,
  };
  let clip: BurnInClipTiming | null = null;
  if (params.source === "source") {
    // Lower track index is on top, so the first video track with a clip under the playhead wins.
    for (const track of project.timeline.tracks) {
      if ((track.type !== "video" && track.type !== "image") || track.hidden) continue;
      const found = track.clips.find((c) => c.startTime <= time + 1e-6 && time < c.startTime + c.duration - 1e-6);
      if (found) {
        clip = found;
        break;
      }
    }
    // Nothing under the playhead (a gap): the overlay keeps counting the sequence timecode.
    if (!clip) params.source = "sequence";
  }
  const timing = clip ?? { id: "", startTime: 0 };
  const localTime = clip ? time - (clip.startTime ?? 0) : time;
  const effect: EffectLike = { type: "burn-in-timecode", enabled: true, params };
  return withBurnInText([effect], timing, localTime, createBurnInSource(project))[0];
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MONO_FONT = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const SANS_FONT = '-apple-system, "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';

function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

const rgba = (color: string, alpha: number): string => {
  const [r, g, b] = parseHex(color);
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha))})`;
};

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** Geometry of the drawn text block; exported so tests (and the export overlay) can assert where pixels land. */
export interface BurnInLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

/**
 * Draws a burn-in effect (its resolved `__text`) over the whole canvas. Does nothing for empty text or zero opacity.
 * Returns the box it occupied, or null when nothing was drawn.
 */
export function drawBurnIn(
  ctx: Ctx2D,
  type: BurnInEffectType,
  storedParams: Readonly<Record<string, unknown>>,
  width: number,
  height: number,
): BurnInLayout | null {
  const text = typeof storedParams[BURN_IN_TEXT_PARAM] === "string" ? (storedParams[BURN_IN_TEXT_PARAM] as string) : "";
  const p = resolveBurnInParams(type, storedParams);
  const opacity = (p.opacity as number) / 100;
  if (!text || opacity <= 0 || width <= 0 || height <= 0) return null;

  const fontSize = Math.max(6, Math.round(((p.size as number) / 100) * height));
  const mono = type === "burn-in-timecode";
  const padding = p.box ? Math.round(fontSize * ((p.boxPadding as number) / 100)) : 0;
  const margin = Math.round(Math.min(width, height) * ((p.margin as number) / 100));
  const maxTextWidth = Math.max(fontSize, width - 2 * (margin + padding));

  // The caller owns the transform (the export overlay draws inside a pixel-aspect scale).
  ctx.save();
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.font = `${mono ? 600 : 500} ${fontSize}px ${mono ? MONO_FONT : SANS_FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Fixed advance per character keeps timecode digits from jittering whatever the font's figures are.
  const cell = mono ? ctx.measureText("0").width : 0;
  let shown = text;
  let textWidth: number;
  if (mono) {
    const maxChars = Math.max(1, Math.floor(maxTextWidth / cell));
    if (shown.length > maxChars) shown = shown.slice(shown.length - maxChars);
    textWidth = cell * shown.length;
  } else {
    textWidth = ctx.measureText(shown).width;
    if (textWidth > maxTextWidth) {
      while (shown.length > 1 && ctx.measureText(`${shown}…`).width > maxTextWidth) shown = shown.slice(0, -1);
      shown = `${shown.trimEnd()}…`;
      textWidth = ctx.measureText(shown).width;
    }
  }

  const metrics = ctx.measureText("Hg");
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.75;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.22;
  const textHeight = Math.round(ascent + descent);
  const boxWidth = Math.round(textWidth + 2 * padding);
  const boxHeight = textHeight + 2 * padding;

  const position = p.position as BurnInPosition;
  const column = position.endsWith("left") ? 0 : position.endsWith("right") ? 2 : 1;
  const row = position.startsWith("top") ? 0 : position.startsWith("bottom") ? 2 : 1;
  let x = column === 0 ? margin : column === 2 ? width - margin - boxWidth : Math.round((width - boxWidth) / 2);
  let y = row === 0 ? margin : row === 2 ? height - margin - boxHeight : Math.round((height - boxHeight) / 2);
  x += Math.round(((p.offsetX as number) / 100) * width);
  y += Math.round(((p.offsetY as number) / 100) * height);

  if (p.box) {
    ctx.fillStyle = rgba(p.boxColor as string, opacity * ((p.boxOpacity as number) / 100));
    roundRect(ctx, x, y, boxWidth, boxHeight, Math.round(fontSize * 0.25));
    ctx.fill();
  }

  ctx.fillStyle = rgba(p.textColor as string, opacity);
  const baseline = y + padding + Math.round(ascent);
  if (mono) {
    for (let i = 0; i < shown.length; i++) {
      const ch = shown[i];
      // Narrow glyphs (":" ";" "." ",") are centred in their cell like a tabular figure.
      const glyph = ctx.measureText(ch).width;
      ctx.fillText(ch, x + padding + i * cell + (cell - glyph) / 2, baseline);
    }
  } else {
    ctx.fillText(shown, x + padding, baseline);
  }
  ctx.restore();
  return { x, y, width: boxWidth, height: boxHeight, fontSize };
}
